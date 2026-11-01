import type { EngineInterface, Register } from 'claude-code'

import { PANE, load, startAt } from './lib/state'
import { readDenial } from './lib/guards'
import { modeRun } from './lib/modes'
import { HEARTBEAT_MS, refreshActive } from './lib/session'
import { t } from './lib/strings'
import { beat, bashAround, editAround, note, restoreSession } from './lib/handlers'
import { renderPane } from './pane'
import { renderStatus } from './status'

const MODES = ['audit', 'resume', 'plan', 'do', 'adopt', 'init', 'split']

// The modules under hooks/lib, hooks/pane.tsx and hooks/status.tsx never see the hook context itself: they get this adapter,
// whose every member is one plain call on it, so that every capability the plugin uses is written out here.
function ioOf($: EngineInterface): EngineInterface {
  const io = {
    clock: {
      after: (ms: number, fn: () => void) => $.clock.after(ms, fn),
      every: (ms: number, fn: () => void) => $.clock.every(ms, fn),
    },
    fs: {
      exists: (path: string) => $.fs.exists(path),
      read: (path: string, init: { as: 'text' }) => $.fs.read(path, init),
    },
    plugin: { root: $.plugin.root },
    process: {
      run: (argv: readonly string[], init?: { timeoutMs?: number }) => $.process.run(argv, init),
    },
    prompt: {
      submit: (request: { text: string; asUser?: boolean }) => $.prompt.submit(request),
    },
    session: {
      cwd: () => $.session.cwd(),
      id: () => $.session.id(),
      surfaces: () => $.session.surfaces(),
    },
    state: {
      // A state reference is written out literally at each call, so that the values the plugin reads and writes can be listed.
      get: (ref: { key: string }): Promise<unknown> => {
        switch (ref.key) {
        case 'board':
          return $.state.get({ plugin: 'backlog-resume', key: 'board' })
        case 'view':
          return $.state.get({ plugin: 'backlog-resume', key: 'view' })
        case 'strings':
          return $.state.get({ plugin: 'backlog-resume', key: 'strings' })
        case 'active':
          return $.state.get({ plugin: 'backlog-resume', key: 'active' })
        case 'finished':
          return $.state.get({ plugin: 'backlog-resume', key: 'finished' })
        case 'line':
          return $.state.get({ plugin: 'backlog-resume', key: 'line' })
        case 'files':
          return $.state.get({ plugin: 'backlog-resume', key: 'files' })
        }
        throw new Error(`backlog: unknown state key ${ref.key}`)
      },
      set: (ref: { key: string }, value: any, options?: any): Promise<unknown> => {
        switch (ref.key) {
        case 'board':
          return $.state.set({ plugin: 'backlog-resume', key: 'board' }, value, options)
        case 'view':
          return $.state.set({ plugin: 'backlog-resume', key: 'view' }, value, options)
        case 'strings':
          return $.state.set({ plugin: 'backlog-resume', key: 'strings' }, value, options)
        case 'active':
          return $.state.set({ plugin: 'backlog-resume', key: 'active' }, value, options)
        case 'finished':
          return $.state.set({ plugin: 'backlog-resume', key: 'finished' }, value, options)
        case 'line':
          return $.state.set({ plugin: 'backlog-resume', key: 'line' }, value, options)
        case 'files':
          return $.state.set({ plugin: 'backlog-resume', key: 'files' }, value, options)
        }
        throw new Error(`backlog: unknown state key ${ref.key}`)
      },
    },
    store: {
      delete: (key: string) => $.store.delete(key),
      get: (key: string) => $.store.get(key),
      keys: () => $.store.keys(),
      set: (key: string, value: never) => $.store.set(key, value),
    },
    ui: {
      close: (target: { id: string }) => $.ui.close(target),
      log: (text: string) => $.ui.log(text),
      open: (pane: never) => $.ui.open(pane),
      panes: () => $.ui.panes(),
      resolve: (event: never) => $.ui.resolve(event),
      status: (text: string | undefined) => $.ui.status(text),
      toast: (text: string, options?: { timeoutMs?: number }) => $.ui.toast(text, options),
    },
  }
  return io as unknown as EngineInterface
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // A skill or command of the same name may already hold /backlog-resume: that must not stop the session.
    try {
      await $.command.register({
        name: 'backlog-resume',
        description: 'Open the backlog panel; /backlog-resume <audit|resume|plan|do|adopt|init|split> <request> runs the session skill',
      })
    } catch (err) {
      note(ioOf($), '/backlog-resume not registered', err)
    }
    await restoreSession(ioOf($))
    $.clock.every(HEARTBEAT_MS, () => {
      void beat(ioOf($))
    })
    return next(e)
  })

  // At the end of a turn of the main loop: an item the model removed from its file is freed.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) await refreshActive(ioOf($))
    return result
  })

  // The item stays when the session ends unfinished: it becomes an orphan the next session proposes.
  on('session.end', async ($, e, next) => {
    await refreshActive(ioOf($))
    return next(e)
  })

  // Read guard: with an active item the prompt carries everything, so other backlogs stay closed. A failing guard lets the call through.
  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const deny = await readDenial(ioOf($), e.file_path)
    return deny ? { deny } : next(e)
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'Grep' }, async ($, e, next) => {
    const deny = await readDenial(ioOf($), e.path)
    return deny ? { deny } : next(e)
  }).catch(($, e, next) => next(e))

  // Check after an edit of a backlog file: new issues go back to the model as context, never as a refusal.
  // The status line follows the edit at once: a part ticked moves the bar, the item removed closes it.
  on('tool.call', { tool: 'Edit' }, ($, e, next) => editAround(ioOf($), e.file_path, () => next(e), true)).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'Write' }, ($, e, next) => editAround(ioOf($), e.file_path, () => next(e), true)).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'NotebookEdit' }, ($, e, next) => editAround(ioOf($), e.notebook_path, () => next(e), false)).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Bash' }, ($, e, next) => bashAround(ioOf($), e, () => next(e))).catch(($, e, next) => next(e))

  on('command.run', { command: 'backlog-resume' }, async ($, e) => {
    const args = e.args.trim()
    const first = args.split(/\s+/)[0] ?? ''
    const mode = MODES.find(m => m === first.toLowerCase())
    if (mode) {
      const run = await modeRun(ioOf($), mode, args.slice(first.length).trim())
      if ('refused' in run) return { text: run.refused }
      // The host refuses a submit from inside a command.run hook (it would wait on its own turn): it goes out right after the hook returns.
      $.clock.after(0, () => $.prompt.submit({ text: run.text, asUser: true }))
      return { text: `backlog: ${mode}` }
    }
    const { board, strings } = await load(ioOf($), args)
    await startAt(ioOf($), board)
    const panes = await $.ui.panes()
    if (!panes.some(pane => pane.id === PANE)) {
      await $.ui.open({ id: PANE, title: t(strings, 'title'), rows: 22, columns: 70, focus: true, closeOnEscape: true })
    }
    return { text: board.error ?? t(strings, board.filter ? 'openedFor' : 'opened', { n: board.items.length, filter: board.filter }) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => renderPane(ioOf($), e))
  on('ui.render', { component: 'PromptHint' }, ($, e, next) => renderStatus(ioOf($), e, next as never)).catch(($, e, next) => next(e))
}
