// `split`: turns a flat project (one TODO.md full of items) into an index plus one file per workstream.
// Items are renumbered `<workstream>-NNN`, keep their old ID in a `Was:` line, and every `Depends on` / `Blocks` /
// `Next` in the workspace that cited an old ID is rewritten. Claude decides the plan; this module applies it.

import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { InvalidInputError } from '../errors.mjs'
import { keywordRegexes, message } from '../i18n.mjs'
import { projectKey, kwOf, projectItems } from '../routing.mjs'
import { posix, joinLines } from '../text.mjs'
import { readText, writeText } from '../write.mjs'
import { pickProject } from './shared.mjs'

const WORKSTREAM_ID = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/
const REF = /(?:([A-Za-z0-9._/-]+):)?\b([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3})\b/g
const PART = /^\s+- \[[ xX]\]/
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const isFile = (path) => existsSync(path) && statSync(path).isFile()

/** Checks the shape of the plan and returns its workstreams. */
function validatePlan(plan, project) {
  const list = plan?.workstreams
  if (!Array.isArray(list) || !list.length) throw new InvalidInputError('plan', 'needs at least one workstream')
  const ids = new Set()
  const files = new Set([project.config.index.toLowerCase()])
  for (const w of list) {
    if (!WORKSTREAM_ID.test(w?.id ?? '')) throw new InvalidInputError('plan', `workstream id "${w?.id}" must be upper case letters, digits and hyphens`)
    if (!String(w.name ?? '').trim()) throw new InvalidInputError('plan', `workstream ${w.id} needs a name`)
    const file = posix(String(w.file ?? ''))
    if (!file || isAbsolute(file) || file.split('/').includes('..')) throw new InvalidInputError('plan', `workstream ${w.id}: file must be a relative path inside the project`)
    if (ids.has(w.id)) throw new InvalidInputError('plan', `workstream ${w.id} is listed twice`)
    if (files.has(file.toLowerCase())) throw new InvalidInputError('plan', `workstream ${w.id}: file ${file} is already used`)
    if (isFile(join(project.root, file))) throw new InvalidInputError('plan', `workstream ${w.id}: file ${file} already exists`)
    if (!Array.isArray(w.items) || !w.items.length) throw new InvalidInputError('plan', `workstream ${w.id} has no items`)
    ids.add(w.id)
    files.add(file.toLowerCase())
  }
  return list
}

/**
 * @param {import('../workspace.mjs').Workspace} ws
 * @param {string} projectName folder, name or alias of the flat project
 * @param {{ workstreams: { id: string, name: string, file: string, aliases?: string[], items: string[] }[] }} plan
 * @param {{ dryRun?: boolean }} [options]
 * @returns {{ status: 'split'|'preview', files: { path: string, text: string }[], renamed: Record<string, string> }}
 */
