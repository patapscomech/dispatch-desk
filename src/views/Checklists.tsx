import { useState } from 'react'
import { supabase } from '../supabase'
import type { Data } from '../App'
import { parseLines } from '../lib/checklist'

export default function Checklists({ d }: { d: Data }) {
  const [name, setName] = useState('')
  const [body, setBody] = useState('')
  const [err, setErr] = useState('')
  const [editId, setEditId] = useState('')

  const preview = parseLines(body)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!preview.length) return setErr('Add at least one item.')
    const row = { name: name.trim(), body: body.trim() }
    const { error } = editId
      ? await supabase.from('checklist_templates').update(row).eq('id', editId)
      : await supabase.from('checklist_templates').insert(row)
    if (error) return setErr(error.message.includes('duplicate') ? 'A checklist with that name already exists.' : error.message)
    setName(''); setBody(''); setEditId(''); setErr('')
    d.reload()
  }
  async function remove(id: string) {
    if (!confirm('Delete this checklist template? Checklists already on calls are not affected.')) return
    const { error } = await supabase.from('checklist_templates').delete().eq('id', id)
    if (error) setErr(error.message)
    d.reload()
  }
  async function file(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setBody(await f.text())
    if (!name) setName(f.name.replace(/\.[^.]+$/, ''))
    e.target.value = ''
  }

  return (
    <section>
      <form className="card form" onSubmit={save}>
        <h2>{editId ? 'Edit checklist' : 'New or imported checklist'}</h2>
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label>Items, one per line
          <textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)}
            placeholder={'# Section heading\nReplace filters\nSupply air temp|value'} />
        </label>
        <div className="sm muted">Start a line with # for a section heading. End a line with |value for a reading the tech types in. You can also load a text file or a CSV with columns Section, Item and Type.</div>
        <input type="file" accept=".txt,.csv,text/plain,text/csv" onChange={file} aria-label="Load a checklist file" />
        {preview.length > 0 && (
          <div className="sm">Preview: {preview.filter((p) => p.kind !== 'head').length} items{preview.some((p) => p.kind === 'value') ? ` (${preview.filter((p) => p.kind === 'value').length} readings)` : ''}</div>
        )}
        {err && <p className="err" role="alert">{err}</p>}
        <div className="row"><button className="btn primary">Save checklist</button>
          {editId && <button type="button" className="btn" onClick={() => { setEditId(''); setName(''); setBody('') }}>Cancel</button>}</div>
      </form>

      {d.templates.map((t) => {
        const items = parseLines(t.body)
        return (
          <div className="card" key={t.id}>
            <div className="row between"><b>{t.name}</b>
              <div className="row"><button className="btn" onClick={() => { setEditId(t.id); setName(t.name); setBody(t.body); window.scrollTo({ top: 0 }) }}>Edit</button>
                <button className="btn ghost" onClick={() => remove(t.id)}>Delete</button></div></div>
            <div className="muted sm">{items.filter((i) => i.kind !== 'head').length} items</div>
          </div>
        )
      })}
    </section>
  )
}
