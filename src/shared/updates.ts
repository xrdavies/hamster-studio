export type UpdateState = {
  status:
    | 'idle'
    | 'disabled'
    | 'checking'
    | 'current'
    | 'available'
    | 'downloading'
    | 'downloaded'
    | 'error'
  version?: string
  percent?: number
  error?: string
}
export type CatalogState = { version: number; availableVersion?: number }
