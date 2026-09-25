import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async () => {}),
  check: vi.fn(),
  relaunch: vi.fn(),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn(async () => '0.0.1') }))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }))
vi.mock('@tauri-apps/plugin-updater', () => ({ check: mocks.check }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: mocks.relaunch }))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
  vi.resetModules()
  vi.clearAllMocks()
})
it('keeps download and install explicit, and checks native active requests before installation', async () => {
  vi.useFakeTimers()
  vi.stubEnv('DEV', false)
  vi.stubGlobal('window', {})
  const update = {
    version: '0.0.2',
    close: vi.fn(),
    download: vi.fn(async () => {}),
    install: vi.fn(async () => {}),
  }
  mocks.check.mockResolvedValue(update)
  await import('./studio')
  await window.studio.checkUpdates()
  expect((await window.studio.updateState()).status).toBe('available')
  expect(update.download).not.toHaveBeenCalled()
  await window.studio.downloadUpdate()
  expect(update.install).not.toHaveBeenCalled()
  mocks.invoke.mockRejectedValueOnce(new Error('busy'))
  await expect(window.studio.installUpdate()).rejects.toThrow('busy')
  expect(update.install).not.toHaveBeenCalled()
  await window.studio.installUpdate()
  expect(mocks.invoke).toHaveBeenCalledWith('can_install')
  expect(update.install).toHaveBeenCalledTimes(1)
  expect(mocks.relaunch).toHaveBeenCalledTimes(1)
})

it('routes image references and approvals to their own session', async () => {
  vi.stubEnv('DEV', true)
  vi.stubGlobal('window', {})
  await import('./studio')
  await window.studio.sendChat('session-a', 'make it blue', 'image-a.png')
  expect(mocks.invoke).toHaveBeenLastCalledWith('generate', {
    sessionId: 'session-a',
    text: 'make it blue',
    kind: 'chat',
    referenceFile: 'image-a.png',
  })
  await window.studio.approveImageStep('session-b', 'step-b', false)
  expect(mocks.invoke).toHaveBeenLastCalledWith('approve', {
    sessionId: 'session-b',
    stepId: 'step-b',
    allow: false,
  })
})
