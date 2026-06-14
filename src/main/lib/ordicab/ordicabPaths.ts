import { join } from 'node:path'

export const ORDICAB_DIRECTORY_NAME = '.ordicab'
const ORDICAB_DELEGATED_DIRECTORY_NAME = '.ordicab-delegated'

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

export function getDomainGeneralKeyDatesDirectoryPath(domainPath: string): string {
  return join(getDomainOrdicabPath(domainPath), 'general-key-dates')
}

export function getDomainGeneralKeyDateRecordPath(domainPath: string, uuid: string): string {
  return join(getDomainGeneralKeyDatesDirectoryPath(domainPath), `${uuid}.json`)
}

/**
 * Local state of the CalDAV calendar push (uuid → pushed href + content hash).
 * Not secret; the watcher ignores it (unknown filename → no change event).
 */
export function getDomainCalendarSyncStatePath(domainPath: string): string {
  return join(getDomainOrdicabPath(domainPath), 'calendar-sync-state.json')
}

export function getDomainCabinetDefaultTemplateDocxPath(domainPath: string): string {
  return join(getDomainOrdicabPath(domainPath), 'cabinet-default-template.docx')
}

/**
 * Imported lawyer stamp image (cachet), re-encoded as PNG on import.
 * Applied on the first page of each pièce cotée.
 */
export function getDomainStampImagePath(domainPath: string): string {
  return join(getDomainOrdicabPath(domainPath), 'stamp.png')
}

export function getDomainCabinetBillingPath(domainPath: string): string {
  return join(getDomainOrdicabPath(domainPath), 'cabinet-billing.json')
}

export function getDomainTemplatesPath(domainPath: string): string {
  return join(getDomainOrdicabPath(domainPath), 'templates.json')
}

export function getDomainInvoiceDocumentsPath(domainPath: string): string {
  return join(getDomainOrdicabPath(domainPath), 'invoice-documents')
}

export function getDomainInvoiceRecordsDirectoryPath(domainPath: string): string {
  return join(getDomainOrdicabPath(domainPath), 'invoices')
}

export function getDomainInvoiceRecordPath(domainPath: string, uuid: string): string {
  return join(getDomainInvoiceRecordsDirectoryPath(domainPath), `${uuid}.json`)
}

export function getDomainTemplateRoutinesPath(domainPath: string): string {
  return join(getDomainOrdicabPath(domainPath), 'template-routines.md')
}

export function getDomainTemplateDocxPath(domainPath: string, templateUuid: string): string {
  return join(getDomainOrdicabPath(domainPath), 'templates', `${templateUuid}.docx`)
}

export function getDomainTemplateContentPath(domainPath: string, templateUuid: string): string {
  return join(getDomainOrdicabPath(domainPath), 'templates', `${templateUuid}.html`)
}

export function getDomainClaudeMdPath(domainPath: string): string {
  return join(domainPath, 'CLAUDE.md')
}

function getDomainDelegatedPath(domainPath: string): string {
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

export function getDossierGenerationPrefillPath(dossierPath: string): string {
  return join(getDossierOrdicabPath(dossierPath), 'generation-prefill.json')
}

export function getDossierContactsDirectoryPath(dossierPath: string): string {
  return join(getDossierOrdicabPath(dossierPath), 'contacts')
}

export function getDossierContactRecordPath(dossierPath: string, uuid: string): string {
  return join(getDossierContactsDirectoryPath(dossierPath), `${uuid}.json`)
}

export function getDossierBillingItemsDirectoryPath(dossierPath: string): string {
  return join(getDossierOrdicabPath(dossierPath), 'billing-items')
}

export function getDossierBillingItemRecordPath(dossierPath: string, uuid: string): string {
  return join(getDossierBillingItemsDirectoryPath(dossierPath), `${uuid}.json`)
}

export function getDossierKeyDatesDirectoryPath(dossierPath: string): string {
  return join(getDossierOrdicabPath(dossierPath), 'key-dates')
}

export function getDossierKeyDateRecordPath(dossierPath: string, uuid: string): string {
  return join(getDossierKeyDatesDirectoryPath(dossierPath), `${uuid}.json`)
}

export function getDossierNotesDirectoryPath(dossierPath: string): string {
  return join(getDossierOrdicabPath(dossierPath), 'notes')
}

export function getDossierNoteRecordPath(dossierPath: string, uuid: string): string {
  return join(getDossierNotesDirectoryPath(dossierPath), `${uuid}.json`)
}

/**
 * Per-note embedding cache. Mirrors the per-document content-cache shape
 * (`{ text, embeddings }`) so the shared semantic-search engine can consume
 * notes and documents through the same code path. Lives in a dedicated
 * `notes/embeddings/` subfolder so it never pollutes the note-record scan
 * (`readdir` on `notes/` is non-recursive).
 */
export function getDossierNoteEmbeddingCachePath(dossierPath: string, uuid: string): string {
  return join(getDossierNotesDirectoryPath(dossierPath), 'embeddings', `${uuid}.json`)
}

export function getDossierContentCachePath(dossierPath: string): string {
  return join(getDossierOrdicabPath(dossierPath), 'content-cache')
}

export function getDossierClaudeMdPath(dossierPath: string): string {
  return join(dossierPath, 'CLAUDE.md')
}

/**
 * Claude Cowork export workspace. A visible folder inside the dossier holding
 * pseudonymized Markdown only — excluded from document indexing and watching.
 * The PII mapping that reverts it lives in `.ordicab/pii-mapping.json`, never
 * inside `Cowork/`.
 */
export const COWORK_DIRECTORY_NAME = 'Cowork'
const COWORK_RESULTS_DIRECTORY_NAME = 'resultats'

export function getDossierCoworkPath(dossierPath: string): string {
  return join(dossierPath, COWORK_DIRECTORY_NAME)
}

export function getDossierCoworkDocumentsPath(dossierPath: string): string {
  return join(getDossierCoworkPath(dossierPath), 'documents')
}

export function getDossierCoworkResultsPath(dossierPath: string): string {
  return join(getDossierCoworkPath(dossierPath), COWORK_RESULTS_DIRECTORY_NAME)
}

export function getDossierCoworkImportedResultsPath(dossierPath: string): string {
  return join(getDossierCoworkResultsPath(dossierPath), 'importes')
}

export function getDossierCoworkClaudeMdPath(dossierPath: string): string {
  return join(getDossierCoworkPath(dossierPath), 'CLAUDE.md')
}

export function getDossierCoworkSynthesisPath(dossierPath: string): string {
  return join(getDossierCoworkPath(dossierPath), 'dossier.md')
}

export function getDossierPiiMappingPath(dossierPath: string): string {
  return join(getDossierOrdicabPath(dossierPath), 'pii-mapping.json')
}
