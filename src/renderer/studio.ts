import { getCurrentWebview } from '@tauri-apps/api/webview'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getVersion } from '@tauri-apps/api/app'
import { openUrl } from '@tauri-apps/plugin-opener'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { aboutUrl } from '../shared/about'
import type { UpdateState } from '../shared/updates'
import type { Message } from '../shared/types'

let state: UpdateState = { status: import.meta.env.DEV ? 'disabled' : 'idle' }
let update: Update | null = null
let checking: Promise<UpdateState> | undefined
const listeners = new Set<(state: UpdateState) => void>()
const set = (next: UpdateState) => {
  state = next
  listeners.forEach((listener) => listener(next))
  return next
}
const fail = (error: unknown) => set({ status: 'error', error: String(error) })
function checkUpdates() {
  if (import.meta.env.DEV || ['downloading', 'downloaded'].includes(state.status))
    return Promise.resolve(state)
  if (checking) return checking
  set({ status: 'checking' })
  checking = (async () => {
    await update?.close()
    update = await check()
    return set(update ? { status: 'available', version: update.version } : { status: 'current' })
  })()
    .catch(fail)
    .finally(() => {
      checking = undefined
    })
  return checking
}
function onMessage(callback: (message: Message) => void) {
  let disposed = false
  let off: (() => void) | undefined
  void listen<Message>('message', ({ payload }) => {
    if (!disposed) callback(payload)
  }).then((unlisten) => {
    if (disposed) unlisten()
    else off = unlisten
  })
  return () => {
    disposed = true
    off?.()
  }
}
// Native diagnostics contain allowlisted metadata only, never prompts or response bodies.
void listen<{ timestamp: number; stage: string; metadata: Record<string, unknown> }>(
  'diagnostic',
  ({ payload }) => {
    const log = payload.stage.endsWith('.error') ? console.error : console.info
    log('[Hamster Studio]', payload.stage, payload)
  },
).catch(() => {})

window.studio = {
  setLanguage: async () => {},
  version: getVersion,
  openAboutLink: (key) => openUrl(aboutUrl(key)),
  load: () => invoke('load'),
  saveProvider: (input) => invoke('save_provider', { input }),
  deleteProvider: (id) => invoke('delete_provider', { id }),
  saveSession: (session) => invoke('save_session', { session }),
  deleteSession: (id) => invoke('delete_session', { id }),
  sendChat: (sessionId, text, referenceFiles, maskFile) =>
    invoke('generate', { sessionId, text, kind: 'chat', referenceFiles, maskFile }),
  continueAgent: (sessionId, messageId) =>
    invoke('generate', { sessionId, text: 'continue', kind: 'chat', resumeId: messageId }),
  approveImageStep: (sessionId, stepId, allow) => invoke('approve', { sessionId, stepId, allow }),
  generateImage: (sessionId, text, referenceFiles, maskFile) =>
    invoke('generate', { sessionId, text, kind: 'image', referenceFiles, maskFile }),
  onImageDrag: (callback) => {
    let disposed = false
    let off: (() => void) | undefined
    void getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        if (!disposed) callback(payload)
      })
      .then((unlisten) => {
        if (disposed) unlisten()
        else off = unlisten
      })
      .catch(() => {})
    return () => {
      disposed = true
      off?.()
    }
  },
  importDroppedImage: (sessionId, path) => invoke('import_dropped_image', { sessionId, path }),
  importImages: (sessionId, remaining) => invoke('import_images', { sessionId, remaining }),
  stopChat: (id) => invoke('stop_chat', { id }),
  saveMask: (file, data) => invoke('save_mask', { file, data }),
  readImage: (file) => invoke('read_image', { file }),
  exportImages: (files) => invoke('export_images', { files }),
  retryImageStep: (sessionId, messageId, stepId) =>
    invoke('retry_image_step', { sessionId, messageId, stepId }),
  exportImage: (file) => invoke('export_image', { file }),
  fetchModels: (input) => invoke('fetch_models', { input }),
  testProvider: async (input) => {
    await invoke('fetch_models', { input })
    return true
  },
  catalogState: () => invoke('catalog_state'),
  checkCatalog: () => invoke('check_catalog'),
  installCatalog: () => invoke('install_catalog'),
  classifyModels: (models) => invoke('classify_models', { models }),
  onMessage,
  checkUpdates,
  updateState: async () => state,
  onUpdate: (listener) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  downloadUpdate: async () => {
    if (!update || state.status !== 'available') throw new Error('ui.checkForUpdatesFirst')
    set({ status: 'downloading', version: update.version, percent: 0 })
    let total = 0
    let received = 0
    try {
      await update.download((event) => {
        if (event.event === 'Started') total = event.data.contentLength || 0
        if (event.event === 'Progress') received += event.data.chunkLength
        set({ ...state, percent: total ? Math.min(100, Math.round((received / total) * 100)) : 0 })
      })
      return set({ status: 'downloaded', version: update.version })
    } catch (error) {
      return fail(error)
    }
  },
  installUpdate: async () => {
    if (!update || state.status !== 'downloaded')
      throw new Error('ui.theUpdateHasNotFinishedDownloading')
    await invoke('can_install')
    try {
      await update.install()
      await relaunch()
    } catch (error) {
      fail(error)
      throw error
    }
  },
}
if (!import.meta.env.DEV) {
  void checkUpdates()
  setInterval(
    () => {
      void checkUpdates()
    },
    6 * 60 * 60 * 1000,
  )
}
