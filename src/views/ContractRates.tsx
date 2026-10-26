import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { CLASSES } from '../types'

interface RateRow { rate_class: string; label: string; regular: string; overtime: string }
interface TermsRow { billing_method: string; materials_multiplier: string; sub_multiplier: string; rental_multiplier: string; trip_charge: string; notes: string }

const METHODS: Record<string, string> = {
  tm: 'Time and materials', cost_plus: 'Cost plus', fixed: 'Fixed price', pm: 'PM price list',
}

// Office-only editor for a contract's billing terms and labor rates.
export default function ContractRates({ contractId }: { contractId: string }) {
  const [open, setOpen] = useState(false)
  const [terms, setTerms] = useState<TermsRow | null>(null)
  const [rates, setRates] = useState<RateRow[]>([])
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!open || terms) return
    ;(async () => {
      const [c, r] = await Promise.all([
        supabase.from('contracts').select('billing_method,materials_multiplier,sub_multiplier,rental_multiplier,trip_charge,notes').eq('id', contractId).single(),
        supabase.from('contract_rates').select('rate_class,label,regular,overtime').eq('contract_id', contractId),
      ])
      if (c.error) return setMsg(c.error.message)
      const t = c.data as Record<string, unknown>
      setTerms({
        billing_method: String(t.billing_method), materials_multiplier: String(t.materials_multiplier), sub_multiplier: String(t.sub_multiplier),
        rental_multiplier: String(t.rental_multiplier), trip_charge: String(t.trip_charge), notes: String(t.notes ?? ''),
      })
      setRates(((r.data ?? []) as Record<string, unknown>[]).map((x) => ({
        rate_class: String(x.rate_class), label: String(x.label), regular: String(x.regular), overtime: String(x.overtime),
      })))
    })()
  }, [open, terms, contractId])

  async function save() {
    if (!terms) return
    setMsg('')
    for (const r of rates) {
      if (!(Number(r.regular) >= 0) || !(Number(r.overtime) >= 0) || r.regular === '' || r.overtime === '') return setMsg('Every rate needs a regular and an overtime price.')
    }
    if (new Set(rates.map((r) => r.rate_class)).size !== rates.length) return setMsg('Each class can appear only once.')
    const u = await supabase.from('contracts').update({
      billing_method: terms.billing_method,
      materials_multiplier: Number(terms.materials_multiplier), sub_multiplier: Number(terms.sub_multiplier),
      rental_multiplier: Number(terms.rental_multiplier), trip_charge: Number(terms.trip_charge || 0), notes: terms.notes,
    }).eq('id', contractId)
    if (u.error) return setMsg(u.error.message)
    const del = await supabase.from('contract_rates').delete().eq('contract_id', contractId)
    if (del.error) return setMsg(del.error.message)
    if (rates.length) {
      const ins = await supabase.from('contract_rates').insert(rates.map((r) => ({
        contract_id: contractId, rate_class: r.rate_class, label: r.label.trim(), regular: Number(r.regular), overtime: Number(r.overtime),
      })))
      if (ins.error) return setMsg(ins.error.message)
    }
    setMsg('Saved.')
  }

  const setRate = (i: number, p: Partial<RateRow>) => setRates(rates.map((r, j) => (j === i ? { ...r, ...p } : r)))
  const setT = (p: Partial<TermsRow>) => terms && setTerms({ ...terms, ...p })

  if (!open) return <button className="btn ghost" onClick={() => setOpen(true)}>Billing terms and rates</button>
  if (!terms) return <div className="muted sm">{msg || 'Loading…'}</div>
  const used = new Set(rates.map((r) => r.rate_class))
  const free = ['All', ...CLASSES].filter((c) => !used.has(c))
  return (
    <div className="form">
      <label>Billing method
        <select value={terms.billing_method} onChange={(e) => setT({ billing_method: e.target.value })}>
          {Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <b className="sm">Labor rates (per hour)</b>
      {rates.map((r, i) => (
        <div className="row" key={r.rate_class}>
          <span style={{ minWidth: 110 }}>{r.rate_class === 'All' ? 'Everyone' : r.rate_class}</span>
          <input placeholder="Customer's name for it" value={r.label} onChange={(e) => setRate(i, { label: e.target.value })} style={{ width: 150 }} />
          <input aria-label="Regular rate" inputMode="decimal" placeholder="Regular" value={r.regular} onChange={(e) => setRate(i, { regular: e.target.value })} style={{ width: 80 }} />
          <input aria-label="Overtime rate" inputMode="decimal" placeholder="Overtime" value={r.overtime} onChange={(e) => setRate(i, { overtime: e.target.value })} style={{ width: 80 }} />
          <button type="button" className="btn ghost" onClick={() => setRates(rates.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      {!rates.length && <div className="muted sm">No labor rates yet.</div>}
      {free.length > 0 && (
        <div className="row">
          {free.map((c) => (
            <button type="button" key={c} className="btn ghost" onClick={() => setRates([...rates, { rate_class: c, label: '', regular: '', overtime: '' }])}>
              + {c === 'All' ? 'One rate for everyone' : c}
            </button>
          ))}
        </div>
      )}
      <div className="muted sm">"Everyone" is used for anyone without their own class rate. Overtime means after-hours billing (set on each hours entry).</div>
      <b className="sm">Markups (1.08 = cost plus 8%, 1 = at cost)</b>
      <div className="grid2">
        <label>Materials<input inputMode="decimal" value={terms.materials_multiplier} onChange={(e) => setT({ materials_multiplier: e.target.value })} /></label>
        <label>Subcontractors<input inputMode="decimal" value={terms.sub_multiplier} onChange={(e) => setT({ sub_multiplier: e.target.value })} /></label>
        <label>Rentals<input inputMode="decimal" value={terms.rental_multiplier} onChange={(e) => setT({ rental_multiplier: e.target.value })} /></label>
        <label>Trip charge (0 = none)<input inputMode="decimal" value={terms.trip_charge} onChange={(e) => setT({ trip_charge: e.target.value })} /></label>
      </div>
      <label>Notes<input value={terms.notes} onChange={(e) => setT({ notes: e.target.value })} /></label>
      {msg && <p className={msg === 'Saved.' ? 'muted sm' : 'err'} role="alert">{msg}</p>}
      <div className="row"><button type="button" className="btn" onClick={save}>Save terms and rates</button><button type="button" className="btn ghost" onClick={() => setOpen(false)}>Close</button></div>
    </div>
  )
}
