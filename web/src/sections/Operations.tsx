import { motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { SectionHead } from '../components/SectionHead'
import { FadeUp } from '../components/SplitReveal'
import { Tag } from '../components/Tag'
import { bytes, num } from '../lib/format'
import { useConn, useHistory, type MetricPoint } from '../lib/live'
import '../styles/operations.css'

interface PanelDef {
  id: string
  title: string
  metric: string
  color: string
  fmt: (v: number) => string
  value: (h: MetricPoint[], i: number) => number
  meaning: string
}

const rate = (h: MetricPoint[], i: number, k: keyof MetricPoint) => {
  if (i === 0) return 0
  const dt = (h[i].t - h[i - 1].t) / 1000
  const dv = (h[i][k] as number) - (h[i - 1][k] as number)
  return dt > 0 && dv >= 0 ? dv / dt : 0
}

const PANELS: PanelDef[] = [
  { id: 'orders', title: 'Orders committed / s', metric: 'Δ datasphere_sim_orders_committed_total / Δt (1 s frames)', color: 'var(--mint)', fmt: (v) => v.toFixed(2), value: (h, i) => rate(h, i, 'committed'), meaning: 'Write throughput reaching the ledger.' },
  { id: 'pending', title: 'Outbox pending', metric: 'datasphere_sim_outbox_pending', color: 'var(--amber)', fmt: (v) => num(v), value: (h, i) => h[i].pending, meaning: 'Committed events not yet published. Rising = relay stuck.' },
  { id: 'lag', title: 'Read-model lag (events)', metric: 'datasphere_sim_consistency_lag_events', color: 'var(--sky)', fmt: (v) => num(v), value: (h, i) => h[i].lag, meaning: 'How far MongoDB trails PostgreSQL.' },
  { id: 'dups', title: 'Duplicates suppressed / s', metric: 'Δ datasphere_sim_duplicates_ignored_total / Δt (1 s frames)', color: 'var(--violet)', fmt: (v) => v.toFixed(2), value: (h, i) => rate(h, i, 'dups'), meaning: 'At-least-once delivery doing its thing — safely.' },
  { id: 'inflight', title: 'Deliveries in flight', metric: 'broker in-flight (stream)', color: 'var(--rose)', fmt: (v) => num(v), value: (h, i) => h[i].inflight, meaning: 'A crashed consumer shows here first.' },
  { id: 'ha', title: 'Standby replay lag', metric: 'datasphere_ha_replication_lag_bytes', color: 'var(--pg)', fmt: (v) => bytes(v), value: (h, i) => h[i].haLag, meaning: 'Bytes of WAL a failover would lose right now (async).' },
]

export function Operations() {
  const history = useHistory()
  const conn = useConn()
  return (
    <section id="operations" className="section operations">
      <div className="wrap">
        <SectionHead
          idx="08"
          kicker="Observability"
          title={[["If it isn't graphed,"], [["it didn't happen.", 'serif']]]}
          lede="The full platform scrapes the API and exporters into Prometheus and provisions Grafana dashboards. Below, the same idea at showcase scale: panels plotted from the live stream, and the API’s real Prometheus endpoint, refreshed as you watch."
          aside={<span style={{ marginLeft: 'auto' }}><Tag kind="simulated">Live sim values</Tag></span>}
        />
        <div className="graf">
          {PANELS.map((p, i) => (
            <FadeUp key={p.id} delay={i * 0.05}>
              <Spark def={p} history={history} offline={conn !== 'live'} />
            </FadeUp>
          ))}
        </div>
        <div className="ops-row">
          <FadeUp className="ops-scrape">
            <MetricsTail />
          </FadeUp>
          <FadeUp delay={0.1} className="ops-notes">
            <div className="note">
              <span className="mono">cardinality</span>
              <p>
                Labels are <code>method</code>, <code>route</code> (the template, e.g. <code>/api/sim/orders</code>) and <code>status</code> — never order ids, customer ids or raw paths. The series count stays bounded no matter how much traffic flows.
              </p>
            </div>
            <div className="note">
              <span className="mono">how fresh</span>
              <p>The stream pushes a state frame about once a second; these panels keep the last two minutes in your browser. Prometheus would scrape <code>/metrics</code> on its own interval (15 s by default).</p>
            </div>
            <div className="note">
              <span className="mono">alert on symptoms</span>
              <p>Outbox pending &gt; 0 for 5 min, read-model lag climbing, replica lag above the RPO budget, last verified restore older than 7 days.</p>
            </div>
          </FadeUp>
        </div>
      </div>
    </section>
  )
}

function Spark({ def, history, offline }: { def: PanelDef; history: MetricPoint[]; offline: boolean }) {
  const W = 300
  const H = 90
  const vals = useMemo(() => history.map((_, i) => def.value(history, i)), [history, def])
  const last = vals.length ? vals[vals.length - 1] : null
  const max = Math.max(1e-9, ...vals) * 1.15
  const pts = vals.map((v, i) => [vals.length > 1 ? (i / (vals.length - 1)) * W : W, H - (v / max) * (H - 6) - 3] as const)
  const line = pts.length > 1 ? 'M ' + pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L ') : ''
  const area = line ? `${line} L ${W},${H} L 0,${H} Z` : ''
  const gid = 'g-' + def.id
  return (
    <div className="gpanel" style={{ ['--c' as string]: def.color }}>
      <div className="gp-head">
        <span>{def.title}</span>
        <span className="gp-live mono">{offline ? 'no data' : '● live'}</span>
      </div>
      <div className="gp-val">{offline || last == null ? <span className="faint">—</span> : def.fmt(last)}</div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="gp-svg" aria-hidden>
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={def.color} stopOpacity=".35" />
            <stop offset="1" stopColor={def.color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {area && <path d={area} fill={`url(#${gid})`} />}
        {line && <path d={line} fill="none" stroke={def.color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="gp-foot mono">{def.metric}</div>
      <div className="gp-mean">{def.meaning}</div>
    </div>
  )
}

function MetricsTail() {
  const [lines, setLines] = useState<string[] | null>(null)
  const [at, setAt] = useState<number | null>(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const r = await fetch('/metrics')
        if (!r.ok) throw new Error(String(r.status))
        const text = await r.text()
        if (!alive) return
        const keep = text
          .split('\n')
          .filter((l) => l.startsWith('datasphere_') && !l.includes('_bucket{'))
          .slice(0, 40)
        setLines(keep)
        setAt(Date.now())
        setErr(false)
      } catch {
        if (alive) setErr(true)
      }
    }
    load()
    const t = setInterval(load, 5000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])
  return (
    <div className="panel scrape">
      <div className="panel-head">
        <span className="title">
          <span className="dot" style={{ ['--c' as string]: err ? 'var(--rose)' : 'var(--mint)' }} />
          GET /metrics · Prometheus text format
        </span>
        <span>{err ? 'unreachable' : at ? `fetched ${new Date(at).toLocaleTimeString('en-GB')}` : 'loading…'}</span>
      </div>
      <pre className="scrape-body" data-lenis-prevent>
        {err && <span className="rose">The API is not reachable — nothing to scrape.</span>}
        {!err &&
          lines?.map((l, i) => {
            const m = l.match(/^([a-z_:]+)(\{[^}]*\})?\s+(.+)$/)
            return (
              <motion.span key={l.split(' ')[0] + i} className="sl-line" initial={false} animate={{ opacity: 1 }}>
                {m ? (
                  <>
                    <span className="m-name">{m[1]}</span>
                    {m[2] && <span className="m-lbl">{m[2]}</span>} <span className="m-val">{m[3]}</span>
                  </>
                ) : (
                  l
                )}
                {'\n'}
              </motion.span>
            )
          })}
      </pre>
    </div>
  )
}
