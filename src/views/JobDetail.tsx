import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'
import type { Data } from '../App'
import { flush, send, type Op } from '../lib/offline'
import { blobGet, blobSet } from '../lib/idb'
import { loadJob, loadSite, saveJob, type JobBundle, type SiteHistory } from '../lib/field'
import { openCount, parseLines } from '../lib/checklist'
import { shrink, uuid } from '../lib/image'
import { fmtDay } from '../lib/dates'
import { isApprover, isOffice, PART_SOURCES, STATUS_LABEL, type JobStatus } from '../types'
import { EQUIP_TYPES } from './Customers'

type Tab = 'overview' | 'history' | 'checklist' | 'parts' | 'photos' | 'hours'
const needsInvoice = (s: string) => s === 'Purchased' || s === 'Supplier PO'
const PHOTO_KINDS = ['before', 'during', 'after', 'issue', 'nameplate'] as const

function Thumb({ photoId, path }: { photoId: string; path: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let url = ''
    let live = true
    ;(async () => {
      const local = await blobGet(`photo:${photoId}`)
      if (local && live) { url = URL.createObjectURL(local); setSrc(url); return }
      const { data } = await supabase.storage.from('job-files').createSignedUrl(path, 3600)
      if (live && data?.signedUrl) setSrc(data.signedUrl)
    })().catch(() => {})
    return () => { live = false; if (url) URL.revokeObjectURL(url) }
  }, [photoId, path])
  return src ? <img src={src} alt="" loading="lazy" /> : <div className="ph">Saved offline<br />shows when online</div>
}

