import { useState } from 'react'
import { supabase } from '../supabase'
import type { Data } from '../App'
import { CLASSES, ROLE_LABEL, type Profile, type Role } from '../types'

export default function People({ d }: { d: Data }) {
  const [err, setErr] = useState('')
  const [names, setNames] = useState<Record<string, string>>({})

  async function save(p: Profile, patch: Partial<Profile>) {
    setErr('')
    const { error } = await supabase.from('profiles').update(patch).eq('id', p.id)
    if (error) setErr(error.message)
    d.reload()
  }
  const canChangeRole = (p: Profile) => d.me.role === 'owner' || (p.role !== 'owner')

  return (
    <section>
      <h2>People</h2>
      <p className="muted sm">
        To add someone: in Supabase open Authentication, then Users, then Add user (email and a starting password).
        They appear here as a technician; set their role and classification below.
      </p>
      {err && <p className="err" role="alert">{err}</p>}
      {d.people.map((p) => (
        <div className="card" key={p.id}>
          <div className="row">
            <input className="grow" aria-label="Name" value={names[p.id] ?? p.full_name}
              onChange={(e) => setNames({ ...names, [p.id]: e.target.value })}
              onBlur={() => names[p.id] !== undefined && names[p.id].trim() && names[p.id] !== p.full_name && save(p, { full_name: names[p.id].trim() })} />
            <label className="check"><input type="checkbox" checked={p.active} disabled={p.id === d.me.id} onChange={(e) => save(p, { active: e.target.checked })} /> Active</label>
          </div>
          <div className="muted sm">{p.email}</div>
          <div className="grid2">
            <label>Role
              <select value={p.role} disabled={!canChangeRole(p) || p.id === d.me.id}
                onChange={(e) => save(p, { role: e.target.value as Role })}>
                {(Object.keys(ROLE_LABEL) as Role[]).filter((r) => r !== 'owner' || d.me.role === 'owner').map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </label>
            <label>Classification
              <select value={p.classification} onChange={(e) => save(p, { classification: e.target.value })}>
                {CLASSES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
          </div>
        </div>
      ))}
    </section>
  )
}
