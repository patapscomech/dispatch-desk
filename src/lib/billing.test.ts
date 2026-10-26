import { describe, expect, it } from 'vitest'
import { combineSubs, fl, laborLines, partLines, rateFor, total, tripLine, type Rate, type Terms } from './billing'

const county: Rate[] = [
  { rate_class: 'Foreman', label: 'Supervisor', regular: 110, overtime: 140 },
  { rate_class: 'Journeyman', label: 'Outside Mechanic', regular: 117, overtime: 140 },
  { rate_class: 'Apprentice', label: 'Apprentice', regular: 72, overtime: 90 },
  { rate_class: 'Shop Mechanic', label: 'Shop Mechanic', regular: 108, overtime: 125 },
]
const schools: Rate[] = [{ rate_class: 'All', label: 'Mechanic', regular: 120, overtime: 120 }]
const t: Terms = { materials_multiplier: 1.08, sub_multiplier: 1.08, rental_multiplier: 1, trip_charge: 0 }

describe('billing', () => {
  it('floors to the cent', () => { expect(fl(10.999)).toBe(10.99); expect(fl(1.08 * 100)).toBe(108) })
  it('uses the class rate, regular or overtime', () => {
    const { lines } = laborLines([
      { hours: 4, classification: 'Journeyman', after_hours: false },
      { hours: 2, classification: 'Journeyman', after_hours: true },
      { hours: 3, classification: 'Foreman', after_hours: false },
    ], county)
    expect(lines.map((l) => l.amount).sort((a, b) => a - b)).toEqual([280, 330, 468])
  })
  it('groups the same class and period into one line', () => {
    const { lines } = laborLines([
      { hours: 1.5, classification: 'Apprentice', after_hours: false },
      { hours: 2.25, classification: 'Apprentice', after_hours: false },
    ], county)
    expect(lines).toHaveLength(1); expect(lines[0].qty).toBe(3.75); expect(lines[0].amount).toBe(270)
  })
  it('one flat rate for everyone', () => {
    expect(rateFor(schools, 'Helper')?.regular).toBe(120)
    const { lines, missing } = laborLines([
      { hours: 8, classification: 'Foreman', after_hours: false },
      { hours: 8, classification: 'Apprentice', after_hours: true },
    ], schools)
    expect(missing).toEqual([]); expect(total(lines)).toBe(1920)
  })
  it('reports hours with no rate', () => {
    const { missing } = laborLines([{ hours: 2, classification: 'Helper', after_hours: false }], county)
    expect(missing).toHaveLength(1)
  })
  it('marks up materials and subs, passes rentals through, rounds down', () => {
    const lines = partLines([
      { description: 'Contactor', qty: 3, unit_cost: 12.34, source: 'Purchased' },
      { description: 'Crane', qty: 1, unit_cost: 500.555, source: 'Rental' },
      { description: 'Controls sub', qty: 1, unit_cost: 1000, source: 'Subcontractor' },
      { description: 'Filter', qty: 4, unit_cost: 9, source: 'Stock' },
    ], t)
    expect(lines.map((l) => l.amount)).toEqual([39.96, 500.55, 1080])
  })
  it('combines subcontractors into one line', () => {
    const lines = combineSubs(partLines([
      { description: 'a', qty: 1, unit_cost: 100, source: 'Subcontractor' },
      { description: 'b', qty: 1, unit_cost: 50, source: 'Subcontractor' },
    ], t))
    expect(lines).toHaveLength(1); expect(lines[0].amount).toBe(162)
  })
  it('trip charge only when set', () => {
    expect(tripLine(t, 2)).toEqual([])
    expect(tripLine({ ...t, trip_charge: 85.5 }, 2)[0].amount).toBe(171)
  })
})
