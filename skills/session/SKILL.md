---
name: session
description: Verified status of a backlog scope (workspace, project, subproject or workstream) and one concrete next step, loading only the relevant backlog. Use to resume a session, for "where are we", "what's next", "what should I do now", "a che punto siamo", "cosa faccio dopo", to plan a workstream, run an item by ID, adopt an unformatted backlog, or set one up.
argument-hint: "[audit|resume|plan|do|adopt|init|split] <scope, request or ID>"
user-invocable: false
---

# Backlog session

Rebuild the **verified** state of the requested scope and name **one** next step. The sources are the backlog (Markdown files), git and the repository: no memory of your own, no new state file. A state you cannot verify is reported as "not verifiable", never inferred.

Answer in the language of the conversation. The script's keywords (`Next:`, `Depends on:`, `Done when:`, ...) follow the workspace language; copy them as the existing files spell them.

## The script

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/backlog.mjs" <command>`. If `${CLAUDE_PLUGIN_ROOT}` is not expanded, use the `scripts/backlog.mjs` two folders above this skill's base directory. It prints JSON and finds the workspace root itself, wherever the session started. It needs only Node.

| Command | Purpose |
|---|---|
| `route "<request>"` | Which project, workstream and item a request is about, and which files to read |
| `item <ID>` | One item with its evidence (`project:ID` when the same ID exists in several projects) |
| `list` | Projects, workstreams and open items; `--project P` limits it to one project |
| `summary` | One line of numbers per project, plus backlog candidates to adopt |
| `git [project]` | Branch, last commit and changed files with their owner |
| `check` | Consistency check; `--project P` limits it, `--fast` skips the slow git checks |
| `done <ID>` | Close an item: removes it and moves the `Next:` pointer |
| `add <project or workstream> <type> <text>` | Append an item; `--project P` when the workstream name is ambiguous |
| `overview [--write]` | The generated overview block (only when `overview` is configured) |
| `init [--language it] [--prefix X] [--workspace]` | Create a backlog in the current folder |
| `split <project> --input FILE` | Split a flat backlog into workstreams |
| `adopt scan` / `adopt write --input FILE` | Find loose checklists, then write one as a backlog |

Options for all commands: `--cwd DIR`, `--today YYYY-MM-DD` (pretend today is that day), `--dry-run` (`split` and `adopt write`: preview without writing). Errors come back as `{"status": "error", "code": ..., "message": ...}`; report the message.

## Modes

The first argument; without one, `resume`.

| Mode | What it does | Changes |
|---|---|---|
| `audit` | Status report | none |
| `resume` (default) | Report and proposed updates | none without confirmation |
| `plan` | Proposes items, decisions and backlog reordering | none without confirmation |
| `do` | Runs exactly one item and updates its workstream | only the automatic ones, below |
| `adopt` | Turns a loose checklist into a backlog: preview, then `adopt write` | only after confirmation |
| `init` | Sets up a new backlog | the files `init` creates |
| `split` | Proposes a plan of workstreams, previews it with `--dry-run`, writes it | only after confirmation |

When the request ends with a line naming items other sessions are working on right now ("... do not propose or start them: ..."), never propose, plan or start those items: pick the next one that is not listed, and say so in the report.

## Steps (audit, resume, plan, do)

1. **Route.** `route "<request>"` (strip the mode word from the arguments and pass what is left; if nothing is left, run `route ""`, never the mode word itself, because aliases match by substring). The `status` decides:
   - `ok` / `general`: read **exactly** the files in `read`, in order. Files in `excluded` stay closed.
   - `overview`: several projects and no scope given. Run `summary`, report one line per project (`open` count, `overdue` and `due` as lists of IDs, `waiting` and `cycles` counts, `next`) and ask which project to open. Read no backlog.
   - `ambiguous` or `missing-workstream`: ask the script's `question`, once, and stop. Do not open other backlogs to guess.
   - `missing-file`: report the missing files and ask whether to fix the index or create the workstream.
   - `error`: report the message (for example a missing or unreadable index) and stop.
