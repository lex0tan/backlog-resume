// Workspace root discovery and configuration merging.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { ConfigError } from './errors.mjs'
import { loadKeywords } from './i18n.mjs'
import { isModelFile } from './model.mjs'

export const CONFIG_FILE = '.backlog.json'

// `workspace: true` (written by `init --workspace`) is an accepted marker key that is not a default.
export const DEFAULTS = {
  language: 'en',
  keywords: {},
  exclude: [],
  maxDepth: 4,
  projects: [],
  aliases: [],
  prefix: null,
  overview: null,
  archive: null,
  staleDays: 30,
  overdueDays: 3,
  lockMinutes: 5,
  typeOrder: [],
  index: 'TODO.md',
}

export function readConfig(path) {
  let data
  try {
    data = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
  } catch (err) {
    throw new ConfigError(path, err.message)
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ConfigError(path, 'expected a JSON object')
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const value = data[key]
    if (value === undefined || value === null) continue
    const want = Array.isArray(fallback) ? 'array' : fallback === null ? 'string' : typeof fallback
    const got = Array.isArray(value) ? 'array' : typeof value
    if (got !== want) throw new ConfigError(path, `"${key}" must be ${want === 'array' ? 'an array' : `a ${want}`}, got ${got}`)
  }
  return data
}

const isFile = (p) => existsSync(p) && statSync(p).isFile()

// Without a config the language is unknown: accept the model format in any bundled language that parses it.
function hasModelIndex(dir) {
  const file = join(dir, DEFAULTS.index)
  if (!isFile(file)) return false
  const text = readFileSync(file, 'utf8')
  return ['en', 'it'].some((language) => isModelFile(text, loadKeywords(language)))
}

/**
 * Root = outermost `.backlog.json` among cwd and its ancestors; else the nearest ancestor-or-self whose
 * index file is in the model format; else cwd. `configs` lists the files found, outermost first.
 * @returns {{ root: string, configs: { path: string, data: object }[] }}
 */
export function findWorkspace(cwd) {
  const start = resolve(cwd)
  const dirs = []
  for (let dir = start; ; dir = dirname(dir)) {
    dirs.push(dir)
    if (dirname(dir) === dir) break
  }
  const found = dirs
    .map((dir) => join(dir, CONFIG_FILE))
    .filter(isFile)
    .map((path) => ({ path, data: readConfig(path) }))
    .reverse()
  if (found.length) return { root: dirname(found[0].path), configs: found }
  return { root: dirs.find(hasModelIndex) ?? start, configs: [] }
}

/** Project configuration wins over the workspace one (shallow merge, `keywords` merged per key). */
export function effectiveConfig(wsConfig = {}, projectConfig = {}) {
  const merged = { ...DEFAULTS, ...wsConfig, ...projectConfig }
  merged.keywords = { ...DEFAULTS.keywords, ...(wsConfig.keywords ?? {}), ...(projectConfig.keywords ?? {}) }
  return merged
}
