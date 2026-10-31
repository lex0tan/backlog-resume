import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AmbiguousIdError, ItemNotFoundError } from '../scripts/lib/errors.mjs'
import { resolveId, route } from '../scripts/lib/routing.mjs'
import { loadWorkspace } from '../scripts/lib/workspace.mjs'
import { englishShop, italianShop, workspace } from './helpers/fixture.mjs'

const DOCS = ['# Docs', '', '- Next: `DOC-002`', '', '- [x] [DOC-001] `[code]` Setup', '- [ ] [DOC-002] `[code]` Write the guide', ''].join('\n')

function spec(shop, extra = {}) {
  const files = {}
  for (const [path, text] of Object.entries(shop)) files[`shop/${path}`] = text
  files['docs/TODO.md'] = DOCS
  return { ...files, ...extra }
}

function setup(t, shop, lang, extra) {
  const files = spec(shop, extra)
  if (lang === 'it') files['docs/TODO.md'] = files['docs/TODO.md'].replace('Next:', 'Prossima attività:')
  const root = workspace(t, files, { config: { workspace: true, ...(lang ? { language: lang } : {}) } })
  return { root, ws: loadWorkspace(root) }
}

const paths = (r) => r.read.map((x) => x.path)
const withFocus = (ws, name) => ({ ...ws, focus: ws.projects.find((p) => p.name === name) })

test('1. general request from the shop folder: index and next item, nothing else', (t) => {
  const { ws } = setup(t, italianShop(), 'it')
  const r = route(withFocus(ws, 'shop'), 'a che punto siamo?')
  assert.equal(r.status, 'general')
  assert.deepEqual(paths(r), ['shop/CLAUDE.md', 'shop/TODO.md', 'shop/todo/api.md'])
  assert.ok(r.excluded.includes('shop/todo/web.md') && r.excluded.includes('docs/TODO.md'))
  assert.equal(r.item, 'SHOP-API-001')
})

test('2. subproject: its rules and the workstream of its next item', (t) => {
  const { ws } = setup(t, italianShop(), 'it')
  const r = route(ws, 'riprendi mobile')
  assert.equal(r.project, 'shop')
  assert.equal(r.leaf, 'MOBILE-UI')
  assert.deepEqual(paths(r), ['shop/CLAUDE.md', 'shop/projects/mobile/CLAUDE.md', 'shop/TODO.md', 'shop/projects/mobile/TODO.md', 'shop/projects/mobile/todo/ui.md'])
  assert.ok(r.excluded.includes('shop/todo/marketing/index.md'))
})

test('3. general marketing: no backend, no subproject files', (t) => {
  const { ws } = setup(t, italianShop(), 'it')
  const r = route(ws, 'Voglio lavorare sul marketing.')
  assert.equal(r.target, 'SHOP-MKT')
  assert.equal(r.leaf, 'SHOP-MKT-ADS')
  for (const x of ['shop/todo/api.md', 'shop/todo/marketing/seo.md', 'shop/projects/mobile/todo/marketing.md', 'shop/projects/mobile/TODO.md']) assert.ok(r.excluded.includes(x), x)
})

test('4. marketing of a subproject: its workstream, not the general one', (t) => {
  const { ws } = setup(t, italianShop(), 'it')
  const r = route(ws, 'Voglio lavorare sul marketing di mobile.')
  assert.equal(r.leaf, 'MOBILE-MKT')
  assert.ok(paths(r).includes('shop/projects/mobile/todo/marketing.md'))
  assert.ok(r.excluded.includes('shop/todo/marketing/index.md') && r.excluded.includes('shop/projects/mobile/todo/ui.md'))
})

test('5. backend: only that workstream, with the linked dependency', (t) => {
  const { ws } = setup(t, italianShop(), 'it')
  const r = route(ws, 'sistemare il backend')
  assert.equal(r.leaf, 'SHOP-API')
  assert.ok(r.excluded.includes('shop/todo/marketing/index.md'))
  assert.ok(r.linked.some((l) => l.id === 'SHOP-MKT-ADS-001' && l.file === 'shop/todo/marketing/ads.md' && l.open))
})

test('6. ambiguous request: one question, no backlog loaded', (t) => {
  const { ws } = setup(t, italianShop(), 'it')
  const r = route(ws, 'lavoro sulle email')
  assert.equal(r.status, 'ambiguous')
  assert.deepEqual(r.candidates.map((c) => c.id).sort(), ['SHOP-OPS', 'SHOP-ORD'])
  assert.deepEqual(paths(r), ['shop/CLAUDE.md', 'shop/TODO.md'])
  assert.match(r.question, /\?$/)
})

