import { describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({
  execFile: vi.fn()
}))

describe('aiDelegatedProviderChecker', () => {
  it('returns available when claude CLI is found, unavailable with hint when not found, and available for non-external modes', async () => {
    const { execFile } = await import('node:child_process')

    // found
    vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback) => {
      ;(callback as (err: null, stdout: string, stderr: string) => void)(null, '', '')
      return {} as ReturnType<typeof execFile>
    })
    const { createAiDelegatedProviderChecker } = await import('../aiDelegatedProviderChecker')
    const checker = createAiDelegatedProviderChecker()
    const result = await checker.checkAvailability('claude-code')
    expect(result).toEqual({ available: true })

    // not found
    vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback) => {
      ;(callback as (err: Error) => void)(new Error('not found'))
      return {} as ReturnType<typeof execFile>
    })
    const checker2 = createAiDelegatedProviderChecker()
    const result2 = await checker2.checkAvailability('claude-code')
    expect(result2.available).toBe(false)
    expect(result2.reason).toContain('Claude CLI not found')

    // non-external modes always available
    const checker3 = createAiDelegatedProviderChecker()
    const local = await checker3.checkAvailability('local')
    const none = await checker3.checkAvailability('none')
    const remote = await checker3.checkAvailability('remote')
    expect(local).toEqual({ available: true })
    expect(none).toEqual({ available: true })
    expect(remote).toEqual({ available: true })
  })
})