export function split(ws, projectName, plan, { dryRun = false } = {}) {
  const project = pickProject(ws, projectName)
  if (project.indexMissing) throw new InvalidInputError('project', `${project.rel} has no ${project.config.index}`)
  if (project.tree.top.container) throw new InvalidInputError('project', `${project.rel} already has an index of workstreams`)
  const kw = kwOf(project)
  const re = keywordRegexes(kw)
  const workstreams = validatePlan(plan, project)

  const index = project.tree.top.file
  const src = readText(join(project.root, index))
  const items = projectItems(project).filter((it) => it.file === index)
  if (items.some((it) => !it.id)) throw new InvalidInputError('project', 'items without an ID cannot be split: give them an ID first')
  const byId = new Map(items.map((it) => [it.id, it]))
  const planned = workstreams.flatMap((w) => w.items)
  const unknown = planned.filter((id) => !byId.has(id))
  if (unknown.length) throw new InvalidInputError('plan', `unknown items: ${unknown.join(', ')}`)
  const dupes = planned.filter((id, i) => planned.indexOf(id) !== i)
  if (dupes.length) throw new InvalidInputError('plan', `items listed more than once: ${[...new Set(dupes)].join(', ')}`)
  const left = items.filter((it) => !planned.includes(it.id)).map((it) => it.id)
  if (left.length) throw new InvalidInputError('plan', `items not in the plan: ${left.join(', ')}`)

  // New IDs in plan order, and the line range of each item (its line plus the indented lines under it).
  const renamed = {}
  for (const w of workstreams) w.items.forEach((old, i) => { renamed[old] = `${w.id}-${String(i + 1).padStart(3, '0')}` })
  const blockEnd = (it) => {
    let end = it.line + 1
    while (end < src.lines.length && /^\s+\S/.test(src.lines[end])) end++
    return end
  }

  // References: lines that cite IDs. A qualified reference counts only when the qualifier names this project.
  const mine = new Set([project.name, project.rel, projectKey(project), ...project.aliases].map((n) => n.toLowerCase()))
  // A bare reference in another project resolves to its own item first (as in the graph): leave it then.
  const rewrite = (lines, fileKw, ownIds = null) => {
    const keys = [fileKw.dependsOn, fileKw.blocks, fileKw.next].map(esc).join('|')
    const cites = new RegExp(`^\\s*(?:[-*>]\\s+)?(?:${keys}):`)
    return lines.map((line) => (!cites.test(line) ? line : line.replace(REF, (all, q, id) => {
      if (!renamed[id] || (q && !mine.has(q.toLowerCase())) || (!q && ownIds?.has(id))) return all
      return `${q ? `${q}:` : ''}${renamed[id]}`
    })))
  }

  const moved = (it, newId) => {
    const block = src.lines.slice(it.line, blockEnd(it))
    block[0] = block[0].replace(`[${it.id}]`, `[${newId}]`)
    const body = block.slice(1).filter((l) => !re.was.test(l.trim().replace(/^- /, '')))
    const indent = body[0]?.match(/^\s*/)[0] || '  '
    const at = body.findIndex((l) => PART.test(l))
    body.splice(at < 0 ? body.length : at, 0, `${indent}${kw.was}: ${[it.id, ...it.was].join(', ')}`)
    return [block[0], ...body]
  }

  const written = [] // { path (absolute), lines, eol, bom, isNew }
  const sorted = [...items].sort((a, b) => b.line - a.line)
  const rest = [...src.lines]
  for (const it of sorted) rest.splice(it.line, blockEnd(it) - it.line)
  while (rest.length && rest[rest.length - 1].trim() === '') rest.pop()
  const cols = kw.columns
  const table = (rows) => [`| ${[cols.id, cols.name, cols.file, cols.status, cols.block, cols.alias].join(' | ')} |`, '|---|---|---|---|---|---|', ...rows]
  const indexLines = [
    ...rest.filter((l, i) => l.trim() || rest[i - 1]?.trim()),
    '', `## ${message(kw, 'splitWorkstreams')}`, '',
    ...table(workstreams.map((w) => `| \`${w.id}\` | ${w.name.replace(/\|/g, '/')} | \`${posix(w.file)}\` | — | — | ${(w.aliases ?? []).join(', ') || '—'} |`)),
    '',
  ]
  written.push({ path: join(project.root, index), lines: rewrite(indexLines, kw), eol: src.eol, bom: src.bom, isNew: false })
  for (const w of workstreams) {
    const lines = [`# ${w.name}`, '', ...w.items.flatMap((old) => moved(byId.get(old), renamed[old])), '']
    written.push({ path: join(project.root, w.file), lines: rewrite(lines, kw), eol: src.eol, bom: src.bom, isNew: true })
  }

  // Every other backlog file of the workspace that cites a renamed ID.
  for (const p of ws.projects.filter((x) => !x.indexMissing)) {
    const pkw = kwOf(p)
    const ownIds = p === project ? null : new Set(projectItems(p).map((it) => it.id))
    const files = new Set([p.tree.top, ...p.tree.nodes].filter((n) => n.exists).map((n) => n.file))
    for (const file of files) {
      if (p === project && file === index) continue
      const abs = join(p.root, file)
      const text = readText(abs)
      const lines = rewrite(text.lines, pkw, ownIds)
      if (lines.some((l, i) => l !== text.lines[i])) written.push({ path: abs, lines, eol: text.eol, bom: text.bom, isNew: false })
    }
  }

  if (!dryRun) {
    for (const f of written) {
      if (f.isNew) mkdirSync(dirname(f.path), { recursive: true })
      writeText(f.path, f.lines, f.eol, f.bom)
    }
  }
  return {
    status: dryRun ? 'preview' : 'split',
    files: written.map((f) => ({ path: posix(relative(ws.root, f.path)), text: joinLines(f.lines, f.eol, f.bom) })),
    renamed,
  }
}
