import { describe, expect, it } from 'vitest'

import { PiiMapping } from './piiMapping'

describe('PiiMapping', () => {
  it('deduplicates fake values so two different originals do not share the same replacement', () => {
    const mapping = new PiiMapping()

    mapping.add('Martin', 'contact.client.lastName', 'Lefebvre')
    mapping.add('Durand', 'contact.adverse.lastName', 'Lefebvre')

    expect(mapping.getFake('Martin')?.fakeValue).toBe('Lefebvre')
    expect(mapping.getFake('Durand')?.fakeValue).toBe('Lefebvre 2')
  })
})
