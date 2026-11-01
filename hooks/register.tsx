import type { Register } from 'claude-code'

import { PANE } from './lib/state'
import { failOpen, onBash, onCommand, onEdit, onGrep, onNotebookEdit, onRead, onRenderPane, onRenderStatus, onSessionEnd, onSessionStart, onTurnComplete } from './lib/handlers'

// Wiring only: events -> handlers in hooks/lib/handlers.ts.
export const register: Register = on => {
  on('session.start', onSessionStart)
  on('turn.complete', onTurnComplete)
  on('session.end', onSessionEnd)
  on('tool.call', { tool: 'Read' }, onRead).catch(failOpen)
  on('tool.call', { tool: 'Grep' }, onGrep).catch(failOpen)
  on('tool.call', { tool: 'Edit' }, onEdit).catch(failOpen)
  on('tool.call', { tool: 'Write' }, onEdit).catch(failOpen)
  on('tool.call', { tool: 'NotebookEdit' }, onNotebookEdit).catch(failOpen)
  on('tool.call', { tool: 'Bash' }, onBash).catch(failOpen)
  on('command.run', { command: 'backlog-resume' }, onCommand)
  on('ui.render', { component: 'Pane', requestId: PANE }, onRenderPane)
  on('ui.render', { component: 'PromptHint' }, onRenderStatus).catch(failOpen)
}
