// Dates are plain YYYY-MM-DD strings so time zones can never shift a day.
// Pay week starts on this weekday (0 = Sunday, 1 = Monday). Confirm with payroll.
export const WEEK_START = 1

const pad = (n: number) => String(n).padStart(2, '0')
const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

export function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
export function addDays(s: string, n: number): string {
  const d = parse(s)
  d.setUTCDate(d.getUTCDate() + n)
  return iso(d)
}
export function weekStart(s: string): string {
  const diff = (parse(s).getUTCDay() - WEEK_START + 7) % 7
  return addDays(s, -diff)
}
export function weekDays(s: string): string[] {
  const st = weekStart(s)
  return Array.from({ length: 7 }, (_, i) => addDays(st, i))
}
export function fmtDay(s: string): string {
  return parse(s).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
export function fmtRange(days: string[]): string {
  const f = (s: string) =>
    parse(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return `${f(days[0])} to ${f(days[days.length - 1])}`
}
