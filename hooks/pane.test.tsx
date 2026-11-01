import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { EN, MARKED } from './fixtures/panel'

type $T = Parameters<TestBody>[0]
type OnT = Parameters<TestBody>[1]

const item = (project: string, id: string, type: string, extra: Record<string, unknown> = {}) =>
  ({ id, project, type, workstream: id.split('-')[0], text: `text ${id}`, doneWhen: null, parts: [], unmerged: [], when: null, blockedBy: [], unblocks: [], cycle: null, waiting: false, steps: [], stale: null, ...extra })
const listed = (language: string) => ({
  status: 'ok',
  language,
  workspace: 'ws',
  focus: null,
  typeOrder: ['code', 'content'],
  settings: { lockMinutes: 5, staleDays: 30 },
  projects: [
    { rel: 'shop', name: 'shop', next: null, due: [], workstreams: [
      { id: 'API', label: 'Backend API', file: 'shop/TODO.md', area: { id: 'API', name: 'Backend API', subproject: false }, items: [item('shop', 'API-002', 'code', { unblocks: ['docs:GUIDE-001'] })] },
    ] },
    { rel: 'docs', name: 'docs', next: null, due: [], workstreams: [
      { id: 'GUIDE', label: 'Guides', file: 'docs/TODO.md', area: { id: 'GUIDE', name: 'Guides', subproject: false }, items: [item('docs', 'GUIDE-001', 'content', { blockedBy: ['shop:API-002'] })] },
    ] },
  ],
})
const GIT = { status: 'ok', projects: [{ project: 'shop', status: 'clean', branch: 'main', commit: { hash: 'abc123' }, dirty: [] }, { project: 'docs', status: 'no-git', branch: null, commit: null, dirty: [] }] }

const PANE = {
  plugin: 'backlog',
  component: 'Pane',
  requestId: 'backlog',
  props: { title: 'Backlog', isFocused: true, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 22 }, view: {} },
} as const

function stubs(on: OnT, language = 'en') {
  const seen = { prompts: [] as string[], opened: [] as string[], runs: [] as string[][], toasts: [] as string[], panes: [] as { id: string }[] }
  mock.store(on)
  on('session.id', () => ({ value: 'S1' }))
  on('ui.status', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'backlog' } }))
  on('session.cwd', () => ({ value: 'C:\\Users\\x\\My Projects\\ws' }))
  on('fs.read', (_, e) => {
    const code = /lang[\\/](\w+)\.json$/.exec(e.path)?.[1]
    if (!code) throw new Error(`ENOENT ${e.path}`)
    return { value: JSON.stringify({ panel: code === 'it' ? MARKED : EN }) }
  })
  on('process.run', (_, e) => {
    seen.runs.push([...e.argv])
    const cmd = e.argv[4]
    const out = cmd === 'list' ? listed(language) : cmd === 'git' ? GIT : cmd === 'done' ? { status: 'done', id: 'API-002', next: null } : { status: 'added', id: 'API-009' }
    return { value: { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false, stdout: JSON.stringify(out) } }
  })
  on('ui.panes', () => ({ value: seen.panes }))
  on('ui.open', (_, e) => { seen.opened.push(e.id); seen.panes.push({ id: e.id }); return { value: { isPlaced: true as const } } })
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', (_, e) => { seen.toasts.push(e.text); return { value: undefined } })
  on('prompt.submit', (_, e) => { seen.prompts.push(e.text); return { text: e.text } })
  return seen
}

const open = ($: $T, args = '') => $.command.run({ command: 'backlog', args } as never)
const SURFACES = ['terminal', 'desktop'] as const

