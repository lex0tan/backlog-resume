import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { check } from '../scripts/lib/commands/check.mjs'
import { list } from '../scripts/lib/commands/list.mjs'
import { overview } from '../scripts/lib/commands/overview.mjs'
import { summary } from '../scripts/lib/commands/summary.mjs'
import { loadWorkspace } from '../scripts/lib/workspace.mjs'

const demo = fileURLToPath(new URL('../examples/demo/', import.meta.url))
const ws = () => loadWorkspace(demo)
const itemsOf = (listed) => listed.projects.flatMap((p) => p.workstreams.flatMap((w) => w.items))

test('demo: every level of the model is listed (index with workstreams, subproject, flat project)', () => {
  const listed = list(ws(), '2026-11-01')
  assert.deepEqual(listed.projects.map((p) => p.rel).sort(), ['docs', 'shop'])
  const ids = itemsOf(listed).map((i) => i.id).sort()
  assert.deepEqual(ids, ['API-001', 'API-002', 'GUIDE-001', 'GUIDE-002', 'MOBILE-001', 'MOBILE-002', 'WEB-001', 'WEB-002'])
})

test('demo: the user step, the decision and the From date show up as the README says', () => {
  const items = itemsOf(list(ws(), '2026-11-01'))
  const byId = (id) => items.find((i) => i.id === id)
  assert.equal(byId('WEB-001').parts.length, 3)
  assert.ok(byId('WEB-001').parts.some((p) => p.user))
  assert.equal(byId('WEB-002').type, 'decision')
  assert.equal(byId('WEB-002').waiting, true)
  assert.equal(byId('GUIDE-002').when.state, 'later')
  assert.deepEqual(byId('API-002').blockedBy, ['API-001'])
})

test('demo: summary has no cycle and check finds no error or warning', () => {
  const w = ws()
  assert.ok(summary(w, '2026-11-01').projects.every((p) => p.cycles === 0), 'no dependency cycle')
  const result = check(w, { fast: true })
  assert.equal(result.status, 'ok')
  assert.deepEqual(result.issues.filter((i) => i.level === 'error' || i.level === 'warn'), [])
})

test('demo: the overview block is current', () => {
  assert.equal(overview(ws()).status, 'current')
})
