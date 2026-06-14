import { IpcErrorCode } from '@shared/types'

export class PiecesServiceError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'PiecesServiceError'
  }
}
