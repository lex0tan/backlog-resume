// `adopt`: turns a loose checklist (handoff notes, todo.txt, an unformatted TODO.md) into a backlog in the model format.
// Claude reads the candidate's lines, decides which are real open items and what they are; this module writes them.

import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { backupCopy, backupTarget } from '../backup.mjs'
import { CONFIG_FILE, effectiveConfig, readConfig } from '../config.mjs'
import { InvalidInputError } from '../errors.mjs'
import { loadKeywords } from '../i18n.mjs'
import { formatItem } from '../model.mjs'
import { identity } from '../paths.mjs'
import { posix, splitLines } from '../text.mjs'
import { projectPrefix } from '../tree.mjs'
import { discover, loadWorkspace } from '../workspace.mjs'
import { readText, writeText } from '../write.mjs'
import { check } from './check.mjs'
import { backlogHeader } from './init.mjs'

const CHECKBOX = /^\s*[-*] \[([ xX])\]\s*(.*)$/
const TYPE = /^[\p{Ll}-]+$/u
const isFile = (path) => existsSync(path) && statSync(path).isFile()
const inside = (root, path) => {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}
const relPosix = (root, path) => posix(relative(root, path)) || '.'

/** The lines of a candidate that can become items: checklist lines, or every task of a todo.txt. n is 1-based. */
function candidateLines(file, kind) {
  const out = []
  splitLines(readFileSync(file, 'utf8')).forEach((line, i) => {
    if (kind === 'todo-txt') {
      if (!line.trim()) return
      const checked = /^x /.test(line)
      out.push({ n: i + 1, text: checked ? line.slice(2).trim() : line.trim(), checked })
      return
    }
    const m = line.match(CHECKBOX)
    if (m) out.push({ n: i + 1, text: m[2].trim(), checked: m[1] !== ' ' })
  })
  return out
}

/**
 * Candidates for adoption with their candidate lines.
 * @param {import('../workspace.mjs').Workspace} ws
 */
export function adoptScan(ws) {
  const { candidates } = discover(ws.root, ws.config, ws.kw)
  return { status: 'ok', candidates: candidates.map((c) => ({ ...c, lines: candidateLines(join(ws.root, c.file), c.kind) })) }
}

/** Configuration, keywords and prefix of the project folder `dir` (an existing project, or the workspace's defaults). */
function settingsFor(ws, dir) {
  const existing = ws.projects.find((p) => identity(p.root) === identity(dir))
  if (existing) return { config: existing.config, prefix: existing.prefix }
  const own = isFile(join(dir, CONFIG_FILE)) ? readConfig(join(dir, CONFIG_FILE)) : {}
  const config = effectiveConfig(ws.config, own)
  return { config, prefix: projectPrefix({ top: { file: config.index } }, [], config, basename(dir)) }
}

/**
 * @param {import('../workspace.mjs').Workspace} ws
 * @param {{ source: string, project?: string, items: object[], mode: 'replace'|'strip', dryRun?: boolean, now?: Date }} input
 *   `source`/`project`: paths relative to the workspace root; `items[].dependsOn`: indexes into `items`;
 *   `items[].sourceLines`: 1-based lines of the source the item comes from.
 */
export function adoptWrite(ws, { source, project, items, mode, dryRun = false, now = new Date() }) {
  if (!['replace', 'strip'].includes(mode)) throw new InvalidInputError('mode', 'expected "replace" or "strip"')
  if (!Array.isArray(items) || !items.length) throw new InvalidInputError('items', 'must not be empty')
  const sourceAbs = resolve(ws.root, String(source ?? ''))
  if (!source || !inside(ws.root, sourceAbs) || !isFile(sourceAbs)) throw new InvalidInputError('source', `not a file inside the workspace: ${source}`)
  const dir = resolve(ws.root, project ?? dirname(source))
  if (!inside(ws.root, dir)) throw new InvalidInputError('project', `outside the workspace: ${project}`)

  const { config, prefix } = settingsFor(ws, dir)
  const kw = loadKeywords(config.language, config.keywords)
  const target = join(dir, config.index)
  const targetIsSource = identity(target) === identity(sourceAbs)
  if (!targetIsSource && existsSync(target)) throw new InvalidInputError('project', `${config.index} already exists in ${relPosix(ws.root, dir)}`)

  const src = readText(sourceAbs)
  const total = src.lines.length - (src.lines[src.lines.length - 1] === '' ? 1 : 0)
  items.forEach((item, i) => {
    if (!TYPE.test(item.type ?? '')) throw new InvalidInputError('items', `item ${i}: type must be lowercase letters and hyphens`)
    if (!String(item.text ?? '').trim()) throw new InvalidInputError('items', `item ${i}: text must not be empty`)
    for (const d of item.dependsOn ?? []) {
      if (!Number.isInteger(d) || d < 0 || d >= items.length || d === i) throw new InvalidInputError('items', `item ${i}: dependsOn ${d} is not another item`)
    }
    for (const n of item.sourceLines ?? []) {
      if (!Number.isInteger(n) || n < 1 || n > total) throw new InvalidInputError('items', `item ${i}: source line ${n} does not exist`)
    }
  })

  const ids = items.map((_, i) => `${prefix}-${String(i + 1).padStart(3, '0')}`)
  const itemLines = items.flatMap((item, i) => formatItem({
    id: ids[i], type: item.type, text: item.text.replace(/\s+/g, ' ').trim(), doneWhen: item.doneWhen, from: item.from,
    deps: (item.dependsOn ?? []).map((d) => ids[d]), parts: item.parts ?? [],
  }, kw))

  const stripped = new Set(items.flatMap((item) => item.sourceLines ?? []))
  const removedLines = mode === 'strip' ? [...stripped].sort((a, b) => a - b) : Array.from({ length: total }, (_, i) => i + 1)
  const kept = src.lines.filter((_, i) => !stripped.has(i + 1))
  const backlog = targetIsSource && mode === 'strip'
    ? [...kept.filter((l, i, all) => l.trim() || i < all.findLastIndex((x) => x.trim())), '', ...itemLines, '']
    : [...backlogHeader(kw, ids[0]), ...itemLines, '']

  const backupAbs = backupTarget(sourceAbs, dir, now)
  const result = {
    status: dryRun ? 'preview' : 'adopted',
    file: relPosix(ws.root, target),
    ids,
    removedLines,
    backup: backupAbs ? relPosix(ws.root, backupAbs) : null,
  }
  if (dryRun) return result

  if (backupAbs) backupCopy(sourceAbs, backupAbs)
  writeText(target, backlog, src.eol, targetIsSource ? src.bom : '')
  if (!targetIsSource) {
    if (mode === 'strip') writeText(sourceAbs, kept, src.eol, src.bom)
    else unlinkSync(sourceAbs)
  }
  const fresh = loadWorkspace(ws.cwd)
  return { ...result, check: check(fresh, { project: relPosix(ws.root, dir), fast: true }) }
}
