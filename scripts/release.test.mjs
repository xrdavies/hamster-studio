import { test } from 'vitest'
import assert from 'node:assert/strict'
import { release, updateRustVersion } from './release.mjs'

function runner(fail = '') {
  const calls = []
  return {
    calls,
    execute(command, args) {
      const line = [command, ...args].join(' ')
      calls.push(line)
      if (line === fail) throw new Error('simulated failure')
      return line === 'git branch --show-current' ? 'main' : ''
    },
  }
}
test('bumps versions, does not build locally and atomically pushes only the release tag', () => {
  for (const [target, version] of [
    ['patch', '1.2.4'],
    ['minor', '1.3.0'],
    ['major', '2.0.0'],
    ['2.1.0', '2.1.0'],
  ]) {
    const fake = runner()
    release(
      target,
      fake.execute,
      () => '1.2.3',
      () => {},
    )
    assert.ok(fake.calls.includes(`npm version ${version} --no-git-tag-version --ignore-scripts`))
    assert.deepEqual(
      fake.calls.filter((line) => line.startsWith('npm ')),
      [`npm version ${version} --no-git-tag-version --ignore-scripts`],
    )
    assert.equal(fake.calls.at(-1), `git push --atomic origin main refs/tags/v${version}`)
  }
})
test('invalid or decreasing versions never change version files', () => {
  for (const target of ['--help', '1.2.3', '0.9.9', '1.2.3-beta', '01.2.4']) {
    const fake = runner()
    assert.throws(() =>
      release(
        target,
        fake.execute,
        () => '1.2.3',
        () => {},
      ),
    )
    assert.ok(!fake.calls.some((line) => line.startsWith('npm version')))
  }
})
test('failed version update never commits, tags or pushes', () => {
  const fake = runner('npm version 1.2.4 --no-git-tag-version --ignore-scripts')
  assert.throws(() =>
    release(
      'patch',
      fake.execute,
      () => '1.2.3',
      () => {},
    ),
  )
  assert.ok(!fake.calls.some((line) => /^git (commit|tag -a|push)/.test(line)))
})
test('dirty worktree and existing tags stop before modifying version', () => {
  for (const stop of ['git status --porcelain', 'git tag --list v1.2.4']) {
    const fake = runner()
    assert.throws(() =>
      release(
        'patch',
        (command, args) => {
          const result = fake.execute(command, args)
          return [command, ...args].join(' ') === stop ? 'exists' : result
        },
        () => '1.2.3',
        () => {},
      ),
    )
    assert.ok(!fake.calls.some((line) => line.startsWith('npm version')))
  }
})

test('synchronizes only the application Cargo version', () => {
  const files = new Map([
    [
      'src-tauri/Cargo.toml',
      '[package]\nname = "hamster-studio"\nversion = "0.0.1"\n[dependencies]\nserde = "1"',
    ],
    [
      'src-tauri/Cargo.lock',
      '[[package]]\nname = "other"\nversion = "9.0.0"\n[[package]]\nname = "hamster-studio"\nversion = "0.0.1"',
    ],
  ])
  updateRustVersion(
    '0.0.2',
    (file) => files.get(file),
    (file, content) => files.set(file, content),
  )
  assert.ok(files.get('src-tauri/Cargo.toml').includes('version = "0.0.2"'))
  assert.ok(files.get('src-tauri/Cargo.lock').includes('name = "other"\nversion = "9.0.0"'))
  assert.ok(
    files.get('src-tauri/Cargo.lock').includes('name = "hamster-studio"\nversion = "0.0.2"'),
  )
})
