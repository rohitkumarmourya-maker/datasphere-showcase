import { AnimatePresence, motion } from 'motion/react'
import { Counter } from '../../components/Counter'
import { ago, clock, money, num, short } from '../../lib/format'
import type { SimState } from '../../lib/types'

const SHORT_NAME: Record<string, string> = {
  'SKU-AURORA-LAMP': 'Aurora lamp',
  'SKU-NIMBUS-CHAIR': 'Nimbus chair',
  'SKU-ORBIT-DESK': 'Orbit desk',
  'SKU-PULSE-EARBUDS': 'Pulse earbuds',
  'SKU-QUARTZ-KETTLE': 'Quartz kettle',
  'SKU-VELA-BACKPACK': 'Vela backpack',
}
export const skuName = (sku: string, fallback?: string) => SHORT_NAME[sku] ?? fallback ?? sku

export function PgPanel({ sim }: { sim: SimState }) {
  const maxStock = Math.max(60, ...sim.products.map((p) => p.stock))
  return (
    <div className="panel lp lp--pg">
      <div className="panel-head">
        <span className="title">
          <span className="engine-glyph" style={{ ['--c' as string]: 'var(--pg)' }}>
            PG
          </span>
          PostgreSQL · ledger
        </span>
        <span className="chip">
          orders <Counter value={sim.postgres.orders_total} />
        </span>
      </div>
      <div className="lp-body">
        <div className="lp-sub mono">inventory · on_hand ≥ 0 enforced</div>
        <ul className="inv">
          {sim.products.map((p) => (
            <li key={p.sku} className={p.stock < 6 ? 'low' : ''}>
              <span className="inv-name">{skuName(p.sku, p.name)}</span>
              <span className="inv-bar">
                <motion.i animate={{ width: `${(p.stock / maxStock) * 100}%` }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
              </span>
              <span className="inv-n mono">{p.stock}</span>
            </li>
          ))}
        </ul>
        <div className="lp-sub mono">
          outbox · <b className="amber">{sim.postgres.outbox.pending} pending</b> · {num(sim.postgres.outbox.published_total)} published
        </div>
        <ul className="rows">
          <AnimatePresence initial={false}>
            {sim.postgres.outbox.rows.slice(0, 5).map((r) => (
              <motion.li
                key={r.event_id}
                layout
                initial={{ opacity: 0, x: -14, backgroundColor: 'rgba(124,255,196,0.18)' }}
                animate={{ opacity: 1, x: 0, backgroundColor: 'rgba(124,255,196,0)' }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
              >
                <span className="mono faint">#{r.position}</span>
                <span className="mono">{short(r.event_id)}</span>
                <span className={`st st--${r.status}`}>{r.status}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
        <div className="lp-sub mono">latest orders</div>
        <ul className="rows">
          <AnimatePresence initial={false}>
            {sim.postgres.orders.slice(0, 4).map((o) => (
              <motion.li key={o.id} layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <span className="mono">{short(o.id)}</span>
                <span className="ellip">
                  {o.customer_name.split(' ')[0]} · {o.qty}× {skuName(o.sku, o.product_name)}
                </span>
                <span className="mono">{money(o.total_cents)}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </div>
    </div>
  )
}

export function ConsumerCard({ sim }: { sim: SimState }) {
  const c = sim.consumer
  return (
    <div className={`consumer consumer--${c.status}`}>
      <div className="consumer-status">
        <span className="dot" />
        <b>{c.status}</b>
        <span className="faint mono">consumer</span>
      </div>
      <div className="consumer-grid mono">
        <div>
          <span>resume token</span>
          <b className={c.resume_token && !c.resume_token.valid ? 'rose' : ''}>
            {c.resume_token ? `pos ${c.resume_token.position}${c.resume_token.valid ? '' : ' · invalid'}` : '—'}
          </b>
        </div>
        <div>
          <span>applied</span>
          <b>
            <Counter value={c.processed_total} />
          </b>
        </div>
        <div>
          <span>dupes ignored</span>
          <b className="amber">
            <Counter value={c.duplicates_ignored} />
          </b>
        </div>
        <div>
          <span>in flight</span>
          <b>
            {sim.broker.in_flight}
            {sim.broker.delayed ? <em className="sky"> · {sim.broker.delayed} delayed</em> : null}
          </b>
        </div>
      </div>
      <AnimatePresence>
        {c.last_error && c.status !== 'running' && (
          <motion.div className="consumer-err mono" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            {c.last_error}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function MongoPanel({ sim, offset }: { sim: SimState; offset: number }) {
  const top = sim.mongo.customer_stats.slice(0, 5)
  const maxLife = Math.max(1, ...top.map((s) => s.lifetime_cents))
  return (
    <div className="panel lp lp--mg">
      <div className="panel-head">
        <span className="title">
          <span className="engine-glyph" style={{ ['--c' as string]: 'var(--mg)' }}>
            MG
          </span>
          MongoDB · projections
        </span>
        <span className="chip">
          views <Counter value={sim.mongo.order_views_total} />
        </span>
      </div>
      <div className="lp-body">
        <div className="lp-sub mono">order_views · newest</div>
        <div className="docs">
          <AnimatePresence initial={false} mode="popLayout">
            {sim.mongo.order_views.slice(0, 3).map((v) => (
              <motion.pre
                key={v._id + v.version + v.projected_at}
                className={`doc ${v.projected_by === 'reconciler' ? 'doc--heal' : ''}`}
                layout
                initial={{ opacity: 0, rotateX: -70, y: -10 }}
                animate={{ opacity: 1, rotateX: 0, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
              >
                <span className="faint">{'{ '}</span>
                <span className="k">_id</span>: <span className="s">"{short(v._id)}"</span>, <span className="k">total</span>: <span className="n">{money(v.total_cents)}</span>
                {'\n  '}
                <span className="k">customer</span>: <span className="s">"{v.customer.name}"</span> <span className="faint">({v.customer.tier})</span>
                {'\n  '}
                <span className="k">items</span>: [{v.items.map((i) => `${i.qty}× ${skuName(i.sku, i.name)}`).join(', ')}]
                {'\n  '}
                <span className="k">by</span>: <span className={v.projected_by === 'reconciler' ? 'sky' : 's'}>"{v.projected_by}"</span> · {ago(v.projected_at, offset)}
                <span className="faint">{' }'}</span>
              </motion.pre>
            ))}
          </AnimatePresence>
          {sim.mongo.order_views.length === 0 && <div className="empty mono">no projected views yet</div>}
        </div>
        <div className="lp-sub mono">customer_stats · lifetime value</div>
        <ul className="lb">
          {top.map((s) => (
            <li key={s._id}>
              <span className="ellip">{s.name}</span>
              <span className="lb-bar">
                <motion.i animate={{ width: `${(s.lifetime_cents / maxLife) * 100}%` }} transition={{ type: 'spring', stiffness: 100, damping: 20 }} />
              </span>
              <span className="mono">{money(s.lifetime_cents)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function ConsistencyBadge({ sim }: { sim: SimState }) {
  const c = sim.consistency
  return (
    <div className={`cbadge cbadge--${c.status}`}>
      <div className="cbadge-main">
        <span className="dot" />
        <motion.b key={c.status} initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          {c.status}
        </motion.b>
      </div>
      <div className="cbadge-meta mono">
        <span>
          pg <b>{num(c.pg_orders)}</b>
        </span>
        <span>
          mongo <b>{num(c.mongo_views)}</b>
        </span>
        <span>
          lag <b>{c.lag_events}</b>
        </span>
        <span>
          missing <b className={c.missing_in_mongo ? 'rose' : ''}>{c.missing_in_mongo}</b>
        </span>
        <span>
          stale <b className={c.stale_in_mongo ? 'rose' : ''}>{c.stale_in_mongo}</b>
        </span>
        <span className="hide-sm">reconciled {c.last_reconciled_at ? clock(c.last_reconciled_at) : 'never'}</span>
      </div>
    </div>
  )
}
