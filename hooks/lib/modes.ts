// `/backlog-resume <mode> <request>`: the prompt that runs the session skill, with the locks of the other sessions in front of it.

import type { EngineInterface } from 'claude-code'

import { findRef } from './board'
import { itemLockKey, labelOf, locks, takeItem } from './session'
import { load } from './state'
import { t } from './strings'

export type ModeRun = { text: string } | { refused: string }

/**
 * Text to submit for a mode. The skill cannot see the plugin store, so the items other live sessions work on are named in
 * the prompt. `do <ID>` takes the item for this session like "Work on it" in the panel, and is refused when another
 * session holds it.
 */
export async function modeRun($: EngineInterface, mode: string, request: string): Promise<ModeRun> {
  const { board, strings } = await load($, '')
  const base = `Use the backlog-resume:session skill. Mode: ${mode}. Request: ${request}`
  if (board.error) return { text: base }
  const held = await locks($, Date.now(), board.lockMinutes * 60_000, board.root)
  if (mode === 'do') {
    const token = request.split(/\s+/)[0] ?? ''
    const hit = token ? findRef(board.items, token, { project: '' }) : null
    if (hit) {
      if (held.elsewhere.has(itemLockKey(hit, board.root))) return { refused: t(strings, 'lockedNote') }
      await takeItem($, hit, board)
    }
  }
  const others = [...held.elsewhere.values()].map(labelOf)
  return { text: others.length ? `${base}\n${t(strings, 'inProgressElsewhere', { refs: others.join(', ') })}` : base }
}
