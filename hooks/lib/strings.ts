import type { EngineInterface } from 'claude-code'

import type { Strings } from '../../types'

const FALLBACK = 'en'
const cache = new Map<string, Promise<Strings | null>>()

async function read($: EngineInterface, language: string): Promise<Strings | null> {
  // The code becomes part of a file name: only plain language tags are read.
  if (!/^[a-z]{2,3}(-[A-Za-z0-9]+)?$/.test(language)) return null
  try {
    const text = (await $.fs.read(`${$.plugin.root}/lang/${language}.json`, { as: 'text' })) as string
    const panel = (JSON.parse(text.replace(/^\uFEFF/, '')) as { panel?: Strings }).panel
    return panel ?? null
  } catch {
    return null
  }
}

/** Panel texts for `language` (lang/<language>.json, `panel`), English for what it lacks; cached per language. */
export async function loadStrings($: EngineInterface, language: string): Promise<Strings> {
  const key = `${$.plugin.root}|${language}`
  if (!cache.has(key)) cache.set(key, read($, language))
  const wanted = await cache.get(key)!
  if (language === FALLBACK) return wanted ?? {}
  const fallbackKey = `${$.plugin.root}|${FALLBACK}`
  if (!cache.has(fallbackKey)) cache.set(fallbackKey, read($, FALLBACK))
  return { ...((await cache.get(fallbackKey)) ?? {}), ...(wanted ?? {}) }
}

/** Text for `key` with `{name}` placeholders filled in; a missing key shows as itself. */
export function t(strings: Strings, key: string, vars: Record<string, string | number> = {}): string {
  return (strings[key] ?? key).replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole))
}
