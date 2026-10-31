// The one place that decides whether two spellings name the same file. Paths reach the panel as
// `C:\Users\x\My Projects\app\TODO.md` (backslashes, spaces) or `c:/users/x/my projects/app/todo.md`.

const BACKSLASH = String.fromCharCode(92)
const DRIVE_ROOT = /^[a-z]:\/$/i
// Windows (drive letter) and macOS (/Users, /Volumes) are case-insensitive; the platform is read
// from the shape of the path, so no process or OS lookup is needed.
const CASE_INSENSITIVE = /^(?:[a-z]:\/|\/(?:users|volumes)\/)/i

// Forward slashes, runs of slashes collapsed, no trailing slash.
const slashed = (p: string): string => {
  const s = p.split(BACKSLASH).join('/').replace(/\/{2,}/g, '/')
  return s.length > 1 && s.endsWith('/') && !DRIVE_ROOT.test(s) ? s.slice(0, -1) : s
}

/** Forward slashes, no trailing slash, lower-cased when the path lives on a case-insensitive file system. */
export function normPath(p: string): string {
  const s = slashed(p)
  return CASE_INSENSITIVE.test(s) ? s.toLowerCase() : s
}

/** `path` relative to `root` ('' for the root itself), keeping the spelling of `path`; null when outside it. */
export function relativeTo(root: string, path: string): string | null {
  const r = normPath(root)
  const n = normPath(path)
  if (n === r) return ''
  const prefix = r.endsWith('/') ? r : `${r}/`
  return n.startsWith(prefix) ? slashed(path).slice(prefix.length) : null
}

export const sameFile = (a: string, b: string): boolean => normPath(a) === normPath(b)
