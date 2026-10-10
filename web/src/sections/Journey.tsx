import { AnimatePresence, motion, useMotionValueEvent, useScroll } from 'motion/react'
import { useLayoutEffect, useRef, useState } from 'react'
import { Code } from '../components/Code'
import { SectionHead } from '../components/SectionHead'
import { Tag } from '../components/Tag'
import { STAGES } from '../data/journey'
import { scrollToId, scrollToY } from '../lib/scroll'
import '../styles/journey.css'

// U-shaped route through the system (viewBox 1000 × 330)
const TOP_Y = 80
const BOT_Y = 250
const PATH = `M 70 ${TOP_Y} H 870 C 962 ${TOP_Y} 962 ${BOT_Y} 870 ${BOT_Y} H 120`

const NODES = [
  { id: 'client', x: 70, y: TOP_Y, label: 'Client', sub: 'React · retry' },
  { id: 'api', x: 225, y: TOP_Y, label: 'FastAPI', sub: 'validate · key' },
  { id: 'relay', x: 800, y: TOP_Y, label: 'Relay', sub: 'SKIP LOCKED' },
  { id: 'broker', x: 940, y: (TOP_Y + BOT_Y) / 2, label: 'Change stream', sub: 'at-least-once' },
  { id: 'consumer', x: 660, y: BOT_Y, label: 'Consumer', sub: 'dedupe · token' },
  { id: 'mongo', x: 440, y: BOT_Y, label: 'MongoDB', sub: 'order_views' },
  { id: 'dash', x: 150, y: BOT_Y, label: 'Dashboard', sub: 'reads view' },
]
const TABLES = [
  { id: 't-idem', x: 330, label: 'idempotency_keys' },
  { id: 't-inv', x: 440, label: 'inventory' },
  { id: 't-orders', x: 548, label: 'orders · items' },
  { id: 't-outbox', x: 652, label: 'outbox' },
]

