// Line-ending, BOM and text-normalisation helpers shared by every module.

const BOM = '\uFEFF'

/** @returns {'\r\n'|'\n'} the line ending used by the text (LF when there is none) */
export const eolOf = (text) => (text.includes('\r\n') ? '\r\n' : '\n')

/** Lines of a text, accepting CRLF and LF, without the BOM. */
export const splitLines = (text) => (text.startsWith(BOM) ? text.slice(1) : text).split(/\r?\n/)

/** @returns {'' | '\uFEFF'} */
export const bomOf = (text) => (text.startsWith(BOM) ? BOM : '')

/** Inverse of splitLines: restores the original line ending and BOM. */
export const joinLines = (lines, eol, bom) => bom + lines.join(eol)

/** Path with forward slashes. */
export const posix = (p) => p.replace(/\\/g, '/')

/** Lowercase, accent-free, [a-z0-9] words separated by single spaces, with a space at both ends. */
export const norm = (s) => ` ${s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `
