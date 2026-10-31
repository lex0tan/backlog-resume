// Project tree: a flat TODO.md, an index of workstreams (nested indexes allowed), or an index with subprojects.

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { IndexNotFoundError } from './errors.mjs'
import { parseIndex, parseItems } from './model.mjs'
import { posix } from './text.mjs'

/** @typedef {{ id: string, name: string, file: string, status: string, block: string, aliases: string[],
 *   subproject: boolean, exists: boolean, container: boolean, next: string|null, parent: Node|null, children: Node[] }} Node */
/** @typedef {{ top: Node, nodes: Node[] }} Tree */

const isFile = (path) => existsSync(path) && statSync(path).isFile()
// File identity for the cycle guard: the real path of an existing file (case and links resolved by the OS),
// else the normalised absolute path.
const identity = (path) => (existsSync(path) ? realpathSync.native(path) : resolve(path))
const ID_PREFIX = /-\d{3}$/

/**
 * Tree of workstreams starting at `config.index`. A node whose file holds an index table is a container;
 * child paths are relative to the file that lists them. A flat project (no table) is a single workstream
 * whose id is the project prefix.
 * @returns {Tree}
 */
export function loadTree(projectRoot, kw, config) {
  const indexFile = config.index
  if (!isFile(join(projectRoot, indexFile))) throw new IndexNotFoundError(posix(join(projectRoot, indexFile)))
  const top = { id: 'ROOT', name: basename(projectRoot), file: indexFile, status: '', block: '', aliases: [], subproject: false, exists: true, container: false, next: null, parent: null, children: [] }
  const nodes = []
  const seen = new Set([identity(join(projectRoot, indexFile))])
  const visit = (node) => {
    const parsed = parseIndex(readFileSync(join(projectRoot, node.file), 'utf8'), kw)
    node.next = parsed.next
    for (const row of parsed.rows) {
      const file = posix(relative(projectRoot, resolve(projectRoot, dirname(node.file), row.file)))
      const child = {
        ...row,
        file,
        parent: node,
        children: [],
        subproject: row.subproject || node.subproject,
        exists: isFile(join(projectRoot, file)),
        container: false,
        next: null,
      }
      child.aliases = [...new Set([...child.aliases, child.id.toLowerCase()])]
      node.children.push(child)
      nodes.push(child)
      const key = child.exists ? identity(join(projectRoot, file)) : null
      if (child.exists && !seen.has(key)) {
        seen.add(key)
        visit(child)
      }
    }
    node.container = node.children.length > 0
  }
  visit(top)
  if (!top.container) {
    const items = parseItems(readFileSync(join(projectRoot, indexFile), 'utf8'), kw).map((item) => ({ ...item, file: indexFile }))
    top.id = projectPrefix({ top, nodes }, items, config, basename(projectRoot))
    top.aliases = [top.id.toLowerCase()]
  }
  return { top, nodes }
}

/** Detail nodes: those without children. A flat project is one workstream: the top node. */
export function leaves(tree) {
  return tree.top.container ? tree.nodes.filter((n) => !n.container) : [tree.top]
}

/**
 * Prefix of the project's IDs: `config.prefix`, else the most frequent ID prefix among the items of the index file,
 * else the folder name in upper case (only A-Z0-9, at most 4 characters).
 */
export function projectPrefix(tree, items, config, folderName) {
  if (config.prefix) return config.prefix
  const counts = new Map()
  for (const item of items) {
    if (!item.id || item.file !== tree.top.file) continue
    const prefix = item.id.replace(ID_PREFIX, '')
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1)
  }
  const best = [...counts].sort((a, b) => b[1] - a[1])[0]
  return best ? best[0] : folderName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)
}

/** Every item of every existing detail file, tagged with its file (posix, relative to the project) and workstream id. */
export function allItems(projectRoot, tree, kw) {
  return leaves(tree)
    .filter((node) => node.exists)
    .flatMap((node) => parseItems(readFileSync(join(projectRoot, node.file), 'utf8'), kw).map((item) => ({ ...item, file: node.file, node: node.id })))
}

export const ancestors = (node) => {
  const out = []
  for (let p = node.parent; p; p = p.parent) out.push(p)
  return out
}

export const isAncestor = (a, node) => ancestors(node).includes(a)

/** The top-level subproject node containing `node` (or `node` itself), or null. */
export const subprojectOf = (node) => [node, ...ancestors(node)].reverse().find((x) => x.subproject && x.parent?.parent === null) ?? null

/** Most specific node whose ID is a prefix of an item ID (SHOP-API-001 -> SHOP-API). */
export function nodeForId(tree, id) {
  return tree.nodes
    .filter((n) => id === n.id || id.startsWith(`${n.id}-`))
    .sort((a, b) => b.id.length - a.id.length)[0] ?? null
}
