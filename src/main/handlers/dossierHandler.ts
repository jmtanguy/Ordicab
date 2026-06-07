import { IPC_CHANNELS, type IpcError } from '@shared/types'

import {
  dossierCreateInputSchema,
  dossierRegistrationInputSchema,
  dossierScopedQuerySchema,
  dossierSetupLegalAidInputSchema,
  dossierUnregisterInputSchema,
  dossierUpdateLegalAidInputSchema
} from '@shared/validation/dossier'
import {
  dossierBillingItemDeleteInputSchema,
  dossierBillingItemUpsertInputSchema,
  dossierFeeAgreementArchiveInputSchema,
  dossierFeeAgreementDeleteInputSchema,
  dossierFeeAgreementSetActiveInputSchema,
  dossierFeeAgreementUpsertInputSchema
} from '@shared/validation/billing'
import {
  dossierKeyDateDeleteInputSchema,
  dossierKeyDateUpsertInputSchema
} from '@shared/validation/keyDate'
import {
  dossierKeyReferenceDeleteInputSchema,
  dossierKeyReferenceUpsertInputSchema
} from '@shared/validation/keyReference'

import {
  DossierRegistryError,
  type DossierRegistryService
} from '../services/domain/dossierRegistryService'
import {
  AjOrchestrationError,
  type AjOrchestrationService
} from '../services/domain/ajOrchestrationService'
import { type IpcMainLike, mapIpcError, registerIpcHandler } from './ipc'

const mapDossierError = (error: unknown, fallback: string): IpcError =>
  mapIpcError(error, fallback, {
    validationMessage: 'Invalid dossier input.',
    errorClasses: [DossierRegistryError, AjOrchestrationError]
  })

