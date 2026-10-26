import { useEffect, useState } from 'react'
import type { Data } from '../App'
import type { Assignment } from '../types'
import { STATUS_LABEL } from '../types'
import { fmtDay, today } from '../lib/dates'
import { loadMyWork } from '../lib/field'

export default function MyWork({ d }: { d: Data }) {
  const [asg, setAsg] = useState<Assignment[]>([])
  const [cached, setCached] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    loadMyWork(d.me.id, d.jobs).then((r) => {
      if (!live) return
      setAsg(r.assignments); setCached(r.fromCache); setLoading(false)
    })
    return () => { live = false }
  }, [d.me.id, d.jobs])

  const dates = [...new Set(asg.map((a) => a.work_date))].sort()
  const t = today()
  const loc = (id: string | null) => d.locations.find((l) => l.id === id)

  return (
    <section>
      {cached && <p className="warn">No signal: showing the calls saved on this phone. Changes you make are kept and sent when you are back in coverage.</p>}
      {loading && <p className="muted">Loading…</p>}
      {!loading && !dates.length && <p className="muted">Nothing is assigned to you in the next two weeks.</p>}
      {dates.map((day) => (
        <div key={day} className="stack">
          <h2>{day === t ? 'Today' : fmtDay(day)}{day === t ? <span className="muted sm"> · {fmtDay(day)}</span> : null}</h2>
          {asg.filter((a) => a.work_date === day).map((a) => {
            const j = d.jobs.find((x) => x.id === a.job_id)
            const l = loc(j?.location_id ?? null)
            if (!j) return null
            return (
              <button className="card jobrow" key={a.id} onClick={() => d.openJob(j.id)}>
                <div className="row between">
                  <span><b>{j.number}</b> · {j.title}</span>
                  <span className={'pill st-' + j.status}>{STATUS_LABEL[j.status]}</span>
                </div>
                <div className="muted sm">{[l?.name, l?.address, j.priority !== 'Normal' && j.priority, a.is_lead && 'You are lead'].filter(Boolean).join(' · ')}</div>
              </button>
            )
          })}
        </div>
      ))}
    </section>
  )
}
