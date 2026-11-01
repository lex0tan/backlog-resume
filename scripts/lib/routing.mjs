// Three-level routing: which project, which workstream, which item a request is about, and which files to read.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, posix as ppath } from 'node:path'
import { identity } from './paths.mjs'
import { AmbiguousIdError, ItemNotFoundError } from './errors.mjs'
import { loadKeywords, message } from './i18n.mjs'
import { parseItems } from './model.mjs'
import { missingRefs } from './refs.mjs'
import { norm, posix } from './text.mjs'
import { allItems, ancestors, isAncestor, nodeForId, subprojectOf } from './tree.mjs'

const ITEM_ID = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3}$/
// An item ID ends in a number; a bare all-caps word or a workstream ID may still name a project.
const ITEM_ID_TOKEN = /(?:[A-Za-z0-9._-]+:)?\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+\b/g
const ID_TOKEN = /(?:([A-Za-z0-9._-]+):)?\b([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)\b/g

/** Name used to qualify IDs (`project:ID`) and reported in results: the folder relative to the workspace. */
export const projectKey = (p) => (p.rel === '.' ? p.name : p.rel)

const wsPath = (p, file) => ppath.join(p.rel, posix(file))
export const kwOf = (p) => loadKeywords(p.config.language, p.config.keywords)
const isFile = (path) => existsSync(path) && statSync(path).isFile()

export function projectItems(p) {
  if (p.indexMissing) return []
  return allItems(p.root, p.tree, kwOf(p)).map((it) => ({ ...it, project: p.rel }))
}

/** Projects named by `qualifier` (name, folder or alias, ignoring case). */
function named(ws, qualifier) {
  const q = norm(qualifier)
  return ws.projects.filter((p) => [p.name, p.rel, ...p.aliases].some((a) => norm(a) === q))
}

/** Everything in one project that an ID can point to: the item, and the workstream that holds it. */
function lookup(p, id, items = projectItems(p)) {
  if (p.indexMissing) return null
  const item = items.find((x) => x.id === id) ?? null
  const top = p.tree.top
  const node = nodeForId(p.tree, id) ?? (!top.container && id === top.id ? top : null)
    ?? (item ? p.tree.nodes.find((n) => n.id === item.node) ?? top : null)
  return item || node ? { project: p, item: item ?? undefined, node: node ?? undefined } : null
}

/**
 * Resolves `ID` or `project:ID`. A bare ID present in several projects is ambiguous.
 * @param {import('./workspace.mjs').Workspace} ws
 * @returns {{ project: import('./workspace.mjs').Project, item?: object, node?: object }}
 */
export function resolveId(ws, ref) {
  const m = ref.match(/^([^:\s]+):(.+)$/)
  const id = m ? m[2] : ref
  const qualifiers = m ? named(ws, m[1]) : []
  const pool = qualifiers.length ? qualifiers : ws.projects
  const hits = pool.map((p) => lookup(p, id)).filter(Boolean)
  if (hits.length === 0) throw new ItemNotFoundError(ref)
  if (hits.length > 1) throw new AmbiguousIdError(id, hits.map((h) => `${projectKey(h.project)}:${id}`))
  return hits[0]
}

/**
 * @param {import('./workspace.mjs').Workspace} ws
 * @param {string} query
 */
export function route(ws, query) {
  const kw = ws.kw
  const q = norm(query)
  const result = (extra) => ({ query, ...extra })
  const itemsCache = new Map()
  const itemsOf = (p) => {
    if (!itemsCache.has(p)) itemsCache.set(p, projectItems(p))
    return itemsCache.get(p)
  }
  const rootRules = () => (isFile(join(ws.root, 'CLAUDE.md')) ? [{ path: 'CLAUDE.md', why: message(kw, 'routeWhyRules') }] : [])
  const baseOf = (p) => {
    const out = []
    if (isFile(join(p.root, 'CLAUDE.md'))) out.push({ path: wsPath(p, 'CLAUDE.md'), why: message(kw, 'routeWhyRules') })
    out.push({ path: wsPath(p, p.tree.top.file), why: message(kw, 'routeWhyIndex') })
    return out
  }
  const qualified = (p, id) => (ws.projects.length > 1 ? `${projectKey(p)}:${id}` : id)
  const entry = (p, n) => ({ project: projectKey(p), id: n.id === 'ROOT' ? null : n.id, name: n.name, file: wsPath(p, n.file), ref: qualified(p, n.id) })

  // Several things match: one question, no backlog loaded beyond the base rules.
  const ask = (cands) => {
    const projects = new Set(cands.map((c) => c.p))
    return result({
      status: 'ambiguous',
      question: message(kw, 'routeQuestion', { candidates: cands.map((c) => `${qualified(c.p, c.node.id)} (${c.node.name})`).join(' / ') }),
      candidates: cands.map((c) => entry(c.p, c.node)),
      read: projects.size === 1 ? baseOf(cands[0].p) : rootRules(),
      excluded: [],
    })
  }

  // IDs are removed first: a project prefix inside an ID is not a mention of the project.
  const qWords = norm(query.replace(ITEM_ID_TOKEN, ' '))
  const mentioned = ws.projects.filter((p) => p.aliases.some((a) => qWords.includes(norm(a))))

  // 1. Explicit ID, optionally qualified or narrowed by a named project: wins over every alias.
  let explicit = null
  for (const [, qualifier, id] of query.matchAll(ID_TOKEN)) {
    const qualified2 = qualifier ? named(ws, qualifier) : []
    const pool = qualified2.length ? qualified2 : mentioned.length ? mentioned : ws.projects
    let hits = pool.map((p) => lookup(p, id, itemsOf(p))).filter(Boolean)
    if (!hits.length && pool !== ws.projects) hits = ws.projects.map((p) => lookup(p, id, itemsOf(p))).filter(Boolean)
    if (!hits.length) continue
    if (hits.length > 1) return ask(hits.map((h) => ({ p: h.project, node: { ...(h.node ?? h.project.tree.top), id, name: h.item?.text ?? h.node?.name ?? id } })))
    explicit = { id, ...hits[0] }
    break
  }

  // 2/3. Project named, then aliases of workstreams.
  const hitsIn = (p) => {
    const hits = new Map()
    for (const n of p.tree.nodes) {
      const matched = n.aliases.filter((a) => q.includes(norm(a)))
      if (matched.length) hits.set(n, matched)
    }
    return hits
  }
  const deepest = (list) => list.filter((n) => !list.some((o) => o !== n && isAncestor(n, o)))

  // What one project makes of the request: a target, a question, a missing workstream, or nothing.
  const scopeIn = (p) => {
    const tree = p.tree
    const hits = hitsIn(p)
    if (!hits.size) return { kind: 'none' }
    const subs = [...hits.keys()].filter((n) => n.subproject && n.parent === tree.top)
    if (subs.length > 1) return { kind: 'ask', cands: subs.map((node) => ({ p, node })) }
    if (subs.length === 1) {
      const sub = subs[0]
      const inner = deepest([...hits.keys()].filter((n) => isAncestor(sub, n)))
      const general = [...hits.keys()].filter((n) => n !== sub && !isAncestor(sub, n))
      if (!inner.length && general.length) {
        return { kind: 'missing', p, sub, wanted: general.flatMap((n) => hits.get(n)) }
      }
      if (inner.length > 1) return { kind: 'ask', cands: inner.map((node) => ({ p, node })) }
      const target = inner[0] ?? sub
      return { kind: 'target', p, target, reason: message(kw, 'routeAlias', { aliases: (hits.get(target) ?? []).join(', ') || message(kw, 'routeSubproject') }) }
    }
    const general = [...hits.keys()].filter((n) => !subprojectOf(n))
    const cands = deepest(general.length ? general : [...hits.keys()])
    if (cands.length > 1) return { kind: 'ask', cands: cands.map((node) => ({ p, node })) }
    return { kind: 'target', p, target: cands[0], reason: message(kw, 'routeAlias', { aliases: hits.get(cands[0]).join(', ') }) }
  }

  let target
  let project
  let reason
  if (explicit) {
    project = explicit.project
    target = explicit.node ?? project.tree.top
    reason = message(kw, 'routeExplicit', { id: explicit.id })
  } else {
    if (mentioned.length > 1) return ask(mentioned.map((p) => ({ p, node: { id: p.tree.top.id, name: p.name, file: p.tree.top.file } })))
    const outcomes = (mentioned.length ? mentioned : ws.projects).map(scopeIn).filter((o) => o.kind !== 'none')
    let chosen = outcomes.length === 1 ? outcomes[0] : null
    // A project that owns the named scope but lacks the asked workstream wins over plain alias hits elsewhere.
    const missingOne = outcomes.find((o) => o.kind === 'missing')
    if (missingOne) chosen = missingOne
    else if (outcomes.length > 1) {
      const cands = outcomes.flatMap((o) => (o.kind === 'ask' ? o.cands : o.kind === 'target' ? [{ p: o.p, node: o.target }] : []))
      if (cands.length > 1) return ask(cands)
      chosen = outcomes.find((o) => o.kind === 'target') ?? outcomes[0]
    }
    if (chosen?.kind === 'ask') return ask(chosen.cands)
    if (chosen?.kind === 'missing') {
      const { p, sub, wanted } = chosen
      return result({
        status: 'missing-workstream',
        project: projectKey(p),
        question: message(kw, 'routeMissingWorkstream', { sub: sub.id, wanted: wanted.join(', '), available: sub.children.map((c) => c.id).join(', ') }),
        available: sub.children.map((c) => ({ id: c.id, name: c.name, file: wsPath(p, c.file) })),
        read: baseOf(p),
        excluded: [],
      })
    }
    if (chosen) {
      ({ p: project, target, reason } = chosen)
    } else if (mentioned.length) {
      project = mentioned[0]
      target = project.tree.top
      reason = message(kw, 'routeProject', { project: projectKey(project) })
    } else if (ws.focus || ws.projects.length === 1) {
      project = ws.focus ?? ws.projects[0]
      target = project.tree.top
      reason = message(kw, 'routeGeneral')
    } else {
      return result({
        status: 'overview',
        reason: message(kw, 'routeOverview'),
        candidates: ws.projects.map((p) => entry(p, p.tree.top)),
        read: rootRules(),
        excluded: [],
      })
    }
  }

  const p = project
  const tree = p.tree
  const top = tree.top
  const idOf = (n) => (n === top && top.container ? null : n.id)

  // From an index, descend along "Next".
  let leaf = target
  const steps = []
  let itemId = explicit && ITEM_ID.test(explicit.id) ? explicit.id : null
  while (leaf.container) {
    const label = leaf === top ? leaf.file : leaf.id
    const nextNode = leaf.next ? nodeForId(tree, leaf.next) : null
    if (!nextNode || nextNode === leaf || !(isAncestor(leaf, nextNode) || leaf === top)) {
      steps.push(message(kw, 'routeNoNext', { id: label }))
      break
    }
    steps.push(message(kw, 'routeStep', { id: label, next: leaf.next }))
    itemId ??= ITEM_ID.test(leaf.next) ? leaf.next : null
    leaf = nextNode
  }
  // A flat project is one workstream: its "Next" is the item.
  if (!itemId && !top.container && leaf === top && top.next && ITEM_ID.test(top.next)) itemId = top.next

  const read = baseOf(p)
  if (p.indexMissing) {
    return result({ status: 'missing-file', project: projectKey(p), target: idOf(target), missingFiles: [{ id: top.id, file: wsPath(p, top.file) }], question: message(kw, 'routeMissingFile', { files: `${top.id} (${wsPath(p, top.file)})` }), read: [], excluded: [] })
  }
  const sub = subprojectOf(leaf)
  if (sub && isFile(join(p.root, ppath.dirname(posix(sub.file)), 'CLAUDE.md'))) {
    read.splice(read[0].path === wsPath(p, 'CLAUDE.md') ? 1 : 0, 0, { path: wsPath(p, ppath.join(ppath.dirname(posix(sub.file)), 'CLAUDE.md')), why: message(kw, 'routeWhySubRules', { id: sub.id }) })
  }
  const chain = [leaf, ...ancestors(leaf)].reverse().filter((n) => n !== top)
  const missingFiles = chain.filter((n) => !n.exists).map((n) => ({ id: n.id, file: wsPath(p, n.file) }))
  if (missingFiles.length) {
    return result({ status: 'missing-file', project: projectKey(p), target: idOf(target), missingFiles, question: message(kw, 'routeMissingFile', { files: missingFiles.map((m) => `${m.id} (${m.file})`).join(', ') }), read, excluded: [] })
  }
  for (const n of chain) read.push({ path: wsPath(p, n.file), why: message(kw, n.container ? 'routeWhyIndexOf' : 'routeWhyDetail', { id: n.id }) })

  // Items linked to the leaf's items, in both directions, across the whole workspace.
  const linked = []
  let missing = []
  if (!leaf.container) {
    const text = readFileSync(join(p.root, leaf.file), 'utf8')
    missing = missingRefs(p, ws, leaf.file, text)
    const own = parseItems(text, kwOf(p))
    const ownIds = new Set(own.map((i) => i.id))
    const everything = ws.projects.flatMap((q2) => itemsOf(q2).map((it) => ({ ...it, p: q2 })))
    // A reference is `ID` or `project:ID`; the qualifier names a project folder.
    const split = (ref) => { const m = ref.match(/^([^:\s]+):(.+)$/); return m ? { q: m[1], id: m[2] } : { q: null, id: ref } }
    const find = (ref) => {
      const { q, id } = split(ref)
      if (q) return everything.find((x) => x.id === id && projectKey(x.p) === q) ?? everything.find((x) => x.id === id && named(ws, q).includes(x.p))
      return everything.find((x) => x.id === id && x.p === p) ?? everything.find((x) => x.id === id)
    }
    const isOwn = (ref) => { const { q, id } = split(ref); return ownIds.has(id) && (!q || named(ws, q).includes(p)) }
    for (const it of own) {
      for (const id of [...it.deps, ...it.blocks]) {
        if (isOwn(id)) continue
        const other = find(id)
        linked.push({ from: it.id, id, file: other ? wsPath(other.p, other.file) : null, open: other ? other.open : null, text: other?.text ?? null })
      }
    }
    for (const other of everything) {
      if (other.p === p && identity(join(p.root, other.file)) === identity(join(p.root, leaf.file))) continue
      for (const id of [...other.blocks, ...other.deps]) {
        if (isOwn(id)) linked.push({ from: other.id, id, file: wsPath(other.p, other.file), open: other.open, text: other.text })
      }
    }
  }

  const readSet = new Set(read.map((r) => r.path))
  const excluded = [...new Set(ws.projects.filter((q2) => !q2.indexMissing).flatMap((q2) => [q2.tree.top, ...q2.tree.nodes]
    .filter((n) => n.exists && !(q2 === p && n === top))
    .map((n) => wsPath(q2, n.file))))].filter((f) => !readSet.has(f))
  const excludedBytes = excluded.reduce((s, f) => s + statSync(join(ws.root, f)).size, 0)
  return result({
    status: target === top && !explicit ? 'general' : 'ok',
    project: projectKey(p),
    target: idOf(target),
    leaf: idOf(leaf),
    item: itemId,
    reason,
    steps,
    read,
    excluded,
    excludedBytes,
    missingRefs: missing,
    linked,
  })
}
