// `add`: appends a new item at the end of a detail workstream (or of a flat project's TODO.md).

import { join } from 'node:path'
import { InvalidInputError, WorkstreamNotFoundError } from '../errors.mjs'
import { formatItem } from '../model.mjs'
import { kwOf, projectItems } from '../routing.mjs'
import { leaves } from '../tree.mjs'
import { readText, writeText } from '../write.mjs'
import { wsPath } from './shared.mjs'

const TYPE = /^[\p{Ll}-]+$/u
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const same = (a, b) => a.toLowerCase() === b.toLowerCase()

function pickProject(ws, name) {
  if (!name) {
    const only = ws.projects.length === 1 ? ws.projects[0] : ws.focus
    if (!only) throw new InvalidInputError('project', 'required when the workspace has several projects')
    return only
  }
  const hits = ws.projects.filter((p) => [p.name, p.rel, ...p.aliases].some((a) => same(a, name)))
  if (hits.length !== 1) throw new InvalidInputError('project', hits.length ? `ambiguous: ${name}` : `unknown: ${name}`)
  return hits[0]
}

/**
 * @param {import('../workspace.mjs').Workspace} ws
 * @param {{ project?: string, workstream?: string, type: string, text: string, doneWhen?: string }} input
 * @returns {{ status: 'added', id: string, project: string, file: string }}
 */
export function add(ws, { project: projectName, workstream, type, text, doneWhen }) {
  const project = pickProject(ws, projectName)
  const kw = kwOf(project)
  if (!workstream && project.tree.top.container) throw new InvalidInputError('workstream', 'required for an indexed project')
  const node = workstream
    ? leaves(project.tree).find((n) => same(n.id, workstream) || n.aliases.some((a) => same(a, workstream)))
    : project.tree.top
  if (!node) throw new WorkstreamNotFoundError(workstream)
  if (!node.exists) throw new InvalidInputError('workstream', `${node.file} does not exist`)
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!TYPE.test(type ?? '')) throw new InvalidInputError('type', 'lowercase letters and hyphens only')
  if (!clean) throw new InvalidInputError('text', 'must not be empty')

  // Highest number among the project's items and the IDs kept in "Was:" lines, so a closed ID is never reused.
  const taken = new RegExp(`^${esc(node.id)}-(\\d{3,})$`)
  const nums = projectItems(project).flatMap((x) => [x.id, ...x.was]).map((id) => id?.match(taken)?.[1]).filter(Boolean).map(Number)
  const id = `${node.id}-${String(Math.max(0, ...nums) + 1).padStart(3, '0')}`

  const path = join(project.root, node.file)
  const { lines, eol, bom } = readText(path)
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
  lines.push(...formatItem({ id, type, text: clean, doneWhen: doneWhen?.trim() || undefined }, kw), '')
  writeText(path, lines, eol, bom)
  return { status: 'added', id, project: project.rel, file: wsPath(project, node.file) }
}
