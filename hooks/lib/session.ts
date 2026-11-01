// The item each session works on, kept in the plugin store so that sessions see one another:
//   active:<sessionId>    one entry per session (the item it works on, with a heartbeat)
//   finished:<sessionId>  the last item the session closed, shown until a new one starts
//   closed                the last 50 closed items, for the "done today" count
// A session whose heartbeat stopped leaves an orphan: it is proposed to the user, never taken automatically.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Active, Board, Closed, Finished, Item, Parts, Segment } from '../../types'
import { finishedSegments, finishedText, newlyDirty, partsOf, plainText, statusSegments, stillOpen } from './board'
import { normPath, relativeTo } from './paths'
import { runScript } from './script'
import { loadStrings, t } from './strings'

const ACTIVE = 'active:'
const FINISHED = 'finished:'
const CLOSED = 'closed'
const CLOSED_KEPT = 50
export const HEARTBEAT_MS = 60_000
/** Entries of other sessions older than this are deleted from the store: nobody can resume or propose them any more. */
export const STORE_KEEP_MS = 30 * 24 * 3600_000

export const active = atom({ plugin: 'backlog-resume', key: 'active' } as const, null)
export const finished = atom({ plugin: 'backlog-resume', key: 'finished' } as const, null)
/** The status line, drawn beside the prompt hint by hooks/status.tsx. */
export const line = atom({ plugin: 'backlog-resume', key: 'line' } as const, null)

export type Locks = {
  /** The entry of this session. */
  mine: Active | null
  /** Items other live sessions work on, by `project:ID`. */
  elsewhere: Map<string, Active>
  /** Entries whose session went silent, in this workspace. */
  orphans: Active[]
}

/**
 * How an item is keyed across sessions: its file and ID. Never the project folder, which is relative to the root of
 * each session's own workspace (the same item is `shop:ID` from one folder and `.:ID` from another).
 */
export const lockKey = (a: Pick<Active, 'file' | 'id'>) => `${normPath(a.file)}#${a.id}`
/** The key of a board item, whose file is relative to the workspace root. */
export const itemLockKey = (item: Pick<Item, 'file' | 'id'>, root: string) => lockKey({ file: `${root}/${item.file}`, id: item.id })
/** How an entry is named to the user. */
export const labelOf = (a: Pick<Active, 'project' | 'id'>) => (a.project === '.' ? a.id : `${a.project}:${a.id}`)

const isActive = (v: unknown): v is Active => {
  const a = v as Partial<Active> | null | undefined
  return !!a && typeof a.id === 'string' && typeof a.sessionId === 'string' && typeof a.heartbeatAt === 'number' && typeof a.cwd === 'string'
}

/** Every session's entry, this session's included. */
async function entries($: EngineInterface): Promise<Active[]> {
  const keys = (await $.store.keys()).filter(k => k.startsWith(ACTIVE))
  const values = await Promise.all(keys.map(k => $.store.get(k)))
  return values.filter(isActive)
}

async function myKey($: EngineInterface): Promise<string> {
  return `${ACTIVE}${await $.session.id()}`
}

/** Who holds what: `mine` regardless of its age (a resumed session finds its item), others fresh (`elsewhere`) or silent (`orphans`). */
export async function locks($: EngineInterface, now: number, ttlMs: number, root: string): Promise<Locks> {
  const me = await $.session.id()
  const out: Locks = { mine: null, elsewhere: new Map(), orphans: [] }
  for (const a of await entries($)) {
    if (a.sessionId === me) out.mine = a
    else if (now - a.heartbeatAt < ttlMs) out.elsewhere.set(lockKey(a), a)
    else if (relativeTo(root, a.cwd) !== null) out.orphans.push(a)
  }
  return out
}

/** The entry of this session. */
export async function mineOf($: EngineInterface): Promise<Active | null> {
  const value = await $.store.get(await myKey($))
  return isActive(value) ? value : null
}

// Surfaces that draw the prompt hint, where the status line is drawn in colour beside it (hooks/status.tsx).
const HINT_SURFACES: readonly string[] = ['terminal', 'desktop']

