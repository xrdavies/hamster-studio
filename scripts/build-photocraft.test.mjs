import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readPin } from './build-photocraft.mjs'

test('the PSD editor is pinned to an exact commit', () => {
  const pin = readPin(readFileSync('src-tauri/photocraft.json', 'utf8'))
  assert.match(pin.rev, /^[0-9a-f]{40}$/)
  const valid = {
    repo: 'https://github.com/storytold/photocraft.git',
    rev: 'a'.repeat(40),
    toolchain: '1.95.0',
  }
  for (const change of [
    { rev: 'main' },
    { rev: 'abc123' },
    { repo: 'git@github.com:x/y' },
    { toolchain: 'stable' },
  ])
    assert.throws(() => readPin(JSON.stringify({ ...valid, ...change })))
})
