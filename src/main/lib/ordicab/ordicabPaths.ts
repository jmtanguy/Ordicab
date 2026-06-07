import { join } from 'node:path'

export const ORDICAB_DIRECTORY_NAME = '.ordicab'
export const ORDICAB_DELEGATED_DIRECTORY_NAME = '.ordicab-delegated'

export function getDomainOrdicabPath(domainPath: string): string {
  return join(domainPath, ORDICAB_DIRECTORY_NAME)
}

export function getDomainMetadataPath(domainPath: string): string {
  return join(getDomainOrdicabPath(domainPath), 'domain.json')
}

export function getDomainRegistryPath(domainPath: string): string {
  return join(getDomainOrdicabPath(domainPath), 'registry.json')
}

export function getDomainEntityPath(domainPath: string): string {
  return join(getDomainOrdicabPath(domainPath), 'entity.json')
}

export function getDomainCabinetDefaultTemplateDocxPath(domainPath: string): string {
  return join(getDomainOrdicabPath(domainPath), 'cabinet-default-template.docx')
}

export function getDomainCabinetBillingPath(domainPath: string): string {
  return join(getDomainOrdicabPath(domainPath), 'cabinet-billing.json')
}

export function getDomainTemplatesPath(domainPath: string): string {
  return join(getDomainOrdicabPath(domainPath), 'templates.json')
}

export function getDomainInvoicesPath(domainPath: string): string {
  return join(getDomainOrdicabPath(domainPath), 'invoices.json')
}

export function getDomainInvoiceDocumentsPath(domainPath: string): string {
  return join(getDomainOrdicabPath(domainPath), 'invoices')
}

export function getDomainInvoiceRecordsDirectoryPath(domainPath: string): string {
  return join(getDomainOrdicabPath(domainPath), 'invoice-records')
}

export function getDomainInvoiceRecordPath(domainPath: string, id: string): string {
  return join(getDomainInvoiceRecordsDirectoryPath(domainPath), `${id}.json`)
}

export function getDomainInvoiceIndexPath(domainPath: string): string {
  return join(getDomainOrdicabPath(domainPath), 'invoice-records-index.json')
}

export function getDomainTemplateRoutinesPath(domainPath: string): string {
  return join(getDomainOrdicabPath(domainPath), 'template-routines.md')
}

export function getDomainTemplateDocxPath(domainPath: string, templateId: string): string {
  return join(getDomainOrdicabPath(domainPath), 'templates', `${templateId}.docx`)
}

export function getDomainTemplateContentPath(domainPath: string, templateId: string): string {
  return join(getDomainOrdicabPath(domainPath), 'templates', `${templateId}.html`)
}

export function getDomainClaudeMdPath(domainPath: string): string {
  return join(domainPath, 'CLAUDE.md')
}

export function getDomainDelegatedPath(domainPath: string): string {
  return join(domainPath, ORDICAB_DELEGATED_DIRECTORY_NAME)
}

export function getDomainDelegatedInboxPath(domainPath: string): string {
  return join(getDomainDelegatedPath(domainPath), 'inbox')
}

export function getDomainDelegatedProcessingPath(domainPath: string): string {
  return join(getDomainDelegatedPath(domainPath), 'processing')
}

export function getDomainDelegatedFailedPath(domainPath: string): string {
  return join(getDomainDelegatedPath(domainPath), 'failed')
}

export function getDomainDelegatedResponsesPath(domainPath: string): string {
  return join(getDomainDelegatedPath(domainPath), 'responses')
}

export function getDomainDelegatedStatePath(domainPath: string): string {
  return join(getDomainDelegatedPath(domainPath), 'state')
}

export function getDomainDelegatedProcessedCommandsPath(domainPath: string): string {
  return join(getDomainDelegatedStatePath(domainPath), 'processed-commands.json')
}

export function getDossierOrdicabPath(dossierPath: string): string {
  return join(dossierPath, ORDICAB_DIRECTORY_NAME)
}

export function getDossierMetadataPath(dossierPath: string): string {
  return join(getDossierOrdicabPath(dossierPath), 'dossier.json')
}

export function getDossierContactsPath(dossierPath: string): string {
  return join(getDossierOrdicabPath(dossierPath), 'contacts.json')
}

export function getDossierContactsDirectoryPath(dossierPath: string): string {
  return join(getDossierOrdicabPath(dossierPath), 'contacts')
}

export function getDossierContactRecordPath(dossierPath: string, uuid: string): string {
  return join(getDossierContactsDirectoryPath(dossierPath), `${uuid}.json`)
}

export function getDossierContactIndexPath(dossierPath: string): string {
  return join(getDossierOrdicabPath(dossierPath), 'contacts-index.json')
}

export function getDossierBillingItemsDirectoryPath(dossierPath: string): string {
  return join(getDossierOrdicabPath(dossierPath), 'billing-items')
}

export function getDossierBillingItemRecordPath(dossierPath: string, id: string): string {
  return join(getDossierBillingItemsDirectoryPath(dossierPath), `${id}.json`)
}

export function getDossierBillingItemIndexPath(dossierPath: string): string {
  return join(getDossierOrdicabPath(dossierPath), 'billing-items-index.json')
}

export function getDossierKeyDatesDirectoryPath(dossierPath: string): string {
  return join(getDossierOrdicabPath(dossierPath), 'key-dates')
}

export function getDossierKeyDateRecordPath(dossierPath: string, id: string): string {
  return join(getDossierKeyDatesDirectoryPath(dossierPath), `${id}.json`)
}

export function getDossierKeyDateIndexPath(dossierPath: string): string {
  return join(getDossierOrdicabPath(dossierPath), 'key-dates-index.json')
}

export function getDossierContentCachePath(dossierPath: string): string {
  return join(getDossierOrdicabPath(dossierPath), 'content-cache')
}

export function getDossierClaudeMdPath(dossierPath: string): string {
  return join(dossierPath, 'CLAUDE.md')
}
