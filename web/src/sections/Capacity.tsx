import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { SectionHead } from '../components/SectionHead'
import { FadeUp } from '../components/SplitReveal'
import { Tag } from '../components/Tag'
import { api } from '../lib/api'
import { bytes, num, pct } from '../lib/format'
import type { CapacityInput, CapacityResult } from '../lib/types'
import '../styles/capacity.css'

type Key = keyof CapacityInput
interface Slider {
  key: Key
  label: string
  min: number
  max: number
  step?: number
  log?: boolean
  fmt: (v: number) => string
  int?: boolean
}

const GB = 1024 ** 3

const SLIDERS: Slider[] = [
  { key: 'records_per_day', label: 'records / day', min: 1000, max: 100_000_000, log: true, fmt: (v) => num(v), int: true },
  { key: 'avg_record_bytes', label: 'avg record size', min: 128, max: 16384, log: true, fmt: (v) => bytes(v, 0), int: true },
  { key: 'events_per_record', label: 'events / record', min: 0, max: 10, step: 0.5, fmt: (v) => v.toFixed(1) },
  { key: 'avg_event_bytes', label: 'avg event size', min: 64, max: 8192, log: true, fmt: (v) => bytes(v, 0), int: true },
  { key: 'index_overhead_pct', label: 'index overhead', min: 0, max: 150, step: 5, fmt: (v) => v + '%' },
  { key: 'replication_factor', label: 'replication factor', min: 1, max: 5, step: 1, fmt: (v) => '×' + v, int: true },
  { key: 'backup_full_copies', label: 'full backups kept', min: 0, max: 30, step: 1, fmt: (v) => String(v), int: true },
  { key: 'retention_days', label: 'hot retention', min: 7, max: 1095, step: 1, log: true, fmt: (v) => v + ' d', int: true },
  { key: 'archive_compression_ratio', label: 'archive compression', min: 1, max: 12, step: 0.5, fmt: (v) => v.toFixed(1) + ':1' },
  { key: 'monthly_growth_pct', label: 'monthly growth', min: -10, max: 40, step: 1, fmt: (v) => (v > 0 ? '+' : '') + v + '%' },
  { key: 'threshold_gb', label: 'storage threshold', min: 50, max: 100_000, log: true, fmt: (v) => bytes(v * GB, 0), int: true },
]

const PRESETS: { name: string; v: CapacityInput }[] = [
  {
    name: 'Boutique store',
    v: { records_per_day: 5000, avg_record_bytes: 700, events_per_record: 2, avg_event_bytes: 300, index_overhead_pct: 30, replication_factor: 2, backup_full_copies: 7, retention_days: 365, archive_compression_ratio: 5, monthly_growth_pct: 4, threshold_gb: 50 },
  },
  {
    name: 'Regional chain',
    v: { records_per_day: 250000, avg_record_bytes: 900, events_per_record: 3, avg_event_bytes: 400, index_overhead_pct: 35, replication_factor: 3, backup_full_copies: 7, retention_days: 180, archive_compression_ratio: 6, monthly_growth_pct: 6, threshold_gb: 2000 },
  },
  {
    name: 'National marketplace',
    v: { records_per_day: 5_000_000, avg_record_bytes: 1100, events_per_record: 5, avg_event_bytes: 450, index_overhead_pct: 45, replication_factor: 3, backup_full_copies: 14, retention_days: 90, archive_compression_ratio: 8, monthly_growth_pct: 10, threshold_gb: 60000 },
  },
]

const toPos = (s: Slider, v: number) => (s.log ? (Math.log(v) - Math.log(s.min)) / (Math.log(s.max) - Math.log(s.min)) : (v - s.min) / (s.max - s.min))
const fromPos = (s: Slider, p: number) => {
  let v = s.log ? Math.exp(Math.log(s.min) + p * (Math.log(s.max) - Math.log(s.min))) : s.min + p * (s.max - s.min)
  if (s.log) {
    const mag = 10 ** Math.floor(Math.log10(v))
    v = Math.round(v / (mag / 10)) * (mag / 10)
  } else if (s.step) v = Math.round(v / s.step) * s.step
  if (s.int) v = Math.round(v)
  return Math.min(s.max, Math.max(s.min, v))
}

