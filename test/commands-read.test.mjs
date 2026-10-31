import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { AmbiguousIdError } from '../scripts/lib/errors.mjs'
import { files } from '../scripts/lib/commands/files.mjs'
import { item } from '../scripts/lib/commands/item.mjs'
import { list } from '../scripts/lib/commands/list.mjs'
import { summary } from '../scripts/lib/commands/summary.mjs'
import { loadWorkspace } from '../scripts/lib/workspace.mjs'
import { englishShop, flat, italianShop, workspace } from './helpers/fixture.mjs'

const run = (root, ...args) =>
  execFileSync('git', ['-C', root, '-c', 'commit.gpgsign=false', '-c', 'user.email=t@example.com', '-c', 'user.name=T', ...args], { stdio: 'ignore' })
const commit = (root, message) => run(root, 'commit', '-q', '--allow-empty', '-m', message)
const write = (root, path, text) => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}
const TODAY = '2026-10-11'
const inDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
const shopWs = (t, shop = englishShop(), options = { git: true }) => loadWorkspace(workspace(t, shop, options))
const CYCLE = ['# T', '', '- [ ] [CY-001] `[code]` One', '  Depends on: `CY-002`', '- [ ] [CY-002] `[code]` Two', '  Depends on: `CY-001`', '- [ ] [CY-003] `[code]` Free', ''].join('\n')

test('item: open item with its links, blockers, parts and waiting state', (t) => {
  const ws = shopWs(t, italianShop(), { git: true, config: { language: 'it' } })
  const r = item(ws, 'SHOP-WEB-001', TODAY)
  assert.equal(r.status, 'open')
  assert.equal(r.project, '.')
  assert.equal(r.file, 'todo/web.md')
  assert.equal(r.type, 'content')
  assert.equal(r.text, 'Pagina di atterraggio')
  assert.deepEqual(r.deps, [{ id: 'SHOP-API-001', open: true }])
  assert.deepEqual(r.blocks, ['SHOP-WEB-003'])
  assert.deepEqual(r.blockedBy.map((b) => b.id), ['SHOP-API-001'])
  assert.equal(r.blockedBy[0].file, 'todo/api.md')
  assert.equal(r.blockedBy[0].text, 'Endpoint di export')
  assert.equal(r.parts.length, 3)
  assert.equal(r.waiting, false, 'open parts are not all the user\'s')
  assert.equal(r.cycle, null)
  assert.equal(item(ws, 'SHOP-API-001').doneWhen, '`GET /export` risponde 200')
})

test('item: closed with evidence when removed from the backlog but cited by a commit', (t) => {
  const spec = englishShop()
  const root = workspace(t, spec, { git: true })
  write(root, 'todo/api.md', spec['todo/api.md'].replace(/- \[ \] \[SHOP-API-001\][^\n]*\n[^\n]*\n/, ''))
  commit(root, 'feat: export (SHOP-API-001)')
  const r = item(loadWorkspace(root), 'SHOP-API-001', TODAY)
  assert.equal(r.status, 'closed')
  assert.match(r.commits[0], /SHOP-API-001/)
  assert.match(r.note, /closed with evidence/)
})

test('item: work on an unmerged branch is reported on the still open item', (t) => {
  const root = workspace(t, englishShop(), { git: true })
  run(root, 'checkout', '-q', '-b', 'feat/export')
  commit(root, 'feat: export (SHOP-API-001)')
  run(root, 'checkout', '-q', 'main')
  commit(root, 'feat: other (SHOP-WEB-001)')
  const ws = loadWorkspace(root)
  const r = item(ws, 'SHOP-API-001', TODAY)
  assert.equal(r.status, 'open')
  assert.equal(r.unmerged.length, 1)
  assert.equal(r.unmerged[0].branch, 'feat/export')
  assert.match(r.note, /feat\/export/)
  assert.deepEqual(item(ws, 'SHOP-WEB-001', TODAY).unmerged, [], 'a commit already in HEAD is not elsewhere')
  const api = list(ws, TODAY).projects[0].workstreams.find((w) => w.id === 'SHOP-API')
  assert.equal(api.items.find((i) => i.id === 'SHOP-API-001').unmerged[0].branch, 'feat/export')
})

