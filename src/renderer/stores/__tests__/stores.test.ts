import { beforeEach, describe, expect, it } from 'vitest'

import {
  useContactStore,
  useDocumentStore,
  useDomainStore,
  useDossierStore,
  useEntityStore,
  useTemplateStore,
  useUiStore
} from '../index'

describe('store scaffolds', () => {
  beforeEach(() => {
    useUiStore.setState(useUiStore.getInitialState(), true)
    useDomainStore.setState(useDomainStore.getInitialState(), true)
    useDossierStore.setState(useDossierStore.getInitialState(), true)
    useContactStore.setState(useContactStore.getInitialState(), true)
    useEntityStore.setState(useEntityStore.getInitialState(), true)
    useDocumentStore.setState(useDocumentStore.getInitialState(), true)
    useTemplateStore.setState(useTemplateStore.getInitialState(), true)
  })

  it('creates every store with stable initial state', () => {
    expect(useUiStore.getState().versionStatus).toBe('idle')
    expect(useDomainStore.getState().snapshot.registeredDomainPath).toBeNull()
    expect(useDossierStore.getState().dossiers).toEqual([])
    expect(useContactStore.getState().contactsByDossierId).toEqual({})
    expect(useEntityStore.getState().profile).toBeNull()
    expect(useDocumentStore.getState().documentsByDossierId).toEqual({})
    expect(useTemplateStore.getState().templates).toEqual([])
  })
})
