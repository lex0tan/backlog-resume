// Optional archive of closed items: with `archive: "done"` in the config, `done` keeps each closed item in `<project>/done/YYYY-MM.md`.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { InvalidInputError } from './errors.mjs'
import { ITEM_ID } from './ids.mjs'
import { appendText } from './write.mjs'

/** Absolute folder of the archive, or null when the project does not keep one. */
export function archiveDir(project) {
  const dir = project.config.archive
  if (!dir) return null
  const abs = resolve(project.root, dir)
  if (abs !== project.root && !abs.startsWith(project.root + sep)) throw new InvalidInputError('archive', `"${dir}" must be inside the project`)
  return abs
}

/** IDs of every archived item, so `add` never hands out a number that was closed before. */
export function archivedIds(project) {
  const dir = archiveDir(project)
  if (!dir || !existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .flatMap((f) => [...readFileSync(join(dir, f), 'utf8').matchAll(/^- \[x\] \[([^\]]+)\]/gim)].map((m) => m[1]))
    .filter((id) => ITEM_ID.test(id))
}

/**
 * Appends a closed item to the archive file of `today`'s month.
 * @param {string[]} itemLines the item as it stood in its file (first line plus sub-lines)
 */
export function archiveItem(project, kw, itemLines, today, eol) {
  const dir = archiveDir(project)
  if (!dir) return null
  const month = today.slice(0, 7)
  const [first = '', ...rest] = itemLines
  const entry = [first.replace(/^(\s*- )\[ \]/, '$1[x]'), ...rest, `  ${kw.closed}: ${today}`]
  appendText(join(dir, `${month}.md`), entry, { header: [`# ${kw.closed} ${month}`], eol })
  return join(dir, `${month}.md`)
}
