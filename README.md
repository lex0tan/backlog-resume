# backlog

A Claude Code plugin that resumes work from a plain Markdown backlog. It reads your `TODO.md` files, checks them against git and the repository, tells you the **verified** state and **one** next step, and opens a side panel to pick the item to work on. Nothing is stored outside your files.

```
┌ Backlog · whole workspace ─────────────────────────────────┐
│ Claude can do · 6                                           │
│ 8 open items. Pick a project:                               │
│  1  shop · 6 (1 blocked) · main · 3f9a1c2 · clean           │
│  2  docs · 2                                                │
│ [Unblock first]  [New item]  [Waiting on you · 1]           │
│ ┌ Today · Sunday, 1 November ───────────────────────────┐   │
│ │ ✓ Nothing due today.                                  │   │
│ │ Tomorrow · Monday, 2 November — Nothing planned.      │   │
│ └───────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Requirements

- Claude Code (terminal, desktop app or IDE extension)
- Node.js 20 or newer (the script uses only the standard library)
- git is optional: without it item ages fall back to file times and commit checks are skipped

## Install

```
/plugin install backlog --marketplace <owner>/<repo>
```

or from a shell:

```
claude plugin install backlog --marketplace <owner>/<repo>
```

`<owner>/<repo>` is the GitHub repository that holds this plugin. The desktop app installs it from the same marketplace.

## Quick start

1. In your project folder run `/backlog init`. It creates a `TODO.md` (and a `.backlog.json`) in the model below.
   Already have notes? `/backlog adopt` finds backlog-like files and proposes how to bring them into the model; nothing is written until you agree.
2. Run `/backlog` to open the panel, or ask in plain words: `/backlog resume the website`, `/backlog plan API`, `/backlog do API-002`.

There is a small workspace to try it on in [`examples/demo`](examples/demo).

## The backlog model

A backlog grows in three steps; every step is plain Markdown and the plugin reads all of them.

**1. Flat.** One `TODO.md`:

```markdown
# Shop

## Status

- Next: `SHOP-002`

- [ ] [SHOP-002] `[code]` Product list
  Done when: the list renders
- [ ] [SHOP-003] `[decision]` Payment provider
  Depends on: `SHOP-002`