test('item: declared done without commits cannot be verified', (t) => {
  const r = item(shopWs(t), 'SHOP-API-003', TODAY)
  assert.equal(r.status, 'declared-done')
  assert.deepEqual(r.commits, [])
  assert.match(r.note, /cannot be verified/)
})

test('item: unknown ID is not-found without throwing; an ID in two projects is ambiguous', (t) => {
  const ws = shopWs(t)
  const r = item(ws, 'SHOP-ZZZ-001', TODAY)
  assert.equal(r.status, 'not-found')
  assert.deepEqual(r.commits, [])
  assert.equal(r.project, null)
  const twin = {}
  for (const [path, text] of Object.entries(flat())) {
    twin[`a/${path}`] = text
    twin[`b/${path}`] = text
  }
  const two = loadWorkspace(workspace(t, twin, { config: { workspace: true } }))
  assert.throws(() => item(two, 'SHOP-002', TODAY), AmbiguousIdError)
  assert.equal(item(two, 'b:SHOP-002', TODAY).project, 'b')
})

test('item: the IDs listed under Was are searched in commits too', (t) => {
  const root = workspace(t, flat(), { git: true })
  write(root, 'TODO.md', flat()['TODO.md'].replace('  Done when: the list renders', '  Done when: the list renders\n  Was: OLD-001'))
  run(root, 'add', '-A')
  commit(root, 'chore: renumber')
  commit(root, 'fix: OLD-001 list')
  const r = item(loadWorkspace(root), 'SHOP-002', TODAY)
  assert.ok(r.commits.some((c) => c.includes('OLD-001')))
})

test('item: only the user\'s parts open, or a decision, means waiting', (t) => {
  const ws = shopWs(t, flat(), {})
  const content = item(ws, 'SHOP-004', TODAY)
  assert.equal(content.waiting, true)
  assert.deepEqual(content.steps, ['Approve the draft'])
  assert.equal(item(ws, 'SHOP-003', TODAY).waiting, true, 'a decision waits on the user')
  assert.equal(item(ws, 'SHOP-002', TODAY).waiting, false)
})

test('item: dates drive when', (t) => {
  const ws = shopWs(t, flat(), {})
  assert.deepEqual(item(ws, 'SHOP-003', '2026-01-12').when, { from: '2026-01-10', days: 2, state: 'due' })
  assert.equal(item(ws, 'SHOP-003', '2026-01-14').when.state, 'overdue')
  assert.equal(item(ws, 'SHOP-003', '2026-01-01').when.state, 'later')
})

test('item and list: an item in a dependency cycle carries the chain', (t) => {
  const ws = shopWs(t, { 'TODO.md': CYCLE }, {})
  assert.deepEqual(item(ws, 'CY-001', TODAY).cycle, ['CY-001', 'CY-002', 'CY-001'])
  assert.equal(item(ws, 'CY-003', TODAY).cycle, null)
  const items = list(ws, TODAY).projects[0].workstreams[0].items
  assert.deepEqual(items.find((i) => i.id === 'CY-002').cycle, ['CY-001', 'CY-002', 'CY-001'])
  assert.equal(items.find((i) => i.id === 'CY-003').cycle, null)
})

test('item and list: stale after staleDays of age, never when it starts later', (t) => {
  const text = flat()['TODO.md'].replace('  From: 2026-01-10', `  From: ${inDays(100)}`)
  const ws = shopWs(t, { 'TODO.md': text }, { git: true })
  const old = inDays(40)
  assert.ok(item(ws, 'SHOP-002', old).stale.days >= 40)
  assert.equal(item(ws, 'SHOP-002', inDays(0)).stale, null, 'committed today')
  assert.equal(item(ws, 'SHOP-003', old).stale, null, 'its From date is in the future')
  const listed = list(ws, old).projects[0].workstreams[0].items
  assert.ok(listed.find((i) => i.id === 'SHOP-002').stale.days >= 40)
  assert.equal(listed.find((i) => i.id === 'SHOP-003').stale, null)
})

