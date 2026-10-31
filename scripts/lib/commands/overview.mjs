// Generated overview: the block between two markers in a user-owned file lists projects, workstreams and subprojects.
// Everything outside the markers stays byte for byte as it was (line endings and BOM included).

import { existsSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { message } from '../i18n.mjs'
import { posix } from '../text.mjs'
import { readText, writeText } from '../write.mjs'

const isFile = (path) => existsSync(path) && statSync(path).isFile()

/**
 * Markdown list of every project's backlog tree, with paths relative to the overview file.
 * @param {import('../workspace.mjs').Workspace} ws
 * @param {string} path absolute path of the overview file
 * @returns {string}
 */
export function overviewBlock(ws, path) {
  const base = dirname(path)
  const rel = (project, file) => posix(relative(base, join(project.root, file)))
  const lines = []
  for (const project of ws.projects) {
    if (project.indexMissing) continue
    const { top } = project.tree
    lines.push(`- \`${rel(project, top.file)}\` — ${project.name}`)
    const walk = (node, depth) => {
      for (const child of node.children) {
        const mark = child.subproject && node === top ? ` ${message(ws.kw, 'overviewSubproject')}` : ''
        lines.push(`${'  '.repeat(depth)}- \`${child.id}\` ${child.name}${mark} → \`${rel(project, child.file)}\``)
        walk(child, depth + 1)
      }
    }
    walk(top, 1)
  }
  return lines.join('\n')
}

/**
 * Status of the overview file named by `config.overview` (relative to the workspace root), rewriting its block
 * when `write` is true. `off` without configuration; `missing` and `no-markers` are never fixed automatically.
 * @param {import('../workspace.mjs').Workspace} ws
 * @param {boolean} [write]
 * @returns {{ status: 'off'|'missing'|'no-markers'|'current'|'stale'|'written', path?: string, block?: string, message?: string }}
 */
export function overview(ws, write = false) {
  if (ws.config.overview == null) return { status: 'off' }
  const path = resolve(ws.root, ws.config.overview)
  const shown = posix(relative(ws.root, path))
  if (!isFile(path)) return { status: 'missing', path: shown, message: message(ws.kw, 'overviewMissing', { file: shown }) }

  const { lines, eol, bom } = readText(path)
  const text = lines.join(eol)
  const found = ws.kw.markers
    .map((m) => ({ ...m, a: text.indexOf(m.start) }))
    .map((m) => ({ ...m, b: m.a < 0 ? -1 : text.indexOf(m.end, m.a + m.start.length) }))
    .find((m) => m.a >= 0 && m.b >= 0)
  if (!found) return { status: 'no-markers', path: shown, message: message(ws.kw, 'overviewNoMarkers', { file: shown }) }

  const block = overviewBlock(ws, path)
  const current = text.slice(found.a + found.start.length, found.b).replace(/\r\n/g, '\n').trim()
  if (current === block) return { status: 'current', path: shown }
  if (!write) return { status: 'stale', path: shown, block, message: message(ws.kw, 'overviewStale', { file: shown }) }
  const next = `${text.slice(0, found.a + found.start.length)}${eol}${block.split('\n').join(eol)}${eol}${text.slice(found.b)}`
  writeText(path, next.split(eol), eol, bom)
  return { status: 'written', path: shown, block }
}
