import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { add } from '../scripts/lib/commands/add.mjs'
import { done } from '../scripts/lib/commands/done.mjs'
import { AmbiguousIdError, InvalidInputError, WorkstreamNotFoundError } from '../scripts/lib/errors.mjs'
import { loadWorkspace } from '../scripts/lib/workspace.mjs'
import { englishShop, flat, italianShop, workspace } from './helpers/fixture.mjs'

const read = (root, path) => readFileSync(join(root, path), 'utf8')
const load = (t, spec, options) => {
  const root = workspace(t, spec, options)
  return { root, ws: loadWorkspace(root) }
}
const crlf = (text) => `﻿${text.replaceAll('\n', '\r\n')}`
const bareLf = (text) => /(^|[^\r])\n/.test(text)

test('done: removes the item and its sub-lines, moves Next in the index naming it', (t) => {
  const { root, ws } = load(t, englishShop())
  const r = done(ws, 'SHOP-MKT-ADS-001')
  assert.equal(r.status, 'done')
  assert.deepEqual(r.indexes, ['todo/marketing/index.md'])
  const ads = read(root, 'todo/marketing/ads.md')
  assert.ok(!ads.includes('SHOP-MKT-ADS-001') && !ads.includes('Blocks:'))
  assert.match(read(root, 'todo/marketing/index.md'), /Next: —/)
})

test('done: Next keeps the file keyword (Italian) and moves to the first open unblocked item', (t) => {
  const { root, ws } = load(t, italianShop(), { config: { language: 'it' } })
  const r = done(ws, 'SHOP-API-001')
  assert.deepEqual(r.indexes, ['TODO.md'])
  assert.equal(r.next, null, 'SHOP-API-002 still waits on an open item')
  assert.match(read(root, 'TODO.md'), /Prossima attività: —/)
  assert.ok(!read(root, 'todo/api.md').includes('[SHOP-API-001]'))
})

test('done: next skips items blocked by open dependencies', (t) => {
  const spec = { 'TODO.md': ['# S', '', '- Next: `SHOP-001`', '',
    '- [ ] [SHOP-001] `[code]` A', '- [ ] [SHOP-002] `[code]` B', '  Depends on: `SHOP-003`', '- [ ] [SHOP-003] `[code]` C', ''].join('\n') }
  const { root, ws } = load(t, spec)
  assert.equal(done(ws, 'SHOP-001').next, 'SHOP-003')
  assert.match(read(root, 'TODO.md'), /Next: `SHOP-003`/)
})

test('done: flat project updates Next in the same TODO.md; unknown ID throws', (t) => {
  const { root, ws } = load(t, flat())
  const r = done(ws, 'SHOP-002')
  assert.equal(r.file, 'TODO.md')
  assert.equal(r.next, 'SHOP-003')
  assert.deepEqual(r.indexes, ['TODO.md'])
  const text = read(root, 'TODO.md')
  assert.match(text, /- Next: `SHOP-003`/)
  assert.ok(!text.includes('Product list') && !text.includes('the list renders'))
  assert.throws(() => done(ws, 'SHOP-099'), { name: 'ItemNotFoundError' })
})

test('done: CRLF file with BOM stays CRLF with BOM and has no bare LF', (t) => {
  const { root, ws } = load(t, { 'TODO.md': crlf(flat()['TODO.md']) })
  done(ws, 'SHOP-002')
  const text = read(root, 'TODO.md')
  assert.ok(text.startsWith('﻿'))
  assert.ok(!bareLf(text), 'no bare LF')
  assert.match(text, /Next: `SHOP-003`/)
  assert.ok(!text.includes('Product list'))
})

test('done: CRLF detail file and CRLF index in an indexed project', (t) => {
  const spec = englishShop()
  spec['TODO.md'] = crlf(spec['TODO.md'])
  spec['todo/api.md'] = crlf(spec['todo/api.md'])
  const { root, ws } = load(t, spec)
  done(ws, 'SHOP-API-001')
  for (const f of ['TODO.md', 'todo/api.md']) {
    const text = read(root, f)
    assert.ok(text.startsWith('﻿') && !bareLf(text), f)
  }
})

test('add: next ID in the workstream file; errors are typed', (t) => {
  const { root, ws } = load(t, englishShop())
  const r = add(ws, { project: '.', workstream: 'SHOP-WEB', type: 'code', text: ' Export  CSV ', doneWhen: 'it exports' })
  assert.deepEqual(r, { status: 'added', id: 'SHOP-WEB-100', project: '.', file: 'todo/web.md' })
  assert.match(read(root, 'todo/web.md'), /- \[ \] \[SHOP-WEB-100\] `\[code\]` Export CSV\n {2}Done when: it exports\n$/)
  assert.throws(() => add(ws, { project: '.', workstream: 'NOPE', type: 'code', text: 'x' }), WorkstreamNotFoundError)
  assert.throws(() => add(ws, { project: '.', workstream: 'SHOP-WEB', type: 'Code!', text: 'x' }), InvalidInputError)
  assert.throws(() => add(ws, { project: '.', workstream: 'SHOP-WEB', type: 'code', text: '  ' }), InvalidInputError)
  assert.throws(() => add(ws, { project: '.', workstream: 'SHOP-GHOST', type: 'code', text: 'x' }), InvalidInputError)
})

test('add: never reuses an ID kept in a Was line', (t) => {
  const spec = { 'TODO.md': ['# S', '', '- [ ] [SHOP-001] `[code]` A', '  Was: SHOP-007', ''].join('\n') }
  const { ws } = load(t, spec)
  assert.equal(add(ws, { type: 'code', text: 'B' }).id, 'SHOP-008')
})

test('add: flat project docs appends at the end and leaves Next alone', (t) => {
  const spec = { 'docs/TODO.md': flat()['TODO.md'].replaceAll('SHOP-', 'DOC-'), 'shop/TODO.md': flat()['TODO.md'] }
  const { root, ws } = load(t, spec)
  const r = add(ws, { project: 'docs', type: 'content', text: 'New page' })
  assert.deepEqual(r, { status: 'added', id: 'DOC-005', project: 'docs', file: 'docs/TODO.md' })
  const text = read(root, 'docs/TODO.md')
  assert.match(text, /Next: `DOC-002`/)
  assert.match(text, /- \[ \] \[DOC-005\] `\[content\]` New page\n$/)
})

test('add: CRLF with BOM is preserved', (t) => {
  const { root, ws } = load(t, { 'TODO.md': crlf(flat()['TODO.md']) })
  add(ws, { type: 'code', text: 'New', doneWhen: 'ok' })
  const text = read(root, 'TODO.md')
  assert.ok(text.startsWith('﻿') && !bareLf(text))
  assert.match(text, /\[SHOP-005\] `\[code\]` New\r\n {2}Done when: ok\r\n$/)
})

test('done: same ID in two projects touches only the qualified one; bare ID is ambiguous', (t) => {
  const spec = { 'shop/TODO.md': '# S\n\n- [ ] [API-001] `[code]` Shop\n', 'docs/TODO.md': '# D\n\n- [ ] [API-001] `[code]` Docs\n' }
  const { root, ws } = load(t, spec)
  assert.throws(() => done(ws, 'API-001'), AmbiguousIdError)
  done(ws, 'shop:API-001')
  assert.ok(!read(root, 'shop/TODO.md').includes('API-001'))
  assert.ok(read(root, 'docs/TODO.md').includes('API-001'))
})
