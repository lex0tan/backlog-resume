import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadKeywords } from '../scripts/lib/i18n.mjs'
import { DEFAULTS } from '../scripts/lib/config.mjs'
import { IndexNotFoundError } from '../scripts/lib/errors.mjs'
import { allItems, ancestors, isAncestor, leaves, loadTree, nodeForId, projectPrefix, subprojectOf } from '../scripts/lib/tree.mjs'
import { englishShop, flat, italianShop, workspace } from './helpers/fixture.mjs'

const en = loadKeywords('en')
const it = loadKeywords('it')
const byId = (tree, id) => tree.nodes.find((n) => n.id === id)
const withAlias = (tree, alias) => tree.nodes.filter((n) => n.aliases.includes(alias)).map((n) => n.id)

function checkShopTree(tree) {
  assert.deepEqual(tree.nodes.map((n) => n.id), [
    'SHOP-API', 'SHOP-WEB', 'SHOP-MKT', 'SHOP-MKT-SEO', 'SHOP-MKT-ADS', 'SHOP-ORD', 'SHOP-OPS', 'SHOP-GHOST',
    'MOBILE', 'MOBILE-UI', 'MOBILE-PUSH', 'MOBILE-MKT', 'KIOSK', 'KIOSK-SCREEN'])
  assert.equal(tree.top.next, 'SHOP-API-001')
  assert.deepEqual(tree.nodes.filter((n) => n.container).map((n) => n.id), ['SHOP-MKT', 'MOBILE', 'KIOSK'])
  assert.deepEqual(tree.nodes.filter((n) => n.subproject).map((n) => n.id), ['MOBILE', 'MOBILE-UI', 'MOBILE-PUSH', 'MOBILE-MKT', 'KIOSK', 'KIOSK-SCREEN'])
  assert.equal(byId(tree, 'SHOP-MKT').next, 'SHOP-MKT-ADS-001')
  assert.equal(byId(tree, 'MOBILE').next, 'MOBILE-UI-001')
  assert.equal(byId(tree, 'KIOSK').next, null)
  assert.equal(byId(tree, 'SHOP-MKT-SEO').file, 'todo/marketing/seo.md')
  assert.equal(byId(tree, 'MOBILE-UI').file, 'projects/mobile/todo/ui.md')
  assert.equal(byId(tree, 'KIOSK-SCREEN').file, 'projects/kiosk/todo/screen.md')
  assert.equal(byId(tree, 'SHOP-MKT-SEO').parent, byId(tree, 'SHOP-MKT'))
  assert.equal(byId(tree, 'SHOP-GHOST').exists, false)
  assert.equal(byId(tree, 'SHOP-API').exists, true)
  assert.ok(byId(tree, 'SHOP-API').aliases.includes('api'))
  assert.ok(byId(tree, 'MOBILE').aliases.includes('mobile'))
  // Ambiguous alias shared by two general workstreams; "marketing" shared by the general and the subproject one.
  assert.deepEqual(withAlias(tree, 'email'), ['SHOP-ORD', 'SHOP-OPS'])
  assert.deepEqual(withAlias(tree, 'marketing'), ['SHOP-MKT', 'MOBILE-MKT'])
  // A second subproject with a single leaf and no Next.
  assert.deepEqual(byId(tree, 'KIOSK').children.map((n) => n.id), ['KIOSK-SCREEN'])
}

test('loadTree reads ids, containers, subprojects and Next on the Italian shop', (t) => {
  const tree = loadTree(workspace(t, italianShop()), it, DEFAULTS)
  checkShopTree(tree)
  assert.equal(tree.top.container, true)
})

test('loadTree gives the same tree on the English shop', (t) => {
  checkShopTree(loadTree(workspace(t, englishShop()), en, DEFAULTS))
})

test('the shop fixtures are structurally identical in both languages', (t) => {
  const shape = (spec, kw) => {
    const root = workspace(t, spec)
    const tree = loadTree(root, kw, DEFAULTS)
    return { paths: Object.keys(spec), nodes: tree.nodes.map((n) => [n.id, n.file, n.exists, n.subproject, n.aliases.join()]), items: allItems(root, tree, kw).map((i) => [i.id, i.node, Object.entries(kw.types).find(([, v]) => v === i.type)?.[0] ?? i.type, i.deps, i.blocks]) }
  }
  assert.deepEqual(shape(italianShop(), it), shape(englishShop(), en))
})

test('an item can cite an existing and a missing file', (t) => {
  const root = workspace(t, englishShop())
  const text = readFileSync(join(root, 'todo/marketing/seo.md'), 'utf8')
  assert.match(text, /notes\/exists\.md/)
  assert.match(text, /notes\/missing\.md/)
  assert.equal(readFileSync(join(root, 'notes/exists.md'), 'utf8'), '# Exists\n')
  assert.throws(() => readFileSync(join(root, 'notes/missing.md')))
})

test('a flat TODO.md is a single workstream named after the most frequent prefix', (t) => {
  const root = workspace(t, flat())
  const tree = loadTree(root, en, DEFAULTS)
  const list = leaves(tree)
  assert.equal(list.length, 1)
  assert.equal(list[0].id, 'SHOP')
  assert.equal(list[0].file, 'TODO.md')
  assert.equal(tree.top.next, 'SHOP-002')
  const items = allItems(root, tree, en)
  assert.deepEqual(items.map((i) => i.id), ['SHOP-001', 'SHOP-002', 'SHOP-003', 'SHOP-004'])
  assert.ok(items.every((i) => i.file === 'TODO.md' && i.node === 'SHOP'))
})

