// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { copyTextToClipboard } from '../clipboard'

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
const originalExecCommandDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand')

afterEach(() => {
  vi.restoreAllMocks()

  if (originalClipboardDescriptor) {
    Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor)
  } else {
    Reflect.deleteProperty(navigator, 'clipboard')
  }

  if (originalExecCommandDescriptor) {
    Object.defineProperty(document, 'execCommand', originalExecCommandDescriptor)
  } else {
    Reflect.deleteProperty(document, 'execCommand')
  }
})

describe('copyTextToClipboard', () => {
  it('uses navigator.clipboard when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand
    })

    await expect(copyTextToClipboard('{{dossier.name}}')).resolves.toBe(true)

    expect(writeText).toHaveBeenCalledWith('{{dossier.name}}')
    expect(execCommand).not.toHaveBeenCalled()
  })

  it('falls back to execCommand copy when navigator.clipboard rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('not focused'))
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand
    })

    await expect(copyTextToClipboard('{{contact.client.email}}')).resolves.toBe(true)

    expect(writeText).toHaveBeenCalledWith('{{contact.client.email}}')
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).toBeNull()
  })
})
