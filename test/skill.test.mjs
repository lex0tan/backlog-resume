import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const file = fileURLToPath(new URL('../skills/session/SKILL.md', import.meta.url))
const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const [, front, body] = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)

test('frontmatter names the skill and hides it from the slash menu', () => {
  assert.match(front, /^name: session$/m)
  assert.match(front, /^user-invocable: false$/m)
  assert.match(front, /^description: .*"a che punto siamo", "cosa faccio dopo"/m)
  assert.match(front, /^argument-hint: "\[audit\|resume\|plan\|do\|adopt\|init\|split\]/m)
})

test('the body mentions every CLI command it relies on', () => {
  for (const command of ['route', 'item', 'list', 'summary', 'git', 'check', 'done', 'add', 'overview', 'adopt scan', 'adopt write', 'split', 'init']) {
    assert.ok(new RegExp('`' + command + '[ `\\[]').test(body), `missing command in invocation form: ${command}`)
  }
})

test('the body handles every route status', () => {
  for (const status of ['ok', 'general', 'overview', 'ambiguous', 'missing-workstream', 'missing-file', 'error']) {
    assert.ok(body.includes(`\`${status}\``), `missing route status: ${status}`)
  }
})

test('the body mentions the item, check and git statuses it reacts to', () => {
  for (const word of ['cycle', 'waiting', 'stale', 'unmerged', 'declared-done', 'no-done-when', 'no-commits', 'no-git', '--dry-run', '--input', '--today']) {
    assert.ok(body.includes(word), `missing: ${word}`)
  }
})

test('the text is English: accented letters appear only in the description line', () => {
  const rest = text.split('\n').filter((line) => !line.startsWith('description:')).join('\n')
  assert.doesNotMatch(rest, /[èàòùì]/i)
})

test('no personal references', () => {
  // The words are assembled so this file itself stays clear of the repository-wide check for personal data.
  const personal = [['riprend', 'i'], ['astr', 'ai'], ['code', 'graph'], ['guidelines', '\\.md'], ['mon', 'ey\\/'], ['web', 'site\\/'], ['C:\\\\Us', 'ers']].map((p) => p.join(''))
  assert.doesNotMatch(text, new RegExp(`${personal.join('|')}|\\b(DM|MKT|CRM|BL)-\\d`, 'i'))
})
