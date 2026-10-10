import { useCallback, useState } from 'react'
import { SectionHead } from '../../components/SectionHead'
import { FadeUp } from '../../components/SplitReveal'
import { Tag } from '../../components/Tag'
import { reconnectLive, useConn, useLive, useSim } from '../../lib/live'
import '../../styles/live.css'
import { ChaosGrid, chaos, Inspector, OrderForm, Traffic, type Call } from './Controls'
import { EventLog, Scenarios } from './Extras'
import { ConsistencyBadge, ConsumerCard, MongoPanel, PgPanel } from './Panels'
import { Wire } from './Wire'

export function LiveLab() {
  const conn = useConn()
  const sim = useSim()
  const offset = useLive((s) => s.clockOffsetMs)
  const [last, setLast] = useState<Call | null>(null)
  const report = useCallback((c: Call) => setLast(c), [])
  const live = conn === 'live' && sim

  return (
    <section id="live" className="section live band-ink">
      <div className="wrap">
        <SectionHead
          idx="02"
          kicker="Live failure lab"
          title={[['Break it.'], [['Watch it heal.', 'serif']]]}
          lede={
            <>
              A running model of the DataSphere write path, streamed from the showcase API. Place real requests, replay idempotency keys, crash the consumer, expire its resume token, corrupt a
              projection — then watch reconciliation pull the read model back to the ledger.
            </>
          }
          aside={<span style={{ marginLeft: 'auto' }}><Tag kind="simulated" /></span>}
        />

        {!live ? (
          <FadeUp>
            <div className="panel lab-offline">
              <Tag kind={conn === 'connecting' ? 'simulated' : 'offline'}>{conn === 'connecting' ? 'Connecting' : 'API offline'}</Tag>
              <h3>{conn === 'connecting' ? 'Opening the event stream…' : 'The simulation API is not running.'}</h3>
              <p className="dim">
                This lab only ever shows what the API reports — it will not invent orders or health. Start the API on <code>127.0.0.1:8710</code> and the console fills in by itself.
              </p>
              <pre className="code">
                <code>
                  <span className="c-com"># macOS / Linux</span>
                  {'\n'}bash server/run.sh{'\n\n'}
                  <span className="c-com"># Windows PowerShell</span>
                  {'\n'}powershell -ExecutionPolicy Bypass -File server\run.ps1
                </code>
              </pre>
              <button className="btn btn--sm" onClick={reconnectLive}>
                retry connection
              </button>
            </div>
          </FadeUp>
        ) : (
          <div className="lab">
            <div className="lab-bar">
              <ConsistencyBadge sim={sim} />
              <div className="lab-bar-right">
                <Traffic sim={sim} report={report} />
                <button className="btn btn--xs btn--danger" onClick={() => chaos(report, 'reset', 'Reset simulation')}>
                  reset sim
                </button>
              </div>
            </div>

            <div className="lab-stage">
              <PgPanel sim={sim} />
              <div className="panel lp lp--wire">
                <div className="panel-head">
                  <span className="title">
                    <span className="dot" style={{ ['--c' as string]: 'var(--amber)' }} />
                    relay → change stream → consumer
                  </span>
                  <span className="chip">{sim.broker.in_flight} in flight</span>
                </div>
                <div className="wire-wrap">
                  <span className="wire-end wire-end--l mono">outbox</span>
                  <Wire deliveries={sim.broker.deliveries} status={sim.consumer.status} inFlight={sim.broker.in_flight} />
                  <span className="wire-end wire-end--r mono">gate</span>
                </div>
                <div className="wire-legend mono">
                  <span style={{ ['--c' as string]: 'var(--fg)' }}>normal</span>
                  <span style={{ ['--c' as string]: 'var(--amber)' }}>duplicate</span>
                  <span style={{ ['--c' as string]: 'var(--sky)' }}>delayed</span>
                  <span style={{ ['--c' as string]: 'var(--violet)' }}>redelivery</span>
                </div>
                <ConsumerCard sim={sim} />
              </div>
              <MongoPanel sim={sim} offset={offset} />
            </div>

            <div className="panel lab-scen">
              <div className="panel-head">
                <span className="title">guided failure drills</span>
                <span>each step is a real API call</span>
              </div>
              <Scenarios report={report} disabled={!live} />
            </div>

            <div className="lab-controls panel">
              <OrderForm sim={sim} report={report} />
              <ChaosGrid report={report} />
              <Inspector last={last} />
            </div>

            <EventLog />
          </div>
        )}

        <FadeUp>
          <p className="lab-note">
            <Tag kind="simulated" /> The ledger, broker, consumer and projections here are an in-memory model running inside a local FastAPI process — not PostgreSQL or MongoDB. It exists to make the
            pattern’s failure modes visible. In the DataSphere platform the same flow is designed to run against PostgreSQL and a MongoDB replica set.
          </p>
        </FadeUp>
      </div>
    </section>
  )
}
