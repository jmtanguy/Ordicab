export type UpdaterStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version: string; releaseNotes?: string | null }
  | { kind: 'downloading'; version: string }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string }

export interface UpdaterProgressPayload {
  version: string
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}
