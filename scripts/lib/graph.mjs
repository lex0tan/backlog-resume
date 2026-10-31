// Dependency graph over open items of the whole workspace, with cycle detection (Tarjan SCC).

/** @typedef {{ blockedBy(key: string): string[], unblocks(key: string): string[], cycles: string[][],
 *   inCycle(key: string): string[]|null, unresolved: { from: string, ref: string, reason: 'ambiguous'|'missing' }[] }} Graph */

const keyOf = (project, id) => `${project}:${id}`

/**
 * @param {Array<{ id: string|null, open: boolean, deps: string[], blocks: string[], project: string }>} items
 * @returns {Graph}
 */
export function buildGraph(items) {
  const byKey = new Map()
  const byId = new Map()
  for (const it of items) {
    if (!it.id) continue
    const key = keyOf(it.project, it.id)
    if (byKey.has(key)) continue
    byKey.set(key, it)
    if (!byId.has(it.id)) byId.set(it.id, [])
    byId.get(it.id).push(key)
  }

  const resolveFrom = (project, ref) => {
    const own = keyOf(project, ref)
    if (byKey.has(own)) return { key: own }
    if (byKey.has(ref)) return { key: ref }
    const hits = byId.get(ref) ?? []
    if (hits.length === 1) return { key: hits[0] }
    return { reason: hits.length ? 'ambiguous' : 'missing' }
  }

  const out = new Map() // key -> Set of keys it depends on (A -> B: A waits for B)
  const inn = new Map()
  const unresolved = []
  const edge = (a, b) => {
    if (!out.has(a)) out.set(a, new Set())
    if (!inn.has(b)) inn.set(b, new Set())
    out.get(a).add(b)
    inn.get(b).add(a)
  }
  for (const [key, it] of byKey) {
    for (const [refs, forward] of [[it.deps, true], [it.blocks, false]]) {
      for (const ref of refs) {
        const r = resolveFrom(it.project, ref)
        if (!r.key) { unresolved.push({ from: key, ref, reason: r.reason }); continue }
        const target = byKey.get(r.key)
        if (!it.open || !target.open) continue
        if (forward) edge(key, r.key)
        else edge(r.key, key)
      }
    }
  }

  const bare = (key) => key.slice(key.indexOf(':') + 1)
  const projectOf = (key) => key.slice(0, key.indexOf(':'))
  const rel = (from, key) => (projectOf(key) === projectOf(from) ? bare(key) : key)
  const resolveQuery = (q) => {
    if (byKey.has(q)) return q
    const hits = byId.get(q) ?? []
    return hits.length === 1 ? hits[0] : null
  }
  const list = (map) => (q) => {
    const key = resolveQuery(q)
    if (!key) return []
    return [...(map.get(key) ?? [])].sort().map((k) => rel(key, k))
  }

  // Tarjan strongly connected components
  const index = new Map(), low = new Map(), onStack = new Set(), stack = []
  const sccs = []
  let counter = 0
  const strong = (v) => {
    index.set(v, counter); low.set(v, counter); counter++
    stack.push(v); onStack.add(v)
    for (const w of [...(out.get(v) ?? [])].sort()) {
      if (!index.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))) }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)))
    }
    if (low.get(v) === index.get(v)) {
      const comp = []
      let w
      do { w = stack.pop(); onStack.delete(w); comp.push(w) } while (w !== v)
      if (comp.length > 1 || out.get(v)?.has(v)) sccs.push(comp)
    }
  }
  for (const k of [...byKey.keys()].sort()) if (!index.has(k)) strong(k)

  const startOrder = (a, b) => (bare(a) < bare(b) ? -1 : bare(a) > bare(b) ? 1 : projectOf(a) < projectOf(b) ? -1 : projectOf(a) > projectOf(b) ? 1 : 0)
  const chains = []
  const cycleOf = new Map()
  for (const comp of sccs) {
    const members = new Set(comp)
    const start = [...comp].sort(startOrder)[0]
    // shortest closed walk through start, inside the component (BFS, sorted for determinism)
    const prev = new Map([[start, null]])
    const queue = [start]
    let closing = null
    for (let i = 0; i < queue.length && !closing; i++) {
      const v = queue[i]
      for (const w of [...(out.get(v) ?? [])].sort()) {
        if (!members.has(w)) continue
        if (w === start) { closing = v; break }
        if (!prev.has(w)) { prev.set(w, v); queue.push(w) }
      }
    }
    const path = []
    for (let v = closing; v !== null; v = prev.get(v)) path.unshift(v)
    const chain = [...path, start].map((k) => rel(start, k))
    chains.push({ start, chain })
    for (const k of comp) cycleOf.set(k, chain)
  }
  chains.sort((a, b) => startOrder(a.start, b.start))

  return {
    blockedBy: list(out),
    unblocks: list(inn),
    cycles: chains.map((c) => c.chain),
    inCycle: (q) => {
      const key = resolveQuery(q)
      return key ? cycleOf.get(key) ?? null : null
    },
    unresolved,
  }
}
