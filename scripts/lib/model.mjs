// Backlog file model: index and item parsing, dates, formatting. All words come from Keywords.

import { splitLines } from './text.mjs'
import { keywordRegexes } from './i18n.mjs'

/** @typedef {{ done: boolean, text: string, user: boolean }} Part */
/** @typedef {{ id: string|null, open: boolean, text: string, type: string, deps: string[], blocks: string[],
 *   doneWhen: string|null, from: string|null, was: string[], parts: Part[], line: number }} Item */
/** @typedef {{ from: string, days: number, state: 'later'|'due'|'overdue' }} When */

const ITEM_LINE = /^- \[( |x|X)\] (?:\[([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3})\] )?(.*)$/
const ID_IN_TEXT = /\b([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3})\b/g
const TAG = /^(?:\*\*|`)*\[([\p{Ll}-]+)\](?!\()(?:\*\*|`)*\s*/u
const NUMBERING = /^\d+[.)]\s+/

const ITEM_WITH_ID = /^- \[[ xX]\] \[[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3}\]/
const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim().replace(/`/g, '').toLowerCase())

/** True when the text has at least one item line with an ID, or a table whose header has the id and file columns. */
export function isModelFile(text, kw) {
  const lines = splitLines(text)
  const id = kw.columns.id.toLowerCase()
  const file = kw.columns.file.toLowerCase()
  return lines.some((line, i) => {
    if (ITEM_WITH_ID.test(line)) return true
    if (!line.startsWith('|')) return false
    const head = cells(line)
    return head.includes(id) && head.includes(file) && /^\|[\s|:-]+\|?$/.test(lines[i + 1] ?? '')
  })
}

/** Index tables (columns from kw.columns) and the "Next" pointer. */
export function parseIndex(text, kw) {
  const re = keywordRegexes(kw)
  const rows = []
  const lines = splitLines(text)
  const wanted = (name) => kw.columns[name].toLowerCase()
  let section = ''
  for (let i = 0; i < lines.length; i++) {
    if (/^#{1,6} /.test(lines[i])) section = lines[i].replace(/^#+ /, '')
    if (!lines[i].startsWith('|')) continue
    const head = cells(lines[i])
    const col = (name) => head.indexOf(wanted(name))
    if (col('id') < 0 || col('file') < 0 || !/^\|[\s|:-]+\|?$/.test(lines[i + 1] ?? '')) continue
    for (i += 2; i < lines.length && lines[i].startsWith('|'); i++) {
      const c = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((x) => x.trim().replace(/`/g, ''))
      const get = (name) => (col(name) >= 0 ? c[col(name)] ?? '' : '')
      rows.push({
        id: get('id'),
        name: get('name'),
        file: get('file'),
        status: get('status'),
        block: get('block'),
        aliases: get('alias').split(',').map((a) => a.trim()).filter((a) => a && a !== '\u2014'),
        subproject: re.subprojects.test(section),
      })
    }
  }
  const next = lines.join('\n').match(re.next)
  return { rows, next: next ? next[1] : null }
}

/** @returns {Item[]} */
export function parseItems(text, kw) {
  const re = keywordRegexes(kw)
  const items = []
  let cur = null
  splitLines(text).forEach((line, index) => {
    const m = line.match(ITEM_LINE)
    if (m) {
      let body = m[3].replace(NUMBERING, '')
      let type = kw.types.other
      const tag = body.match(TAG)
      if (tag) {
        type = tag[1]
        body = body.replace(TAG, '')
      }
      cur = { id: m[2] ?? null, open: m[1] === ' ', text: body.trim(), type, deps: [], blocks: [], doneWhen: null, from: null, was: [], parts: [], line: index }
      items.push(cur)
    } else if (cur && /^\s+\S/.test(line)) {
      const meta = line.trim().replace(/^- /, '')
      const part = meta.match(/^\[( |x|X)\] (.*)$/)
      if (part) {
        const user = part[2].match(re.user)
        cur.parts.push({ done: part[1] !== ' ', text: user ? user[1] : part[2], user: Boolean(user) })
      } else if (re.link.test(meta)) {
        // "Depends on: X. Blocks: Y." on one line: each ID belongs to the label before it.
        for (const [, label, ids] of meta.matchAll(re.linkSegment)) {
          (label === kw.blocks ? cur.blocks : cur.deps).push(...[...ids.matchAll(ID_IN_TEXT)].map((x) => x[1]))
        }
      } else if (re.doneWhen.test(meta)) cur.doneWhen = meta.replace(re.doneWhen, '')
      else if (re.from.test(meta)) cur.from = meta.match(re.from)[1]
      else if (re.was.test(meta)) cur.was.push(...meta.match(re.was)[1].split(',').map((x) => x.trim()).filter(Boolean))
      else cur.text += ` ${meta}`
    } else {
      cur = null
    }
  })
  return items
}

/** @returns {When|null} "From" date: later before it, due from that day, overdue after overdueDays. */
export function timing(from, today, overdueDays = 3) {
  if (!from) return null
  const days = Math.round((Date.parse(today) - Date.parse(from)) / 86_400_000)
  if (Number.isNaN(days)) return null
  return { from, days, state: days < 0 ? 'later' : days >= overdueDays ? 'overdue' : 'due' }
}

// Overdue (oldest first), due, undated, later (nearest first); ties keep file order.
const WHEN_RANK = { overdue: 0, due: 1, none: 2, later: 3 }
export const byWhen = (a, b) => (WHEN_RANK[a.when?.state ?? 'none'] - WHEN_RANK[b.when?.state ?? 'none'])
  || ((b.when?.days ?? 0) - (a.when?.days ?? 0))

/** Lines for one item, in order: item, Done when, Depends on, Blocks, From, Was, parts. */
export function formatItem({ id, type, text, open = true, doneWhen, deps = [], blocks = [], from, was = [], parts = [] }, kw, indent = '  ') {
  const ids = (list) => list.map((x) => `\`${x}\``).join(', ')
  const lines = [`- [${open ? ' ' : 'x'}] ${id ? `[${id}] ` : ''}${type ? `\`[${type}]\` ` : ''}${text}`]
  if (doneWhen) lines.push(`${indent}${kw.doneWhen}: ${doneWhen}`)
  if (deps.length) lines.push(`${indent}${kw.dependsOn}: ${ids(deps)}`)
  if (blocks.length) lines.push(`${indent}${kw.blocks}: ${ids(blocks)}`)
  if (from) lines.push(`${indent}${kw.from}: ${from}`)
  if (was.length) lines.push(`${indent}${kw.was}: ${was.join(', ')}`)
  for (const p of parts) lines.push(`${indent}- [${p.done ? 'x' : ' '}] ${p.user ? `${kw.user}: ` : ''}${p.text}`)
  return lines
}

/** An item waits on the user when every open part is the user's, or when it is a decision. */
export function waitingOnUser(item, kw) {
  const open = item.parts.filter((p) => !p.done)
  const steps = open.filter((p) => p.user).map((p) => p.text)
  return { waiting: (open.length > 0 && steps.length === open.length) || item.type === kw.types.decision, steps }
}
