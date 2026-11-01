import { expect, test } from 'claude-code/testing'

import { EN, MARKED } from './fixtures/panel'
import { agenda, areas, bar, collect, duration, finishedSegments, finishedText, findRef, groups, indexesOf, newlyDirty, partsOf, projects, promptFor, refOf, search, startView, statusSegments, statusText, stillOpen, unblockers, whenMark } from './lib/board'
import type { Listed } from './lib/board'
import { normPath, relativeTo, sameFile } from './lib/paths'
import { t } from './lib/strings'

const S = EN

const entry = (project: string, id: string, type: string, extra: Record<string, unknown> = {}) =>
  ({ id, project, type, text: `text ${id}`, ...extra })
// shop: API-001 (code), API-002 (decision, unblocks docs:GUIDE-001), WEB-001 (code, blocked by API-001); docs: GUIDE-001 blocked by shop:API-002.
const LISTED: Listed = {
  status: 'ok',
  typeOrder: ['code', 'decision', 'content'],
  projects: [
    {
      rel: 'shop', name: 'shop', workstreams: [
        { id: 'API', label: 'Backend API', file: 'shop/TODO.md', area: { id: 'API', name: 'Backend API' }, items: [
          entry('shop', 'API-001', 'code', { unblocks: ['WEB-001'] }),
          entry('shop', 'API-002', 'decision', { unblocks: ['docs:GUIDE-001'] }),
        ] },
        { id: 'WEB', label: 'Storefront', file: 'shop/web.md', area: { id: 'WEB', name: 'Storefront' }, items: [
          entry('shop', 'WEB-001', 'code', { blockedBy: ['API-001'] }),
        ] },
      ],
    },
    {
      rel: 'docs', name: 'docs', workstreams: [
        { id: 'GUIDE', label: 'Guides', file: 'docs/TODO.md', area: { id: 'GUIDE', name: 'Guides' }, items: [
          entry('docs', 'GUIDE-001', 'content', { blockedBy: ['shop:API-002'] }),
        ] },
      ],
    },
  ],
}

test('collect filters by project, workstream or area, ignoring case and accents', () => {
  expect(collect(LISTED, '').length).toBe(4)
  expect(collect(LISTED, 'docs').map(i => i.id)).toEqual(['GUIDE-001'])
  expect(collect(LISTED, 'STOREFRONT')[0]?.file).toBe('shop/web.md')
  expect(collect(LISTED, 'shop').map(i => i.id)).toEqual(['API-001', 'API-002', 'WEB-001'])
})

test('collect finds a single item by bare or qualified ID', () => {
  expect(collect(LISTED, 'WEB-001').map(i => i.id)).toEqual(['WEB-001'])
  expect(collect(LISTED, 'api-002').map(i => i.id)).toEqual(['API-002'])
  expect(collect(LISTED, 'shop:API-002').map(i => i.id)).toEqual(['API-002'])
  expect(collect(LISTED, 'docs:API-002')).toEqual([])
  expect(collect(LISTED, 'API-009')).toEqual([])
})

test('collect fills defaults and carries project, cycle, waiting, steps, stale and lockedBy', () => {
  const [one] = collect(LISTED, 'WEB-001')
  expect(one).toMatchObject({ project: 'shop', projectName: 'shop', cycle: null, waiting: false, steps: [], stale: null, lockedBy: null, parts: [], unmerged: [], when: null })
})

test('dates: due first (overdue oldest first), later last, with the right mark', () => {
  const dated = (id: string, state: 'later' | 'due' | 'overdue' | null, days = 0) =>
    entry('shop', id, 'code', { when: state ? { from: '2026-10-11', days, state } : null })
  const listed: Listed = { status: 'ok', projects: [{ rel: 'shop', name: 'shop', workstreams: [{ id: 'API', label: 'API', file: 'TODO.md', area: { id: 'API', name: 'API' },
    items: [dated('API-001', 'later', -3), dated('API-002', null), dated('API-003', 'due'), dated('API-004', 'overdue', 5)] }] }] }
  const all = collect(listed, '')
  expect(all.map(i => i.id)).toEqual(['API-004', 'API-003', 'API-002', 'API-001'])
  expect(agenda(all).today.map(i => i.id)).toEqual(['API-004', 'API-003'])
  expect(agenda(all).tomorrow).toEqual([])
  const tomorrow = collect({ ...listed, projects: [{ ...listed.projects![0]!, workstreams: [{ ...listed.projects![0]!.workstreams[0]!, items: [dated('API-005', 'later', -1)] }] }] }, '')
  expect(agenda(tomorrow).tomorrow.map(i => i.id)).toEqual(['API-005'])
  expect(all.map(i => whenMark(i, S))).toEqual(['⚠️ overdue by 5 d · ', '⏰ ', '', '🕒 from 2026-10-11 · '])
})

