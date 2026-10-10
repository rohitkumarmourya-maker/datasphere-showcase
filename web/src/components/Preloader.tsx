import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { getSnapshot } from '../lib/live'
import { BrandMark } from './Nav'

/**
 * Boot screen that runs real checks (WebGL, fonts, API health, SSE stream, motion preference)
 * and reports what it actually found — no decorative fake "OK"s.
 */
type St = 'wait' | 'ok' | 'warn'
interface Line {
  key: string
  label: string
  st: St
  val: string
}

const INITIAL: Line[] = [
  { key: 'gl', label: 'webgl2', st: 'wait', val: 'probing…' },
  { key: 'fonts', label: 'typefaces', st: 'wait', val: 'loading…' },
  { key: 'api', label: 'showcase api', st: 'wait', val: 'GET /api/health' },
  { key: 'sse', label: 'live stream', st: 'wait', val: 'GET /api/sim/stream' },
  { key: 'motion', label: 'motion pref', st: 'wait', val: '…' },
]

const timeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms))])

export function Preloader({ onDone }: { onDone: () => void }) {
  const [lines, setLines] = useState(INITIAL)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    let alive = true
    const set = (key: string, st: St, val: string) =>
      alive && setLines((ls) => ls.map((l) => (l.key === key ? { ...l, st, val } : l)))

    const gl = (() => {
      try {
        return !!document.createElement('canvas').getContext('webgl2')
      } catch {
        return false
      }
    })()
    setTimeout(() => set('gl', gl ? 'ok' : 'warn', gl ? 'context ready' : 'unavailable → static fallback'), 120)

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    setTimeout(() => set('motion', 'ok', reduce ? 'reduced (OS setting honoured)' : 'full motion'), 260)

    const fonts = timeout(document.fonts.ready, 2600).then((r) =>
      set('fonts', r === 'timeout' ? 'warn' : 'ok', r === 'timeout' ? 'slow — system fallback' : 'IBM Plex Sans · IBM Plex Mono'),
    )

    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 2600)
    const health = api<{ version: string; uptime_s: number }>('/api/health', { signal: ctrl.signal }).then((r) => {
      clearTimeout(t)
      if (r.ok && r.data) set('api', 'ok', `127.0.0.1:8710 · v${r.data.version} · ${Math.round(r.ms)} ms`)
      else set('api', 'warn', 'unreachable — live panels will say so')
    })

    const stream = new Promise<void>((resolve) => {
      const start = Date.now()
      const poll = () => {
        const s = getSnapshot()
        if (s.conn === 'live' && s.sim) {
          set('sse', 'ok', `connected · seq ${s.sim.seq}`)
          return resolve()
        }
        if (Date.now() - start > 2800) {
          set('sse', 'warn', 'not connected yet')
          return resolve()
        }
        setTimeout(poll, 80)
      }
      poll()
    })

    Promise.all([fonts, health, stream, new Promise((r) => setTimeout(r, 1100))]).then(() => {
      if (!alive) return
      setTimeout(() => alive && setLeaving(true), 380)
    })
    return () => {
      alive = false
      ctrl.abort()
    }
  }, [])

  useEffect(() => {
    if (!leaving) return
    const t = setTimeout(onDone, 900)
    return () => clearTimeout(t)
  }, [leaving, onDone])

  useEffect(() => {
    const skip = () => setLeaving(true)
    window.addEventListener('keydown', skip)
    return () => window.removeEventListener('keydown', skip)
  }, [])

  const done = lines.filter((l) => l.st !== 'wait').length

  return (
    <motion.div
      className="boot"
      onClick={() => setLeaving(true)}
      initial={{ clipPath: 'inset(0% 0% 0% 0%)' }}
      animate={leaving ? { clipPath: 'inset(0% 0% 100% 0%)' } : { clipPath: 'inset(0% 0% 0% 0%)' }}
      transition={{ duration: 0.9, ease: [0.76, 0, 0.24, 1] }}
      role="status"
      aria-live="polite"
    >
      <motion.div
        className="boot-inner"
        animate={leaving ? { y: -40, opacity: 0 } : { y: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.65, 0, 0.35, 1] }}
      >
        <div className="boot-title">
          <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <BrandMark size={22} /> datasphere · preflight
          </span>
          <span>
            {done}/{lines.length}
          </span>
        </div>
        {lines.map((l, i) => (
          <motion.div
            className="boot-line"
            key={l.key}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.07, duration: 0.4 }}
          >
            <span className={`st ${l.st}`}>[{l.st === 'ok' ? ' ok ' : l.st === 'warn' ? 'warn' : ' .. '}]</span>
            <span>{l.label}</span>
            <span className="val">{l.val}</span>
          </motion.div>
        ))}
        <div className="boot-bar">
          <motion.i animate={{ scaleX: done / lines.length }} initial={{ scaleX: 0 }} transition={{ duration: 0.5 }} />
        </div>
        <div className="boot-skip">every line above is a real check · click or press any key to skip</div>
      </motion.div>
    </motion.div>
  )
}
