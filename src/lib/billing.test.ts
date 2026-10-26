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

const sheet3: Rate[] = [
  { rate_class: 'Foreman', label: 'Lead Technician', regular: 130, overtime: 175, holiday: 200 },
  { rate_class: 'Helper', label: 'Technician Helper', regular: 70, overtime: 90, holiday: 110 },
]
const mva: Rate[] = [
  { rate_class: 'Journeyman', label: 'Journeyman', regular: 110, overtime: 140 },
  { rate_class: 'Apprentice', label: 'Apprentice', regular: 65, overtime: 90 },
  { rate_class: 'Controls', label: 'Controls repair', regular: 160, overtime: 240 },
]
describe('billing', () => {
  it('controls repair bills at the controls rate for anyone', () => {
    const { lines } = laborLines([
      { hours: 2, classification: 'Journeyman', period: 'regular', controls: true },
      { hours: 1, classification: 'Apprentice', period: 'after_hours', controls: true },
      { hours: 2, classification: 'Journeyman', period: 'regular' },
      { hours: 2, classification: 'Apprentice', period: 'after_hours' },
    ], mva)
    expect(lines.map((l) => l.amount)).toEqual([320, 240, 220, 180])
  })
  it('controls hours use the person own rate when the contract has no controls rate', () => {
    const { lines } = laborLines([{ hours: 1, classification: 'Journeyman', period: 'regular', controls: true }], county)
    expect(lines[0].amount).toBe(117)
  })
  it('three periods: regular, after hours, Sunday and holiday', () => {
    const { lines } = laborLines([
      { hours: 2, classification: 'Foreman', period: 'regular' },
      { hours: 2, classification: 'Foreman', period: 'after_hours' },
      { hours: 2, classification: 'Foreman', period: 'holiday' },
      { hours: 3, classification: 'Helper', period: 'holiday' },
    ], sheet3)
    expect(lines.map((l) => l.amount)).toEqual([260, 350, 400, 330])
    expect(lines[2].description).toBe('Labor, Lead Technician, Sunday and holiday')
  })
  it('no holiday price falls back to the after-hours price', () => {
    const { lines } = laborLines([{ hours: 1, classification: 'Apprentice', period: 'holiday' }], county)
    expect(lines[0].amount).toBe(90)
  })
  it('floors to the cent', () => { expect(fl(10.999)).toBe(10.99); expect(fl(1.08 * 100)).toBe(108) })
  it('uses the class rate, regular or overtime', () => {
    const { lines } = laborLines([
      { hours: 4, classification: 'Journeyman', period: 'regular' },
      { hours: 2, classification: 'Journeyman', period: 'after_hours' },
      { hours: 3, classification: 'Foreman', period: 'regular' },
    ], county)
    expect(lines.map((l) => l.amount).sort((a, b) => a - b)).toEqual([280, 330, 468])
  })
  it('groups the same class and period into one line', () => {
    const { lines } = laborLines([
      { hours: 1.5, classification: 'Apprentice', period: 'regular' },
      { hours: 2.25, classification: 'Apprentice', period: 'regular' },
    ], county)
    expect(lines).toHaveLength(1); expect(lines[0].qty).toBe(3.75); expect(lines[0].amount).toBe(270)
  })
  it('one flat rate for everyone', () => {
    expect(rateFor(schools, 'Helper')?.regular).toBe(120)
    const { lines, missing } = laborLines([
      { hours: 8, classification: 'Foreman', period: 'regular' },
      { hours: 8, classification: 'Apprentice', period: 'after_hours' },
    ], schools)
    expect(missing).toEqual([]); expect(total(lines)).toBe(1920)
  })
  it('reports hours with no rate', () => {
    const { missing } = laborLines([{ hours: 2, classification: 'Helper', period: 'regular' }], county)
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
