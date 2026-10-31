import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rmdirSync, symlinkSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { loadKeywords } from '../scripts/lib/i18n.mjs'
import { DEFAULTS } from '../scripts/lib/config.mjs'
import { discover, loadWorkspace } from '../scripts/lib/workspace.mjs'
import { englishShop, flat, italianShop, workspace } from './helpers/fixture.mjs'

const MODEL = flat()['TODO.md']

function spec() {
  const shop = italianShop()
  const files = {}
  for (const [path, text] of Object.entries(shop)) files[`shop/${path}`] = text
  // The subproject folder uses lower-case file names, as a case-insensitive file system would resolve them.
  files['shop/projects/mobile/todo.md'] = files['shop/projects/mobile/TODO.md']
  files['shop/projects/mobile/todo/app.md'] = '# App\n'
  delete files['shop/projects/mobile/TODO.md']
  for (const [path, text] of Object.entries(englishShop())) if (path === 'TODO.md') files['docs/TODO.md'] = MODEL.replace('Shop', 'Docs')
  files['notes/handoff.md'] = '# Handoff\n\nSome context.\n\n- [ ] first\n- [ ] second\n'
  files['old/todo.txt'] = 'buy milk\nx done thing\n'
  files['shop/node_modules/pkg/TODO.md'] = MODEL
  files['deep/a/b/c/d/e/TODO.md'] = MODEL
  return files
}

const run = (root, config = {}) => {
  const merged = { ...DEFAULTS, ...config }
  return discover(root, merged, loadKeywords('en'))
}

test('finds projects, skips excludes and depth, nested folders of a project are not projects', (t) => {
  const root = workspace(t, spec(), { config: { workspace: true } })
  const { projects } = run(root)
  assert.deepEqual(projects.map((p) => p.rel), ['docs', 'shop'])
  assert.ok(!projects.some((p) => p.rel.includes('node_modules') || p.rel.startsWith('deep')))
  assert.equal(projects[1].name, 'shop')
  assert.deepEqual(projects[1].aliases, ['shop'])
})

test('indexed subproject folder is not a second project (case-insensitive file systems)', (t) => {
  const root = workspace(t, spec(), { config: { workspace: true } })
  assert.ok(!run(root).projects.some((p) => p.rel === 'shop/projects/mobile'))
})

test('adoption candidates', (t) => {
  const root = workspace(t, spec(), { config: { workspace: true } })
  const { candidates } = run(root)
  const handoff = candidates.find((c) => c.file === 'notes/handoff.md')
  assert.deepEqual(handoff, { dir: 'notes', file: 'notes/handoff.md', kind: 'handoff', openLines: 2, mixed: true })
  const txt = candidates.find((c) => c.file === 'old/todo.txt')
  assert.equal(txt.kind, 'todo-txt')
  assert.equal(txt.openLines, 1)
})

test('symlinks and junctions are never followed', (t) => {
  const root = workspace(t, spec(), { config: { workspace: true } })
  try {
    symlinkSync(root, join(root, 'shop', 'loop'), 'junction')
  } catch (err) {
    t.skip(`cannot create junction: ${err.code}`)
    return
  }
  try {
    assert.deepEqual(run(root).projects.map((p) => p.rel), ['docs', 'shop'])
  } finally {
    // Remove the link itself so the recursive cleanup can never walk through it.
    try { rmdirSync(join(root, 'shop', 'loop')) } catch { unlinkSync(join(root, 'shop', 'loop')) }
  }
})

test('workspace focus is the deepest project containing cwd', (t) => {
  const root = workspace(t, { ...spec(), 'shop/src/a.js': '' }, { config: { workspace: true } })
  const inside = loadWorkspace(join(root, 'shop', 'src'))
  assert.equal(inside.focus.rel, 'shop')
  assert.equal(inside.root, root)
  assert.equal(loadWorkspace(root).focus, null)
})

test('exclude config removes a project', (t) => {
  const root = workspace(t, spec(), { config: { exclude: ['docs'] } })
  assert.deepEqual(loadWorkspace(root).projects.map((p) => p.rel), ['shop'])
})

test('folder with its own config and no index is a project with an empty tree', (t) => {
  const root = workspace(t, { 'bare/.backlog.json': '{}' }, { config: { workspace: true } })
  const [p] = discover(root, { ...DEFAULTS }, loadKeywords('en')).projects
  assert.equal(p.rel, 'bare')
  assert.equal(p.indexMissing, true)
  assert.equal(p.tree.top.exists, false)
  assert.equal(p.tree.top.file, 'TODO.md')
  assert.deepEqual(p.tree.nodes, [])
})

test('own config wins over a non-model index', (t) => {
  const root = workspace(t, { 'plain/.backlog.json': '{}', 'plain/TODO.md': '# Notes\n\nnothing here\n' }, { config: { workspace: true } })
  const [p] = run(root).projects
  assert.equal(p.rel, 'plain')
  assert.equal(p.indexMissing, false)
})

test('config.projects dedupes against a discovered project and registers missing-index folders', (t) => {
  const root = workspace(t, { 'docs/TODO.md': MODEL, 'bare/.backlog.json': '{}' }, { config: { workspace: true } })
  const { projects } = run(root, { projects: ['docs', './docs', 'docs/', join(root, 'docs'), ...(process.platform === 'win32' || process.platform === 'darwin' ? ['./DOCS'] : []), 'bare'] })
  assert.deepEqual(projects.map((p) => p.rel), ['bare', 'docs'])
  assert.equal(projects[0].indexMissing, true)
})

test('depth boundary: project at maxDepth found, maxDepth + 1 not; backslash excludes work', (t) => {
  const root = workspace(t, { 'a/b/TODO.md': MODEL, 'a/b/c/TODO.md': MODEL, 'x/y/TODO.md': MODEL }, { config: { workspace: true } })
  assert.deepEqual(run(root, { maxDepth: 2 }).projects.map((p) => p.rel), ['a/b', 'x/y'])
  assert.deepEqual(run(root, { maxDepth: 3 }).projects.map((p) => p.rel), ['a/b', 'a/b/c', 'x/y'])
  assert.deepEqual(run(root, { maxDepth: 3, exclude: ['a' + String.fromCharCode(92) + 'b'] }).projects.map((p) => p.rel), ['x/y'])
})
