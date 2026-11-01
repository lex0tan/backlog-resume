import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { workspace } from './helpers/fixture.mjs'

const cli = fileURLToPath(new URL('../scripts/backlog.mjs', import.meta.url))
const N = 8

/** Runs the CLI in a separate process; all the processes of one test start together. */
const run = (cwd, args) => new Promise((resolve) => {
  const child = spawn(process.execPath, [cli, ...args], { cwd })
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  child.on('close', (code) => resolve({ code, json: JSON.parse(out) }))
})

const shop = (n) => ({
  'TODO.md': ['# Shop', '', '- Next: `SHOP-001`', '',
    ...Array.from({ length: n }, (_, i) => `- [ ] [SHOP-${String(i + 1).padStart(3, '0')}] \`[code]\` Item ${i + 1}\n  Done when: item ${i + 1} works`), ''].join('\n'),
})

test('done: sessions closing different items of the same file all take effect', async (t) => {
  const root = workspace(t, shop(N))
  const ids = Array.from({ length: N }, (_, i) => `SHOP-${String(i + 1).padStart(3, '0')}`)
  const results = await Promise.all(ids.map((id) => run(root, ['done', id])))
  assert.ok(results.every((r) => r.code === 0 && r.json.status === 'done'), JSON.stringify(results.map((r) => r.json)))
  const text = readFileSync(join(root, 'TODO.md'), 'utf8')
  for (const id of ids) assert.ok(!text.includes(`[${id}]`), `${id} was lost to a concurrent write`)
  assert.ok(!text.includes('Done when'), 'no sub-line of a closed item is left behind')
})

test('add: sessions adding at the same time never get the same ID', async (t) => {
  const root = workspace(t, shop(1))
  const results = await Promise.all(Array.from({ length: N }, (_, i) => run(root, ['add', 'shop', 'code', `New ${i}`])))
  const ids = results.map((r) => r.json.id)
  assert.equal(new Set(ids).size, N, `duplicated IDs: ${ids}`)
  const text = readFileSync(join(root, 'TODO.md'), 'utf8')
  for (const id of ids) assert.ok(text.includes(`[${id}]`), `${id} was lost to a concurrent write`)
})

test('a lock left by a dead process is taken over, and no temporary file remains', async (t) => {
  const root = workspace(t, shop(2))
  const lock = join(root, 'TODO.md.lock')
  writeFileSync(lock, '')
  const old = new Date(Date.now() - 120_000)
  utimesSync(lock, old, old)
  const r = await run(root, ['done', 'SHOP-001'])
  assert.equal(r.json.status, 'done')
  assert.ok(!existsSync(lock), 'the lock is released')
  assert.deepEqual(readdirSync(root).filter((f) => f.endsWith('.tmp') || f.endsWith('.lock')), [])
})

// The window between reading a file and writing it back is a few milliseconds, too narrow to hit on purpose with processes:
// holding the lock by hand shows what matters, that a writer waits for it and goes on once it is released.
test('a writer waits while another session holds the lock, then goes on', async (t) => {
  const root = workspace(t, shop(2))
  const lock = join(root, 'TODO.md.lock')
  writeFileSync(lock, '')
  let finished = false
  const pending = run(root, ['done', 'SHOP-001']).then((r) => { finished = true; return r })
  await new Promise((resolve) => setTimeout(resolve, 600))
  assert.equal(finished, false, 'the writer did not wait for the lock')
  assert.ok(readFileSync(join(root, 'TODO.md'), 'utf8').includes('[SHOP-001]'), 'nothing was written under the lock')
  unlinkSync(lock)
  const r = await pending
  assert.equal(r.json.status, 'done')
  assert.ok(!readFileSync(join(root, 'TODO.md'), 'utf8').includes('[SHOP-001]'))
})
