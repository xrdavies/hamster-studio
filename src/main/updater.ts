import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '../shared/updates'

export function setupUpdater(
  enabled: boolean,
  publish: (state: UpdateState) => void,
  isBusy: () => boolean,
) {
  let state: UpdateState = { status: enabled ? 'idle' : 'disabled' }
  let checking: Promise<UpdateState> | undefined
  const set = (next: UpdateState) => {
    state = next
    publish(state)
  }
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  autoUpdater.on('update-available', (info) => set({ status: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => set({ status: 'current' }))
  autoUpdater.on('download-progress', (progress) =>
    set({ ...state, status: 'downloading', percent: Math.round(progress.percent) }),
  )
  autoUpdater.on('update-downloaded', (info) =>
    set({ status: 'downloaded', version: info.version }),
  )
  autoUpdater.on('error', (error) => set({ ...state, status: 'error', error: error.message }))
  return {
    state: () => state,
    check: () => {
      if (!enabled || ['downloading', 'downloaded'].includes(state.status))
        return Promise.resolve(state)
      if (checking) return checking
      set({ status: 'checking' })
      checking = autoUpdater
        .checkForUpdates()
        .then(() => state)
        .catch((error) => {
          set({ status: 'error', error: String(error) })
          return state
        })
        .finally(() => {
          checking = undefined
        })
      return checking
    },
    download: async () => {
      if (state.status !== 'available') throw new Error('请先检查更新')
      set({ ...state, status: 'downloading', percent: 0 })
      try {
        await autoUpdater.downloadUpdate()
      } catch (error) {
        set({ ...state, status: 'error', error: String(error) })
      }
      return state
    },
    install: () => {
      if (state.status !== 'downloaded') throw new Error('更新尚未下载完成')
      if (isBusy()) throw new Error('请等待生成完成或停止生成后再更新')
      setImmediate(() => autoUpdater.quitAndInstall())
    },
  }
}
