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

export function getDomainTemplatesPath(domainPath: string): string {
  return join(getDomainOrdicabPath(domainPath), 'templates.json')
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

export function getDomainAgentsMdPath(domainPath: string): string {
  return join(domainPath, 'AGENTS.md')
}

export function getDomainCopilotInstructionsPath(domainPath: string): string {
  return join(domainPath, '.github', 'copilot-instructions.md')
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

export function getDossierContentCachePath(dossierPath: string): string {
  return join(getDossierOrdicabPath(dossierPath), 'content-cache')
}

/** @deprecated Use getDossierContentCachePath */
export function getDossierOcrCachePath(dossierPath: string): string {
  return getDossierContentCachePath(dossierPath)
}

export function getDossierClaudeMdPath(dossierPath: string): string {
  return join(dossierPath, 'CLAUDE.md')
}
