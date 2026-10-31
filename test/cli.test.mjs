import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { main } from '../scripts/lib/cli.mjs'
import { englishShop, flat, workspace } from './helpers/fixture.mjs'

const cli = fileURLToPath(new URL('../scripts/backlog.mjs', import.meta.url))

function run(cwd, args, options = {}) {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', ...options })
  let json = null
  try { json = JSON.parse(r.stdout) } catch { /* usage errors print no JSON */ }
  return { code: r.status, json, stderr: r.stderr, stdout: r.stdout }
}

test('list: exit 0 and JSON with projects', (t) => {
  const root = workspace(t, flat())
  const r = run(root, ['list'])
  assert.equal(r.code, 0)
  assert.ok(Array.isArray(r.json.projects))
})

test('item: unknown ID answers not-found with exit 0', (t) => {
  const root = workspace(t, flat())
  const r = run(root, ['item', 'NOPE-001'])
  assert.equal(r.code, 0)
  assert.equal(r.json.status, 'not-found')
})

test('unknown command: exit 2 and usage on stderr', (t) => {
  const root = workspace(t, flat())
  const r = run(root, ['frobnicate'])
  assert.equal(r.code, 2)
  assert.match(r.stderr, /Usage:/)
})

test('invalid .backlog.json: exit 1 with ConfigError', (t) => {
  const root = workspace(t, { ...flat(), '.backlog.json': '{ nope' })
  const r = run(root, ['list'])
  assert.equal(r.code, 1)
  assert.equal(r.json.status, 'error')
  assert.equal(r.json.code, 'ConfigError')
})

test('--cwd works with spaces in the path', (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'backlog-cli-'))
  t.after(() => rmSync(parent, { recursive: true, force: true }))
  const dir = join(parent, 'My Projects')
  mkdirSync(dir)
  writeFileSync(join(dir, 'TODO.md'), flat()['TODO.md'])
  const r = run(parent, ['item', 'SHOP-002', '--cwd', dir])
  assert.equal(r.code, 0)
  assert.equal(r.json.id, 'SHOP-002')
  const direct = run(dir, ['list'])
  assert.equal(direct.code, 0)
})

test('add then done round-trip through the CLI', (t) => {
  const root = workspace(t, flat())
  const added = run(root, ['add', 'shop', 'code', 'Write', 'the', 'docs'])
  assert.equal(added.code, 0, added.stdout)
  assert.equal(added.json.status, 'added')
  assert.match(readFileSync(join(root, 'TODO.md'), 'utf8'), new RegExp(`\\[${added.json.id}\\].*Write the docs`))
  const closed = run(root, ['done', added.json.id])
  assert.equal(closed.code, 0)
  assert.equal(closed.json.status, 'done')
  assert.ok(!readFileSync(join(root, 'TODO.md'), 'utf8').includes(added.json.id))
})

test('add resolves a workstream ID in an indexed workspace', (t) => {
  const root = workspace(t, englishShop())
  const r = run(root, ['add', 'SHOP-MKT-ADS', 'content', 'New ad copy'])
  assert.equal(r.code, 0, r.stdout)
  assert.match(r.json.id, /^SHOP-MKT-ADS-\d{3}$/)
})

test('check --fast with an empty PATH: no error, no stale-item, exit 0', (t) => {
  const root = workspace(t, flat())
  const r = run(root, ['check', '--fast', '--today', '2030-01-01'], { env: { PATH: '' } })
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.notEqual(r.json.status, 'error')
  assert.ok(!r.json.issues.some((i) => i.code === 'stale-item'))
})

test('--input with invalid JSON: exit 1 with a structured error', (t) => {
  const root = workspace(t, flat())
  writeFileSync(join(root, 'plan.json'), '{ broken')
  const r = run(root, ['split', 'shop', '--input', 'plan.json'])
  assert.equal(r.code, 1)
  assert.equal(r.json.code, 'InvalidJsonError')
  assert.equal(r.json.file, 'plan.json')
})

test('missing --input is a usage error', (t) => {
  const root = workspace(t, flat())
  assert.equal(run(root, ['split', 'shop']).code, 2)
  assert.equal(run(root, ['adopt', 'write']).code, 2)
})

test('git, files, summary, check, overview and init run through the CLI', (t) => {
  const root = workspace(t, flat(), { git: true })
  for (const args of [['git'], ['files'], ['summary'], ['check'], ['overview'], ['route', 'product list'], ['adopt', 'scan']]) {
    const r = run(root, args)
    assert.equal(r.code, 0, `${args.join(' ')}: ${r.stdout}${r.stderr}`)
  }
  const fresh = workspace(t, {})
  const r = run(fresh, ['init', '--prefix', 'APP'])
  assert.equal(r.code, 0)
  assert.equal(r.json.status, 'created')
})

test('main: an unexpected exception becomes an InternalError', () => {
  let out = ''
  const code = main(['list'], { cwd: 'Z:\\definitely\\missing\\\0bad', stdout: { write: (s) => { out += s } }, stderr: { write() {} } })
  assert.equal(code, 1)
  assert.ok(['InternalError', 'ConfigError'].includes(JSON.parse(out).code))
})

test('git with a project name answers for that project only', (t) => {
  const root = workspace(t, flat(), { git: true })
  const all = run(root, ['git'])
  const name = run(root, ['list']).json.projects[0].name
  const one = run(root, ['git', name])
  assert.equal(one.code, 0, one.stdout)
  assert.equal(one.json.projects.length, 1)
  assert.equal(all.json.projects.length, 1)
})
