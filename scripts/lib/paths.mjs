// Path identity shared by tree, workspace and git: two spellings of one file compare equal.

import { existsSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { posix } from './text.mjs'

export const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin'

/** Real path of an existing path (links, 8.3 names and case resolved by the OS), else the absolute path. */
export const realPath = (path) => (existsSync(path) ? realpathSync.native(path) : resolve(path))

/** POSIX real path, lower-cased where the file system ignores case: use it only to compare, never to display. */
export function identity(path) {
  const real = posix(realPath(path))
  return CASE_INSENSITIVE ? real.toLowerCase() : real
}
