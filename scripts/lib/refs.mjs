// Paths cited between backticks in a backlog file that do not exist on disk.

import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { git } from './git.mjs'
import { CASE_INSENSITIVE } from './paths.mjs'

const REF_EXT = /\.(md|py|mjs|js|jsx|ts|tsx|json|html|css|sh|txt|toml|ini|ya?ml|sql|dump|env)$/

// git ls-files per project root, for the lifetime of the workspace object (check calls missingRefs per file).
const TRACKED = new WeakMap()
const same = (a, b) => (CASE_INSENSITIVE ? a.toLowerCase() === b.toLowerCase() : a === b)

function trackedIn(ws, project) {
  if (!TRACKED.has(ws)) TRACKED.set(ws, new Map())
  const cache = TRACKED.get(ws)
  if (!cache.has(project.root)) cache.set(project.root, (git(project.root, ['ls-files']) ?? '').split('\n').filter(Boolean))
  return cache.get(project.root)
}

/**
 * Cited paths that cannot be found. A path is found when it exists relative to the file, to any folder above it
 * up to the workspace root (also with a leading `<project name>/` removed), or when it is a suffix of a file
 * tracked by git in the project. Routes, URLs, placeholders, secret files and home paths are ignored.
 * @param {import('./workspace.mjs').Project} project
 * @param {import('./workspace.mjs').Workspace} ws
 * @param {string} file POSIX path of the file, relative to the project root
 * @param {string} text content of the file
 * @returns {string[]}
 */
export function missingRefs(project, ws, file, text) {
  const missing = new Set()
  const prefixes = [...new Set([project.name, project.rel].filter((p) => p && p !== '.').map((p) => `${p}/`))]
  const bases = [join(project.root, dirname(file)), project.root]
  for (let d = dirname(file); d !== '.' && d !== ''; d = dirname(d)) bases.push(join(project.root, dirname(d)))
  // Folders between the project root and the workspace root, then the workspace root itself.
  for (let d = dirname(project.root); ; d = dirname(d)) {
    const rel = relative(ws.root, d)
    if (rel.startsWith('..') || isAbsolute(rel)) break
    bases.push(d)
    if (rel === '') break
  }
  for (const [, tok] of text.matchAll(/`([^`\s]+)`/g)) {
    if (/[<>{}*…@=]|:\/\//.test(tok) || /^[/~-]/.test(tok) || /(^|\/)\.env$/.test(tok)) continue
    const dir = tok.endsWith('/')
    if (!dir && !REF_EXT.test(tok)) continue
    const plain = tok.replace(/^\.\//, '')
    const stripped = prefixes.find((p) => same(plain.slice(0, p.length), p))
    const variants = stripped ? [plain, plain.slice(stripped.length)] : [plain]
    const found = variants.some((t) => (isAbsolute(t) && existsSync(t))
      || bases.some((b) => existsSync(join(b, t)))
      || trackedIn(ws, project).some((f) => (dir ? f.startsWith(t) || f.includes(`/${t}`) : f === t || f.endsWith(`/${t}`))))
    if (!found) missing.add(tok)
  }
  return [...missing]
}
