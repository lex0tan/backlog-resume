// `list`: every project's workstreams with their open items, for the panel and for choosing what to do.

import { InvalidInputError } from '../errors.mjs'
import { unmerged } from '../git.mjs'
import { byWhen } from '../model.mjs'
import { norm, posix } from '../text.mjs'
import { ancestors, leaves, subprojectOf } from '../tree.mjs'
import { readContext, todayIso, wsPath } from './shared.mjs'

const ITEM_ID = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3}$/

/** Projects named by `wanted` (name, folder or alias, ignoring case and accents). */
function selectProjects(ws, wanted) {
  if (!wanted) return ws.projects
  const q = norm(wanted)
  const hits = ws.projects.filter((p) => [p.name, p.rel, ...p.aliases].some((a) => norm(a) === q))
  if (!hits.length) throw new InvalidInputError('project', `no project named "${wanted}"`)
  return hits
}

/** The item a workstream points to as its next one: an item ID of that workstream, taken from it or from an index above it. */
const nextOf = (node) => [node, ...ancestors(node)].map((a) => a.next).find((x) => x && ITEM_ID.test(x) && x.startsWith(`${node.id}-`)) ?? null

function listWorkstreams(ctx, project, elsewhere) {
  const { tree } = project
  const label = (n) => ancestors(n).filter((a) => a !== tree.top).reverse().map((a) => a.name).concat(n.name).join(' · ')
  // The area is the first level below the index: the panel's top-level grouping.
  const areaOf = (n) => [n, ...ancestors(n)].find((a) => a.parent === tree.top) ?? n
  return leaves(tree).map((n) => {
    const area = areaOf(n)
    // Items without an ID cannot be picked or referenced, so they are not listed.
    const items = ctx.items
      .filter((x) => x.project === project.rel && x.file === n.file && x.open && x.id)
      .map((x) => ({
        id: x.id,
        project: project.rel,
        type: x.type,
        workstream: n.id,
        text: x.text.replace(/\*\*|`/g, ''),
        doneWhen: x.doneWhen,
        parts: x.parts,
        unmerged: elsewhere.get(x.id) ?? [],
        ...ctx.describe(x),
      }))
      .sort(byWhen)
    return {
      id: n.id,
      label: label(n),
      file: wsPath(project, n.file),
      exists: n.exists,
      status: n.status,
      block: n.block,
      area: { id: area.id, name: area.name, subproject: area.subproject },
      subproject: subprojectOf(n)?.id ?? null,
      next: nextOf(n),
      items,
    }
  })
}

/**
 * @param {import('../workspace.mjs').Workspace} ws
 * @param {string} [today]
 * @param {{ project?: string }} [options] limit to one project (name, folder or alias)
 */
export function list(ws, today = todayIso(), { project } = {}) {
  const ctx = readContext(ws, today)
  const projects = selectProjects(ws, project).map((p) => {
    const workstreams = p.indexMissing ? [] : listWorkstreams(ctx, p, unmerged(p.root))
    const due = workstreams.flatMap((w) => w.items).filter((x) => x.when && x.when.state !== 'later').sort(byWhen).map((x) => x.id)
    return { rel: p.rel, name: p.name, next: p.tree.top.next, due, workstreams }
  })
  const configured = ws.config.typeOrder
  const typeOrder = configured.length ? configured : [...new Set(projects.flatMap((p) => p.workstreams.flatMap((w) => w.items.map((i) => i.type))))]
  return {
    status: 'ok',
    language: ws.kw.language,
    root: posix(ws.root),
    workspace: ws.root.replace(/[\\/]+$/, '').split(/[\\/]/).pop(),
    focus: ws.focus?.rel ?? null,
    typeOrder,
    settings: { lockMinutes: ws.config.lockMinutes, staleDays: ws.config.staleDays },
    projects,
  }
}
