import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { bundledCatalog, parseCatalog, type ModelCatalog } from '../shared/model-capabilities'

export const catalogUrl =
  'https://raw.githubusercontent.com/xrdavies/hamster-studio/main/config/model-capabilities.json'
export class ModelCatalogStore {
  current = bundledCatalog
  private candidate?: ModelCatalog
  private operation?: Promise<ReturnType<ModelCatalogStore['status']>>
  constructor(private directory: string) {}
  status() {
    return { version: this.current.version, availableVersion: this.candidate?.version }
  }
  async load() {
    try {
      const cached = parseCatalog(
        JSON.parse(await readFile(join(this.directory, 'model-capabilities.json'), 'utf8')),
      )
      if (cached.version > this.current.version) this.current = cached
    } catch {
      /* Missing or invalid cache falls back to the bundled table. */
    }
  }
  check() {
    if (this.operation) return this.operation
    this.operation = (async () => {
      const response = await fetch(catalogUrl, {
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      })
      if (!response.ok) throw new Error(`GitHub: ${response.status}`)
      const reader = response.body?.getReader()
      if (!reader) throw new Error('Empty model catalog')
      let text = ''
      let size = 0
      const decoder = new TextDecoder()
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 1024 * 1024) throw new Error('Model catalog exceeds 1 MB')
          text += decoder.decode(value, { stream: true })
        }
        const remote = parseCatalog(JSON.parse(text + decoder.decode()))
        this.candidate = remote.version > this.current.version ? remote : undefined
        return this.status()
      } finally {
        await reader.cancel()
      }
    })().finally(() => {
      this.operation = undefined
    })
    return this.operation
  }
  async install() {
    if (!this.candidate) throw new Error('请先检查模型能力表更新')
    const next = this.candidate
    await mkdir(this.directory, { recursive: true })
    const file = join(this.directory, 'model-capabilities.json')
    await writeFile(file + '.tmp', JSON.stringify(next), { mode: 0o600 })
    await rename(file + '.tmp', file)
    this.current = next
    this.candidate = undefined
    return this.status()
  }
}
