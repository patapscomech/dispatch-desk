import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabase'
import type { Data } from '../App'
import type { Contract, Equipment } from '../types'

export const EQUIP_TYPES = ['RTU', 'AHU', 'Chiller', 'Boiler', 'Pump', 'Cooling tower', 'Split system', 'VAV box', 'Exhaust fan', 'Backflow preventer', 'Water heater', 'Other']

export function EquipForm({ locationId, onDone, existing }: { locationId: string; onDone: () => void; existing?: Equipment }) {
  const [f, setF] = useState({
    tag: existing?.tag ?? '', type: existing?.type ?? 'RTU', make: existing?.make ?? '', model: existing?.model ?? '',
    serial: existing?.serial ?? '', area: existing?.area ?? '', install_year: existing?.install_year ? String(existing.install_year) : '',
    notes: existing?.notes ?? '',
  })
  const [err, setErr] = useState('')
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    const row = { ...f, tag: f.tag.trim(), install_year: f.install_year ? Number(f.install_year) : null, location_id: locationId }
    const { error } = existing
      ? await supabase.from('equipment').update(row).eq('id', existing.id)
      : await supabase.from('equipment').insert(row)
    if (error) return setErr(error.message.includes('duplicate') ? 'That tag is already used at this location.' : error.message)
    onDone()
  }
  return (
    <form className="card form" onSubmit={save}>
      <b>{existing ? 'Edit unit' : 'New unit'}</b>
      <div className="grid2">
        <label>Tag<input value={f.tag} onChange={set('tag')} placeholder="RTU-3" required /></label>
        <label>Type<select value={f.type} onChange={set('type')}>{EQUIP_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label>Make<input value={f.make} onChange={set('make')} /></label>
        <label>Model<input value={f.model} onChange={set('model')} /></label>
        <label>Serial<input value={f.serial} onChange={set('serial')} /></label>
        <label>Install year<input inputMode="numeric" value={f.install_year} onChange={set('install_year')} /></label>
      </div>
      <label>Where it is<input value={f.area} onChange={set('area')} placeholder="Roof, east wing" /></label>
      <label>Notes<textarea value={f.notes} onChange={set('notes')} rows={2} /></label>
      {err && <p className="err" role="alert">{err}</p>}
      <div className="row"><button className="btn primary">Save</button><button type="button" className="btn" onClick={onDone}>Cancel</button></div>
    </form>
  )
}