```

**2. Indexed.** `TODO.md` becomes an index with a table of workstreams, each in its own file:

```markdown
| ID | Name | File | Status | Block | Alias |
|---|---|---|---|---|---|
| `API` | Backend API | `todo/api.md` | in progress | — | api, backend |
| `WEB` | Website | `todo/web.md` | open | — | web, site |
```

**3. Subprojects.** A section titled `Subprojects` with the same table, pointing at the index of a folder that has its own backlog (`mobile/TODO.md`). Those can nest, up to `maxDepth` levels.

Rules the plugin relies on:

- **A finished item is removed.** History lives in `git log`; the file only holds what is open. `/backlog` removes an item with the `done` command and moves `Next:` along.
- **IDs are unique in the workspace.** Use `project:ID` to name one when in doubt. `split` renumbers a flat backlog into workstreams (`SHOP-001` becomes `SHOP-API-001`) and keeps the old ID in a `Was:` line so old commits still match.
- **Types** go in backticks after the ID: `[code]`, `[content]`, `[decision]`, `[blocked]`… Any word works; `decision` and `blocked` have a meaning, see below.
- **Sub-lines** under an item: `Done when:` (the check that proves it is finished), `Depends on:`, `Blocks:`, `From: YYYY-MM-DD` (not before this date) and `Was:`.
- **Parts** are indented checkboxes under an item. A part starting with `User:` is a step only you can do.
- **Waiting on you:** an item of type `decision`, or one whose open parts are all `User:` steps, is listed apart from the work Claude can do.
- **Dependency cycles** are detected and shown with the chain that closes them.

## Commands

`/backlog` opens the panel. `/backlog <mode> <request>` runs the `session` skill:

| Mode | What it does |
|---|---|
| `audit` | Verified state of the scope, with what could not be verified |
| `resume` | The state and one concrete next step |
| `plan` | Plans a workstream from its open items |
| `do` | Works one item by ID, then stops |
| `adopt` | Brings an existing backlog into the model |
| `init` | Sets up a backlog in the current folder |
| `split` | Splits a flat backlog into workstreams |

The script behind it prints JSON and can be run on its own: `node scripts/backlog.mjs <command>`.

| Command | Purpose |
|---|---|
| `route "<request>"` | Which project, workstream and item a request is about |
| `item <ID>` | One item with its context and the commits that cite it |
| `list [--project P]` | Projects, workstreams and open items |
| `summary` | Numbers per project, plus backlogs to adopt |
| `files` | Every backlog file of the workspace |
| `git [project]` | Branch, last commit and changed files per project |
| `check [--project P] [--fast]` | Consistency check (`--fast` skips what needs git) |
| `done <ID>` | Remove a finished item |
| `add <project or workstream> <type> <text>` | Append an item |
| `overview [--write]` | The generated overview block |
| `init`, `split`, `adopt scan`, `adopt write` | Set up and migrate |

Common options: `--cwd DIR`, `--project P`, `--dry-run`, `--input FILE`, `--today YYYY-MM-DD`.

## Configuration

Everything has a default. Put overrides in a `.backlog.json` at the workspace root (the outermost one wins as root; a project's own file overrides the workspace's):

```json
{
  "language": "en",
  "keywords": {},
  "exclude": [],
  "maxDepth": 4,
  "projects": [],
  "aliases": [],
  "prefix": null,
  "overview": null,
  "staleDays": 30,
  "overdueDays": 3,
  "lockMinutes": 5,
  "typeOrder": [],
  "index": "TODO.md"
}
```

| Key | Meaning |
|---|---|
| `language` | Keyword and panel language (`en`, `it`) |
| `keywords` | Overrides for single keywords, e.g. `{ "next": "Up next:" }` |
| `exclude` | Folders the project scan skips, on top of the built-in ones (`node_modules`, `.git`, `dist`, `build`, `vendor`, virtual environments…) |
| `maxDepth` | How deep the scan looks for projects |
| `projects`, `aliases` | Register folders the scan misses; extra names for routing |
| `prefix` | ID prefix for new items |
| `overview` | A file whose block between `<!-- backlog:start -->` and `<!-- backlog:end -->` is generated |
| `staleDays` | An item untouched this long is flagged stale |
| `overdueDays` | A `From:` date this far in the past makes the item overdue |
| `lockMinutes` | How long a silent session keeps its item before it counts as orphaned |
| `typeOrder` | Order of item types in the panel |
| `index` | Name of the index file |

To add a language, copy `lang/en.json` to `lang/<code>.json` and translate the keywords, messages and panel texts.

## The panel

`/backlog` shows the agenda (items with a `From:` date), then projects → areas → types → items. From an item you can read its detail, see what blocks it and what it unblocks, work on it, or mark it done. **Unblock first** lists the items that hold up most others, **New item** appends one, and a search box finds items by ID or words. **Waiting on you** lists decisions and your own steps.

**Work on it** sends Claude the whole item in one prompt and makes it this session's active item: the status line shows it with its parts and the time spent, and when the model removes it from the file the session closes it and reports the files left uncommitted.

### Several sessions

Each session keeps its active item in the plugin's store with a heartbeat every minute. An item another live session holds is marked *in progress elsewhere* and cannot be taken. If a session goes silent for `lockMinutes` its item becomes an **orphan**: the next session in the same workspace is told, and the panel offers **Resume** or **Release**. Orphans are never taken automatically.

## Guards

While an item is active, three hooks keep the session on track. None of them blocks an edit or a commit.

- **Read guard.** The prompt already carries the item, so reading other backlog files is refused; only the item's file and its indexes stay open.
- **Check after an edit.** When Claude edits a backlog file, the plugin runs `check --fast` before and after and reports only the new issues back as context.
- **Commit reminder.** A commit that does not cite the active item's ID gets a reminder afterwards.

## Development

```
node --test test/*.test.mjs   # script and example tests
claude plugin test .          # panel and guard tests
claude plugin validate .
```

Layout: `scripts/` (the CLI, standard library only), `skills/session/` (instructions for Claude), `hooks/` (panel, session state, guards), `lang/` (keywords and texts per language), `examples/demo/`.

## License

MIT, see [LICENSE](LICENSE).