test('list: workstreams of every project with items, blockers, next and area', (t) => {
  const ws = shopWs(t)
  const r = list(ws, TODAY)
  assert.equal(r.status, 'ok')
  assert.equal(r.language, 'en')
  assert.equal(r.focus, '.')
  assert.deepEqual(r.settings, { lockMinutes: 5, staleDays: 30 })
  assert.equal(r.projects.length, 1)
  const [p] = r.projects
  assert.equal(p.rel, '.')
  assert.equal(p.next, 'SHOP-API-001')
  const w = (id) => p.workstreams.find((x) => x.id === id)
  assert.equal(w('SHOP-MKT-SEO').label, 'Marketing · SEO')
  assert.equal(w('SHOP-MKT-ADS').next, 'SHOP-MKT-ADS-001')
  assert.deepEqual(w('SHOP-MKT-SEO').area, { id: 'SHOP-MKT', name: 'Marketing', subproject: false })
  assert.deepEqual(w('MOBILE-UI').area, { id: 'MOBILE', name: 'Mobile app', subproject: true })
  assert.equal(w('MOBILE-UI').subproject, 'MOBILE')
  assert.equal(w('MOBILE-UI').file, 'projects/mobile/todo/ui.md')
  assert.equal(w('SHOP-API').subproject, null)
  assert.equal(w('SHOP-GHOST').exists, false)
  assert.deepEqual(w('SHOP-GHOST').items, [])
  assert.deepEqual(w('SHOP-API').items.map((i) => i.id), ['SHOP-API-002', 'SHOP-API-001'], 'overdue first')
  assert.deepEqual(w('SHOP-API').items.find((i) => i.id === 'SHOP-API-002').blockedBy, ['SHOP-MKT-ADS-001'])
  assert.deepEqual(w('SHOP-MKT-ADS').items[0].unblocks, ['SHOP-API-002'])
  const web = w('SHOP-WEB').items.find((i) => i.id === 'SHOP-WEB-001')
  assert.equal(web.project, '.')
  assert.equal(web.workstream, 'SHOP-WEB')
  assert.equal(web.type, 'content')
  assert.equal(web.text, 'Landing page')
  assert.equal(web.waiting, false)
  assert.deepEqual(web.steps, ['Pay for the domain'])
  assert.equal(r.typeOrder[0], 'code')
  assert.ok(r.typeOrder.includes('decision') && r.typeOrder.includes('content'))
})

test('list: From dates put arrived items first, overdue oldest first, future last', (t) => {
  const text = ['# CRM', '',
    '- [ ] [CRM-001] `[code]` No date',
    '- [ ] [CRM-002] `[seo]` Future', '  From: 2026-10-20',
    '- [ ] [CRM-003] `[seo]` Arrived today', '  From: 2026-10-11',
    '- [ ] [CRM-004] `[seo]` Overdue', '  From: 2026-10-01',
    '- [ ] [CRM-005] `[seo]` Bad date', '  From: soon', ''].join('\n')
  const ws = shopWs(t, { 'TODO.md': text }, {})
  const r = list(ws, TODAY)
  const items = r.projects[0].workstreams[0].items
  assert.deepEqual(items.map((i) => i.id), ['CRM-004', 'CRM-003', 'CRM-001', 'CRM-005', 'CRM-002'])
  assert.deepEqual(items[0].when, { from: '2026-10-01', days: 10, state: 'overdue' })
  assert.deepEqual(items[1].when, { from: '2026-10-11', days: 0, state: 'due' })
  assert.equal(items[4].when.state, 'later')
  assert.match(items.find((i) => i.id === 'CRM-005').text, /From: soon/)
  assert.deepEqual(r.projects[0].due, ['CRM-004', 'CRM-003'])
})

