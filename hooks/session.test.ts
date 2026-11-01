import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { FILE, PANE, TURN, ago, entry, setup } from './fixtures/world'

type $T = Parameters<TestBody>[0]

const open = ($: $T) => $.command.run({ command: 'backlog', args: '' } as never)

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
  expect(store.get('active:A')).toMatchObject({ id: 'API-002', project: 'shop', file: FILE, sessionId: 'A', cwd: 'C:\\ws' })
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
  await $.session.start({ cwd: 'C:\\ws', surface: 'terminal', isInteractive: true })
  expect(seen.toasts).toEqual(['In progress: shop:API-002. Run /backlog:session to resume or close it.'])
  await open($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Left unfinished/ })).toBeUndefined()
  expect(store.get('active:A')).toMatchObject({ sessionId: 'A' })
  await ui.unmount()
})

test('the heartbeat of a started session keeps its entry fresh', async ($, on) => {
  const { store, clock } = setup(on, { 'active:A': entry('A', { heartbeatAt: ago(3) }) })
  await $.session.start({ cwd: 'C:\\ws', surface: 'terminal', isInteractive: true })
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
  expect(seen.statuses.at(-1)).toBe('✓ API-002 done · 7 min · ⚠ 1 uncommitted')
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
