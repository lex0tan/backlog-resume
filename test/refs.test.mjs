import { test } from 'node:test'
import assert from 'node:assert/strict'
import { missingRefs } from '../scripts/lib/refs.mjs'
import { loadWorkspace } from '../scripts/lib/workspace.mjs'
import { englishShop, workspace } from './helpers/fixture.mjs'

function setup(t) {
  const files = {}
  for (const [path, text] of Object.entries(englishShop())) files[`shop/${path}`] = text
  files['shop/src/app.js'] = 'export {}\n'
  files['docs/TODO.md'] = '# Docs\n\n- [ ] [DOC-001] `[code]` Guide\n'
  const root = workspace(t, files, { config: { workspace: true } })
  const ws = loadWorkspace(root)
  return { ws, shop: ws.projects.find((p) => p.name === 'shop') }
}

test('a path qualified by the project folder resolves from a nested file', (t) => {
  const { ws, shop } = setup(t)
  assert.deepEqual(missingRefs(shop, ws, 'todo/api.md', 'see `shop/src/app.js`, `src/app.js` and `notes/exists.md`'), [])
})

test('a path that does not exist is reported once', (t) => {
  const { ws, shop } = setup(t)
  assert.deepEqual(missingRefs(shop, ws, 'todo/api.md', '`src/missing.py` again `src/missing.py`'), ['src/missing.py'])
})

test('URLs, routes, placeholders and secret files are ignored', (t) => {
  const { ws, shop } = setup(t)
  const text = '`https://x.io/a.md` `/api/x` `<id>.md` `.env` `~/notes.md` `{a}.md` `GET` `plain`'
  assert.deepEqual(missingRefs(shop, ws, 'TODO.md', text), [])
})

test('fix: folders between the project and the workspace root are searched', (t) => {
  const root = workspace(t, {
    'grp/app/TODO.md': '# App\n\n- [ ] [APP-001] `[code]` Thing\n',
    'grp/shared.md': '# Shared\n',
  }, { config: { workspace: true } })
  const ws = loadWorkspace(root)
  const app = ws.projects.find((p) => p.name === 'app')
  assert.deepEqual(missingRefs(app, ws, 'TODO.md', '`shared.md` `grp/shared.md`'), [])
})
