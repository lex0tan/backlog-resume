import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { commitsFor, git, gitRoot, gitState, lastModified, lineAges, unmerged } from '../scripts/lib/git.mjs'
import { loadWorkspace } from '../scripts/lib/workspace.mjs'
import { englishShop, flat, workspace } from './helpers/fixture.mjs'

const run = (root, env, ...args) =>
  execFileSync('git', ['-C', root, '-c', 'commit.gpgsign=false', '-c', 'user.email=t@example.com', '-c', 'user.name=T', ...args], {
    stdio: 'ignore',
    env: { ...process.env, ...env },
  })
const commit = (root, message, env = {}) => run(root, env, 'commit', '-q', '--allow-empty', '-m', message)
const at = (iso) => ({ GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso })
const today = () => new Date().toISOString().slice(0, 10)

test('unmerged finds work on a branch not in HEAD, keyed by item ID', (t) => {
  const root = workspace(t, englishShop(), { git: true })
  run(root, {}, 'checkout', '-q', '-b', 'feature')
  commit(root, 'feat: SHOP-API-002 retries')
  run(root, {}, 'checkout', '-q', 'main')
  commit(root, 'feat: SHOP-API-001 export')
  const found = unmerged(root)
  assert.equal(found.get('SHOP-API-002')[0].branch, 'feature')
  assert.equal(found.get('SHOP-API-002')[0].subject, 'feat: SHOP-API-002 retries')
  assert.equal(found.has('SHOP-API-001'), false, 'a commit already in HEAD is not elsewhere')
})

test('commitsFor merges one search per ID, newest first, capped at n', (t) => {
  const root = workspace(t, englishShop(), { git: true })
  commit(root, 'feat: SHOP-API-001 export', at('2026-01-05T10:00:00Z'))
  commit(root, 'fix: OLD-001 health', at('2026-02-05T10:00:00Z'))
  const both = commitsFor(root, ['SHOP-API-001', 'OLD-001'])
  assert.equal(both.length, 2)
  assert.match(both[0], /^\w+ 2026-02-05 fix: OLD-001 health$/)
  assert.match(both[1], /^\w+ 2026-01-05 feat: SHOP-API-001 export$/)
  assert.equal(commitsFor(root, ['SHOP-API-001', 'OLD-001'], 1).length, 1)
  assert.deepEqual(commitsFor(root, ['NOPE-001']), [])
})

test('gitState: clean, then dirty with owners relative to the workspace', (t) => {
  const root = workspace(t, englishShop(), { git: true })
  const ws = loadWorkspace(root)
  const project = ws.projects[0]
  const clean = gitState(project, project.tree, ws.root)
  assert.equal(clean.status, 'clean')
  assert.equal(clean.branch, 'main')
  assert.equal(clean.commit.subject, 'docs: initial backlog')
  appendFileSync(join(root, 'projects/mobile/todo/ui.md'), '- [ ] [MOBILE-UI-002] `[code]` More\n')
  appendFileSync(join(root, 'todo/api.md'), '- [ ] [SHOP-API-004] `[code]` More\n')
  const dirty = gitState(project, project.tree, ws.root)
  assert.equal(dirty.status, 'dirty')
  const byPath = Object.fromEntries(dirty.dirty.map((d) => [d.path, d]))
  assert.equal(byPath['projects/mobile/todo/ui.md'].owner, 'MOBILE')
  assert.equal(byPath['projects/mobile/todo/ui.md'].backlog, 'MOBILE-UI')
  assert.equal(byPath['todo/api.md'].owner, 'general')
  assert.equal(byPath['todo/api.md'].backlog, 'SHOP-API')
  assert.equal(byPath['todo/api.md'].status, 'M')
})

// A folder with no repository: stop git from finding an enclosing one.
function withoutGit(t, spec) {
  const root = workspace(t, spec)
  const before = process.env.GIT_CEILING_DIRECTORIES
  process.env.GIT_CEILING_DIRECTORIES = realpathSync(dirname(root))
  t.after(() => {
    if (before === undefined) delete process.env.GIT_CEILING_DIRECTORIES
    else process.env.GIT_CEILING_DIRECTORIES = before
  })
  return root
}

test('a folder without git: no-git, empty unmerged, null git(), ages from mtime', (t) => {
  const root = withoutGit(t, flat())
  const ws = loadWorkspace(root)
  const project = ws.projects[0]
  assert.equal(git(root, ['log']), null)
  assert.equal(gitRoot(root), null)
  assert.deepEqual(gitState(project, project.tree, ws.root), { status: 'no-git', branch: null, commit: null, dirty: [] })
  assert.equal(unmerged(root).size, 0)
  assert.deepEqual(commitsFor(root, ['SHOP-001']), [])
  assert.equal(lastModified(root, 'TODO.md'), null)
  const later = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10)
  const ages = lineAges(root, 'TODO.md', later)
  assert.equal(ages.size, 15)
  assert.ok([...ages.values()].every((d) => d >= 4 && d <= 5))
})

test('git init without commits: no-commits, empty unmerged, ages from mtime', (t) => {
  const root = workspace(t, flat())
  execFileSync('git', ['-C', root, 'init', '-q', '-b', 'main'], { stdio: 'ignore' })
  const ws = loadWorkspace(root)
  const project = ws.projects[0]
  const state = gitState(project, project.tree, ws.root)
  assert.equal(state.status, 'no-commits')
  assert.equal(state.commit, null)
  assert.equal(state.branch, 'main')
  assert.equal(unmerged(root).size, 0)
  const ages = lineAges(root, 'TODO.md', today())
  assert.equal(ages.size, 15)
  assert.ok([...ages.values()].every((d) => d <= 1))
})

