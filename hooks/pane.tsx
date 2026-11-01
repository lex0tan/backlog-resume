import type { EngineInterface } from 'claude-code'

import type { Board, Item, Strings, View } from '../types'
import { agenda, areas, dayLabel, findRef, groups, projects, promptFor, refOf, search, unblockers, whenMark } from './lib/board'
import { runScript } from './lib/script'
import { t } from './lib/strings'
import { adoptOrphan, closedToday, dropOrphan, itemLockKey, labelOf, lockKey, locks, mineOf, releaseItem, takeItem } from './lib/session'
import { PAGE, PANE, go, load, snapshot } from './lib/state'
import type { Written } from './lib/state'

type RenderInput = Parameters<EngineInterface['ui']['resolve']>[0]

const rootOf = (b: Board): View => (b.multi ? { mode: 'projects' } : { mode: 'areas' })

// The item a view points to; the project narrows it when IDs repeat across projects.
const itemOf = (b: Board, id: string, project?: string) => b.items.find(i => i.id === id && (project === undefined || i.project === project))

export async function renderPane($: EngineInterface, e: RenderInput) {
  const els = $.ui.resolve(e)
  const { Box, Text, Button } = els
  // The phone has no text fields: no search and no new item there.
  const Input = 'Input' in els ? els.Input : null
  const { board: loaded, view: v, strings: s } = await snapshot($)
  if (!loaded || !s) return <Text dimColor>/backlog</Text>
  // Items other live sessions hold are marked; silent sessions of this workspace leave orphans to resume or release.
  const held = await locks($, Date.now(), loaded.lockMinutes * 60_000, loaded.root)
  const b: Board = { ...loaded, items: loaded.items.map(i => { const l = held.elsewhere.get(itemLockKey(i, loaded.root)); return l ? { ...i, lockedBy: l.sessionId } : i }) }
  const doable = b.items.filter(i => !i.waiting)
  const waitingCount = b.items.length - doable.length
  const tr = (key: string, vars?: Record<string, string | number>) => t(s, key, vars)

  const header = (
    <Text wrap="truncate-end">
      <Text bold>{tr('title')}</Text>
      <Text dimColor> {b.filter || tr('allWorkspace')}{!b.multi && b.projects[0]?.git ? ` · ${b.projects[0].git}` : ''}</Text>
    </Text>
  )
  if (b.error) return <Box flexDirection="column">{header}<Text color="red" wrap="wrap">{b.error}</Text></Box>

  const count = (n: number, blocked: number) => `${n}${blocked ? ` (${tr('blockedCount', { n: blocked })})` : ''}`
  const toRoot = <Button key="root" hotkey="p" onPress={() => go($, rootOf(b))}>{tr(b.multi ? 'btnProjects' : 'btnAreas')}</Button>
  const label = (i: Item) => (b.multi ? refOf(i) : i.id)
  const progress = (i: Item) => (i.parts.length ? ` (${i.parts.filter(p => p.done).length}/${i.parts.length})` : '')
  const line = (i: Item) => `${whenMark(i, s)}${i.blockedBy.length ? '⛔ ' : ''}${i.cycle ? '↻ ' : ''}${i.waiting ? '👤 ' : ''}${i.lockedBy ? '🔒 ' : ''}${i.unmerged.length ? '🔀 ' : ''}${label(i)}${progress(i)} ${i.text}`

  // Item list in pages of 8: each opens the detail and comes back.
  const itemList = (list: Item[], page: number, here: View, text: (i: Item) => string) => ({
    pages: Math.max(1, Math.ceil(list.length / PAGE)),
    rows: list.slice(page * PAGE, page * PAGE + PAGE).map((i, n) => (
      <Button key={`i-${refOf(i)}`} plain hotkey={String(n + 1)} dimColor={i.blockedBy.length > 0}
        onPress={() => go($, { mode: 'item', id: i.id, project: i.project, back: here })}>
        {text(i).slice(0, 96)}
      </Button>
    )),
  })

  const doneToday = (await closedToday($)).length
  // The item an entry points to, found by its file: the project folder is relative to whoever wrote the entry.
  const itemOfEntry = (o: { file: string; id: string }) => b.items.find(i => itemLockKey(i, b.root) === lockKey(o))
  const mineLine = held.mine && (
    <Box key="mine" flexDirection="row" gap={2}>
      <Text color="green" wrap="truncate-end">▶ {tr('workingOn', { ref: labelOf(held.mine) })}</Text>
      <Button key="stop-home" hotkey="z" onPress={async () => {
        await releaseItem($)
        $.ui.toast(tr('released', { ref: labelOf(held.mine!) }), { timeoutMs: 4000 })
        await load($, b.filter)
      }}>{tr('btnStop')}</Button>
    </Box>
  )
  // Resume replaces the session's own item, so it is offered only when the session holds none; hotkeys go to the first orphan.
  const orphanRows = held.orphans.map((o, n) => (
    <Box key={`orphan-${o.sessionId}`} flexDirection="row" gap={2}>
      <Text color="yellow" wrap="truncate-end">{tr('leftUnfinished', { ref: labelOf(o) })}</Text>
      {!held.mine && (
        <Button key={`resume-${o.sessionId}`} hotkey={n === 0 ? 'r' : undefined} onPress={async () => {
          const hit = itemOfEntry(o)
          if (!hit) {
            // Closed or removed meanwhile: nothing to resume, the entry is only dropped.
            await dropOrphan($, o)
            $.ui.toast(tr('gone', { id: labelOf(o) }), { timeoutMs: 4000 })
            await load($, b.filter)
            return
          }
          await adoptOrphan($, o)
          $.ui.toast(tr('resumed', { ref: labelOf(o) }), { timeoutMs: 4000 })
          await $.ui.close({ id: PANE })
          await $.prompt.submit({ text: promptFor(hit, s, b.indexFiles), asUser: true })
        }}>{tr('btnResume')}</Button>
      )}
      <Button key={`release-${o.sessionId}`} hotkey={n === 0 ? 'x' : undefined} onPress={async () => {
        await dropOrphan($, o)
        $.ui.toast(tr('released', { ref: labelOf(o) }), { timeoutMs: 4000 })
        await load($, b.filter)
      }}>{tr('btnRelease')}</Button>
    </Box>
  ))

  if (v.mode === 'projects' || (v.mode === 'areas' && v.project === undefined)) {
    const { today, tomorrow } = agenda(b.items)
    const late = today.filter(i => i.when?.state === 'overdue').length
    const tone = late ? 'red' : today.length ? 'yellow' : 'green'
    const row = (i: Item, n: number) => (
      <Button key={`ag-${refOf(i)}`} plain hotkey={['q', 'e', 't', 'u', 'i'][n]} onPress={() => go($, { mode: 'item', id: i.id, project: i.project, back: v })}>
        {line(i).slice(0, 92)}
      </Button>
    )
    const locale = tr('locale')
    const agendaCard = (
      <Box key="agenda" flexDirection="column" borderStyle="round" borderColor={tone} paddingX={1}>
        <Text wrap="truncate-end">
          <Text bold color={tone}>{tr('agendaToday')}</Text>
          <Text dimColor> · {dayLabel(0, locale)}{late ? ` · ${tr('lateCount', { n: late })}` : ''}</Text>
        </Text>
        {today.length ? today.map(row) : <Text color="green">✓ {tr('nothingToday')}</Text>}
        <Text wrap="truncate-end">
          <Text bold color="cyan">{tr('agendaTomorrow')}</Text>
          <Text dimColor> · {dayLabel(1, locale)}</Text>
        </Text>
        {tomorrow.length ? tomorrow.map((i, n) => row(i, today.length + n)) : <Text dimColor>{tr('nothingTomorrow')}</Text>}
      </Box>
    )
    const choices = v.mode === 'projects'
      ? projects(doable).map((p, n) => {
        const git = b.projects.find(x => x.rel === p.id)?.git
        return (
          <Button key={`p-${p.id}`} plain hotkey={n < 9 ? String(n + 1) : undefined} onPress={() => go($, { mode: 'areas', project: p.id })}>
            {`${p.name} · ${count(p.count, p.blocked)}${git ? ` · ${git}` : ''}`.slice(0, 96)}
          </Button>
        )
      })
      : areas(doable).map((a, n) => (
        <Button key={`a-${a.id}`} plain hotkey={n < 9 ? String(n + 1) : undefined} onPress={() => go($, { mode: 'types', area: a.id })}>
          {`${a.name} · ${count(a.count, a.blocked)}`}
        </Button>
      ))
    return (
      <Box flexDirection="column">
        {header}
        {mineLine}
        {orphanRows}
        {b.items.length === 0 && <Text dimColor>{tr('noItemsYet')}</Text>}
        <Text bold>{tr('canDoLine', { n: doable.length })}</Text>
        <Text dimColor>{tr(v.mode === 'projects' ? 'pickProject' : 'pickArea', { n: doable.length })}</Text>
        {choices}
        {Input && <Input key="search" placeholder={tr('searchPlaceholder')} submitLabel={tr('search')} onSubmit={(query: string) => go($, { mode: 'search', query, page: 0 })} />}
        <Box flexDirection="row" gap={2}>
          <Button key="unblock" hotkey="s" onPress={() => go($, { mode: 'unblock', page: 0 })}>{tr('btnUnblock')}</Button>
          <Button key="new" hotkey="a" onPress={() => go($, { mode: 'new' })}>{tr('btnNew')}</Button>
          {waitingCount > 0 && <Button key="waiting" hotkey="w" onPress={() => go($, { mode: 'waiting', page: 0 })}>{tr('btnWaiting', { n: waitingCount })}</Button>}
        </Box>
        {doneToday > 0 && <Text dimColor>{tr('doneTodayLine', { n: doneToday })}</Text>}
        {agendaCard}
      </Box>
    )
  }

  if (v.mode === 'areas') {
    const inProject = doable.filter(i => i.project === v.project)
    return (
      <Box flexDirection="column">
        {header}
        <Text bold>{inProject[0]?.projectName ?? v.project} · {inProject.length}</Text>
        {areas(inProject).map((a, n) => (
          <Button key={`a-${a.id}`} plain hotkey={n < 9 ? String(n + 1) : undefined} onPress={() => go($, { mode: 'types', area: a.id, project: v.project })}>
            {`${a.name} · ${count(a.count, a.blocked)}`}
          </Button>
        ))}
        {toRoot}
      </Box>
    )
  }

  if (v.mode === 'types') {
    const inArea = doable.filter(i => i.area === v.area && (v.project === undefined || i.project === v.project))
    return (
      <Box flexDirection="column">
        {header}
        <Text bold>{inArea[0]?.areaName ?? v.area} · {inArea.length}</Text>
        {groups(inArea, b.typeOrder).map((g, n) => (
          <Button key={`t-${g.type}`} plain hotkey={n < 9 ? String(n + 1) : undefined}
            onPress={() => go($, { mode: 'items', area: v.area, type: g.type, page: 0, ...(v.project === undefined ? {} : { project: v.project }) })}>
            {`[${g.type}] ${count(g.count, g.blocked)}`}
          </Button>
        ))}
        {v.project !== undefined && <Button key="back" hotkey="b" onPress={() => go($, { mode: 'areas', project: v.project })}>{tr('btnAreas')}</Button>}
        {toRoot}
      </Box>
    )
  }

  if (v.mode === 'items' || v.mode === 'unblock' || v.mode === 'search' || v.mode === 'waiting') {
    const list = v.mode === 'items' ? doable.filter(i => i.area === v.area && i.type === v.type && (v.project === undefined || i.project === v.project))
      : v.mode === 'unblock' ? unblockers(b.items) : v.mode === 'waiting' ? b.items.filter(i => i.waiting) : search(b.items, v.query)
    const title = v.mode === 'items' ? `${list[0]?.areaName ?? v.area} · [${v.type}] ${list.length}`
      : v.mode === 'unblock' ? tr('unblockTitle', { n: list.length })
        : v.mode === 'waiting' ? tr('waitingTitle', { n: list.length }) : tr('searchTitle', { query: v.query, n: list.length })
    const { pages, rows } = itemList(list, v.page, v, i => (v.mode === 'unblock' ? tr('unblocksLine', { id: label(i), n: i.unblocks.length, text: i.text }) : v.mode === 'waiting' && i.steps.length ? `${line(i)} → ${i.steps.join('; ')}` : line(i)))
    return (
      <Box flexDirection="column">
        {header}
        <Text bold>{title}{pages > 1 ? ` · ${tr('page', { page: v.page + 1, pages })}` : ''}</Text>
        {list.length === 0 && <Text dimColor>{tr('nothingToShow')}</Text>}
        {rows}
        <Box flexDirection="row" gap={2}>
          {v.mode === 'items' && <Button key="back" hotkey="b" onPress={() => go($, { mode: 'types', area: v.area, ...(v.project === undefined ? {} : { project: v.project }) })}>{tr('btnTypes')}</Button>}
          {pages > 1 && <Button key="more" hotkey="n" onPress={() => go($, { ...v, page: (v.page + 1) % pages })}>{tr('btnMore')}</Button>}
          {toRoot}
        </Box>
      </Box>
    )
  }

  if (v.mode === 'new') {
    const ws = b.workstreams.find(w => w.id === v.workstream && (v.project === undefined || w.project === v.project))
    const owner = (w: { project: string }) => b.projects.find(p => p.rel === w.project)?.name ?? w.project
    return (
      <Box flexDirection="column">
        {header}
        <Text bold>{tr('newTitle')}{ws ? ` · ${ws.label}` : ''}{v.type ? ` · [${v.type}]` : ''}</Text>
        {!ws && b.workstreams.map((w, n) => (
          <Button key={`w-${w.project}-${w.id}`} plain hotkey={n < 9 ? String(n + 1) : undefined} onPress={() => go($, { mode: 'new', project: w.project, workstream: w.id })}>
            {`${b.multi ? `${owner(w)} · ` : ''}${w.id} · ${w.label}`}
          </Button>
        ))}
        {ws && !v.type && (b.typeOrder.length ? b.typeOrder : tr('defaultTypes').split(',')).map((type, n) => (
          <Button key={`nt-${type}`} plain hotkey={n < 9 ? String(n + 1) : undefined} onPress={() => go($, { mode: 'new', project: ws.project, workstream: ws.id, type })}>{`[${type}]`}</Button>
        ))}
        {ws && v.type && Input && (
          <Input key="new-text" autoFocus placeholder={tr('newText')} submitLabel={tr('add')} onSubmit={async (text: string) => {
            const r = (await runScript($, ['add', ws.id, v.type!, text, '--project', ws.project])) as Written
            $.ui.toast(r.status === 'added' ? tr('added', { id: r.id ?? '' }) : tr('notAdded', { reason: r.message ?? r.status }), { timeoutMs: 4000 })
            await load($, b.filter)
            await go($, r.status === 'added' ? { mode: 'item', id: r.id!, project: ws.project, back: rootOf(b) } : rootOf(b))
          }} />
        )}
        {toRoot}
      </Box>
    )
  }

  const item = itemOf(b, v.id, v.project)
  if (!item) {
    return (
      <Box flexDirection="column">
        {header}
        <Text dimColor>{tr('gone', { id: v.id })}</Text>
        {toRoot}
      </Box>
    )
  }

  if (v.mode === 'confirm') {
    return (
      <Box flexDirection="column">
        {header}
        <Text bold color="yellow">{tr('confirmRemove', { ref: refOf(item), file: item.file })}</Text>
        <Text wrap="truncate-end" dimColor>{item.text}</Text>
        {item.doneWhen && <Text wrap="wrap">{tr('doneWhenLine', { text: item.doneWhen })}</Text>}
        <Text dimColor>{tr('noCommit')}</Text>
        <Box flexDirection="row" gap={2}>
          <Button key="yes" variant="primary" hotkey="y" onPress={async () => {
            const r = (await runScript($, ['done', refOf(item)])) as Written
            const own = await mineOf($)
            if (r.status === 'done' && own && lockKey(own) === itemLockKey(item, b.root)) await releaseItem($)
            $.ui.toast(r.status === 'done'
              ? (r.next ? tr('removedNext', { id: item.id, next: r.next }) : tr('removed', { id: item.id }))
              : tr('notRemoved', { reason: r.message ?? r.status }), { timeoutMs: 4000 })
            await load($, b.filter)
            await go($, v.back)
          }}>{tr('btnConfirmYes')}</Button>
          <Button key="no" hotkey="b" autoFocus onPress={() => go($, { mode: 'item', id: item.id, project: item.project, back: v.back })}>{tr('btnCancel')}</Button>
        </Box>
      </Box>
    )
  }

  // Blockers named as `ID` or `project:ID`, with their text when the pane knows them.
  const named = (refs: string[]) => refs.map(r => { const hit = findRef(b.items, r, item); return hit ? `${r} (${hit.text.slice(0, 40)})` : r }).join(', ')
  return (
    <Box flexDirection="column">
      {header}
      <Text bold>{refOf(item)} [{item.type}] <Text dimColor>{item.file}</Text></Text>
      {item.when && <Text color={item.when.state === 'later' ? undefined : 'yellow'}>{whenMark(item, s)}{tr('fromDate', { date: item.when.from })}</Text>}
      {item.blockedBy.length > 0 && <Text color="red" wrap="wrap">{tr('blockedBy', { refs: named(item.blockedBy) })}</Text>}
      {item.cycle && <Text color="red" wrap="wrap">{tr('cycleLine', { chain: item.cycle.join(' > ') })}</Text>}
      {item.unblocks.length > 0 && <Text color="cyan" wrap="wrap">{tr('unblocksList', { refs: item.unblocks.join(', ') })}</Text>}
      {item.waiting && <Text color="yellow" wrap="wrap">{item.steps.length ? tr('waitingSteps', { steps: item.steps.join('; ') }) : tr('waitingDecision')}</Text>}
      {item.stale && <Text color="yellow">{tr('staleLine', { days: item.stale.days })}</Text>}
      {item.unmerged.length > 0 && (
        <Text color="yellow" wrap="wrap">🔀 {tr('unmergedLine', { commits: item.unmerged.map(c => `${c.hash} on ${c.branch}`).join(', ') })}</Text>
      )}
      <Text wrap="wrap">{item.text}</Text>
      {item.parts.map((p, n) => (
        <Text key={`p-${n}`} dimColor={p.done} wrap="wrap">{p.done ? '✔' : '○'} {p.text}</Text>
      ))}
      {item.doneWhen && <Text color="green" wrap="wrap">{tr('doneWhenLine', { text: item.doneWhen })}</Text>}
      {item.lockedBy && <Text color="yellow" wrap="wrap">🔒 {tr('lockedElsewhere')}. {tr('lockedNote')}</Text>}
      <Box flexDirection="row" gap={2}>
        {held.mine && lockKey(held.mine) === itemLockKey(item, b.root) && (
          <Button key="stop" hotkey="x" onPress={async () => {
            await releaseItem($)
            $.ui.toast(tr('released', { ref: refOf(item) }), { timeoutMs: 4000 })
            await go($, v.back)
          }}>{tr('btnStop')}</Button>
        )}
        {!item.lockedBy && <Button key="work" variant="primary" hotkey="l" autoFocus onPress={async () => {
          if (!(await takeItem($, item, b))) return
          await $.ui.close({ id: PANE })
          await $.prompt.submit({ text: promptFor(item, s, b.indexFiles), asUser: true })
        }}>{tr('btnWork')}</Button>}
        <Button key="done" hotkey="f" onPress={() => go($, { mode: 'confirm', id: item.id, project: item.project, back: v.back })}>{tr('done')}</Button>
        <Button key="back" hotkey="b" onPress={() => go($, v.back)}>{tr('btnBack')}</Button>
        {toRoot}
      </Box>
    </Box>
  )
}
