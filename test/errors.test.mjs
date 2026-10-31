import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BacklogError, ConfigError, LanguageNotFoundError, IndexNotFoundError, ItemNotFoundError,
  AmbiguousIdError, WorkstreamNotFoundError, InvalidInputError, UsageError,
} from '../scripts/lib/errors.mjs'

test('ConfigError serializes to the CLI error shape', () => {
  assert.deepEqual(new ConfigError('/w/.backlog.json', 'Unexpected token').toJSON(), {
    status: 'error',
    code: 'ConfigError',
    message: 'Invalid configuration in /w/.backlog.json: Unexpected token',
    file: '/w/.backlog.json',
    reason: 'Unexpected token',
  })
})

test('every error is a BacklogError with code and context', () => {
  const all = [
    new ConfigError('f', 'r'),
    new LanguageNotFoundError('xx', '/lang/xx.json'),
    new IndexNotFoundError('/w/TODO.md'),
    new ItemNotFoundError('A-1'),
    new AmbiguousIdError('A-1', ['a:A-1', 'b:A-1']),
    new WorkstreamNotFoundError('W'),
    new InvalidInputError('type', 'unknown'),
    new UsageError('bad usage'),
  ]
  for (const e of all) {
    assert.ok(e instanceof BacklogError)
    assert.ok(e instanceof Error)
    assert.equal(e.code, e.constructor.name)
    const json = e.toJSON()
    assert.equal(json.status, 'error')
    assert.equal(json.code, e.constructor.name)
    assert.equal(json.message, e.message)
  }
})

test('context fields are spread into the JSON', () => {
  assert.deepEqual(new AmbiguousIdError('A-1', ['a:A-1', 'b:A-1']).toJSON(), {
    status: 'error', code: 'AmbiguousIdError', message: 'Ambiguous ID A-1: a:A-1, b:A-1',
    id: 'A-1', matches: ['a:A-1', 'b:A-1'],
  })
  assert.deepEqual(new UsageError('bad usage').toJSON(), { status: 'error', code: 'UsageError', message: 'bad usage' })
  assert.equal(new ItemNotFoundError('A-1').toJSON().id, 'A-1')
})
