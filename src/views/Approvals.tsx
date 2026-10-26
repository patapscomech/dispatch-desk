import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabase'
import type { Data } from '../App'
import type { Entry } from '../types'
import { fmtDay } from '../lib/dates'
import { r2 } from '../lib/timesheet'
import { jobLabel } from './Hours'

export default function Approvals({ d }: { d: Data }) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [err, setErr] = useState('')
  const label = jobLabel(d)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('time_entries').select('*').eq('status', 'submitted').order('work_date')
    if (error) setErr(error.message)
    else setEntries(data as Entry[])
  }, [])
  useEffect(() => { load() }, [load])

  async function setStatus(ids: string[], status: 'approved' | 'open') {
    setErr('')
    const { error } = await supabase.from('time_entries').update({ status }).in('id', ids)
    if (error) setErr(error.message)
    load()
  }

  const byPerson = d.people
    .map((p) => ({ p, list: entries.filter((e) => e.employee_id === p.id) }))
    .filter((x) => x.list.length)

  return (
    <section>
      <h2>Hours waiting for approval</h2>
      {err && <p className="err" role="alert">{err}</p>}
      {!byPerson.length && <p className="muted">Nothing is waiting.</p>}
      {byPerson.map(({ p, list }) => {
        const mine = p.id === d.me.id
        return (
          <div className="card" key={p.id}>
            <div className="row between">
              <b>{p.full_name}</b>
              <span className="sm">{r2(list.reduce((s, e) => s + Number(e.hours), 0))} h</span>
            </div>
            {list.map((e) => (
              <div className="entry" key={e.id}>
                <div className="grow">
                  <div>{fmtDay(e.work_date)} · {label(e.job_id, e.task_id)}</div>
                  <div className="muted sm">{e.pay_type === 'ot' ? 'Overtime' : 'Regular'}{e.prevailing_wage ? ' · prevailing wage' : ''}{e.notes ? ' · ' + e.notes : ''}</div>
                </div>
                <div className="num">{Number(e.hours)} h</div>
                <button className="btn" onClick={() => setStatus([e.id], 'open')}>Return</button>
              </div>
            ))}
            <div className="row">
              <button className="btn primary" disabled={mine && d.me.role === 'foreman'} onClick={() => setStatus(list.map((e) => e.id), 'approved')}>
                Approve all
              </button>
              {mine && d.me.role === 'foreman' && <span className="muted sm">Another approver must approve your own hours.</span>}
            </div>
          </div>
        )
      })}
    </section>
  )
}
