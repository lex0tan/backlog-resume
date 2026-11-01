import type { EngineInterface } from 'claude-code'

import { commitWarning, forgetFiles, guardedEdit, headOf, readDenial } from './guards'
import { heartbeat, mineOf, refreshActive, restore } from './session'

// A `git commit` inside one command (not across a pipe, `;`, `&` or a new line).
const GIT_COMMIT = /\bgit\b[^|;&\n]*\bcommit\b/
// A command that runs the plugin's script (split, adopt write...) may create or remove backlog files.
const RUNS_SCRIPT = /backlog\.mjs/

type Ctx = EngineInterface
type Settled = { result?: unknown; context?: readonly string[]; deny?: string }

// Helpers of the hooks in register.tsx. They take the adapter `io` that register.tsx builds from the hook context,
// and none of them lets a failing guard fail the tool call or the session.
export function note(io: Ctx, what: string, err: unknown) {
  io.ui.log(`backlog: ${what}: ${err instanceof Error ? err.message : String(err)}`)
}

// A failed refresh of the status line never fails the tool call that triggered it.
export async function refreshAfterTool(io: Ctx) {
  try {
    await refreshActive(io)
  } catch (err) {
    note(io, 'status refresh failed', err)
  }
}

// The session's own item comes back and orphans of this workspace are proposed.
export async function restoreSession(io: Ctx) {
  try {
    await restore(io)
  } catch (err) {
    note(io, 'restore failed', err)
  }
}

// The time spent moves on the status line, and an item closed outside any tool call (by hand, from another tool) is seen.
export async function beat(io: Ctx) {
  try {
    await heartbeat(io)
  } catch (err) {
    note(io, 'heartbeat failed', err)
  }
  await refreshAfterTool(io)
}

export function editAround<R extends Settled>(io: Ctx, path: string | undefined, run: () => Promise<R>, refresh: boolean) {
  const guarded = guardedEdit(io, path, run)
  return refresh ? guarded.finally(() => refreshAfterTool(io)) : guarded
}

// Commit reminder: with an active item, a commit that does not cite its ID is pointed out afterwards.
export async function bashAround(io: Ctx, e: { command?: string }, next: () => Promise<any>) {
  const command = e.command ?? ''
  const own = GIT_COMMIT.test(command) ? await mineOf(io) : null
  const before = own ? await headOf(io, own) : null
  const result = await next()
  if (RUNS_SCRIPT.test(command)) await forgetFiles(io)
  // A command may change the item's file too (a script, a checkout, a commit that closes it).
  await refreshAfterTool(io)
  const text = own && result.deny === undefined && result.result !== undefined ? await commitWarning(io, own, before) : null
  return text && result.deny === undefined ? { ...result, context: [...(result.context ?? []), text] } : result
}
