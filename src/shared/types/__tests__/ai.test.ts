import { describe, expect, it } from 'vitest'

import { aiSettingsSchema, aiSettingsSaveSchema } from '../../validation/ai'

describe('aiSettingsSchema', () => {
  it('accepts a valid local config', () => {
    const result = aiSettingsSchema.safeParse({
      mode: 'local',
      ollamaEndpoint: 'http://localhost:11434'
    })
    expect(result.success).toBe(true)
  })

  it('accepts a valid remote config with provider', () => {
    const result = aiSettingsSchema.safeParse({
      mode: 'remote',
      ollamaEndpoint: 'http://localhost:11434',
      remoteProvider: 'openai'
    })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid mode', () => {
    const result = aiSettingsSchema.safeParse({
      mode: 'invalid',
      ollamaEndpoint: 'http://localhost:11434'
    })
    expect(result.success).toBe(false)
  })

  it('rejects a non-URL endpoint', () => {
    const result = aiSettingsSchema.safeParse({
      mode: 'local',
      ollamaEndpoint: 'not-a-url'
    })
    expect(result.success).toBe(false)
  })
})

describe('aiSettingsSaveSchema', () => {
  it('accepts input with an apiKey', () => {
    const result = aiSettingsSaveSchema.safeParse({
      mode: 'remote',
      ollamaEndpoint: 'http://localhost:11434',
      remoteProvider: 'openai',
      apiKey: 'sk-secret'
    })
    expect(result.success).toBe(true)
  })

  it('accepts input without an apiKey', () => {
    const result = aiSettingsSaveSchema.safeParse({
      mode: 'local',
      ollamaEndpoint: 'http://localhost:11434'
    })
    expect(result.success).toBe(true)
  })
})
