import { useSyncExternalStore } from 'react'
import type { HAState, SimEvent, SimState } from './types'

/**
 * One EventSource for the whole page (GET /api/sim/stream). Components read the latest
 * snapshot through hooks; animation code subscribes to discrete events without re-rendering.
 */

export type Conn = 'connecting' | 'live' | 'offline'

export interface MetricPoint {
  t: number
  committed: number
  rejected: number
  published: number
  delivered: number
  dups: number
  pending: number
  lag: number
  inflight: number
  haLag: number
  haWps: number
}

interface Snapshot {
  conn: Conn
  sim: SimState | null
  ha: HAState | null
  /** serverNow - clientNow, from the last state frame (ms). */
  clockOffsetMs: number
  lastStateAt: number
  history: MetricPoint[]
  log: SimEvent[]
}

let snap: Snapshot = {
  conn: 'connecting',
  sim: null,
  ha: null,
  clockOffsetMs: 0,
  lastStateAt: 0,
  history: [],
  log: [],
}

const listeners = new Set<() => void>()
const eventListeners = new Set<(e: SimEvent) => void>()

function emit(next: Partial<Snapshot>) {
  snap = { ...snap, ...next }
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function onSimEvent(cb: (e: SimEvent) => void) {
  eventListeners.add(cb)
  return () => {
    eventListeners.delete(cb)
  }
}

const HISTORY = 120
const LOG = 120

let es: EventSource | null = null
let retry = 0
let retryTimer: number | undefined
let watchdog: number | undefined
let started = false

function scheduleReconnect() {
  es?.close()
  es = null
  if (snap.conn !== 'offline') emit({ conn: 'offline' })
  window.clearTimeout(retryTimer)
  const delay = Math.min(10000, 1500 * 2 ** Math.min(retry, 3))
  retry++
  retryTimer = window.setTimeout(connect, delay)
}

function armWatchdog() {
  window.clearTimeout(watchdog)
  // State frames arrive about once per second; five silent seconds means the stream is dead.
  watchdog = window.setTimeout(scheduleReconnect, 5000)
}

function connect() {
  es?.close()
  if (snap.conn !== 'live') emit({ conn: snap.sim ? 'offline' : 'connecting' })
  const source = new EventSource('/api/sim/stream')
  es = source
  armWatchdog()

  source.addEventListener('state', (msg) => {
    try {
      const payload = JSON.parse((msg as MessageEvent).data) as { sim: SimState; ha: HAState }
      retry = 0
      armWatchdog()
      const now = Date.now()
      const serverNow = Date.parse(payload.sim?.now ?? '')
      const m = payload.sim?.metrics
      const point: MetricPoint | null = m
        ? {
            t: now,
            committed: m.orders_committed,
            rejected: m.orders_rejected,
            published: m.events_published,
            delivered: m.events_delivered,
            dups: m.duplicates_ignored,
            pending: payload.sim.postgres.outbox.pending,
            lag: payload.sim.consistency.lag_events,
            inflight: payload.sim.broker.in_flight,
            haLag: payload.ha?.lag_bytes ?? 0,
            haWps: payload.ha?.writes_per_sec ?? 0,
          }
        : null
      const history = point ? [...snap.history, point].slice(-HISTORY) : snap.history
      emit({
        conn: 'live',
        sim: payload.sim ?? snap.sim,
        ha: payload.ha ?? snap.ha,
        clockOffsetMs: Number.isFinite(serverNow) ? serverNow - now : snap.clockOffsetMs,
        lastStateAt: now,
        history,
      })
    } catch {
      /* malformed frame: ignore, watchdog handles a dead stream */
    }
  })

  source.addEventListener('sim', (msg) => {
    try {
      const ev = JSON.parse((msg as MessageEvent).data) as SimEvent
      eventListeners.forEach((l) => l(ev))
      emit({ log: [ev, ...snap.log].slice(0, LOG) })
    } catch {
      /* ignore */
    }
  })

  source.onerror = () => {
    // A 502 from the dev proxy (API down) closes the source for good; a dropped
    // connection would auto-retry, but we take over either way for consistent backoff.
    scheduleReconnect()
  }
}

export function startLive() {
  if (started || typeof window === 'undefined') return
  started = true
  connect()
}

/** Force an immediate reconnect attempt (used by "retry" buttons). */
export function reconnectLive() {
  retry = 0
  window.clearTimeout(retryTimer)
  connect()
}

export function useLive<T>(select: (s: Snapshot) => T): T {
  return useSyncExternalStore(subscribe, () => select(snap), () => select(snap))
}

export const useConn = () => useLive((s) => s.conn)
export const useSim = () => useLive((s) => s.sim)
export const useHA = () => useLive((s) => s.ha)
export const useHistory = () => useLive((s) => s.history)
export const useEventLog = () => useLive((s) => s.log)
export const getClockOffset = () => snap.clockOffsetMs
export const getSnapshot = () => snap