test('7. segmented backlog: a single area is loaded', (t) => {
  const { ws } = setup(t, italianShop(), 'it')
  const r = route(ws, 'seo')
  assert.equal(r.leaf, 'SHOP-MKT-SEO')
  assert.ok(paths(r).includes('shop/todo/marketing/seo.md'))
  assert.ok(r.excluded.includes('shop/todo/marketing/ads.md'))
})

test('8. cited file that is missing, and missing workstream file', (t) => {
  const { ws } = setup(t, italianShop(), 'it')
  const r = route(ws, 'seo')
  assert.deepEqual(r.missingRefs, ['notes/missing.md'])
  const g = route(ws, 'ghost')
  assert.equal(g.status, 'missing-file')
  assert.deepEqual(g.missingFiles, [{ id: 'SHOP-GHOST', file: 'shop/todo/ghost.md' }])
})

test('12. open decision that blocks an item is linked from the other side', (t) => {
  const { ws } = setup(t, italianShop(), 'it')
  const r = route(ws, 'ads')
  assert.ok(r.linked.some((l) => l.from === 'SHOP-API-002' || l.id === 'SHOP-API-002'))
})

test('13. workstream that does not exist in a subproject: question, nothing invented', (t) => {
  const { ws } = setup(t, italianShop(), 'it')
  const r = route(ws, 'marketing del kiosk')
  assert.equal(r.status, 'missing-workstream')
  assert.deepEqual(r.available.map((a) => a.id), ['KIOSK-SCREEN'])
  assert.match(r.question, /conferma/)
})

test('explicit ID goes straight to the workstream of the item', (t) => {
  const { ws } = setup(t, italianShop(), 'it')
  const r = route(ws, 'riprendi SHOP-API-002')
  assert.equal(r.leaf, 'SHOP-API')
  assert.equal(r.item, 'SHOP-API-002')
  assert.equal(r.status, 'ok')
})

test('explicit qualified ID', (t) => {
  const { ws } = setup(t, italianShop(), 'it')
  const r = route(ws, 'riprendi shop:SHOP-WEB-001')
  assert.equal(r.leaf, 'SHOP-WEB')
  assert.equal(r.item, 'SHOP-WEB-001')
})

test('a bare ID present in two projects is ambiguous, a qualified one is not', (t) => {
  const dup = DOCS.replaceAll('DOC-002', 'SHOP-API-001')
  const { ws } = setup(t, italianShop(), 'it', { 'docs/TODO.md': dup })
  const r = route(ws, 'riprendi SHOP-API-001')
  assert.equal(r.status, 'ambiguous')
  assert.deepEqual(r.candidates.map((c) => c.ref).sort(), ['docs:SHOP-API-001', 'shop:SHOP-API-001'])
  assert.match(r.question, /shop:SHOP-API-001/)
  assert.equal(route(ws, 'riprendi docs:SHOP-API-001').project, 'docs')
  assert.throws(() => resolveId(ws, 'SHOP-API-001'), AmbiguousIdError)
  assert.equal(resolveId(ws, 'shop:SHOP-API-001').project.name, 'shop')
})

test('resolveId returns item and node, and fails for unknown IDs', (t) => {
  const { ws } = setup(t, italianShop(), 'it')
  const r = resolveId(ws, 'SHOP-WEB-002')
  assert.equal(r.item.id, 'SHOP-WEB-002')
  assert.equal(r.node.id, 'SHOP-WEB')
  assert.equal(resolveId(ws, 'DOC-002').project.name, 'docs')
  assert.throws(() => resolveId(ws, 'NOPE-001'), ItemNotFoundError)
})

test('a project named in the request: that project, its index', (t) => {
  const { ws } = setup(t, italianShop(), 'it')
  const r = route(ws, 'docs')
  assert.equal(r.project, 'docs')
  assert.equal(r.status, 'general')
})

test('flat project with Next: reads its TODO.md and points at the next item', (t) => {
  const { ws } = setup(t, italianShop(), 'it')
  const r = route(ws, 'docs')
  assert.ok(paths(r).includes('docs/TODO.md'))
  assert.equal(r.item, 'DOC-002')
  assert.ok(!r.excluded.includes('docs/TODO.md'))
})

