import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(`${root}${path}`, 'utf8').replace(/^\uFEFF/, '')
const panel = (code) => JSON.parse(read(`lang/${code}.json`)).panel
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

const SOURCES = ['hooks/register.tsx', 'hooks/pane.tsx', 'hooks/lib/board.ts', 'hooks/lib/state.ts', 'hooks/lib/strings.ts']

/** Panel keys the hooks code asks for: direct `t(strings, 'key')` / `tr('key')` calls and `cond ? 'a' : 'b'` keys inside them. */
function usedKeys() {
  const keys = new Set()
  for (const file of SOURCES) {
    for (const line of read(file).split('\n')) {
      if (!/\btr\(|\bt\(\s*(?:strings|s)\b/.test(line)) continue
      for (const m of line.matchAll(/\b(?:tr\(|t\(\s*(?:strings|s),\s*)'(\w+)'/g)) keys.add(m[1])
      for (const m of line.matchAll(/\?\s*'(\w+)'\s*:\s*'(\w+)'/g)) { keys.add(m[1]); keys.add(m[2]) }
    }
  }
  return keys
}

test('English and Italian panel texts have the same keys and placeholders', () => {
  const en = panel('en')
  const it = panel('it')
  assert.deepEqual(Object.keys(it).sort(), Object.keys(en).sort())
  for (const key of Object.keys(en)) assert.deepEqual(placeholders(it[key]), placeholders(en[key]), key)
})

test('every text the hooks code asks for exists in both languages', () => {
  const used = usedKeys()
  assert.ok(used.size > 40, `only ${used.size} keys found: the scan is broken`)
  for (const code of ['en', 'it']) {
    const have = panel(code)
    assert.deepEqual([...used].filter((k) => !(k in have)), [], code)
  }
})

test('the hooks tests use a fixture equal to the English language file', () => {
  const text = read('hooks/fixtures/panel.ts')
  const block = (name) => {
    const start = text.indexOf('{', text.indexOf(`export const ${name}`))
    return JSON.parse(text.slice(start, text.indexOf('\n}\n', start) + 2))
  }
  assert.deepEqual(block('EN'), panel('en'))
})

test('the hooks source stays in English', () => {
  const files = [...SOURCES, 'hooks/lib/paths.ts', 'hooks/lib/script.ts', 'types/index.d.ts']
  for (const file of files) assert.doesNotMatch(read(file), /(?:progetto|bloccato|fatto quando|item aperti)/i, file)
})
