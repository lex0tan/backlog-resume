// Workspace discovery: backlog projects below a root, plus files that could be adopted into the model format.

import { readdirSync, readFileSync, realpathSync, existsSync, statSync } from 'node:fs'
import { basename, join, relative, resolve, isAbsolute } from 'node:path'
import { CONFIG_FILE, effectiveConfig, findWorkspace, readConfig } from './config.mjs'
import { loadKeywords } from './i18n.mjs'
import { isModelFile } from './model.mjs'
import { allItems, emptyTree, loadTree, projectPrefix } from './tree.mjs'
import { posix, splitLines } from './text.mjs'

/** @typedef {{ name: string, rel: string, root: string, aliases: string[], config: object, tree: import('./tree.mjs').Tree, prefix: string }} Project */
/** @typedef {{ root: string, cwd: string, config: object, kw: object, projects: Project[], focus: Project|null }} Workspace */
/** @typedef {{ dir: string, file: string, kind: 'unformatted-index'|'todo-txt'|'backlog-md'|'handoff'|'checklist', openLines: number, mixed: boolean }} Candidate */

export const DEFAULT_EXCLUDES = ['node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', 'target', 'vendor', 'coverage', '.venv', 'venv', '__pycache__', '.cache', '.turbo', '.idea', '.vscode', '.backlog']

const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin'
const isFile = (path) => existsSync(path) && statSync(path).isFile()
// File identity: real path of an existing file, lower-cased where the file system ignores case.
const identity = (path) => {
  const real = existsSync(path) ? realpathSync.native(path) : resolve(path)
  return CASE_INSENSITIVE ? real.toLowerCase() : real
}
const relPosix = (root, path) => posix(relative(root, path)) || '.'
const CHECKLIST = /^\s*[-*] \[[ xX]\]/
const OPEN_BOX = /^\s*[-*] \[ \]/

function candidateFor(kind, text) {
  const lines = splitLines(text)
  if (kind === 'todo-txt') {
    const tasks = lines.filter((l) => l.trim())
    return { openLines: tasks.filter((l) => !/^x /.test(l)).length, mixed: false }
  }
  const textLines = lines.filter((l) => l.trim() && !/^#{1,6} /.test(l) && !CHECKLIST.test(l))
  return { openLines: lines.filter((l) => OPEN_BOX.test(l)).length, mixed: textLines.length > 0 }
}

/**
 * Walks `root` breadth first (never through symbolic links or junctions, never deeper than `config.maxDepth`,
 * skipping excluded folders) and returns the backlog projects and the adoption candidates it finds.
 * @returns {{ projects: Project[], candidates: Candidate[] }}
 */
export function discover(root, config, kw) {
  root = resolve(root)
  const excluded = config.exclude.map((e) => posix(e).replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase())
  const excludeNames = new Set([...DEFAULT_EXCLUDES.map((e) => e.toLowerCase()), ...excluded.filter((e) => !e.includes('/'))])
  const excludePaths = new Set(excluded.filter((e) => e.includes('/')))
  const projects = []
  const candidates = []
  const claimed = new Set()

  const addProject = (dir, projectKw, merged) => {
    const rel = relPosix(root, dir)
    const name = rel === '.' ? basename(root) : basename(dir)
    const indexMissing = !isFile(join(dir, merged.index))
    const tree = indexMissing ? emptyTree(dir, merged.index) : loadTree(dir, projectKw, merged)
    const items = allItems(dir, tree, projectKw)
    for (const node of [tree.top, ...tree.nodes]) if (node.exists !== false) claimed.add(identity(join(dir, node.file)))
    projects.push({
      name, rel, root: dir, config: merged, tree, indexMissing,
      prefix: projectPrefix(tree, items, merged, name),
      aliases: [...new Set([name.toLowerCase(), ...merged.aliases])],
    })
  }

  const examine = (dir, entries) => {
    const ownPath = join(dir, CONFIG_FILE)
    const own = dir !== root && isFile(ownPath) ? readConfig(ownPath) : null
    const merged = effectiveConfig(config, own ?? {})
    const projectKw = own ? loadKeywords(merged.language, merged.keywords) : kw
    const indexPath = join(dir, merged.index)
    if (own && !isFile(indexPath)) {
      addProject(dir, projectKw, merged)
      return
    }
    if (isFile(indexPath) && !claimed.has(identity(indexPath))
      && (own || isModelFile(readFileSync(indexPath, 'utf8'), projectKw))) {
      addProject(dir, projectKw, merged)
      return
    }
    const files = new Map(entries.filter((e) => e.isFile()).map((e) => [e.name.toLowerCase(), e.name]))
    const add = (kind, lower) => {
      const name = files.get(lower)
      if (!name) return
      const text = readFileSync(join(dir, name), 'utf8')
      const info = candidateFor(kind, text)
      if (kind === 'checklist' && info.openLines === 0) return
      candidates.push({ dir: relPosix(root, dir), file: relPosix(root, join(dir, name)), kind, ...info })
    }
    const indexName = merged.index.toLowerCase()
    if (files.has(indexName) && !claimed.has(identity(indexPath))) add('unformatted-index', indexName)
    add('todo-txt', 'todo.txt')
    add('backlog-md', 'backlog.md')
    add('handoff', 'handoff.md')
    add('checklist', 'readme.md')
    add('checklist', 'notes.md')
  }

  const queue = [{ dir: root, depth: 0 }]
  while (queue.length) {
    const { dir, depth } = queue.shift()
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))
    examine(dir, entries)
    if (depth >= config.maxDepth) continue
    for (const entry of entries) {
      if (entry.isSymbolicLink() || !entry.isDirectory()) continue
      const path = join(dir, entry.name)
      if (excludeNames.has(entry.name.toLowerCase()) || excludePaths.has(relPosix(root, path).toLowerCase())) continue
      queue.push({ dir: path, depth: depth + 1 })
    }
  }

  for (const explicit of config.projects) {
    const dir = resolve(root, explicit)
    if (projects.some((p) => identity(p.root) === identity(dir))) continue
    const own = dir !== root && isFile(join(dir, CONFIG_FILE)) ? readConfig(join(dir, CONFIG_FILE)) : null
    const merged = effectiveConfig(config, own ?? {})
    addProject(dir, loadKeywords(merged.language, merged.keywords), merged)
  }

  projects.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  candidates.sort((a, b) => (a.file < b.file ? -1 : 1))
  return { projects, candidates }
}

/** Root and configuration from `findWorkspace`, projects from `discover`, focus = deepest project containing `cwd`. */
export function loadWorkspace(cwd) {
  const start = resolve(cwd)
  const found = findWorkspace(start)
  const config = effectiveConfig(found.configs[0]?.data ?? {})
  const kw = loadKeywords(config.language, config.keywords)
  const { projects } = discover(found.root, config, kw)
  const inside = (p) => {
    const rel = relative(p.root, start)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  }
  const focus = projects.filter(inside).sort((a, b) => b.root.length - a.root.length)[0] ?? null
  return { root: found.root, cwd: start, config, kw, projects, focus }
}