test('an alias present in two projects is ambiguous with qualified candidates', (t) => {
  const docs = ['# Docs', '', '- Next: `DOC-MKT-001`', '',
    '| ID | Name | File | Status | Block | Alias |', '|---|---|---|---|---|---|',
    '| `DOC-MKT` | Docs marketing | `todo/marketing.md` | open | - | marketing |', ''].join('\n')
  const { ws } = setup(t, italianShop(), 'it', {
    'docs/TODO.md': docs,
    'docs/todo/marketing.md': '# Marketing\n\n- [ ] [DOC-MKT-001] `[content]` Leaflet\n',
  })
  const r = route(ws, 'marketing')
  assert.equal(r.status, 'ambiguous')
  assert.deepEqual(r.candidates.map((c) => c.ref).sort(), ['docs:DOC-MKT', 'shop:SHOP-MKT'])
  assert.match(r.question, /\?$/)
  assert.equal(route(ws, 'marketing docs').leaf, 'DOC-MKT')
})

test('empty request: overview from the workspace, general of the focus project otherwise', (t) => {
  const { ws } = setup(t, italianShop(), 'it', { 'CLAUDE.md': '# Workspace rules\n' })
  const o = route(ws, '')
  assert.equal(o.status, 'overview')
  assert.deepEqual(paths(o), ['CLAUDE.md'])
  assert.deepEqual(o.candidates.map((c) => c.project).sort(), ['docs', 'shop'])
  const g = route(withFocus(ws, 'shop'), '')
  assert.equal(g.status, 'general')
  assert.equal(g.project, 'shop')
  assert.ok(paths(g).includes('shop/TODO.md'))
})

test('a project whose index is missing routes to it without throwing', (t) => {
  const root = workspace(t, { ...spec(italianShop()), 'ghost/.backlog.json': '{}' }, { config: { workspace: true, language: 'it' } })
  const ws = loadWorkspace(root)
  const r = route(ws, 'ghost')
  assert.equal(r.status, 'missing-file')
  assert.equal(r.missingFiles[0].file, 'ghost/TODO.md')
})

test('english: general, subproject and ambiguity', (t) => {
  const { ws } = setup(t, englishShop(), undefined)
  const g = route(withFocus(ws, 'shop'), 'where are we?')
  assert.equal(g.status, 'general')
  assert.deepEqual(paths(g), ['shop/CLAUDE.md', 'shop/TODO.md', 'shop/todo/api.md'])
  const s = route(ws, 'resume mobile')
  assert.equal(s.leaf, 'MOBILE-UI')
  assert.ok(paths(s).includes('shop/projects/mobile/CLAUDE.md'))
  const a = route(ws, 'work on email')
  assert.equal(a.status, 'ambiguous')
  assert.match(a.question, /\?$/)
  assert.deepEqual(a.candidates.map((c) => c.id).sort(), ['SHOP-OPS', 'SHOP-ORD'])
})

const DOCS_MKT = ['# Docs', '', '- Next: `DOC-MKT-001`', '',
  '| ID | Name | File | Status | Block | Alias |', '|---|---|---|---|---|---|',
  '| `DOC-MKT` | Docs marketing | `todo/marketing.md` | open | - | marketing |', ''].join('\n')

test('fix: naming two projects asks which one, with both as candidates', (t) => {
  const { ws } = setup(t, italianShop(), 'it')
  const r = route(ws, 'shop e docs')
  assert.equal(r.status, 'ambiguous')
  assert.deepEqual(r.candidates.map((c) => c.project).sort(), ['docs', 'shop'])
  assert.ok(r.candidates.every((c) => typeof c.file === 'string'))
})

test('fix: a missing workstream in one project wins over a plain alias hit in another', (t) => {
  const { ws } = setup(t, italianShop(), 'it', {
    'docs/TODO.md': DOCS_MKT,
    'docs/todo/marketing.md': '# Marketing\n\n- [ ] [DOC-MKT-001] `[content]` Leaflet\n',
  })
  const r = route(ws, 'marketing del kiosk')
  assert.equal(r.status, 'missing-workstream')
  assert.equal(r.project, 'shop')
})

test('fix: a named project narrows a duplicated bare ID', (t) => {
  const dup = DOCS.replaceAll('DOC-002', 'SHOP-API-001')
  const { ws } = setup(t, italianShop(), 'it', { 'docs/TODO.md': dup })
  const r = route(ws, 'docs SHOP-API-001')
  assert.equal(r.status, 'ok')
  assert.equal(r.project, 'docs')
})

test('fix: an unknown qualifier falls back to the bare ID', (t) => {
  const { ws } = setup(t, italianShop(), 'it')
  assert.equal(resolveId(ws, 'foo:SHOP-WEB-002').item.id, 'SHOP-WEB-002')
  assert.throws(() => resolveId(ws, 'foo:NOPE-001'), ItemNotFoundError)
  assert.equal(route(ws, 'riprendi foo:SHOP-WEB-001').leaf, 'SHOP-WEB')
})