test('areas groups items by project; projects, groups and startView', () => {
  const all = collect(LISTED, '')
  expect(projects(all)).toEqual([{ id: 'shop', name: 'shop', count: 3, blocked: 1 }, { id: 'docs', name: 'docs', count: 1, blocked: 1 }])
  expect(areas(all)).toEqual([
    { project: 'shop', id: 'API', name: 'Backend API', count: 2, blocked: 0 },
    { project: 'shop', id: 'WEB', name: 'Storefront', count: 1, blocked: 1 },
    { project: 'docs', id: 'GUIDE', name: 'Guides', count: 1, blocked: 1 },
  ])
  // Types follow the typeOrder of the script, the rest come last.
  expect(groups(all, ['content', 'decision', 'code']).map(g => g.type)).toEqual(['content', 'decision', 'code'])
  expect(groups(all, LISTED.typeOrder).map(g => g.type)).toEqual(['code', 'decision', 'content'])
  expect(groups(all, ['decision']).map(g => g.type)).toEqual(['decision', 'code', 'content'])
  expect(startView(all, true)).toEqual({ mode: 'projects' })
  expect(startView(collect(LISTED, 'docs'), true)).toEqual({ mode: 'types', area: 'GUIDE', project: 'docs' })
  expect(startView(collect(LISTED, 'shop'), true)).toEqual({ mode: 'areas', project: 'shop' })
  expect(startView(collect(LISTED, 'shop'), false)).toEqual({ mode: 'areas' })
})

test('unblockers and search understand bare and qualified refs', () => {
  const all = collect(LISTED, '')
  expect(unblockers(all).map(i => i.id)).toEqual(['API-001', 'API-002'])
  expect(search(all, 'TEXT api').map(i => i.id)).toEqual(['API-001', 'API-002'])
  expect(search(all, 'docs:guide').map(i => i.id)).toEqual(['GUIDE-001'])
  expect(search(all, 'shop:API-002').map(i => i.id)).toEqual(['API-002'])
  expect(search(all, '  ')).toEqual([])
  const web = all.find(i => i.id === 'WEB-001')!
  const guide = all.find(i => i.id === 'GUIDE-001')!
  expect(findRef(all, 'API-001', web)?.id).toBe('API-001')
  expect(findRef(all, 'shop:API-002', guide)?.id).toBe('API-002')
  expect(findRef(all, 'API-002', guide)?.id).toBe('API-002')
  expect(findRef(all, 'docs:API-002', guide)).toBe(null)
  expect(refOf(web)).toBe('shop:WEB-001')
  expect(refOf({ id: 'A-1', project: '.', projectName: 'notes' })).toBe('notes:A-1')
})

test('promptFor carries the whole item in English with the qualified ref and forbids re-reading backlogs', () => {
  const item = { ...collect(LISTED, 'WEB-001')[0]!, doneWhen: 'tests green' }
  const text = promptFor(item, S, ['shop/TODO.md', 'docs/TODO.md'])
  expect(text).toContain('shop:WEB-001 [code]')
  expect(text).toContain('`shop/web.md`')
  expect(text).toContain('Done when: tests green')
  expect(text).toContain('blocked by API-001')
  expect(text).toContain('Do not read other backlogs')
  expect(text).toContain('(`shop/TODO.md`)')
  expect(text).not.toContain('docs/TODO.md')
  expect(text).toContain('remove the item from `shop/web.md`')
  expect(text).not.toContain('unmerged branch')
  const api = promptFor(collect(LISTED, 'shop:API-002')[0]!, S)
  expect(api).toContain('shop:API-002')
  expect(api).toContain('no "Done when" criterion')
  expect(api).not.toMatch(/\b(lavora|attenzione|fatto quando|non leggere|bloccato|rimuovi)\b/i)
})

test('promptFor reports parts, cycles and work on an unmerged branch; another language gives its own prompt', () => {
  const base = collect(LISTED, 'shop:API-001')[0]!
  const text = promptFor({
    ...base,
    parts: [{ done: true, text: 'bug 6' }, { done: false, text: 'bug 7' }],
    cycle: ['API-001', 'WEB-001', 'API-001'],
    unmerged: [{ hash: '3c78f53', branch: 'feature/minor-bugs', subject: 'fix (API-001)' }],
  }, S)
  expect(text).toContain('- [x] bug 6\n- [ ] bug 7')
  expect(text).toContain('API-001 > WEB-001 > API-001')
  expect(text).toContain('3c78f53 on feature/minor-bugs')
  expect(text).toContain('git show feature/minor-bugs:shop/TODO.md')
  expect(promptFor(base, MARKED)).toContain('it:Work on item shop:API-001')
})

