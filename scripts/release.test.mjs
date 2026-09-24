import { test } from 'vitest'
import assert from 'node:assert/strict'
import { release } from './release.mjs'

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
test('bumps versions, validates before commit and atomically pushes only the release tag', () => {
  for (const [target, version] of [
    ['patch', '1.2.4'],
    ['minor', '1.3.0'],
    ['major', '2.0.0'],
    ['2.1.0', '2.1.0'],
  ]) {
    const fake = runner()
    release(target, fake.execute, () => '1.2.3')
    assert.ok(fake.calls.includes(`npm version ${version} --no-git-tag-version --ignore-scripts`))
    assert.ok(
      fake.calls.indexOf('npm run build:renderer') <
        fake.calls.indexOf('git add package.json package-lock.json'),
    )
    assert.equal(fake.calls.at(-1), `git push --atomic origin main refs/tags/v${version}`)
  }
})
test('invalid or decreasing versions never change version files', () => {
  for (const target of ['--help', '1.2.3', '0.9.9', '1.2.3-beta', '01.2.4']) {
    const fake = runner()
    assert.throws(() => release(target, fake.execute, () => '1.2.3'))
    assert.ok(!fake.calls.some((line) => line.startsWith('npm version')))
  }
})
test('failed verification never commits, tags or pushes', () => {
  const fake = runner('npm run test')
  assert.throws(() => release('patch', fake.execute, () => '1.2.3'))
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
      ),
    )
    assert.ok(!fake.calls.some((line) => line.startsWith('npm version')))
  }
})
