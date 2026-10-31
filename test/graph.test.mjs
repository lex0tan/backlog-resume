import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildGraph } from '../scripts/lib/graph.mjs'

const it = (id, o = {}) => ({ id, open: true, deps: [], blocks: [], project: 'shop', ...o })

test('depends on and the mirrored blocks make one edge, no duplicates', () => {
  const g = buildGraph([it('A', { deps: ['B'] }), it('B', { blocks: ['A'] })])
  assert.deepEqual(g.blockedBy('A'), ['B'])
  assert.deepEqual(g.unblocks('B'), ['A'])
  assert.deepEqual(g.cycles, [])
  assert.equal(g.inCycle('A'), null)
})

test('two-item cycle', () => {
  const g = buildGraph([it('A', { deps: ['B'] }), it('B', { deps: ['A'] })])
  assert.deepEqual(g.cycles, [['A', 'B', 'A']])
  assert.deepEqual(g.inCycle('A'), ['A', 'B', 'A'])
  assert.deepEqual(g.inCycle('B'), ['A', 'B', 'A'])
})

test('cross-project cycle renders qualified ids where the project differs', () => {
  const g = buildGraph([
    it('API-001', { deps: ['docs:DOC-001'] }),
    it('DOC-001', { project: 'docs', deps: ['shop:WEB-002'] }),
    it('WEB-002', { deps: ['API-001'] }),
  ])
  assert.deepEqual(g.cycles, [['API-001', 'docs:DOC-001', 'WEB-002', 'API-001']])
  assert.deepEqual(g.blockedBy('API-001'), ['docs:DOC-001'])
  assert.deepEqual(g.blockedBy('docs:DOC-001'), ['shop:WEB-002'])
})

test('a closed item in the middle breaks the cycle', () => {
  const g = buildGraph([it('A', { deps: ['B'] }), it('B', { open: false, deps: ['A'] })])
  assert.deepEqual(g.cycles, [])
  assert.deepEqual(g.blockedBy('A'), [])
})

test('self loop', () => {
  assert.deepEqual(buildGraph([it('A', { deps: ['A'] })]).cycles, [['A', 'A']])
})

test('bare refs resolve uniquely across projects; ambiguous and missing are reported', () => {
  const g = buildGraph([
    it('A', { deps: ['X', 'D', 'NOPE'] }),
    it('X', { project: 'docs' }),
    it('D', { project: 'docs' }), it('D', { project: 'mobile' }),
  ])
  assert.deepEqual(g.blockedBy('A'), ['docs:X'])
  assert.deepEqual(g.unresolved, [
    { from: 'shop:A', ref: 'D', reason: 'ambiguous' },
    { from: 'shop:A', ref: 'NOPE', reason: 'missing' },
  ])
})
