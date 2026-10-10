import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { SectionHead } from '../components/SectionHead'
import { FadeUp } from '../components/SplitReveal'
import { Tag } from '../components/Tag'
import { api, type ApiResult } from '../lib/api'
import { bytes, clock, num } from '../lib/format'
import { getClockOffset, reconnectLive, useConn, useHA } from '../lib/live'
import type { HANode, HAState } from '../lib/types'
import '../styles/resilience.css'

const lsn = (n: number) => {
  const hi = Math.floor(n / 2 ** 32)
  const lo = n % 2 ** 32
  return `${hi.toString(16).toUpperCase()}/${lo.toString(16).toUpperCase().padStart(8, '0')}`
}

type Action = 'kill_primary' | 'promote_standby' | 'rejoin_old_primary' | 'write_burst' | 'reset' | 'set_mode'

export function Resilience() {
  return (
    <section id="resilience" className="section resilience">
      <div className="wrap">
        <SectionHead
          idx="04"
          kicker="High availability & disaster recovery"
          title={[['Kill the primary.'], [['Count what you lost.', 'serif']]]}
          lede="Replication mode is a business decision written in bytes. Asynchronous standbys are fast and can lose acknowledged commits; synchronous ones lose nothing and pay for it on every commit. Fail it over, measure the gap, and bring the old primary back without split-brain."
        />
        <Failover />
        <RpoRto />
        <BackupPipeline />
        <HonestHA />
      </div>
    </section>
  )
}

