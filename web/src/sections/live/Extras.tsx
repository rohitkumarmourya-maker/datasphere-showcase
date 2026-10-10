import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { clock } from '../../lib/format'
import { getSnapshot, useEventLog } from '../../lib/live'
import type { SimEvent } from '../../lib/types'
import { chaos, type Call } from './Controls'

/* ───────────── Guided scenarios ───────────── */
type Step = { label: string; run?: (report: (c: Call) => void) => Promise<unknown>; wait?: number }
interface Scenario {
  id: string
  title: string
  watch: string
  steps: Step[]
}

const order = async (report: (c: Call) => void) => {
  const sim = getSnapshot().sim
  const p = sim?.products.filter((x) => x.stock > 2) ?? []
  const sku = p[Math.floor(Math.random() * p.length)]?.sku ?? 'SKU-ORBIT-DESK'
  const result = await api('/api/sim/orders', { body: { sku, qty: 1, customer_id: null, idempotency_key: null } })
  report({ at: Date.now(), method: 'POST', path: '/api/sim/orders', label: 'Scenario order', result })
}

const SCENARIOS: Scenario[] = [
  {
    id: 'dup',
    title: 'Duplicate delivery',
    watch: 'Two packets for one event. The second hits the gate as an amber ✕ — “dupes ignored” ticks up, the read model does not change.',
    steps: [{ label: 'arm duplicate', run: (r) => chaos(r, 'duplicate_next', 'Duplicate next') }, { label: 'place order', run: order }, { label: 'observe', wait: 2600 }],
  },
  {
    id: 'crash',
    title: 'Crash & resume',
    watch: 'Packets pile up at a red gate, consistency turns diverged. On restart the consumer resumes from its token and drains the queue.',
    steps: [
      { label: 'crash consumer', run: (r) => chaos(r, 'crash_consumer', 'Crash consumer') },
      { label: 'burst ×10', run: (r) => chaos(r, 'burst', 'Burst ×10', 10) },
      { label: 'let it pile up', wait: 3500 },
      { label: 'restart', run: (r) => chaos(r, 'restart_consumer', 'Restart consumer') },
      { label: 'observe', wait: 2500 },
    ],
  },
  {
    id: 'token',
    title: 'Resume token lost',
    watch: 'The token falls off the oplog: ChangeStreamHistoryLost (286). Restarting cannot resume, so the consumer resyncs from PostgreSQL — views marked “reconciler”.',
    steps: [
      { label: 'expire token', run: (r) => chaos(r, 'invalidate_resume_token', 'Expire token') },
      { label: 'burst ×5', run: (r) => chaos(r, 'burst', 'Burst ×5', 5) },
      { label: 'wait', wait: 2500 },
      { label: 'restart → resync', run: (r) => chaos(r, 'restart_consumer', 'Restart consumer') },
      { label: 'observe', wait: 2500 },
    ],
  },
  {
    id: 'drift',
    title: 'Silent drift',
    watch: 'A read-model document is damaged with no event to fix it. Consistency flips to diverged until reconciliation re-projects it from the ledger.',
    steps: [
      { label: 'corrupt a view', run: (r) => chaos(r, 'drop_readmodel_doc', 'Corrupt read model') },
      { label: 'notice', wait: 2600 },
      { label: 'reconcile', run: (r) => chaos(r, 'reconcile', 'Reconcile') },
      { label: 'observe', wait: 2000 },
    ],
  },
  {
    id: 'order',
    title: 'Out-of-order',
    watch: 'One delivery is held for 6 s while later ones land. The resume token stays at the gap until the straggler is applied.',
    steps: [
      { label: 'delay next', run: (r) => chaos(r, 'delay_next', 'Delay next') },
      { label: 'burst ×4', run: (r) => chaos(r, 'burst', 'Burst ×4', 4) },
      { label: 'observe', wait: 7000 },
    ],
  },
]

export function Scenarios({ report, disabled }: { report: (c: Call) => void; disabled: boolean }) {
  const [running, setRunning] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const [selected, setSelected] = useState(SCENARIOS[0].id)
  const sc = SCENARIOS.find((s) => s.id === selected)!

  const run = async (s: Scenario) => {
    setSelected(s.id)
    setRunning(s.id)
    for (let i = 0; i < s.steps.length; i++) {
      setStep(i)
      const st = s.steps[i]
      if (st.run) await st.run(report)
      await new Promise((r) => setTimeout(r, st.wait ?? 700))
    }
    setStep(s.steps.length)
    setRunning(null)
  }

  return (
    <div className="scen">
      <div className="scen-tabs">
        {SCENARIOS.map((s, i) => (
          <button key={s.id} className={`scen-tab ${selected === s.id ? 'on' : ''}`} onClick={() => !running && setSelected(s.id)}>
            <span className="mono faint">0{i + 1}</span> {s.title}
          </button>
        ))}
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={sc.id} className="scen-body" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3 }}>
          <p className="scen-watch">
            <span className="mono">watch for</span> {sc.watch}
          </p>
          <div className="scen-steps">
            {sc.steps.map((st, i) => (
              <span key={i} className={`scen-step ${running === sc.id && i === step ? 'act' : ''} ${(running === sc.id && i < step) || (!running && step >= sc.steps.length && selected === sc.id) ? 'done' : ''}`}>
                {st.label}
              </span>
            ))}
          </div>
          <button className="btn btn--primary btn--sm" disabled={!!running || disabled} onClick={() => run(sc)}>
            {running === sc.id ? 'running…' : 'Run scenario'} <span className="arrow">→</span>
          </button>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/* ───────────── Event log ───────────── */
