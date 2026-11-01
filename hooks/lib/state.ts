// Values the pane draws from, and the work that fills them: reading the backlog through the CLI, writing back.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Board, BoardProject, Strings, View } from '../../types'
import { collect, startView, workstreamsOf } from './board'
import type { Listed } from './board'
import { backlogFiles } from './guards'
import { relativeTo } from './paths'
import { runScript } from './script'
import { loadStrings, t } from './strings'

export const PANE = 'backlog'
export const PAGE = 8

export const board = atom({ plugin: 'backlog', key: 'board' } as const, null)
export const view = atom({ plugin: 'backlog', key: 'view' } as const, { mode: 'projects' })
export const strings = atom({ plugin: 'backlog', key: 'strings' } as const, null)

type GitEntry = { project: string; status: string; branch?: string | null; commit?: { hash: string } | null; dirty?: { path: string }[] }
type GitOut = { status: string; projects?: GitEntry[] }
export type Written = { status: string; id?: string; next?: string | null; message?: string }

function gitLine(g: GitEntry | undefined, s: Strings): string | null {
  if (!g || g.status === 'no-git') return null
  if (g.status === 'no-commits') return `${g.branch ?? ''} · ${t(s, 'gitNoCommits')}`
  return `${g.branch ?? ''} · ${g.commit?.hash ?? ''} · ${g.dirty?.length ? t(s, 'gitChanges', { n: g.dirty.length }) : t(s, 'gitClean')}`
}

/** Re-reads the backlog and git through the CLI and redraws the pane. */
export async function load($: EngineInterface, filter: string): Promise<{ board: Board; strings: Strings }> {
  const [listed, git] = (await Promise.all([runScript($, ['list']), runScript($, ['git'])])) as [Listed, GitOut]
  const language = typeof listed.language === 'string' ? listed.language : 'en'
  const s = await loadStrings($, language)
  const items = listed.status === 'error' ? [] : collect(listed, filter)
  const gits = git.projects ?? []
  // The file list is read again with every board: an item added or closed may have created or removed a file.
  const set = await backlogFiles($, true)
  const projects: BoardProject[] = (listed.projects ?? []).map(p => ({ rel: p.rel, name: p.name, git: gitLine(gits.find(g => g.project === p.rel), s) }))
  const next: Board = {
    filter, items, projects, language,
    root: typeof listed.root === 'string' ? listed.root.replace(/\/+$/, '') : '',
    lockMinutes: listed.settings?.lockMinutes ?? 5,
    workstreams: listed.status === 'error' ? [] : workstreamsOf(listed, filter),
    multi: projects.length > 1,
    typeOrder: listed.typeOrder ?? [],
    dirty: gits.flatMap(g => (g.dirty ?? []).map(d => d.path)),
    indexFiles: set ? set.projects.flatMap(p => p.indexes).map(f => relativeTo(set.root, f)).filter((r): r is string => r !== null) : [],
    error: listed.status === 'error' ? listed.message ?? t(s, 'scriptError')
      : items.length === 0 ? (filter ? t(s, 'noItemsFor', { filter }) : t(s, 'noItems')) : null,
  }
  await update($, board, () => next)
  await update($, strings, () => s)
  return { board: next, strings: s }
}

export function go($: EngineInterface, to: View) {
  return update($, view, () => to)
}

/** What the pane draws from, in one read. */
export async function snapshot($: EngineInterface) {
  return { board: await read($, board), view: await read($, view), strings: await read($, strings) }
}

/** Puts the pane on its first view for the board just loaded. */
export async function startAt($: EngineInterface, loaded: Board) {
  await update($, view, () => startView(loaded.items, loaded.multi))
}
