import type { EngineInterface } from 'claude-code'

import type { Tone } from '../types'
import { statusLine } from './lib/session'

type RenderInput = Parameters<EngineInterface['ui']['resolve']>[0]
type Next = (e: RenderInput) => Promise<unknown>

// How each piece of the status line is drawn: theme keys, so it follows the person's theme.
const TONES: Record<Tone, { color?: string; bold?: boolean; dimColor?: boolean }> = {
  item: { color: 'warning', bold: true },
  barDone: { color: 'success' },
  barLeft: { dimColor: true },
  done: { color: 'success', bold: true },
  warn: { color: 'warning' },
  muted: { dimColor: true },
}

/**
 * The status line beside the prompt hint, in colour. The line the engine and the other plugins draw stays as it is
 * (`next(e)`), the item in progress or the last done one follows it.
 */
export async function renderStatus($: EngineInterface, e: RenderInput, next: Next) {
  const segments = await statusLine($)
  if (!segments?.length) return next(e)
  const before = (await next(e)) as { type?: string } | null
  const { Text } = $.ui.resolve(e)
  const mine = (
    <Text>
      <Text dimColor> │ </Text>
      <Text color="suggestion">backlog </Text>
      {segments.map(s => <Text {...(s.tone ? TONES[s.tone] : {})}>{s.text}</Text>)}
    </Text>
  )
  // Another plugin drew the line as text: ours goes on the same row after it. The engine's own line takes the whole
  // row, so beside its pills (which the terminal keeps on the left) the hint is drawn again, dim, as the engine would.
  const head = before?.type === 'Text' ? before : <Text dimColor>{(e.props as { hint?: string }).hint ?? ''}</Text>
  return <Text wrap="truncate-end">{head as never}{mine}</Text>
}