export function Capacity() {
  const [input, setInput] = useState<CapacityInput>(PRESETS[1].v)
  const [preset, setPreset] = useState(1)
  const [res, setRes] = useState<CapacityResult | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('loading')
  const ctrl = useRef<AbortController | null>(null)

  useEffect(() => {
    const t = setTimeout(async () => {
      ctrl.current?.abort()
      const c = new AbortController()
      ctrl.current = c
      setState('loading')
      const r = await api<CapacityResult>('/api/capacity', { body: input, signal: c.signal })
      if (c.signal.aborted) return
      if (r.ok && r.data) {
        setRes(r.data)
        setState('idle')
      } else setState('error')
    }, 140)
    return () => clearTimeout(t)
  }, [input])

  const set = (k: Key, v: number) => {
    setPreset(-1)
    setInput((i) => ({ ...i, [k]: v }))
  }

  return (
    <section id="capacity" className="section capacity">
      <div className="wrap">
        <SectionHead
          idx="06"
          kicker="Capacity planning"
          title={[['How big is'], [['next December?', 'serif']]]}
          lede="Drag the assumptions; the showcase API recomputes a day-by-day storage model — hot data with indexes, replicas, retained backups and a compressed archive — for twelve months, plus slower and faster growth scenarios. These are projections from your inputs, labelled as such."
          aside={<span style={{ marginLeft: 'auto' }}><Tag kind="estimate" /></span>}
        />

        <div className="cap-grid">
          <FadeUp className="cap-inputs panel">
            <div className="presets">
              {PRESETS.map((p, i) => (
                <button
                  key={p.name}
                  className={preset === i ? 'on' : ''}
                  onClick={() => {
                    setPreset(i)
                    setInput(p.v)
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>
            <div className="sliders">
              {SLIDERS.map((s) => {
                const v = input[s.key]
                return (
                  <label key={s.key} className="sl">
                    <span className="sl-top">
                      <span>{s.label}</span>
                      <b className="mono">{s.fmt(v)}</b>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={1000}
                      value={Math.round(toPos(s, v) * 1000)}
                      onChange={(e) => set(s.key, fromPos(s, Number(e.target.value) / 1000))}
                      style={{ ['--p' as string]: `${toPos(s, v) * 100}%` }}
                    />
                  </label>
                )
              })}
            </div>
          </FadeUp>

          <FadeUp delay={0.1} className="cap-out">
            {state === 'error' && !res ? (
              <div className="panel cap-off">
                <Tag kind="offline" />
                <p className="dim">The estimator runs in the showcase API. It is not reachable, so no projection is drawn.</p>
              </div>
            ) : res ? (
              <>
                <Horizons res={res} loading={state === 'loading'} />
                <Chart res={res} />
                <Sensitivity res={res} />
                <details className="assume">
                  <summary className="mono">assumptions the model makes ({res.assumptions.length})</summary>
                  <ul>
                    {res.assumptions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </details>
              </>
            ) : (
              <div className="panel cap-off">
                <span className="mono dim">computing…</span>
              </div>
            )}
          </FadeUp>
        </div>
      </div>
    </section>
  )
}

function Horizons({ res, loading }: { res: CapacityResult; loading: boolean }) {
  return (
    <div className={`horizons ${loading ? 'is-loading' : ''}`}>
      {res.horizons.map((h) => {
        const parts = [
          ['hot', h.hot_bytes, 'var(--pg)'],
          ['replicas', h.replica_bytes, 'var(--sky)'],
          ['backups', h.backup_bytes, 'var(--violet)'],
          ['archive', h.archive_bytes, 'var(--amber)'],
        ] as const
        return (
          <div key={h.label} className="hz">
            <span className="mono">{h.label}</span>
            <AnimatePresence mode="popLayout">
              <motion.b key={h.total_bytes} initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -12, opacity: 0 }} transition={{ duration: 0.25 }}>
                {bytes(h.total_bytes)}
              </motion.b>
            </AnimatePresence>
            <span className="hz-bar">
              {parts.map(([k, v, c]) => (
                <motion.i key={k} animate={{ flexGrow: Math.max(0.0001, v) }} style={{ background: c }} title={`${k}: ${bytes(v)}`} />
              ))}
            </span>
          </div>
        )
      })}
    </div>
  )
}

const W = 760
const H = 300
const P = { l: 64, r: 16, t: 16, b: 30 }

function Chart({ res }: { res: CapacityResult }) {
  const [hover, setHover] = useState<number | null>(null)
  const base = res.series.base
  const thr = res.threshold.gb * GB
  const dataMax = Math.max(...res.series.high.map((p) => p.total_bytes), ...base.map((p) => p.total_bytes), 1)
  const yMax = thr < dataMax * 1.8 ? Math.max(dataMax, thr) * 1.08 : dataMax * 1.08
  const x = (m: number) => P.l + (m / 12) * (W - P.l - P.r)
  const y = (v: number) => H - P.b - (v / yMax) * (H - P.t - P.b)

  const layers = useMemo(() => {
    const keys = ['hot_bytes', 'replica_bytes', 'backup_bytes', 'archive_bytes'] as const
    const acc = base.map(() => 0)
    return keys.map((k) => {
      const lo = [...acc]
      base.forEach((p, i) => (acc[i] += p[k]))
      const hi = [...acc]
      const top = base.map((p, i) => `${x(p.month).toFixed(1)},${y(hi[i]).toFixed(1)}`)
      const bot = base.map((p, i) => `${x(p.month).toFixed(1)},${y(lo[i]).toFixed(1)}`).reverse()
      return { k, d: `M ${top.join(' L ')} L ${bot.join(' L ')} Z` }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res, yMax])

  const line = (pts: { month: number; total_bytes: number }[]) => 'M ' + pts.map((p) => `${x(p.month).toFixed(1)},${y(p.total_bytes).toFixed(1)}`).join(' L ')
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax)
  const colors: Record<string, string> = { hot_bytes: 'var(--pg)', replica_bytes: 'var(--sky)', backup_bytes: 'var(--violet)', archive_bytes: 'var(--amber)' }
  const crossed = res.threshold.crossed_at_month
  const hp = hover != null ? base[hover] : null

  return (
    <div className="chart panel">
      <div className="chart-head">
        <div className="legend mono">
          <span style={{ ['--c' as string]: 'var(--pg)' }}>hot + index</span>
          <span style={{ ['--c' as string]: 'var(--sky)' }}>replicas</span>
          <span style={{ ['--c' as string]: 'var(--violet)' }}>backups</span>
          <span style={{ ['--c' as string]: 'var(--amber)' }}>archive</span>
          <span className="dash">low / high growth</span>
        </div>
        <span className="mono faint">
          {crossed != null ? (
            <>
              crosses {bytes(thr, 0)} at month <b className="rose">{crossed.toFixed(1)}</b>
            </>
          ) : (
            <>stays under {bytes(thr, 0)} for 12 months (base)</>
          )}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="chart-svg"
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const mx = ((e.clientX - r.left) / r.width) * W
          const m = Math.round(((mx - P.l) / (W - P.l - P.r)) * 12)
          setHover(m >= 0 && m <= 12 ? m : null)
        }}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Projected storage over twelve months"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={P.l - 8} y={y(t) + 4} textAnchor="end" className="axis">
              {bytes(t, 0)}
            </text>
          </g>
        ))}
        {[0, 3, 6, 9, 12].map((m) => (
          <text key={m} x={x(m)} y={H - 8} textAnchor="middle" className="axis">
            {m === 0 ? 'now' : `m${m}`}
          </text>
        ))}
        {layers.map((l) => (
          <motion.path key={l.k} initial={false} animate={{ d: l.d }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} fill={colors[l.k]} fillOpacity={0.28} stroke={colors[l.k]} strokeWidth={1} />
        ))}
        <motion.path initial={false} animate={{ d: line(res.series.low) }} className="scen-line" transition={{ duration: 0.5 }} />
        <motion.path initial={false} animate={{ d: line(res.series.high) }} className="scen-line" transition={{ duration: 0.5 }} />
        {thr <= yMax && (
          <g>
            <line x1={P.l} x2={W - P.r} y1={y(thr)} y2={y(thr)} className="thr" />
            <text x={W - P.r} y={y(thr) - 6} textAnchor="end" className="thr-label">
              threshold {bytes(thr, 0)}
            </text>
          </g>
        )}
        {crossed != null && crossed <= 12 && <circle cx={x(crossed)} cy={y(thr)} r={6} className="cross" />}
        {hp && (
          <g>
            <line x1={x(hp.month)} x2={x(hp.month)} y1={P.t} y2={H - P.b} className="hover-line" />
            <circle cx={x(hp.month)} cy={y(hp.total_bytes)} r={4} fill="var(--fg)" />
          </g>
        )}
      </svg>
      <div className="chart-tip mono">
        {hp ? (
          <>
            <b>month {hp.month}</b>
            <span>total {bytes(hp.total_bytes)}</span>
            <span>hot {bytes(hp.hot_bytes)}</span>
            <span>replicas {bytes(hp.replica_bytes)}</span>
            <span>backups {bytes(hp.backup_bytes)}</span>
            <span>archive {bytes(hp.archive_bytes)}</span>
          </>
        ) : (
          <span className="faint">
            hover the chart · growth scenarios {pct(res.scenarios.low.monthly_growth_pct, 0)} / {pct(res.scenarios.base.monthly_growth_pct, 0)} / {pct(res.scenarios.high.monthly_growth_pct, 0)} per month
          </span>
        )}
      </div>
    </div>
  )
}

function Sensitivity({ res }: { res: CapacityResult }) {
  const rows = [...res.sensitivity].sort((a, b) => Math.abs(b.delta_pct) - Math.abs(a.delta_pct))
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.delta_pct)))
  return (
    <div className="sens panel">
      <div className="panel-head">
        <span className="title">sensitivity · each input +20%, effect on 12-month total</span>
      </div>
      <ul>
        {rows.map((r) => (
          <li key={r.parameter}>
            <span className="mono">{r.parameter.replaceAll('_', ' ')}</span>
            <span className="tornado">
              <motion.i
                className={r.delta_pct >= 0 ? 'pos' : 'neg'}
                initial={false}
                animate={{ width: `${(Math.abs(r.delta_pct) / max) * 50}%`, left: r.delta_pct >= 0 ? '50%' : `${50 - (Math.abs(r.delta_pct) / max) * 50}%` }}
                transition={{ type: 'spring', stiffness: 140, damping: 22 }}
              />
            </span>
            <b className="mono">{pct(r.delta_pct)}</b>
          </li>
        ))}
      </ul>
    </div>
  )
}
