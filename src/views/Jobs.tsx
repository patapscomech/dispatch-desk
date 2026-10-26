import { useState } from 'react'
import { supabase } from '../supabase'
import type { Data } from '../App'
import { PRIORITIES, STATUS_LABEL, type JobStatus } from '../types'

export default function Jobs({ d }: { d: Data }) {
  const blank = { number: '', title: '', kind: 'ticket' as 'ticket' | 'project', customer_id: '', location_id: '', contract_id: '', priority: 'Normal', description: '', prevailing_wage: false }
  const [f, setF] = useState(blank)
  const [err, setErr] = useState('')
  const [filter, setFilter] = useState<'active' | JobStatus | 'all'>('active')
  const [q, setQ] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [selfOnly, setSelfOnly] = useState(false)

  const locs = d.locations.filter((l) => l.customer_id === f.customer_id)
  const ctrs = d.contracts.filter((c) => c.customer_id === f.customer_id && c.active)
  const cust = (id: string | null) => d.customers.find((c) => c.id === id)?.name
  const loc = (id: string | null) => d.locations.find((l) => l.id === id)?.name

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    if (f.kind === 'ticket' && !f.location_id) return setErr('Choose the customer and location for a service ticket.')
    const { data, error } = await supabase.from('jobs').insert({
      number: f.number.trim(), title: f.title.trim(), kind: f.kind, customer_id: f.customer_id || null,
      location_id: f.location_id || null, contract_id: f.contract_id || null, priority: f.priority, description: f.description.trim(), prevailing_wage: f.prevailing_wage,
    }).select().single()
    if (error) return setErr(error.message.includes('duplicate') ? 'That job number already exists.' : error.message)
    setF(blank); setShowForm(false)
    await d.reload()
    d.openJob(data.id)
  }

  const list = d.jobs
    .filter((j) => (filter === 'all' ? true : filter === 'active' ? j.status !== 'closed' : j.status === filter))
    .filter((j) => !selfOnly || j.self_dispatched)
    .filter((j) => !q.trim() || `${j.number} ${j.title} ${cust(j.customer_id) ?? ''} ${loc(j.location_id) ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <section>
      <div className="row between">
        <h2>Tickets and projects</h2>
        <button className="btn primary" onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : 'New'}</button>
      </div>
      {showForm && (
        <form className="card form" onSubmit={add}>
          <div className="grid2">
            <label>Number<input value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} placeholder="T-1050 or P-212" required /></label>
            <label>Type
              <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as 'ticket' | 'project' })}>
                <option value="ticket">Service ticket</option><option value="project">Project</option>
              </select>
            </label>
          </div>
          <label>Title<input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required /></label>
          <div className="grid2">
            <label>Customer
              <select value={f.customer_id} onChange={(e) => setF({ ...f, customer_id: e.target.value, location_id: '', contract_id: '' })}>
                <option value="">Choose…</option>{d.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label>Location
              <select value={f.location_id} onChange={(e) => setF({ ...f, location_id: e.target.value })} disabled={!f.customer_id}>
                <option value="">Choose…</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
          </div>
          <label>Contract
            <select value={f.contract_id} onChange={(e) => setF({ ...f, contract_id: e.target.value })} disabled={!f.customer_id}>
              <option value="">None yet</option>{ctrs.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}
            </select>
          </label>
          <div className="grid2">
            <label>Priority<select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select></label>
            <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={f.prevailing_wage} onChange={(e) => setF({ ...f, prevailing_wage: e.target.checked })} /> Prevailing wage</label>
          </div>
          <label>What needs doing<textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
          {err && <p className="err" role="alert">{err}</p>}
          <button className="btn primary">Create</button>
          <div className="muted sm">Customers, locations and equipment are added on the Customers tab.</div>
        </form>
      )}

      <div className="row">
        <input className="grow" placeholder="Search number, title, customer…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} style={{ width: 'auto' }} aria-label="Filter by status">
          <option value="active">Not closed</option><option value="all">All</option>
          {(Object.keys(STATUS_LABEL) as JobStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </div>

      <label className="check"><input type="checkbox" checked={selfOnly} onChange={(e) => setSelfOnly(e.target.checked)} /> Only calls technicians dispatched to themselves</label>
      {list.map((j) => (
        <button className="card jobrow" key={j.id} onClick={() => d.openJob(j.id)}>
          <div className="row between">
            <span><b>{j.number}</b> · {j.title}{j.self_dispatched && <span className="pill selfd"> self-dispatched</span>}</span>
            <span className={'pill st-' + j.status}>{STATUS_LABEL[j.status]}</span>
          </div>
          <div className="muted sm">{[j.kind === 'project' ? 'Project' : 'Ticket', cust(j.customer_id), loc(j.location_id), d.contracts.find((c) => c.id === j.contract_id)?.name, j.priority !== 'Normal' && j.priority].filter(Boolean).join(' · ')}</div>
        </button>
      ))}
      {!list.length && <p className="muted">Nothing matches.</p>}
    </section>
  )
}
