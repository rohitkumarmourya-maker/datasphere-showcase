import { AnimatePresence, motion, useInView } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { BrandMark } from '../components/Nav'
import { SectionHead } from '../components/SectionHead'
import { FadeUp } from '../components/SplitReveal'
import { Tag } from '../components/Tag'
import { scrollToId } from '../lib/scroll'
import '../styles/build.css'

const STEPS = [
  { why: 'check prerequisites', cmd: 'git --version; python --version; node --version; docker version', ok: 'each prints a version — anything missing gets a winget line' },
  { why: 'install what is missing', cmd: 'winget install -e --id Docker.DockerDesktop', ok: 'Docker Desktop starts; `docker info` shows a running engine (WSL 2 backend)' },
  { why: 'configure safely', cmd: 'Copy-Item .env.example .env', ok: '.env exists locally and stays out of Git (.gitignore)' },
  { why: 'start the core stack', cmd: 'docker compose up -d --wait', ok: 'postgres, mongo (rs0) and api report healthy in `docker compose ps`' },
  { why: 'apply migrations', cmd: 'docker compose exec api alembic upgrade head', ok: '`alembic current` shows head; tables listed by `\\dt`' },
  { why: 'load synthetic data', cmd: 'docker compose exec api python -m scripts.seed --orders 20000', ok: 'row counts printed per table — synthetic names, no real cards' },
  { why: 'run the tests', cmd: 'docker compose exec api pytest -q', ok: 'exit code 0; failures are reported, never hidden' },
]

export function Build() {
  return (
    <section id="build" className="section build">
      <div className="wrap">
        <SectionHead
          idx="09"
          kicker="Delivery"
          title={[['Windows-first.'], [['Evidence-first.', 'serif']]]}
          lede="Every runbook command names its terminal, its working directory and how to tell it worked. Every feature in the README carries a status — and only the tested ones become résumé bullets."
        />
        <div className="build-grid">
          <FadeUp>
            <Runbook />
          </FadeUp>
          <FadeUp delay={0.1}>
            <Tree />
          </FadeUp>
        </div>
        <Ledger />
        <RunThis />
      </div>
    </section>
  )
}

