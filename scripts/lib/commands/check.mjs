// `check`: consistency of every backlog in the workspace. Errors break the model (duplicate IDs, cycles, missing
// files); warnings and infos are things to look at. `fast` skips everything that calls git.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { InvalidInputError } from '../errors.mjs'
import { lastModified } from '../git.mjs'
import { message } from '../i18n.mjs'
import { missingRefs } from '../refs.mjs'
import { kwOf } from '../routing.mjs'
import { leaves } from '../tree.mjs'
import { keyOf, readContext, todayIso, wsPath } from './shared.mjs'
import { overview } from './overview.mjs'

const ITEM_ID = /-\d{3}$/
const relOf = (key) => key.slice(0, key.indexOf(':'))

/**
 * @param {import('../workspace.mjs').Workspace} ws
 * @param {{ project?: string, fast?: boolean, today?: string }} [options] `project`: folder or name; only its issues are
 *   reported (duplicates, cycles and ambiguous links that involve it included).
 * @returns {{ status: 'ok'|'error', issues: { level: 'error'|'warn'|'info', code: string, project: string|null, file: string|null, message: string, ids?: string[] }[], files: object[] }}
 */
export function check(ws, { project, fast = false, today = todayIso() } = {}) {
  const only = project == null ? null : ws.projects.find((p) => [p.rel, p.name].some((n) => n.toLowerCase() === project.toLowerCase()))
  if (project != null && !only) throw new InvalidInputError('project', `unknown project "${project}"`)

  const ctx = readContext(ws, today)
  const entries = [] // { issue, rels }: rels = projects the issue concerns, for the `project` filter
  const add = (level, code, rels, file, text, ids) => {
    const issue = { level, code, project: rels[0] ?? null, file, message: text }
    if (ids) issue.ids = ids
    entries.push({ issue, rels })
  }
  const projectByRel = new Map(ws.projects.map((p) => [p.rel, p]))
  const fileOf = (it) => wsPath(projectByRel.get(it.project), it.file)

  for (const p of ws.projects) {
    const kw = kwOf(p)
    if (p.indexMissing) {
      const file = wsPath(p, p.config.index)
      add('error', 'missing-index', [p.rel], file, message(kw, 'checkMissingIndex', { file }))
      continue
    }
    const { top, nodes } = p.tree
    const own = ctx.items.filter((it) => it.project === p.rel)
    for (const n of nodes.filter((x) => !x.exists)) {
      add('error', 'missing-file', [p.rel], wsPath(p, n.file), message(kw, 'checkMissingFile', { id: n.id, file: n.file }))
    }
    for (const n of [top, ...nodes].filter((x) => x.exists && (x === top || x.container) && x.next)) {
      const valid = ITEM_ID.test(n.next) ? own.some((i) => i.id === n.next && i.open) : nodes.some((x) => x.id === n.next)
      if (!valid) add('warn', 'stale-next', [p.rel], wsPath(p, n.file), message(kw, 'checkStaleNext', { id: n.next }))
    }
    for (const it of own) {
      const file = fileOf(it)
      if (!it.id) {
        add('warn', 'no-id', [p.rel], file, message(kw, 'checkNoId', { text: it.text.slice(0, 60) }))
        continue
      }
      if (top.container && !it.id.startsWith(`${it.node}-`)) {
        add('warn', 'wrong-workstream', [p.rel], file, message(kw, 'checkWrongWorkstream', { id: it.id, node: it.node }), [it.id])
      }
      if (!it.open) add('warn', 'declared-done', [p.rel], file, message(kw, 'checkDeclaredDone', { id: it.id }), [it.id])
      else if (!it.doneWhen) add('warn', 'no-done-when', [p.rel], file, message(kw, 'checkNoDoneWhen', { id: it.id, doneWhen: kw.doneWhen }), [it.id])
      if (!fast && it.open) {
        const { stale } = ctx.describe(it)
        if (stale) add('warn', 'stale-item', [p.rel], file, message(kw, 'checkStale', { id: it.id, days: stale.days, from: kw.from }), [it.id])
      }
    }
    if (!fast) {
      for (const n of leaves(p.tree).filter((x) => x.exists)) {
        const refs = missingRefs(p, ws, n.file, readFileSync(join(p.root, n.file), 'utf8'))
        for (const ref of refs) add('info', 'missing-ref', [p.rel], wsPath(p, n.file), message(kw, 'checkMissingRef', { id: n.id, ref }), [n.id])
      }
    }
  }

  // Links the graph could not resolve: it knows which project a bare ID resolves to.
  const seenLinks = new Set()
  for (const { from, ref, reason } of ctx.graph.unresolved) {
    const rel = relOf(from)
    const it = ctx.items.find((x) => keyOf(x) === from)
    const key = `${from}>${ref}`
    if (seenLinks.has(key) || !projectByRel.has(rel)) continue
    seenLinks.add(key)
    const kw = kwOf(projectByRel.get(rel))
    if (reason === 'missing') {
      add('info', 'dangling-link', [rel], fileOf(it), message(kw, 'checkDanglingLink', { id: it.id, ref }), [it.id])
    } else {
      const matches = ctx.items.filter((x) => x.id === ref).map(keyOf)
      add('error', 'ambiguous-link', [rel, ...matches.map(relOf)], fileOf(it),
        message(kw, 'checkAmbiguousLink', { id: it.id, ref, matches: matches.join(', ') }), [it.id, ref])
    }
  }

  // The same ID in two places, anywhere in the workspace.
  const byId = new Map()
  for (const it of ctx.items.filter((x) => x.id)) byId.set(it.id, [...(byId.get(it.id) ?? []), it])
  for (const [id, group] of byId) {
    if (group.length < 2) continue
    const files = [...new Set(group.map(fileOf))]
    add('error', 'duplicate-id', [...new Set(group.map((x) => x.project))], files[0], message(ws.kw, 'checkDuplicateId', { id, files: files.join(', ') }), [id])
  }

  // Cycles: one issue per chain, owned by the project of its first element.
  const chains = new Map()
  for (const it of ctx.items.filter((x) => x.id && x.open)) {
    const chain = ctx.graph.inCycle(keyOf(it))
    if (!chain) continue
    const id = chain.join('>')
    if (!chains.has(id)) chains.set(id, { chain, items: [] })
    chains.get(id).items.push(it)
  }
  for (const { chain, items } of chains.values()) {
    const first = items.filter((x) => x.id === chain[0]).sort((a, b) => (a.project < b.project ? -1 : 1))[0]
    add('error', 'dependency-cycle', [first.project, ...new Set(items.map((x) => x.project))], fileOf(first),
      message(ws.kw, 'checkCycle', { chain: chain.join(' → ') }), chain.slice(0, -1))
  }

  const ov = overview(ws)
  if (!['off', 'current'].includes(ov.status)) add('warn', `overview-${ov.status}`, [], ov.path, ov.message)

  const kept = entries.filter((e) => !only || e.rels.includes(only.rel)).map((e) => e.issue)
  const files = ws.projects
    .filter((p) => !p.indexMissing && (!only || p === only))
    .flatMap((p) => [p.tree.top, ...p.tree.nodes].filter((n) => n.exists).map((n) => ({
      project: p.rel, id: n.id, file: wsPath(p, n.file), status: n.status || null,
      lastModified: fast ? null : lastModified(p.root, n.file),
    })))
  return { status: kept.some((i) => i.level === 'error') ? 'error' : 'ok', issues: kept, files }
}
