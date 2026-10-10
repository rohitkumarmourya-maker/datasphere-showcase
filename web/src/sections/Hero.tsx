import { motion, useReducedMotion } from 'motion/react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Counter } from '../components/Counter'
import { Fallback } from '../components/Fallback'
import { Magnetic } from '../components/Magnetic'
import { Tag } from '../components/Tag'
import { bytes, num } from '../lib/format'
import { reconnectLive, useConn, useHA, useSim } from '../lib/live'
import { scrollToId } from '../lib/scroll'
import '../styles/hero.css'

const HeroScene = lazy(() => import('../three/HeroScene').then((m) => ({ default: m.HeroScene })))

const LINES: { text: string; serif?: string }[] = [{ text: 'Six engines.' }, { text: 'One source' }, { text: 'of ', serif: 'truth.' }]

function webgl2() {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

export function Hero({ ready }: { ready: boolean }) {
  const section = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(true)
  const [gl] = useState(webgl2)
  const reduce = !!useReducedMotion()

  useEffect(() => {
    const el = section.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '0px 0px 0px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  let charIndex = 0
  return (
    <section id="top" className="hero" ref={section}>
      {gl ? (
        <Fallback fallback={<div className="hero-fallback" />}>
          <Suspense fallback={<div className="hero-fallback" />}>
            <HeroScene active={visible} reduced={reduce} />
          </Suspense>
        </Fallback>
      ) : (
        <div className="hero-fallback" />
      )}
      <div className="hero-veil" />

      <div className="wrap hero-content">
        <motion.div
          className="hero-kicker mono"
          initial={reduce ? false : { opacity: 0 }}
          animate={ready ? { opacity: 1 } : undefined}
          transition={{ duration: 0.8, delay: 0.1 }}
        >
          Enterprise DataSphere · multi-database reliability platform
        </motion.div>
        <h1 className="hero-title" aria-label="Six engines. One source of truth.">
          {LINES.map((l, li) => (
            <span className="hero-line" key={li} aria-hidden>
              {[...l.text].map((ch) => {
                const n = charIndex++
                return (
                  <motion.span
                    key={n}
                    className="hero-char"
                    initial={reduce ? false : { y: '105%' }}
                    animate={ready ? { y: '0%' } : undefined}
                    transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1], delay: 0.15 + n * 0.022 }}
                  >
                    {ch === ' ' ? ' ' : ch}
                  </motion.span>
                )
              })}
              {l.serif && (
                <motion.span
                  className="hero-char serif hero-truth"
                  initial={reduce ? false : { y: '105%', rotate: 8 }}
                  animate={ready ? { y: '0%', rotate: 0 } : undefined}
                  transition={{ duration: 1.3, ease: [0.16, 1, 0.3, 1], delay: 0.15 + charIndex * 0.022 + 0.1 }}
                >
                  {l.serif}
                </motion.span>
              )}
            </span>
          ))}
        </h1>

        <motion.p
          className="hero-sub"
          initial={reduce ? false : { opacity: 0, y: 20 }}
          animate={ready ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 1, delay: 0.9, ease: [0.16, 1, 0.3, 1] }}
        >
          A retail-commerce data platform where <b>PostgreSQL</b> is the ledger, <b>MongoDB</b> is a projection, and a{' '}
          <b>transactional outbox</b> is the only bridge between them — wrapped in failover drills, restore tests, capacity
          models and benchmarks that print what they measured. Nothing more.
        </motion.p>

        <motion.div
          className="hero-ctas"
          initial={reduce ? false : { opacity: 0, y: 20 }}
          animate={ready ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 1, delay: 1.05, ease: [0.16, 1, 0.3, 1] }}
        >
          <Magnetic>
            <button className="btn btn--primary" onClick={() => scrollToId('live')}>
              Break it live <span className="arrow">→</span>
            </button>
          </Magnetic>
          <Magnetic>
            <button className="btn" onClick={() => scrollToId('journey')}>
              Trace one order
            </button>
          </Magnetic>
        </motion.div>

        <motion.div
          className="hero-legend"
          initial={reduce ? false : { opacity: 0 }}
          animate={ready ? { opacity: 1 } : undefined}
          transition={{ duration: 1.2, delay: 1.3 }}
        >
          <span className="faint mono">every number here wears a label →</span>
          <Tag kind="measured" />
          <Tag kind="simulated" />
          <Tag kind="estimate" />
          <Tag kind="illustrative" />
        </motion.div>
      </div>

      <HeroTicker ready={ready} />

      <motion.p
        className="hero-fig hide-sm"
        initial={reduce ? false : { opacity: 0 }}
        animate={ready ? { opacity: 1 } : undefined}
        transition={{ duration: 1, delay: 1.6 }}
      >
        <b>Fig. 1</b> — The six engines around the platform core. <i />
        Each orange arc is a real order committed by the showcase API, travelling from PostgreSQL to its MongoDB projection.
      </motion.p>
    </section>
  )
}

function HeroTicker({ ready }: { ready: boolean }) {
  const conn = useConn()
  const sim = useSim()
  const ha = useHA()
  const live = conn === 'live' && sim
  return (
    <motion.div
      className="hero-ticker"
      initial={{ opacity: 0, y: 30 }}
      animate={ready ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 1, delay: 1.4, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="wrap hero-ticker-inner">
        {live ? (
          <>
            <Tag kind="simulated">Live sim</Tag>
            <div className="tk">
              <span>orders committed</span>
              <b>
                <Counter value={sim.metrics.orders_committed} />
              </b>
            </div>
            <div className="tk">
              <span>outbox pending</span>
              <b>
                <Counter value={sim.postgres.outbox.pending} />
              </b>
            </div>
            <div className="tk">
              <span>duplicates suppressed</span>
              <b>
                <Counter value={sim.metrics.duplicates_ignored} />
              </b>
            </div>
            <div className="tk">
              <span>read model</span>
              <b className={`cs cs--${sim.consistency.status}`}>{sim.consistency.status}</b>
            </div>
            <div className="tk hide-sm">
              <span>standby lag</span>
              <b>{ha ? bytes(ha.lag_bytes) : '—'}</b>
            </div>
            <div className="tk hide-sm">
              <span>events · 1m avg</span>
              <b>{sim.metrics.events_per_sec_1m.toFixed(2)}/s</b>
            </div>
          </>
        ) : (
          <>
            <Tag kind={conn === 'connecting' ? 'simulated' : 'offline'}>{conn === 'connecting' ? 'Connecting' : 'API offline'}</Tag>
            <span className="dim mono tk-off">
              {conn === 'connecting'
                ? 'opening /api/sim/stream …'
                : 'The live simulation is not reachable, so no numbers are shown. Start it with server/run.sh.'}
            </span>
            {conn === 'offline' && (
              <button className="btn btn--xs" onClick={reconnectLive}>
                retry
              </button>
            )}
          </>
        )}
        <span className="tk-seq mono faint hide-sm">{live ? `seq ${num(sim.seq)}` : ''}</span>
      </div>
    </motion.div>
  )
}