export function registerDossierHandlers(options: {
  dossierService: DossierRegistryService
  ajOrchestrationService: AjOrchestrationService
  ipcMain: IpcMainLike
}): void {
  registerIpcHandler({
    ipcMain: options.ipcMain,
    channel: IPC_CHANNELS.dossier.listEligible,
    fallback: 'Unable to load eligible dossier folders.',
    mapError: mapDossierError,
    handle: () => options.dossierService.listEligibleFolders()
  })

  registerIpcHandler({
    ipcMain: options.ipcMain,
    channel: IPC_CHANNELS.dossier.list,
    fallback: 'Unable to load registered dossiers.',
    mapError: mapDossierError,
    handle: () => options.dossierService.listRegisteredDossiers()
  })

  registerIpcHandler({
    ipcMain: options.ipcMain,
    channel: IPC_CHANNELS.dossier.get,
    schema: dossierScopedQuerySchema,
    fallback: 'Unable to load dossier details.',
    mapError: mapDossierError,
    handle: (input) => options.dossierService.getDossier(input)
  })

  registerIpcHandler({
    ipcMain: options.ipcMain,
    channel: IPC_CHANNELS.dossier.open,
    schema: dossierScopedQuerySchema,
    fallback: 'Unable to open dossier details.',
    mapError: mapDossierError,
    handle: (input) => options.dossierService.openDossier(input)
  })

  registerIpcHandler({
    ipcMain: options.ipcMain,
    channel: IPC_CHANNELS.dossier.register,
    schema: dossierRegistrationInputSchema,
    fallback: 'Unable to register dossier.',
    mapError: mapDossierError,
    handle: (input) => options.dossierService.registerDossier(input)
  })

  registerIpcHandler({
    ipcMain: options.ipcMain,
    channel: IPC_CHANNELS.dossier.create,
    schema: dossierCreateInputSchema,
    fallback: 'Unable to create dossier.',
    mapError: mapDossierError,
    handle: (input) => options.dossierService.createDossier(input)
  })

  registerIpcHandler({
    ipcMain: options.ipcMain,
    channel: IPC_CHANNELS.dossier.upsertKeyDate,
    schema: dossierKeyDateUpsertInputSchema,
    fallback: 'Unable to save dossier key date.',
    mapError: mapDossierError,
    handle: (input) => options.dossierService.upsertKeyDate(input)
  })

  registerIpcHandler({
    ipcMain: options.ipcMain,
    channel: IPC_CHANNELS.dossier.deleteKeyDate,
    schema: dossierKeyDateDeleteInputSchema,
    fallback: 'Unable to delete dossier key date.',
    mapError: mapDossierError,
    handle: (input) => options.dossierService.deleteKeyDate(input)
  })

  registerIpcHandler({
    ipcMain: options.ipcMain,
    channel: IPC_CHANNELS.dossier.upsertKeyReference,
    schema: dossierKeyReferenceUpsertInputSchema,
    fallback: 'Unable to save dossier key reference.',
    mapError: mapDossierError,
    handle: (input) => options.dossierService.upsertKeyReference(input)
  })

  registerIpcHandler({
    ipcMain: options.ipcMain,
    channel: IPC_CHANNELS.dossier.deleteKeyReference,
    schema: dossierKeyReferenceDeleteInputSchema,
    fallback: 'Unable to delete dossier key reference.',
    mapError: mapDossierError,
    handle: (input) => options.dossierService.deleteKeyReference(input)
  })

  registerIpcHandler({
    ipcMain: options.ipcMain,
    channel: IPC_CHANNELS.dossier.upsertFeeAgreement,
    schema: dossierFeeAgreementUpsertInputSchema,
    fallback: 'Unable to save dossier fee agreement.',
    mapError: mapDossierError,
    handle: (input) => options.dossierService.upsertFeeAgreement(input)
  })

  registerIpcHandler({
    ipcMain: options.ipcMain,
    channel: IPC_CHANNELS.dossier.deleteFeeAgreement,
    schema: dossierFeeAgreementDeleteInputSchema,
    fallback: 'Unable to delete dossier fee agreement.',
    mapError: mapDossierError,
    handle: (input) => options.dossierService.deleteFeeAgreement(input)
  })

  registerIpcHandler({
    ipcMain: options.ipcMain,
    channel: IPC_CHANNELS.dossier.archiveFeeAgreement,
    schema: dossierFeeAgreementArchiveInputSchema,
    fallback: 'Unable to archive dossier fee agreement.',
    mapError: mapDossierError,
    handle: (input) => options.dossierService.archiveFeeAgreement(input)
  })

  registerIpcHandler({
    ipcMain: options.ipcMain,
    channel: IPC_CHANNELS.dossier.setActiveFeeAgreement,
    schema: dossierFeeAgreementSetActiveInputSchema,
    fallback: 'Unable to activate dossier fee agreement.',
    mapError: mapDossierError,
    handle: (input) => options.dossierService.setActiveFeeAgreement(input)
  })

  registerIpcHandler({
    ipcMain: options.ipcMain,
    channel: IPC_CHANNELS.dossier.upsertBillingItem,
    schema: dossierBillingItemUpsertInputSchema,
    fallback: 'Unable to save dossier billing item.',
    mapError: mapDossierError,
    handle: (input) => options.dossierService.upsertBillingItem(input)
  })

  registerIpcHandler({
    ipcMain: options.ipcMain,
    channel: IPC_CHANNELS.dossier.deleteBillingItem,
    schema: dossierBillingItemDeleteInputSchema,
    fallback: 'Unable to delete dossier billing item.',
    mapError: mapDossierError,
    handle: (input) => options.dossierService.deleteBillingItem(input)
  })

  registerIpcHandler({
    ipcMain: options.ipcMain,
    channel: IPC_CHANNELS.dossier.updateLegalAid,
    schema: dossierUpdateLegalAidInputSchema,
    fallback: "Impossible d'enregistrer l'aide juridictionnelle.",
    mapError: mapDossierError,
    handle: (input) => options.dossierService.updateLegalAid(input)
  })

  registerIpcHandler({
    ipcMain: options.ipcMain,
    channel: IPC_CHANNELS.dossier.setupLegalAid,
    schema: dossierSetupLegalAidInputSchema,
    fallback: "Impossible de configurer l'aide juridictionnelle.",
    mapError: mapDossierError,
    handle: (input) => options.ajOrchestrationService.setupLegalAid(input)
  })

  registerIpcHandler({
    ipcMain: options.ipcMain,
    channel: IPC_CHANNELS.dossier.unregister,
    schema: dossierUnregisterInputSchema,
    fallback: 'Unable to unregister dossier.',
    mapError: mapDossierError,
    handle: (input) => options.dossierService.unregisterDossier(input)
  })
}
