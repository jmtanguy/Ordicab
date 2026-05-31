import { ZodError } from 'zod'

import { IpcErrorCode, type IpcError, type IpcResult } from '@shared/types'

export interface IpcMainLike {
  handle: (
    channel: string,
    listener: (_event: unknown, input?: unknown) => Promise<unknown>
  ) => void
}

export interface IpcSenderLike {
  isDestroyed: () => boolean
  send: (channel: string, ...args: unknown[]) => void
}

export interface WebContentsLike {
  send(channel: string, ...args: unknown[]): void
}

interface ServiceError extends Error {
  readonly code: IpcErrorCode
}

type ErrorClass = new (...args: never[]) => Error

interface InputParser<TInput> {
  parse(input: unknown): TInput
}

type IpcErrorMapper = (error: unknown, fallback: string) => IpcError

export function success<T>(data: T): IpcResult<T> {
  return { success: true, data }
}

export function registerIpcHandler<TData, TInput = void>(options: {
  ipcMain: IpcMainLike
  channel: string
  schema?: InputParser<TInput>
  fallback: string
  mapError: IpcErrorMapper
  handle: (input: TInput) => Promise<TData> | TData
}): void {
  options.ipcMain.handle(options.channel, async (_event, input): Promise<IpcResult<TData>> => {
    try {
      const parsed = options.schema ? options.schema.parse(input) : (undefined as TInput)
      return success(await options.handle(parsed))
    } catch (error) {
      return options.mapError(error, options.fallback)
    }
  })
}

export function registerIpcCommand<TInput = void>(options: {
  ipcMain: IpcMainLike
  channel: string
  schema?: InputParser<TInput>
  fallback: string
  mapError: IpcErrorMapper
  handle: (input: TInput) => Promise<void> | void
}): void {
  registerIpcHandler({
    ...options,
    handle: async (input) => {
      await options.handle(input)
      return null
    }
  })
}

/**
 * Generic IPC error mapper.
 *
 * - ZodError → VALIDATION_FAILED with optional validationMessage
 * - Any error whose class appears in errorClasses AND has a `.code: IpcErrorCode` → uses that code
 * - Any error whose class appears in overrides → uses the mapped IpcErrorCode
 * - Fallback → fallbackCode (default FILE_SYSTEM_ERROR) with fallback message
 */
export function mapIpcError(
  error: unknown,
  fallback: string,
  options?: {
    validationMessage?: string
    errorClasses?: ErrorClass[]
    overrides?: Array<[ErrorClass, IpcErrorCode]>
    fallbackCode?: IpcErrorCode
  }
): IpcError {
  const {
    validationMessage = 'Invalid input.',
    errorClasses = [],
    overrides = [],
    fallbackCode = IpcErrorCode.FILE_SYSTEM_ERROR
  } = options ?? {}

  if (error instanceof ZodError) {
    return { success: false, error: validationMessage, code: IpcErrorCode.VALIDATION_FAILED }
  }

  for (const [cls, code] of overrides) {
    if (error instanceof cls) {
      return {
        success: false,
        error: error instanceof Error ? error.message : fallback,
        code
      }
    }
  }

  for (const cls of errorClasses) {
    if (error instanceof cls) {
      const svc = error as unknown as ServiceError
      return { success: false, error: svc.message, code: svc.code }
    }
  }

  return {
    success: false,
    error: error instanceof Error ? error.message : fallback,
    code: fallbackCode
  }
}

export function resolveEventWebContents(event: unknown): WebContentsLike | null {
  if (!event || typeof event !== 'object') return null
  const sender = (event as { sender?: unknown }).sender
  if (!sender || typeof sender !== 'object') return null
  if (typeof (sender as { send?: unknown }).send !== 'function') return null
  return sender as WebContentsLike
}
