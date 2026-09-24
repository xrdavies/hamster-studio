import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const run = (command, args) =>
  (
    execFileSync(command, args, {
      encoding: 'utf8',
      stdio: command === 'npm' ? 'inherit' : ['inherit', 'pipe', 'inherit'],
      maxBuffer: 10 * 1024 * 1024,
    }) || ''
  ).trim()

export function release(
  target,
  execute = run,
  readVersion = () => JSON.parse(readFileSync('package.json', 'utf8')).version,
) {
  if (
    !target ||
    !/^(patch|minor|major|(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.test(target)
  )
    throw new Error('用法：npm run release -- patch|minor|major|1.2.3')
  const git = (...args) => execute('git', args)
  const npm = (...args) => execute('npm', args)
  if (git('branch', '--show-current') !== 'main') throw new Error('请先切换到 main 分支')
  if (git('status', '--porcelain')) throw new Error('请先提交或保存工作区修改')
  git('fetch', 'origin', '--tags')
  git('merge', '--ff-only', 'origin/main')
  const current = readVersion()
  if (!/^\d+\.\d+\.\d+$/.test(current)) throw new Error('当前版本必须为正式版本号')
  const parts = current.split('.').map(Number)
  const level = ['major', 'minor', 'patch'].indexOf(target)
  if (level >= 0) {
    parts[level]++
    for (let i = level + 1; i < 3; i++) parts[i] = 0
  }
  const version = level >= 0 ? parts.join('.') : target
  const next = version.split('.').map(Number)
  const previous = current.split('.').map(Number)
  if (
    next.some((value) => !Number.isSafeInteger(value)) ||
    !next.some(
      (value, i) => value > previous[i] && next.slice(0, i).every((n, j) => n === previous[j]),
    )
  )
    throw new Error('发布版本必须高于当前版本')
  const tag = `v${version}`
  if (git('tag', '--list', tag)) throw new Error(`标签 ${tag} 已存在`)
  npm('ci')
  npm('version', version, '--no-git-tag-version', '--ignore-scripts')
  for (const script of ['format:check', 'typecheck', 'test', 'build:renderer']) {
    console.log(`运行 ${script}…`)
    console.log(npm('run', script))
  }
  git('add', 'package.json', 'package-lock.json')
  git('commit', '-m', `chore(release): prepare ${tag}`)
  git('tag', '-a', tag, '-m', `Release ${tag}`)
  git('push', '--atomic', 'origin', 'main', `refs/tags/${tag}`)
  console.log(`已推送 ${tag}，CI 将创建 Release 草稿。检查安装包后再公开发布。`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3)
      throw new Error('用法：npm run release -- patch|minor|major|1.2.3')
    release(process.argv[2])
  } catch (error) {
    console.error(error.message)
    console.error('发布已停止。请检查 git status 和本地标签；已完成的版本修改、提交和标签会保留。')
    process.exitCode = 1
  }
}