test('stillOpen and partsOf read CRLF and LF alike and only the item\'s own lines', () => {
  expect(stillOpen('# X\n\n- [ ] [A-004] **Name**\n', 'A-004')).toBe(true)
  expect(stillOpen('- [ ] [A-005] after A-004 and [A-004]\n  - [ ] part', 'A-004')).toBe(false)
  expect(stillOpen('# X\r\n\r\n- [ ] [A-004] Name\r\n', 'A-004')).toBe(true)
  expect(stillOpen('', 'A-004')).toBe(false)
  const text = '- [ ] [A-1] one\n  - [x] p1\n  - [ ] p2\n  Done when: x\n- [ ] [A-2] two\n  - [x] other\n'
  expect(partsOf(text, 'A-1')).toEqual({ done: 1, total: 2 })
  expect(partsOf(text.replace(/\n/g, '\r\n'), 'A-1')).toEqual({ done: 1, total: 2 })
  expect(partsOf(text, 'A-3')).toEqual({ done: 0, total: 0 })
})

test('duration, bar, statusText and finishedText', () => {
  expect([duration(25 * 60_000), duration(130 * 60_000), duration(120 * 60_000), duration(50 * 3600_000)]).toEqual(['25 min', '2 h 10 min', '2 h', '2 d'])
  expect(duration(50 * 3600_000, { unitDay: 'g' })).toBe('2 g')
  expect(bar({ done: 1, total: 4 }, 8)).toEqual(['██', '░░░░░░'])
  const a = { id: 'A-1', startedAt: 0 }
  expect(statusText(a, { done: 1, total: 2 }, 40 * 60_000)).toBe('▶ A-1 · ████░░░░ 1/2 · 40 min')
  expect(statusText({ id: 'A-1' }, null, 0)).toBe('▶ A-1')
  expect(finishedText({ id: 'A-1', minutes: 7, pending: 2 }, S)).toBe('✓ A-1 done · 7 min · ⚠ 2 uncommitted')
  expect(finishedText({ id: 'A-1', minutes: 7, pending: 2 }, MARKED)).toBe('it:✓ A-1 done · 7 it:min · it:⚠ 2 uncommitted')
  expect(statusSegments(a, { done: 1, total: 2 }, 40 * 60_000)).toEqual([
    { text: '▶ A-1', tone: 'item' }, { text: ' · ', tone: 'muted' },
    { text: '████', tone: 'barDone' }, { text: '░░░░', tone: 'barLeft' }, { text: ' 1/2' }, { text: ' · ', tone: 'muted' },
    { text: '40 min', tone: 'muted' },
  ])
  // Nothing done yet: no empty filled run.
  expect(statusSegments({ id: 'A-1' }, { done: 0, total: 2 }, 0).map(s => s.tone)).toEqual(['item', 'muted', 'barLeft', undefined])
  expect(finishedSegments({ id: 'A-1', minutes: 7, pending: 2 }, S)).toEqual([
    { text: '✓ A-1 done', tone: 'done' }, { text: ' · ', tone: 'muted' }, { text: '7 min', tone: 'muted' }, { text: ' · ', tone: 'muted' },
    { text: '⚠ 2 uncommitted', tone: 'warn' },
  ])
  expect(t(S, 'noSuchKey')).toBe('noSuchKey')
  expect(t(S, 'added', { id: 'X-1' })).toBe('Added X-1')
})

test('normPath: Windows paths with spaces and backslashes compare equal to their forward-slash form', () => {
  const win = 'C:\\Users\\X\\My Projects\\app\\TODO.md'
  expect(normPath(win)).toBe(normPath('c:/users/x/my projects/app/todo.md'))
  expect(sameFile(win, 'c:/users/x/my projects/app/todo.md')).toBe(true)
  expect(sameFile(win, 'C:/Users/X/My Projects/app/OTHER.md')).toBe(false)
  expect(normPath('C:\\Users\\X\\My Projects\\')).toBe('c:/users/x/my projects')
  // POSIX paths outside /Users and /Volumes are case-sensitive.
  expect(sameFile('/home/x/Todo.md', '/home/x/todo.md')).toBe(false)
  expect(sameFile('/Users/x/Todo.md', '/users/x/todo.md')).toBe(true)
})

test('relativeTo keeps the spelling of the path and respects folder boundaries', () => {
  const root = 'C:\\Users\\X\\My Projects'
  expect(relativeTo(root, 'c:/users/x/my projects/App/TODO.md')).toBe('App/TODO.md')
  expect(relativeTo(root, 'C:\\Users\\X\\My Projects\\app\\TODO.md')).toBe('app/TODO.md')
  expect(relativeTo(root, 'C:\\Users\\X\\My Projects')).toBe('')
  expect(relativeTo(root, 'C:\\Users\\X\\My Projects 2\\app\\TODO.md')).toBe(null)
  expect(relativeTo('C:/x/ws/', 'C:/x/other.md')).toBe(null)
})

test('indexesOf and newlyDirty', () => {
  const known = ['TODO.md', 'app/todo.md', 'app/todo/index.md', 'other/TODO.md']
  expect(indexesOf('app/todo/web.md', known)).toEqual(['TODO.md', 'app/todo.md', 'app/todo/index.md'])
  expect(indexesOf('TODO.md', known)).toEqual([])
  expect(newlyDirty(['a.txt'], ['a.txt', 'b.md'])).toEqual(['b.md'])
  expect(newlyDirty(undefined, ['a'])).toEqual(['a'])
})
