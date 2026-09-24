import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ModelCatalogStore } from './model-catalog'
import { bundledCatalog, modelKind, parseCatalog } from '../shared/model-capabilities'
import { classifyProviderModels } from './provider'

afterEach(() => vi.unstubAllGlobals())
it('validates rules, prioritizes exact IDs and keeps unknown models separate', () => {
  expect(modelKind('image-reader')).toBe('unknown')
  expect(modelKind('gpt-image-2', bundledCatalog, 'chat')).toBe('image')
  expect(
    classifyProviderModels({
      data: [
        null,
        { id: 'alias', type: 'image' },
        { id: 'unlisted' },
        { id: 'gpt-image-2', type: 'chat' },
      ],
    }),
  ).toEqual({ chatModels: [], imageModels: ['alias', 'gpt-image-2'], unknownModels: ['unlisted'] })
  expect(() => parseCatalog({ ...bundledCatalog, schemaVersion: 2 })).toThrow()
  expect(() => parseCatalog({ ...bundledCatalog, models: { bad: 'video' } })).toThrow()
})
it('compares versions, applies only after confirmation, persists and survives invalid remote/cache data', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'studio-catalog-'))
  try {
    const remote = {
      ...bundledCatalog,
      version: bundledCatalog.version + 1,
      models: { ...bundledCatalog.models, custom: 'image' },
    }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(remote)))
    vi.stubGlobal('fetch', fetchMock)
    const catalog = new ModelCatalogStore(dir)
    await catalog.load()
    await Promise.all([catalog.check(), catalog.check()])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(catalog.current.version).toBe(bundledCatalog.version)
    expect(catalog.status().availableVersion).toBe(remote.version)
    await catalog.install()
    const reopened = new ModelCatalogStore(dir)
    await reopened.load()
    expect(modelKind('custom', reopened.current)).toBe('image')
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(bundledCatalog)))
    expect((await reopened.check()).availableVersion).toBeUndefined()
    fetchMock.mockImplementation(async () => new Response('{'))
    await expect(reopened.check()).rejects.toThrow()
    expect(reopened.current.version).toBe(remote.version)
    await writeFile(join(dir, 'model-capabilities.json'), 'broken')
    const fallback = new ModelCatalogStore(dir)
    await fallback.load()
    expect(fallback.current).toEqual(bundledCatalog)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
