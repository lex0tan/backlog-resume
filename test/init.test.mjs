import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { add } from '../scripts/lib/commands/add.mjs'
import { init } from '../scripts/lib/commands/init.mjs'
import { loadKeywords } from '../scripts/lib/i18n.mjs'
import { parseIndex } from '../scripts/lib/model.mjs'
import { loadWorkspace } from '../scripts/lib/workspace.mjs'

const empty = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'backlog-init-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('init in English: flat TODO.md with title, status section, "Next: —" and an empty items section; and an empty config', (t) => {
  const dir = empty(t)
  const r = init(dir)
  assert.deepEqual(r, { status: 'created', files: ['TODO.md', '.backlog.json'] })
  const text = readFileSync(join(dir, 'TODO.md'), 'utf8')
  assert.equal(text, '# Backlog\n\n## Status\n\n- Next: —\n\n## Items\n')
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.backlog.json'), 'utf8')), {})
  assert.equal(parseIndex(text, loadKeywords('en')).next, null)
})

test('init in Italian writes Italian keywords and .backlog.json with the language', (t) => {
  const dir = empty(t)
  const r = init(dir, { language: 'it' })
  assert.deepEqual(r.files, ['TODO.md', '.backlog.json'])
  assert.match(readFileSync(join(dir, 'TODO.md'), 'utf8'), /- Prossima attività: —/)
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.backlog.json'), 'utf8')), { language: 'it' })
})

test('a folder initialised below a workspace root is found as a project once it has its own config', (t) => {
  const root = empty(t)
  writeFileSync(join(root, '.backlog.json'), '{}')
  init(join(root, 'app'), { language: 'it' })
  assert.deepEqual(loadWorkspace(root).projects.map((p) => p.rel), ['app'])
})

test('init with workspace and prefix records them in .backlog.json', (t) => {
  const dir = empty(t)
  init(dir, { workspace: true, prefix: 'SHOP' })
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.backlog.json'), 'utf8')), { workspace: true, prefix: 'SHOP' })
})

test('init never overwrites: a second call answers exists and leaves every file untouched', (t) => {
  const dir = empty(t)
  init(dir, { language: 'it' })
  const before = ['TODO.md', '.backlog.json'].map((f) => readFileSync(join(dir, f), 'utf8'))
  const r = init(dir, { language: 'en', workspace: true })
  assert.deepEqual(r, { status: 'exists', files: [] })
  assert.deepEqual(['TODO.md', '.backlog.json'].map((f) => readFileSync(join(dir, f), 'utf8')), before)
})

test('init creates only what is missing and keeps an existing config', (t) => {
  const dir = empty(t)
  writeFileSync(join(dir, '.backlog.json'), '{ "language": "it" }\n')
  const r = init(dir, { language: 'it', workspace: true })
  assert.deepEqual(r, { status: 'created', files: ['TODO.md'] })
  assert.equal(readFileSync(join(dir, '.backlog.json'), 'utf8'), '{ "language": "it" }\n')
})

test('fresh English init at the workspace root is a project and accepts an item', (t) => {
  const dir = empty(t)
  init(dir)
  const ws = loadWorkspace(dir)
  assert.deepEqual(ws.projects.map((p) => p.rel), ['.'])
  const r = add(ws, { type: 'code', text: 'First task' })
  assert.match(r.id, /-001$/)
  assert.match(readFileSync(join(dir, 'TODO.md'), 'utf8'), /\[code\]` First task/)
})

test('fresh English init in a subfolder of a workspace is a project and accepts an item', (t) => {
  const root = empty(t)
  writeFileSync(join(root, '.backlog.json'), '{}')
  init(join(root, 'app'))
  const ws = loadWorkspace(root)
  assert.deepEqual(ws.projects.map((p) => p.rel), ['app'])
  assert.equal(add(ws, { project: 'app', type: 'code', text: 'First task' }).id, 'APP-001')
})

test('a workspace root with a config but no index file is not a project', (t) => {
  const root = empty(t)
  writeFileSync(join(root, '.backlog.json'), '{}')
  assert.deepEqual(loadWorkspace(root).projects, [])
})