2. **Git.** `git <project>` returns `{status: "ok", projects: [...]}` (all projects without an argument, one with it). Each entry has `project`, its own `status` (`clean`, `dirty`, `no-commits`, `no-git`), `branch`, `commit` and `dirty` (changed files, each with its owner and the backlog node it is). With `no-git` or `no-commits` there is no commit evidence: say so, do not treat it as an error. Local changes are work in progress: read their diff (`git diff --stat`, then only the files relevant to the scope), never `reset` or `checkout`.
3. **Linked items.** For every entry of `linked` and for the `Next:` item: `item <ID>`. It returns text, `doneWhen`, open dependencies (`blockedBy`), commits citing the ID, `parts`, `unmerged`, `when`, `waiting`, `steps`, `stale` and `cycle`. Of another workstream, read only the item, never the whole file. `status` is `open`, `declared-done` (checked but still in the file), `closed` (gone from the backlog, commits cite it) or `not-found`.
   - `unmerged` not empty: commits citing the item sit on branches not merged into the current one. Look there before any work (`git show --stat <hash>`) and report what is already done; propose merging that branch instead of redoing the work.
   - `parts` not empty: `[x]` parts are done, resume from the open ones; re-verify a done part only if the code contradicts it.
   - `when` (from the `From: YYYY-MM-DD` sub-line): `later` = not ripe, do not propose it; `due` = the date has come, takes priority; `overdue` = late by `days`, flag at the top of the report.
   - `cycle` not empty: the item is in a dependency loop. Do not propose it as next step. Report the chain and ask which dependency to remove.
   - `waiting` true: the item waits on the user (a decision, or only user parts left). List it under "Waiting on you" with the exact steps from `steps`; never propose it as work for yourself.
   - `stale` (open longer than `staleDays`): list it under "Stale items" and offer these actions: do it, split or rewrite it, keep it as it is, postpone it with a `From: YYYY-MM-DD` sub-line, or remove it (only after the user confirms).
4. **Verify.** Compare every item under review with reality: diff, commits, cited files, code. Every extra file you open needs a reason, written in the report. Classify:
   - **verified done**: `doneWhen` met and demonstrated (commit, file, test);
   - **in progress**: work exists, criterion not met;
   - **blocked**: `blockedBy` not empty or type `blocked`;
   - **not verifiable**: declared done without evidence, or depends on actions outside the repository (publishing, accounts, phone calls).