test('lineAges: committed lines aged by commit date, added uncommitted line is 0', (t) => {
  const root = workspace(t, flat())
  execFileSync('git', ['-C', root, 'init', '-q', '-b', 'main'], { stdio: 'ignore' })
  run(root, {}, 'add', '-A')
  run(root, at('2026-01-10T12:00:00Z'), 'commit', '-q', '-m', 'init')
  assert.equal(lastModified(root, 'TODO.md'), '2026-01-10')
  appendFileSync(join(root, 'TODO.md'), '- [ ] [SHOP-005] `[code]` New\n')
  const ages = lineAges(root, 'TODO.md', '2026-01-20')
  assert.equal(ages.get(0), 10)
  assert.equal(ages.get(14), 10)
  assert.equal(ages.get(15), 0)
  assert.equal(ages.size, 16)
})

test('lineAges: an untracked file in a repository ages from its mtime', (t) => {
  const root = workspace(t, flat(), { git: true })
  writeFileSync(join(root, 'new.md'), 'a\nb\n')
  const ages = lineAges(root, 'new.md', today())
  assert.equal(ages.size, 2)
  assert.ok(ages.get(1) <= 1)
})

const shopIn = (folder) => Object.fromEntries(Object.entries(englishShop()).map(([path, text]) => [`${folder}/${path}`, text]))
const dirtyByPath = (state) => Object.fromEntries(state.dirty.map((d) => [d.path, d]))

test('gitState: project in a subfolder of a larger repository keeps workspace-relative paths', (t) => {
  const root = workspace(t, { ...shopIn('shop'), 'other/readme.md': 'x\n' }, { git: true })
  const ws = loadWorkspace(root)
  const project = ws.projects.find((p) => p.rel === 'shop')
  assert.notEqual(gitRoot(project.root), null)
  appendFileSync(join(root, 'shop/projects/mobile/todo/ui.md'), '- [ ] [MOBILE-UI-002] `[code]` More\n')
  appendFileSync(join(root, 'shop/todo/api.md'), '- [ ] [SHOP-API-004] `[code]` More\n')
  appendFileSync(join(root, 'other/readme.md'), 'y\n')
  const found = dirtyByPath(gitState(project, project.tree, ws.root))
  assert.deepEqual(Object.keys(found).sort(), ['shop/projects/mobile/todo/ui.md', 'shop/todo/api.md'])
  assert.equal(found['shop/projects/mobile/todo/ui.md'].owner, 'MOBILE')
  assert.equal(found['shop/projects/mobile/todo/ui.md'].backlog, 'MOBILE-UI')
  assert.equal(found['shop/todo/api.md'].owner, 'general')
  assert.equal(found['shop/todo/api.md'].backlog, 'SHOP-API')
})

test('gitState: workspace reached through a differently-cased path or a symlink', (t) => {
  const root = workspace(t, englishShop(), { git: true })
  appendFileSync(join(root, 'projects/mobile/todo/ui.md'), '- [ ] [MOBILE-UI-002] `[code]` More\n')
  const spellings = []
  if (process.platform === 'win32' || process.platform === 'darwin') spellings.push(join(dirname(root), basename(root).toUpperCase()))
  const link = join(dirname(root), `${basename(root)}-link`)
  try {
    symlinkSync(root, link, 'junction')
    t.after(() => { try { unlinkSync(link) } catch { /* already gone */ } })
    spellings.push(link)
  } catch {
    /* links not allowed here: the casing spelling still runs where it applies */
  }
  if (spellings.length === 0) return t.skip('no alternative spelling available on this platform')
  for (const spelling of spellings) {
    const ws = loadWorkspace(spelling)
    const state = gitState(ws.projects[0], ws.projects[0].tree, ws.root)
    const entry = dirtyByPath(state)['projects/mobile/todo/ui.md']
    assert.ok(entry, `path relative to the workspace for ${spelling}`)
    assert.equal(entry.owner, 'MOBILE')
    assert.equal(entry.backlog, 'MOBILE-UI')
  }
})

test('gitState: non-ASCII and renamed paths come out unquoted and once', (t) => {
  const root = workspace(t, { ...flat(), 'notes/old.md': 'a\n' }, { git: true })
  mkdirSync(join(root, 'caffè'))
  writeFileSync(join(root, 'caffè/menù.md'), 'x\n')
  run(root, {}, 'mv', 'notes/old.md', 'notes/new.md')
  const ws = loadWorkspace(root)
  const found = dirtyByPath(gitState(ws.projects[0], ws.projects[0].tree, ws.root))
  assert.ok(found['caffè/menù.md'])
  assert.equal(found['notes/new.md'].status, 'R')
  assert.equal(found['notes/old.md'], undefined)
})

test('commitsFor orders by commit time, not by date string', (t) => {
  const root = workspace(t, flat(), { git: true })
  commit(root, 'feat: SHOP-001 a', at('2026-03-01T08:00:00Z'))
  commit(root, 'feat: SHOP-001 b', at('2026-03-01T20:00:00Z'))
  assert.match(commitsFor(root, ['SHOP-001'])[0], / feat: SHOP-001 b$/)
})
