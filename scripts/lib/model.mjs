// Backlog file model. Task 3 adds the parser; for now only the format detector.

import { splitLines } from './text.mjs'

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
