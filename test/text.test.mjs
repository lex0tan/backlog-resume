import { test } from 'node:test'
import assert from 'node:assert/strict'
import { eolOf, splitLines, bomOf, joinLines, posix, norm } from '../scripts/lib/text.mjs'

test('eolOf detects CRLF and defaults to LF', () => {
  assert.equal(eolOf('a\r\nb'), '\r\n')
  assert.equal(eolOf('a\nb'), '\n')
  assert.equal(eolOf('abc'), '\n')
})

test('splitLines strips the BOM and accepts both line endings', () => {
  assert.deepEqual(splitLines('\uFEFFa\r\nb'), ['a', 'b'])
  assert.deepEqual(splitLines('a\nb\n'), ['a', 'b', ''])
})

test('bomOf reports the BOM', () => {
  assert.equal(bomOf('\uFEFFx'), '\uFEFF')
  assert.equal(bomOf('x'), '')
})

test('joinLines restores eol and BOM', () => {
  assert.equal(joinLines(['a', 'b'], '\r\n', '\uFEFF'), '\uFEFFa\r\nb')
  const t = '\uFEFFa\r\nb\r\n'
  assert.equal(joinLines(splitLines(t), eolOf(t), bomOf(t)), t)
})

test('posix converts backslashes', () => {
  assert.equal(posix('a\\b\\c.md'), 'a/b/c.md')
})

test('norm lowercases, strips accents and non-alphanumerics', () => {
  assert.equal(norm('Già Fatto!'), ' gia fatto ')
})
