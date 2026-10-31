import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findWorkspace, effectiveConfig, DEFAULTS } from '../scripts/lib/config.mjs'
import { ConfigError } from '../scripts/lib/errors.mjs'

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'backlog-cfg-')))
const MODEL = '# Backlog\n\n- [ ] [SHOP-001] First thing\n'

test('outermost .backlog.json is the root; configs outermost first', () => {
  const w = tmp()
  mkdirSync(join(w, 'app', 'src'), { recursive: true })
  writeFileSync(join(w, '.backlog.json'), '{"language":"it"}')
  writeFileSync(join(w, 'app', '.backlog.json'), '{"staleDays":5}')
  const r = findWorkspace(join(w, 'app', 'src'))
  assert.equal(r.root, w)
  assert.equal(r.configs.length, 2)
  assert.equal(r.configs[0].path, join(w, '.backlog.json'))
  assert.equal(r.configs[1].data.staleDays, 5)
})

test('without configs the nearest ancestor with a model index is the root', () => {
  const w = tmp()
  mkdirSync(join(w, 'app', 'src'), { recursive: true })
  writeFileSync(join(w, 'app', 'TODO.md'), MODEL)
  const r = findWorkspace(join(w, 'app', 'src'))
  assert.equal(r.root, join(w, 'app'))
  assert.deepEqual(r.configs, [])
})

test('a TODO.md not in the model format does not count; fallback is cwd', () => {
  const w = tmp()
  mkdirSync(join(w, 'app'), { recursive: true })
  writeFileSync(join(w, 'app', 'TODO.md'), '# Notes\n\nnothing structured\n')
  assert.equal(findWorkspace(join(w, 'app')).root, join(w, 'app'))
})

test('invalid JSON throws ConfigError with the file', () => {
  const w = tmp()
  writeFileSync(join(w, '.backlog.json'), '{ nope')
  assert.throws(() => findWorkspace(w), (e) => e instanceof ConfigError && e.context.file === join(w, '.backlog.json'))
})

test('effectiveConfig: project wins, keywords merge per key', () => {
  const c = effectiveConfig({ language: 'it', staleDays: 10, keywords: { next: 'X', user: 'U' } }, { staleDays: 5, keywords: { next: 'Y' } })
  assert.equal(c.staleDays, 5)
  assert.equal(c.language, 'it')
  assert.deepEqual(c.keywords, { next: 'Y', user: 'U' })
})

test('DEFAULTS', () => {
  assert.deepEqual(DEFAULTS, {
    language: 'en', keywords: {}, exclude: [], maxDepth: 4, projects: [], aliases: [], prefix: null,
    overview: null, staleDays: 30, overdueDays: 3, lockMinutes: 5, typeOrder: [], index: 'TODO.md',
  })
})
