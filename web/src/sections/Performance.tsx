import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Counter } from '../components/Counter'
import { SectionHead } from '../components/SectionHead'
import { FadeUp } from '../components/SplitReveal'
import { Tag } from '../components/Tag'
import { api, type ApiResult } from '../lib/api'
import { bytes, ms, num, pct } from '../lib/format'
import type { BenchRun } from '../lib/types'
import '../styles/performance.css'

const METHOD = [
  { t: 'Baseline', d: 'Fixed dataset, fixed seed, warm-up excluded. Record machine, config and dataset size with the numbers.' },
  { t: 'Change one thing', d: 'An index, a query rewrite, a pool size — never two at once, or the result explains nothing.' },
  { t: 'Re-run identically', d: 'Same workload, same parameter sequence, same concurrency. Keep the raw samples, not just the average.' },
  { t: 'Compare tails', d: 'p50 for typical, p95/p99 for pain — p99 only when the sample is big enough to mean it. Plus throughput and error rate.' },
  { t: 'Explain the trade', d: 'Faster reads usually cost write amplification and storage. Write down both sides, or the optimisation is half-reported.' },
]

export function Performance() {
  const [rows, setRows] = useState(100000)
  const [repeats, setRepeats] = useState(30)
  const [run, setRun] = useState<BenchRun | null>(null)
  const [history, setHistory] = useState<BenchRun[]>([])
  const [state, setState] = useState<'idle' | 'running' | 'error'>('idle')
  const [err, setErr] = useState<ApiResult<BenchRun> | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const t0 = useRef(0)

  const loadHistory = async () => {
    const r = await api<{ runs: BenchRun[] }>('/api/lab/runs')
    if (r.ok && r.data) {
      setHistory(r.data.runs)
      setRun((cur) => cur ?? r.data!.runs[0] ?? null)
    }
  }
  useEffect(() => {
    loadHistory()
  }, [])

  useEffect(() => {
    if (state !== 'running') return
    const t = setInterval(() => setElapsed((performance.now() - t0.current) / 1000), 100)
    return () => clearInterval(t)
  }, [state])

  const go = async () => {
    setState('running')
    setErr(null)
    t0.current = performance.now()
    setElapsed(0)
    const r = await api<BenchRun>('/api/lab/index-bench', { body: { rows, repeats } })
    if (r.ok && r.data) {
      setRun(r.data)
      setState('idle')
      loadHistory()
    } else {
      setErr(r)
      setState('error')
    }
  }

  return (
    <section id="performance" className="section performance">
      <div className="wrap">
        <SectionHead
          idx="05"
          kicker="Performance engineering"
          title={[['Measure.'], ['Change one thing.'], [['Measure again.', 'serif']]]}
          lede="No number in this lab is typed by hand. Press run and the showcase server builds a synthetic orders table, times a real query hundreds of times, adds one composite index, and times it again — then tells you what the index cost."
        />

        <div className="perf-grid">
          <FadeUp className="method">
            <ol>
              {METHOD.map((m, i) => (
                <li key={m.t}>
                  <span className="mono">0{i + 1}</span>
                  <div>
                    <b>{m.t}</b>
                    <p>{m.d}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="warn-box">
              <span className="mono">careful</span>
              <p>
                <code>EXPLAIN ANALYZE</code> <em>executes</em> the statement. On an UPDATE or DELETE it really writes — wrap it in <code>BEGIN … ROLLBACK</code>, and never point it at production.
              </p>
            </div>
          </FadeUp>

          <FadeUp delay={0.1} className="bench panel panel--ticks">
            <div className="panel-head">
              <span className="title">
                <span className="dot" />
                POST /api/lab/index-bench
              </span>
              <Tag kind={run ? 'measured' : 'illustrative'}>{run ? 'Measured' : 'Not run yet'}</Tag>
            </div>
            <div className="bench-ctl">
              <div className="field">
                <span>rows</span>
                <div className="seg seg--sm">
                  {[20000, 100000, 300000].map((n) => (
                    <button key={n} className={rows === n ? 'on' : ''} onClick={() => setRows(n)} disabled={state === 'running'}>
                      {rows === n && <motion.span layoutId="rows-pill" className="seg-pill" />}
                      <span>{n / 1000}k</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span>repeats</span>
                <div className="seg seg--sm">
                  {[10, 30, 60].map((n) => (
                    <button key={n} className={repeats === n ? 'on' : ''} onClick={() => setRepeats(n)} disabled={state === 'running'}>
                      {repeats === n && <motion.span layoutId="rep-pill" className="seg-pill" />}
                      <span>{n}</span>
                    </button>
                  ))}
                </div>
              </div>
              <button className="btn btn--primary bench-run" onClick={go} disabled={state === 'running'}>
                {state === 'running' ? `running… ${elapsed.toFixed(1)} s` : 'Run on this machine'}
                {state !== 'running' && <span className="arrow">→</span>}
              </button>
            </div>
            {repeats < 20 && <div className="bench-hint mono">fewer than 20 repeats → the server will not report a p95 (too few samples to mean anything)</div>}

            <AnimatePresence mode="wait">
              {state === 'running' ? (
                <motion.div key="run" className="bench-running" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <div className="scanner" />
                  <ol className="mono">
                    <li>seed {num(rows)} synthetic orders (seed 42)</li>
                    <li>time the query × {repeats} without an index</li>
                    <li>CREATE INDEX idx_orders_customer_created</li>
                    <li>time the identical query sequence again</li>
                    <li>time a write batch with and without the index</li>
                  </ol>
                  <p className="faint mono">one request — the list is the order of work, not a progress bar</p>
                </motion.div>
              ) : state === 'error' && err ? (
                <motion.div key="err" className="bench-err" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <Tag kind="offline">{err.error?.code ?? 'Error'}</Tag>
                  <p>{err.error?.message}</p>
                  <p className="faint mono">no result shown — nothing was measured</p>
                </motion.div>
              ) : run ? (
                <motion.div key={run.run_id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <BenchResult run={run} />
                </motion.div>
              ) : (
                <motion.div key="empty" className="bench-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <div className="ghost-bars">
                    {Array.from({ length: 14 }, (_, i) => (
                      <i key={i} style={{ height: `${20 + ((i * 37) % 70)}%`, animationDelay: `${i * 0.08}s` }} />
                    ))}
                  </div>
                  <p>
                    No measurement yet. <span className="dim">We don’t ship numbers we didn’t take — press run.</span>
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </FadeUp>
        </div>

        {history.length > 1 && <History runs={history} onPick={setRun} current={run?.run_id} />}
        <LoadProfiles />
      </div>
    </section>
  )
}

function BenchResult({ run }: { run: BenchRun }) {
  const b = run.baseline.latency_ms
  const a = run.indexed.latency_ms
  const all = [...run.baseline.samples_ms, ...run.indexed.samples_ms].filter((x) => x > 0)
  const lo = Math.log10(Math.max(1e-4, Math.min(...all)) * 0.7)
  const hi = Math.log10(Math.max(...all) * 1.4)
  const xs = (v: number) => ((Math.log10(Math.max(v, 1e-4)) - lo) / (hi - lo)) * 100
  const ticks = [] as number[]
  for (let e = Math.floor(lo); e <= Math.ceil(hi); e++) ticks.push(10 ** e)

  return (
    <div className="bench-result">
      <div className="br-hero">
        <div>
          <span className="mono">p50 speed-up</span>
          <b>
            <Counter value={run.speedup_p50} format={(n) => (n >= 100 ? n.toFixed(0) : n.toFixed(1)) + '×'} duration={1.4} />
          </b>
        </div>
        <div>
          <span className="mono">p50 before → after</span>
          <b>
            {ms(b.p50)} <i>→</i> {ms(a.p50)}
          </b>
        </div>
        <div>
          <span className="mono">p95 before → after</span>
          <b>{b.p95 == null || a.p95 == null ? <em className="faint">n &lt; 20 · not reported</em> : <>{ms(b.p95)} <i>→</i> {ms(a.p95)}</>}</b>
        </div>
      </div>

      <div className="strip">
        <div className="strip-axis mono">
          {ticks.map((t) => (
            <span key={t} style={{ left: `${xs(t)}%` }}>
              {ms(t)}
            </span>
          ))}
        </div>
        {(
          [
            ['no index', run.baseline.samples_ms, 'var(--rose)', b],
            ['with index', run.indexed.samples_ms, 'var(--mint)', a],
          ] as const
        ).map(([label, samples, color, st]) => (
          <div className="strip-row" key={label} style={{ ['--c' as string]: color }}>
            <span className="mono">{label}</span>
            <div className="strip-track">
              {samples.map((v, i) => (
                <motion.i
                  key={i}
                  style={{ left: `${xs(v)}%`, top: `${20 + ((i * 53) % 60)}%` }}
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 0.85, scale: 1 }}
                  transition={{ delay: 0.2 + i * 0.012, duration: 0.3 }}
                />
              ))}
              <span className="strip-p50" style={{ left: `${xs(st.p50)}%` }} title={`p50 ${ms(st.p50)}`} />
            </div>
          </div>
        ))}
        <div className="strip-cap mono faint">each dot = one timed execution · log scale · line = p50</div>
      </div>

      <div className="plans">
        {(
          [
            ['before', run.baseline.plan],
            ['after', run.indexed.plan],
          ] as const
        ).map(([k, plan]) => (
          <div key={k} className="plan">
            <span className="mono">EXPLAIN QUERY PLAN · {k}</span>
            <ul className="mono">
              {plan.map((line, i) => (
                <li key={i} className={/SCAN/.test(line) ? 'scan' : /USING (COVERING )?INDEX/.test(line) ? 'idx' : /TEMP B-TREE/.test(line) ? 'temp' : ''} style={{ paddingLeft: 10 + i * 12 }}>
                  {i > 0 ? '└ ' : ''}
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="costs">
        <div>
          <span className="mono">index build</span>
          <b>{ms(run.index.build_ms)}</b>
        </div>
        <div>
          <span className="mono">storage overhead</span>
          <b className="amber">
            +{bytes(run.index.overhead_bytes)} <small>({pct(run.index.overhead_pct)})</small>
          </b>
        </div>
        <div>
          <span className="mono">write cost · {num(run.writes.batch_rows)} inserts</span>
          <b className={run.writes.overhead_pct > 0 ? 'amber' : ''}>
            {pct(run.writes.overhead_pct)} <small>{num(run.writes.no_index_rows_per_sec)} → {num(run.writes.with_index_rows_per_sec)} rows/s</small>
          </b>
        </div>
      </div>

      <div className="machine mono">
        <span>{run.engine} {run.sqlite_version}</span>
        <span>python {run.python_version}</span>
        <span>{run.platform}</span>
        <span>{run.cpu_count} cpu</span>
        <span>{num(run.rows)} rows × {run.repeats} repeats</span>
        <span>{run.run_id}</span>
        <span>{new Date(run.started_at).toLocaleString()}</span>
      </div>
      {run.notes.length > 0 && (
        <ul className="notes">
          {run.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function History({ runs, onPick, current }: { runs: BenchRun[]; onPick: (r: BenchRun) => void; current?: string }) {
  return (
    <FadeUp className="hist">
      <div className="matrix-head">
        <h3 className="sub-title">Run history</h3>
        <span className="mono faint">kept in server memory · click a row to inspect it</span>
      </div>
      <div className="matrix-scroll" data-lenis-prevent>
        <table className="hist-table mono">
          <thead>
            <tr>
              <th>run</th>
              <th>rows</th>
              <th>repeats</th>
              <th>p50 before</th>
              <th>p50 after</th>
              <th>speed-up</th>
              <th>build</th>
              <th>storage</th>
              <th>write cost</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.run_id} onClick={() => onPick(r)} className={r.run_id === current ? 'on' : ''}>
                <td>{r.run_id}</td>
                <td>{num(r.rows)}</td>
                <td>{r.repeats}</td>
                <td>{ms(r.baseline.latency_ms.p50)}</td>
                <td>{ms(r.indexed.latency_ms.p50)}</td>
                <td className="mint">{r.speedup_p50.toFixed(1)}×</td>
                <td>{ms(r.index.build_ms)}</td>
                <td>{pct(r.index.overhead_pct)}</td>
                <td>{pct(r.writes.overhead_pct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </FadeUp>
  )
}

const PROFILES = [
  { name: 'read-heavy', mix: [90, 10], d: 'catalog browse, order views, paginated history', c: 'var(--sky)' },
  { name: 'mixed', mix: [70, 30], d: 'browse + checkout at a realistic ratio', c: 'var(--mint)' },
  { name: 'write-heavy', mix: [20, 80], d: 'flash-sale checkout, outbox + consumer under pressure', c: 'var(--amber)' },
]
const RECORDED = ['dataset size', 'duration', 'concurrency', 'machine spec', 'db config', 'throughput', 'request count', 'error rate', 'p50 / p95', 'p99 (n ≥ 1 000)', 'query time', 'storage growth', 'cpu / memory']

function LoadProfiles() {
  return (
    <FadeUp className="profiles">
      <div className="matrix-head">
        <h3 className="sub-title">Load profiles in the full lab</h3>
        <Tag kind="illustrative">Locust · k6</Tag>
      </div>
      <div className="prof-grid">
        {PROFILES.map((p, i) => (
          <motion.div key={p.name} className="prof panel" style={{ ['--c' as string]: p.c }} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.12, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
            <span className="mono">{p.name}</span>
            <div className="prof-bar">
              <motion.i initial={{ width: 0 }} whileInView={{ width: `${p.mix[0]}%` }} viewport={{ once: true }} transition={{ duration: 1, delay: 0.3 + i * 0.12 }} />
            </div>
            <div className="prof-mix mono">
              <span>{p.mix[0]}% read</span>
              <span>{p.mix[1]}% write</span>
            </div>
            <p>{p.d}</p>
          </motion.div>
        ))}
      </div>
      <div className="recorded">
        <span className="mono faint">every run records →</span>
        {RECORDED.map((r) => (
          <span key={r} className="chip">
            {r}
          </span>
        ))}
      </div>
    </FadeUp>
  )
}
