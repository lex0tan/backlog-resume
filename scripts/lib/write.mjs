// The only place that writes backlog files: keeps each file's own line ending and BOM, writes atomically and serialises read-modify-write cycles.

import { closeSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { bomOf, eolOf, joinLines, splitLines } from './text.mjs'

const LOCK_WAIT_MS = 10_000
const LOCK_STALE_MS = 30_000
const LOCK_STEP_MS = 25
const RENAME_TRIES = 20

/** Returned by an `editText` callback that decided to leave the file untouched. */
export const UNCHANGED = Symbol('unchanged')

/** @returns {{ lines: string[], eol: '\r\n'|'\n', bom: '' | '﻿' }} */
export function readText(path) {
  const text = readFileSync(path, 'utf8')
  return { lines: splitLines(text), eol: eolOf(text), bom: bomOf(text) }
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** Writes `lines` joined with the given line ending, preceded by the BOM when the file had one. A reader sees the old or the new file, never half of one. */
export function writeText(path, lines, eol, bom) {
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`)
  writeFileSync(tmp, joinLines(lines, eol, bom))
  // On Windows a rename onto a file that another process has open fails for a moment: retry, then give the failure its context.
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(tmp, path)
      return
    } catch (e) {
      if (attempt >= RENAME_TRIES || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) {
        try { unlinkSync(tmp) } catch { /* the temporary file is already gone */ }
        throw new Error(`Could not replace ${path}: ${e.message}`, { cause: e })
      }
      sleep(LOCK_STEP_MS)
    }
  }
}

/** Runs `fn` while holding `<path>.lock`; a lock older than the stale limit belongs to a dead process and is taken over. */
function withLock(path, fn) {
  const lock = `${path}.lock`
  const until = Date.now() + LOCK_WAIT_MS
  for (;;) {
    try {
      closeSync(openSync(lock, 'wx'))
      break
    } catch (e) {
      if (e.code !== 'EEXIST') throw new Error(`Could not lock ${path}: ${e.message}`, { cause: e })
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) unlinkSync(lock)
      } catch { /* released between the check and the removal */ }
      if (Date.now() > until) throw new Error(`Timed out waiting for the lock on ${path} (held by another session; remove ${lock} if none is running)`, { cause: e })
      sleep(LOCK_STEP_MS)
    }
  }
  try {
    return fn()
  } finally {
    try { unlinkSync(lock) } catch { /* already removed */ }
  }
}

/**
 * Read-modify-write of one file under its lock: `fn` gets the file as it is now (not as it was when the workspace was parsed),
 * edits `state.lines` in place and returns the command's result, or `UNCHANGED` to skip the write.
 * @template T
 * @param {string} path
 * @param {(state: ReturnType<typeof readText>) => T | typeof UNCHANGED} fn
 * @returns {T | typeof UNCHANGED}
 */
export function editText(path, fn) {
  return withLock(path, () => {
    const state = readText(path)
    const result = fn(state)
    if (result !== UNCHANGED) writeText(path, state.lines, state.eol, state.bom)
    return result
  })
}