test('/backlog opens the pane, which lists both projects on every surface', async ($, on) => {
  const seen = stubs(on)
  const result = await open($)
  expect(result.text).toContain('2 open items')
  expect(seen.opened).toEqual(['backlog'])
  expect(seen.prompts.length).toBe(0)
  // The script runs from the plugin folder, in the session's folder, with the Windows path as one argument.
  expect(seen.runs[0]!.slice(0, 1)).toEqual(['node'])
  expect(seen.runs[0]![1]).toMatch(/\/scripts\/backlog\.mjs$/)
  expect(seen.runs[0]!.slice(2)).toEqual(['--cwd', 'C:\\Users\\x\\My Projects\\ws', 'list'])

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Button', text: /^shop · 1/ }))?.text).toContain('main · abc123 · clean')
    expect((await ui.find({ type: 'Button', text: /^docs · 1 \(1 blocked\)/ }))?.text).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /Today/ }))?.text).toContain('Today')
    await ui.unmount()
  }
})

test('project -> area -> type -> item -> Work on it sends only that item, qualified by project', async ($, on) => {
  const seen = stubs(on)
  await open($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'p-shop' })
  await ui.press({ key: 'a-API' })
  await ui.press({ key: 't-code' })
  await ui.press({ key: 'i-shop:API-002' })
  expect((await ui.find({ type: 'Text', text: /Unblocks docs:GUIDE-001/ }))?.text).toBeDefined()
  await ui.press({ key: 'work' })
  expect(seen.prompts.length).toBe(1)
  expect(seen.prompts[0]).toContain('shop:API-002 [code]')
  expect(seen.prompts[0]).toContain('Do not read other backlogs')
  await ui.unmount()
})

test('a qualified blocker shows its text; Done asks first, then runs done with the qualified ref', async ($, on) => {
  const seen = stubs(on)
  await open($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'p-docs' })
  await ui.press({ key: 'a-GUIDE' })
  await ui.press({ key: 't-content' })
  await ui.press({ key: 'i-docs:GUIDE-001' })
  expect((await ui.find({ type: 'Text', text: /Blocked by shop:API-002 \(text API-002\)/ }))?.text).toBeDefined()
  await ui.press({ key: 'done' })
  expect(seen.runs.some(r => r[4] === 'done')).toBe(false)
  await ui.press({ key: 'yes' })
  expect(seen.runs.find(r => r[4] === 'done')?.slice(2)).toEqual(['--cwd', 'C:\\Users\\x\\My Projects\\ws', 'done', 'docs:GUIDE-001'])
  expect(seen.toasts.at(-1)).toBe('GUIDE-001 removed')
  await ui.unmount()
})

test('a mode as first argument runs the session skill and opens no pane', async ($, on) => {
  const seen = stubs(on)
  const clock = mock.clock(on)
  const result = await open($, 'plan shop')
  expect(seen.opened).toEqual([])
  // The submit goes out after the command hook has returned.
  expect(seen.prompts).toEqual([])
  await clock.advance(1)
  expect(seen.prompts).toEqual(['Use the backlog:session skill. Mode: plan. Request: shop'])
  expect(result.text).toContain('plan')
  // Anything else is a filter of the pane.
  await open($, 'planning')
  await clock.advance(1)
  expect(seen.prompts.length).toBe(1)
  expect(seen.opened).toEqual(['backlog'])
})

test('a filter naming one project starts inside it', async ($, on) => {
  stubs(on)
  await open($, 'docs')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Button', text: /content/ }))?.text).toContain('[content] 1')
  // Not the project list: the shop project is out of the filter.
  expect(await ui.find({ type: 'Button', text: /shop/ })).toBeUndefined()
  await ui.unmount()
})

test('the language of the script picks the texts of the pane', async ($, on) => {
  stubs(on, 'it')
  await open($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /it:Today/ }))?.text).toContain('it:Today')
  expect((await ui.find({ type: 'Button', text: /it:Unblock first/ }))?.text).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /it:2 open items/ }))?.text).toBeDefined()
  await ui.unmount()
})

test('a pane the plugin does not own goes to the engine', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({ ...PANE, requestId: 'other', surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})
