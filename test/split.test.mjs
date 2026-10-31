import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { check } from '../scripts/lib/commands/check.mjs'
import { split } from '../scripts/lib/commands/split.mjs'
import { InvalidInputError } from '../scripts/lib/errors.mjs'
import { leaves, loadTree } from '../scripts/lib/tree.mjs'
import { loadKeywords } from '../scripts/lib/i18n.mjs'
import { DEFAULTS } from '../scripts/lib/config.mjs'
import { loadWorkspace } from '../scripts/lib/workspace.mjs'
import { workspace } from './helpers/fixture.mjs'

const BOM = String.fromCharCode(0xfeff)
const read = (root, path) => readFileSync(join(root, path), 'utf8')
const crlf = (text) => `${BOM}${text.replaceAll('\n', '\r\n')}`
const DOCS = ['# Docs', '', '## Status', '', '- Next: `DOC-001`', '',
  '- [ ] [DOC-001] `[content]` Core pages', '  Done when: pages published', '  Depends on: `DOC-002`',
  '- [ ] [DOC-002] `[content]` Guide', '  Was: DOC-090', ''].join('\n')
const SHOP = ['# Shop', '', '- [ ] [SHOP-001] `[code]` Shop task', '  Blocks: `docs:DOC-001`', ''].join('\n')
const PLAN = { workstreams: [
  { id: 'DOC-CORE', name: 'Core', file: 'todo/core.md', aliases: ['core'], items: ['DOC-001'] },
  { id: 'DOC-GUIDE', name: 'Guide', file: 'todo/guide.md', aliases: [], items: ['DOC-002'] },
] }
const load = (t, spec) => {
  const root = workspace(t, spec, { config: {} })
  return { root, ws: loadWorkspace(root) }
}

test('split renumbers items, keeps Was lines, rewrites references in the workspace and builds the index', (t) => {
  const { root, ws } = load(t, { 'docs/TODO.md': DOCS, 'shop/TODO.md': SHOP })
  const r = split(ws, 'docs', PLAN)
  assert.equal(r.status, 'split')
  assert.deepEqual(r.renamed, { 'DOC-001': 'DOC-CORE-001', 'DOC-002': 'DOC-GUIDE-001' })
  assert.deepEqual(r.files.map((f) => f.path).sort(), ['docs/TODO.md', 'docs/todo/core.md', 'docs/todo/guide.md', 'shop/TODO.md'])

  const core = read(root, 'docs/todo/core.md')
  assert.match(core, /^- \[ \] \[DOC-CORE-001\] `\[content\]` Core pages$/m)
  assert.match(core, /^ {2}Was: DOC-001$/m)
  assert.match(core, /^ {2}Depends on: `DOC-GUIDE-001`$/m)
  assert.match(read(root, 'docs/todo/guide.md'), /^ {2}Was: DOC-002, DOC-090$/m)
  assert.match(read(root, 'shop/TODO.md'), /^ {2}Blocks: `docs:DOC-CORE-001`$/m)

  const index = read(root, 'docs/TODO.md')
  assert.match(index, /- Next: `DOC-CORE-001`/)
  assert.match(index, /\| ID \| Name \| File \| Status \| Block \| Alias \|/)
  assert.match(index, /\| `DOC-CORE` \| Core \| `todo\/core\.md` \| .* \| core \|/)
  assert.doesNotMatch(index, /\[DOC-00/)

  const tree = loadTree(join(root, 'docs'), loadKeywords('en'), DEFAULTS)
  assert.deepEqual(leaves(tree).map((n) => n.id), ['DOC-CORE', 'DOC-GUIDE'])
  const after = check(loadWorkspace(root), { fast: true })
  const codes = after.issues.map((i) => i.code)
  assert.ok(!codes.includes('wrong-workstream'))
  assert.ok(!codes.includes('dangling-link'))
  assert.ok(!codes.includes('ambiguous-link'))
})

test('split dryRun previews the files and writes nothing', (t) => {
  const { root, ws } = load(t, { 'docs/TODO.md': DOCS, 'shop/TODO.md': SHOP })
  const r = split(ws, 'docs', PLAN, { dryRun: true })
  assert.equal(r.status, 'preview')
  assert.equal(r.files.length, 4)
  assert.equal(read(root, 'docs/TODO.md'), DOCS)
  assert.equal(read(root, 'shop/TODO.md'), SHOP)
  assert.equal(existsSync(join(root, 'docs/todo/core.md')), false)
})

test('split rejects a plan that leaves items out, names unknown ones or reuses a file', (t) => {
  const { ws } = load(t, { 'docs/TODO.md': DOCS })
  const only = (items, file = 'todo/a.md') => ({ workstreams: [{ id: 'DOC-A', name: 'A', file, aliases: [], items }] })
  assert.throws(() => split(ws, 'docs', only(['DOC-001'])), (e) => e instanceof InvalidInputError && /DOC-002/.test(e.message))
  assert.throws(() => split(ws, 'docs', only(['DOC-001', 'DOC-002', 'DOC-777'])), InvalidInputError)
  assert.throws(() => split(ws, 'docs', only(['DOC-001', 'DOC-002'], 'TODO.md')), InvalidInputError)
  assert.throws(() => split(ws, 'docs', { workstreams: [] }), InvalidInputError)
})

test('split keeps CRLF and the BOM on every rewritten and new file', (t) => {
  const { root, ws } = load(t, { 'docs/TODO.md': crlf(DOCS), 'shop/TODO.md': crlf(SHOP) })
  split(ws, 'docs', PLAN)
  for (const f of ['docs/TODO.md', 'docs/todo/core.md', 'shop/TODO.md']) {
    const text = read(root, f)
    assert.ok(text.startsWith(BOM), `${f} keeps the BOM`)
    assert.ok(!text.replaceAll('\r\n', '').includes('\n'), `${f} has only CRLF`)
  }
  assert.match(read(root, 'shop/TODO.md'), /docs:DOC-CORE-001/)
})

test('split refuses a project that already has an index', (t) => {
  const { ws } = load(t, {
    'docs/TODO.md': '# Docs\n\n| ID | Name | File |\n|---|---|---|\n| `DOC-A` | A | `a.md` |\n',
    'docs/a.md': '- [ ] [DOC-A-001] `[code]` x\n',
  })
  assert.throws(() => split(ws, 'docs', PLAN), InvalidInputError)
})

test('split leaves a bare reference alone in a project that has its own item with that ID', (t) => {
  const own = ['# Mobile', '', '- [ ] [DOC-001] `[code]` Local twin', '- [ ] [MOB-001] `[code]` Uses it', '  Depends on: `DOC-001`, `docs:DOC-001`', ''].join('\n')
  const { root, ws } = load(t, { 'docs/TODO.md': DOCS, 'mobile/TODO.md': own })
  split(ws, 'docs', PLAN)
  assert.match(read(root, 'mobile/TODO.md'), /^ {2}Depends on: `DOC-001`, `docs:DOC-CORE-001`$/m)
})
