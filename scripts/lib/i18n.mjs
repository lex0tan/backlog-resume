// Language files plus user overrides, merged into a single Keywords object.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { LanguageNotFoundError } from './errors.mjs'

const LANG_DIR = fileURLToPath(new URL('../../lang/', import.meta.url))

/** @typedef {{ start: string, end: string }} Marker */
/** @typedef {{ language: string, next: string, dependsOn: string, blocks: string, doneWhen: string, from: string,
 *   was: string, user: string, subprojects: string,
 *   columns: { id: string, file: string, alias: string, name: string, status: string, block: string },
 *   types: { blocked: string, decision: string, other: string }, markers: Marker[],
 *   messages: Record<string, string>, panel: Record<string, string> }} Keywords */

/**
 * Shallow override per key; `columns` and `types` merge per key; `markers` in the override replaces the list.
 * @returns {Keywords}
 */
export function loadKeywords(language = 'en', overrides = {}) {
  const path = `${LANG_DIR}${language}.json`
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') throw new LanguageNotFoundError(language, path)
    throw err
  }
  const file = JSON.parse(raw)
  const kw = { ...file.keywords, messages: file.messages, panel: file.panel }
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if ((key === 'columns' || key === 'types') && value && typeof value === 'object') kw[key] = { ...kw[key], ...value }
    else kw[key] = value
  }
  return kw
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const ID = '[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*'

/**
 * Regexes built from the (escaped) keywords. `linkSegment` is global: use matchAll or reset lastIndex.
 */
export function keywordRegexes(kw) {
  const links = `${esc(kw.dependsOn)}|${esc(kw.blocks)}`
  return {
    next: new RegExp(`${esc(kw.next)}:\\s*\`?(${ID})\`?`),
    link: new RegExp(`^(?:${links}):`),
    linkSegment: new RegExp(`(${links}):((?:(?!(?:${links}):).)*)`, 'g'),
    doneWhen: new RegExp(`^${esc(kw.doneWhen)}:\\s*`),
    from: new RegExp(`^${esc(kw.from)}:\\s*(\\d{4}-\\d{2}-\\d{2})$`),
    was: new RegExp(`^${esc(kw.was)}:\\s*(.*)$`),
    user: new RegExp(`^${esc(kw.user)}:\\s*(.*)$`),
    subprojects: new RegExp(esc(kw.subprojects), 'i'),
  }
}
