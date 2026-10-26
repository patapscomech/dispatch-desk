import { supabase } from '../supabase'
import { blobDel, blobGet, kvGet, kvSet, queueAdd, queueAll, queueDel } from './idb'

// Writes made without signal wait here and are sent, in order, when coverage returns.
export type Op =
  | { kind: 'insert' | 'upsert'; table: string; values: Record<string, unknown> | Record<string, unknown>[]; onConflict?: string }
  | { kind: 'update'; table: string; values: Record<string, unknown>; match: Record<string, unknown>; inIds?: { col: string; ids: string[] } }
  | { kind: 'delete'; table: string; match: Record<string, unknown> }
  | { kind: 'upload'; path: string; blobKey: string }

export type RunResult = { status: 'ok' } | { status: 'network' } | { status: 'rejected'; message: string }

export const isNetworkError = (msg: string) =>
  (typeof navigator !== 'undefined' && navigator.onLine === false) ||
  /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|aborted/i.test(msg)

export async function runOp(op: Op): Promise<RunResult> {
  try {
    if (op.kind === 'upload') {
      const blob = await blobGet(op.blobKey)
      if (!blob) return { status: 'ok' } // already sent or lost; nothing to do
      const { error } = await supabase.storage.from('job-files').upload(op.path, blob, { contentType: 'image/jpeg', upsert: true })
      if (error) return isNetworkError(error.message) ? { status: 'network' } : { status: 'rejected', message: error.message }
      await blobDel(op.blobKey)
      return { status: 'ok' }
    }
    let q
    if (op.kind === 'update') {
      let u = supabase.from(op.table).update(op.values).match(op.match)
      if (op.inIds) u = u.in(op.inIds.col, op.inIds.ids)
      q = u
    } else if (op.kind === 'delete') q = supabase.from(op.table).delete().match(op.match)
    else if (op.kind === 'upsert') q = supabase.from(op.table).upsert(op.values, op.onConflict ? { onConflict: op.onConflict } : undefined)
    else q = supabase.from(op.table).insert(op.values)
    const { error } = await q
    if (!error) return { status: 'ok' }
    if (error.code === '23505' && (op.kind === 'insert')) return { status: 'ok' } // already saved on an earlier try
    return isNetworkError(error.message) ? { status: 'network' } : { status: 'rejected', message: error.message }
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    return isNetworkError(m) ? { status: 'network' } : { status: 'rejected', message: m }
  }
}

// Pure queue logic (tested): send items in order, stop at the first network failure,
// set aside anything the server refuses so it cannot block the rest.
export async function drain<T>(
  items: { id: number; op: T }[],
  run: (op: T) => Promise<RunResult>,
): Promise<{ done: number[]; failed: { id: number; op: T; message: string }[]; stopped: boolean }> {
  const done: number[] = []
  const failed: { id: number; op: T; message: string }[] = []
  for (const it of items) {
    const r = await run(it.op)
    if (r.status === 'ok') done.push(it.id)
    else if (r.status === 'rejected') failed.push({ id: it.id, op: it.op, message: r.message })
    else return { done, failed, stopped: true }
  }
  return { done, failed, stopped: false }
}

// ---- status shown in the header ------------------------------------------
export interface SyncState { waiting: number; failed: { label: string; message: string }[]; online: boolean }
let state: SyncState = { waiting: 0, failed: [], online: typeof navigator === 'undefined' ? true : navigator.onLine }
const listeners = new Set<(s: SyncState) => void>()
const emit = (p: Partial<SyncState>) => { state = { ...state, ...p }; listeners.forEach((l) => l(state)) }
export const onSync = (cb: (s: SyncState) => void) => { listeners.add(cb); cb(state); return () => { listeners.delete(cb) } }
export const clearFailed = async () => { await kvSet('failed', []); emit({ failed: [] }) }

async function refreshCount() {
  emit({ waiting: (await queueAll()).length })
}
const opLabel = (op: Op) => (op.kind === 'upload' ? 'photo upload' : `${op.kind} ${op.table}`)

let flushing: Promise<void> | null = null
export function flush(): Promise<void> {
  if (flushing) return flushing
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve()
  flushing = (async () => {
    const items = await queueAll<Op>()
    if (items.length) {
      const r = await drain(items, runOp)
      for (const id of r.done) await queueDel(id)
      if (r.failed.length) {
        const old = (await kvGet<SyncState['failed']>('failed')) ?? []
        const next = [...old, ...r.failed.map((f) => ({ label: opLabel(f.op), message: f.message }))]
        await kvSet('failed', next)
        for (const f of r.failed) await queueDel(f.id)
        emit({ failed: next })
      }
    }
    await refreshCount()
  })().finally(() => { flushing = null })
  return flushing
}

// Try now; if there is no signal, keep it for later. Returns an error message only
// when the server itself refuses the change.
export async function send(op: Op): Promise<{ queued: boolean; error?: string }> {
  const pendingOps = await queueAll<Op>()
  if (!pendingOps.length && typeof navigator !== 'undefined' && navigator.onLine !== false) {
    const r = await runOp(op)
    if (r.status === 'ok') return { queued: false }
    if (r.status === 'rejected') return { queued: false, error: r.message }
  }
  await queueAdd(op)
  await refreshCount()
  return { queued: true }
}

export async function startSync() {
  emit({ failed: (await kvGet<SyncState['failed']>('failed')) ?? [] })
  await refreshCount()
  const go = () => { emit({ online: navigator.onLine }); if (navigator.onLine) flush() }
  window.addEventListener('online', go)
  window.addEventListener('offline', () => emit({ online: false }))
  setInterval(() => { if (navigator.onLine) flush() }, 30000)
  go()
}

// ---- saved data for working without signal ----------------------------------
// Fetch from the server and remember it; with no signal, return what was remembered.
export async function cached<T>(key: string, fetcher: () => Promise<T>): Promise<{ data: T | undefined; fromCache: boolean }> {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('offline')
    const data = await fetcher()
    await kvSet(key, data)
    return { data, fromCache: false }
  } catch {
    return { data: await kvGet<T>(key), fromCache: true }
  }
}
export const remember = (key: string, data: unknown) => kvSet(key, data)
