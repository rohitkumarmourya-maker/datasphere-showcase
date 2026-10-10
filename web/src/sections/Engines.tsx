import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { SectionHead } from '../components/SectionHead'
import { FadeUp } from '../components/SplitReveal'
import { Tag } from '../components/Tag'
import { ENGINE_BY_KEY, ENGINES, MATRIX_ROWS, WORKLOADS, type EngineKey } from '../data/engines'
import '../styles/engines.css'

export function Engines() {
  const [sel, setSel] = useState<EngineKey>('pg')
  const e = ENGINE_BY_KEY[sel]
  return (
    <section id="engines" className="section engines">
      <div className="wrap">
        <SectionHead
          idx="03"
          kicker="Database selection"
          title={[['Six engines.'], ['Two in the core.'], [['Four in the lab.', 'serif']]]}
          lede="Each workload gets the engine whose guarantees match it — and every rejection is written down. PostgreSQL and MongoDB carry the application; MySQL, SQL Server, Cassandra and HBase run as labs that sharpen the comparison without becoming dependencies."
          aside={<span style={{ marginLeft: 'auto' }}><Tag kind="illustrative">Reference</Tag></span>}
        />

        <div className="eng-top">
          <FadeUp className="orbit-wrap">
            <div className="orbit" role="tablist" aria-label="Database engines">
              <div className="orbit-ring orbit-ring--a" />
              <div className="orbit-ring orbit-ring--b" />
              <div className="orbit-spin">
                {ENGINES.map((en, i) => {
                  const a = (i / ENGINES.length) * Math.PI * 2 - Math.PI / 2
                  return (
                    <button
                      key={en.key}
                      role="tab"
                      aria-selected={sel === en.key}
                      className={`orbit-node ${sel === en.key ? 'on' : ''} ${en.role}`}
                      style={{ ['--c' as string]: en.color, left: `${50 + Math.cos(a) * 42}%`, top: `${50 + Math.sin(a) * 42}%` }}
                      onClick={() => setSel(en.key)}
                    >
                      <span className="orbit-node-inner">
                        <b>{en.mono}</b>
                        <span>{en.name}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
              <AnimatePresence mode="wait">
                <motion.div
                  key={e.key}
                  className="orbit-core"
                  style={{ ['--c' as string]: e.color }}
                  initial={{ scale: 0.6, opacity: 0, rotate: -20 }}
                  animate={{ scale: 1, opacity: 1, rotate: 0 }}
                  exit={{ scale: 1.3, opacity: 0 }}
                  transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                >
                  <b>{e.mono}</b>
                  <span>{e.role === 'core' ? 'core' : 'lab'}</span>
                </motion.div>
              </AnimatePresence>
            </div>
          </FadeUp>

          <div className="eng-detail panel panel--ticks" style={{ ['--c' as string]: e.color }}>
            <AnimatePresence mode="wait">
              <motion.div
                key={e.key}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="eng-detail-inner"
              >
                <div className="ed-head">
                  <span className="engine-glyph" style={{ ['--c' as string]: e.color }}>
                    {e.mono}
                  </span>
                  <h3>{e.name}</h3>
                  <span className={`role role--${e.role}`}>{e.roleLabel}</span>
                </div>
                <p className="ed-one">{e.oneLiner}</p>
                <dl className="ed-grid">
                  {MATRIX_ROWS.slice(0, 6).map((r) => (
                    <div key={r.key}>
                      <dt>{r.label}</dt>
                      <dd>{e[r.key] as string}</dd>
                    </div>
                  ))}
                </dl>
                <div className="ed-ops">
                  <span className="mono">operational weight</span>
                  <span className="ops-meter" aria-label={`${e.ops} of 5`}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <motion.i key={n} initial={{ scaleY: 0.2 }} animate={{ scaleY: n <= e.ops ? 1 : 0.25 }} transition={{ delay: n * 0.05 }} className={n <= e.ops ? 'on' : ''} />
                    ))}
                  </span>
                </div>
                <div className="ed-fit">
                  <div>
                    <span className="mono mint">best for</span>
                    <ul>
                      {e.bestFor.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <span className="mono rose">not for</span>
                    <ul>
                      {e.notFor.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="ed-in">
                  <span className="mono">in DataSphere</span>
                  <p>{e.inDataSphere}</p>
                  <b>{e.verdict}</b>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        <Matrix sel={sel} onSel={setSel} />
        <Router />
      </div>
    </section>
  )
}

function Matrix({ sel, onSel }: { sel: EngineKey; onSel: (k: EngineKey) => void }) {
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null)
  return (
    <FadeUp className="matrix-wrap">
      <div className="matrix-head">
        <h3 className="sub-title">Side by side</h3>
        <span className="mono faint">hover to cross-reference · click a column to inspect</span>
      </div>
      <div className="matrix-scroll" data-lenis-prevent>
        <table className="matrix" onMouseLeave={() => setHover(null)}>
          <thead>
            <tr>
              <th />
              {ENGINES.map((e, c) => (
                <th key={e.key} className={`${hover?.c === c ? 'hc' : ''} ${sel === e.key ? 'sel' : ''}`} style={{ ['--c' as string]: e.color }} onClick={() => onSel(e.key)}>
                  <span className="engine-glyph" style={{ ['--c' as string]: e.color }}>
                    {e.mono}
                  </span>
                  <span>{e.name}</span>
                  <em className={`role role--${e.role}`}>{e.role}</em>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MATRIX_ROWS.map((row, r) => (
              <tr key={row.key} className={hover?.r === r ? 'hr' : ''}>
                <th>{row.label}</th>
                {ENGINES.map((e, c) => (
                  <td
                    key={e.key}
                    className={`${hover?.c === c ? 'hc' : ''} ${sel === e.key ? 'sel' : ''}`}
                    onMouseEnter={() => setHover({ r, c })}
                    onClick={() => onSel(e.key)}
                    style={{ ['--c' as string]: e.color }}
                  >
                    {e[row.key] as string}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <th>Ops weight</th>
              {ENGINES.map((e) => (
                <td key={e.key} style={{ ['--c' as string]: e.color }} className={sel === e.key ? 'sel' : ''}>
                  <span className="ops-meter sm">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <i key={n} className={n <= e.ops ? 'on' : ''} />
                    ))}
                  </span>
                </td>
              ))}
            </tr>
            <tr>
              <th>Verdict</th>
              {ENGINES.map((e) => (
                <td key={e.key} className={`verdict ${sel === e.key ? 'sel' : ''}`} style={{ ['--c' as string]: e.color }}>
                  {e.verdict}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </FadeUp>
  )
}

function Router() {
  const [wid, setWid] = useState(WORKLOADS[0].id)
  const w = WORKLOADS.find((x) => x.id === wid)!
  const order: EngineKey[] = ['pg', 'mg', 'my', 'ms', 'ca', 'hb']
  return (
    <FadeUp className="router">
      <div className="matrix-head">
        <h3 className="sub-title">Workload router</h3>
        <span className="mono faint">pick a workload · see where it lands and why</span>
      </div>
      <div className="router-grid panel">
        <div className="router-list" role="tablist" aria-label="Workloads">
          {WORKLOADS.map((x) => (
            <button key={x.id} role="tab" aria-selected={x.id === wid} className={`wl ${x.id === wid ? 'on' : ''}`} onClick={() => setWid(x.id)}>
              <b>{x.label}</b>
              <span>{x.detail}</span>
            </button>
          ))}
        </div>
        <div className="router-viz">
          <svg viewBox="0 0 400 360" preserveAspectRatio="none" className="router-svg" aria-hidden>
            {order.map((k, i) => {
              const y = 30 + i * 60
              const kind = k === w.pick ? 'pick' : k === w.runnerUp ? 'runner' : k === w.avoid ? 'avoid' : 'none'
              return (
                <motion.path
                  key={wid + k}
                  d={`M 0 180 C 200 180 200 ${y} 392 ${y}`}
                  vectorEffect="non-scaling-stroke"
                  className={`beam beam--${kind}`}
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ duration: kind === 'pick' ? 0.9 : 0.6, delay: kind === 'pick' ? 0.15 : 0.05 * i, ease: [0.65, 0, 0.35, 1] }}
                />
              )
            })}
          </svg>
          <span className="beam-src" />
          <div className="router-engines">
            {order.map((k) => {
              const en = ENGINE_BY_KEY[k]
              const kind = k === w.pick ? 'pick' : k === w.runnerUp ? 'runner' : k === w.avoid ? 'avoid' : 'none'
              return (
                <div key={k} className={`re re--${kind}`} style={{ ['--c' as string]: en.color }}>
                  <span className="engine-glyph" style={{ ['--c' as string]: en.color }}>
                    {en.mono}
                  </span>
                  <span>{en.name}</span>
                  <AnimatePresence>
                    {kind !== 'none' && (
                      <motion.em key={wid + kind} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ delay: 0.5 }}>
                        {kind === 'pick' ? 'chosen' : kind === 'runner' ? 'runner-up' : 'avoid'}
                      </motion.em>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={wid} className="router-why" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35, delay: 0.2 }}>
            <div>
              <span className="mono mint">why {ENGINE_BY_KEY[w.pick].name}</span>
              <p>{w.why}</p>
            </div>
            <div>
              <span className="mono rose">why not {ENGINE_BY_KEY[w.avoid].name}</span>
              <p>{w.whyNot}</p>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </FadeUp>
  )
}
