// `done`: removes a finished item (line and sub-lines) and moves the "Next" pointer that named it.

import { join } from 'node:path'
import { ItemNotFoundError } from '../errors.mjs'
import { buildGraph } from '../graph.mjs'
import { keywordRegexes } from '../i18n.mjs'
import { kwOf, projectItems, resolveId } from '../routing.mjs'
import { readText, writeText } from '../write.mjs'
import { keyOf, wsPath } from './shared.mjs'

const NEXT_NONE = '—'
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** First open, unblocked item of `file` in the freshly written workspace, or null. */
function firstUnblocked(ws, project, file) {
  const items = ws.projects.flatMap(projectItems)
  const graph = buildGraph(items)
  return items.find((x) => x.project === project.rel && x.file === file && x.open && x.id && graph.blockedBy(keyOf(x)).length === 0)?.id ?? null
}

/** Replaces the ID of the first "Next" line in place, keeping the keyword and the formatting around it. */
function pointNext(path, kw, id, next) {
  const re = keywordRegexes(kw).next
  const { lines, eol, bom } = readText(path)
  const at = lines.findIndex((l) => re.test(l))
  if (at < 0) return false
  lines[at] = lines[at].replace(re, (whole, found) => {
    if (found !== id) return whole
    const ticked = whole.endsWith('`')
    const body = whole.replace(new RegExp(`\`?${esc(found)}\`?$`), '')
    return next ? `${body}${ticked ? `\`${next}\`` : next}` : `${body}${NEXT_NONE}`
  })
  writeText(path, lines, eol, bom)
  return true
}

/**
 * @param {import('../workspace.mjs').Workspace} ws
 * @param {string} ref `ID` or `project:ID`
 * @returns {{ status: 'done', id: string, project: string, file: string, next: string|null, indexes: string[] }}
 * @throws {AmbiguousIdError|ItemNotFoundError}
 */
export function done(ws, ref) {
  const { project, item } = resolveId(ws, ref)
  if (!item) throw new ItemNotFoundError(ref)
  const kw = kwOf(project)
  const path = join(project.root, item.file)
  const { lines, eol, bom } = readText(path)
  let end = item.line + 1
  while (end < lines.length && /^\s+\S/.test(lines[end])) end++
  lines.splice(item.line, end - item.line)
  writeText(path, lines, eol, bom)

  const next = firstUnblocked(ws, project, item.file)
  const indexes = []
  for (const node of [project.tree.top, ...project.tree.nodes]) {
    if (node.next !== item.id || indexes.includes(wsPath(project, node.file))) continue
    if (pointNext(join(project.root, node.file), kw, item.id, next)) indexes.push(wsPath(project, node.file))
  }
  return { status: 'done', id: item.id, project: project.rel, file: wsPath(project, item.file), next, indexes }
}