function Runbook() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { margin: '-20% 0px' })
  const [i, setI] = useState(0)
  const [typed, setTyped] = useState(0)
  useEffect(() => {
    if (!inView) return
    const cmd = STEPS[i].cmd
    if (typed < cmd.length) {
      const t = setTimeout(() => setTyped((n) => n + 2), 22)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => {
      setI((x) => (x + 1) % STEPS.length)
      setTyped(0)
    }, 2400)
    return () => clearTimeout(t)
  }, [inView, i, typed])
  const s = STEPS[i]
  return (
    <div className="term panel runbook band-ink" ref={ref}>
      <div className="term-bar">
        <span className="mono">Windows PowerShell · C:\dev\enterprise-datasphere</span>
        <Tag kind="illustrative">Runbook</Tag>
      </div>
      <div className="rb-body mono">
        {STEPS.slice(0, i).map((p, k) => (
          <div key={k} className="rb-done">
            <span className="ok">✓</span> {p.why}
          </div>
        ))}
        <div className="rb-cur">
          <div className="rb-why"># {s.why} · terminal: PowerShell</div>
          <div className="rb-cmd">
            <span className="ps">PS&gt;</span> {s.cmd.slice(0, typed)}
            <span className="caret" />
          </div>
          <AnimatePresence>
            {typed >= s.cmd.length && (
              <motion.div className="rb-ok" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                verify → {s.ok}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <div className="rb-steps">
        {STEPS.map((_, k) => (
          <button key={k} className={k === i ? 'on' : k < i ? 'done' : ''} onClick={() => (setI(k), setTyped(0))} aria-label={`Show step ${k + 1}`} />
        ))}
      </div>
    </div>
  )
}

type Node = { n: string; c?: Node[]; note?: string }
const TREE: Node = {
  n: 'enterprise-datasphere/',
  c: [
    { n: 'backend/', c: [{ n: 'app/', note: 'api · core · db · models · schemas · repositories · services · events · monitoring · admin' }, { n: 'alembic/versions/', note: 'schema migrations' }, { n: 'tests/', note: 'unit · integration · reliability · security' }] },
    { n: 'frontend/src/', note: 'components · pages · api (React + TS + Vite)' },
    { n: 'databases/', c: [{ n: 'postgres/' }, { n: 'mongodb/', note: 'rs0 init, validators' }, { n: 'mysql-lab/' }, { n: 'sqlserver-lab/' }, { n: 'cassandra-lab/' }, { n: 'hbase-lab/', note: 'optional, needs more RAM' }] },
    { n: 'deploy/', note: 'compose (core / monitoring / replication / labs) · on-prem · cloud' },
    { n: 'monitoring/', note: 'prometheus scrape config · grafana provisioning' },
    { n: 'benchmarks/', note: 'locust · k6 · raw results · reports' },
    { n: 'scripts/', note: 'backup · restore-verify · retention · seed' },
    { n: 'docs/', note: 'ADRs · runbooks · ERD · DR plan · QA plan' },
    { n: '.github/workflows/ci.yml' },
    { n: '.env.example' },
    { n: 'README.md' },
  ],
}

function Tree() {
  const [open, setOpen] = useState<Set<string>>(new Set(['enterprise-datasphere/', 'backend/', 'databases/']))
  let row = 0
  const render = (node: Node, depth: number, path: string): React.ReactNode => {
    const key = node.n
    const isDir = !!node.c
    const isOpen = open.has(key)
    const r = row++
    return (
      <div key={path + key}>
        <motion.button
          className={`tree-row ${isDir ? 'dir' : ''}`}
          style={{ paddingLeft: 14 + depth * 18 }}
          onClick={() =>
            isDir &&
            setOpen((s) => {
              const n = new Set(s)
              if (n.has(key)) n.delete(key)
              else n.add(key)
              return n
            })
          }
          initial={{ opacity: 0, x: -10 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ delay: r * 0.035 }}
        >
          <span className="tw">{isDir ? (isOpen ? '▾' : '▸') : node.n.endsWith('/') ? '▸' : '·'}</span>
          <span className={node.n.endsWith('/') ? 'tn dir' : 'tn'}>{node.n}</span>
          {node.note && <span className="tnote">{node.note}</span>}
        </motion.button>
        <AnimatePresence initial={false}>
          {isDir && isOpen && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
              {node.c!.map((c) => render(c, depth + 1, path + key))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }
  return (
    <div className="panel tree">
      <div className="panel-head">
        <span className="title">repository layout</span>
        <span>click folders</span>
      </div>
      <div className="tree-body mono">{render(TREE, 0, '')}</div>
    </div>
  )
}

const LEDGER = [
  { k: 'tested', t: 'Implemented & tested', d: 'Behaviour exists and an automated test asserts it. The only status that reaches a résumé.', c: 'var(--mint)' },
  { k: 'untested', t: 'Implemented, not yet tested', d: 'Code exists, nothing asserts it yet. Described as such — never as “working”.', c: 'var(--sky)' },
  { k: 'partial', t: 'Partial', d: 'Some paths done; the missing ones are listed by name, not hidden behind “etc.”.', c: 'var(--amber)' },
  { k: 'planned', t: 'Planned', d: 'Designed on paper. Lives in the roadmap, not in the feature list.', c: 'var(--fg-3)' },
]

function Ledger() {
  return (
    <div className="ledger">
      <div className="matrix-head">
        <h3 className="sub-title">The evidence ledger</h3>
        <span className="mono faint">four statuses · one rule: no claim without proof</span>
      </div>
      <div className="ledger-grid">
        {LEDGER.map((l, i) => (
          <motion.div
            key={l.k}
            className="lg"
            style={{ ['--c' as string]: l.c }}
            initial={{ opacity: 0, y: 30, rotateX: -25 }}
            whileInView={{ opacity: 1, y: 0, rotateX: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.1, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="lg-dot" />
            <h4>{l.t}</h4>
            <p>{l.d}</p>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function RunThis() {
  return (
    <FadeUp className="runthis panel panel--ticks">
      <div>
        <span className="mono mint">this showcase, on your machine</span>
        <h3>Two terminals. One minute.</h3>
        <p className="dim">The live lab, failover simulator, benchmark and estimator on this page are served by a small FastAPI process; the site is React + Vite. Both bind to 127.0.0.1 only.</p>
      </div>
      <pre className="code">
        <code>
          <span className="c-com"># terminal 1 · API (macOS / Linux)</span>
          {'\n'}bash server/run.sh{'\n'}
          <span className="c-com"># terminal 1 · API (Windows PowerShell)</span>
          {'\n'}powershell -ExecutionPolicy Bypass -File server\run.ps1{'\n\n'}
          <span className="c-com"># terminal 2 · site</span>
          {'\n'}cd web; npm install; npm run dev{'\n'}
          <span className="c-com"># open http://127.0.0.1:5180</span>
        </code>
      </pre>
    </FadeUp>
  )
}

export function Footer() {
  return (
    <footer className="footer band-ink">
      <div className="wrap">
        <div className="foot-cta">
          <p>
            Six engines, one source of truth, <span className="accent-text">and receipts for everything.</span>
          </p>
          <button className="btn btn--primary" onClick={() => scrollToId('top')}>
            Back to the sphere ↑
          </button>
        </div>
        <div className="wordmark" aria-hidden>
          <span data-text="DATASPHERE">DATASPHERE</span>
        </div>
        <div className="foot-bottom">
          <span className="brand">
            <BrandMark size={22} /> Enterprise DataSphere
          </span>
          <span className="faint">
            Portfolio project showcase. The live parts of this page are a local simulation and a local SQLite benchmark — labelled wherever they appear. PostgreSQL, MySQL, Microsoft SQL Server, MongoDB, Apache Cassandra and Apache HBase are trademarks of their respective owners; no affiliation or endorsement is implied.
          </span>
        </div>
      </div>
    </footer>
  )
}
