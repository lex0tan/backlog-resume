// Pure functions over the board: no engine, no I/O. The panel and the session logic build on them.

import type { Active, Finished, Item, Parts, Strings, View, Workstream } from '../../types'
import { t } from './strings'

type ListedItem = Partial<Item> & { id: string; project: string; type: string; text: string }
type ListedWorkstream = { id: string; label: string; file: string; area: { id: string; name: string }; items: ListedItem[] }
export type Listed = {
  status: string
  message?: string
  language?: string
  root?: string
  settings?: { lockMinutes?: number }
  typeOrder?: string[]
  projects?: { rel: string; name: string; workstreams: ListedWorkstream[] }[]
}

export const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** How an item is named across the workspace: `project:ID`, with the project's name for a project at the root. */
export const qualifier = (i: Pick<Item, 'project' | 'projectName'>) => (i.project === '.' ? i.projectName : i.project)
export const refOf = (i: Pick<Item, 'id' | 'project' | 'projectName'>) => `${qualifier(i)}:${i.id}`

const matches = (text: string, f: string) => !f || norm(text).includes(f)

// Open items of the projects or workstreams the filter names (project, workstream ID or label, area); empty = all.
// When nothing matches, the filter counts as an item ID, bare or qualified (`API-002`, `shop:API-002`).
export function collect(listed: Listed, filter: string): Item[] {
  const f = norm(filter.trim())
  const rows = (listed.projects ?? []).flatMap(p => p.workstreams.map(w => ({ p, w })))
  const text = ({ p, w }: (typeof rows)[number]) => `${p.name} ${p.rel} ${w.id} ${w.label} ${w.area.id} ${w.area.name}`
  const byWorkstream = rows.filter(r => matches(text(r), f))
  const idMatch = (i: ListedItem, p: { rel: string; name: string }) => {
    const [first, rest] = f.includes(':') ? [f.slice(0, f.indexOf(':')), f.slice(f.indexOf(':') + 1)] : ['', f]
    return norm(i.id) === rest && (!first || [p.rel, p.name].some(n => norm(n) === first))
  }
  const picked = byWorkstream.length
    ? byWorkstream.map(r => ({ ...r, items: r.w.items }))
    : rows.map(r => ({ ...r, items: r.w.items.filter(i => idMatch(i, r.p)) })).filter(r => r.items.length)
  return picked
    .flatMap(({ p, w, items }) => items.map((i): Item => ({
      workstream: w.id, doneWhen: null, blockedBy: [], unblocks: [], cycle: null, waiting: false, steps: [], stale: null,
      parts: [], unmerged: [], when: null, lockedBy: null,
      ...i,
      projectName: p.name, file: w.file, area: w.area.id, areaName: w.area.name,
    })))
    .sort(byWhen)
}

// Overdue (oldest first), then due, then undated, then later; the CLI's order otherwise.
const WHEN_RANK = { overdue: 0, due: 1, none: 2, later: 3 }
const byWhen = (a: Item, b: Item) => WHEN_RANK[a.when?.state ?? 'none'] - WHEN_RANK[b.when?.state ?? 'none']
  || (b.when?.days ?? 0) - (a.when?.days ?? 0)

// Agenda at the top of the pane: today = date reached (overdue first), tomorrow = date one day away.
export function agenda(items: readonly Item[]): { today: Item[]; tomorrow: Item[] } {
  return {
    today: items.filter(i => i.when && i.when.state !== 'later'),
    tomorrow: items.filter(i => i.when?.state === 'later' && i.when.days === -1),
  }
}

