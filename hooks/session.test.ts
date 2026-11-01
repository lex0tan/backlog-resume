import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { CWD, FILE, MIN, PANE, TURN, ago, entry, setup } from './fixtures/world'

// The colour of the innermost Text drawing exactly this text (find matches the outer Texts that contain it too).
const colorOf = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string; props: Record<string, unknown> }[]> }, text: string) =>
  (await ui.findAll({ type: 'Text' })).filter(f => f.text === text).at(-1)?.props.color

const HINT = { plugin: 'nextup', component: 'PromptHint', props: { hint: '? for shortcuts', isDraft: false, isWorking: false } } as const

type $T = Parameters<TestBody>[0]

const open = ($: $T) => $.command.run({ command: 'nextup', args: '' } as never)

test('an item one session takes is in progress elsewhere for another, which cannot work on it', async ($, on) => {
  const { who, seen, store } = setup(on)
  await open($)
  const a = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await a.press({ key: 'p-shop' })
  await a.press({ key: 'a-API' })
  await a.press({ key: 't-code' })
  await a.press({ key: 'i-shop:API-002' })
  await a.press({ key: 'work' })
  expect(seen.prompts.length).toBe(1)
  expect(store.get('active:A')).toMatchObject({ id: 'API-002', project: 'shop', file: FILE, sessionId: 'A', cwd: CWD })
  await a.unmount()

  who.id = 'B'
  const b = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await b.find({ type: 'Text', text: /in progress elsewhere/ }))?.text).toBeDefined()
  expect(await b.find({ type: 'Button', text: /Work on it/ })).toBeUndefined()
  expect(store.has('active:B')).toBe(false)
  await b.unmount()
})

test('a silent heartbeat turns the entry into an orphan, proposed and never taken by itself', async ($, on) => {
  const { who, seen, store } = setup(on, { 'active:A': entry('A', { heartbeatAt: ago(6) }) })
  who.id = 'B'
  await open($)
  const b = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await b.find({ type: 'Text', text: /Left unfinished: shop:API-002/ }))?.text).toBeDefined()
  expect((await b.find({ type: 'Button', text: /^Resume/ }))?.text).toBeDefined()
  expect((await b.find({ type: 'Button', text: /^Release/ }))?.text).toBeDefined()
  // Proposed, not taken: B holds nothing until it presses Resume.
  expect(store.has('active:B')).toBe(false)
  await b.press({ key: 'resume-A' })
  expect(store.get('active:B')).toMatchObject({ id: 'API-002', sessionId: 'B' })
  expect(store.has('active:A')).toBe(false)
  expect(seen.prompts[0]).toContain('shop:API-002')
  await b.unmount()
})

test('a beating session is not an orphan, and a silent one outside this workspace is not proposed', async ($, on) => {
  const { who } = setup(on, {
    'active:A': entry('A', { heartbeatAt: ago(4) }),
    'active:C': entry('C', { id: 'GUIDE-001', project: 'docs', heartbeatAt: ago(30), cwd: 'D:\\elsewhere' }),
  })
  who.id = 'B'
  await open($)
  const b = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await b.find({ type: 'Text', text: /Left unfinished/ })).toBeUndefined()
  await b.press({ key: 'p-shop' })
  await b.press({ key: 'a-API' })
  await b.press({ key: 't-code' })
  expect((await b.find({ type: 'Button', text: /🔒.*API-002/ }))?.text).toBeDefined()
  await b.unmount()
})

test('Release deletes the orphan entry without taking the item', async ($, on) => {
  const { who, store } = setup(on, { 'active:A': entry('A', { heartbeatAt: ago(6) }) })
  who.id = 'B'
  await open($)
  const b = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await b.press({ key: 'release-A' })
  expect(store.size).toBe(0)
  await b.unmount()
})

test('a session resumed under the same ID finds its own item, however old', async ($, on) => {
  const { seen, store } = setup(on, { 'active:A': entry('A', { heartbeatAt: ago(60) }) })
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  expect(seen.toasts).toEqual(['In progress: shop:API-002. Run /nextup:session to resume or close it.'])
  await open($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Left unfinished/ })).toBeUndefined()
  expect(store.get('active:A')).toMatchObject({ sessionId: 'A' })
  await ui.unmount()
})

test('the heartbeat of a started session keeps its entry fresh', async ($, on) => {
  const { store, clock } = setup(on, { 'active:A': entry('A', { heartbeatAt: ago(3) }) })
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  await clock.advance(60_000)
  expect((store.get('active:A') as { heartbeatAt: number }).heartbeatAt).toBeGreaterThan(ago(1))
})

