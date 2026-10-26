import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import type { Data } from '../App'
import { isOffice, type Entry } from '../types'
import { addDays, fmtDay, fmtRange, today, weekDays } from '../lib/dates'
import { buildSheet, detailCsv, payrollCsv } from '../lib/timesheet'
import { jobLabel } from './Hours'

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export default function Timesheets({ d }: { d: Data }) {
  const [anchor, setAnchor] = useState(today())
  const [entries, setEntries] = useState<Entry[]>([])
  const [err, setErr] = useState('')
  const days = useMemo(() => weekDays(anchor), [anchor])
  const label = jobLabel(d)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('time_entries').select('*').gte('work_date', days[0]).lte('work_date', days[6]).order('work_date')
    if (error) setErr(error.message)
    else setEntries(data as Entry[])
  }, [days])
  useEffect(() => { load() }, [load])

  const paid = entries.filter((e) => e.status === 'approved' || e.status === 'exported')
  const pending = entries.filter((e) => e.status === 'open' || e.status === 'submitted')
  const approvedNotExported = entries.filter((e) => e.status === 'approved')
  const weekEnding = days[6]

  async function markExported() {
    const ids = approvedNotExported.map((e) => e.id)
    if (!ids.length) return
    if (!confirm(`Mark ${ids.length} approved entries as exported? They will be flagged so they are not paid twice.`)) return
    const { error } = await supabase.from('time_entries').update({ status: 'exported' }).in('id', ids)
    if (error) setErr(error.message)
    load()
  }

  const people = d.people.filter((p) => entries.some((e) => e.employee_id === p.id))

  return (
    <section>
      <div className="bar">
        <button className="btn" onClick={() => setAnchor(addDays(days[0], -7))} aria-label="Previous week">‹</button>
        <div className="grow center-t"><b>{fmtRange(days)}</b><div className="muted sm">Week ending {fmtDay(weekEnding)}</div></div>
        <button className="btn" onClick={() => setAnchor(addDays(days[0], 7))} aria-label="Next week">›</button>
      </div>

      {err && <p className="err" role="alert">{err}</p>}
      {pending.length > 0 && (
        <p className="warn">{pending.length} entries this week are not approved yet and are left out of the payroll sheet.</p>
      )}

      <div className="bar wrap">
        <button className="btn primary" disabled={!paid.length} onClick={() => download(`payroll-week-ending-${weekEnding}.csv`, payrollCsv(d.people, paid, weekEnding))}>
          Payroll sheet (CSV)
        </button>
        <button className="btn" disabled={!entries.length} onClick={() => download(`hours-detail-${weekEnding}.csv`, detailCsv(d.people, entries, label))}>
          Detail (CSV)
        </button>
        {isOffice(d.me.role) && (
          <button className="btn" disabled={!approvedNotExported.length} onClick={markExported}>
            Mark approved as exported ({approvedNotExported.length})
          </button>
        )}
      </div>

      {!people.length && <p className="muted">No hours this week.</p>}
      {people.map((p) => {
        const mine = entries.filter((e) => e.employee_id === p.id)
        const s = buildSheet(mine, days, label)
        return (
          <div className="card" key={p.id}>
            <div className="row between"><b>{p.full_name}</b><span className="muted sm">{p.classification}</span></div>
            <div className="scroll">
              <table className="sheet">
                <thead>
                  <tr><th>Job / task</th>{days.map((x) => <th key={x} className="n">{fmtDay(x).replace(/, /, ' ')}</th>)}<th className="n">Total</th></tr>
                </thead>
                <tbody>
                  {s.rows.map((r) => (
                    <tr key={r.key}>
                      <td>{r.label}</td>
                      {days.map((x) => <td key={x} className="n">{r.byDay[x] ?? ''}</td>)}
                      <td className="n"><b>{r.total}</b></td>
                    </tr>
                  ))}
                  <tr className="foot">
                    <td>Daily total</td>
                    {days.map((x) => <td key={x} className="n">{s.dayTotals[x] || ''}</td>)}
                    <td className="n"><b>{s.totals.total}</b></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="sm muted">
              Regular {s.totals.regular} · Overtime {s.totals.ot} · Job {s.totals.job} · Shop {s.totals.shop} · Prevailing wage {s.totals.pw}
            </div>
            <div className="sm">
              {mine.some((e) => e.status === 'open' || e.status === 'submitted')
                ? <span className="warn-t">Includes hours not yet approved</span>
                : <span className="muted">All approved</span>}
            </div>
          </div>
        )
      })}
    </section>
  )
}
