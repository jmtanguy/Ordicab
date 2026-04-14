import { describe, expect, it, vi } from 'vitest'

import { createOrdicabApi } from '../api'
import { IPC_CHANNELS } from '../../shared/types'
import type { IpcResult } from '../../shared/types'

describe('createOrdicabApi', () => {
  it('maps every channel wrapper to the expected invoke call', async () => {
    const invokeSpy = vi.fn(async (...args: unknown[]) => {
      void args
      return { success: true, data: null }
    })
    const onSpy = vi.fn()
    const offSpy = vi.fn()
    const ipcInvoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
      invokeSpy(channel, ...args) as Promise<T>
    const api = createOrdicabApi(ipcInvoke, onSpy, offSpy)

    // Return values conform to IpcResult envelope shape
    const versionResult: IpcResult<{ name: string; version: string }> = await api.app.version()
    expect(versionResult).toHaveProperty('success')
    const openResult: IpcResult<null> = await api.app.openExternal({
      url: 'https://electron-vite.org'
    })
    expect(openResult).toHaveProperty('success')

    await api.app.getLocale()
    await api.app.setLocale({ locale: 'fr' })
    await api.app.openFolder({ path: '/tmp' })
    await api.app.eulaStatus({ locale: 'fr' })
    await api.app.eulaAccept({ version: '2026-04-14' })
    await api.domain.select()
    await api.domain.status()
    await api.dossier.listEligible()
    await api.dossier.list()
    await api.dossier.get({ dossierId: 'dos-1' })
    await api.dossier.register({ id: 'TestCase-A' })
    await api.dossier.unregister({ id: 'TestCase-A' })
    await api.dossier.update({ id: 'dos-1', status: 'pending', type: 'Civil litigation' })
    await api.dossier.upsertKeyDate({
      dossierId: 'dos-1',
      label: 'Hearing',
      date: '2026-03-18'
    })
    await api.dossier.deleteKeyDate({ dossierId: 'dos-1', keyDateId: 'kd-1' })
    await api.dossier.upsertKeyReference({
      dossierId: 'dos-1',
      label: 'Case number',
      value: 'RG 26/001'
    })
    await api.dossier.deleteKeyReference({ dossierId: 'dos-1', keyReferenceId: 'kr-1' })
    await api.contact.list({ dossierId: 'dos-1' })
    await api.contact.upsert({
      dossierId: 'dos-1',
      firstName: 'Alex',
      lastName: 'Bernard',
      role: 'Client'
    })
    await api.contact.delete({ dossierId: 'dos-1', contactUuid: 'contact-1' })
    await api.entity.get()
    await api.entity.update({
      firmName: 'Cabinet Test-Legal',
      email: 'contact@test-legal-firm.fr',
      phone: '+33 1 98 76 54 32'
    })
    await api.document.list({ dossierId: 'dos-1' })
    await api.document.preview({ dossierId: 'dos-1', documentId: 'doc-1.pdf' })
    await api.document.contentStatus({ dossierId: 'dos-1', documentId: 'doc-1.pdf' })
    await api.document.extractContent({ dossierId: 'dos-1', documentId: 'doc-1.pdf' })
    await api.document.startWatching({ dossierId: 'dos-1' })
    await api.document.stopWatching({ dossierId: 'dos-1' })
    await api.document.saveMetadata({
      dossierId: 'dos-1',
      documentId: 'doc-1',
      description: 'Incoming note',
      tags: ['urgent']
    })
    await api.template.list()
    await api.template.create({ name: 'Courrier', content: 'Bonjour {{client}}', tags: [] })
    await api.template.update({
      id: 'tpl-1',
      name: 'Courrier',
      content: 'Bonjour {{client}}',
      tags: []
    })
    await api.template.delete({ id: 'tpl-1' })
    await api.template.importDocx({ id: 'tpl-1' })
    await api.template.openDocx({ id: 'tpl-1' })
    await api.template.removeDocx({ id: 'tpl-1' })
    await api.generate.document({
      dossierId: 'dos-1',
      templateId: 'tpl-1'
    })
    await api.generate.preview({
      dossierId: 'dos-1',
      templateId: 'tpl-1'
    })
    await api.generate.save({
      dossierId: 'dos-1',
      filename: 'Convocation-2026-03-15',
      format: 'docx',
      html: '<p>Hello</p>'
    })
    await api.claudeMd.regenerate({ dossierId: 'dos-1' })
    await api.claudeMd.status()

    expect(invokeSpy.mock.calls).toEqual([
      [IPC_CHANNELS.app.version],
      [IPC_CHANNELS.app.openExternal, { url: 'https://electron-vite.org' }],
      [IPC_CHANNELS.app.getLocale],
      [IPC_CHANNELS.app.setLocale, { locale: 'fr' }],
      [IPC_CHANNELS.app.openFolder, { path: '/tmp' }],
      [IPC_CHANNELS.app.eulaStatus, { locale: 'fr' }],
      [IPC_CHANNELS.app.eulaAccept, { version: '2026-04-14' }],
      [IPC_CHANNELS.domain.select],
      [IPC_CHANNELS.domain.status],
      [IPC_CHANNELS.dossier.listEligible],
      [IPC_CHANNELS.dossier.list],
      [IPC_CHANNELS.dossier.get, { dossierId: 'dos-1' }],
      [IPC_CHANNELS.dossier.register, { id: 'TestCase-A' }],
      [IPC_CHANNELS.dossier.unregister, { id: 'TestCase-A' }],
      [IPC_CHANNELS.dossier.update, { id: 'dos-1', status: 'pending', type: 'Civil litigation' }],
      [
        IPC_CHANNELS.dossier.upsertKeyDate,
        { dossierId: 'dos-1', label: 'Hearing', date: '2026-03-18' }
      ],
      [IPC_CHANNELS.dossier.deleteKeyDate, { dossierId: 'dos-1', keyDateId: 'kd-1' }],
      [
        IPC_CHANNELS.dossier.upsertKeyReference,
        { dossierId: 'dos-1', label: 'Case number', value: 'RG 26/001' }
      ],
      [IPC_CHANNELS.dossier.deleteKeyReference, { dossierId: 'dos-1', keyReferenceId: 'kr-1' }],
      [IPC_CHANNELS.contact.list, { dossierId: 'dos-1' }],
      [
        IPC_CHANNELS.contact.upsert,
        { dossierId: 'dos-1', firstName: 'Alex', lastName: 'Bernard', role: 'Client' }
      ],
      [IPC_CHANNELS.contact.delete, { dossierId: 'dos-1', contactUuid: 'contact-1' }],
      [IPC_CHANNELS.entity.get],
      [
        IPC_CHANNELS.entity.update,
        {
          firmName: 'Cabinet Test-Legal',
          email: 'contact@test-legal-firm.fr',
          phone: '+33 1 98 76 54 32'
        }
      ],
      [IPC_CHANNELS.document.list, { dossierId: 'dos-1' }],
      [IPC_CHANNELS.document.preview, { dossierId: 'dos-1', documentId: 'doc-1.pdf' }],
      [IPC_CHANNELS.document.contentStatus, { dossierId: 'dos-1', documentId: 'doc-1.pdf' }],
      [IPC_CHANNELS.document.extractContent, { dossierId: 'dos-1', documentId: 'doc-1.pdf' }],
      [IPC_CHANNELS.document.startWatching, { dossierId: 'dos-1' }],
      [IPC_CHANNELS.document.stopWatching, { dossierId: 'dos-1' }],
      [
        IPC_CHANNELS.document.saveMetadata,
        {
          dossierId: 'dos-1',
          documentId: 'doc-1',
          description: 'Incoming note',
          tags: ['urgent']
        }
      ],
      [IPC_CHANNELS.template.list],
      [IPC_CHANNELS.template.create, { name: 'Courrier', content: 'Bonjour {{client}}', tags: [] }],
      [
        IPC_CHANNELS.template.update,
        { id: 'tpl-1', name: 'Courrier', content: 'Bonjour {{client}}', tags: [] }
      ],
      [IPC_CHANNELS.template.delete, { id: 'tpl-1' }],
      [IPC_CHANNELS.template.importDocx, { id: 'tpl-1' }],
      [IPC_CHANNELS.template.openDocx, { id: 'tpl-1' }],
      [IPC_CHANNELS.template.removeDocx, { id: 'tpl-1' }],
      [IPC_CHANNELS.generate.document, { dossierId: 'dos-1', templateId: 'tpl-1' }],
      [IPC_CHANNELS.generate.preview, { dossierId: 'dos-1', templateId: 'tpl-1' }],
      [
        IPC_CHANNELS.generate.save,
        {
          dossierId: 'dos-1',
          filename: 'Convocation-2026-03-15',
          format: 'docx',
          html: '<p>Hello</p>'
        }
      ],
      [IPC_CHANNELS.claudeMd.regenerate, { dossierId: 'dos-1' }],
      [IPC_CHANNELS.claudeMd.status]
    ])
  })

  it('wraps document event subscriptions without exposing raw ipcRenderer listeners', () => {
    const onSpy = vi.fn()
    const offSpy = vi.fn()
    const api = createOrdicabApi(vi.fn(), onSpy, offSpy)
    const handleChange = vi.fn()
    const handleAvailability = vi.fn()
    const handleOrdicabDataChange = vi.fn()

    const unsubscribeChange = api.document.onDidChange(handleChange)
    const unsubscribeAvailability = api.document.onAvailabilityChanged(handleAvailability)
    const unsubscribeOrdicabDataChange = api.ordicab.onDataChanged(handleOrdicabDataChange)

    expect(onSpy).toHaveBeenNthCalledWith(1, IPC_CHANNELS.document.didChange, expect.any(Function))
    expect(onSpy).toHaveBeenNthCalledWith(
      2,
      IPC_CHANNELS.document.availabilityChanged,
      expect.any(Function)
    )
    expect(onSpy).toHaveBeenNthCalledWith(3, IPC_CHANNELS.ordicab.dataChanged, expect.any(Function))

    const changeListener = onSpy.mock.calls[0]?.[1] as
      | ((_: unknown, payload: unknown) => void)
      | undefined
    const availabilityListener = onSpy.mock.calls[1]?.[1] as
      | ((_: unknown, payload: unknown) => void)
      | undefined
    const ordicabDataChangedListener = onSpy.mock.calls[2]?.[1] as
      | ((_: unknown, payload: unknown) => void)
      | undefined

    changeListener?.(undefined, { dossierId: 'dos-1', kind: 'documents-changed' })
    availabilityListener?.(undefined, { dossierId: 'dos-1', status: 'available' })
    ordicabDataChangedListener?.(undefined, {
      dossierId: 'dos-1',
      type: 'contacts',
      changedAt: '2026-03-20T12:00:00.000Z'
    })

    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({ dossierId: 'dos-1', kind: 'documents-changed' })
    )
    expect(handleAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ dossierId: 'dos-1', status: 'available' })
    )
    expect(handleOrdicabDataChange).toHaveBeenCalledWith(
      expect.objectContaining({ dossierId: 'dos-1', type: 'contacts' })
    )

    unsubscribeChange()
    unsubscribeAvailability()
    unsubscribeOrdicabDataChange()

    expect(offSpy).toHaveBeenNthCalledWith(
      1,
      IPC_CHANNELS.document.didChange,
      onSpy.mock.calls[0]?.[1]
    )
    expect(offSpy).toHaveBeenNthCalledWith(
      2,
      IPC_CHANNELS.document.availabilityChanged,
      onSpy.mock.calls[1]?.[1]
    )
    expect(offSpy).toHaveBeenNthCalledWith(
      3,
      IPC_CHANNELS.ordicab.dataChanged,
      onSpy.mock.calls[2]?.[1]
    )
  })
})
