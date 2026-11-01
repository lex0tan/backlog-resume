import type { Register } from 'claude-code'

import { PANE, load, startAt } from './lib/state'
import { commitWarning, forgetFiles, guardedEdit, headOf, readDenial } from './lib/guards'
import { modeRun } from './lib/modes'
import { HEARTBEAT_MS, heartbeat, mineOf, refreshActive, restore } from './lib/session'
import { t } from './lib/strings'
import { renderPane } from './pane'

// Wiring only: events -> modules under hooks/lib and hooks/pane.tsx.
const MODES = ['audit', 'resume', 'plan', 'do', 'adopt', 'init', 'split']
// A `git commit` inside one command (not across a pipe, `;`, `&` or a new line).
const GIT_COMMIT = /\bgit\b[^|;&\n]*\bcommit\b/
// A command that runs the plugin's script (split, adopt write...) may create or remove backlog files.
const RUNS_SCRIPT = /backlog\.mjs/

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // A skill or command of the same name may already hold /backlog: that must not stop the session.
    try {
      await $.command.register({
        name: 'backlog',
        description: 'Open the backlog panel; /backlog <audit|resume|plan|do|adopt|init|split> <request> runs the session skill',
      })
    } catch (err) {
      $.ui.log(`backlog: /backlog not registered: ${err instanceof Error ? err.message : String(err)}`)
    }
    // The session's own item comes back, orphans of this workspace are proposed, and the heartbeat starts.
    await restore($).catch(err => $.ui.log(`backlog: restore failed: ${err instanceof Error ? err.message : String(err)}`))
    $.clock.every(HEARTBEAT_MS, () => {
      heartbeat($).catch(err => $.ui.log(`backlog: heartbeat failed: ${err instanceof Error ? err.message : String(err)}`))
    })
    return next(e)
  })

  // At the end of a turn of the main loop: an item the model removed from its file is freed.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) await refreshActive($)
    return result
  })

  // The item stays when the session ends unfinished: it becomes an orphan the next session proposes.
  on('session.end', async ($, e, next) => {
    await refreshActive($)
    return next(e)
  })

  // Read guard: with an active item the prompt carries everything, so other backlogs stay closed. A failing guard lets the call through.
  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const deny = await readDenial($, e.file_path)
    return deny ? { deny } : next(e)
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'Grep' }, async ($, e, next) => {
    const deny = await readDenial($, e.path)
    return deny ? { deny } : next(e)
  }).catch(($, e, next) => next(e))

  // Check after an edit of a backlog file: new issues go back to the model as context, never as a refusal.
  on('tool.call', { tool: 'Edit' }, ($, e, next) => guardedEdit($, e.file_path, () => next(e))).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'Write' }, ($, e, next) => guardedEdit($, e.file_path, () => next(e))).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'NotebookEdit' }, ($, e, next) => guardedEdit($, e.notebook_path, () => next(e))).catch(($, e, next) => next(e))

  // Commit reminder: with an active item, a commit that does not cite its ID is pointed out afterwards.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const command = e.command ?? ''
    const own = GIT_COMMIT.test(command) ? await mineOf($) : null
    const before = own ? await headOf($, own) : null
    const result = await next(e)
    if (RUNS_SCRIPT.test(command)) await forgetFiles($)
    const text = own && result.result !== undefined ? await commitWarning($, own, before) : null
    return text ? { ...result, context: [...(result.context ?? []), text] } : result
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'backlog' }, async ($, e) => {
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
    if (!(await $.ui.panes()).some(pane => pane.id === PANE)) {
      await $.ui.open({ id: PANE, title: t(strings, 'title'), rows: 22, columns: 70, focus: true, closeOnEscape: true })
    }
    return { text: board.error ?? t(strings, board.filter ? 'openedFor' : 'opened', { n: board.items.length, filter: board.filter }) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => renderPane($, e))
}
