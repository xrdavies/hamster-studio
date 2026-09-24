import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
vi.mock('electron-updater', () => ({
  autoUpdater: Object.assign(new EventEmitter(), {
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
  }),
}))
import { autoUpdater } from 'electron-updater'
import { setupUpdater } from './updater'

it('checks without downloading, requires explicit download/install and blocks installation during generation', async () => {
  let busy = true
  const updater = setupUpdater(true, vi.fn(), () => busy)
  expect(autoUpdater.autoDownload).toBe(false)
  expect(autoUpdater.autoInstallOnAppQuit).toBe(false)
  vi.mocked(autoUpdater.checkForUpdates).mockImplementation(async () => {
    autoUpdater.emit('update-available', {
      version: '0.2.0',
      files: [],
      path: '',
      sha512: '',
      releaseDate: '',
    })
    return null
  })
  await Promise.all([updater.check(), updater.check()])
  expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
  expect(updater.state().status).toBe('available')
  expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled()
  expect(() => updater.install()).toThrow()
  vi.mocked(autoUpdater.downloadUpdate).mockImplementation(async () => {
    autoUpdater.emit('download-progress', {
      percent: 50,
      total: 100,
      delta: 50,
      transferred: 50,
      bytesPerSecond: 10,
    })
    expect(updater.state().percent).toBe(50)
    autoUpdater.emit('update-downloaded', {
      version: '0.2.0',
      files: [],
      path: '',
      sha512: '',
      releaseDate: '',
      downloadedFile: '',
    })
    return []
  })
  await updater.download()
  expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled()
  expect(() => updater.install()).toThrow('请等待')
  busy = false
  updater.install()
  await new Promise((resolve) => setImmediate(resolve))
  expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1)
  autoUpdater.emit('error', new Error('offline'))
  expect(updater.state()).toMatchObject({ status: 'error', error: 'offline' })
})
