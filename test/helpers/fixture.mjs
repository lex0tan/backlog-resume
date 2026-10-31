// Temporary workspaces for tests. italianShop() and englishShop() are structurally identical.

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Writes a map path -> content into a fresh temporary folder and returns its path.
 * With `git`, the folder becomes a repository with one initial commit.
 * With `config`, `.backlog.json` is written from the object.
 * @param {Record<string, string>} spec
 * @param {{ git?: boolean, config?: object }} [options]
 */
export function makeWorkspace(spec, { git = false, config } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'backlog-'))
  const files = config ? { ...spec, '.backlog.json': JSON.stringify(config, null, 2) } : spec
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  if (git) {
    const run = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' })
    run('init', '-q', '-b', 'main')
    run('config', 'user.email', 'test@example.com')
    run('config', 'user.name', 'Test')
    run('add', '-A')
    run('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'docs: initial backlog')
  }
  return root
}

/** makeWorkspace plus removal of the folder when the test ends: `workspace(t, spec)`. */
export function workspace(t, spec, options) {
  const root = makeWorkspace(spec, options)
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

const WORDS = {
  en: {
    heading: 'Backlog index', status: 'Status', general: 'General workstreams', sub: 'Subprojects',
    next: 'Next', dependsOn: 'Depends on', blocks: 'Blocks', doneWhen: 'Done when',
    from: 'From', was: 'Was', user: 'User', blocked: 'blocked', decision: 'decision',
    cols: ['ID', 'Name', 'File', 'Status', 'Block', 'Alias'], open: 'open', going: 'in progress',
    names: { API: 'Backend API', WEB: 'Website', MKT: 'Marketing', GHOST: 'Ghost', SEO: 'SEO', ADS: 'Ads', MOBILE: 'Mobile app', UI: 'Interface', PUSH: 'Notifications', ORD: 'Orders', OPS: 'Operations', KIOSK: 'Kiosk', SCREEN: 'Screen' },
    t: {
      export: 'Export endpoint', exportDone: '`GET /export` answers 200', flag: 'Do-not-contact flag', old: 'Health check',
      landing: 'Landing page', landingParts: ['Write the copy', 'Pay for the domain', 'Publish'], cookie: 'Cookie banner wording',
      pricing: 'Pricing page', seo: 'Keyword research', ads: 'Ad budget', ui: 'Login screen', push: 'Push notifications', orders: 'Order list', ops: 'Email deliverability', guide: 'Setup guide', flyer: 'Store flyer',
    },
  },
  it: {
    heading: 'Indice del backlog', status: 'Stato', general: 'Workstream generali', sub: 'Sottoprogetti',
    next: 'Prossima attività', dependsOn: 'Dipende da', blocks: 'Blocca', doneWhen: 'Fatto quando',
    from: 'Dal', was: 'Prima', user: 'Utente', blocked: 'bloccato', decision: 'decisione',
    cols: ['ID', 'Nome', 'File', 'Stato', 'Blocco', 'Alias'], open: 'aperto', going: 'in corso',
    names: { API: 'Backend API', WEB: 'Sito web', MKT: 'Marketing', GHOST: 'Fantasma', SEO: 'SEO', ADS: 'Pubblicità', MOBILE: 'App mobile', UI: 'Interfaccia', PUSH: 'Notifiche', ORD: 'Ordini', OPS: 'Operazioni', KIOSK: 'Chiosco', SCREEN: 'Schermo' },
    t: {
      export: 'Endpoint di export', exportDone: '`GET /export` risponde 200', flag: 'Flag non contattare', old: 'Controllo di salute',
      landing: 'Pagina di atterraggio', landingParts: ['Scrivere i testi', 'Pagare il dominio', 'Pubblicare'], cookie: 'Testo del banner cookie',
      pricing: 'Pagina dei prezzi', seo: 'Ricerca delle parole chiave', ads: 'Budget pubblicitario', ui: 'Schermata di accesso', push: 'Notifiche push', orders: 'Elenco ordini', ops: 'Recapito delle email', guide: 'Guida di avvio', flyer: 'Volantino del negozio',
    },
  },
}

// Same aliases in both languages, so routing tests can share them. ORD and OPS share "email" (ambiguous);
// MKT and MOBILE-MKT share "marketing" (general vs subproject).
const ALIASES = { API: 'api, backend', WEB: 'web, site', MKT: 'marketing', GHOST: 'ghost', SEO: 'seo', ADS: 'ads', MOBILE: 'mobile, app', UI: 'ui', PUSH: 'push', ORD: 'orders, email', OPS: 'ops, email', KIOSK: 'kiosk', SCREEN: 'screen' }

function shop(w) {
  const t = w.t
  const last = (id) => id.split('-').pop()
  const table = (rows) => {
    const [id, name, file, status, block, alias] = w.cols
    return [
      `| ${id} | ${name} | ${file} | ${status} | ${block} | ${alias} |`,
      '|---|---|---|---|---|---|',
      ...rows.map(([key, path, state]) => `| \`${key}\` | ${w.names[last(key)]} | \`${path}\` | ${state} | — | ${ALIASES[last(key)]} |`),
    ].join('\n')
  }
  const item = (id, type, text, ...meta) => [`- [ ] [${id}] \`[${type}]\` ${text}`, ...meta.map((m) => `  ${m}`)].join('\n')

  return {
    'CLAUDE.md': '# Rules\n',
    'TODO.md': [
      `# ${w.heading}`, '', `## ${w.status}`, '', `- ${w.next}: \`SHOP-API-001\``, '',
      `## ${w.general}`, '',
      table([['SHOP-API', 'todo/api.md', w.going], ['SHOP-WEB', 'todo/web.md', w.open], ['SHOP-MKT', 'todo/marketing/index.md', w.going], ['SHOP-ORD', 'todo/orders.md', w.open], ['SHOP-OPS', 'todo/ops.md', w.open], ['SHOP-GHOST', 'todo/ghost.md', w.open]]), '',
      `## ${w.sub}`, '',
      table([['MOBILE', 'projects/mobile/TODO.md', w.going], ['KIOSK', 'projects/kiosk/TODO.md', w.open]]), '',
    ].join('\n'),
    'todo/api.md': ['# API', '',
      item('SHOP-API-001', 'code', t.export, `${w.doneWhen}: ${t.exportDone}`),
      item('SHOP-API-002', 'code', t.flag, `${w.dependsOn}: \`SHOP-MKT-ADS-001\``, `${w.from}: 2026-01-10`),
      `- [x] [SHOP-API-003] \`[code]\` ${t.old}`, ''].join('\n'),
    'todo/web.md': ['# Web', '',
      item('SHOP-WEB-001', 'content', t.landing,
        `${w.dependsOn}: \`SHOP-API-001\`. ${w.blocks}: \`SHOP-WEB-003\``,
        `- [x] ${t.landingParts[0]}`, `- [ ] ${w.user}: ${t.landingParts[1]}`, `- [ ] ${t.landingParts[2]}`),
      item('SHOP-WEB-002', w.blocked, t.cookie),
      item('SHOP-WEB-003', w.decision, t.pricing, `${w.was}: SHOP-WEB-099`), ''].join('\n'),
    'todo/marketing/index.md': ['# Marketing', '', `- ${w.next}: \`SHOP-MKT-ADS-001\``, '',
      table([['SHOP-MKT-SEO', 'seo.md', w.going], ['SHOP-MKT-ADS', 'ads.md', w.open]]), ''].join('\n'),
    'todo/marketing/seo.md': ['# SEO', '', item('SHOP-MKT-SEO-001', 'content', `${t.seo} \`notes/exists.md\` / \`notes/missing.md\``), ''].join('\n'),
    'todo/marketing/ads.md': ['# Ads', '', item('SHOP-MKT-ADS-001', w.decision, t.ads, `${w.blocks}: \`SHOP-API-002\``), ''].join('\n'),
    'todo/orders.md': ['# Orders', '', item('SHOP-ORD-001', 'code', t.orders), ''].join('\n'),
    'todo/ops.md': ['# Operations', '', item('SHOP-OPS-001', 'code', t.ops), ''].join('\n'),
    'notes/exists.md': '# Exists\n',
    'projects/kiosk/TODO.md': ['# Kiosk', '', table([['KIOSK-SCREEN', 'todo/screen.md', w.open]]), ''].join('\n'),
    'projects/kiosk/todo/screen.md': ['# Screen', '', item('KIOSK-SCREEN-001', 'content', t.guide), ''].join('\n'),
    'projects/mobile/todo/marketing.md': ['# Mobile marketing', '', item('MOBILE-MKT-001', 'content', t.flyer), ''].join('\n'),
    'projects/mobile/CLAUDE.md': '# Mobile rules\n',
    'projects/mobile/TODO.md': ['# Mobile', '', `- ${w.next}: \`MOBILE-UI-001\``, '',
      table([['MOBILE-UI', 'todo/ui.md', w.going], ['MOBILE-PUSH', 'todo/push.md', w.open], ['MOBILE-MKT', 'todo/marketing.md', w.open]]), ''].join('\n'),
    'projects/mobile/todo/ui.md': ['# UI', '', item('MOBILE-UI-001', 'code', t.ui, `${w.from}: 2026-01-12`), ''].join('\n'),
    'projects/mobile/todo/push.md': ['# Push', '', item('MOBILE-PUSH-001', 'code', t.push, `${w.dependsOn}: \`MOBILE-UI-001\``), ''].join('\n'),
  }
}

/** Shop backlog with a general index, an indexed workstream (MKT) and a subproject (MOBILE), in Italian. */
export const italianShop = () => shop(WORDS.it)

/** Same structure as italianShop(), in English. */
export const englishShop = () => shop(WORDS.en)

/** A single TODO.md: status, "Next" and items, no index table. */
export function flat() {
  return {
    'TODO.md': ['# Shop', '', '## Status', '', '- Next: `SHOP-002`', '',
      '- [x] [SHOP-001] `[code]` Set up the repository',
      '- [ ] [SHOP-002] `[code]` Product list', '  Done when: the list renders',
      '- [ ] [SHOP-003] `[decision]` Payment provider', '  Depends on: `SHOP-002`', '  From: 2026-01-10',
      '- [ ] [SHOP-004] `[content]` Launch post', '  - [x] Draft', '  - [ ] User: Approve the draft', ''].join('\n'),
  }
}
