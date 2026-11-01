import type { Register } from 'claude-code'

import { PANE, load, startAt } from './lib/state'
import { HEARTBEAT_MS, heartbeat, refreshActive, restore } from './lib/session'
import { t } from './lib/strings'
import { renderPane } from './pane'

// Wiring only: events -> modules under hooks/lib and hooks/pane.tsx.
const MODES = ['audit', 'resume', 'plan', 'do', 'adopt', 'init', 'split']

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

  on('command.run', { command: 'backlog' }, async ($, e) => {
    const args = e.args.trim()
    const first = args.split(/\s+/)[0] ?? ''
    const mode = MODES.find(m => m === first.toLowerCase())
    if (mode) {
      // The host refuses a submit from inside a command.run hook (it would wait on its own turn): it goes out right after the hook returns.
      const text = `Use the backlog:session skill. Mode: ${mode}. Request: ${args.slice(first.length).trim()}`
      $.clock.after(0, () => $.prompt.submit({ text, asUser: true }))
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