export default function JobDetail({ d, id, onClose }: { d: Data; id: string; onClose: () => void }) {
  const [b, setB] = useState<JobBundle | null>(null)
  const ref = useRef<JobBundle | null>(null)
  const [site, setSite] = useState<SiteHistory | null>(null)
  const [fromCache, setFromCache] = useState(false)
  const [tab, setTab] = useState<Tab>('overview')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [override, setOverride] = useState<{ reason: string } | null>(null)
  const [newUnit, setNewUnit] = useState({ tag: '', type: 'RTU' })
  const [part, setPart] = useState({ description: '', qty: '1', source: 'Stock', vendor: '', cost: '' })
  const [partFile, setPartFile] = useState<File | null>(null)
  const [kind, setKind] = useState<(typeof PHOTO_KINDS)[number]>('during')
  const [unitFor, setUnitFor] = useState('')
  const [histUnit, setHistUnit] = useState('')

  const load = useCallback(async () => {
    await flush()
    const r = await loadJob(id)
    if (r.data) { ref.current = r.data; setB(r.data) }
    else setErr('This call is not saved on the phone yet. Open it once with signal.')
    setFromCache(r.fromCache)
    if (r.data?.job.location_id) { const s = await loadSite(r.data.job.location_id); if (s.data) setSite(s.data) }
  }, [id])
  useEffect(() => { load() }, [load])

  function change(mut: (x: JobBundle) => JobBundle) {
    if (!ref.current) return
    const n = mut(ref.current)
    ref.current = n
    setB(n)
    saveJob(n)
  }
  async function push(op: Op) {
    const r = await send(op)
    if (r.error) { setErr(r.error); await load() } else setErr('')
    return r
  }

  if (!b) return <div className="overlay"><div className="app"><button className="btn" onClick={onClose}>‹ Back</button><p className={err ? 'err' : 'muted'}>{err || 'Loading…'}</p></div></div>

  const { job, location, customer } = b
  const me = d.me
  const office = isOffice(me.role)
  const assigned = b.assignments.some((a) => a.employee_id === me.id)
  const canEdit = office || isApprover(me.role) || assigned
  const open = openCount(b.checklist)
  const nm = (eid: string) => d.people.find((p) => p.id === eid)?.full_name ?? '?'

  // ---- status ----
  async function setStatus(s: JobStatus, reason?: string) {
    setMsg('')
    if ((s === 'complete' || s === 'closed') && open > 0 && !reason && !job.close_override_reason) {
      if (office) { setOverride({ reason: '' }); return }
      setErr(`The checklist has ${open} open items. Finish it before completing this call.`)
      return
    }
    setErr('')
    const patch: Record<string, unknown> = { status: s }
    if (reason) patch.close_override_reason = reason
    change((x) => ({ ...x, job: { ...x.job, status: s, ...(reason ? { close_override_reason: reason, close_override_by: me.id, close_override_at: new Date().toISOString() } : {}) } }))
    setOverride(null)
    await push({ kind: 'update', table: 'jobs', values: patch, match: { id } })
    d.reload()
  }

  // ---- checklist ----
  async function attach(templateId: string) {
    const t = d.templates.find((x) => x.id === templateId)
    if (!t) return
    const items = parseLines(t.body)
    const start = b!.checklist.reduce((m, c) => Math.max(m, c.position), 0)
    const rows = items.map((it, i) => ({ id: uuid(), job_id: id, position: start + i + 1, kind: it.kind, text: it.text, done: false, value: '' }))
    change((x) => ({ ...x, checklist: [...x.checklist, ...rows] }))
    await push({ kind: 'insert', table: 'job_checklist_items', values: rows })
    if (job.status === 'complete' && !job.close_override_reason) await setStatus('in_progress')
  }
  async function tick(item: JobBundle['checklist'][number], patch: { done?: boolean; value?: string }) {
    const next = { ...item, ...patch }
    const wasDone = item.kind === 'value' ? item.value.trim() !== '' : item.done
    const isDone = item.kind === 'value' ? next.value.trim() !== '' : next.done
    change((x) => ({
      ...x,
      checklist: x.checklist.map((c) => (c.id === item.id ? next : c)),
      job: wasDone && !isDone && x.job.status === 'complete' && !x.job.close_override_reason ? { ...x.job, status: 'in_progress' } : x.job,
    }))
    await push({ kind: 'update', table: 'job_checklist_items', values: patch, match: { id: item.id } })
  }

  // ---- equipment worked on ----
  async function toggleUnit(eid: string, on: boolean) {
    if (on) {
      change((x) => ({ ...x, jobEquip: [...x.jobEquip, { job_id: id, equipment_id: eid, findings: '' }] }))
      await push({ kind: 'upsert', table: 'job_equipment', values: { job_id: id, equipment_id: eid, findings: '' }, onConflict: 'job_id,equipment_id' })
    } else {
      change((x) => ({ ...x, jobEquip: x.jobEquip.filter((j) => j.equipment_id !== eid) }))
      await push({ kind: 'delete', table: 'job_equipment', match: { job_id: id, equipment_id: eid } })
    }
  }
  async function findings(eid: string, text: string) {
    change((x) => ({ ...x, jobEquip: x.jobEquip.map((j) => (j.equipment_id === eid ? { ...j, findings: text } : j)) }))
    await push({ kind: 'update', table: 'job_equipment', values: { findings: text }, match: { job_id: id, equipment_id: eid } })
  }
  async function resolution(text: string) {
    if (text === job.resolution) return
    change((x) => ({ ...x, job: { ...x.job, resolution: text } }))
    await push({ kind: 'update', table: 'jobs', values: { resolution: text }, match: { id } })
  }
  async function addUnit(e: React.FormEvent) {
    e.preventDefault()
    if (!job.location_id || !newUnit.tag.trim()) return
    const row = { id: uuid(), location_id: job.location_id, tag: newUnit.tag.trim(), type: newUnit.type, make: '', model: '', serial: '', area: '', install_year: null, notes: '', active: true }
    change((x) => ({ ...x, equipment: [...x.equipment, row].sort((a, c) => a.tag.localeCompare(c.tag)) }))
    setNewUnit({ tag: '', type: 'RTU' })
    await push({ kind: 'insert', table: 'equipment', values: row })
    await toggleUnit(row.id, true)
  }

  // ---- parts ----
  async function addPart(e: React.FormEvent) {
    e.preventDefault()
    const pid = uuid()
    const needs = needsInvoice(part.source)
    const path = partFile ? `${id}/inv-${pid}.jpg` : null
    const row = { id: pid, job_id: id, description: part.description.trim(), qty: Number(part.qty) || 1, source: part.source as (typeof PART_SOURCES)[number], vendor: part.vendor.trim(), invoice_path: path, created_by: me.id }
    change((x) => ({ ...x, parts: [...x.parts, row] }))
    await push({ kind: 'insert', table: 'job_parts', values: row })
    if (part.cost) await push({ kind: 'insert', table: 'job_part_costs', values: { part_id: pid, unit_cost: Number(part.cost) } })
    if (partFile && path) {
      await blobSet(`photo:inv-${pid}`, await shrink(partFile))
      await push({ kind: 'upload', path, blobKey: `photo:inv-${pid}` })
    }
    setPart({ description: '', qty: '1', source: 'Stock', vendor: '', cost: '' }); setPartFile(null)
    if (needs && !partFile) setMsg('Saved. This part still needs a photo of its invoice or receipt.')
  }
  async function attachInvoice(pid: string, file: File) {
    const path = `${id}/inv-${pid}.jpg`
    await blobSet(`photo:inv-${pid}`, await shrink(file))
    change((x) => ({ ...x, parts: x.parts.map((p) => (p.id === pid ? { ...p, invoice_path: path } : p)) }))
    await push({ kind: 'upload', path, blobKey: `photo:inv-${pid}` })
    await push({ kind: 'update', table: 'job_parts', values: { invoice_path: path }, match: { id: pid } })
  }
  async function removePart(pid: string) {
    change((x) => ({ ...x, parts: x.parts.filter((p) => p.id !== pid) }))
    await push({ kind: 'delete', table: 'job_parts', match: { id: pid } })
  }

  // ---- photos ----
  async function addPhotos(files: FileList | null) {
    if (!files) return
    for (const f of Array.from(files)) {
      const pid = uuid()
      const path = `${id}/${pid}.jpg`
      await blobSet(`photo:${pid}`, await shrink(f))
      const row = { id: pid, job_id: id, equipment_id: unitFor || null, kind, caption: '', path }
      change((x) => ({ ...x, photos: [...x.photos, row] }))
      await push({ kind: 'upload', path, blobKey: `photo:${pid}` })
      await push({ kind: 'insert', table: 'job_photos', values: { ...row, taken_by: me.id } })
    }
  }
  async function removePhoto(pid: string) {
    change((x) => ({ ...x, photos: x.photos.filter((p) => p.id !== pid) }))
    await push({ kind: 'delete', table: 'job_photos', match: { id: pid } })
  }

  // ---- history ----
  const hist = site
  const jobsAt = (hist?.jobs ?? []).filter((j) => j.id !== id)
  const unitVisits = hist ? hist.jobEquip.filter((je) => je.equipment_id === histUnit && je.job_id !== id) : []
  const jobById = (jid: string) => hist?.jobs.find((j) => j.id === jid)
  const partsOf = (jid: string) => (hist?.parts ?? []).filter((p) => p.job_id === jid)
  const when = (j: { start_date: string | null; end_date: string | null }) => (j.end_date ?? j.start_date) ? fmtDay((j.end_date ?? j.start_date)!) : 'undated'

  const tabs: [Tab, string][] = [['overview', 'Overview'], ['history', 'History'], ['checklist', `Checklist${open ? ` (${open})` : ''}`], ['parts', 'Parts'], ['photos', 'Photos'], ['hours', 'Hours']]
  const statuses: JobStatus[] = office ? ['unassigned', 'scheduled', 'in_progress', 'on_hold', 'complete', 'closed'] : ['in_progress', 'on_hold', 'complete']
  if (!statuses.includes(job.status)) statuses.unshift(job.status)

  return (
    <div className="overlay">
      <div className="app">
        <div className="bar"><button className="btn" onClick={() => { onClose(); d.reload() }}>‹ Back</button>
          <div className="grow"><b>{job.number}</b> · {job.title}</div></div>
        {fromCache && <p className="warn">Working without signal. Changes are saved on this phone and sent when you are back in coverage.</p>}
        {err && <p className="err" role="alert">{err}</p>}
        {msg && <p className="warn" role="status">{msg}</p>}

        <div className="card">
          <div className="row between">
            <span className="sm">{customer?.name}{location ? ' · ' + location.name : ''}</span>
            {canEdit
              ? <select aria-label="Status" value={job.status} onChange={(e) => setStatus(e.target.value as JobStatus)} style={{ width: 'auto' }}>
                  {statuses.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
              : <span className={'pill st-' + job.status}>{STATUS_LABEL[job.status]}</span>}
          </div>
          {(() => {
            const k = d.contracts.find((c) => c.id === job.contract_id)
            const opts = d.contracts.filter((c) => c.customer_id === job.customer_id && (c.active || c.id === job.contract_id))
            return office
              ? <label className="inline sm">Contract
                  <select value={job.contract_id ?? ''} style={{ width: 'auto' }} onChange={(e) => { const v = e.target.value || null; change((x) => ({ ...x, job: { ...x.job, contract_id: v } })); push({ kind: 'update', table: 'jobs', values: { contract_id: v }, match: { id } }) }}>
                    <option value="">None</option>{opts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              : <div className="sm muted">{k ? `Contract: ${k.name}` : 'No contract on this call'}</div>
          })()}
          {job.self_dispatched && <div className="sm muted">Created by {nm(job.created_by ?? '')} for themselves</div>}
          {location?.address && <div className="sm muted">{location.address}</div>}
          {location?.access_notes && <div className="sm"><b>Access:</b> {location.access_notes}</div>}
          {open > 0 && job.status !== 'complete' && job.status !== 'closed' && (
            <div className="warn">Checklist: {open} items open. The call cannot be completed until they are done.</div>
          )}
        </div>
        {override && (
          <form className="card form" onSubmit={(e) => { e.preventDefault(); setStatus('complete', override.reason.trim()) }}>
            <b>Close with {open} checklist items open</b>
            <label>Reason (saved on the call and shown on the invoice screen)
              <textarea rows={2} value={override.reason} onChange={(e) => setOverride({ reason: e.target.value })} required /></label>
            <div className="row"><button className="btn primary" disabled={!override.reason.trim()}>Close anyway</button>
              <button type="button" className="btn" onClick={() => setOverride(null)}>Cancel</button></div>
          </form>
        )}

        <nav className="tabs" aria-label="Call sections">
          {tabs.map(([t, l]) => <button key={t} className={t === tab ? 'tab on' : 'tab'} onClick={() => setTab(t)}>{l}</button>)}
        </nav>

        {tab === 'overview' && (
          <section>
            {job.description && <div className="card"><b>What needs doing</b><div style={{ whiteSpace: 'pre-wrap' }}>{job.description}</div></div>}
            <div className="card">
              <b>Crew</b>
              {[...new Set(b.assignments.map((a) => a.employee_id))].map((eid) => {
                const days = b.assignments.filter((a) => a.employee_id === eid).map((a) => fmtDay(a.work_date))
                return <div className="sm" key={eid}>{nm(eid)}{b.assignments.some((a) => a.employee_id === eid && a.is_lead) ? ' (lead)' : ''} <span className="muted">· {days.length > 3 ? `${days[0]} to ${days[days.length - 1]}` : days.join(', ')}</span></div>
              })}
              {!b.assignments.length && <div className="muted sm">No one assigned yet.</div>}
            </div>
            {job.close_override_reason && (
              <div className="card warnbox"><b>Closed with checklist items open</b>
                <div className="sm">{job.close_override_reason}</div>
                <div className="sm muted">{job.close_override_by ? nm(job.close_override_by) : ''}{job.close_override_at ? ' · ' + new Date(job.close_override_at).toLocaleString() : ''}</div></div>
            )}
            <div className="card form">
              <b>Equipment worked on</b>
              {b.equipment.filter((u) => u.active || b.jobEquip.some((j) => j.equipment_id === u.id)).map((u) => {
                const je = b.jobEquip.find((j) => j.equipment_id === u.id)
                return (
                  <div key={u.id} className="stack">
                    <label className="check"><input type="checkbox" disabled={!canEdit} checked={!!je} onChange={(e) => toggleUnit(u.id, e.target.checked)} />
                      <span><b>{u.tag}</b> {u.type}<span className="muted sm"> {[u.make, u.model, u.area].filter(Boolean).join(' · ')}</span></span></label>
                    {je && <textarea rows={2} placeholder="Findings on this unit" defaultValue={je.findings} disabled={!canEdit}
                      onBlur={(e) => e.target.value !== je.findings && findings(u.id, e.target.value)} />}
                  </div>
                )
              })}
              {!b.equipment.length && <div className="muted sm">No equipment on file for this site.</div>}
              {canEdit && job.location_id && (
                <form className="row" onSubmit={addUnit}>
                  <input className="grow" aria-label="Tag for a unit not listed" placeholder="Add a unit: tag, e.g. RTU-7" value={newUnit.tag} onChange={(e) => setNewUnit({ ...newUnit, tag: e.target.value })} />
                  <select value={newUnit.type} onChange={(e) => setNewUnit({ ...newUnit, type: e.target.value })} style={{ width: 'auto' }}>{EQUIP_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
                  <button className="btn">Add</button>
                </form>
              )}
            </div>
            <label className="card form">Work performed
              <textarea rows={3} defaultValue={job.resolution} disabled={!canEdit} onBlur={(e) => resolution(e.target.value)} placeholder="What was done, what is left" />
            </label>
            {job.kind === 'project' && office && <TaskAdder d={d} jobId={id} />}
          </section>
        )}

        {tab === 'history' && (
          <section>
            {!site && <p className="muted">{job.location_id ? 'History is not saved on this phone yet. Open this call once with signal.' : 'This call has no location.'}</p>}
            {site && (
              <>
                <div className="chips">
                  <button className={!histUnit ? 'chipsel on' : 'chipsel'} onClick={() => setHistUnit('')}>Whole site</button>
                  {site.equipment.map((u) => <button key={u.id} className={histUnit === u.id ? 'chipsel on' : 'chipsel'} onClick={() => setHistUnit(u.id)}>{u.tag}</button>)}
                </div>
                {histUnit && (() => {
                  const u = site.equipment.find((x) => x.id === histUnit)!
                  return <div className="card"><b>{u.tag}</b> · {u.type}
                    <div className="sm muted">{[u.make, u.model, u.serial && 'S/N ' + u.serial, u.area, u.install_year && 'installed ' + u.install_year].filter(Boolean).join(' · ')}</div>
                    {u.notes && <div className="sm">{u.notes}</div>}</div>
                })()}
                {histUnit
                  ? unitVisits.map((v) => {
                      const j = jobById(v.job_id)
                      if (!j) return null
                      return (
                        <div className="card" key={v.job_id}>
                          <div className="row between"><b>{j.number} · {j.title}</b><span className="sm muted">{when(j)}</span></div>
                          {v.findings && <div><span className="sm muted">Findings:</span> {v.findings}</div>}
                          {j.resolution && <div><span className="sm muted">Work done:</span> {j.resolution}</div>}
                          {partsOf(j.id).length > 0 && <div className="sm muted">Parts: {partsOf(j.id).map((p) => `${p.qty} × ${p.description}`).join(', ')}</div>}
                        </div>
                      )
                    })
                  : jobsAt.map((j) => (
                      <div className="card" key={j.id}>
                        <div className="row between"><b>{j.number} · {j.title}</b><span className="sm muted">{when(j)}</span></div>
                        <div className="sm muted">{STATUS_LABEL[j.status]}{site.jobEquip.filter((x) => x.job_id === j.id).length ? ' · Units: ' + site.jobEquip.filter((x) => x.job_id === j.id).map((x) => site.equipment.find((e) => e.id === x.equipment_id)?.tag).filter(Boolean).join(', ') : ''}</div>
                        {j.resolution && <div>{j.resolution}</div>}
                      </div>
                    ))}
                {((histUnit && !unitVisits.length) || (!histUnit && !jobsAt.length)) && <p className="muted">No earlier visits recorded{histUnit ? ' for this unit' : ' at this site'}.</p>}
                {fromCache && <p className="muted sm">Saved on this phone.</p>}
              </>
            )}
          </section>
        )}

        {tab === 'checklist' && (
          <section>
            {b.checklist.length > 0 && <div className="sm muted">{open ? `${open} items left` : 'All items done'}</div>}
            {b.checklist.map((c) => c.kind === 'head'
              ? <h2 key={c.id} className="clhead">{c.text}</h2>
              : c.kind === 'check'
                ? <label key={c.id} className="card check cl"><input type="checkbox" checked={c.done} disabled={!canEdit} onChange={(e) => tick(c, { done: e.target.checked })} />{c.text}</label>
                : <label key={c.id} className="card cl">{c.text}
                    <input defaultValue={c.value} disabled={!canEdit} inputMode="decimal" placeholder="Enter reading" onBlur={(e) => e.target.value.trim() !== c.value && tick(c, { value: e.target.value.trim() })} /></label>)}
            {canEdit && (
              <div className="card form"><b>Add a checklist</b>
                <div className="row"><select id="tpl" className="grow" defaultValue="">
                  <option value="">Choose…</option>{d.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
                  <button className="btn" onClick={() => { const el = document.getElementById('tpl') as HTMLSelectElement; if (el.value) { attach(el.value); el.value = '' } }}>Attach</button></div>
              </div>
            )}
          </section>
        )}

        {tab === 'parts' && (
          <section>
            {msg && null}
            {b.parts.map((p) => (
              <div className="card" key={p.id}>
                <div className="row between"><div><b>{p.qty} × {p.description}</b><div className="sm muted">{p.source}{p.vendor ? ' · ' + p.vendor : ''}{office && b.costs[p.id] != null ? ` · $${b.costs[p.id].toFixed(2)} each` : ''}</div></div>
                  {canEdit && <button className="btn ghost" aria-label="Remove part" onClick={() => removePart(p.id)}>✕</button>}</div>
                {needsInvoice(p.source) && (p.invoice_path
                  ? <div className="sm" style={{ color: 'var(--ok)' }}>Invoice attached</div>
                  : <div className="row"><span className="sm warn-t">Needs a photo of the invoice or receipt</span>
                      {canEdit && <label className="btn filebtn">Add photo<input type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && attachInvoice(p.id, e.target.files[0])} /></label>}</div>)}
              </div>
            ))}
            {!b.parts.length && <p className="muted">No parts recorded yet.</p>}
            {canEdit && (
              <form className="card form" onSubmit={addPart}>
                <b>Add a part</b>
                <label>Description<input value={part.description} onChange={(e) => setPart({ ...part, description: e.target.value })} required /></label>
                <div className="grid2">
                  <label>Quantity<input inputMode="decimal" value={part.qty} onChange={(e) => setPart({ ...part, qty: e.target.value })} /></label>
                  <label>Source<select value={part.source} onChange={(e) => setPart({ ...part, source: e.target.value })}>{PART_SOURCES.map((s) => <option key={s}>{s}</option>)}</select></label>
                  <label>Vendor<input value={part.vendor} onChange={(e) => setPart({ ...part, vendor: e.target.value })} /></label>
                  {part.source !== 'Stock' && <label>Cost each ($)<input inputMode="decimal" value={part.cost} onChange={(e) => setPart({ ...part, cost: e.target.value })} /></label>}
                </div>
                {needsInvoice(part.source) && (
                  <label>Invoice or receipt photo
                    <input type="file" accept="image/*" capture="environment" onChange={(e) => setPartFile(e.target.files?.[0] ?? null)} /></label>
                )}
                {part.source === 'Subcontractor' && <div className="sm muted">Subcontractor entries need no invoice.</div>}
                <button className="btn primary">Add part</button>
              </form>
            )}
          </section>
        )}

        {tab === 'photos' && (
          <section>
            {canEdit && (
              <div className="card form">
                <div className="grid2">
                  <label>Type<select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>{PHOTO_KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
                  <label>Unit (optional)<select value={unitFor} onChange={(e) => setUnitFor(e.target.value)}><option value="">None</option>{b.equipment.map((u) => <option key={u.id} value={u.id}>{u.tag}</option>)}</select></label>
                </div>
                <label className="btn primary filebtn">Take or choose photos
                  <input type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { addPhotos(e.target.files); e.target.value = '' }} /></label>
              </div>
            )}
            <div className="photos">
              {b.photos.map((p) => (
                <figure key={p.id}><Thumb photoId={p.id} path={p.path} />
                  <figcaption className="sm">{p.kind}{p.equipment_id ? ' · ' + (b.equipment.find((u) => u.id === p.equipment_id)?.tag ?? '') : ''}
                    {office && <button className="btn ghost" aria-label="Delete photo" onClick={() => removePhoto(p.id)}>✕</button>}</figcaption></figure>
              ))}
            </div>
            {!b.photos.length && <p className="muted">No photos yet.</p>}
          </section>
        )}

        {tab === 'hours' && <JobHours d={d} jobId={id} />}
      </div>
    </div>
  )
}

function TaskAdder({ d, jobId }: { d: Data; jobId: string }) {
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  async function add(e: React.FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('job_tasks').insert({ job_id: jobId, name: name.trim() })
    if (error) return setErr(error.message.includes('duplicate') ? 'That task already exists.' : error.message)
    setName(''); setErr(''); d.reload()
  }
  return (
    <form className="card form" onSubmit={add}>
      <b>Project tasks</b>
      <div className="sm">{d.tasks.filter((t) => t.job_id === jobId).map((t) => t.name).join(', ') || <span className="muted">None yet</span>}</div>
      <div className="row"><input className="grow" placeholder="New task" value={name} onChange={(e) => setName(e.target.value)} required /><button className="btn">Add task</button></div>
      {err && <p className="err">{err}</p>}
    </form>
  )
}

function JobHours({ d, jobId }: { d: Data; jobId: string }) {
  const [rows, setRows] = useState<{ id: string; work_date: string; hours: number; pay_type: string; employee_id: string; status: string }[] | null>(null)
  useEffect(() => {
    supabase.from('time_entries').select('id,work_date,hours,pay_type,employee_id,status').eq('job_id', jobId).order('work_date')
      .then(({ data }) => setRows((data as typeof rows) ?? []), () => setRows([]))
  }, [jobId])
  const total = (rows ?? []).reduce((s, r) => s + Number(r.hours), 0)
  return (
    <section>
      <button className="btn primary" onClick={() => d.goHours(jobId)}>Add my hours to this call</button>
      {rows === null && <p className="muted">Loading…</p>}
      {rows && !rows.length && <p className="muted">No hours on this call yet (or you are offline).</p>}
      {rows && rows.length > 0 && <div className="sm muted">{isApprover(d.me.role) ? 'All hours' : 'Your hours'}: {Math.round(total * 100) / 100} h</div>}
      {(rows ?? []).map((r) => (
        <div className="card row between" key={r.id}>
          <span>{fmtDay(r.work_date)} · {d.people.find((p) => p.id === r.employee_id)?.full_name}</span>
          <span className="num">{Number(r.hours)} h {r.pay_type === 'ot' ? 'OT' : ''}</span>
        </div>
      ))}
    </section>
  )
}
