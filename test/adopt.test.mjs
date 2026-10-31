import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { adoptScan, adoptWrite } from '../scripts/lib/commands/adopt.mjs'
import { InvalidInputError } from '../scripts/lib/errors.mjs'
import { loadWorkspace } from '../scripts/lib/workspace.mjs'
import { workspace } from './helpers/fixture.mjs'

const BOM = String.fromCharCode(0xfeff)
const read = (root, path) => readFileSync(join(root, path), 'utf8')
const HANDOFF = ['# Handoff', '', 'The importer is half done.', '- [ ] Fix the login bug', 'Some prose in between.', '- [ ] Write the docs', 'End of notes.', ''].join('\n')
const ITEMS = [
  { type: 'code', text: 'Fix the login bug', doneWhen: 'login works', sourceLines: [4] },
  { type: 'content', text: 'Write the docs', dependsOn: [0], parts: [{ done: false, text: 'Outline', user: true }], sourceLines: [6] },
]
const load = (t, spec, options) => {
  const root = workspace(t, spec, { config: {}, ...options })
  return { root, ws: loadWorkspace(root) }
}

test('adoptScan lists the checkbox lines of a mixed handoff file with 1-based line numbers', (t) => {
  const { ws } = load(t, { 'notes/handoff.md': HANDOFF })
  const r = adoptScan(ws)
  assert.equal(r.status, 'ok')
  const c = r.candidates.find((x) => x.file === 'notes/handoff.md')
  assert.equal(c.kind, 'handoff')
  assert.equal(c.mixed, true)
  assert.deepEqual(c.lines, [{ n: 4, text: 'Fix the login bug', checked: false }, { n: 6, text: 'Write the docs', checked: false }])
})

test('adoptWrite strip without git: creates TODO.md, removes only the adopted lines, backs the source up', (t) => {
  const { root, ws } = load(t, { 'notes/handoff.md': HANDOFF })
  const r = adoptWrite(ws, { source: 'notes/handoff.md', project: 'notes', items: ITEMS, mode: 'strip', now: new Date(2026, 9, 31, 12, 30, 5) })
  assert.equal(r.status, 'adopted')
  assert.equal(r.file, 'notes/TODO.md')
  assert.deepEqual(r.ids, ['NOTE-001', 'NOTE-002'])
  assert.deepEqual(r.removedLines, [4, 6])
  assert.equal(r.backup, 'notes/.backlog/backup/20261031-123005/handoff.md')
  assert.equal(read(root, r.backup), HANDOFF)
  assert.equal(read(root, 'notes/handoff.md'), ['# Handoff', '', 'The importer is half done.', 'Some prose in between.', 'End of notes.', ''].join('\n'))
  const todo = read(root, 'notes/TODO.md')
  assert.match(todo, /^- \[ \] \[NOTE-001\] `\[code\]` Fix the login bug$/m)
  assert.match(todo, /^ {2}Done when: login works$/m)
  assert.match(todo, /^ {2}Depends on: `NOTE-001`$/m)
  assert.match(todo, /^ {2}- \[ \] User: Outline$/m)
  assert.match(todo, /- Next: `NOTE-001`/)
  assert.ok(r.check && !r.check.issues.some((i) => i.level === 'error'))
})

test('adoptWrite strip inside a git repository: no backup copy', (t) => {
  const { root, ws } = load(t, { 'notes/handoff.md': HANDOFF }, { git: true })
  const r = adoptWrite(ws, { source: 'notes/handoff.md', project: 'notes', items: ITEMS, mode: 'strip' })
  assert.equal(r.backup, null)
  assert.equal(existsSync(join(root, 'notes/.backlog')), false)
})

test('adoptWrite replace: the todo.txt source is deleted and TODO.md created', (t) => {
  const { root, ws } = load(t, { 'old/todo.txt': 'buy milk\nfix the roof\n' })
  const items = [{ type: 'other', text: 'Buy milk', sourceLines: [1] }, { type: 'other', text: 'Fix the roof', sourceLines: [2] }]
  const r = adoptWrite(ws, { source: 'old/todo.txt', project: 'old', items, mode: 'replace', now: new Date(2026, 9, 31, 8, 0, 0) })
  assert.equal(existsSync(join(root, 'old/todo.txt')), false)
  assert.deepEqual(r.ids, ['OLD-001', 'OLD-002'])
  assert.equal(read(root, r.backup), 'buy milk\nfix the roof\n')
  assert.match(read(root, 'old/TODO.md'), /\[OLD-002\]/)
})

test('adoptWrite replace on the unformatted index itself rewrites it as a backlog', (t) => {
  const { root, ws } = load(t, { 'app/TODO.md': '# Plan\n\n- [ ] one thing\n- [ ] another\n' })
  const items = [{ type: 'code', text: 'One thing', sourceLines: [3] }, { type: 'code', text: 'Another', sourceLines: [4] }]
  const r = adoptWrite(ws, { source: 'app/TODO.md', project: 'app', items, mode: 'replace' })
  assert.equal(r.file, 'app/TODO.md')
  const text = read(root, 'app/TODO.md')
  assert.match(text, /\[APP-001\]/)
  assert.doesNotMatch(text, /one thing/)
  assert.ok(r.backup)
})

test('adoptWrite dryRun writes nothing', (t) => {
  const { root, ws } = load(t, { 'notes/handoff.md': HANDOFF })
  const r = adoptWrite(ws, { source: 'notes/handoff.md', project: 'notes', items: ITEMS, mode: 'strip', dryRun: true })
  assert.equal(r.status, 'preview')
  assert.deepEqual(r.ids, ['NOTE-001', 'NOTE-002'])
  assert.equal(read(root, 'notes/handoff.md'), HANDOFF)
  assert.equal(existsSync(join(root, 'notes/TODO.md')), false)
  assert.equal(existsSync(join(root, 'notes/.backlog')), false)
})

test('adoptWrite refuses to overwrite an existing backlog, empty input and sources outside the workspace', (t) => {
  const { ws } = load(t, { 'notes/handoff.md': HANDOFF, 'notes/TODO.md': '# Other\n- [ ] [NOTE-009] `[code]` x\n' })
  assert.throws(() => adoptWrite(ws, { source: 'notes/handoff.md', project: 'notes', items: ITEMS, mode: 'strip' }), InvalidInputError)
  assert.throws(() => adoptWrite(ws, { source: 'notes/handoff.md', project: 'notes', items: [], mode: 'strip' }), InvalidInputError)
  assert.throws(() => adoptWrite(ws, { source: '../outside.md', project: 'notes', items: ITEMS, mode: 'strip' }), InvalidInputError)
  assert.throws(() => adoptWrite(ws, { source: 'notes/handoff.md', project: 'notes', items: ITEMS, mode: 'bogus' }), InvalidInputError)
})

test('adoptWrite keeps CRLF and the BOM of the stripped source', (t) => {
  const source = `${BOM}${HANDOFF.replaceAll('\n', '\r\n')}`
  const { root, ws } = load(t, { 'notes/handoff.md': source })
  adoptWrite(ws, { source: 'notes/handoff.md', project: 'notes', items: ITEMS, mode: 'strip' })
  const text = read(root, 'notes/handoff.md')
  assert.ok(text.startsWith(BOM))
  assert.ok(!text.replaceAll('\r\n', '').includes('\n'))
  assert.doesNotMatch(text, /login bug/)
})
