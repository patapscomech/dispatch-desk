import { describe, expect, it } from 'vitest'
import { openCount, parseLines, splitCsv } from './checklist'

describe('parseLines', () => {
  it('reads headings, readings and bullets', () => {
    expect(parseLines('# Safety\n- [ ] Lockout applied\n2) Replace filters\nSuction psi|value')).toEqual([
      { kind: 'head', text: 'Safety' },
      { kind: 'check', text: 'Lockout applied' },
      { kind: 'check', text: 'Replace filters' },
      { kind: 'value', text: 'Suction psi' },
    ])
  })
  it('reads a CSV with section and type columns', () => {
    const csv = 'Section,Item,Type\nAirside,Replace filters,\nAirside,"Supply temp, F",value\nControls,Verify safeties,'
    expect(parseLines(csv)).toEqual([
      { kind: 'head', text: 'Airside' },
      { kind: 'check', text: 'Replace filters' },
      { kind: 'value', text: 'Supply temp, F' },
      { kind: 'head', text: 'Controls' },
      { kind: 'check', text: 'Verify safeties' },
    ])
  })
  it('ignores blank lines and returns nothing for empty input', () => {
    expect(parseLines('\n  \n')).toEqual([])
  })
  it('splits quoted CSV cells', () => {
    expect(splitCsv('a,"b ""c"", d",e')).toEqual(['a', 'b "c", d', 'e'])
  })
})

describe('openCount', () => {
  it('counts unticked checks and empty readings, ignoring headings', () => {
    expect(
      openCount([
        { kind: 'head', done: false, value: '' },
        { kind: 'check', done: true, value: '' },
        { kind: 'check', done: false, value: '' },
        { kind: 'value', done: false, value: '' },
        { kind: 'value', done: false, value: '68' },
      ]),
    ).toBe(2)
  })
})
