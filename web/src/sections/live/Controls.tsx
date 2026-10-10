import { AnimatePresence, motion } from 'motion/react'
import { useRef, useState } from 'react'
import { api, newIdempotencyKey, type ApiResult } from '../../lib/api'
import { ms } from '../../lib/format'
import type { SimState } from '../../lib/types'
import { skuName } from './Panels'

export interface Call {
  at: number
  method: string
  path: string
  label: string
  result: ApiResult<unknown>
}

type Report = (c: Call) => void

async function call(report: Report, label: string, path: string, body?: unknown, headers?: Record<string, string>) {
  const result = await api<unknown>(path, { body, headers })
  report({ at: Date.now(), method: body === undefined ? 'GET' : 'POST', path, label, result })
  return result
}

export const chaos = (report: Report, action: string, label: string, count?: number) =>
  call(report, label, '/api/sim/chaos', count ? { action, count } : { action })

/* ───────────── Order form ───────────── */
export function OrderForm({ sim, report }: { sim: SimState; report: Report }) {
  const [sku, setSku] = useState(sim.products[2]?.sku ?? sim.products[0]?.sku ?? '')
  const [customer, setCustomer] = useState<string>('')
  const [qty, setQty] = useState(1)
  const [key, setKey] = useState(newIdempotencyKey)
  const [busy, setBusy] = useState(false)
  const last = useRef<{ sku: string; qty: number; customer_id: string | null; key: string } | null>(null)

  const submit = async (body: { sku: string; qty: number; customer_id: string | null }, k: string, label: string) => {
    setBusy(true)
    last.current = { ...body, key: k }
    await call(report, label, '/api/sim/orders', { ...body, idempotency_key: null }, { 'Idempotency-Key': k })
    setBusy(false)
  }

  const place = async () => {
    const custId = customer || sim.customers[Math.floor(Math.random() * sim.customers.length)]?.id || null
    await submit({ sku, qty, customer_id: custId }, key, 'Place order')
    setKey(newIdempotencyKey())
  }
  const replay = () => last.current && submit({ sku: last.current.sku, qty: last.current.qty, customer_id: last.current.customer_id }, last.current.key, 'Retry · same key')
  const misuse = () =>
    last.current && submit({ sku: last.current.sku, qty: Math.min(20, last.current.qty + 1), customer_id: last.current.customer_id }, last.current.key, 'Same key · different body')

  const stock = sim.products.find((p) => p.sku === sku)?.stock ?? 0

  return (
    <div className="ctl ctl-order">
      <div className="ctl-title mono">
        <span>POST /api/sim/orders</span>
        <span className="faint">one transaction</span>
      </div>
      <div className="field-row">
        <label className="field">
          <span>product</span>
          <select value={sku} onChange={(e) => setSku(e.target.value)}>
            {sim.products.map((p) => (
              <option key={p.sku} value={p.sku}>
                {skuName(p.sku, p.name)} · {p.stock} left
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>customer</span>
          <select value={customer} onChange={(e) => setCustomer(e.target.value)}>
            <option value="">random</option>
            {sim.customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.tier}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="field-row">
        <div className="field">
          <span>qty {qty > stock && <em className="rose">&gt; stock → expect 409</em>}</span>
          <div className="stepper">
            <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease quantity">
              −
            </button>
            <input
              type="range"
              min={1}
              max={20}
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              aria-label="Quantity"
            />
            <button onClick={() => setQty((q) => Math.min(20, q + 1))} aria-label="Increase quantity">
              +
            </button>
            <b className="mono">{qty}</b>
          </div>
        </div>
        <label className="field">
          <span>
            Idempotency-Key{' '}
            <button className="link" onClick={() => setKey(newIdempotencyKey())}>
              ↻ new
            </button>
          </span>
          <input className="mono" value={key} onChange={(e) => setKey(e.target.value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64))} spellCheck={false} />
        </label>
      </div>
      <div className="ctl-actions">
        <button className="btn btn--primary btn--sm" onClick={place} disabled={busy || key.length < 8}>
          Place order <span className="arrow">→</span>
        </button>
        <button className="btn btn--sm" onClick={replay} disabled={busy || !last.current} title="Send the exact same request again with the same key">
          Retry same key
        </button>
        <button className="btn btn--sm btn--warn" onClick={misuse} disabled={busy || !last.current} title="Reuse the key with a different body">
          Reuse key, new body
        </button>
      </div>
    </div>
  )
}

/* ───────────── Chaos grid ───────────── */
const ACTIONS: { action: string; label: string; hint: string; tone: 'warn' | 'danger' | 'ok' | 'plain'; count?: number }[] = [
  { action: 'duplicate_next', label: 'Duplicate next delivery', hint: 'the broker delivers the next event twice', tone: 'warn' },
  { action: 'delay_next', label: 'Delay next delivery 6s', hint: 'later events overtake it; watermark waits', tone: 'warn' },
  { action: 'crash_consumer', label: 'Crash consumer', hint: 'deliveries pile up at the gate', tone: 'danger' },
  { action: 'restart_consumer', label: 'Restart consumer', hint: 'resume from the stored token', tone: 'ok' },
  { action: 'invalidate_resume_token', label: 'Expire resume token', hint: 'oplog rolled past it → code 286', tone: 'danger' },
  { action: 'drop_readmodel_doc', label: 'Corrupt a read model', hint: 'delete or damage one Mongo view', tone: 'danger' },
  { action: 'reconcile', label: 'Reconcile from PG', hint: 'compare views with the ledger, repair', tone: 'ok' },
  { action: 'burst', label: 'Burst ×20 orders', hint: 'same code path, 20 times', tone: 'plain', count: 20 },
]

export function ChaosGrid({ report }: { report: Report }) {
  const [pending, setPending] = useState<string | null>(null)
  const run = async (a: (typeof ACTIONS)[number]) => {
    setPending(a.action)
    await chaos(report, a.action, a.label, a.count)
    setPending(null)
  }
  return (
    <div className="ctl ctl-chaos">
      <div className="ctl-title mono">
        <span>POST /api/sim/chaos</span>
        <span className="faint">failure injection</span>
      </div>
      <div className="chaos-grid">
        {ACTIONS.map((a) => (
          <button key={a.action} className={`chaos-btn chaos-btn--${a.tone}`} onClick={() => run(a)} disabled={pending === a.action}>
            <b>{a.label}</b>
            <span>{a.hint}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/* ───────────── Traffic ───────────── */
export function Traffic({ sim, report }: { sim: SimState; report: Report }) {
  const [rate, setRate] = useState(sim.traffic.orders_per_min)
  const t = useRef<number | undefined>(undefined)
  const send = (enabled: boolean, r: number) => call(report, enabled ? `Traffic ${r}/min` : 'Traffic off', '/api/sim/traffic', { enabled, orders_per_min: r })
  return (
    <div className="traffic">
      <button className={`switch ${sim.traffic.enabled ? 'on' : ''}`} onClick={() => send(!sim.traffic.enabled, rate)} aria-pressed={sim.traffic.enabled}>
        <i />
        <span className="mono">ambient traffic</span>
      </button>
      <input
        type="range"
        min={0}
        max={120}
        step={6}
        value={rate}
        aria-label="Orders per minute"
        onChange={(e) => {
          const v = Number(e.target.value)
          setRate(v)
          window.clearTimeout(t.current)
          t.current = window.setTimeout(() => send(true, v), 300)
        }}
      />
      <span className="mono dim">{rate}/min</span>
    </div>
  )
}

/* ───────────── Response inspector ───────────── */
export function Inspector({ last }: { last: Call | null }) {
  return (
    <div className="ctl ctl-inspect">
      <div className="ctl-title mono">
        <span>last response</span>
        <span className="faint">round trip measured in your browser</span>
      </div>
      <AnimatePresence mode="wait">
        {last ? (
          <motion.div key={last.at} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="insp">
            <div className="insp-line mono">
              <span className={`status status--${String(last.result.status)[0] || '0'}`}>{last.result.status || 'ERR'}</span>
              <span>
                {last.method} {last.path}
              </span>
              <span className="faint">{ms(last.result.ms)}</span>
            </div>
            <div className="insp-meta mono faint">
              {last.label} · X-Request-ID {last.result.requestId ? last.result.requestId.slice(0, 12) : '—'}
            </div>
            <pre className="insp-body" data-lenis-prevent>
              {JSON.stringify(last.result.ok ? summarize(last.result.data) : { error: last.result.error }, null, 2)}
            </pre>
          </motion.div>
        ) : (
          <motion.div key="none" className="insp-empty mono faint" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            Place an order or inject a failure — the raw response lands here.
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function summarize(data: unknown) {
  if (data && typeof data === 'object' && 'order' in data) {
    const d = data as { order: Record<string, unknown>; replayed: boolean; outbox_event_id: string }
    const o = d.order
    return { replayed: d.replayed, outbox_event_id: d.outbox_event_id, order: { id: o.id, sku: o.sku, qty: o.qty, total_cents: o.total_cents, idempotency_key: o.idempotency_key, position: o.position } }
  }
  return data
}
