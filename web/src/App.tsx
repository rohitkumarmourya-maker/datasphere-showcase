import { MotionConfig } from 'motion/react'
import { useCallback, useEffect, useState } from 'react'
import { Marquee } from './components/Marquee'
import { Nav, Rail } from './components/Nav'
import { Preloader } from './components/Preloader'
import { lockScroll, startSmoothScroll } from './lib/scroll'
import { Build, Footer } from './sections/Build'
import { Capacity } from './sections/Capacity'
import { Engines } from './sections/Engines'
import { Hero } from './sections/Hero'
import { Journey } from './sections/Journey'
import { Lifecycle } from './sections/Lifecycle'
import { LiveLab } from './sections/live/LiveLab'
import { Manifesto } from './sections/Manifesto'
import { Operations } from './sections/Operations'
import { Performance } from './sections/Performance'
import { Resilience } from './sections/Resilience'

const STACK = ['FastAPI', 'Pydantic', 'SQLAlchemy', 'Alembic', 'PyMongo', 'Pytest', 'React', 'TypeScript', 'Vite', 'Docker Compose', 'GitHub Actions', 'Prometheus', 'Grafana', 'Locust', 'k6']
const CONCEPTS = ['transactional outbox', 'idempotency keys', 'SELECT … FOR UPDATE', 'resume tokens', 'reconciliation', 'EXPLAIN (ANALYZE, BUFFERS)', 'WAL streaming', 'replica-set elections', 'pg_basebackup', 'mongodump --oplog', 'RPO / RTO', 'partition pruning', 'retention dry-runs']

export function App() {
  const [booted, setBooted] = useState(false)
  const done = useCallback(() => setBooted(true), [])

  useEffect(() => {
    startSmoothScroll()
  }, [])
  useEffect(() => {
    lockScroll(!booted)
  }, [booted])

  return (
    <MotionConfig reducedMotion="user">
      {!booted && <Preloader onDone={done} />}
      <Nav />
      <Rail />
      <main>
        <Hero ready={booted} />
        <Manifesto />
        <Marquee items={STACK} duration={70} />
        <Marquee items={CONCEPTS} reverse small duration={80} />
        <Journey />
        <LiveLab />
        <Engines />
        <Resilience />
        <Performance />
        <Capacity />
        <Lifecycle />
        <Operations />
        <Build />
      </main>
      <Footer />
    </MotionConfig>
  )
}
