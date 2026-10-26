import { useState } from 'react'
import { supabase } from '../supabase'
import type { Data } from '../App'

export default function Jobs({ d }: { d: Data }) {
  const [number, setNumber] = useState('')
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<'ticket' | 'project'>('ticket')
  const [customer, setCustomer] = useState('')
  const [pw, setPw] = useState(false)
  const [err, setErr] = useState('')
  const [taskName, setTaskName] = useState<Record<string, string>>({})
  const [showClosed, setShowClosed] = useState(false)

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    let customerId: string | null = null
    const name = customer.trim()
    if (name) {
      const existing = d.customers.find((c) => c.name.toLowerCase() === name.toLowerCase())
      if (existing) customerId = existing.id
      else {
        const { data, error } = await supabase.from('customers').insert({ name }).select().single()
        if (error) return setErr(error.message)
        customerId = data.id
      }
    }
    const { error } = await supabase.from('jobs').insert({
      number: number.trim(), title: title.trim(), kind, customer_id: customerId, prevailing_wage: pw,
    })
    if (error) return setErr(error.message.includes('duplicate') ? 'That job number already exists.' : error.message)
    setNumber(''); setTitle(''); setCustomer(''); setPw(false)
    d.reload()
  }
  async function setStatus(id: string, status: 'open' | 'closed') {
    const { error } = await supabase.from('jobs').update({ status }).eq('id', id)
    if (error) setErr(error.message)
    d.reload()
  }
  async function addTask(jobId: string) {
    const name = (taskName[jobId] ?? '').trim()
    if (!name) return
    const { error } = await supabase.from('job_tasks').insert({ job_id: jobId, name })
    if (error) return setErr(error.message.includes('duplicate') ? 'That task already exists on this job.' : error.message)
    setTaskName({ ...taskName, [jobId]: '' })
    d.reload()
  }

  const jobs = d.jobs.filter((j) => showClosed || j.status === 'open')
  const cust = (id: string | null) => d.customers.find((c) => c.id === id)?.name

  return (
    <section>
      <form className="card form" onSubmit={add}>
        <h2>New ticket or project</h2>
        <div className="grid2">
          <label>Number<input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="T-1050 or P-212" required /></label>
          <label>Type
            <select value={kind} onChange={(e) => setKind(e.target.value as 'ticket' | 'project')}>
              <option value="ticket">Service ticket</option>
              <option value="project">Project</option>
            </select>
          </label>
        </div>
        <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
        <label>Customer<input list="custs" value={customer} onChange={(e) => setCustomer(e.target.value)} />
          <datalist id="custs">{d.customers.map((c) => <option key={c.id} value={c.name} />)}</datalist>
        </label>
        <label className="check"><input type="checkbox" checked={pw} onChange={(e) => setPw(e.target.checked)} /> Prevailing wage job</label>
        <button className="btn primary">Add</button>
      </form>
      {err && <p className="err" role="alert">{err}</p>}

      <label className="check"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show closed jobs</label>
      {jobs.map((j) => (
        <div className="card" key={j.id}>
          <div className="row between">
            <div><b>{j.number}</b> · {j.title}
              <div className="muted sm">{j.kind === 'project' ? 'Project' : 'Service ticket'}{cust(j.customer_id) ? ' · ' + cust(j.customer_id) : ''}{j.prevailing_wage ? ' · prevailing wage' : ''}</div>
            </div>
            <button className="btn" onClick={() => setStatus(j.id, j.status === 'open' ? 'closed' : 'open')}>{j.status === 'open' ? 'Close' : 'Reopen'}</button>
          </div>
          {j.kind === 'project' && (
            <div>
              <div className="sm">Tasks: {d.tasks.filter((t) => t.job_id === j.id).map((t) => t.name).join(', ') || <span className="muted">none yet</span>}</div>
              <div className="row">
                <input className="grow" placeholder="New task name" value={taskName[j.id] ?? ''} onChange={(e) => setTaskName({ ...taskName, [j.id]: e.target.value })} />
                <button className="btn" onClick={() => addTask(j.id)}>Add task</button>
              </div>
            </div>
          )}
        </div>
      ))}
      {!jobs.length && <p className="muted">No jobs yet.</p>}
    </section>
  )
}
