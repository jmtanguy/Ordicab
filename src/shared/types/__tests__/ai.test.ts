import { describe, expect, it } from 'vitest'

import { aiSettingsSchema, aiSettingsSaveSchema } from '../../validation/ai'

describe('aiSettingsSchema', () => {
  it('accepts a disabled (none) config', () => {
    const result = aiSettingsSchema.safeParse({
      mode: 'none'
    })
    expect(result.success).toBe(true)
  })

  it('accepts a valid remote config with provider', () => {
    const result = aiSettingsSchema.safeParse({
      mode: 'remote',
      remoteProvider: 'https://api.openai.com/v1'
    })
    expect(result.success).toBe(true)
  })

  it('rejects a non-http remote provider URL', () => {
    const result = aiSettingsSchema.safeParse({
      mode: 'remote',
      remoteProvider: 'javascript:alert(1)'
    })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid mode', () => {
    const result = aiSettingsSchema.safeParse({
      mode: 'invalid'
    })
    expect(result.success).toBe(false)
  })

  it('rejects the removed local mode', () => {
    const result = aiSettingsSchema.safeParse({
      mode: 'local'
    })
    expect(result.success).toBe(false)
  })
})

describe('aiSettingsSaveSchema', () => {
  it('accepts input with an apiKey', () => {
    const result = aiSettingsSaveSchema.safeParse({
      mode: 'remote',
      remoteProvider: 'https://api.openai.com/v1',
      apiKey: 'sk-secret'
    })
    expect(result.success).toBe(true)
  })

  it('accepts input without an apiKey', () => {
    const result = aiSettingsSaveSchema.safeParse({
      mode: 'none'
    })
    expect(result.success).toBe(true)
  })
})
