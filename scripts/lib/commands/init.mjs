// `init`: a flat TODO.md plus .backlog.json in a folder. Never overwrites an existing file.

import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadKeywords, message } from '../i18n.mjs'
import { writeText } from '../write.mjs'

/**
 * Lines of a backlog file with no items yet: title, status section with the "Next" pointer, items section.
 * @param {import('../i18n.mjs').Keywords} kw
 * @param {string|null} [next] ID of the first item, or null for the empty pointer
 */
export function backlogHeader(kw, next = null) {
  return [
    `# ${message(kw, 'initTitle')}`, '',
    `## ${message(kw, 'initStatus')}`, '',
    `- ${kw.next}: ${next ? `\`${next}\`` : '—'}`, '',
    `## ${message(kw, 'initItems')}`, '',
  ]
}

/**
 * The config is always written (at least `{}`): it is what makes a folder without items a project.
 * @param {string} dir folder that gets the backlog
 * @param {{ language?: string, prefix?: string, workspace?: boolean }} [options]
 * @returns {{ status: 'created'|'exists', files: string[] }} `files` are the files written, relative to `dir`
 */
export function init(dir, { language = 'en', prefix, workspace = false } = {}) {
  const kw = loadKeywords(language)
  const config = {}
  if (language !== 'en') config.language = language
  if (workspace) config.workspace = true
  if (prefix) config.prefix = prefix

  const files = []
  mkdirSync(dir, { recursive: true })
  if (!existsSync(join(dir, 'TODO.md'))) {
    writeText(join(dir, 'TODO.md'), backlogHeader(kw), '\n', '')
    files.push('TODO.md')
  }
  if (!existsSync(join(dir, '.backlog.json'))) {
    writeText(join(dir, '.backlog.json'), [JSON.stringify(config, null, 2), ''], '\n', '')
    files.push('.backlog.json')
  }
  return { status: files.length ? 'created' : 'exists', files }
}
