import type { IpcErrorCode } from './ipcErrors'

export interface IpcSuccess<T> {
  success: true
  data: T
}

export interface IpcError {
  success: false
  error: string
  code: IpcErrorCode
}

export type IpcResult<T> = IpcSuccess<T> | IpcError
