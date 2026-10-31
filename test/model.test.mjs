import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadKeywords } from '../scripts/lib/i18n.mjs'
import { parseIndex, parseItems, timing, formatItem, waitingOnUser, isModelFile, byWhen } from '../scripts/lib/model.mjs'

const it = loadKeywords('it')
const en = loadKeywords('en')

const IT = [
  '- [ ] [SHOP-API-002] `[code]` Fix checkout',
  '  Fatto quando: test verdi',
  '  Dipende da: `SHOP-API-001`. Blocca: `SHOP-WEB-003`.',
  '  Dal: 2026-10-30',
  '  - [x] parte uno',
  '  - [ ] Utente: crea la chiave API',
].join('\n')
const EN = IT.replace('Fatto quando', 'Done when').replace('Dipende da', 'Depends on').replace('Blocca', 'Blocks')
  .replace('Dal:', 'From:').replace('Utente:', 'User:')
const EXPECTED = {
  id: 'SHOP-API-002', open: true, type: 'code', text: 'Fix checkout', doneWhen: 'test verdi',
  deps: ['SHOP-API-001'], blocks: ['SHOP-WEB-003'], from: '2026-10-30', was: [], line: 0,
  parts: [{ done: true, text: 'parte uno', user: false }, { done: false, text: 'crea la chiave API', user: true }],
}

test('parseItems reads the Italian format', () => assert.deepEqual(parseItems(IT, it)[0], EXPECTED))
test('parseItems reads the English format', () => assert.deepEqual(parseItems(EN, en)[0], EXPECTED))
test('parseItems keeps inline Depends on / Blocks separate', () => {
  const [x] = parseItems('- [ ] [A-001] t\n  Depends on: B-001. Blocks: C-001.', en)
  assert.deepEqual([x.deps, x.blocks], [['B-001'], ['C-001']])
})
test('parseItems gives the same result with CRLF and BOM', () => {
  assert.deepEqual(parseItems('﻿' + IT.replace(/\n/g, '\r\n'), it), parseItems(IT, it))
})
test('parseItems: type tag stripped of bold and numbering, default type, Was line', () => {
  const [a, b] = parseItems('- [ ] [A-001] 1. **[décision-x]** Pick\n- [x] No tag here\n  Was: OLD-001, OLD-002', en)
  assert.equal(a.type, 'décision-x'); assert.equal(a.text, 'Pick')
  assert.equal(b.type, 'other'); assert.equal(b.id, null); assert.equal(b.open, false); assert.deepEqual(b.was, ['OLD-001', 'OLD-002'])
  assert.equal(b.line, 1)
})
test('parseIndex reads subprojects table and next', () => {
  const text = 'Prossima attività: `SHOP-API`\n\n## Sottoprogetti\n\n| ID | Nome | File | Stato | Blocco | Alias |\n|---|---|---|---|---|---|\n| `SHOP` | Shop | shop/todo.md | attivo | — | — |\n\n## Altro\n\n| ID | File | Alias |\n|---|---|---|\n| X | x.md | a, b |\n'
  const r = parseIndex(text, it)
  assert.equal(r.next, 'SHOP-API')
  assert.deepEqual(r.rows[0], { id: 'SHOP', name: 'Shop', file: 'shop/todo.md', status: 'attivo', block: '—', aliases: [], subproject: true })
  assert.deepEqual([r.rows[1].subproject, r.rows[1].aliases], [false, ['a', 'b']])
})
test('timing states', () => {
  assert.deepEqual(timing('2026-10-27', '2026-10-31'), { from: '2026-10-27', days: 4, state: 'overdue' })
  assert.equal(timing('2026-11-01', '2026-10-31').state, 'later')
  assert.equal(timing('2026-10-30', '2026-10-31', 5).state, 'due')
  assert.equal(timing(null, '2026-10-31'), null)
})
test('byWhen orders overdue, due, none, later', () => {
  const xs = [{ n: 'l', when: { state: 'later', days: -2 } }, { n: 'n' }, { n: 'o', when: { state: 'overdue', days: 9 } }, { n: 'd', when: { state: 'due', days: 0 } }]
  assert.deepEqual(xs.sort(byWhen).map((x) => x.n), ['o', 'd', 'n', 'l'])
})
test('waitingOnUser', () => {
  const [x] = parseItems(IT, it)
  assert.deepEqual(waitingOnUser({ ...x, parts: [x.parts[1]] }, it), { waiting: true, steps: ['crea la chiave API'] })
  assert.deepEqual(waitingOnUser({ ...x, parts: [] }, it).waiting, false)
  assert.deepEqual(waitingOnUser({ ...x, type: 'decisione', parts: [] }, it), { waiting: true, steps: [] })
  assert.equal(waitingOnUser({ ...x, parts: [{ done: false, text: 'a', user: false }, x.parts[1]] }, it).waiting, false)
})
test('formatItem en and round-trip', () => {
  const x = { id: 'SHOP-API-004', type: 'code', text: 'Add retries', doneWhen: 'retries covered by tests', deps: ['SHOP-API-001'] }
  assert.deepEqual(formatItem(x, en), ['- [ ] [SHOP-API-004] `[code]` Add retries', '  Done when: retries covered by tests', '  Depends on: `SHOP-API-001`'])
  const full = { ...EXPECTED }
  assert.deepEqual(parseItems(formatItem(full, en).join('\n'), en)[0], EXPECTED)
  assert.deepEqual(parseItems(formatItem({ ...full, was: ['OLD-001'] }, it).join('\n'), it)[0].was, ['OLD-001'])
})
test('isModelFile still works', () => {
  assert.equal(isModelFile('- [ ] [A-001] x', en), true)
  assert.equal(isModelFile('hello', en), false)
})

test('parseIndex ignores prose after Next', () => {
  assert.equal(parseIndex('Next: Review the plan', en).next, null)
  assert.equal(parseIndex('Some Next: SHOP-API text', en).next, null)
  assert.equal(parseIndex('Next: `SHOP-API`', en).next, 'SHOP-API')
  assert.equal(parseIndex('Prossima attività: `DM-PROD-006`', it).next, 'DM-PROD-006')
})
test('parseItems recognises the type tag only at the start of the body', () => {
  const [a, b, c] = parseItems('- [ ] [A-001] See [docs](http://x) now\n- [ ] [A-002] `[code]` Fix\n- [ ] [A-003] **[decisione]** X', en)
  assert.equal(a.type, 'other'); assert.equal(a.text, 'See [docs](http://x) now')
  assert.equal(b.type, 'code'); assert.equal(b.text, 'Fix')
  assert.equal(c.type, 'decisione'); assert.equal(c.text, 'X')
  assert.equal(parseItems('- [ ] [A-004] [docs](http://x) first', en)[0].type, 'other')
})
