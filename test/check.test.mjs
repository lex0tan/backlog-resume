import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { InvalidInputError } from '../scripts/lib/errors.mjs'
import { check } from '../scripts/lib/commands/check.mjs'
import { loadWorkspace } from '../scripts/lib/workspace.mjs'
import { englishShop, flat, italianShop, workspace } from './helpers/fixture.mjs'

const ws = (t, spec, options) => loadWorkspace(workspace(t, spec, options))
const codes = (r) => r.issues.map((i) => i.code)
const find = (r, code, id) => r.issues.find((i) => i.code === code && (!id || i.ids?.includes(id)))
const item = (id, ...meta) => [`- [ ] [${id}] \`[code]\` Task ${id}`, ...meta.map((m) => `  ${m}`)].join('\n')
const list = (...items) => ['# Backlog', '', ...items, ''].join('\n')
const here = (path) => JSON.stringify(pathToFileURL(join(import.meta.dirname, path)).href)

test('shop: missing workstream file, missing reference, checked-off item, no false cycle', (t) => {
  const r = check(ws(t, englishShop(), { git: true }))
  assert.equal(r.status, 'error')
  assert.deepEqual(find(r, 'missing-file'), { level: 'error', code: 'missing-file', project: '.', file: 'todo/ghost.md', message: 'Workstream SHOP-GHOST points to a missing file: todo/ghost.md' })
  const ref = r.issues.find((i) => i.code === 'missing-ref')
  assert.equal(ref.level, 'info')
  assert.match(ref.message, /notes\/missing\.md/)
  assert.doesNotMatch(r.issues.map((i) => i.message).join('\n'), /notes\/exists\.md/)
  assert.equal(find(r, 'declared-done', 'SHOP-API-003').level, 'warn')
  assert.ok(!codes(r).includes('dependency-cycle'))
  assert.ok(!codes(r).includes('stale-next'))
  const api = r.files.find((f) => f.id === 'SHOP-API')
  assert.equal(api.file, 'todo/api.md')
  assert.equal(api.status, 'in progress')
  assert.match(api.lastModified, /^\d{4}-\d{2}-\d{2}$/)
})

test('shop in Italian gives the same codes, messages in Italian', (t) => {
  const en = check(ws(t, englishShop(), { git: true }))
  const it = check(ws(t, italianShop(), { git: true, config: { language: 'it' } }))
  assert.deepEqual(codes(it), codes(en))
  assert.match(find(it, 'missing-file').message, /punta a un file mancante/)
})

test('stale next, item without ID, wrong workstream and dangling link', (t) => {
  const spec = englishShop()
  spec['TODO.md'] = spec['TODO.md'].replace('SHOP-API-001', 'SHOP-API-099')
  spec['todo/orders.md'] += '- [ ] An item with no ID\n'
  spec['todo/ops.md'] += '- [ ] [SHOP-API-050] `[code]` Misplaced\n  Depends on: `SHOP-NOPE-001`\n'
  const r = check(ws(t, spec), { fast: true })
  assert.equal(find(r, 'stale-next').file, 'TODO.md')
  assert.equal(find(r, 'no-id').file, 'todo/orders.md')
  assert.equal(find(r, 'wrong-workstream', 'SHOP-API-050').file, 'todo/ops.md')
  const dangling = find(r, 'dangling-link', 'SHOP-API-050')
  assert.equal(dangling.level, 'info')
  assert.match(dangling.message, /SHOP-NOPE-001/)
})

test('wrong-workstream is skipped in a flat project; a checked item is declared-done', (t) => {
  const r = check(ws(t, flat()), { fast: true })
  assert.ok(!codes(r).includes('wrong-workstream'))
  assert.equal(find(r, 'declared-done', 'SHOP-001').level, 'warn')
})

