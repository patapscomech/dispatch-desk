import { describe, expect, it } from 'vitest'
import { drain, isNetworkError, type RunResult } from './offline'

const items = [1, 2, 3, 4].map((id) => ({ id, op: `op${id}` }))

describe('drain', () => {
  it('sends everything in order when all succeed', async () => {
    const seen: string[] = []
    const r = await drain(items, async (op) => { seen.push(op); return { status: 'ok' } })
    expect(seen).toEqual(['op1', 'op2', 'op3', 'op4'])
    expect(r).toEqual({ done: [1, 2, 3, 4], failed: [], stopped: false })
  })
  it('stops at the first network failure and keeps the rest waiting', async () => {
    const run = async (op: string): Promise<RunResult> => (op === 'op3' ? { status: 'network' } : { status: 'ok' })
    const r = await drain(items, run)
    expect(r.done).toEqual([1, 2])
    expect(r.stopped).toBe(true)
  })
  it('sets aside a refused change without blocking later ones', async () => {
    const run = async (op: string): Promise<RunResult> => (op === 'op2' ? { status: 'rejected', message: 'nope' } : { status: 'ok' })
    const r = await drain(items, run)
    expect(r.done).toEqual([1, 3, 4])
    expect(r.failed).toEqual([{ id: 2, op: 'op2', message: 'nope' }])
    expect(r.stopped).toBe(false)
  })
})

describe('isNetworkError', () => {
  it('recognizes dropped connections but not server refusals', () => {
    expect(isNetworkError('TypeError: Failed to fetch')).toBe(true)
    expect(isNetworkError('Load failed')).toBe(true)
    expect(isNetworkError('new row violates row-level security policy')).toBe(false)
    expect(isNetworkError('The checklist is not finished (2 items open).')).toBe(false)
  })
})