test('at the end of a turn an item the model removed from its file is freed and recorded as closed', async ($, on) => {
  const { seen, store } = setup(on, { 'active:A': entry('A', { startedAt: ago(7), dirtyAtStart: ['shop/a.ts'] }) })
  // Still in the file: stays active.
  await $.turn.complete(TURN)
  expect(store.has('active:A')).toBe(true)
  expect(seen.toasts).toEqual([])
  // Removed: freed, recorded, reported with the files changed since the start (b.ts only).
  seen.file = '- [ ] [API-009] `[code]` other\n'
  await $.turn.complete(TURN)
  expect(store.has('active:A')).toBe(false)
  const closed = store.get('closed') as { id: string; minutes: number }[]
  expect(closed.map(c => c.id)).toEqual(['API-002'])
  expect(closed[0]!.minutes).toBe(7)
  expect(seen.toasts.at(-1)).toBe('✓ API-002 done · 7 min · ⚠ 1 uncommitted')
  const ui = await $.ui.mount({ ...HINT, surface: 'terminal' })
  expect(await colorOf(ui, '✓ API-002 done')).toBe('success')
  expect(await colorOf(ui, '⚠ 1 uncommitted')).toBe('warning')
  await ui.unmount()
})

test('the status line sits beside the prompt hint in colour, the bar following the parts as the model ticks them', async ($, on) => {
  const { seen } = setup(on, { 'active:A': entry('A', { startedAt: ago(3) }) })
  seen.file = '- [ ] [API-002] `[code]` text API-002\n  - [x] one\n  - [ ] two\n  - [ ] three\n  - [ ] four\n'
  on('tool.call', () => ({ result: 'ok' }) as never)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...HINT, surface: 'terminal' })
  expect(await colorOf(ui, '▶ API-002')).toBe('warning')
  expect(await colorOf(ui, '██')).toBe('success')
  expect((await ui.find({ type: 'Text', text: ' 1/4' }))?.text).toBeDefined()
  // An edit in the middle of the turn moves the bar, without waiting for the turn to end.
  seen.file = seen.file.replace('[ ] two', '[x] two')
  await $.tool.call({ tool: 'Edit', file_path: FILE, old_string: '[ ] two', new_string: '[x] two' } as never)
  expect(await colorOf(ui, '████')).toBe('success')
  expect((await ui.find({ type: 'Text', text: ' 2/4' }))?.text).toBeDefined()
  // The terminal draws it, so no plain status line on top.
  expect(seen.statuses.filter(Boolean)).toEqual([])
  await ui.unmount()
})

test('a surface without the prompt hint gets the plain status line', async ($, on) => {
  const { seen } = setup(on, { 'active:A': entry('A', { startedAt: ago(3) }) }, { surfaces: ['terminal', 'mobile'] })
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  expect(seen.statuses.at(-1)).toBe('▶ API-002 · 3 min')
})

test('without an item in progress or a done line the prompt hint is the engine own', async ($, on) => {
  setup(on)
  const ui = await $.ui.mount({ ...HINT, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /nextup/ })).toBeUndefined()
  await ui.unmount()
})

test('an item waiting on the user leaves the lists of work and shows its step in the waiting view', async ($, on) => {
  setup(on)
  await open($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Claude can do · 2/ }))?.text).toBeDefined()
  expect((await ui.find({ type: 'Button', text: /^shop · 1/ }))?.text).toBeDefined()
  expect((await ui.find({ type: 'Button', text: /Waiting on you · 1/ }))?.text).toBeDefined()
  await ui.press({ key: 'waiting' })
  expect((await ui.find({ type: 'Button', text: /API-003.*pick a plan/ }))?.text).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /API-002/ })).toBeUndefined()
  await ui.unmount()
})

test('at the start of a session, entries of other sessions older than a month are pruned and the rest is kept', async ($, on) => {
  const day = 24 * 60 * MIN
  const { store } = setup(on, {
    'active:A': entry('A', { heartbeatAt: ago(60) }),
    'active:old': entry('old', { heartbeatAt: ago(40 * 24 * 60) }),
    'active:recent': entry('recent', { heartbeatAt: ago(2 * 24 * 60) }),
    'finished:old': { id: 'X-1', minutes: 3, pending: 0, at: Date.now() - 40 * day },
    'finished:recent': { id: 'X-2', minutes: 3, pending: 0, at: Date.now() - day },
    'finished:undated': { id: 'X-3', minutes: 3, pending: 0 },
    closed: [],
  })
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  expect([...store.keys()].sort()).toEqual(['active:A', 'active:recent', 'closed', 'finished:recent'])
})
