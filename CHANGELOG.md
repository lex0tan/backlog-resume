# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow the release date (`YEAR.MONTH.DAY`, tag `vYEAR.MONTH.DAY`), still valid [Semantic Versioning](https://semver.org/spec/v2.0.0.html) strings.

## [Unreleased]

### Changed
- Every program the panel runs is a fixed command line in `hooks/register.tsx` (the plugin's CLI per subcommand, `git rev-parse HEAD` and `git log -1 --format=%B` in the item's repository); any other command is refused.
- The README says, call by call, what the plugin runs, reads, submits and stores. The demo GIF moved to the `media` branch: the plugin ships no image but its listing icon.

## [2026.11.1] - 2026-11-01

### Fixed
- Backlog files are written atomically (temporary file, then rename) and `done` / `add` run under a per-file lock, so two sessions closing or adding items in the same file no longer overwrite each other or get the same ID. A lock older than 30 seconds is taken over.
- One definition of an item ID (`scripts/lib/ids.mjs`): a number of three or more digits everywhere, so `X-1000` is read the same way by every command.

### Added
- The status line of the item in progress is drawn in colour beside the prompt hint (terminal and desktop app): item in yellow, a green bar of the parts done, the done line in green and uncommitted files in yellow. It moves after every edit and command and once a minute, not only at the end of a turn, and shows the parts from the moment the item is taken. Other surfaces keep the plain status line.
- Optional archive of closed items (`archive` in `.backlog.json`): `done` keeps each closed item, with its sub-lines and the closing date, in `<archive>/YYYY-MM.md`; `add` never reuses an archived ID.
- Plugin manifest and marketplace entry; standard-library Node script (`scripts/backlog.mjs`) that prints JSON.
- Backlog model in Markdown: flat file, indexed workstreams, nested subprojects; items with types, `Done when:`, `Depends on:`, `Blocks:`, `From:`, `Was:` and parts (`User:` steps).
- Workspace discovery with a layered `.backlog.json`, automatic project scan (symlink-safe, case-insensitive aware) and candidates to adopt.
- Languages as files in `lang/` (English, Italian) with per-key keyword overrides.
- Three-level routing of a request to a project, workstream and item.
- Commands: `route`, `item`, `list`, `summary`, `files`, `git`, `check`, `done`, `add`, `overview`, `init`, `split`, `adopt`.
- Dependency graph with cycle detection and the chain that closes each cycle.
- Consistency check: duplicate IDs, dangling links, missing criteria, stale items, overview drift, missing indexes.
- `split` renumbers a flat backlog into workstreams and keeps the old ID in `Was:`.
- `session` skill (`/backlog-resume:session`) with the modes audit, resume, plan, do, adopt, init and split.
- `/backlog-resume` side panel: agenda, projects, areas, types, items, search, unblock-first list, new item, done with confirmation, and a separate "Waiting on you" view.
- Active item per session with a status line, end-of-turn release and a "done today" count.
- Locks between sessions with a heartbeat; orphaned items are proposed with Resume / Release and never taken automatically.
- Guards: read guard while an item is active, `check --fast` after an edit of a backlog file, and a commit reminder when the active item's ID is missing.
- Example workspace in `examples/demo` and a CI workflow.