test('list: project option and configured typeOrder', (t) => {
  const spec = { 'docs/TODO.md': flat()['TODO.md'].replaceAll('SHOP-', 'DOC-') }
  for (const [path, text] of Object.entries(englishShop())) spec[`shop/${path}`] = text
  const ws = loadWorkspace(workspace(t, spec, { config: { workspace: true, typeOrder: ['decision', 'code'] } }))
  const all = list(ws, TODAY)
  assert.deepEqual(all.projects.map((p) => p.rel), ['docs', 'shop'])
  assert.deepEqual(all.typeOrder, ['decision', 'code'])
  const one = list(ws, TODAY, { project: 'shop' })
  assert.deepEqual(one.projects.map((p) => p.rel), ['shop'])
  assert.equal(one.projects[0].workstreams.find((x) => x.id === 'SHOP-API').file, 'shop/todo/api.md')
  assert.equal(one.projects[0].workstreams[0].items[0].project, 'shop')
})

test('summary: counts per project and adoption candidates', (t) => {
  const spec = { 'docs/TODO.md': flat()['TODO.md'].replaceAll('SHOP-', 'DOC-'), 'old/todo.txt': 'buy milk\n' }
  for (const [path, text] of Object.entries(englishShop())) spec[`shop/${path}`] = text
  const ws = loadWorkspace(workspace(t, spec, { config: { workspace: true }, git: true }))
  const r = summary(ws, '2026-01-12')
  assert.equal(r.status, 'ok')
  assert.deepEqual(r.projects.map((p) => p.rel), ['docs', 'shop'])
  const docs = r.projects[0]
  assert.equal(docs.next, 'DOC-002')
  assert.equal(docs.open, 3)
  assert.deepEqual(docs.due, ['DOC-003'])
  assert.deepEqual(docs.overdue, [])
  assert.equal(docs.waiting, 2, 'a decision and an item with only user steps left')
  assert.equal(docs.cycles, 0)
  assert.equal(docs.git, 'clean')
  const shop = r.projects[1]
  assert.deepEqual(shop.due, ['SHOP-API-002', 'MOBILE-UI-001'])
  assert.deepEqual(shop.overdue, [])
  assert.equal(shop.cycles, 0)
  assert.deepEqual(summary(ws, '2026-02-01').projects[1].overdue, ['SHOP-API-002', 'MOBILE-UI-001'])
  assert.ok(r.candidates.some((c) => c.file === 'old/todo.txt'))
})

test('summary: counts each cycle once, null git without a repository', (t) => {
  const ws = shopWs(t, { 'TODO.md': CYCLE }, {})
  const [p] = summary(ws, TODAY).projects
  assert.equal(p.cycles, 1)
  assert.equal(p.git, null)
})

test('files: backlog files of each project, subproject indexes included, excluded folders skipped, no git', (t) => {
  const spec = englishShop()
  spec['node_modules/pkg/TODO.md'] = flat()['TODO.md']
  const root = workspace(t, spec, { git: true })
  const ws = loadWorkspace(root)
  const r = files(ws)
  assert.equal(r.status, 'ok')
  assert.equal(r.projects.length, 1)
  const abs = (rel) => join(root, rel).replaceAll('\\', '/')
  const got = r.projects[0].files
  assert.ok(got.every((f) => !f.includes('node_modules')))
  for (const rel of ['TODO.md', 'todo/api.md', 'todo/marketing/seo.md', 'projects/mobile/TODO.md', 'projects/mobile/todo/ui.md']) {
    assert.ok(got.includes(abs(rel)), rel)
  }
  assert.ok(!got.some((f) => f.endsWith('ghost.md')), 'a missing file is not listed')
  assert.equal(new Set(got).size, got.length)
  const saved = process.env.PATH
  process.env.PATH = ''
  try {
    assert.equal(files(ws).projects[0].files.length, got.length, 'works without git on the path')
  } finally {
    process.env.PATH = saved
  }
})