function Failover() {
  const conn = useConn()
  const ha = useHA()
  const [err, setErr] = useState<ApiResult<unknown> | null>(null)
  const [busy, setBusy] = useState<Action | null>(null)

  const act = async (action: Action, mode?: 'sync' | 'async') => {
    setBusy(action)
    const r = await api<{ ok: boolean; message: string; state: HAState }>('/api/ha/action', { body: { action, mode: mode ?? null } })
    setBusy(null)
    setErr(r.ok ? null : r)
  }

  useEffect(() => {
    if (!err) return
    const t = setTimeout(() => setErr(null), 4200)
    return () => clearTimeout(t)
  }, [err])

  if (conn !== 'live' || !ha) {
    return (
      <div className="panel ha-offline">
        <Tag kind={conn === 'connecting' ? 'simulated' : 'offline'}>{conn === 'connecting' ? 'Connecting' : 'API offline'}</Tag>
        <p className="dim">The failover simulator streams from the showcase API. With the API down there is nothing honest to draw.</p>
        <button className="btn btn--xs" onClick={reconnectLive}>
          retry
        </button>
      </div>
    )
  }

  const primary = ha.nodes.find((n) => n.role === 'primary')
  const standby = ha.nodes.find((n) => n.role === 'standby')
  const down = ha.nodes.find((n) => n.role === 'down')
  const channel = primary && standby ? (ha.mode === 'sync' ? 'sync' : ha.lag_bytes > 4096 ? 'lagging' : 'async') : 'broken'

  return (
    <FadeUp>
      <div className="ha panel panel--ticks">
        <div className="ha-top">
          <div className="seg" role="radiogroup" aria-label="Replication mode">
            {(['async', 'sync'] as const).map((m) => (
              <button key={m} role="radio" aria-checked={ha.mode === m} className={ha.mode === m ? 'on' : ''} onClick={() => ha.mode !== m && act('set_mode', m)}>
                {ha.mode === m && <motion.span layoutId="seg-pill" className="seg-pill" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />}
                <span>{m === 'async' ? 'asynchronous' : 'synchronous'}</span>
              </button>
            ))}
          </div>
          <Tag kind="simulated">Simulated cluster</Tag>
        </div>

        <div className="ha-stage">
          <NodeCard node={ha.nodes[0]} ha={ha} />
          <div className={`channel channel--${channel}`}>
            <div className="channel-line">
              {Array.from({ length: 9 }, (_, i) => (
                <i key={i} style={{ animationDelay: `${i * -0.22}s` }} />
              ))}
            </div>
            <div className="channel-label mono">
              {channel === 'broken' ? (primary ? 'no standby attached' : 'no primary') : channel === 'sync' ? 'WAL · sync commit waits for flush' : 'WAL stream · async'}
            </div>
            <div className="channel-lag mono">
              <span>replay lag</span>
              <b className={ha.lag_bytes > 4096 ? 'amber' : ''}>{bytes(ha.lag_bytes)}</b>
              <span>{num(ha.lag_ms)} ms</span>
            </div>
          </div>
          <NodeCard node={ha.nodes[1]} ha={ha} />
        </div>

        <div className="ha-metrics mono">
          <div>
            <span>acknowledged txns</span>
            <b>{num(ha.committed_txns)}</b>
          </div>
          <div>
            <span>writes / s</span>
            <b>{ha.writes_per_sec.toFixed(1)}</b>
          </div>
          <div>
            <span>commit latency p50</span>
            <b>{ha.commit_latency_ms_p50.toFixed(1)} ms</b>
          </div>
          <div>
            <span>primary</span>
            <b>{ha.primary_id ?? 'none'}</b>
          </div>
        </div>

        <div className="ha-actions">
          <button className="btn btn--sm" onClick={() => act('write_burst')} disabled={!primary || busy !== null}>
            Write burst +400
          </button>
          <button className="btn btn--sm btn--danger" onClick={() => act('kill_primary')} disabled={!primary || busy !== null}>
            Kill primary
          </button>
          <button className="btn btn--sm btn--ok" onClick={() => act('promote_standby')} disabled={!!primary || !standby || busy !== null}>
            Promote standby
          </button>
          <button className="btn btn--sm btn--warn" onClick={() => act('rejoin_old_primary')} disabled={!down || !primary || busy !== null}>
            Bring old primary back
          </button>
          <button className="btn btn--xs" onClick={() => act('reset')} disabled={busy !== null}>
            reset
          </button>
        </div>
        <AnimatePresence>
          {err && (
            <motion.div className="ha-err mono" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {err.status} {err.error?.code} — {err.error?.message}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="ha-bottom">
          <Incident ha={ha} />
          <ol className="ha-log mono" data-lenis-prevent>
            {ha.events.slice(0, 7).map((e, i) => (
              <li key={e.ts + i} className={`lv-${e.level}`}>
                <span className="faint">{clock(e.ts)}</span>
                <span>{e.message}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </FadeUp>
  )
}

function NodeCard({ node, ha }: { node: HANode | undefined; ha: HAState }) {
  if (!node) return <div />
  const lag = node.role === 'standby' ? Math.max(0, (ha.nodes.find((n) => n.role === 'primary')?.lsn ?? node.lsn) - node.replay_lsn) : 0
  return (
    <motion.div className={`node node--${node.role}`} layout transition={{ type: 'spring', stiffness: 200, damping: 24 }}>
      <div className="node-orb">
        <svg viewBox="0 0 120 120" aria-hidden>
          <circle cx="60" cy="60" r="54" className="orb-track" />
          <circle cx="60" cy="60" r="54" className="orb-spin" />
          <circle cx="60" cy="60" r="38" className="orb-core" />
        </svg>
        <div className="node-id">
          <b>{node.id}</b>
          <span>TL {node.timeline}</span>
        </div>
      </div>
      <div className="node-role">{node.role}</div>
      <dl className="node-lsn mono">
        <div>
          <dt>{node.role === 'primary' ? 'write LSN' : node.role === 'standby' ? 'received LSN' : 'last LSN'}</dt>
          <dd>{lsn(node.lsn)}</dd>
        </div>
        <div>
          <dt>replay LSN</dt>
          <dd>{lsn(node.replay_lsn)}</dd>
        </div>
        {node.role === 'standby' && (
          <div>
            <dt>behind primary</dt>
            <dd className={lag > 4096 ? 'amber' : ''}>{bytes(lag)}</dd>
          </div>
        )}
      </dl>
    </motion.div>
  )
}

function Incident({ ha }: { ha: HAState }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!ha.incident) return
    const t = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(t)
  }, [ha.incident])
  if (ha.incident) {
    const el = (now + getClockOffset() - Date.parse(ha.incident.started_at)) / 1000
    return (
      <div className="incident incident--open">
        <span className="mono">outage in progress</span>
        <b>{Math.max(0, el).toFixed(1)} s</b>
        <p>
          {ha.incident.killed} is down. Writes are failing. RTO is running — promote the standby to stop the clock.
          {ha.mode === 'async' && ' In async mode, whatever the standby had not replayed is about to become RPO.'}
        </p>
      </div>
    )
  }
  if (ha.last_failover) {
    const f = ha.last_failover
    return (
      <div className="incident">
        <span className="mono">last failover · {f.mode} · {f.from} → {f.to}</span>
        <div className="incident-nums">
          <div>
            <em>RPO · lost</em>
            <b className={f.rpo_lost_txns > 0 ? 'rose' : 'mint'}>{num(f.rpo_lost_txns)} txns</b>
            <small>{bytes(f.rpo_lost_bytes)} of WAL</small>
          </div>
          <div>
            <em>RTO · down for</em>
            <b>{(f.rto_ms / 1000).toFixed(2)} s</b>
            <small>kill → promote, wall clock</small>
          </div>
        </div>
        <p className="faint">
          {f.rpo_lost_txns > 0
            ? 'Acknowledged commits that never reached the standby are gone. That is the price of async — make it a decision, not a surprise.'
            : 'Zero acknowledged commits lost: every commit waited for the standby flush before returning.'}
        </p>
      </div>
    )
  }
  return (
    <div className="incident">
      <span className="mono">no incident yet</span>
      <p className="dim">Kill the primary, wait a moment, then promote the standby. Try it in both modes and compare the RPO.</p>
    </div>
  )
}

function RpoRto() {
  const ha = useHA()
  const f = ha?.last_failover
  return (
    <FadeUp className="rr">
      <div className="matrix-head">
        <h3 className="sub-title">RPO &amp; RTO, defined against a clock</h3>
        <Tag kind="illustrative">Targets are design policy</Tag>
      </div>
      <div className="rr-grid panel">
        <div className="rr-timeline">
          <svg viewBox="0 0 800 150" aria-label="Timeline: last durable point, incident, service restored">
            <line x1="20" y1="80" x2="780" y2="80" className="rr-axis" />
            <motion.rect x="200" y="62" height="36" rx="6" className="rr-rpo" initial={{ width: 0 }} whileInView={{ width: 200 }} viewport={{ once: true }} transition={{ duration: 1, delay: 0.2 }} />
            <motion.rect x="400" y="62" height="36" rx="6" className="rr-rto" initial={{ width: 0 }} whileInView={{ width: 300 }} viewport={{ once: true }} transition={{ duration: 1.2, delay: 1 }} />
            <g transform="translate(200 80)">
              <circle r="7" className="rr-pt" />
              <text y="-34" textAnchor="middle">last durable point</text>
            </g>
            <g transform="translate(400 80)">
              <circle r="9" className="rr-pt rr-pt--x" />
              <text y="-34" textAnchor="middle">incident</text>
            </g>
            <g transform="translate(700 80)">
              <circle r="7" className="rr-pt rr-pt--ok" />
              <text y="-34" textAnchor="middle">service restored</text>
            </g>
            <text x="300" y="128" textAnchor="middle" className="rr-lbl rpo">
              RPO · data you lose
            </text>
            <text x="550" y="128" textAnchor="middle" className="rr-lbl rto">
              RTO · time you are down
            </text>
          </svg>
        </div>
        <div className="rr-table">
          <div className="rr-row rr-row--h mono">
            <span>data class</span>
            <span>target RPO</span>
            <span>target RTO</span>
            <span>mechanism</span>
          </div>
          <div className="rr-row">
            <span>Orders, payments (sim), stock</span>
            <span>0</span>
            <span>≤ 15 min</span>
            <span>sync standby + WAL archive + PITR</span>
          </div>
          <div className="rr-row">
            <span>Mongo read models</span>
            <span>rebuildable</span>
            <span>≤ 30 min</span>
            <span>replica set + resync from PostgreSQL</span>
          </div>
          <div className="rr-row">
            <span>Operational events</span>
            <span>≤ 5 min</span>
            <span>≤ 4 h</span>
            <span>replicated outbox + archive export</span>
          </div>
          <div className="rr-row rr-row--sim">
            <span>
              Last simulated failover <Tag kind="simulated" />
            </span>
            <span>{f ? `${num(f.rpo_lost_txns)} txns` : '—'}</span>
            <span>{f ? `${(f.rto_ms / 1000).toFixed(2)} s` : '—'}</span>
            <span>{f ? `${f.mode} · ${f.from} → ${f.to}` : 'run a failover above'}</span>
          </div>
        </div>
      </div>
    </FadeUp>
  )
}

const BACKUP_STEPS = [
  { k: 'backup', t: 'Take it', d: 'pg_basebackup + WAL archive (physical) and pg_dump -Fc (logical); mongodump --oplog for a consistent point.', cmd: 'pg_dump -Fc -d datasphere -f orders.dump' },
  { k: 'seal', t: 'Seal it', d: 'SHA-256 every artefact, record size, duration and source LSN / oplog timestamp in a manifest.', cmd: 'sha256sum orders.dump >> manifest.txt' },
  { k: 'restore', t: 'Restore it', d: 'Into a brand-new disposable container — never over the source. The restore is the test.', cmd: 'pg_restore -d restore_check orders.dump' },
  { k: 'verify', t: 'Prove it', d: 'Row counts per table, FK integrity, CHECK constraints, order totals = Σ items, outbox positions contiguous.', cmd: 'SELECT count(*) FROM orders;  -- vs manifest' },
  { k: 'report', t: 'Report it', d: 'Measured backup and restore durations, achieved RPO vs target, pass/fail per check — or it did not happen.', cmd: 'recovery-report-2026-10-10.json' },
]

function BackupPipeline() {
  return (
    <FadeUp className="bk">
      <div className="matrix-head">
        <h3 className="sub-title">A backup is a claim. A restore is evidence.</h3>
        <Tag kind="illustrative">Runbook</Tag>
      </div>
      <div className="bk-track">
        <div className="bk-rail">
          <motion.i initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true, margin: '-20% 0px' }} transition={{ duration: 2.2, ease: [0.65, 0, 0.35, 1] }} />
        </div>
        {BACKUP_STEPS.map((s, i) => (
          <motion.div
            key={s.k}
            className="bk-step panel"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-10% 0px' }}
            transition={{ duration: 0.7, delay: 0.25 + i * 0.35, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="bk-n mono">0{i + 1}</span>
            <h4>{s.t}</h4>
            <p>{s.d}</p>
            <code>{s.cmd}</code>
          </motion.div>
        ))}
      </div>
      <p className="bk-note">
        <b>“Exit code 0” ≠ recoverable.</b> DataSphere reports a backup as <span className="mint">verified</span> only after a restore into a clean environment passes its integrity checks; otherwise it is labelled <span className="amber">unverified</span> — never “successful”.
      </p>
    </FadeUp>
  )
}

function HonestHA() {
  return (
    <FadeUp className="honest">
      <div className="honest-card">
        <span className="mono">a note on honesty</span>
        <h3>Two containers on one laptop are not high availability.</h3>
        <p>
          They share a kernel, a disk, a power supply and you. The lab demonstrates the <em>mechanics</em> — streaming, promotion, timelines, fencing, pg_rewind, replica-set elections and driver reconnects. Production needs independent failure domains, a consensus-based failover manager (for example Patroni with etcd), fencing, lag alerting, and a rehearsed runbook.
        </p>
      </div>
      <div className="honest-card honest-card--mg">
        <span className="mono">MongoDB replica set · rs0</span>
        <h3>Elections, retryable writes, resumable streams.</h3>
        <p>
          Stepping the primary down triggers an election; drivers with retryable writes reconnect to the new primary. The change consumer survives the election by resuming from its stored token — and if that token has fallen off the oplog, it resynchronises from PostgreSQL rather than guessing.
        </p>
      </div>
    </FadeUp>
  )
}
