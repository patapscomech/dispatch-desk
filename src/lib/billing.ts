// Billing math. Every billed amount rounds DOWN to the cent.
export const fl = (n: number) => Math.floor(n * 100 + 1e-6) / 100

export interface Rate { rate_class: string; label: string; regular: number; overtime: number }
export interface Terms {
  materials_multiplier: number
  sub_multiplier: number
  rental_multiplier: number
  trip_charge: number
}
export interface LaborIn { hours: number; classification: string; after_hours: boolean }
export interface PartIn { description: string; qty: number; unit_cost: number; source: string }
export interface Line { kind: 'labor' | 'material' | 'sub' | 'rental' | 'trip'; description: string; qty: number; unit: number; amount: number }

export function rateFor(rates: Rate[], classification: string): Rate | undefined {
  return rates.find((r) => r.rate_class === classification) ?? rates.find((r) => r.rate_class === 'All')
}

// Labor is grouped by the customer's class name and regular/overtime.
// Hours with no matching rate are returned in `missing` so the office can fix them.
export function laborLines(entries: LaborIn[], rates: Rate[]): { lines: Line[]; missing: LaborIn[] } {
  const groups = new Map<string, Line>()
  const missing: LaborIn[] = []
  for (const e of entries) {
    const r = rateFor(rates, e.classification)
    if (!r) { missing.push(e); continue }
    const unit = fl(e.after_hours ? r.overtime : r.regular)
    const name = `Labor, ${r.label || r.rate_class}, ${e.after_hours ? 'overtime' : 'regular'}`
    const key = `${name}|${unit}`
    const g = groups.get(key) ?? { kind: 'labor' as const, description: name, qty: 0, unit, amount: 0 }
    g.qty = Math.round((g.qty + Number(e.hours)) * 100) / 100
    groups.set(key, g)
  }
  const lines = [...groups.values()].map((g) => ({ ...g, amount: fl(g.qty * g.unit) }))
  return { lines, missing }
}

// Parts: cost x multiplier. The multiplier is applied to the unit price, which is
// rounded down first, then the line is qty x unit price rounded down.
export function partLines(parts: PartIn[], t: Terms): Line[] {
  const out: Line[] = []
  for (const p of parts) {
    if (p.source === 'Stock') continue // stock parts are priced by the office, not here
    const kind = p.source === 'Subcontractor' ? 'sub' : p.source === 'Rental' ? 'rental' : 'material'
    const mult = kind === 'sub' ? t.sub_multiplier : kind === 'rental' ? t.rental_multiplier : t.materials_multiplier
    const unit = fl(p.unit_cost * mult)
    out.push({ kind, description: p.description, qty: p.qty, unit, amount: fl(p.qty * unit) })
  }
  return out
}

// Subcontractors appear as one combined invoice line.
export function combineSubs(lines: Line[]): Line[] {
  const subs = lines.filter((l) => l.kind === 'sub')
  const rest = lines.filter((l) => l.kind !== 'sub')
  if (!subs.length) return rest
  const amount = subs.reduce((s, l) => s + l.amount, 0)
  return [...rest, { kind: 'sub', description: 'Subcontracted services', qty: 1, unit: amount, amount }]
}

export function tripLine(t: Terms, visits: number): Line[] {
  return t.trip_charge > 0 && visits > 0
    ? [{ kind: 'trip', description: 'Trip charge', qty: visits, unit: fl(t.trip_charge), amount: fl(visits * fl(t.trip_charge)) }]
    : []
}

export const total = (lines: Line[]) => lines.reduce((s, l) => s + l.amount, 0)
