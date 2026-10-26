import { useMemo, useState } from 'react'
import type { Data } from '../App'
import { send } from '../lib/offline'
import { loadSite, saveJob, type JobBundle } from '../lib/field'
import { kvGet } from '../lib/idb'
import { uuid } from '../lib/image'
import { today } from '../lib/dates'
import type { Assignment, Contract, Job } from '../types'

const usable = (c: Contract, day: string) =>
  c.active && (!c.start_date || c.start_date <= day) && (!c.end_date || c.end_date >= day)

// A technician dispatches a service call to themselves: the customer, the
// location and the contract it is worked under. Works without signal.
export default function NewCall({ d, onClose }: { d: Data; onClose: () => void }) {
  const day = today()
  const [customerId, setCustomerId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [contractId, setContractId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<'Normal' | 'High' | 'Emergency'>('Normal')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const locations = d.locations.filter((l) => l.customer_id === customerId)
  const contracts = useMemo(() => d.contracts.filter((c) => c.customer_id === customerId && usable(c, day)), [d.contracts, customerId, day])

  function pickCustomer(id: string) {
    setCustomerId(id)
    setLocationId('')
    const cs = d.contracts.filter((c) => c.customer_id === id && usable(c, day))
    setContractId(cs.length === 1 ? cs[0].id : '')
  }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    if (!locationId || !contractId) return setErr('Choose the customer, the location and the contract.')
    setBusy(true)
    const id = uuid()
    const location = d.locations.find((l) => l.id === locationId)!
    const customer = d.customers.find((c) => c.id === customerId)!
    const contract = d.contracts.find((c) => c.id === contractId)!
    // Number, status and customer are set by the server; the rest is what the technician chose.
    const row = { id, title: title.trim(), kind: 'ticket', location_id: locationId, contract_id: contractId, priority, description: description.trim(), self_dispatched: true, created_by: d.me.id }
    const r1 = await send({ kind: 'insert', table: 'jobs', values: row })
    if (r1.error) { setBusy(false); return setErr(r1.error) }
    const asg: Assignment = { id: uuid(), job_id: id, employee_id: d.me.id, work_date: day, is_lead: true }
    const r2 = await send({ kind: 'insert', table: 'job_assignments', values: { ...asg } })
    if (r2.error) { setBusy(false); return setErr(r2.error) }

    // Show it right away, even without signal.
    const job: Job = {
      id, number: 'New call', kind: 'ticket', title: row.title, customer_id: customerId, location_id: locationId,
      contract_id: contractId, created_by: d.me.id, self_dispatched: true, status: 'in_progress', priority, description: row.description,
      start_date: day, end_date: day, resolution: '', prevailing_wage: contract.prevailing_wage, close_override_reason: null, close_override_by: null, close_override_at: null,
    }
    const site = (await kvGet<{ equipment?: JobBundle['equipment'] }>(`site:${locationId}`)) ?? (await loadSite(locationId)).data
    const bundle: JobBundle = { job, location, customer, equipment: site?.equipment ?? [], jobEquip: [], assignments: [asg], checklist: [], parts: [], costs: {}, photos: [] }
    await saveJob(bundle)
    await d.addLocalJob(job, asg)
    setBusy(false)
    onClose()
    d.openJob(id)
    if (!r1.queued) d.reload()
  }

  return (
    <form className="card form" onSubmit={create}>
      <h2>New call for myself</h2>
      <p className="muted sm">Creates a service call, assigns it to you for today and starts it. The office sees it as self-dispatched.</p>
      <label>Customer
        <select value={customerId} onChange={(e) => pickCustomer(e.target.value)} required>
          <option value="">Choose…</option>
          {d.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label>Location
        <select value={locationId} onChange={(e) => setLocationId(e.target.value)} disabled={!customerId} required>
          <option value="">Choose…</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </label>
      <label>Contract this work is under
        <select value={contractId} onChange={(e) => setContractId(e.target.value)} disabled={!customerId} required>
          <option value="">Choose…</option>
          {contracts.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}
        </select>
      </label>
      {customerId && !contracts.length && <p className="err">This customer has no active contract. Ask the office to add one.</p>}
      <label>What is the problem?<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="No heat in boiler room" required /></label>
      <label>Details (optional)<textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <label>Priority
        <select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
          <option>Normal</option><option>High</option><option>Emergency</option>
        </select>
      </label>
      {err && <p className="err" role="alert">{err}</p>}
      <div className="row"><button className="btn primary" disabled={busy || !contractId}>{busy ? 'Creating…' : 'Create and start'}</button>
        <button type="button" className="btn" onClick={onClose}>Cancel</button></div>
    </form>
  )
}
