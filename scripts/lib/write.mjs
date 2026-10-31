// The only place that writes backlog files: keeps each file's own line ending and BOM.

import { readFileSync, writeFileSync } from 'node:fs'
import { bomOf, eolOf, joinLines, splitLines } from './text.mjs'

/** @returns {{ lines: string[], eol: '\r\n'|'\n', bom: '' | '﻿' }} */
export function readText(path) {
  const text = readFileSync(path, 'utf8')
  return { lines: splitLines(text), eol: eolOf(text), bom: bomOf(text) }
}

/** Writes `lines` joined with the given line ending, preceded by the BOM when the file had one. */
export function writeText(path, lines, eol, bom) {
  writeFileSync(path, joinLines(lines, eol, bom))
}
