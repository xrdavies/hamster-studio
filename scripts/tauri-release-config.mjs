import { writeFileSync } from 'node:fs'
const pubkey = process.env.TAURI_UPDATER_PUBLIC_KEY?.trim()
if (!pubkey) throw new Error('Missing TAURI_UPDATER_PUBLIC_KEY repository variable')
writeFileSync(
  'src-tauri/release.conf.json',
  JSON.stringify({ bundle: { createUpdaterArtifacts: true }, plugins: { updater: { pubkey } } }),
)
