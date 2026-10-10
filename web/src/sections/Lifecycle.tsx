import { motion, useInView } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Code } from '../components/Code'
import { SectionHead } from '../components/SectionHead'
import { FadeUp } from '../components/SplitReveal'
import { Tag } from '../components/Tag'
import '../styles/lifecycle.css'

const TIERS = [
  { k: 'hot', t: 'Hot', age: '0 – 18 months', where: 'PostgreSQL monthly partitions on fast disk', how: 'Indexed, joined, transactional. Partition pruning keeps queries on recent months.', c: 'var(--rose)' },
  { k: 'warm', t: 'Warm', age: '18 months – 3 years', where: 'Detached partitions · cheaper tablespace', how: 'Still SQL-queryable, fewer indexes, no writes. Moved with DETACH PARTITION — a metadata change, not a copy.', c: 'var(--amber)' },
  { k: 'cold', t: 'Cold', age: '3 – 7 years', where: 'Parquet files in object storage, SHA-256 per file', how: 'Columnar and compressed. Restorable into a staging table, then validated and re-attached.', c: 'var(--sky)' },
  { k: 'gone', t: 'Purge', age: 'only by explicit policy', where: 'Batched deletes, audited, dry-run first', how: 'Never because data is merely old. Business-critical classes and legal holds are refused by the job itself.', c: 'var(--fg-3)' },
]

const POLICY = [
  { cls: 'orders · order_items', hot: '18 mo', warm: '3 y', cold: '7 y', purge: 'never automatic', crit: true },
  { cls: 'payments (simulated)', hot: '18 mo', warm: '3 y', cold: '7 y', purge: 'never automatic', crit: true },
  { cls: 'inventory_movements', hot: '12 mo', warm: '3 y', cold: '7 y', purge: 'after 7 y, approved', crit: false },
  { cls: 'audit_log', hot: '90 d', warm: '—', cold: '7 y', purge: 'never early', crit: true },
  { cls: 'outbox (published)', hot: '7 d', warm: '—', cold: 'export', purge: 'after export verified', crit: false },
  { cls: 'mongo processed_events', hot: '30 d', warm: '—', cold: '—', purge: 'TTL index below watermark', crit: false },
  { cls: 'operational events', hot: '30 d', warm: '—', cold: '1 y', purge: 'after 1 y', crit: false },
]

const DRY = `PS> python -m datasphere.lifecycle run --policy retention.yml --dry-run
policy   outbox: purge rows published more than 7 days ago
guard    business_critical = false  ✓   legal_hold = false  ✓
scan     count eligible rows per partition  → plan.json
plan     1) export to Parquet + sha256   2) DELETE in 5 000-row batches
dry-run  0 rows deleted · plan.json + audit_log entry recorded

PS> python -m datasphere.lifecycle run --policy retention.yml --class orders
refused  orders is business-critical: no purge rule exists, nothing done`

export function Lifecycle() {
  return (
    <section id="lifecycle" className="section lifecycle">
      <div className="wrap">
        <SectionHead
          idx="07"
          kicker="Data lifecycle & tiering"
          title={[['Old data is not'], [['deleted data.', 'serif']]]}
          lede="Every data class has an explicit retention policy. Rows move from hot partitions to warm tablespaces to cold Parquet — each move repeatable, idempotent, audited and dry-run first. Purging is the exception, and the job refuses business-critical records outright."
          aside={<span style={{ marginLeft: 'auto' }}><Tag kind="illustrative">Policy design</Tag></span>}
        />

        <div className="lc-grid">
          <Tower />
          <div className="lc-right">
            <FadeUp className="policy panel">
              <div className="panel-head">
                <span className="title">retention.yml · per data class</span>
                <span>dry-run by default</span>
              </div>
              <div className="policy-scroll" data-lenis-prevent>
                <table>
                  <thead>
                    <tr>
                      <th>class</th>
                      <th>hot</th>
                      <th>warm</th>
                      <th>cold</th>
                      <th>purge</th>
                    </tr>
                  </thead>
                  <tbody>
                    {POLICY.map((p, i) => (
                      <motion.tr key={p.cls} initial={{ opacity: 0, x: -10 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.06 }}>
                        <td>
                          {p.cls} {p.crit && <span className="crit mono">critical</span>}
                        </td>
                        <td>{p.hot}</td>
                        <td>{p.warm}</td>
                        <td>{p.cold}</td>
                        <td className={p.crit ? 'never' : ''}>{p.purge}</td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </FadeUp>
            <FadeUp delay={0.1}>
              <Typed text={DRY} />
            </FadeUp>
          </div>
        </div>

        <div className="lc-cards">
          {[
            { t: 'Logical tiering', d: 'Same engine, different structure: partitions, fewer indexes, read-only views. Moving is a metadata operation and every row stays one SQL query away.' },
            { t: 'Physical tiering', d: 'Different media or systems: cheaper tablespaces, object storage, columnar files. Cheaper per GB, but moving costs I/O and reading back means a restore.' },
            { t: 'Restoring the archive', d: 'Parquet → staging table → verify checksums and row counts → ATTACH PARTITION or INSERT … SELECT. Rehearsed, timed and written into the recovery report.' },
          ].map((c, i) => (
            <motion.div key={c.t} className="lc-card" initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.12, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
              <span className="mono">0{i + 1}</span>
              <h4>{c.t}</h4>
              <p>{c.d}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Tower() {
  return (
    <FadeUp className="tower">
      <div className="tower-particles" aria-hidden>
        {Array.from({ length: 26 }, (_, i) => (
          <i key={i} style={{ left: `${8 + ((i * 37) % 84)}%`, animationDelay: `${(i * 0.53) % 9}s`, animationDuration: `${8 + (i % 5)}s` }} />
        ))}
      </div>
      {TIERS.map((t, i) => (
        <motion.div
          key={t.k}
          className={`tier tier--${t.k}`}
          style={{ ['--c' as string]: t.c }}
          initial={{ opacity: 0, x: -30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: '-10% 0px' }}
          transition={{ delay: i * 0.15, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="tier-head">
            <b>{t.t}</b>
            <span className="mono">{t.age}</span>
          </div>
          <p className="tier-where">{t.where}</p>
          <p className="tier-how">{t.how}</p>
        </motion.div>
      ))}
    </FadeUp>
  )
}

function Typed({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-15% 0px' })
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!inView) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setN(text.length)
      return
    }
    const t = setInterval(() => setN((x) => (x >= text.length ? (clearInterval(t), x) : x + 3)), 16)
    return () => clearInterval(t)
  }, [inView, text])
  return (
    <div className="term panel band-ink" ref={ref}>
      <div className="term-bar">
        <span className="mono">powershell · retention job</span>
        <Tag kind="illustrative">Example output</Tag>
      </div>
      <div className="term-body">
        <Code code={text.slice(0, n)} lang="ps" tail={<span className="caret" />} />
      </div>
    </div>
  )
}
