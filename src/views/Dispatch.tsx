import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import type { Data } from '../App'
import { isOffice, type Assignment } from '../types'
import { addDays, fmtDay, fmtRange, today, weekDays } from '../lib/dates'

export default function Dispatch({ d }: { d: Data }) {
  const [anchor, setAnchor] = useState(today())
  const [asg, setAsg] = useState<Assignment[]>([])
  const [err, setErr] = useState('')
  const days = useMemo(() => weekDays(anchor), [anchor])
  const office = isOffice(d.me.role)

  const [jobId, setJobId] = useState('')
  const [who, setWho] = useState<string[]>([])
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(today())
  const [lead, setLead] = useState('')
  const [showForm, setShowForm] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('job_assignments').select('*').gte('work_date', days[0]).lte('work_date', days[6])
    if (error) setErr(error.message)
    else setAsg(data as Assignment[])
  }, [days])
  useEffect(() => { load() }, [load])

  const crew = d.people.filter((p) => p.active)
  const job = (id: string) => d.jobs.find((j) => j.id === id)
  const assignable = d.jobs.filter((j) => j.status !== 'closed' && j.status !== 'complete')
  const unscheduled = d.jobs.filter((j) => j.status === 'unassigned')

  function openAssign(id = '') {
    setJobId(id); setWho([]); setFrom(days[0] > today() ? days[0] : today()); setTo(days[0] > today() ? days[0] : today()); setLead(''); setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  async function assign(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    if (!jobId || !who.length) return setErr('Choose a job and at least one person.')
    if (to < from) return setErr('The end date is before the start date.')
    const rows: Omit<Assignment, 'id'>[] = []
    for (let day = from; day <= to; day = addDays(day, 1)) {
      const dow = new Date(day + 'T00:00:00Z').getUTCDay()
      if (dow === 0 || dow === 6) continue // weekdays only; use the end date to skip weekends
      who.forEach((w) => rows.push({ job_id: jobId, employee_id: w, work_date: day, is_lead: w === (lead || who[0]) }))
    }
    if (!rows.length) return setErr('That range has only weekend days.')
    const up = await supabase.from('job_assignments').upsert(rows, { onConflict: 'job_id,employee_id,work_date' })
    if (up.error) return setErr(up.error.message)
    const all = await supabase.from('job_assignments').select('work_date').eq('job_id', jobId).order('work_date')
    const dates = ((all.data ?? []) as { work_date: string }[]).map((r) => r.work_date)
    const j = job(jobId)!
    const patch: Record<string, unknown> = { start_date: dates[0], end_date: dates[dates.length - 1] }
    if (j.status === 'unassigned') patch.status = 'scheduled'
    const u = await supabase.from('jobs').update(patch).eq('id', jobId)
    if (u.error) return setErr(u.error.message)
    setShowForm(false)
    await d.reload()
    load()
  }
  async function removeOne(a: Assignment) {
    const { error } = await supabase.from('job_assignments').delete().eq('id', a.id)
    if (error) return setErr(error.message)
    load()
  }

  return (
    <section>
      <div className="bar">
        <button className="btn" onClick={() => setAnchor(addDays(days[0], -7))} aria-label="Previous week">‹</button>
        <div className="grow center-t"><b>{fmtRange(days)}</b></div>
        <button className="btn" onClick={() => setAnchor(addDays(days[0], 7))} aria-label="Next week">›</button>
        {office && <button className="btn primary" onClick={() => openAssign()}>Assign</button>}
      </div>
      {err && <p className="err" role="alert">{err}</p>}

      {showForm && office && (
        <form className="card form" onSubmit={assign}>
          <h2>Assign people to a job</h2>
          <label>Job
            <select value={jobId} onChange={(e) => setJobId(e.target.value)} required>
              <option value="">Choose…</option>
              {assignable.map((j) => <option key={j.id} value={j.id}>{j.number} · {j.title}</option>)}
            </select>
          </label>
          <div className="grid2">
            <label>From<input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value) }} /></label>
            <label>To<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
          <fieldset className="people">
            <legend className="sm muted">People (weekdays in the range)</legend>
            {crew.map((p) => (
              <label className="check" key={p.id}>
                <input type="checkbox" checked={who.includes(p.id)} onChange={(e) => setWho(e.target.checked ? [...who, p.id] : who.filter((x) => x !== p.id))} />
                {p.full_name} <span className="muted sm">{p.classification}</span>
              </label>
            ))}
          </fieldset>
          {who.length > 1 && (
            <label>Lead
              <select value={lead || who[0]} onChange={(e) => setLead(e.target.value)}>
                {who.map((w) => <option key={w} value={w}>{d.people.find((p) => p.id === w)?.full_name}</option>)}
              </select>
            </label>
          )}
          <div className="row"><button className="btn primary">Assign</button><button type="button" className="btn" onClick={() => setShowForm(false)}>Cancel</button></div>
        </form>
      )}

      <div className="scroll">
        <table className="sheet board">
          <thead><tr><th>Person</th>{days.map((x) => <th key={x}>{fmtDay(x).replace(/, /, ' ')}</th>)}</tr></thead>
          <tbody>
            {crew.map((p) => (
              <tr key={p.id}>
                <td><b>{p.full_name}</b><div className="muted sm">{p.classification}</div></td>
                {days.map((x) => (
                  <td key={x} className={x === today() ? 'todaycol' : ''}>
                    {asg.filter((a) => a.employee_id === p.id && a.work_date === x).map((a) => {
                      const j = job(a.job_id)
                      return (
                        <span className={'chip pr-' + (j?.priority ?? 'Normal')} key={a.id}>
                          <button className="chipbtn" onClick={() => d.openJob(a.job_id)}>{a.is_lead ? '★ ' : ''}{j?.number ?? '?'}</button>
                          {office && <button className="chipx" aria-label={`Remove ${j?.number} from ${p.full_name} on ${x}`} onClick={() => removeOne(a)}>×</button>}
                        </span>
                      )
                    })}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Waiting to be scheduled ({unscheduled.length})</h2>
      {unscheduled.map((j) => (
        <div className="card row between" key={j.id}>
          <button className="linkrow" onClick={() => d.openJob(j.id)}><b>{j.number}</b> · {j.title}
            <div className="muted sm">{j.priority !== 'Normal' ? j.priority + ' · ' : ''}{d.locations.find((l) => l.id === j.location_id)?.name ?? ''}</div></button>
          {office && <button className="btn" onClick={() => openAssign(j.id)}>Assign</button>}
        </div>
      ))}
      {!unscheduled.length && <p className="muted">Everything has someone assigned.</p>}
    </section>
  )
}
