// Per-project git: state, commit evidence, unmerged branch work and line ages.
// git missing or failing is the documented boundary: `git()` answers null instead of throwing.

import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { identity, realPath } from './paths.mjs'
import { posix } from './text.mjs'
import { subprojectOf } from './tree.mjs'

/** An item ID inside free text (commit subjects, notes). */
export const ID_IN_TEXT = /\b([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3})\b/g

const DAY = 86_400_000
const NULL_HASH = /^0+$/

/** Runs git in `dir`; returns trimmed stdout, or null when git is missing or the command fails (stderr is dropped). */
export function git(dir, args) {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).trimEnd()
  } catch {
    return null
  }
}

/** Top-level folder of the repository containing `dir`, or null. */
export function gitRoot(dir) {
  const top = git(dir, ['rev-parse', '--show-toplevel'])
  return top || null
}

/**
 * Git state of one project: branch, last commit and the changed files, each with its owner
 * (the subproject folder it lives in, or 'general') and the backlog node it is, if any.
 * `path` is POSIX and relative to the workspace root.
 * @param {import('./workspace.mjs').Project} project
 * @param {import('./tree.mjs').Tree} tree
 * @param {string} wsRoot
 */
export function gitState(project, tree, wsRoot) {
  const top = gitRoot(project.root)
  if (!top) return { status: 'no-git', branch: null, commit: null, dirty: [] }
  const branch = git(project.root, ['branch', '--show-current']) ?? ''
  const head = git(project.root, ['log', '-1', '--format=%h|%cs|%s'])
  const subs = tree.nodes
    .filter((n) => subprojectOf(n) === n)
    .map((n) => ({ id: n.id, dir: `${identity(join(project.root, dirname(n.file)))}/` }))
  const nodeByFile = new Map(tree.nodes.map((n) => [identity(join(project.root, n.file)), n]))
  // -z: NUL-separated, unquoted paths; a rename or copy entry is followed by its origin path.
  const porcelain = git(project.root, ['status', '--porcelain', '-z', '-uall', '--', '.']) ?? ''
  const entries = porcelain.split('\0').filter(Boolean)
  const dirty = []
  for (let i = 0; i < entries.length; i++) {
    const xy = entries[i].slice(0, 2)
    const abs = join(realPath(top), entries[i].slice(3))
    if (/[RC]/.test(xy)) i++
    const key = identity(abs)
    dirty.push({
      status: xy.trim(),
      path: posix(relative(realPath(wsRoot), abs)),
      owner: subs.find((s) => key.startsWith(s.dir))?.id ?? 'general',
      backlog: nodeByFile.get(key)?.id ?? null,
    })
  }
  if (head === null) return { status: 'no-commits', branch, commit: null, dirty }
  const [hash, date, ...subject] = head.split('|')
  return { status: dirty.length ? 'dirty' : 'clean', branch, commit: { hash, date, subject: subject.join('|') }, dirty }
}

/**
 * Commits that cite any of `ids` in their message ("hash date subject"), newest first, at most `n`
 * (one `--grep` per ID, results merged).
 * @param {string} dir
 * @param {string[]} ids
 */
export function commitsFor(dir, ids, n = 10) {
  const seen = new Set()
  for (const id of ids) {
    const log = git(dir, ['log', '-n', String(n), '--fixed-strings', `--grep=${id}`, '--format=%ct %h %cs %s'])
    for (const line of (log ?? '').split('\n').filter(Boolean)) seen.add(line)
  }
  return [...seen]
    .sort((x, y) => Number(y.split(' ')[0]) - Number(x.split(' ')[0]))
    .slice(0, n)
    .map((line) => line.slice(line.indexOf(' ') + 1))
}

/**
 * Commits on local or remote branches not yet in HEAD, by item ID cited in the subject: work already done
 * elsewhere that the current branch does not show. Empty without commits or git.
 * @returns {Map<string, { hash: string, branch: string, subject: string }[]>}
 */
export function unmerged(dir) {
  const byId = new Map()
  const log = git(dir, ['log', '--branches', '--remotes', '--source', '--not', 'HEAD', '--format=%h%x09%S%x09%s']) ?? ''
  for (const line of log.split('\n').filter(Boolean)) {
    const [hash, ref, subject] = line.split('\t')
    const branch = ref.replace(/^refs\/(heads|remotes)\//, '')
    for (const id of new Set([...subject.matchAll(ID_IN_TEXT)].map((x) => x[1]))) {
      if (!byId.has(id)) byId.set(id, [])
      byId.get(id).push({ hash, branch, subject })
    }
  }
  return byId
}

const dayOf = (ms) => Math.floor(ms / DAY)

/** Last commit date of the file (YYYY-MM-DD), or null when untracked or without git. */
export function lastModified(dir, file) {
  return git(dir, ['log', '-1', '--format=%cs', '--', file]) || null
}

/**
 * Age in days of each line of `file` (0-based index): `git blame` committer time; uncommitted lines are 0.
 * An untracked file, or a folder without git or commits, gets every line aged from the file's mtime.
 * @param {string} dir
 * @param {string} file relative to `dir`
 * @param {string|Date} today
 * @returns {Map<number, number>}
 */
export function lineAges(dir, file, today) {
  const todayDay = dayOf(new Date(today).getTime())
  const ages = new Map()
  const blame = git(dir, ['blame', '--line-porcelain', '--', file])
  if (blame !== null) {
    let hash = ''
    let time = 0
    for (const line of blame.split('\n')) {
      const head = line.match(/^([0-9a-f]{40,64}) \d+ \d+/)
      if (head) hash = head[1]
      else if (line.startsWith('committer-time ')) time = Number(line.slice(15))
      else if (line.startsWith('\t')) ages.set(ages.size, NULL_HASH.test(hash) ? 0 : Math.max(0, todayDay - dayOf(time * 1000)))
    }
    return ages
  }
  const path = isAbsolute(file) ? file : join(dir, file)
  const age = Math.max(0, todayDay - dayOf(statSync(path).mtimeMs))
  const text = readFileSync(path, 'utf8')
  const count = text === '' ? 0 : text.replace(/\r?\n$/, '').split(/\r?\n/).length
  for (let i = 0; i < count; i++) ages.set(i, age)
  return ages
}
