// Safety copy of a file about to be rewritten or deleted, unless git can restore it.

import { copyFileSync, mkdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { git } from './git.mjs'

const pad = (n) => String(n).padStart(2, '0')

/** YYYYMMDD-HHmmss in local time. */
export const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`

/** True when git tracks `file` and its content is committed unchanged: the repository is the backup. */
export function restorableByGit(file) {
  const dir = dirname(file)
  const name = basename(file)
  if (!git(dir, ['ls-files', '--error-unmatch', '--', name])) return false
  return git(dir, ['status', '--porcelain', '--', name]) === ''
}

/**
 * Where the backup of `file` goes: `<backupRoot>/.backlog/backup/<YYYYMMDD-HHmmss>/<name>`, or null when git covers it.
 * @param {string} file absolute path of the file
 * @param {string} backupRoot absolute folder of the project the file belongs to
 * @param {Date} now
 * @returns {string|null} absolute path of the copy
 */
export function backupTarget(file, backupRoot, now) {
  if (restorableByGit(file)) return null
  return join(backupRoot, '.backlog', 'backup', stamp(now), basename(file))
}

/** Copies `file` to `target` (from `backupTarget`), creating the folders. */
export function backupCopy(file, target) {
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(file, target)
}