5. **Consistency.** `check`, filtered to the scope's files (`--project P`), plus `missingRefs` from the route. Report only verified problems. Issue codes include `missing-file`, `stale-next`, `no-id`, `declared-done`, `no-done-when`, `stale-item`, `duplicate-id`, `ambiguous-link` and `dependency-cycle`; `error` level first.
6. **Next step.** One activity only: an `overdue` or `due` item of the scope (`list` shows `due`); then the index's `Next:` if it is still open, unblocked and not `later`; otherwise the first open, unblocked item of the same workstream, saying why. Skip items that are `waiting` or in a `cycle`.
7. **Report** in the format below. In `do`, run the item (follow the project's own CLAUDE.md for how to verify code), check its criterion, then apply the automatic updates.
8. **Closing.** In `do`, when an item is finished do not take another in the same session: accumulated context is re-read on every call and is the main cost. End the report by suggesting `/clear` and then `/backlog` for the next item, unless the user explicitly asks to continue.

### `do` without a criterion

An item with no `Done when:` line (`check` code `no-done-when`) cannot be run: propose a criterion in the report and write it into the item only after the user confirms. Until it exists, do no work on the item.

## Updates

**Automatic** (only in `do`, only with clear evidence, only in the item's workstream and its indexes):
- an item with several independent parts (several bugs, files, long steps): write them under the item as `  - [ ] part` before starting, and tick each `[x]` **in the same commit** as its code, so an interrupted session resumes from the open ones (if the user picks only some, remove the others or turn them into a new item). A part only the user can do is written `  - [ ] User: step`;
- close the finished item with `done <ID>` once its `Done when:` is verified (history lives in the commit);
- update "Status" and `Next:` in the workstream index and in the top index;
- add file references to an item, or `Depends on:` / `Blocks:` links to items just created;
- `add <workstream> <type> <text>` for follow-up work found while working; it picks the next free ID;
- `overview --write` when `check` reports `overview-stale`; it rewrites only the generated block.

**With confirmation**, in every mode: creating a workstream or a backlog file; moving an item between scopes; changing priority; closing an item without a verifiable criterion; creating product decisions; deleting or archiving items that were not done; touching documentation with architectural consequences; editing the overview outside its generated block.

Commit, push, PR, `reset` and `merge` happen only when the user asks. Cite the item ID in the commit message: it is how later sessions find the evidence.

## `adopt` mode

For a loose checklist (notes, `todo.txt`, an unformatted `TODO.md`) that is not yet in the backlog format.

1. `adopt scan`: candidates with `file`, `kind` and `lines` (`n` is the 1-based line, `checked`). Pick the one the user means; `summary` also lists candidates.
2. Read the candidate. Decide which lines are real open items, give each a lowercase `type` (for example `code`, `content`, `decision`, `blocked`), and write the payload as a JSON file in a temporary folder:

```json
{
  "source": "notes/todo.md",
  "project": "app",
  "mode": "strip",
  "items": [
    { "type": "code", "text": "Fix the login redirect", "doneWhen": "Login returns to the page the user came from", "sourceLines": [4] },
    { "type": "code", "text": "Add rate limiting", "dependsOn": [0], "from": "2026-11-15", "parts": [{ "done": false, "text": "Choose the limits", "user": true }], "sourceLines": [7, 8] }
  ]
}
```

   `source` and `project` are paths relative to the workspace root (`project` defaults to the folder of `source`). `mode`: `replace` writes the backlog and deletes the source, `strip` keeps the source and removes only the lines listed in `sourceLines`. `dependsOn` holds indexes into `items`. IDs are assigned by the script.
3. Preview: `adopt write --input FILE --dry-run` returns `status: "preview"` with the new `file`, the generated `ids`, the `removedLines` and the `backup` path. Show it to the user and ask. Only after confirmation run it again without `--dry-run`: `status` is `adopted`, a backup of the source is kept, and the result includes a `check` of the new backlog. It fails with an error when the target project folder already has an index that is not the source: ask the user whether to adopt into another folder (set `project`) or to append the items to the existing backlog with `add`.

## `init` mode

`init` in the current folder (or `--cwd DIR`) creates `TODO.md` and `.backlog.json` and never overwrites. `--language it` for Italian keywords, `--prefix X` for the ID prefix, `--workspace` to mark the folder as the root of several projects. `status` is `created` or `exists` (nothing to do).

## `split` mode

For a flat project whose `TODO.md` has grown too long.

1. `list --project P` and read the file. Propose a plan: workstreams, each with an `id` (upper case letters, digits, hyphens), `name`, `file` (relative path that does not exist yet), optional `aliases`, and the old IDs of the items it takes. Every item must appear exactly once.
2. Write the plan as JSON in a temporary folder:

```json
{
  "workstreams": [
    { "id": "CORE", "name": "Core", "file": "todo/core.md", "aliases": ["core", "backend"], "items": ["APP-001", "APP-003"] },
    { "id": "SITE", "name": "Website", "file": "todo/site.md", "items": ["APP-002"] }
  ]
}
```

3. Run `split <project> --input FILE --dry-run`: `status: "preview"`, the `files` that would be written and `renamed` (old ID to new ID). Items are renumbered (`APP-001` becomes `CORE-001`), the old ID is kept in a `Was:` sub-line, and every `Depends on:`, `Blocks:` and `Next:` in the workspace that cited an old ID is rewritten. Show the plan and the renames; write only after confirmation (same command without `--dry-run`, `status: "split"`), then run `check`.

## Report

Short. Omit empty sections, except "Next step".

```markdown
# Backlog Resume — <mode>

## Routing
- Scope / project / workstream:
- Read: <file — reason>
- Excluded: <n files, ~<excludedBytes/4> tokens avoided>
- Ambiguity:

## Projects            (only in overview: one line per project from `summary`)
- <project>: <open> open; overdue: <IDs or none>; due: <IDs or none>; <waiting> waiting; <cycles> cycles; next <ID>

## Git state
- Branch, commit, working tree, diff relevant to the scope

## Verified state
<2-3 sentences>

## Done
<ID — evidence>

## In progress
<ID — done, missing, evidence, next step>

## Missing
<ID — title, dependencies, criterion>

## Open decisions
<ID — question, options, consequences, blocked items>

## Waiting on you
<ID — the exact step you must take>

## Stale items
<ID — days open — do it / split or rewrite / keep / postpone with From: / remove>

## Dependency cycles
<A > B > C > A — which dependency to remove>

## Inconsistencies
<verified only: wrong or duplicate backlog entry, obsolete index, missing reference, inconsistent doc, state not verifiable>

## Next step
- ID, action, files involved, completion criterion

## Proposed updates
<diff in words; applied only in do, and only if automatic>

## Where we are
<one sentence; in do, once the item is finished: "Run /clear, then /backlog for the next item.">
```
