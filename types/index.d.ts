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
  // Session that holds the item (Task 16).
  lockedBy: string | null
}
export type Parts = { done: number; total: number }
export type Workstream = { id: string; label: string; area: string; project: string }
export type BoardProject = { rel: string; name: string; git: string | null }
export type Board = {
  filter: string
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
export type Active = { id: string; text: string; file: string; startedAt?: number; dirtyAtStart?: string[] }
// The last closed item, shown as a done line in the status line until dismissed.
export type Finished = { id: string; minutes: number | null; pending: number }
// Panel texts: `panel` section of lang/<language>.json.
export type Strings = Record<string, string>

declare module 'claude-code' {
  interface PluginState {
    backlog: { board: Board | null; view: View; active: Active | null; finished: Finished | null; strings: Strings | null }
  }
}
