import { useEffect, useRef } from 'react'
import { getClockOffset, onSimEvent } from '../../lib/live'
import { useTheme } from '../../lib/theme'
import type { ConsumerStatus, Delivery, DeliveryKind } from '../../lib/types'

/**
 * Canvas lane between the outbox relay (left) and the consumer gate (right).
 * Packets come from real stream events and broker snapshots; positions are interpolated
 * between publish time and the server's deliver_at, so a delayed delivery visibly lags.
 */

interface Packet {
  id: string
  eventId: string
  position: number
  kind: DeliveryKind
  t0: number
  eta: number
  bound: boolean
  arrivedAt: number | null
  seenAt: number
}
interface Burst {
  x: number
  y: number
  t: number
  kind: 'ok' | 'dup' | 'crash' | 'heal'
}

const KIND_VAR: Record<DeliveryKind, string> = {
  normal: '--fg',
  duplicate: '--amber',
  delayed: '--sky',
  redelivery: '--violet',
}
const LANE: Record<DeliveryKind, number> = { normal: 0.5, duplicate: 0.27, delayed: 0.73, redelivery: 0.88 }

export function Wire({ deliveries, status, inFlight }: { deliveries: Delivery[]; status: ConsumerStatus | null; inFlight: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const packets = useRef(new Map<string, Packet>())
  const bursts = useRef<Burst[]>([])
  const theme = useTheme()
  const statusRef = useRef<ConsumerStatus | null>(status)
  const inFlightRef = useRef(inFlight)
  statusRef.current = status
  inFlightRef.current = inFlight

  // merge broker snapshots (every ~1 s)
  useEffect(() => {
    const now = performance.now()
    const map = packets.current
    const off = getClockOffset()
    for (const d of deliveries) {
      const etaWall = Date.parse(d.deliver_at) - off // client epoch ms
      const eta = now + (etaWall - Date.now())
      const existing = map.get(d.delivery_id)
      if (existing) {
        existing.eta = eta
        existing.seenAt = now
        continue
      }
      // adopt a provisional packet created from outbox.published
      const prov = map.get('pub:' + d.event_id)
      if (prov && !prov.bound && (d.kind === 'normal' || d.kind === 'delayed')) {
        map.delete(prov.id)
        prov.id = d.delivery_id
        prov.kind = d.kind
        prov.eta = eta
        prov.bound = true
        prov.seenAt = now
        map.set(d.delivery_id, prov)
        continue
      }
      map.set(d.delivery_id, {
        id: d.delivery_id,
        eventId: d.event_id,
        position: d.position,
        kind: d.kind,
        t0: now - (d.kind === 'redelivery' ? 0 : 150),
        eta: Math.max(eta, now + 250),
        bound: true,
        arrivedAt: null,
        seenAt: now,
      })
    }
  }, [deliveries])

  // discrete events
  useEffect(
    () =>
      onSimEvent((ev) => {
        const now = performance.now()
        const map = packets.current
        const d = ev.data as Record<string, unknown>
        const eventId = String(d.event_id ?? '')
        if (ev.type === 'outbox.published') {
          const kind = (d.kind as DeliveryKind) ?? 'normal'
          map.set('pub:' + eventId, {
            id: 'pub:' + eventId,
            eventId,
            position: Number(d.position ?? 0),
            kind,
            t0: now,
            eta: now + (kind === 'delayed' ? 6000 : 650),
            bound: false,
            arrivedAt: null,
            seenAt: now,
          })
        } else if (ev.type === 'event.delivered') {
          const did = String(d.delivery_id ?? '')
          const kind = (d.kind as DeliveryKind) ?? 'normal'
          let p = map.get(did) ?? map.get('pub:' + eventId)
          if (!p) {
            // delivered between snapshots: show a quick arrival so nothing is invisible
            p = { id: did, eventId, position: Number(d.position ?? 0), kind, t0: now - 260, eta: now, bound: true, arrivedAt: null, seenAt: now }
            map.set(did, p)
          }
          p.kind = kind
          p.arrivedAt = now
          p.eta = Math.min(p.eta, now)
        } else if (ev.type === 'event.duplicate_ignored' || ev.type === 'readmodel.upserted') {
          if (ev.type === 'readmodel.upserted' && d.projected_by === 'reconciler') {
            bursts.current.push({ x: -1, y: 0.5, t: now, kind: 'heal' })
            return
          }
          bursts.current.push({ x: -1, y: LANE[(d.kind as DeliveryKind) ?? 'normal'] ?? 0.5, t: now, kind: ev.type === 'event.duplicate_ignored' ? 'dup' : 'ok' })
        } else if (ev.type === 'consumer.crashed') {
          bursts.current.push({ x: -1, y: 0.5, t: now, kind: 'crash' })
        }
      }),
    [],
  )

  useEffect(() => {
    const cv = canvas.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    // read the palette from the canvas's own token scope (the live lab sits on the ink band)
    const cs = getComputedStyle(cv)
    const tok = (n: string) => cs.getPropertyValue(n).trim()
    const P = { ok: tok('--mint'), warn: tok('--amber'), info: tok('--sky'), bad: tok('--rose'), line: tok('--line-2'), fg2: tok('--fg-2'), pg: tok('--pg'), accent: tok('--accent') }
    const COLORS = Object.fromEntries(Object.entries(KIND_VAR).map(([k, v]) => [k, tok(v)])) as Record<DeliveryKind, string>
    let raf = 0
    let w = 0,
      h = 0
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const ro = new ResizeObserver(() => {
      const r = cv.getBoundingClientRect()
      w = r.width
      h = r.height
      cv.width = Math.round(w * dpr)
      cv.height = Math.round(h * dpr)
    })
    ro.observe(cv)
    let visible = true
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting))
    io.observe(cv)

    const draw = () => {
      raf = requestAnimationFrame(draw)
      if (!visible || !w) return
      const now = performance.now()
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      const x0 = 46
      const gate = w - 52
      const st = statusRef.current

      // lanes
      for (const k of Object.keys(LANE) as DeliveryKind[]) {
        const y = LANE[k] * h
        ctx.strokeStyle = P.line
        ctx.lineWidth = 1
        ctx.setLineDash([2, 8])
        ctx.lineDashOffset = -(now / 40) % 10
        ctx.beginPath()
        ctx.moveTo(x0, y)
        ctx.lineTo(gate, y)
        ctx.stroke()
      }
      ctx.setLineDash([])

      // source + gate
      ctx.fillStyle = P.pg
      ctx.fillRect(x0 - 14, h * 0.18, 3, h * 0.64)
      const gateColor = st === 'running' ? P.ok : st === 'resyncing' ? P.warn : P.bad
      const jitter = st === 'crashed' ? (Math.random() - 0.5) * 3 : 0
      ctx.fillStyle = gateColor
      ctx.fillRect(gate + 10 + jitter, h * 0.14, 4, h * 0.72)

      // packets
      const map = packets.current
      const queued: Packet[] = []
      for (const p of map.values()) {
        if (p.arrivedAt && now - p.arrivedAt > 420) {
          map.delete(p.id)
          continue
        }
        if (!p.arrivedAt && now - p.seenAt > 2600 && now > p.eta + 2500 && st === 'running') {
          map.delete(p.id) // stale provisional with no confirmation
          continue
        }
        if (!p.arrivedAt && now >= p.eta && st !== 'running') queued.push(p)
      }
      queued.sort((a, b) => a.position - b.position)
      const qIndex = new Map(queued.map((p, i) => [p.id, i]))

      for (const p of map.values()) {
        const color = COLORS[p.kind]
        let prog = p.eta > p.t0 ? (now - p.t0) / (p.eta - p.t0) : 1
        prog = Math.max(0, Math.min(1, prog))
        let x = x0 + (gate - x0) * (1 - Math.pow(1 - prog, 2))
        let y = LANE[p.kind] * h
        const qi = qIndex.get(p.id)
        if (qi !== undefined) {
          // piled up in front of a crashed consumer
          const col = Math.floor(qi / 4)
          x = gate - 10 - col * 15
          y = h * 0.32 + (qi % 4) * (h * 0.12)
        } else if (!p.arrivedAt && prog >= 1) {
          x = gate - 6
        }
        const alpha = p.arrivedAt ? Math.max(0, 1 - (now - p.arrivedAt) / 420) : 1
        if (p.arrivedAt) x = gate + 6
        // trail
        if (qi === undefined && !p.arrivedAt && prog < 1) {
          const g = ctx.createLinearGradient(x - 60, y, x, y)
          g.addColorStop(0, 'rgba(0,0,0,0)')
          g.addColorStop(1, color)
          ctx.strokeStyle = g
          ctx.globalAlpha = 0.6
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(Math.max(x0, x - 60), y)
          ctx.lineTo(x, y)
          ctx.stroke()
          ctx.globalAlpha = 1
        }
        ctx.globalAlpha = alpha
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(x, y, p.kind === 'normal' ? 4 : 4.5, 0, Math.PI * 2)
        ctx.fill()
        if (p.kind === 'delayed' && !p.arrivedAt) {
          ctx.strokeStyle = color
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.arc(x, y, 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * prog)
          ctx.stroke()
        }
        if (w > 420 && qi === undefined) {
          ctx.fillStyle = P.fg2
          ctx.font = '10px "IBM Plex Mono", monospace'
          ctx.fillText('#' + p.position, x - 10, y - 10)
        }
        ctx.globalAlpha = 1
      }
      if (inFlightRef.current > 20 && st !== 'running') {
        ctx.fillStyle = P.bad
        ctx.font = '11px "IBM Plex Mono", monospace'
        ctx.fillText(`+${inFlightRef.current - 20} more queued`, gate - 150, h * 0.92)
      }

      // bursts at the gate
      bursts.current = bursts.current.filter((b) => now - b.t < 900)
      for (const b of bursts.current) {
        const age = (now - b.t) / 900
        const bx = gate + 12
        const by = b.y * h
        const c = b.kind === 'ok' ? P.ok : b.kind === 'dup' ? P.warn : b.kind === 'heal' ? P.info : P.bad
        ctx.strokeStyle = c
        ctx.globalAlpha = 1 - age
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(bx, by, 6 + age * (b.kind === 'crash' ? 60 : 26), 0, Math.PI * 2)
        ctx.stroke()
        if (b.kind === 'dup') {
          ctx.beginPath()
          ctx.moveTo(bx - 7, by - 7)
          ctx.lineTo(bx + 7, by + 7)
          ctx.moveTo(bx + 7, by - 7)
          ctx.lineTo(bx - 7, by + 7)
          ctx.stroke()
        }
        ctx.globalAlpha = 1
      }
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
    }
  }, [theme])

  return <canvas ref={canvas} className="wire-canvas" aria-label="Animated view of in-flight event deliveries" role="img" />
}
