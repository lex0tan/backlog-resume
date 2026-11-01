// `summary`: one line of numbers per project, for `/nextup` without a scope.

import { gitState } from '../git.mjs'
import { byWhen } from '../model.mjs'
import { discover } from '../workspace.mjs'
import { readContext, todayIso } from './shared.mjs'

/**
 * @param {import('../workspace.mjs').Workspace} ws
 * @param {string} [today]
 */
export function summary(ws, today = todayIso()) {
  const ctx = readContext(ws, today)
  const projects = ws.projects.map((p) => {
    const open = ctx.items.filter((x) => x.project === p.rel && x.open)
    const described = open.map((x) => ({ item: x, ...ctx.describe(x, { stale: false }) }))
    const withState = (state) => described.filter((d) => d.item.id && d.when?.state === state).sort(byWhen).map((d) => d.item.id)
    const chains = new Set(described.map((d) => d.cycle).filter(Boolean).map((chain) => chain.join('>')))
    const state = p.indexMissing ? null : gitState(p, p.tree, ws.root)
    return {
      rel: p.rel,
      name: p.name,
      git: state && state.status !== 'no-git' ? state.status : null,
      next: p.tree.top.next,
      open: open.length,
      overdue: withState('overdue'),
      due: withState('due'),
      waiting: described.filter((d) => d.waiting).length,
      cycles: chains.size,
    }
  })
  return { status: 'ok', projects, candidates: discover(ws.root, ws.config, ws.kw).candidates }
}