// "Thursday, 8 October"; without Intl in the sandbox the ISO date stays.
export function dayLabel(offset: number, locale: string, now = Date.now()): string {
  const d = new Date(now + offset * 86_400_000)
  try {
    return d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

export function whenMark(i: Item, strings: Strings): string {
  if (!i.when) return ''
  if (i.when.state === 'overdue') return `⚠️ ${t(strings, 'markOverdue', { days: i.when.days })} · `
  return i.when.state === 'due' ? '⏰ ' : `🕒 ${t(strings, 'markFrom', { date: i.when.from })} · `
}

export function workstreamsOf(listed: Listed, filter: string): Workstream[] {
  const f = norm(filter.trim())
  return (listed.projects ?? []).flatMap(p => p.workstreams
    .filter(w => matches(`${p.name} ${p.rel} ${w.id} ${w.label} ${w.area.id} ${w.area.name}`, f))
    .map(w => ({ id: w.id, label: w.label, area: w.area.id, project: p.rel })))
}

const tally = (list: readonly Item[]) => ({ count: list.length, blocked: list.filter(i => i.blockedBy.length).length })

// Projects in the order they first appear, with how many items and how many blocked.
export function projects(items: readonly Item[]): { id: string; name: string; count: number; blocked: number }[] {
  return [...new Set(items.map(i => i.project))].map(id => {
    const of = items.filter(i => i.project === id)
    return { id, name: of[0]!.projectName, ...tally(of) }
  })
}

// Areas grouped by project: the same area ID in two projects is two entries.
export function areas(items: readonly Item[]): { project: string; id: string; name: string; count: number; blocked: number }[] {
  return projects(items).flatMap(p => {
    const inProject = items.filter(i => i.project === p.id)
    return [...new Set(inProject.map(i => i.area))].map(id => {
      const of = inProject.filter(i => i.area === id)
      return { project: p.id, id, name: of[0]!.areaName, ...tally(of) }
    })
  })
}

// Types in the workspace's `typeOrder` (from the CLI); types it does not list come last.
export function groups(items: readonly Item[], typeOrder: readonly string[] = []): { type: string; count: number; blocked: number }[] {
  const rank = (type: string) => (typeOrder.indexOf(type) < 0 ? typeOrder.length : typeOrder.indexOf(type))
  return [...new Set(items.map(i => i.type))].sort((a, b) => rank(a) - rank(b)).map(type => ({ type, ...tally(items.filter(i => i.type === type)) }))
}

// The item a ref points to, seen from `from`: `project:ID` names the project, a bare ID means the same project first
// and then the only item with that ID in the workspace.
export function findRef(items: readonly Item[], ref: string, from: Pick<Item, 'project'>): Item | null {
  const at = ref.indexOf(':')
  if (at > 0) {
    const [q, id] = [norm(ref.slice(0, at)), ref.slice(at + 1)]
    return items.find(i => i.id === id && [i.project, i.projectName].some(n => norm(n) === q)) ?? null
  }
  const own = items.find(i => i.id === ref && i.project === from.project)
  if (own) return own
  const hits = items.filter(i => i.id === ref)
  return hits.length === 1 ? hits[0]! : null
}

// Who blocks other items, from the one that unblocks most.
export function unblockers(items: readonly Item[]): Item[] {
  return items.filter(i => i.unblocks.length).sort((a, b) => b.unblocks.length - a.unblocks.length)
}

export function search(items: readonly Item[], query: string): Item[] {
  const words = norm(query).split(/\s+/).filter(Boolean)
  return words.length ? items.filter(i => words.every(w => norm(`${refOf(i)} ${i.id} ${i.text}`).includes(w))) : []
}

// Where the pane starts: at the project when the workspace has several, then area; a single choice is skipped.
export function startView(items: readonly Item[], multi = false): View {
  const projectIds = projects(items).map(p => p.id)
  if (multi && projectIds.length > 1) return { mode: 'projects' }
  const project = multi ? projectIds[0] : undefined
  const list = areas(items)
  const at = project === undefined ? {} : { project }
  return list.length === 1 ? { mode: 'types', area: list[0]!.id, ...at } : { mode: 'areas', ...at }
}

// Index files above an item's file, among the known index files: those in its folder or a folder above it,
// or named after one of those folders (todo.md for todo/).
export function indexesOf(file: string, known: readonly string[] = []): string[] {
  const dirs = file.split('/').slice(0, -1).map((_, i, all) => all.slice(0, i + 1).join('/').toLowerCase())
  return known.filter(k => {
    if (k === file) return false
    const lower = k.toLowerCase()
    const dir = lower.includes('/') ? lower.slice(0, lower.lastIndexOf('/')) : ''
    return dir === '' || dirs.includes(dir) || dirs.some(d => lower === `${d}.md`)
  })
}

// The prompt carries the whole item: the model does not re-read indexes or backlogs.
export function promptFor(item: Item, strings: Strings, indexFiles: readonly string[] = []): string {
  const branches = [...new Set(item.unmerged.map(c => c.branch))]
  const ref = refOf(item)
  const indexes = indexesOf(item.file, indexFiles)
  return [
    t(strings, 'promptWork', { ref, type: item.type, file: item.file }),
    item.text,
    item.doneWhen ? t(strings, 'promptDoneWhen', { text: item.doneWhen }) : t(strings, 'promptNoDoneWhen'),
    item.parts.length ? `${t(strings, 'promptParts')}\n${item.parts.map(p => `- [${p.done ? 'x' : ' '}] ${p.text}`).join('\n')}` : '',
    item.blockedBy.length ? t(strings, 'promptBlocked', { refs: item.blockedBy.join(', ') }) : '',
    item.cycle ? t(strings, 'promptCycle', { chain: item.cycle.join(' > ') }) : '',
    branches.length
      ? t(strings, 'promptUnmerged', { commits: item.unmerged.map(c => `${c.hash} on ${c.branch}`).join(', '), branch: branches[0]!, file: item.file })
      : '',
    t(strings, 'promptRules'),
    indexes.length ? t(strings, 'promptIndexes', { files: indexes.map(p => `\`${p}\``).join(', ') }) : '',
    t(strings, 'promptRemove', { file: item.file }),
  ].filter(Boolean).join('\n')
}

const OPEN_ITEM = /^\s*- \[[ x]\] \[([^\]]+)\]/

// The item is still open while its `- [ ] [ID]` line is in the file: the model removes it when the work is done.
export function stillOpen(text: string, id: string): boolean {
  return text.split(/\r?\n/).some(line => OPEN_ITEM.exec(line)?.[1] === id)
}

// Parts of an item: the indented `- [ ]`/`- [x]` lines under its line, up to the next item.
export function partsOf(text: string, id: string): Parts {
  const lines = text.split(/\r?\n/)
  const at = lines.findIndex(line => OPEN_ITEM.exec(line)?.[1] === id)
  let done = 0, total = 0
  for (const line of at < 0 ? [] : lines.slice(at + 1)) {
    if (line.trim() && !/^\s/.test(line)) break
    const m = /^\s+- \[([ x])\] /.exec(line)
    if (m) { total++; if (m[1] === 'x') done++ }
  }
  return { done, total }
}

export function duration(ms: number, strings: Strings = {}): string {
  const unit = (key: string, fallback: string) => strings[key] ?? fallback
  const min = Math.max(0, Math.round(ms / 60_000))
  if (min < 60) return `${min} ${unit('unitMin', 'min')}`
  if (min < 24 * 60) return `${Math.floor(min / 60)} ${unit('unitHour', 'h')}${min % 60 ? ` ${min % 60} ${unit('unitMin', 'min')}` : ''}`
  return `${Math.floor(min / (24 * 60))} ${unit('unitDay', 'd')}`
}

export function bar(parts: Parts, width: number): [string, string] {
  const filled = parts.total ? Math.round((width * parts.done) / parts.total) : 0
  return ['█'.repeat(filled), '░'.repeat(width - filled)]
}

export function statusText(a: Pick<Active, 'id'> & Partial<Pick<Active, 'startedAt'>>, parts: Parts | null, now: number, strings: Strings = {}): string {
  return [`▶ ${a.id}`, parts?.total ? `${bar(parts, 8).join('')} ${parts.done}/${parts.total}` : '', a.startedAt !== undefined ? duration(now - a.startedAt, strings) : '']
    .filter(Boolean).join(' · ')
}

export function finishedText(f: Finished, strings: Strings): string {
  return [t(strings, 'finishedLine', { id: f.id }), f.minutes !== null ? duration(f.minutes * 60_000, strings) : '', f.pending ? t(strings, 'finishedPending', { n: f.pending }) : '']
    .filter(Boolean).join(' · ')
}

// Files changed since the item started: they were not among the local changes when work began.
export const newlyDirty = (before: readonly string[] | undefined, now: readonly string[]) =>
  before ? now.filter(p => !before.includes(p)) : [...now]