export default function Customers({ d }: { d: Data }) {
  const [custId, setCustId] = useState('')
  const [locId, setLocId] = useState('')
  const [equip, setEquip] = useState<Equipment[]>([])
  const [err, setErr] = useState('')
  const [name, setName] = useState('')
  const [loc, setLoc] = useState({ name: '', address: '', access_notes: '' })
  const [editing, setEditing] = useState<Equipment | 'new' | null>(null)
  const [k, setK] = useState({ name: '', type: 'Service', prevailing_wage: false, start_date: '', end_date: '' })

  const locs = d.locations.filter((l) => l.customer_id === custId)
  const loadEquip = useCallback(async () => {
    if (!locId) return setEquip([])
    const { data, error } = await supabase.from('equipment').select('*').eq('location_id', locId).order('tag')
    if (error) setErr(error.message)
    else setEquip(data as Equipment[])
  }, [locId])
  useEffect(() => { loadEquip() }, [loadEquip])

  async function addCustomer(e: React.FormEvent) {
    e.preventDefault()
    const { data, error } = await supabase.from('customers').insert({ name: name.trim() }).select().single()
    if (error) return setErr(error.message.includes('duplicate') ? 'That customer already exists.' : error.message)
    setName(''); setCustId(data.id); setLocId(''); setErr('')
    d.reload()
  }
  async function addLocation(e: React.FormEvent) {
    e.preventDefault()
    const { data, error } = await supabase.from('locations').insert({ ...loc, name: loc.name.trim(), customer_id: custId }).select().single()
    if (error) return setErr(error.message.includes('duplicate') ? 'That location already exists for this customer.' : error.message)
    setLoc({ name: '', address: '', access_notes: '' }); setLocId(data.id); setErr('')
    d.reload()
  }
  async function saveLoc(field: 'address' | 'access_notes' | 'name', value: string) {
    const { error } = await supabase.from('locations').update({ [field]: value }).eq('id', locId)
    if (error) setErr(error.message)
    else d.reload()
  }
  async function toggleActive(u: Equipment) {
    const { error } = await supabase.from('equipment').update({ active: !u.active }).eq('id', u.id)
    if (error) setErr(error.message)
    loadEquip()
  }

  const contractsOf = d.contracts.filter((c) => c.customer_id === custId)
  async function addContract(e: React.FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('contracts').insert({ customer_id: custId, name: k.name.trim(), type: k.type, prevailing_wage: k.prevailing_wage, start_date: k.start_date || null, end_date: k.end_date || null })
    if (error) return setErr(error.message.includes('duplicate') ? 'This customer already has a contract with that name.' : error.message)
    setK({ name: '', type: 'Service', prevailing_wage: false, start_date: '', end_date: '' }); setErr('')
    d.reload()
  }
  async function toggleContract(c: Contract) {
    const { error } = await supabase.from('contracts').update({ active: !c.active }).eq('id', c.id)
    if (error) setErr(error.message)
    d.reload()
  }
  const cur = d.locations.find((l) => l.id === locId)
  return (
    <section>
      <div className="card form">
        <label>Customer
          <select value={custId} onChange={(e) => { setCustId(e.target.value); setLocId(''); setEditing(null) }}>
            <option value="">Choose a customer…</option>
            {d.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <form className="row" onSubmit={addCustomer}>
          <input className="grow" placeholder="New customer name" value={name} onChange={(e) => setName(e.target.value)} required />
          <button className="btn">Add customer</button>
        </form>
      </div>
      {err && <p className="err" role="alert">{err}</p>}

      {custId && (
        <div className="card form">
          <b>Contracts</b>
          {contractsOf.map((c) => (
            <div className="row between" key={c.id} style={c.active ? undefined : { opacity: 0.6 }}>
              <span>{c.name} <span className="muted sm">· {c.type}{c.prevailing_wage ? ' · prevailing wage' : ''}{c.start_date || c.end_date ? ` · ${c.start_date ?? ''} to ${c.end_date ?? ''}` : ''}</span></span>
              <button className="btn ghost" onClick={() => toggleContract(c)}>{c.active ? 'Turn off' : 'Turn on'}</button>
            </div>
          ))}
          {!contractsOf.length && <div className="muted sm">No contracts yet. Technicians cannot create a call for this customer until it has an active contract. Rates and pricing are added in the billing phase.</div>}
          <form className="form" onSubmit={addContract}>
            <div className="grid2">
              <input placeholder="New contract name" value={k.name} onChange={(e) => setK({ ...k, name: e.target.value })} required />
              <select value={k.type} onChange={(e) => setK({ ...k, type: e.target.value })} aria-label="Contract type"><option>Service</option><option>Project</option><option>Emergency</option></select>
              <label>Starts<input type="date" value={k.start_date} onChange={(e) => setK({ ...k, start_date: e.target.value })} /></label>
              <label>Ends<input type="date" value={k.end_date} onChange={(e) => setK({ ...k, end_date: e.target.value })} /></label>
            </div>
            <label className="check"><input type="checkbox" checked={k.prevailing_wage} onChange={(e) => setK({ ...k, prevailing_wage: e.target.checked })} /> Prevailing wage contract</label>
            <button className="btn">Add contract</button>
          </form>
        </div>
      )}

      {custId && (
        <div className="card form">
          <label>Location
            <select value={locId} onChange={(e) => { setLocId(e.target.value); setEditing(null) }}>
              <option value="">Choose a location…</option>
              {locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <form className="form" onSubmit={addLocation}>
            <div className="grid2">
              <input placeholder="New location name" value={loc.name} onChange={(e) => setLoc({ ...loc, name: e.target.value })} required />
              <input placeholder="Address" value={loc.address} onChange={(e) => setLoc({ ...loc, address: e.target.value })} />
            </div>
            <input placeholder="Access notes (gate codes, who to check in with)" value={loc.access_notes} onChange={(e) => setLoc({ ...loc, access_notes: e.target.value })} />
            <button className="btn">Add location</button>
          </form>
        </div>
      )}

      {cur && (
        <>
          <div className="card form" key={cur.id}>
            <b>{cur.name}</b>
            <label>Address<input defaultValue={cur.address} onBlur={(e) => e.target.value !== cur.address && saveLoc('address', e.target.value)} /></label>
            <label>Access notes<textarea rows={2} defaultValue={cur.access_notes} onBlur={(e) => e.target.value !== cur.access_notes && saveLoc('access_notes', e.target.value)} /></label>
          </div>
          <div className="row between"><h2>Equipment ({equip.filter((u) => u.active).length})</h2><button className="btn" onClick={() => setEditing('new')}>Add unit</button></div>
          {editing && <EquipForm locationId={cur.id} existing={editing === 'new' ? undefined : editing} onDone={() => { setEditing(null); loadEquip() }} />}
          {equip.map((u) => (
            <div className="card" key={u.id} style={u.active ? undefined : { opacity: 0.6 }}>
              <div className="row between">
                <div><b>{u.tag}</b> · {u.type}<div className="muted sm">{[u.make, u.model, u.serial && 'S/N ' + u.serial, u.area, u.install_year].filter(Boolean).join(' · ')}</div></div>
                <div className="row"><button className="btn" onClick={() => setEditing(u)}>Edit</button><button className="btn ghost" onClick={() => toggleActive(u)}>{u.active ? 'Retire' : 'Restore'}</button></div>
              </div>
            </div>
          ))}
          {!equip.length && <p className="muted">No equipment yet. Technicians can also add units on site.</p>}
        </>
      )}
    </section>
  )
}
