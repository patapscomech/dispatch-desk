import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import type { Data } from '../App'
import { isOffice, type Entry, type PayType } from '../types'
import { addDays, fmtDay, fmtRange, today, weekDays } from '../lib/dates'
import { r2 } from '../lib/timesheet'

export const jobLabel = (d: Pick<Data, 'jobs' | 'tasks'>) => (jobId: string | null, taskId: string | null) => {
  if (!jobId) return 'Shop time'
  const j = d.jobs.find((x) => x.id === jobId)
  const t = taskId ? d.tasks.find((x) => x.id === taskId) : null
  return `${j ? j.number + ' ' + j.title : 'Unknown job'}${t ? ' / ' + t.name : ''}`
}

export default function Hours({ d }: { d: Data }) {
  const [anchor, setAnchor] = useState(today())
  const [forId, setForId] = useState(d.me.id)
  const [entries, setEntries] = useState<Entry[]>([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const days = useMemo(() => weekDays(anchor), [anchor])
  const label = jobLabel(d)

  const [date, setDate] = useState(today())
  const [jobId, setJobId] = useState('')
  const [taskId, setTaskId] = useState('')
  const [hrs, setHrs] = useState('')
  const [pay, setPay] = useState<PayType>('regular')
  const [notes, setNotes] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('time_entries')
      .select('*')
      .eq('employee_id', forId)
      .gte('work_date', days[0])
      .lte('work_date', days[6])
      .order('created_at')
    if (error) setErr(error.message)
    else setEntries(data as Entry[])
  }, [forId, days])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (!days.includes(date)) setDate(days[0]) }, [days, date])

  const openJobs = d.jobs.filter((j) => j.status === 'open')
  const jobTasks = d.tasks.filter((t) => t.job_id === jobId)

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const h = Number(hrs)
    if (!(h > 0 && h <= 24)) return setErr('Enter hours between 0.25 and 24.')
    setBusy(true)
    setErr('')
    const { error } = await supabase.from('time_entries').insert({
      employee_id: forId,
      work_date: date,
      hours: r2(h),
      pay_type: pay,
      job_id: jobId || null,
      task_id: taskId || null,
      notes: notes.trim(),
    })
    setBusy(false)
    if (error) return setErr(error.message)
    setHrs('')
    setNotes('')
    load()
  }
  async function remove(id: string) {
    const { error } = await supabase.from('time_entries').delete().eq('id', id)
    if (error) setErr(error.message)
    else load()
  }
  async function submitWeek() {
    const ids = entries.filter((x) => x.status === 'open').map((x) => x.id)
    if (!ids.length) return
    setBusy(true)
    const { error } = await supabase.from('time_entries').update({ status: 'submitted' }).in('id', ids)
    setBusy(false)
    if (error) setErr(error.message)
    else load()
  }

  const weekTotal = r2(entries.reduce((s, x) => s + Number(x.hours), 0))
  const openCount = entries.filter((x) => x.status === 'open').length
  const editable = (x: Entry) => x.status === 'open'

  return (
    <section>
      <div className="bar">
        <button className="btn" onClick={() => setAnchor(addDays(days[0], -7))} aria-label="Previous week">‹</button>
        <div className="grow center-t"><b>{fmtRange(days)}</b><div className="muted sm">Week total {weekTotal} h</div></div>
        <button className="btn" onClick={() => setAnchor(addDays(days[0], 7))} aria-label="Next week">›</button>
      </div>

      {isOffice(d.me.role) && (
        <label className="inline">Entering hours for
          <select value={forId} onChange={(e) => setForId(e.target.value)}>
            {d.people.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </label>
      )}

      <form className="card form" onSubmit={add}>
        <h2>Add hours</h2>
        <div className="grid2">
          <label>Date
            <select value={date} onChange={(e) => setDate(e.target.value)}>
              {days.map((x) => <option key={x} value={x}>{fmtDay(x)}</option>)}
            </select>
          </label>
          <label>Hours
            <input inputMode="decimal" placeholder="e.g. 4.5" value={hrs} onChange={(e) => setHrs(e.target.value)} required />
          </label>
        </div>
        <label>Ticket or project
          <select value={jobId} onChange={(e) => { setJobId(e.target.value); setTaskId('') }}>
            <option value="">Shop time (not on a job)</option>
            {openJobs.map((j) => <option key={j.id} value={j.id}>{j.number} · {j.title}</option>)}
          </select>
        </label>
        {jobTasks.length > 0 && (
          <label>Task
            <select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
              <option value="">No specific task</option>
              {jobTasks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        )}
        <div className="grid2">
          <label>Pay
            <select value={pay} onChange={(e) => setPay(e.target.value as PayType)}>
              <option value="regular">Regular</option>
              <option value="ot">Overtime</option>
            </select>
          </label>
          <label>Note (optional)
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
        <button className="btn primary" disabled={busy}>Add hours</button>
      </form>
      {err && <p className="err" role="alert">{err}</p>}

      {days.map((day) => {
        const list = entries.filter((x) => x.work_date === day)
        if (!list.length && day > today()) return null
        const tot = r2(list.reduce((s, x) => s + Number(x.hours), 0))
        const job = r2(list.filter((x) => x.job_id).reduce((s, x) => s + Number(x.hours), 0))
        return (
          <div className="card" key={day}>
            <div className="row between"><b>{fmtDay(day)}</b>
              <span className="sm">{list.length ? <>Day total <b>{tot} h</b> <span className="muted">· jobs {job} · shop {r2(tot - job)}</span></> : <span className="muted">No hours</span>}</span>
            </div>
            {list.map((x) => (
              <div className="entry" key={x.id}>
                <div className="grow">
                  <div>{label(x.job_id, x.task_id)}</div>
                  <div className="muted sm">{x.pay_type === 'ot' ? 'Overtime' : 'Regular'}{x.notes ? ' · ' + x.notes : ''}</div>
                </div>
                <div className="num">{Number(x.hours)} h</div>
                <span className={'pill ' + x.status}>{x.status}</span>
                {editable(x) && <button className="btn ghost" aria-label="Delete entry" onClick={() => remove(x.id)}>✕</button>}
              </div>
            ))}
          </div>
        )
      })}

      <div className="bar">
        <button className="btn primary grow" disabled={!openCount || busy} onClick={submitWeek}>
          {openCount ? `Submit week for approval (${openCount} entries)` : 'Nothing to submit'}
        </button>
      </div>
    </section>
  )
}
