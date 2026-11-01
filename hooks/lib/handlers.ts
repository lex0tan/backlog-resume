import type { EngineInterface } from 'claude-code'

import { PANE, load, startAt } from './state'
import { commitWarning, forgetFiles, guardedEdit, headOf, readDenial } from './guards'
import { modeRun } from './modes'
import { HEARTBEAT_MS, heartbeat, mineOf, refreshActive, restore } from './session'
import { t } from './strings'
import { renderPane } from '../pane'
import { renderStatus } from '../status'

const MODES = ['audit', 'resume', 'plan', 'do', 'adopt', 'init', 'split']
// A `git commit` inside one command (not across a pipe, `;`, `&` or a new line).
const GIT_COMMIT = /\bgit\b[^|;&\n]*\bcommit\b/
// A command that runs the plugin's script (split, adopt write...) may create or remove backlog files.
const RUNS_SCRIPT = /backlog\.mjs/

type Ctx = EngineInterface
type Settled = { result?: unknown; context?: readonly string[]; deny?: string }

// Hook bodies. The directory reads hooks/register.tsx call by call and accepts the hook context only as $.noun.method(...),
// so the handlers live here and register.tsx names them. None of them lets a failing guard fail the tool call or the session.
function note(ctx: Ctx, what: string, err: unknown) {
  ctx.ui.log(`backlog: ${what}: ${err instanceof Error ? err.message : String(err)}`)
}

// A failed refresh of the status line never fails the tool call that triggered it.
async function refreshAfterTool(ctx: Ctx) {
  try {
    await refreshActive(ctx)
  } catch (err) {
    note(ctx, 'status refresh failed', err)
  }
}

// The session's own item comes back and orphans of this workspace are proposed.
async function restoreSession(ctx: Ctx) {
  try {
    await restore(ctx)
  } catch (err) {
    note(ctx, 'restore failed', err)
  }
}

// The time spent moves on the status line, and an item closed outside any tool call (by hand, from another tool) is seen.
async function beat(ctx: Ctx) {
  try {
    await heartbeat(ctx)
  } catch (err) {
    note(ctx, 'heartbeat failed', err)
  }
  await refreshAfterTool(ctx)
}

function editAround<R extends Settled>(ctx: Ctx, path: string | undefined, run: () => Promise<R>, refresh: boolean) {
  const guarded = guardedEdit(ctx, path, run)
  return refresh ? guarded.finally(() => refreshAfterTool(ctx)) : guarded
}

// Commit reminder: with an active item, a commit that does not cite its ID is pointed out afterwards.
async function bashAround(ctx: Ctx, e: { command?: string }, next: () => Promise<any>) {
  const command = e.command ?? ''
  const own = GIT_COMMIT.test(command) ? await mineOf(ctx) : null
  const before = own ? await headOf(ctx, own) : null
  const result = await next()
  if (RUNS_SCRIPT.test(command)) await forgetFiles(ctx)
  // A command may change the item's file too (a script, a checkout, a commit that closes it).
  await refreshAfterTool(ctx)
  const text = own && result.deny === undefined && result.result !== undefined ? await commitWarning(ctx, own, before) : null
  return text && result.deny === undefined ? { ...result, context: [...(result.context ?? []), text] } : result
}

export async function onSessionStart($: Ctx, e: unknown, next: (e: unknown) => unknown) {
  // A skill or command of the same name may already hold /nextup: that must not stop the session.
  try {
    await $.command.register({
      name: 'nextup',
      description: 'Open the backlog panel; /nextup <audit|resume|plan|do|adopt|init|split> <request> runs the session skill',
    })
  } catch (err) {
    note($, '/nextup not registered', err)
  }
  await restoreSession($)
  $.clock.every(HEARTBEAT_MS, () => {
    void beat($)
  })
  return next(e)
}

// At the end of a turn of the main loop: an item the model removed from its file is freed.
export async function onTurnComplete($: Ctx, e: { agentId?: string }, next: (e: unknown) => Promise<unknown>) {
  const result = await next(e)
  if (!e.agentId) await refreshActive($)
  return result
}

// The item stays when the session ends unfinished: it becomes an orphan the next session proposes.
export async function onSessionEnd($: Ctx, e: unknown, next: (e: unknown) => unknown) {
  await refreshActive($)
  return next(e)
}

// Read guard: with an active item the prompt carries everything, so other backlogs stay closed.
export async function onRead($: Ctx, e: { file_path?: string }, next: (e: unknown) => unknown) {
  const deny = await readDenial($, e.file_path)
  return deny ? { deny } : next(e)
}

export async function onGrep($: Ctx, e: { path?: string }, next: (e: unknown) => unknown) {
  const deny = await readDenial($, e.path)
  return deny ? { deny } : next(e)
}

// Check after an edit of a backlog file: new issues go back to the model as context, never as a refusal.
// The status line follows the edit at once: a part ticked moves the bar, the item removed closes it.
export function onEdit($: Ctx, e: { file_path?: string }, next: (e: unknown) => Promise<any>) {
  return editAround($, e.file_path, () => next(e), true)
}

export function onNotebookEdit($: Ctx, e: { notebook_path?: string }, next: (e: unknown) => Promise<any>) {
  return editAround($, e.notebook_path, () => next(e), false)
}

export function onBash($: Ctx, e: { command?: string }, next: (e: unknown) => Promise<any>) {
  return bashAround($, e, () => next(e))
}

// A hook that throws lets the call through unchanged.
export function failOpen($: Ctx, e: unknown, next: (e: unknown) => unknown) {
  return next(e)
}

export async function onCommand($: Ctx, e: { args: string }) {
  const args = e.args.trim()
  const first = args.split(/\s+/)[0] ?? ''
  const mode = MODES.find(m => m === first.toLowerCase())
  if (mode) {
    const run = await modeRun($, mode, args.slice(first.length).trim())
    if ('refused' in run) return { text: run.refused }
    // The host refuses a submit from inside a command.run hook (it would wait on its own turn): it goes out right after the hook returns.
    $.clock.after(0, () => $.prompt.submit({ text: run.text, asUser: true }))
    return { text: `backlog: ${mode}` }
  }
  const { board, strings } = await load($, args)
  await startAt($, board)
  const panes = await $.ui.panes()
  if (!panes.some(pane => pane.id === PANE)) {
    await $.ui.open({ id: PANE, title: t(strings, 'title'), rows: 22, columns: 70, focus: true, closeOnEscape: true })
  }
  return { text: board.error ?? t(strings, board.filter ? 'openedFor' : 'opened', { n: board.items.length, filter: board.filter }) }
}

export function onRenderPane($: Ctx, e: Parameters<typeof renderPane>[1]) {
  return renderPane($, e)
}

export function onRenderStatus($: Ctx, e: Parameters<typeof renderStatus>[1], next: unknown) {
  return renderStatus($, e, next as never)
}
