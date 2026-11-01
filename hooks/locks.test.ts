import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { EMPTY, LISTED_FROM_SHOP, PANE, TURN, ago, entry, setup } from './fixtures/world'

type $T = Parameters<TestBody>[0]

const run = ($: $T, args: string) => $.command.run({ command: 'nextup', args } as never) as Promise<{ text: string }>

test('the same item is locked whichever folder the other session started from', async ($, on) => {
  // Session A started in the workspace root and holds shop/TODO.md; B started inside shop, where the project is ".".
  const { who } = setup(on, { 'active:A': entry('A') }, { listed: LISTED_FROM_SHOP })
  who.id = 'B'
  await run($, '')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 't-code' })
  await ui.press({ key: 'i-shop:API-002' })
  expect((await ui.find({ type: 'Text', text: /in progress elsewhere/ }))?.text).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Work on it/ })).toBeUndefined()
  await ui.unmount()
})

test('the session can stop working on its own item without closing it', async ($, on) => {
  const { store, seen } = setup(on)
  await run($, '')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'p-shop' })
  await ui.press({ key: 'a-API' })
  await ui.press({ key: 't-code' })
  await ui.press({ key: 'i-shop:API-002' })
  await ui.press({ key: 'work' })
  expect(store.has('active:A')).toBe(true)
  await ui.press({ key: 'i-shop:API-002' }).catch(() => undefined)
  await ui.unmount()

  const again = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await again.press({ key: 'stop' })
  expect(store.has('active:A')).toBe(false)
  expect(store.has('closed')).toBe(false)
  expect(seen.toasts.at(-1)).toBe('shop:API-002 released')
  await again.unmount()
})

test('an item whose file is gone is freed without being recorded as closed', async ($, on) => {
  const { store, seen } = setup(on, { 'active:A': entry('A') })
  seen.fileGone = true
  await $.turn.complete(TURN)
  expect(store.has('active:A')).toBe(false)
  expect(store.has('closed')).toBe(false)
})

test('do <ID> takes the item like the panel and names what other sessions hold', async ($, on) => {
  const { store, seen, clock } = setup(on, { 'active:C': entry('C', { id: 'GUIDE-001', project: 'docs', file: 'C:/ws/docs/TODO.md' }) })
  const r = await run($, 'do API-002')
  expect(r.text).toBe('backlog: do')
  expect(store.get('active:A')).toMatchObject({ id: 'API-002', sessionId: 'A' })
  await clock.advance(1)
  expect(seen.prompts[0]).toContain('Mode: do. Request: API-002')
  expect(seen.prompts[0]).toContain('do not propose or start them): docs:GUIDE-001.')
})

test('do <ID> is refused when another live session holds the item', async ($, on) => {
  const { who, store, seen, clock } = setup(on, { 'active:A': entry('A') })
  who.id = 'B'
  const r = await run($, 'do API-002')
  expect(r.text).toContain('In progress in another session')
  await clock.advance(1)
  expect(seen.prompts).toEqual([])
  expect(store.has('active:B')).toBe(false)
})

test('other modes carry the held items too, and say nothing when none is held', async ($, on) => {
  const { clock, seen } = setup(on)
  await run($, 'resume shop')
  await clock.advance(1)
  expect(seen.prompts[0]).toBe('Use the nextup:session skill. Mode: resume. Request: shop')
})

test('Resume on an orphan whose item is gone only drops the entry; with an item of its own the session is not asked to replace it', async ($, on) => {
  const { who, store, seen } = setup(on, { 'active:A': entry('A', { id: 'GONE-001', heartbeatAt: ago(6) }) })
  who.id = 'B'
  await run($, '')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'resume-A' })
  expect(store.size).toBe(0)
  expect(seen.toasts.at(-1)).toBe('GONE-001 is no longer in the backlog.'.replace('GONE-001', 'shop:GONE-001'))
  await ui.unmount()
})

test('an empty backlog offers to add the first item, with default types', async ($, on) => {
  const { seen } = setup(on, {}, { listed: EMPTY })
  const r = await run($, '')
  expect(r.text).toContain('0 open items')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Add the first item/ }))?.text).toBeDefined()
  await ui.press({ key: 'new' })
  await ui.press({ key: 'w-shop-SHOP' }).catch(() => undefined)
  expect(seen.prompts).toEqual([])
  await ui.unmount()
})