const FAMILIES = [
  { id: 'all', label: 'all' },
  { id: 'order', label: 'orders' },
  { id: 'flow', label: 'outbox / delivery' },
  { id: 'consumer', label: 'consumer' },
  { id: 'ha', label: 'ha' },
] as const

function family(t: string) {
  if (t.startsWith('order.') || t.startsWith('inventory.')) return 'order'
  if (t.startsWith('outbox.') || t.startsWith('event.')) return 'flow'
  if (t.startsWith('ha.')) return 'ha'
  return 'consumer'
}

function tone(t: string) {
  if (t === 'order.rejected' || t === 'consumer.crashed' || t === 'resume_token.invalid' || t === 'readmodel.dropped' || t === 'ha.primary_down' || t === 'ha.split_brain_prevented') return 'rose'
  if (t === 'event.duplicate_ignored' || t === 'order.replayed' || t.startsWith('ha.rewind')) return 'amber'
  if (t.startsWith('reconcile') || t.startsWith('resync') || t === 'consumer.restarted' || t === 'ha.promoted' || t === 'ha.rejoined') return 'sky'
  if (t === 'outbox.published' || t === 'event.delivered') return 'dim'
  return 'mint'
}

function describe(ev: SimEvent): string {
  const d = ev.data as Record<string, string | number | undefined>
  switch (ev.type) {
    case 'order.committed':
      return `${d.order_id} · ${d.qty ?? ''}× ${d.sku ?? ''} · outbox ${d.event_id ?? ''}`
    case 'order.replayed':
      return `${d.order_id} returned again — no new writes`
    case 'order.rejected':
      return `${d.code ?? 'rejected'} · ${d.qty ?? ''}× ${d.sku ?? ''} · nothing written`
    case 'outbox.published':
      return `#${d.position} ${d.event_id}${d.kind && d.kind !== 'normal' ? ' · ' + d.kind : ''}`
    case 'event.delivered':
      return `#${d.position} → consumer · ${d.kind}`
    case 'event.duplicate_ignored':
      return `#${d.position} already applied · skipped (${d.kind})`
    case 'readmodel.upserted':
      return `order_views/${d.order_id} by ${d.projected_by}`
    case 'consumer.crashed':
      return String(d.last_error ?? 'consumer stopped')
    case 'consumer.restarted':
      return `resumed after position ${d.position}`
    case 'resume_token.invalid':
      return String(d.message ?? 'resume token unusable')
    case 'resync.completed':
    case 'reconcile.completed':
      return `scanned ${d.scanned ?? '?'} · repaired ${d.repaired ?? '?'} · ${d.duration_ms ?? '?'} ms`
    case 'reconcile.started':
      return `scanning ${d.scanned ?? ''} ledger orders`
    case 'readmodel.dropped':
      return `order_views/${d.order_id} damaged`
    case 'inventory.restocked':
      return `+${d.qty} ${d.sku} (receipt)`
    case 'traffic.changed':
      return `${d.enabled ? 'on' : 'off'} · ${d.orders_per_min}/min`
    default: {
      const s = JSON.stringify(ev.data)
      return s.length > 96 ? s.slice(0, 96) + '…' : s
    }
  }
}

export function EventLog() {
  const log = useEventLog()
  const [fam, setFam] = useState<(typeof FAMILIES)[number]['id']>('all')
  const rows = useMemo(() => (fam === 'all' ? log : log.filter((e) => family(e.type) === fam)).slice(0, 40), [log, fam])
  return (
    <div className="panel elog">
      <div className="panel-head">
        <span className="title">
          <span className="dot" />
          event stream · /api/sim/stream
        </span>
        <div className="elog-filters">
          {FAMILIES.map((f) => (
            <button key={f.id} className={fam === f.id ? 'on' : ''} onClick={() => setFam(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <ol className="elog-list mono" data-lenis-prevent aria-live="off">
        {rows.length === 0 && <li className="faint">waiting for events…</li>}
        {rows.map((e) => (
          <li key={e.seq} className={`t-${tone(e.type)}`}>
            <span className="faint">{clock(e.ts)}</span>
            <b>{e.type}</b>
            <span className="elog-msg">{describe(e)}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