test('open item without a "Done when" criterion is a warning', (t) => {
  const r = check(ws(t, flat()), { fast: true })
  assert.equal(find(r, 'no-done-when', 'SHOP-003').level, 'warn')
  assert.equal(find(r, 'no-done-when', 'SHOP-002'), undefined, 'SHOP-002 has one')
  assert.equal(find(r, 'no-done-when', 'SHOP-001'), undefined, 'a checked item is not open')
})

test('dependency cycle: error with the full chain and the IDs', (t) => {
  const r = check(ws(t, { 'TODO.md': list(item('CY-001', 'Depends on: `CY-002`'), item('CY-002', 'Depends on: `CY-001`'), item('CY-003')) }), { fast: true })
  const issue = find(r, 'dependency-cycle')
  assert.equal(issue.level, 'error')
  assert.match(issue.message, /CY-001 → CY-002 → CY-001/)
  assert.deepEqual(issue.ids, ['CY-001', 'CY-002'])
  assert.equal(r.status, 'error')
})

test('cycle across projects: reported once, also when filtering on the other project', (t) => {
  const w = ws(t, {
    'shop/TODO.md': list(item('SHP-001', 'Depends on: `DOC-001`')),
    'docs/TODO.md': list(item('DOC-001', 'Depends on: `SHP-001`')),
  }, { config: {} })
  const cycles = check(w, { fast: true }).issues.filter((i) => i.code === 'dependency-cycle')
  assert.equal(cycles.length, 1)
  assert.match(cycles[0].message, /→/)
  assert.equal(check(w, { fast: true, project: 'docs' }).issues.filter((i) => i.code === 'dependency-cycle').length, 1)
})

test('same ID in two projects: duplicate-id error naming both files', (t) => {
  const r = check(ws(t, { 'shop/TODO.md': list(item('DUP-001')), 'docs/TODO.md': list(item('DUP-001')) }, { config: {} }), { fast: true })
  const issue = find(r, 'duplicate-id')
  assert.equal(issue.level, 'error')
  assert.match(issue.message, /shop\/TODO\.md/)
  assert.match(issue.message, /docs\/TODO\.md/)
  assert.deepEqual(issue.ids, ['DUP-001'])
})

test('bare dependency on an ID that exists in several projects: ambiguous-link', (t) => {
  const r = check(ws(t, {
    'shop/TODO.md': list(item('DUP-001')),
    'docs/TODO.md': list(item('DUP-001')),
    'mobile/TODO.md': list(item('MOB-001', 'Depends on: `DUP-001`')),
  }, { config: {} }), { fast: true })
  const issue = find(r, 'ambiguous-link', 'MOB-001')
  assert.equal(issue.level, 'error')
  assert.equal(issue.project, 'mobile')
  assert.match(issue.message, /docs:DUP-001/)
  assert.match(issue.message, /shop:DUP-001/)
})

test('a dependency resolved in its own project is not ambiguous', (t) => {
  const r = check(ws(t, {
    'shop/TODO.md': list(item('DUP-001'), item('SHP-001', 'Depends on: `DUP-001`')),
    'docs/TODO.md': list(item('DUP-001')),
  }, { config: {} }), { fast: true })
  assert.ok(!codes(r).includes('ambiguous-link'))
})

test('project with its own config and no index file: missing-index error suggesting init', (t) => {
  const r = check(ws(t, { 'app/.backlog.json': '{}', 'shop/TODO.md': list(item('SHP-001', 'Done when: ok')) }, { config: {} }), { fast: true })
  const issue = find(r, 'missing-index')
  assert.equal(issue.level, 'error')
  assert.equal(issue.project, 'app')
  assert.equal(issue.file, 'app/TODO.md')
  assert.match(issue.message, /\/nextup init/)
})

