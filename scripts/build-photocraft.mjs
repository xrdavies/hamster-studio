// Builds the bundled PSD editor (photocraft-cli) at the revision pinned in
// src-tauri/photocraft.json and places it where Tauri expects a sidecar.
// HAMSTER_PHOTOCRAFT_SRC=/path/to/checkout builds a local checkout instead.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(import.meta.url), '../..')
const binaries = join(root, 'src-tauri/binaries')
const target = 'aarch64-apple-darwin'
const LICENSES = ['LICENSE-MIT', 'LICENSE-APACHE', 'NOTICE']

export function readPin(text) {
  const pin = JSON.parse(text)
  if (!/^[0-9a-f]{40}$/.test(pin.rev))
    throw new Error('photocraft.json: rev must be a full commit hash')
  if (!/^https:\/\//.test(pin.repo)) throw new Error('photocraft.json: repo must be an https URL')
  if (!/^\d+\.\d+\.\d+$/.test(pin.toolchain)) throw new Error('photocraft.json: invalid toolchain')
  return pin
}

const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: 'inherit' })

function checkout(pin) {
  const source = join(root, 'src-tauri/target/photocraft-src')
  mkdirSync(source, { recursive: true })
  if (!existsSync(join(source, '.git'))) run('git', ['init', '-q'], source)
  run('git', ['fetch', '-q', '--depth', '1', pin.repo, pin.rev], source)
  run('git', ['checkout', '-q', '--force', pin.rev], source)
  return source
}

export function build() {
  const pin = readPin(readFileSync(join(root, 'src-tauri/photocraft.json'), 'utf8'))
  const local = process.env.HAMSTER_PHOTOCRAFT_SRC
  const output = join(binaries, `photocraft-cli-${target}`)
  const stamp = join(binaries, 'photocraft.rev')
  if (
    !local &&
    existsSync(output) &&
    existsSync(stamp) &&
    readFileSync(stamp, 'utf8') === pin.rev
  ) {
    console.log(`photocraft-cli ${pin.rev.slice(0, 8)} is up to date`)
    return output
  }
  const source = local ? resolve(local) : checkout(pin)
  run('rustup', ['toolchain', 'install', pin.toolchain, '--profile', 'minimal'], source)
  run(
    'cargo',
    [
      `+${pin.toolchain}`,
      'build',
      '--release',
      '--locked',
      '-p',
      'photocraft-cli',
      '--target',
      target,
    ],
    source,
  )
  mkdirSync(join(binaries, 'licenses/photocraft'), { recursive: true })
  copyFileSync(join(source, 'target', target, 'release/photocraft-cli'), output)
  for (const file of LICENSES)
    if (existsSync(join(source, file)))
      copyFileSync(join(source, file), join(binaries, 'licenses/photocraft', file))
  writeFileSync(stamp, local ? 'local' : pin.rev)
  return output
}

if (process.argv[1] === fileURLToPath(import.meta.url)) build()