test('leaves are the detail nodes of an indexed tree and allItems skips missing files', (t) => {
  const root = workspace(t, englishShop())
  const tree = loadTree(root, en, DEFAULTS)
  assert.deepEqual(leaves(tree).map((n) => n.id), ['SHOP-API', 'SHOP-WEB', 'SHOP-MKT-SEO', 'SHOP-MKT-ADS', 'SHOP-ORD', 'SHOP-OPS', 'SHOP-GHOST', 'MOBILE-UI', 'MOBILE-PUSH', 'MOBILE-MKT', 'KIOSK-SCREEN'])
  const items = allItems(root, tree, en)
  assert.equal(items.length, 14)
  const api2 = items.find((i) => i.id === 'SHOP-API-002')
  assert.deepEqual([api2.file, api2.node, api2.deps], ['todo/api.md', 'SHOP-API', ['SHOP-MKT-ADS-001']])
})

test('a missing index file throws IndexNotFoundError with the path', (t) => {
  const root = workspace(t, { 'README.md': 'x' })
  assert.throws(() => loadTree(root, en, DEFAULTS), (err) => err instanceof IndexNotFoundError && err.context.path.endsWith('TODO.md'))
})

test('a configured index file name is used as the root', (t) => {
  const root = workspace(t, { 'BACKLOG.md': flat()['TODO.md'] })
  const tree = loadTree(root, en, { ...DEFAULTS, index: 'BACKLOG.md' })
  assert.equal(leaves(tree)[0].file, 'BACKLOG.md')
})

test('an index that lists a missing file gives an exists:false node, no exception', (t) => {
  const tree = loadTree(workspace(t, englishShop()), en, DEFAULTS)
  assert.equal(byId(tree, 'SHOP-GHOST').exists, false)
  assert.equal(byId(tree, 'SHOP-GHOST').container, false)
})

test('a directory listed as a file does not count as existing', (t) => {
  const root = workspace(t, englishShop())
  mkdirSync(join(root, 'todo/ghost.md'))
  assert.equal(byId(loadTree(root, en, DEFAULTS), 'SHOP-GHOST').exists, false)
})

const table = (id, file) => `| ID | Name | File |\n|---|---|---|\n| \`${id}\` | ${id} | \`${file}\` |\n`

test('two indexes that list each other do not loop forever', (t) => {
  const root = workspace(t, { 'TODO.md': table('A', 'a.md'), 'a.md': table('B', 'TODO.md') })
  assert.deepEqual(loadTree(root, en, DEFAULTS).nodes.map((n) => n.id), ['A', 'B'])
})

test('an index named with a ./ prefix is the same file when listed back', (t) => {
  const root = workspace(t, { 'TODO.md': table('A', 'a.md'), 'a.md': table('B', './TODO.md') })
  assert.deepEqual(loadTree(root, en, { ...DEFAULTS, index: './TODO.md' }).nodes.map((n) => n.id), ['A', 'B'])
})

test('distinct files are never merged by spelling alone', (t) => {
  // Two real files whose names differ only by case (possible on case-sensitive file systems) are two nodes;
  // on case-insensitive ones they are the same file, visited once. Either way: no loop, no exception.
  const root = workspace(t, { 'TODO.md': table('A', 'a.md') + '| `B` | B | `A.md` |\n', 'a.md': '# A\n' })
  const ids = loadTree(root, en, DEFAULTS).nodes.map((n) => n.id)
  assert.deepEqual(ids, ['A', 'B'])
})

test('tree navigation helpers: ancestors, isAncestor, subprojectOf, nodeForId', (t) => {
  const tree = loadTree(workspace(t, englishShop()), en, DEFAULTS)
  const seo = byId(tree, 'SHOP-MKT-SEO')
  const ui = byId(tree, 'MOBILE-UI')
  assert.deepEqual(ancestors(seo).map((n) => n.id), ['SHOP-MKT', 'ROOT'])
  assert.equal(isAncestor(byId(tree, 'SHOP-MKT'), seo), true)
  assert.equal(isAncestor(seo, byId(tree, 'SHOP-MKT')), false)
  assert.equal(subprojectOf(ui).id, 'MOBILE')
  assert.equal(subprojectOf(byId(tree, 'MOBILE')).id, 'MOBILE')
  assert.equal(subprojectOf(byId(tree, 'KIOSK-SCREEN')).id, 'KIOSK')
  assert.equal(subprojectOf(seo), null)
  assert.equal(nodeForId(tree, 'SHOP-MKT-SEO-001').id, 'SHOP-MKT-SEO')
  assert.equal(nodeForId(tree, 'SHOP-MKT-001').id, 'SHOP-MKT')
  assert.equal(nodeForId(tree, 'MOBILE-UI-001').id, 'MOBILE-UI')
})

test('projectPrefix: config, most frequent id prefix, then the folder name', (t) => {
  const tree = loadTree(workspace(t, flat()), en, DEFAULTS)
  const items = [{ id: 'AB-001', file: 'TODO.md' }, { id: 'XY-001', file: 'TODO.md' }, { id: 'XY-002', file: 'TODO.md' }, { id: 'ZZ-001', file: 'other.md' }, { id: null, file: 'TODO.md' }]
  assert.equal(projectPrefix(tree, items, { ...DEFAULTS, prefix: 'CFG' }, 'my-app'), 'CFG')
  assert.equal(projectPrefix(tree, items, DEFAULTS, 'my-app'), 'XY')
  assert.equal(projectPrefix(tree, [], DEFAULTS, 'my-app'), 'MYAP')
  assert.equal(projectPrefix(tree, [], DEFAULTS, 'x'), 'X')
})

test('a flat TODO.md without ids falls back to the folder name', (t) => {
  const root = workspace(t, { 'TODO.md': '# Notes\n' })
  const [only] = leaves(loadTree(root, en, DEFAULTS))
  assert.match(only.id, /^[A-Z0-9]{1,4}$/)
})
