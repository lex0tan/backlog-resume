// Three guards around the backlog files. None of them ever blocks work except the read guard, and only while an item is active:
//   readDenial        with an active item the prompt carries everything, so other backlogs stay closed
//   afterBacklogEdit  an edit of a backlog file that introduces issues is reported back to the model
//   commitWarning     a commit made while an item is active should cite its ID

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Active, FileSet, Issue } from '../../types'
import { indexesOf } from './board'
import { relativeTo, sameFile } from './paths'
import { runScript } from './script'
import { labelOf, mineOf } from './session'
import { loadStrings, t } from './strings'

/** Backlog files of the workspace, read once per session and again after anything that can change them. */
export const known = atom({ plugin: 'backlogs', key: 'files' } as const, null)

export async function backlogFiles($: EngineInterface, fresh = false): Promise<FileSet | null> {
  const cached = await read($, known)
  if (cached && !fresh) return cached
  const out = (await runScript($, ['files'])) as { status: string; root?: string; language?: string; projects?: FileSet['projects'] }
  const set: FileSet | null = out.status === 'ok' && out.root ? { root: out.root.replace(/\/+$/, ''), language: out.language ?? 'en', projects: out.projects ?? [] } : null
  await update($, known, () => set)
  return set
}

export function forgetFiles($: EngineInterface) {
  return update($, known, () => null)
}

/** The project (folder relative to the workspace root) whose backlog files include `path`; null for any other file. */
export async function backlogProject($: EngineInterface, path: string | undefined): Promise<string | null> {
  if (!path) return null
  const set = await backlogFiles($)
  return set?.projects.find(p => p.files.some(f => sameFile(f, path)))?.rel ?? null
}

/** With an active item: the reason a read of any other backlog file is refused; null lets it through. */
export async function readDenial($: EngineInterface, path: string | undefined): Promise<string | null> {
  if (!path) return null
  const own = await mineOf($)
  if (!own) return null
  const set = await backlogFiles($)
  if (!set || !set.projects.some(p => p.files.some(f => sameFile(f, path)))) return null
  const ownRel = relativeTo(set.root, own.file)
  if (ownRel === null) return null
  const indexRels = set.projects.flatMap(p => p.indexes).map(f => relativeTo(set.root, f)).filter((r): r is string => r !== null)
  const allowed = [ownRel, ...indexesOf(ownRel, indexRels)]
  if (allowed.some(a => sameFile(`${set.root}/${a}`, path))) return null
  const strings = await loadStrings($, own.language)
  return t(strings, 'guardRead', { ref: labelOf(own), file: relativeTo(set.root, path) ?? path, allowed: allowed.map(a => `\`${a}\``).join(', ') })
}

/** Findings of `check --fast` for one project (no git, so cheap enough to run around an edit). */
export async function checkIssues($: EngineInterface, project: string): Promise<Issue[]> {
  const out = (await runScript($, ['check', '--project', project, '--fast'])) as { issues?: Issue[] }
  return Array.isArray(out.issues) ? out.issues : []
}

const issueKey = (i: Issue) => `${i.code}|${i.file ?? ''}|${i.message}`

/** Findings present after and not before. */
export function newIssues(before: readonly Issue[], after: readonly Issue[]): Issue[] {
  const seen = new Set(before.map(issueKey))
  return after.filter(i => !seen.has(issueKey(i)))
}

/** Text for the model when an edit of a backlog file introduced issues (and a toast for the user); null when it did not. */
export async function afterBacklogEdit($: EngineInterface, path: string, before: readonly Issue[], after: readonly Issue[]): Promise<string | null> {
  const fresh = newIssues(before, after)
  if (!fresh.length) return null
  const set = await backlogFiles($)
  const strings = await loadStrings($, set?.language ?? 'en')
  const file = set ? relativeTo(set.root, path) ?? path : path
  $.ui.toast(t(strings, 'guardCheckToast', { n: fresh.length, file }), { timeoutMs: 6000 })
  return t(strings, 'guardCheck', { file, n: fresh.length, issues: fresh.map(i => `${i.code}: ${i.message}`).join('; ') })
}

// Boundary: no git, or no commit yet, answers null.
async function gitOut($: EngineInterface, cwd: string, args: string[]): Promise<string | null> {
  try {
    const run = await $.process.run(['git', '-C', cwd, ...args], { timeoutMs: 15_000 })
    return run.exitCode === 0 ? run.stdout.trim() : null
  } catch {
    return null
  }
}

async function rootOfProject($: EngineInterface, own: Active): Promise<string | null> {
  return (await backlogFiles($))?.projects.find(p => p.rel === own.project)?.root ?? null
}

/** The commit the item's repository is on, before a commit command runs. */
export async function headOf($: EngineInterface, own: Active): Promise<string | null> {
  const root = await rootOfProject($, own)
  return root === null ? null : gitOut($, root, ['rev-parse', 'HEAD'])
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** After a commit command: the reminder when HEAD moved and the new message does not cite the active item's ID. */
export async function commitWarning($: EngineInterface, own: Active, headBefore: string | null): Promise<string | null> {
  const root = await rootOfProject($, own)
  if (root === null) return null
  const head = await gitOut($, root, ['rev-parse', 'HEAD'])
  if (!head || head === headBefore) return null
  const message = (await gitOut($, root, ['log', '-1', '--format=%B'])) ?? ''
  if (new RegExp(`(^|[^A-Za-z0-9-])${escape(own.id)}(?![A-Za-z0-9-])`).test(message)) return null
  const strings = await loadStrings($, own.language)
  $.ui.toast(t(strings, 'guardCommitToast', { ref: labelOf(own) }), { timeoutMs: 6000 })
  return t(strings, 'guardCommit', { ref: labelOf(own) })
}

type Settled = { result?: unknown; context?: readonly string[]; deny?: string }

/**
 * Runs an edit tool call. When the file is one of the backlog, `check --fast` runs before and after, and the issues the edit
 * introduced travel back as context. The call itself is never held back or refused.
 */
export async function guardedEdit<R extends Settled>($: EngineInterface, path: string | undefined, run: () => Promise<R>): Promise<R> {
  const project = path ? await backlogProject($, path) : null
  if (!path || project === null) return run()
  const before = await checkIssues($, project)
  const result = await run()
  await forgetFiles($)
  if (result.result === undefined) return result
  const text = await afterBacklogEdit($, path, before, await checkIssues($, project))
  return text ? ({ ...result, context: [...(result.context ?? []), text] } as R) : result
}
