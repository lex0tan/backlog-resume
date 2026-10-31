import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { check } from '../scripts/lib/commands/check.mjs'
import { overview, overviewBlock } from '../scripts/lib/commands/overview.mjs'
import { loadWorkspace } from '../scripts/lib/workspace.mjs'
import { englishShop, italianShop, workspace } from './helpers/fixture.mjs'

const BOM = String.fromCharCode(0xfeff)
const CASES = [
  { name: 'Italian with the historic markers', shop: italianShop, language: 'it', start: '<!-- riprendi:inizio -->', end: '<!-- riprendi:fine -->', sub: '(sottoprogetto)', mobile: 'App mobile', ui: 'Interfaccia' },
  { name: 'Italian with the English markers', shop: italianShop, language: 'it', start: '<!-- backlog:start -->', end: '<!-- backlog:end -->', sub: '(sottoprogetto)', mobile: 'App mobile', ui: 'Interfaccia' },
  { name: 'English', shop: englishShop, language: 'en', start: '<!-- backlog:start -->', end: '<!-- backlog:end -->', sub: '(subproject)', mobile: 'Mobile app', ui: 'Interface' },
]

for (const c of CASES) {
  test(`overview (${c.name}): missing, stale, written, current, no markers`, (t) => {
    const root = workspace(t, c.shop(), { config: { language: c.language, overview: 'OVERVIEW.md' } })
    const path = join(root, 'OVERVIEW.md')
    const w = () => loadWorkspace(root)

    assert.equal(overview(w()).status, 'missing')

    const before = `${BOM}# Map\r\n\r\nMine, above.\r\n${c.start}`
    const after = `${c.end}\r\n\r\nMine, below.\r\n`
    writeFileSync(path, `${before}\r\nold block\r\n${after}`)
    const stale = overview(w())
    assert.equal(stale.status, 'stale')
    assert.equal(readFileSync(path, 'utf8'), `${before}\r\nold block\r\n${after}`, 'no write without write=true')

    const written = overview(w(), true)
    assert.equal(written.status, 'written')
    const text = readFileSync(path, 'utf8')
    assert.ok(text.startsWith(before), 'text above and the BOM are untouched')
    assert.ok(text.endsWith(`\r\n${after}`), 'text below is untouched')
    assert.doesNotMatch(text.replace(/\r\n/g, ''), /[\r\n]/, 'CRLF throughout')
    assert.ok(text.includes(`- \`TODO.md\` — ${root.split(/[\\/]/).pop()}`))
    assert.ok(text.includes('  - `SHOP-API` Backend API → `todo/api.md`'))
    assert.ok(text.includes(`  - \`MOBILE\` ${c.mobile} ${c.sub} → \`projects/mobile/TODO.md\``))
    assert.ok(text.includes(`    - \`MOBILE-UI\` ${c.ui} → \`projects/mobile/todo/ui.md\``))
    assert.ok(text.includes('  - `SHOP-MKT` Marketing → `todo/marketing/index.md`'))
    assert.ok(text.includes('    - `SHOP-MKT-SEO` SEO → `todo/marketing/seo.md`'))
    assert.equal(overview(w()).status, 'current')

    writeFileSync(path, '# no markers\n')
    assert.equal(overview(w(), true).status, 'no-markers')
    assert.equal(readFileSync(path, 'utf8'), '# no markers\n')
  })
}

test('overview is off without configuration, and check flags a stale overview', (t) => {
  const root = workspace(t, englishShop())
  assert.deepEqual(overview(loadWorkspace(root)), { status: 'off' })

  const configured = workspace(t, englishShop(), { config: { overview: 'OVERVIEW.md' } })
  writeFileSync(join(configured, 'OVERVIEW.md'), '<!-- backlog:start -->\nold\n<!-- backlog:end -->\n')
  const r = check(loadWorkspace(configured), { fast: true })
  const issue = r.issues.find((i) => i.code === 'overview-stale')
  assert.equal(issue.level, 'warn')
  assert.equal(issue.file, 'OVERVIEW.md')
  overview(loadWorkspace(configured), true)
  assert.ok(!check(loadWorkspace(configured), { fast: true }).issues.some((i) => i.code.startsWith('overview-')))
})

test('overview paths are relative to the overview file', (t) => {
  const root = workspace(t, { ...englishShop(), 'notes/OVERVIEW.md': '<!-- backlog:start -->\n<!-- backlog:end -->\n' }, { config: { overview: 'notes/OVERVIEW.md' } })
  const w = loadWorkspace(root)
  const block = overviewBlock(w, join(root, 'notes', 'OVERVIEW.md'))
  assert.ok(block.includes('`../TODO.md`'))
  assert.ok(block.includes('`../projects/kiosk/todo/screen.md`'))
})
