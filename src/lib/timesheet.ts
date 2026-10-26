import type { Entry, Profile } from '../types'

export const r2 = (n: number) => Math.round(n * 100) / 100

export interface Totals {
  regular: number
  ot: number
  job: number
  shop: number
  pw: number
  total: number
}
export const emptyTotals = (): Totals => ({ regular: 0, ot: 0, job: 0, shop: 0, pw: 0, total: 0 })

export function addTo(t: Totals, e: Entry) {
  const h = Number(e.hours)
  if (e.pay_type === 'ot') t.ot += h
  else t.regular += h
  if (e.job_id) t.job += h
  else t.shop += h
  if (e.prevailing_wage) t.pw += h
  t.total += h
}
export function totalsOf(entries: Entry[]): Totals {
  const t = emptyTotals()
  entries.forEach((e) => addTo(t, e))
  return { regular: r2(t.regular), ot: r2(t.ot), job: r2(t.job), shop: r2(t.shop), pw: r2(t.pw), total: r2(t.total) }
}

export interface SheetRow {
  key: string
  label: string
  byDay: Record<string, number>
  total: number
}
export interface Sheet {
  rows: SheetRow[]
  dayTotals: Record<string, number>
  totals: Totals
}

// One row per job/task (or shop), days across. `label` names a job/task pair.
export function buildSheet(
  entries: Entry[],
  days: string[],
  label: (jobId: string | null, taskId: string | null) => string,
): Sheet {
  const map = new Map<string, SheetRow>()
  const dayTotals: Record<string, number> = Object.fromEntries(days.map((d) => [d, 0]))
  entries.forEach((e) => {
    const key = `${e.job_id ?? 'shop'}|${e.task_id ?? ''}`
    let row = map.get(key)
    if (!row) {
      row = { key, label: label(e.job_id, e.task_id), byDay: {}, total: 0 }
      map.set(key, row)
    }
    const h = Number(e.hours)
    row.byDay[e.work_date] = r2((row.byDay[e.work_date] ?? 0) + h)
    row.total = r2(row.total + h)
    if (e.work_date in dayTotals) dayTotals[e.work_date] = r2(dayTotals[e.work_date] + h)
  })
  const rows = [...map.values()].sort((a, b) => {
    if (a.key.startsWith('shop') !== b.key.startsWith('shop')) return a.key.startsWith('shop') ? 1 : -1
    return a.label.localeCompare(b.label)
  })
  return { rows, dayTotals, totals: totalsOf(entries) }
}

const csvCell = (v: string | number) => {
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export const toCsv = (rows: (string | number)[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'

// One row per person: what gets keyed into the paycheck system.
export function payrollCsv(people: Profile[], entries: Entry[], weekEnding: string): string {
  const rows: (string | number)[][] = [
    ['Employee', 'Classification', 'Week ending', 'Regular hours', 'Overtime hours', 'Total hours', 'Job hours', 'Shop hours', 'Prevailing wage hours'],
  ]
  people
    .slice()
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
    .forEach((p) => {
      const mine = entries.filter((e) => e.employee_id === p.id)
      if (!mine.length) return
      const t = totalsOf(mine)
      rows.push([p.full_name, p.classification, weekEnding, t.regular, t.ot, t.total, t.job, t.shop, t.pw])
    })
  return toCsv(rows)
}

// One row per entry: for checking and for later importing.
export function detailCsv(
  people: Profile[],
  entries: Entry[],
  label: (jobId: string | null, taskId: string | null) => string,
): string {
  const name = (id: string) => people.find((p) => p.id === id)?.full_name ?? id
  const rows: (string | number)[][] = [
    ['Employee', 'Classification', 'Date', 'Job / task', 'Pay type', 'Hours', 'Prevailing wage', 'Status', 'Notes'],
  ]
  entries
    .slice()
    .sort((a, b) => name(a.employee_id).localeCompare(name(b.employee_id)) || a.work_date.localeCompare(b.work_date))
    .forEach((e) =>
      rows.push([
        name(e.employee_id),
        e.classification,
        e.work_date,
        label(e.job_id, e.task_id),
        e.pay_type === 'ot' ? 'Overtime' : 'Regular',
        Number(e.hours),
        e.prevailing_wage ? 'Yes' : 'No',
        e.status,
        e.notes,
      ]),
    )
  return toCsv(rows)
}
