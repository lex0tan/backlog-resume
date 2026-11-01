// A simulated world for the session and guard tests: a store shared by sessions, a workspace and the answers of the script.
// `claude plugin test` has no `$.store` or `$.session.id` on the test `$`, so tests drive the hooks and read this store.

import { mock } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { EN } from './panel'

export type OnT = Parameters<TestBody>[1]

export const MIN = 60_000
/** One POSIX-style root: a drive-letter path is only absolute on Windows, and the host resolves it against the working folder elsewhere. */
export const ROOT = '/ws'
export const CWD = '/ws'
export const FILE = `${ROOT}/shop/TODO.md`

export const item = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, project: 'shop', type: 'code', workstream: 'API', text: `text ${id}`, doneWhen: null, parts: [], unmerged: [], when: null, blockedBy: [], unblocks: [], cycle: null, waiting: false, steps: [], stale: null, ...extra })

export const LISTED = {
  status: 'ok', language: 'en', root: ROOT, workspace: 'ws', focus: null, typeOrder: ['code'], settings: { lockMinutes: 5, staleDays: 30 },
  projects: [
    { rel: 'shop', name: 'shop', next: null, due: [], workstreams: [
      { id: 'API', label: 'Backend API', file: 'shop/TODO.md', area: { id: 'API', name: 'Backend API', subproject: false }, items: [item('API-002'), item('API-003', { waiting: true, steps: ['pick a plan'] })] },
    ] },
    { rel: 'docs', name: 'docs', next: null, due: [], workstreams: [
      { id: 'GUIDE', label: 'Guides', file: 'docs/TODO.md', area: { id: 'GUIDE', name: 'Guides', subproject: false }, items: [{ ...item('GUIDE-001'), project: 'docs', workstream: 'GUIDE' }] },
    ] },
  ],
}

/** The same shop seen from a session that started inside it: the project is `.` and the root is the shop folder. */
export const LISTED_FROM_SHOP = {
  ...LISTED, root: `${ROOT}/shop`,
  projects: [
    { rel: '.', name: 'shop', next: null, due: [], workstreams: [
      { id: 'API', label: 'Backend API', file: 'TODO.md', area: { id: 'API', name: 'Backend API', subproject: false }, items: [{ ...item('API-002'), project: '.' }] },
    ] },
  ],
}

export const EMPTY = {
  ...LISTED,
  projects: [{ rel: 'shop', name: 'shop', next: null, due: [], workstreams: [{ id: 'SHOP', label: 'shop', file: 'shop/TODO.md', area: { id: 'SHOP', name: 'shop', subproject: false }, items: [] }] }],
}

export const GIT = { status: 'ok', projects: [{ project: 'shop', status: 'clean', branch: 'main', commit: { hash: 'abc123' }, dirty: [{ path: 'shop/a.ts' }, { path: 'shop/b.ts' }] }] }

export const PANE = {
  plugin: 'backlog', component: 'Pane', requestId: 'backlog',
  props: { title: 'Backlog', isFocused: true, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 22 }, view: {} },
} as const

export const TURN = { answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'end_turn' } as never

export const entry = (sessionId: string, extra: Record<string, unknown> = {}) => ({
  id: 'API-002', project: 'shop', file: `${ROOT}/shop/TODO.md`, text: 'text API-002', language: 'en', startedAt: Date.now() - 20 * MIN, dirtyAtStart: [],
  sessionId, cwd: CWD, heartbeatAt: Date.now(), ...extra,
})
export const ago = (min: number) => Date.now() - min * MIN

/** Two simulated sessions share the store; `who.id` says which one the next call comes from. */
export function setup(on: OnT, entries: Record<string, unknown> = {}, { listed = LISTED as object } = {}) {
  const who = { id: 'A' }
  const store = new Map<string, unknown>(Object.entries(entries))
  const seen = {
    logs: [] as string[], prompts: [] as string[], toasts: [] as string[], statuses: [] as (string | undefined)[], panes: [] as { id: string }[],
    file: '- [ ] [API-002] `[code]` text API-002\n', fileGone: false,
  }
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => { store.set(e.key, JSON.parse(JSON.stringify(e.value))); return { value: undefined } })
  on('store.delete', (_, e) => { store.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('session.id', () => ({ value: who.id }))
  on('session.cwd', () => ({ value: CWD }))
  on('command.register', () => ({ value: { command: 'backlog' } }))
  on('fs.read', (_, e) => {
    if (/lang[\\/]\w+\.json$/.test(e.path)) return { value: JSON.stringify({ panel: EN }) }
    if (e.path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '') === FILE) {
      if (seen.fileGone) throw new Error(`ENOENT: no such file or directory, open '${e.path}'`)
      return { value: seen.file }
    }
    throw new Error(`ENOENT ${e.path}`)
  })
  on('fs.exists', () => ({ value: !seen.fileGone }))
  on('process.run', (_, e) => {
    const out = e.argv[4] === 'list' ? listed : GIT
    return { value: { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false, stdout: JSON.stringify(out) } }
  })
  on('ui.panes', () => ({ value: seen.panes }))
  on('ui.open', (_, e) => { seen.panes.push({ id: e.id }); return { value: { isPlaced: true as const } } })
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', (_, e) => { seen.toasts.push(e.text); return { value: undefined } })
  on('ui.log', (_, e) => { seen.logs.push(e.text); return { value: undefined } })
  on('ui.status', (_, e) => { seen.statuses.push(e.text); return { value: undefined } })
  on('prompt.submit', (_, e) => { seen.prompts.push(e.text); return { text: e.text } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  return { who, seen, store, clock: mock.clock(on) }
}
