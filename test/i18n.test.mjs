import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadKeywords, keywordRegexes } from '../scripts/lib/i18n.mjs'
import { LanguageNotFoundError } from '../scripts/lib/errors.mjs'

test('italian keywords match the legacy format', () => {
  const kw = loadKeywords('it')
  assert.equal(kw.next, 'Prossima attività')
  assert.equal(kw.dependsOn, 'Dipende da')
  assert.equal(kw.columns.name, 'Nome')
  assert.equal(kw.types.blocked, 'bloccato')
  assert.deepEqual(kw.markers, [
    { start: '<!-- riprendi:inizio -->', end: '<!-- riprendi:fine -->' },
    { start: '<!-- backlog:start -->', end: '<!-- backlog:end -->' },
  ])
})

test('overrides: shallow, deep for columns/types, markers replace', () => {
  assert.equal(loadKeywords('en', { next: 'Up next' }).next, 'Up next')
  const kw = loadKeywords('en', { columns: { name: 'Title' }, markers: [{ start: 'a', end: 'b' }] })
  assert.equal(kw.columns.name, 'Title')
  assert.equal(kw.columns.id, 'ID')
  assert.deepEqual(kw.markers, [{ start: 'a', end: 'b' }])
})

test('unknown language throws LanguageNotFoundError', () => {
  assert.throws(() => loadKeywords('xx'), LanguageNotFoundError)
})

test('keywordRegexes captures the next ID with optional backticks', () => {
  const re = keywordRegexes(loadKeywords('it'))
  assert.equal(re.next.exec('Prossima attività: `SHOP-API-006`')[1], 'SHOP-API-006')
  assert.equal(re.next.exec('Prossima attività: SHOP-001')[1], 'SHOP-001')
  assert.ok(re.subprojects.test('I sottoprogetti'))
  const segs = [...'Dipende da: A-001. Blocca: B-002.'.matchAll(re.linkSegment)].map((m) => m[1])
  assert.deepEqual(segs, ['Dipende da', 'Blocca'])
})

test('en and it have the same keys in every section', () => {
  const read = (l) => JSON.parse(readFileSync(new URL(`../lang/${l}.json`, import.meta.url), 'utf8'))
  const en = read('en')
  const it = read('it')
  for (const section of ['keywords', 'messages', 'panel']) {
    assert.deepEqual(Object.keys(en[section]).sort(), Object.keys(it[section]).sort(), section)
  }
  assert.deepEqual(Object.keys(en.keywords.columns).sort(), Object.keys(it.keywords.columns).sort())
  assert.deepEqual(Object.keys(en.keywords.types).sort(), Object.keys(it.keywords.types).sort())
})
