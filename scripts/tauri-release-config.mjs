import { readFileSync, writeFileSync } from 'node:fs'
const pubkey = process.env.TAURI_UPDATER_PUBLIC_KEY?.trim()
if (!pubkey) throw new Error('Missing TAURI_UPDATER_PUBLIC_KEY repository variable')
writeFileSync(
  'src-tauri/release.conf.json',
  JSON.stringify({
    // Release builds bundle the PSD editor sidecar (see src-tauri/bundle.conf.json).
    bundle: {
      ...JSON.parse(readFileSync('src-tauri/bundle.conf.json', 'utf8')).bundle,
      createUpdaterArtifacts: true,
    },
    plugins: { updater: { pubkey } },
  }),
)
