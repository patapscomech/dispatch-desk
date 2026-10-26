import { describe, expect, it } from 'vitest'
import { buildSheet, payrollCsv, toCsv, totalsOf } from './timesheet'
import { addDays, weekDays, weekStart } from './dates'
import type { Entry, Profile } from '../types'

const e = (o: Partial<Entry>): Entry => ({
  id: Math.random().toString(),
  employee_id: 'a',
  work_date: '2026-10-19',
  hours: 1,
  pay_type: 'regular',
  job_id: null,
  task_id: null,
  notes: '',
  status: 'approved',
  classification: 'Journeyman',
  prevailing_wage: false,
  ...o,
})

describe('totals', () => {
  it('splits regular, overtime, job, shop and prevailing wage', () => {
    const t = totalsOf([
      e({ hours: 8, job_id: 'j1', prevailing_wage: true }),
      e({ hours: 2, job_id: 'j1', pay_type: 'ot', prevailing_wage: true }),
      e({ hours: 1.5 }),
      e({ hours: 0.25, job_id: 'j2' }),
    ])
    expect(t).toEqual({ regular: 9.75, ot: 2, job: 10.25, shop: 1.5, pw: 10, total: 11.75 })
  })
  it('does not drift on floating point sums', () => {
    expect(totalsOf([e({ hours: 0.1 }), e({ hours: 0.2 })]).total).toBe(0.3)
  })
})

describe('sheet', () => {
  const days = weekDays('2026-10-19')
  const label = (j: string | null, t: string | null) => (j ? `Job ${j}${t ? ' / ' + t : ''}` : 'Shop time')
  it('groups by job and task with shop last and daily totals', () => {
    const s = buildSheet(
      [
        e({ job_id: 'J2', hours: 3 }),
        e({ job_id: 'J1', task_id: 'T', hours: 4, work_date: '2026-10-20' }),
        e({ hours: 1 }),
        e({ job_id: 'J2', hours: 2, work_date: '2026-10-20' }),
      ],
      days,
      label,
    )
    expect(s.rows.map((r) => r.label)).toEqual(['Job J1 / T', 'Job J2', 'Shop time'])
    expect(s.dayTotals['2026-10-19']).toBe(4)
    expect(s.dayTotals['2026-10-20']).toBe(6)
    expect(s.totals.total).toBe(10)
  })
})

describe('csv', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(toCsv([['a,b', 'say "hi"', 'x\ny']])).toBe('"a,b","say ""hi""","x\ny"\r\n')
  })
  it('payroll sheet has one row per person and skips people with no hours', () => {
    const people = [
      { id: 'a', full_name: 'Zed', classification: 'Foreman' },
      { id: 'b', full_name: 'Amy', classification: 'Helper' },
      { id: 'c', full_name: 'Idle', classification: 'Helper' },
    ] as Profile[]
    const csv = payrollCsv(people, [e({ employee_id: 'a', hours: 40 }), e({ employee_id: 'b', hours: 8, pay_type: 'ot' })], '2026-10-25')
    const lines = csv.trim().split('\r\n')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toBe('Amy,Helper,2026-10-25,0,8,8,0,8,0')
    expect(lines[2]).toBe('Zed,Foreman,2026-10-25,40,0,40,0,40,0')
  })
})

describe('dates', () => {
  it('weeks start on Monday', () => {
    expect(weekStart('2026-10-25')).toBe('2026-10-19')
    expect(weekStart('2026-10-19')).toBe('2026-10-19')
    expect(weekDays('2026-10-22')[6]).toBe('2026-10-25')
  })
  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})
