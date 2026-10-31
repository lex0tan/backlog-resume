#!/usr/bin/env node
// Entry point: node scripts/backlog.mjs <command> [args]. See lib/cli.mjs.

import { main } from './lib/cli.mjs'

process.exitCode = main(process.argv.slice(2))
