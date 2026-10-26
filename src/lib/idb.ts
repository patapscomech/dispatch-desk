// Tiny promise wrapper over IndexedDB: a key-value store, a write queue and a blob store.
const NAME = 'dispatch-desk'
let dbp: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(NAME, 1)
      r.onupgradeneeded = () => {
        const db = r.result
        db.createObjectStore('kv')
        db.createObjectStore('queue', { autoIncrement: true })
        db.createObjectStore('blobs')
      }
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
  }
  return dbp
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  try {
    const db = await open()
    return await new Promise<T>((res, rej) => {
      const req = fn(db.transaction(store, mode).objectStore(store))
      req.onsuccess = () => res(req.result)
      req.onerror = () => rej(req.error)
    })
  } catch (e) {
    // Private browsing or blocked storage: behave as an empty store.
    return undefined as T
  }
}

export const kvGet = <T>(k: string) => tx<T | undefined>('kv', 'readonly', (s) => s.get(k))
export const kvSet = (k: string, v: unknown) => tx('kv', 'readwrite', (s) => s.put(v, k))
export const blobGet = (k: string) => tx<Blob | undefined>('blobs', 'readonly', (s) => s.get(k))
export const blobSet = (k: string, v: Blob) => tx('blobs', 'readwrite', (s) => s.put(v, k))
export const blobDel = (k: string) => tx('blobs', 'readwrite', (s) => s.delete(k))

export async function queueAll<T>(): Promise<{ id: number; op: T }[]> {
  try {
    const db = await open()
    return await new Promise((res, rej) => {
      const out: { id: number; op: T }[] = []
      const req = db.transaction('queue', 'readonly').objectStore('queue').openCursor()
      req.onsuccess = () => {
        const c = req.result
        if (c) { out.push({ id: c.key as number, op: c.value as T }); c.continue() } else res(out)
      }
      req.onerror = () => rej(req.error)
    })
  } catch {
    return []
  }
}
export const queueAdd = (op: unknown) => tx('queue', 'readwrite', (s) => s.add(op))
export const queueDel = (id: number) => tx('queue', 'readwrite', (s) => s.delete(id))