/** The status line as last set, for the drawing (a read there redraws it on every change). */
export async function statusLine($: EngineInterface) {
  return read($, line)
}

/** Sets the status line; null clears it. Surfaces without the prompt hint get it as the host's plain status line. */
async function showLine($: EngineInterface, segments: Segment[] | null) {
  await update($, line, () => segments)
  const plainOnly = (await $.session.surfaces()).some(s => !HINT_SURFACES.includes(s))
  $.ui.status(segments && plainOnly ? plainText(segments) : undefined)
}

// Status line: item, bar of the parts done, time.
async function showProgress($: EngineInterface, value: Active | null, parts: Parts | null, strings: Record<string, string> = {}) {
  await showLine($, value ? statusSegments(value, parts, Date.now(), strings) : null)
}

/** The parts of the item as its file has them now; null when the file cannot be read. */
async function partsNow($: EngineInterface, a: Active): Promise<Parts | null> {
  try {
    return partsOf((await $.fs.read(a.file, { as: 'text' })) as string, a.id)
  } catch {
    // refreshActive reports and handles an unreadable file; here the line only goes without its bar.
    return null
  }
}

async function setMine($: EngineInterface, value: Active | null) {
  const key = await myKey($)
  await update($, active, () => value)
  await (value ? $.store.set(key, value) : $.store.delete(key))
}

/** Clears the "done" line, from the status line and the store. */
export async function clearFinished($: EngineInterface) {
  await update($, finished, () => null)
  await $.store.delete(`${FINISHED}${await $.session.id()}`)
  await showLine($, null)
}

async function setFinished($: EngineInterface, value: Finished, strings: Record<string, string>) {
  await update($, finished, () => value)
  await $.store.set(`${FINISHED}${await $.session.id()}`, value)
  await showLine($, finishedSegments(value, strings))
}

/** This session starts the item. Null when another live session already holds it. */
export async function takeItem($: EngineInterface, item: Item, board: Board, now = Date.now()): Promise<Active | null> {
  const held = await locks($, now, board.lockMinutes * 60_000, board.root)
  if (held.elsewhere.has(itemLockKey(item, board.root))) return null
  const value: Active = {
    id: item.id, project: item.project, file: `${board.root}/${item.file}`, text: item.text, language: board.language,
    startedAt: now, dirtyAtStart: board.dirty, sessionId: await $.session.id(), cwd: await $.session.cwd(), heartbeatAt: now,
  }
  if (await read($, finished)) await clearFinished($)
  await setMine($, value)
  const parts: Parts = { done: item.parts.filter(p => p.done).length, total: item.parts.length }
  await showProgress($, value, parts, await loadStrings($, board.language))
  return value
}

/** This session lets go of its item. */
export async function releaseItem($: EngineInterface) {
  await setMine($, null)
  await showLine($, null)
}

/** Says this session is alive. */
export async function heartbeat($: EngineInterface, now = Date.now()) {
  const a = await mineOf($)
  if (!a) return
  // The item may have been released while the entry was read: write only if it is still the same one.
  const key = await myKey($)
  const current = await mineOf($)
  if (current && current.id === a.id && current.startedAt === a.startedAt) await $.store.set(key, { ...current, heartbeatAt: now })
}

/** Takes an orphan over: its entry moves under this session's ID. */
export async function adoptOrphan($: EngineInterface, orphan: Active, now = Date.now()): Promise<Active> {
  await $.store.delete(`${ACTIVE}${orphan.sessionId}`)
  const value: Active = { ...orphan, sessionId: await $.session.id(), cwd: await $.session.cwd(), heartbeatAt: now }
  await setMine($, value)
  await showProgress($, value, await partsNow($, value), await loadStrings($, value.language))
  return value
}

/** Frees an orphan's item without taking it. */
export async function dropOrphan($: EngineInterface, orphan: Active) {
  await $.store.delete(`${ACTIVE}${orphan.sessionId}`)
}

