import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { cached, remember, send } from '../lib/offline'
import { uuid } from '../lib/image'
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

export default function Hours({ d, presetJob = '' }: { d: Data; presetJob?: string }) {
  const [anchor, setAnchor] = useState(today())
  const [forId, setForId] = useState(d.me.id)
  const [entries, setEntries] = useState<Entry[]>([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const days = useMemo(() => weekDays(anchor), [anchor])
  const label = jobLabel(d)

  const [date, setDate] = useState(today())
  const [jobId, setJobId] = useState(presetJob)
  const [taskId, setTaskId] = useState('')
  const [hrs, setHrs] = useState('')
  const [pay, setPay] = useState<PayType>('regular')
  const [afterHours, setAfterHours] = useState(false)
  const [notes, setNotes] = useState('')

  const key = `hours:${forId}:${days[0]}`
  const [offlineNote, setOfflineNote] = useState(false)
  const load = useCallback(async () => {
    const r = await cached<Entry[]>(key, async () => {
      const { data, error } = await supabase
        .from('time_entries')
        .select('*')
        .eq('employee_id', forId)
        .gte('work_date', days[0])
        .lte('work_date', days[6])
        .order('created_at')
      if (error) throw new Error(error.message)
      return data as Entry[]
    })
    setEntries(r.data ?? [])
    setOfflineNote(r.fromCache)
  }, [forId, days, key])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (!days.includes(date)) setDate(days[0]) }, [days, date])

  const openJobs = d.jobs.filter((j) => j.status !== 'closed')
  const jobTasks = d.tasks.filter((t) => t.job_id === jobId)

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const h = Number(hrs)
    if (!(h > 0 && h <= 24)) return setErr('Enter hours between 0.25 and 24.')
    setBusy(true)
    setErr('')
    const row = {
      id: uuid(), employee_id: forId, work_date: date, hours: r2(h), pay_type: pay, after_hours: afterHours,
      job_id: jobId || null, task_id: taskId || null, notes: notes.trim(),
    }
    const mine: Entry = { ...row, status: 'open', classification: '', prevailing_wage: !!d.jobs.find((j) => j.id === jobId)?.prevailing_wage }
    const next = [...entries, mine]
    setEntries(next)
    remember(key, next)
    const r = await send({ kind: 'insert', table: 'time_entries', values: row })
    setBusy(false)
    if (r.error) { setErr(r.error); await load(); return }
    setHrs('')
    setNotes('')
    if (!r.queued) load()
  }
  async function remove(id: string) {
    const next = entries.filter((x) => x.id !== id)
    setEntries(next)
    remember(key, next)
    const r = await send({ kind: 'delete', table: 'time_entries', match: { id } })
    if (r.error) { setErr(r.error); load() }
  }
  async function submitWeek() {
    const ids = entries.filter((x) => x.status === 'open').map((x) => x.id)
    if (!ids.length) return
    setBusy(true)
    const next = entries.map((x) => (ids.includes(x.id) ? { ...x, status: 'submitted' as const } : x))
    setEntries(next)
    remember(key, next)
    const r = await send({ kind: 'update', table: 'time_entries', values: { status: 'submitted' }, match: {}, inIds: { col: 'id', ids } })
    setBusy(false)
    if (r.error) { setErr(r.error); load() }
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

      {offlineNote && <p className="warn">No signal: showing hours saved on this phone. New hours are kept and sent when you are back in coverage.</p>}
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
          <label>Billed as
            <select value={afterHours ? 'ah' : 'reg'} onChange={(e) => setAfterHours(e.target.value === 'ah')}>
              <option value="reg">Regular hours (Mon-Fri 8a-5p)</option>
              <option value="ah">After hours / weekend / holiday</option>
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
