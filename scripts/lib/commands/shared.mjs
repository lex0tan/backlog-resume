// Helpers shared by the read commands: items of the whole workspace with their graph, dates and ages.

import { posix as ppath } from 'node:path'
import { lineAges } from '../git.mjs'
import { buildGraph } from '../graph.mjs'
import { timing, waitingOnUser } from '../model.mjs'
import { kwOf, projectItems } from '../routing.mjs'
import { posix } from '../text.mjs'

/** Today as YYYY-MM-DD in local time. */
export function todayIso() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Path of a project file relative to the workspace root (POSIX). */
export const wsPath = (project, file) => ppath.join(project.rel, posix(file))

/** Key of an item inside the graph and the lookup maps. */
export const keyOf = (item) => `${item.project}:${item.id}`

/**
 * Every item of every project (with `project` set to the project's `rel`), the dependency graph over them,
 * and per-item derived fields. Line ages (git blame) are computed lazily, once per file.
 * @param {import('../workspace.mjs').Workspace} ws
 * @param {string} today YYYY-MM-DD
 */
export function readContext(ws, today) {
  const projects = new Map(ws.projects.map((p) => [p.rel, p]))
  const items = ws.projects.flatMap(projectItems)
  const graph = buildGraph(items)
  const byKey = new Map()
  const byId = new Map()
  for (const it of items) {
    if (!it.id || byKey.has(keyOf(it))) continue
    byKey.set(keyOf(it), it)
    byId.set(it.id, [...(byId.get(it.id) ?? []), it])
  }
  const keywords = new Map()
  const kwFor = (project) => {
    if (!keywords.has(project.rel)) keywords.set(project.rel, kwOf(project))
    return keywords.get(project.rel)
  }
  const ages = new Map()
  const ageOf = (project, it) => {
    const id = `${project.rel}:${it.file}`
    if (!ages.has(id)) ages.set(id, lineAges(project.root, it.file, today))
    return ages.get(id).get(it.line) ?? 0
  }

  /** An item named by `ref` as seen from project `rel`: own project first, then the whole workspace if unique. */
  const find = (rel, ref) => {
    const own = byKey.get(`${rel}:${ref}`) ?? byKey.get(ref)
    if (own) return own
    const hits = byId.get(ref) ?? []
    return hits.length === 1 ? hits[0] : null
  }

  /** Fields every read command derives from an item: when, graph links, cycle, waiting and staleness. */
  const describe = (it) => {
    const project = projects.get(it.project)
    const key = keyOf(it)
    const when = timing(it.from, today, project.config.overdueDays)
    const { waiting, steps } = waitingOnUser(it, kwFor(project))
    let stale = null
    if (it.open && when?.state !== 'later') {
      const days = ageOf(project, it)
      if (days > project.config.staleDays) stale = { days }
    }
    return {
      when,
      blockedBy: graph.blockedBy(key),
      unblocks: graph.unblocks(key),
      cycle: graph.inCycle(key),
      waiting: it.open && waiting,
      steps,
      stale,
    }
  }

  return { ws, today, items, graph, projects, find, describe, kwFor }
}