const dayKey = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` }

export async function closedToday($: EngineInterface, now = Date.now()): Promise<Closed[]> {
  const list = ((await $.store.get(CLOSED)) as Closed[] | undefined) ?? []
  return list.filter(c => dayKey(c.at) === dayKey(now))
}

type GitOut = { status: string; projects?: { dirty?: { path: string }[] }[] }

/** After an edit, at the end of a turn and on the heartbeat: when the model removed the item from its file the item is freed and recorded as closed, otherwise the status line is refreshed. */
export async function refreshActive($: EngineInterface, now = Date.now()) {
  const a = await mineOf($)
  if (!a) return
  const strings = await loadStrings($, a.language)
  let text: string
  try {
    text = (await $.fs.read(a.file, { as: 'text' })) as string
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    $.ui.log(`backlog: cannot read ${a.file} for ${labelOf(a)}: ${reason}`)
    // The file is gone (moved, deleted): the item cannot be finished any more, so it is freed without being recorded as closed.
    // Any other read error is transient and decides nothing.
    if (!(await $.fs.exists(a.file).catch(() => true))) await releaseItem($)
    return
  }
  if (stillOpen(text, a.id)) {
    await showProgress($, a, partsOf(text, a.id), strings)
    return
  }
  await releaseItem($)
  const minutes = Math.round((now - a.startedAt) / 60_000)
  const closed = ((await $.store.get(CLOSED)) as Closed[] | undefined) ?? []
  await $.store.set(CLOSED, [...closed, { id: a.id, at: now, minutes }].slice(-CLOSED_KEPT))
  const git = (await runScript($, ['git'])) as GitOut
  const dirty = git.status === 'error' || git.status === 'no-git' ? [] : (git.projects ?? []).flatMap(p => (p.dirty ?? []).map(d => d.path))
  const pending = newlyDirty(a.dirtyAtStart, dirty).length
  const value: Finished = { id: a.id, minutes, pending, language: a.language, at: now }
  $.ui.toast(finishedText(value, strings), { timeoutMs: pending ? 10_000 : 5000 })
  await setFinished($, value, strings)
}

/**
 * Deletes what other sessions left in the store and nobody will use again: `finished:` lines older than `STORE_KEEP_MS`
 * (or without a date) and `active:` entries silent for that long, which no workspace proposes any more.
 */
export async function prune($: EngineInterface, now = Date.now()) {
  const me = await $.session.id()
  for (const key of await $.store.keys()) {
    if (key === `${ACTIVE}${me}` || key === `${FINISHED}${me}`) continue
    const value = (await $.store.get(key)) as { at?: number; heartbeatAt?: number } | undefined
    const stamp = key.startsWith(FINISHED) ? value?.at : key.startsWith(ACTIVE) ? value?.heartbeatAt : null
    if (stamp === null) continue
    if (typeof stamp !== 'number' || now - stamp > STORE_KEEP_MS) {
      $.ui.log(`backlog: pruned stale store entry ${key}`)
      await $.store.delete(key)
    }
  }
}

/** At the start of a session: brings back this session's item (or its last "done" line) and proposes the orphans of this workspace. */
export async function restore($: EngineInterface, now = Date.now()) {
  await prune($, now)
  const own = await mineOf($)
  if (own) {
    await update($, active, () => own)
    const strings = await loadStrings($, own.language)
    await showProgress($, own, await partsNow($, own), strings)
    $.ui.toast(t(strings, 'inProgress', { id: labelOf(own) }), { timeoutMs: 6000 })
  } else {
    const last = await $.store.get(`${FINISHED}${await $.session.id()}`)
    const f = last as Finished | undefined
    if (f?.id) await setFinished($, f, await loadStrings($, f.language ?? 'en'))
  }
  // The root and the time limit come from the workspace: it is read only when someone else left an entry.
  const me = await $.session.id()
  if (!(await entries($)).some(a => a.sessionId !== me)) return
  const listed = (await runScript($, ['list'])) as { status: string; root?: string; language?: string; settings?: { lockMinutes?: number } }
  if (listed.status !== 'ok' || !listed.root) return
  const { orphans } = await locks($, now, (listed.settings?.lockMinutes ?? 5) * 60_000, listed.root)
  const strings = await loadStrings($, listed.language ?? 'en')
  for (const o of orphans) $.ui.toast(t(strings, 'orphanProposal', { id: labelOf(o) }), { timeoutMs: 8000 })
}