export function Journey() {
  const pin = useRef<HTMLDivElement>(null)
  const pathRef = useRef<SVGPathElement>(null)
  const progRef = useRef<SVGPathElement>(null)
  const packetRef = useRef<SVGGElement>(null)
  const anchors = useRef<number[]>([])
  const total = useRef(1)
  const [stage, setStage] = useState(0)
  const stageRef = useRef(0)
  const { scrollYProgress } = useScroll({ target: pin, offset: ['start start', 'end end'] })

  const place = (p: number) => {
    const path = pathRef.current
    const a = anchors.current
    if (!path || a.length < 8) return
    const x = Math.min(STAGES.length - 1e-6, Math.max(0, p * STAGES.length))
    const i = Math.floor(x)
    const local = Math.min(1, (x - i) / 0.62) // travel early in the stage, then dwell
    const eased = 1 - Math.pow(1 - local, 3)
    const len = a[i] + (a[i + 1] - a[i]) * eased
    const pt = path.getPointAtLength(len)
    packetRef.current?.setAttribute('transform', `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`)
    progRef.current?.style.setProperty('stroke-dashoffset', String(total.current - len))
    if (i !== stageRef.current) {
      stageRef.current = i
      setStage(i)
    }
  }

  useLayoutEffect(() => {
    const path = pathRef.current
    if (!path) return
    const T = path.getTotalLength()
    total.current = T
    const top = 800
    const curve = T - top - 750
    const bot = (x: number) => top + curve + (870 - x)
    anchors.current = [0, 155, 300, 440, 580, top + curve / 2, bot(440), bot(150)]
    if (progRef.current) {
      progRef.current.style.strokeDasharray = `${T} ${T}`
      progRef.current.style.strokeDashoffset = String(T)
    }
    place(scrollYProgress.get())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useMotionValueEvent(scrollYProgress, 'change', place)

  const jump = (i: number) => {
    const el = pin.current
    if (!el) return
    const top = el.getBoundingClientRect().top + window.scrollY
    const span = el.offsetHeight - window.innerHeight
    scrollToY(top + span * ((i + 0.7) / STAGES.length))
  }

  const s = STAGES[stage]
  const lit = new Set(STAGES.slice(0, stage + 1).flatMap((x) => x.lights))
  const active = new Set(s.lights)
  const txn = stage === 0 ? 'idle' : stage < 4 ? (stage === 3 ? 'commit' : 'open') : 'done'

  return (
    <section id="journey" className="section journey">
      <div className="wrap">
        <SectionHead
          idx="01"
          kicker="Anatomy of an order"
          title={[['One order.'], ['Seven hops.'], [['Zero dual writes.', 'serif']]]}
          lede="Scroll to push a single checkout through the system. Watch where the transaction boundary sits, how the event escapes PostgreSQL without a dual write, and what happens if the process dies at every hop."
        />
      </div>

      <div className="journey-pin" ref={pin} style={{ height: `${STAGES.length * 82 + 40}vh` }}>
        <div className="journey-sticky">
          <div className="wrap journey-frame">
            <div className="journey-top">
              <div className="journey-steps" role="tablist" aria-label="Order journey stages">
                {STAGES.map((st, i) => (
                  <button
                    key={st.n}
                    role="tab"
                    aria-selected={i === stage}
                    className={`jstep ${i === stage ? 'is-on' : ''} ${i < stage ? 'is-done' : ''}`}
                    onClick={() => jump(i)}
                  >
                    <span>{st.n}</span>
                    <i />
                  </button>
                ))}
              </div>
              <Tag kind="illustrative">Design walkthrough</Tag>
            </div>

            <div className="journey-diagram panel panel--ticks">
              <svg viewBox="0 0 1000 330" role="img" aria-label="Order path from client through PostgreSQL transaction, outbox relay and consumer into MongoDB">

                {/* transaction boundary */}
                <g className={`txn txn--${txn}`}>
                  <rect x="282" y="22" width="436" height="118" rx="16" />
                  <text x="298" y="42" className="txn-label">
                    {txn === 'done' ? 'COMMITTED · ONE ACID TRANSACTION' : 'ONE ACID TRANSACTION · PostgreSQL'}
                  </text>
                  {TABLES.map((t) => (
                    <g key={t.id} className={`tbl ${lit.has(t.id) ? 'on' : ''} ${active.has(t.id) ? 'act' : ''}`} transform={`translate(${t.x} ${TOP_Y + 26})`}>
                      <rect x="-50" y="-12" width="100" height="24" rx="6" />
                      <text y="4" textAnchor="middle">
                        {t.label}
                      </text>
                    </g>
                  ))}
                  <g className={`commit-badge ${lit.has('commit') ? 'on' : ''}`} transform="translate(650 42)">
                    <rect x="-34" y="-11" width="68" height="20" rx="10" />
                    <text y="3" textAnchor="middle">
                      COMMIT ✓
                    </text>
                  </g>
                </g>

                <path d={PATH} className="route" ref={pathRef} />
                <path d={PATH} className="route-prog" ref={progRef} />
                <path d={PATH} className="route-dash" />

                {NODES.map((n) => (
                  <g key={n.id} className={`jnode ${lit.has(n.id) ? 'on' : ''} ${active.has(n.id) ? 'act' : ''}`} transform={`translate(${n.x} ${n.y})`}>
                    <circle r="9" className="jnode-dot" />
                    <circle r="18" className="jnode-ring" />
                    <text y={n.y === TOP_Y ? -30 : 42} textAnchor="middle" className="jnode-label">
                      {n.label}
                    </text>
                    <text y={n.y === TOP_Y ? -16 : 56} textAnchor="middle" className="jnode-sub">
                      {n.sub}
                    </text>
                  </g>
                ))}

                <g ref={packetRef} className="packet">
                  <circle r="13" style={{ fill: 'none', stroke: 'var(--accent)', strokeWidth: 1.5 }} />
                  <circle r="6" style={{ fill: 'var(--accent)' }} />
                </g>
              </svg>
            </div>

            <div className="journey-bottom">
              <AnimatePresence mode="wait">
                <motion.div
                  key={s.n}
                  className="journey-copy"
                  initial={{ opacity: 0, y: 18, filter: 'blur(6px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, y: -12, filter: 'blur(6px)' }}
                  transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                >
                  <div className="jc-where mono">
                    <b>{s.n}</b> · {s.where}
                  </div>
                  <h3 className="jc-title">{s.title}</h3>
                  <p className="jc-body">{s.body}</p>
                  <div className="jc-fail">
                    <span className="mono">if it fails here</span>
                    <p>{s.fail}</p>
                  </div>
                </motion.div>
              </AnimatePresence>
              <div className="journey-code panel">
                <div className="panel-head">
                  <span className="title">
                    <span className="dot" style={{ ['--c' as string]: s.lang === 'sql' ? 'var(--pg)' : s.lang === 'python' ? 'var(--mg)' : 'var(--amber)' }} />
                    {s.lang === 'sql' ? 'postgresql' : s.lang === 'python' ? 'consumer.py' : 'http'}
                  </span>
                  <span>
                    stage {s.n}/{String(STAGES.length).padStart(2, '0')}
                  </span>
                </div>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={s.n}
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -16 }}
                    transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                    data-lenis-prevent
                    className="journey-code-body"
                  >
                    <Code code={s.code} lang={s.lang} />
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
            <button className="journey-cta mono" onClick={() => scrollToId('live')}>
              every failure above can be triggered live in 02 →
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
