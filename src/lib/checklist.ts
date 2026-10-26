export interface ParsedItem {
  kind: 'check' | 'value' | 'head'
  text: string
}

// Splits one CSV line, honoring "quoted, values".
export function splitCsv(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out
}

// Accepts plain lines ("# Heading", "Item", "Reading|value", "- [ ] Item")
// or a CSV with a header row containing item/task/description/step and
// optional section and type columns.
export function parseLines(text: string): ParsedItem[] {
  const lines = String(text).replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return []
  const IT = ['item', 'task', 'description', 'step']
  let col: { item: number; sec: number; typ: number } | null = null
  const first = splitCsv(lines[0]).map((s) => s.trim().toLowerCase())
  if (first.length > 1 && first.some((h) => IT.includes(h))) {
    col = { item: first.findIndex((h) => IT.includes(h)), sec: first.indexOf('section'), typ: first.indexOf('type') }
    lines.shift()
  }
  const out: ParsedItem[] = []
  let lastSec: string | null = null
  for (const raw of lines) {
    let t = raw
    let kind: ParsedItem['kind'] = 'check'
    if (col) {
      const c = splitCsv(raw)
      t = (c[col.item] || '').trim()
      const sec = col.sec >= 0 ? (c[col.sec] || '').trim() : ''
      if (sec && sec !== lastSec) { out.push({ kind: 'head', text: sec }); lastSec = sec }
      const tv = col.typ >= 0 ? (c[col.typ] || '').trim().toLowerCase() : ''
      if (tv === 'value' || tv === 'reading') kind = 'value'
      if (t) out.push({ kind, text: t })
      continue
    }
    if (/^#+\s*/.test(t)) { out.push({ kind: 'head', text: t.replace(/^#+\s*/, '') }); continue }
    t = t.replace(/^([-*•]|\d+[.)])\s*/, '').replace(/^\[[ xX]?\]\s*/, '')
    if (/\|value\s*$/i.test(t)) { kind = 'value'; t = t.replace(/\|value\s*$/i, '').trim() }
    if (t) out.push({ kind, text: t })
  }
  return out
}

export const openCount = (items: { kind: string; done: boolean; value: string }[]) =>
  items.filter((i) => i.kind !== 'head' && !(i.kind === 'value' ? i.value.trim() !== '' : i.done)).length
