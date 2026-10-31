// `item`: the state of one item, with the evidence found in git.

import { commitsFor, gitRoot, unmerged } from '../git.mjs'
import { ItemNotFoundError } from '../errors.mjs'
import { message } from '../i18n.mjs'
import { identity } from '../paths.mjs'
import { kwOf, resolveId } from '../routing.mjs'
import { readContext, todayIso, wsPath } from './shared.mjs'

const notFound = (ws, ref) => ({ id: ref, status: 'not-found', project: null, file: null, commits: [], unmerged: [], note: message(ws.kw, 'itemNothingFound') })

/** An ID that is no longer in any backlog: closed when a commit cites it. Searches each repository once. */
function unknownItem(ws, ref) {
  const id = ref.replace(/^[^:\s]+:/, '')
  const seen = new Set()
  for (const project of ws.projects) {
    const top = gitRoot(project.root)
    if (!top || seen.has(identity(top))) continue
    seen.add(identity(top))
    const commits = commitsFor(project.root, [id])
    if (commits.length) return { id, status: 'closed', project: project.rel, file: null, commits, unmerged: [], note: message(ws.kw, 'itemClosedWithCommits') }
  }
  return notFound(ws, id)
}

/**
 * @param {import('../workspace.mjs').Workspace} ws
 * @param {string} ref `ID` or `project:ID`
 * @param {string} [today]
 * @throws {AmbiguousIdError} a bare ID present in several projects
 */
export function item(ws, ref, today = todayIso()) {
  let hit
  try {
    hit = resolveId(ws, ref)
  } catch (err) {
    if (err instanceof ItemNotFoundError) return unknownItem(ws, ref)
    throw err
  }
  const { project, node } = hit
  const id = ref.replace(/^[^:\s]+:/, '')
  const kw = kwOf(project)

  if (!hit.item) {
    const commits = commitsFor(project.root, [id])
    const base = { id, project: project.rel, node: node?.id ?? null, file: node ? wsPath(project, node.file) : null, commits, unmerged: unmerged(project.root).get(id) ?? [] }
    return commits.length
      ? { ...base, status: 'closed', note: message(kw, 'itemClosedWithCommits') }
      : { ...base, status: 'not-found', note: message(kw, 'itemNothingFound') }
  }

  const ctx = readContext(ws, today)
  const it = ctx.items.find((x) => x.project === project.rel && x.id === id)
  const ids = [id, ...it.was]
  const commits = commitsFor(project.root, ids)
  const elsewhere = unmerged(project.root)
  const other = ids.flatMap((x) => elsewhere.get(x) ?? [])
  const d = ctx.describe(it)
  const blockers = d.blockedBy.map((ref2) => {
    const b = ctx.find(project.rel, ref2)
    return { id: ref2, project: b.project, file: wsPath(ctx.projects.get(b.project), b.file), text: b.text }
  })
  const branches = [...new Set(other.map((c) => c.branch))].join(', ')
  let note = null
  if (other.length) note = message(kw, 'itemUnmerged', { branches })
  else if (!it.open && !commits.length) note = message(kw, 'itemDeclaredDoneNoCommit')
  return {
    id,
    project: project.rel,
    status: it.open ? 'open' : 'declared-done',
    node: it.node,
    file: wsPath(project, it.file),
    text: it.text,
    type: it.type,
    doneWhen: it.doneWhen,
    deps: it.deps.map((dep) => ({ id: dep, open: ctx.find(project.rel, dep)?.open ?? null })),
    blocks: it.blocks,
    blockedBy: blockers,
    cycle: d.cycle,
    commits,
    parts: it.parts,
    unmerged: other,
    when: d.when,
    waiting: d.waiting,
    steps: d.steps,
    stale: d.stale,
    note,
  }
}
