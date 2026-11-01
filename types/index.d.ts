// From the `when` field of `list`: before the date `later`, then `due`, after a few days `overdue`.
export type When = { from: string; days: number; state: 'later' | 'due' | 'overdue' }
export type Part = { done: boolean; text: string; user?: boolean }
// One open item as the panel shows it: `list` output plus the workstream it sits in.
// `blockedBy`/`unblocks` hold bare IDs of the same project or qualified `project:ID` refs.
export type Item = {
  id: string
  // Project folder relative to the workspace root ('.' for a project at the root).
  project: string
  projectName: string
  type: string
  workstream: string
  area: string
  areaName: string
  text: string
  doneWhen: string | null
  // Workspace-relative POSIX path of the file that holds the item.
  file: string
  blockedBy: string[]
  unblocks: string[]
  // The dependency cycle the item is part of, closed by repeating its first element.
  cycle: string[] | null
  // Waiting on the user: every open part is theirs, or the item is a decision.
  waiting: boolean
  steps: string[]
  stale: { days: number } | null
  parts: Part[]
  unmerged: { hash: string; branch: string; subject: string }[]
  when: When | null
  // ID of another live session that works on the item.
  lockedBy: string | null
}
export type Parts = { done: number; total: number }
export type Workstream = { id: string; label: string; area: string; project: string }
export type BoardProject = { rel: string; name: string; git: string | null }
export type Board = {
  filter: string
  // Absolute POSIX path of the workspace root, and how long a session may be silent before its item is orphaned.
  root: string
  lockMinutes: number
  items: Item[]
  workstreams: Workstream[]
  projects: BoardProject[]
  // Several projects in the workspace: the pane starts one level higher, at the project.
  multi: boolean
  // Item type order of the workspace (configured, or the types found).
  typeOrder: string[]
  language: string
  // Paths with local changes (workspace-relative), to tell later what was not committed.
  dirty: string[]
  // Backlog index files that sit above item files; filled in by the guards (Task 17).
  indexFiles: string[]
  error: string | null
}
export type View =
  | { mode: 'projects' }
  | { mode: 'areas'; project?: string }
  | { mode: 'types'; area: string; project?: string }
  | { mode: 'items'; area: string; type: string; page: number; project?: string }
  | { mode: 'unblock'; page: number }
  | { mode: 'search'; query: string; page: number }
  | { mode: 'waiting'; page: number }
  | { mode: 'item'; id: string; project?: string; back: View }
  | { mode: 'confirm'; id: string; project?: string; back: View }
  | { mode: 'new'; project?: string; workstream?: string; type?: string }
// The item one session works on. `file` is absolute; the entry lives in the store under `active:<sessionId>`
// and `heartbeatAt` says the session is alive (a stale one in this workspace is an orphan).
export type Active = {
  id: string
  project: string
  file: string
  text: string
  // Language of the workspace, to word the status line and toasts without reading the backlog again.
  language: string
  startedAt: number
  dirtyAtStart: string[]
  sessionId: string
  cwd: string
  heartbeatAt: number
}
// An item closed by a session, kept in the store (last 50) for the "done today" count.
export type Closed = { id: string; at: number; minutes: number | null }
// The last closed item, shown as a done line in the status line until dismissed.
export type Finished = { id: string; minutes: number | null; pending: number; language?: string }
// `files` output: every backlog file of a project (absolute POSIX), and which of them are indexes.
export type ProjectFiles = { rel: string; root: string; files: string[]; indexes: string[] }
export type FileSet = { root: string; language: string; projects: ProjectFiles[] }
// One finding of `check`.
export type Issue = { level: 'error' | 'warn' | 'info'; code: string; project: string | null; file: string | null; message: string }
// Panel texts: `panel` section of lang/<language>.json.
export type Strings = Record<string, string>

declare module 'claude-code' {
  interface PluginState {
    backlog: { board: Board | null; view: View; active: Active | null; finished: Finished | null; strings: Strings | null; files: FileSet | null }
  }
}
