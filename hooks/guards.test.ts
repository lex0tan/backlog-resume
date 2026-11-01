import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { EN } from './fixtures/panel'

type OnT = Parameters<TestBody>[1]

const FILES = {
  status: 'ok', root: 'C:/ws', language: 'en',
  projects: [
    { rel: 'shop', root: 'C:/ws/shop', files: ['C:/ws/shop/TODO.md', 'C:/ws/shop/todo/api.md', 'C:/ws/shop/todo/web.md'], indexes: ['C:/ws/shop/TODO.md'] },
    { rel: 'docs', root: 'C:/ws/docs', files: ['C:/ws/docs/TODO.md'], indexes: [] },
  ],
}
const DUPLICATE = { level: 'error', code: 'duplicate-id', project: 'shop', file: 'shop/todo/web.md', message: 'API-002 is used twice' }
const OLD = { level: 'warn', code: 'missing-criterion', project: 'shop', file: 'shop/todo/api.md', message: 'API-002 has no Done when' }
const ACTIVE = {
  id: 'API-002', project: 'shop', file: 'C:/ws/shop/todo/api.md', text: 'text', language: 'en', startedAt: 0, dirtyAtStart: [],
  sessionId: 'A', cwd: 'C:\\ws', heartbeatAt: Date.now(),
}

// `entries` seeds the store (an active item or none); `after` is what the check finds once the edit is made.
function setup(on: OnT, { active = true, after = [OLD, DUPLICATE], heads = ['h1', 'h2'], message = 'fix the thing' } = {}) {
  const store = new Map<string, unknown>(active ? [['active:A', ACTIVE]] : [])
  const seen = { runs: [] as string[][], toasts: [] as string[], edited: 0, checks: 0 }
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('session.id', () => ({ value: 'A' }))
  on('session.cwd', () => ({ value: 'C:\\ws' }))
  on('fs.read', (_, e) => {
    if (/lang[\\/]\w+\.json$/.test(e.path)) return { value: JSON.stringify({ panel: EN }) }
    throw new Error(`ENOENT ${e.path}`)
  })
  let head = 0
  on('process.run', (_, e) => {
    seen.runs.push([...e.argv])
    let out = ''
    if (e.argv[0] === 'git') out = e.argv.includes('rev-parse') ? heads[Math.min(head++, heads.length - 1)]! : message
    else if (e.argv[4] === 'files') out = JSON.stringify(FILES)
    else if (e.argv[4] === 'check') out = JSON.stringify({ status: 'ok', issues: seen.edited ? after : [OLD] })
    if (e.argv[4] === 'check') seen.checks++
    return { value: { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false, stdout: out } }
  })
  on('ui.toast', (_, e) => { seen.toasts.push(e.text); return { value: undefined } })
  on('tool.call', () => { seen.edited++; return { result: 'ok' } as never })
  return seen
}

const call = ($: Parameters<TestBody>[0], tool: string, input: Record<string, unknown>) => $.tool.call({ tool, ...input } as never) as Promise<{ deny?: string; context?: string[] }>

test('with an active item only its file and its indexes stay open, whatever the spelling of the path', async ($, on) => {
  setup(on)
  const sibling = await call($, 'Read', { file_path: 'C:/ws/shop/todo/web.md' })
  expect(sibling.deny).toContain('`shop/todo/api.md`')
  expect(sibling.deny).toContain('`shop/TODO.md`')
  expect(sibling.deny).toContain('shop:API-002')
  expect((await call($, 'Read', { file_path: 'C:/ws/shop/todo/api.md' })).deny).toBeUndefined()
  expect((await call($, 'Read', { file_path: 'C:/ws/shop/TODO.md' })).deny).toBeUndefined()
  expect((await call($, 'Read', { file_path: 'C:/ws/docs/TODO.md' })).deny).toContain('docs/TODO.md')
  expect((await call($, 'Read', { file_path: 'C:/ws/src/index.ts' })).deny).toBeUndefined()
  expect((await call($, 'Read', { file_path: 'C:\\WS\\SHOP\\TODO\\WEB.MD' })).deny).toContain('shop:API-002')
  expect((await call($, 'Grep', { pattern: 'x', path: 'C:/ws/shop/todo/web.md' })).deny).toContain('shop:API-002')
})

test('without an active item every backlog can be read', async ($, on) => {
  setup(on, { active: false })
  expect((await call($, 'Read', { file_path: 'C:/ws/shop/todo/web.md' })).deny).toBeUndefined()
})

test('an edit that introduces an issue gets it back as context, never a refusal; old issues are not repeated', async ($, on) => {
  const seen = setup(on)
  const r = await call($, 'Edit', { file_path: 'C:\\ws\\shop\\todo\\web.md', old_string: 'a', new_string: 'b' })
  expect(r.deny).toBeUndefined()
  expect(r.context?.length).toBe(1)
  expect(r.context![0]).toContain('duplicate-id')
  expect(r.context![0]).not.toContain('missing-criterion')
  expect(seen.toasts).toEqual(['Backlog check: 1 new after editing shop/todo/web.md'])
  expect(seen.runs.filter(a => a[4] === 'check').every(a => a.join(' ').endsWith('--project shop --fast'))).toBe(true)
})

test('an edit of a file that is not a backlog runs no check', async ($, on) => {
  const seen = setup(on)
  const r = await call($, 'Write', { file_path: 'C:/ws/src/index.ts', content: 'x' })
  expect(r.context).toBeUndefined()
  expect(seen.checks).toBe(0)
})

test('an edit that adds no new issue says nothing', async ($, on) => {
  const seen = setup(on, { after: [OLD] })
  const r = await call($, 'Edit', { file_path: 'C:/ws/shop/todo/web.md', old_string: 'a', new_string: 'b' })
  expect(r.context).toBeUndefined()
  expect(seen.toasts).toEqual([])
})

test('a commit that does not cite the active item gets a reminder', async ($, on) => {
  const seen = setup(on)
  const r = await call($, 'Bash', { command: 'git commit -m "fix the thing"' })
  expect(r.deny).toBeUndefined()
  expect(r.context![0]).toContain('does not cite shop:API-002')
  expect(seen.toasts).toEqual(['Commit without shop:API-002'])
})

test('a commit that cites the active item stays quiet', async ($, on) => {
  const seen = setup(on, { message: 'fix: web endpoint (API-002)' })
  const r = await call($, 'Bash', { command: 'git add . && git commit -m "x"' })
  expect(r.context).toBeUndefined()
  expect(seen.toasts).toEqual([])
})

test('a command that is not a commit, or a commit that changed nothing, says nothing', async ($, on) => {
  const seen = setup(on, { heads: ['h1', 'h1'] })
  expect((await call($, 'Bash', { command: 'git status' })).context).toBeUndefined()
  expect(seen.runs.some(a => a[0] === 'git')).toBe(false)
  expect((await call($, 'Bash', { command: 'git commit -m "nothing to commit"' })).context).toBeUndefined()
})
