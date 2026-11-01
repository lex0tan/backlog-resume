// Command-line interface: parses arguments, calls one command and prints its result as JSON.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BacklogError, InvalidInputError, InvalidJsonError, UsageError } from './errors.mjs'
import { gitState } from './git.mjs'
import { loadWorkspace } from './workspace.mjs'
import { route } from './routing.mjs'
import { leaves } from './tree.mjs'
import { add } from './commands/add.mjs'
import { adoptScan, adoptWrite } from './commands/adopt.mjs'
import { check } from './commands/check.mjs'
import { done } from './commands/done.mjs'
import { files } from './commands/files.mjs'
import { init } from './commands/init.mjs'
import { item } from './commands/item.mjs'
import { list } from './commands/list.mjs'
import { overview } from './commands/overview.mjs'
import { pickProject, todayIso } from './commands/shared.mjs'
import { split } from './commands/split.mjs'
import { summary } from './commands/summary.mjs'

export const USAGE = `Usage: backlog <command> [args] [options]

Commands:
  route "<request>"                      find the item or workstream a request refers to
  item <ID>                              one item with its context
  list                                   projects and workstreams
  summary                                state of the workspace
  files                                  backlog files of the workspace
  done <ID>                              close an item
  add <project|workstream> <type> <text> append an item
  git [project]                          git state per project
  check                                  consistency check
  overview [--write]                     the generated overview block
  init [--language it] [--prefix X] [--workspace]
  split <project> --input FILE           split a flat backlog into workstreams
  adopt scan                             find backlogs to adopt
  adopt write --input FILE               write an adopted backlog

Options:
  --cwd DIR  --project P  --write  --fast  --dry-run  --input FILE  --today YYYY-MM-DD
`

const COMMANDS = ['route', 'item', 'list', 'summary', 'files', 'done', 'add', 'git', 'check', 'overview', 'split', 'adopt']
// A real calendar date: 2030-99-99 matches the shape but is not one.
const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s
const VALUE_FLAGS = new Set(['cwd', 'project', 'input', 'today', 'language', 'prefix'])
const BOOL_FLAGS = new Set(['write', 'fast', 'dry-run', 'workspace'])

/** @returns {{ positional: string[], flags: Record<string, string|boolean> }} */
function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const name = arg.slice(2)
    if (BOOL_FLAGS.has(name)) flags[name] = true
    else if (VALUE_FLAGS.has(name)) {
      if (i + 1 >= argv.length) throw new UsageError(`Option --${name} needs a value`)
      flags[name] = argv[++i]
    } else throw new UsageError(`Unknown option: ${arg}`)
  }
  return { positional, flags }
}

function readJson(file, cwd) {
  if (!file) throw new UsageError('This command needs --input FILE')
  let text
  try {
    text = readFileSync(resolve(cwd, file), 'utf8')
  } catch (err) {
    throw new InvalidInputError('input', `cannot read ${file}: ${err.code ?? err.message}`)
  }
  try {
    return JSON.parse(text.replace(/^﻿/, ''))
  } catch (err) {
    throw new InvalidJsonError(file, err.message)
  }
}

function need(args, n, what) {
  if (args.length < n) throw new UsageError(`Missing ${what}`)
}

/** Resolves the `add` target: a workstream ID or alias anywhere in the workspace, or else a project name. */
function addTarget(ws, target, projectFlag) {
  if (projectFlag) return { project: projectFlag, workstream: target }
  const same = (a, b) => a.toLowerCase() === b.toLowerCase()
  const hits = ws.projects.flatMap((p) => leaves(p.tree)
    .filter((n) => same(n.id, target) || n.aliases.some((a) => same(a, target)))
    .map((n) => ({ project: p, node: n })))
  if (hits.length > 1) throw new InvalidInputError('workstream', `ambiguous: ${target} (use --project)`)
  if (hits.length === 1) {
    const { project, node } = hits[0]
    return { project: project.rel === '.' ? project.name : project.rel, workstream: node.id }
  }
  return { project: target }
}

/**
 * @param {string[]} argv arguments after the script name
 * @param {{ cwd?: string, stdout?: { write(s: string): unknown }, stderr?: { write(s: string): unknown } }} [io]
 * @returns {number} exit code
 */
export function main(argv, { cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {}) {
  const print = (value) => stdout.write(`${JSON.stringify(value, null, 2)}\n`)
  try {
    const { positional, flags } = parseArgs(argv)
    const [command, ...rest] = positional
    if (!command) throw new UsageError('Missing command')
    if (command !== 'init' && !COMMANDS.includes(command)) throw new UsageError(`Unknown command: ${command}`)
    if (flags.today && !validDate(flags.today)) throw new UsageError('--today expects YYYY-MM-DD')
    const base = resolve(cwd, flags.cwd ?? '.')
    const today = flags.today ?? todayIso()
    const input = () => readJson(flags.input, base)

    if (command === 'init') {
      print(init(base, { language: flags.language, prefix: flags.prefix, workspace: Boolean(flags.workspace) }))
      return 0
    }
    if (command === 'adopt' && !['scan', 'write'].includes(rest[0])) throw new UsageError('adopt needs "scan" or "write"')

    const ws = loadWorkspace(base)
    let result
    switch (command) {
      case 'route': need(rest, 1, 'request'); result = route(ws, rest.join(' ')); break
      case 'item': need(rest, 1, 'item ID'); result = item(ws, rest[0], today); break
      case 'list': result = list(ws, today, { project: flags.project }); break
      case 'summary': result = summary(ws, today); break
      case 'files': result = files(ws); break
      case 'done': need(rest, 1, 'item ID'); result = done(ws, rest[0]); break
      case 'add': {
        need(rest, 3, 'target, type and text')
        const [target, type, ...text] = rest
        result = add(ws, { ...addTarget(ws, target, flags.project), type, text: text.join(' ') })
        break
      }
      case 'git': {
        const name = rest[0] ?? flags.project
        const projects = name ? [pickProject(ws, name)] : ws.projects
        result = { status: 'ok', projects: projects.map((p) => ({ project: p.rel, ...gitState(p, p.tree, ws.root) })) }
        break
      }
      case 'check': result = check(ws, { project: flags.project, fast: Boolean(flags.fast), today }); break
      case 'overview': result = overview(ws, Boolean(flags.write)); break
      case 'split': need(rest, 1, 'project'); result = split(ws, rest[0], input(), { dryRun: Boolean(flags['dry-run']) }); break
      case 'adopt':
        result = rest[0] === 'scan' ? adoptScan(ws) : adoptWrite(ws, { ...input(), dryRun: Boolean(flags['dry-run']) })
        break
    }
    print(result)
    return 0
  } catch (err) {
    if (err instanceof UsageError) {
      stderr.write(`${err.message}\n\n${USAGE}`)
      return 2
    }
    if (err instanceof BacklogError) {
      print(err.toJSON())
      return 1
    }
    print({ status: 'error', code: 'InternalError', message: err?.message ?? String(err), stack: err?.stack })
    return 1
  }
}