test('project filter keeps its own issues and the duplicates and cycles that involve it', (t) => {
  const w = ws(t, {
    'shop/TODO.md': list(item('DUP-001'), item('SHP-001', 'Depends on: `SHP-002`'), item('SHP-002', 'Depends on: `SHP-001`')),
    'docs/TODO.md': list(item('DUP-001'), item('DOC-001')),
    'mobile/TODO.md': list(item('MOB-001')),
  }, { config: {} })
  const docs = check(w, { project: 'docs', fast: true })
  assert.ok(docs.issues.every((i) => i.project === 'docs' || i.code === 'duplicate-id'))
  assert.ok(codes(docs).includes('duplicate-id'))
  assert.ok(!codes(docs).includes('dependency-cycle'))
  assert.ok(find(docs, 'no-done-when', 'DOC-001'))
  assert.ok(codes(check(w, { project: 'shop', fast: true })).includes('dependency-cycle'))
  assert.deepEqual(check(w, { project: 'mobile', fast: true }).issues.map((i) => i.code), ['no-done-when'])
  assert.deepEqual([...new Set(docs.files.map((f) => f.project))], ['docs'])
  assert.throws(() => check(w, { project: 'nope' }), InvalidInputError)
})

test('stale-item: open longer than staleDays, with the proposal; fast skips it', (t) => {
  const root = workspace(t, { 'TODO.md': list(item('OLD-001', 'Done when: ok'), item('OLD-002', 'Done when: ok', 'From: 2999-01-01')) })
  const env = { ...process.env, GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' }
  const g = (...args) => execFileSync('git', ['-C', root, '-c', 'user.email=t@example.com', '-c', 'user.name=T', '-c', 'commit.gpgsign=false', ...args], { stdio: 'ignore', env })
  g('init', '-q', '-b', 'main')
  g('add', '-A')
  g('commit', '-q', '-m', 'old')
  const w = loadWorkspace(root)
  const r = check(w, { today: '2026-10-31' })
  const stale = find(r, 'stale-item', 'OLD-001')
  assert.equal(stale.level, 'warn')
  assert.match(stale.message, /\b3\d\d days/)
  assert.match(stale.message, /keep, postpone with From:, or remove/)
  assert.equal(find(r, 'stale-item', 'OLD-002'), undefined, 'a future From: is not stale')
  assert.ok(!codes(check(w, { today: '2026-10-31', fast: true })).includes('stale-item'))
})

test('fast check works with an empty PATH (no git): no stale-item, no git-only data', (t) => {
  const root = workspace(t, englishShop(), { git: true })
  const script = `
    import { check } from ${here('../scripts/lib/commands/check.mjs')}
    import { loadWorkspace } from ${here('../scripts/lib/workspace.mjs')}
    process.stdout.write(JSON.stringify(check(loadWorkspace(process.argv[1]), { fast: true })))
  `
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', script, root], { encoding: 'utf8', env: { ...process.env, PATH: '', Path: '' } })
  assert.equal(out.status, 0, out.stderr)
  const r = JSON.parse(out.stdout)
  assert.ok(!r.issues.some((i) => i.code === 'stale-item' || i.code === 'missing-ref'))
  assert.deepEqual(r.issues.filter((i) => i.level === 'error').map((i) => i.code), ['missing-file'], 'only the missing workstream file')
  assert.ok(r.files.every((f) => f.lastModified === null))
})

test('ambiguous-link message suggests qualifying with project:ID, and a qualified link resolves', (t) => {
  const spec = {
    'shop/TODO.md': list(item('DUP-001')),
    'docs/TODO.md': list(item('DUP-001')),
    'mobile/TODO.md': list(item('MOB-001', 'Depends on: `DUP-001`'), item('MOB-002', 'Depends on: `docs:DUP-001`')),
  }
  const r = check(ws(t, spec, { config: {} }), { fast: true })
  assert.match(find(r, 'ambiguous-link', 'MOB-001').message, /Qualify it with project:ID/)
  assert.equal(find(r, 'ambiguous-link', 'MOB-002'), undefined)
  assert.equal(find(r, 'dangling-link', 'MOB-002'), undefined)
})
