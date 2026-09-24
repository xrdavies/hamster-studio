import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'src/main/main.ts',
        vite: {
          build: {
            rolldownOptions: { external: ['better-sqlite3'] },
            rollupOptions: { external: ['better-sqlite3'] },
          },
        },
      },
      preload: { input: 'src/main/preload.ts' },
    }),
  ],
  build: { outDir: 'dist' },
})
