import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'

import PizZip from 'pizzip'

import type {
  AppLocale,
  ContactRecord,
  DocumentRecord,
  DossierAiDirectoryLanguage,
  DossierAiExportAnalyzeResult,
  DossierAiExportDocumentEntry,
  DossierAiExportInput,
  DossierAiExportResult,
  DossierAiImportAnalyzeInput,
  DossierAiImportAnalyzeResult,
  DossierAiImportInput,
  DossierAiImportResult,
  DossierAiLocalePaths,
  DossierAiImportSourceFile,
  DossierDetail,
  ImportedProductionFileReport,
  EntityProfile,
  TemplateRecord
} from '@shared/types'
import { IpcErrorCode } from '@shared/types'
import { buildAddressFields } from '@shared/addressFormatting'
import { buildSalutationFields } from '@shared/contactSalutation'
import { computeContactDisplayName } from '@shared/computeContactDisplayName'
import {
  getContactManagedFieldTemplateValues,
  getContactManagedFieldValue,
  getContactManagedFieldValues,
  normalizeManagedFieldsConfig
} from '@shared/managedFields'
import { templateRoutineCatalog } from '@shared/templateRoutines'
import { RAW_TAG_PATTERN } from '@shared/templateContent/html'
import { labelToKey, normalizeTagPath } from '@shared/templateContent'

import { dossierMetadataFileSchema, entityProfileSchema } from '@renderer/schemas'
import {
  readCachedDocumentText,
  updateCachedDocumentText
} from '../../lib/aiEmbedded/documentContentService'
import { extractStructuredDocumentAnalysis } from '../../lib/aiEmbedded/documentStructuredAnalysis'
import { PiiMapping } from '../../lib/aiEmbedded/pii/piiMapping'
import { PiiPseudonymizer } from '../../lib/aiEmbedded/pii/piiPseudonymizer'
import {
  getDomainEntityPath,
  getDomainTemplateContentPath,
  getDomainTemplateDocxPath,
  getDomainTemplateRoutinesPath,
  getDomainTemplatesPath,
  getDossierContentCachePath,
  getDossierMetadataPath
} from '../../lib/ordicab/ordicabPaths'
import { pathExists } from '../../lib/system/domainState'

interface ContactServiceLike {
  list(dossierId: string): Promise<ContactRecord[]>
}

interface DocumentServiceLike {
  listDocuments(input: { dossierId: string }): Promise<DocumentRecord[]>
  resolveRegisteredDossierRoot(input: { dossierId: string }): Promise<string>
  saveMetadata(input: {
    dossierId: string
    documentId: string
    description?: string
    tags: string[]
  }): Promise<DocumentRecord>
  extractContent(input: { dossierId: string; documentId: string }): Promise<{ text: string }>
}

interface DossierServiceLike {
  getDossier(input: { dossierId: string }): Promise<DossierDetail>
}

export interface DossierTransferServiceOptions {
  contactService: ContactServiceLike
  documentService: DocumentServiceLike
  dossierService: DossierServiceLike
  getActiveLocale: () => AppLocale
  getDomainPath: () => Promise<string>
}

export interface DossierTransferService {
  analyzeExport(input: { dossierId: string }): Promise<DossierAiExportAnalyzeResult>
  exportForAi(input: DossierAiExportInput): Promise<DossierAiExportResult>
  analyzeImport(input: DossierAiImportAnalyzeInput): Promise<DossierAiImportAnalyzeResult>
  importProduction(input: DossierAiImportInput): Promise<DossierAiImportResult>
}

export class DossierTransferServiceError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'DossierTransferServiceError'
  }
}

type MappingFileEntry = {
  original: string
  markerPath: string
  fakeValue: string
}

interface TemplateContext {
  dossier: Record<string, unknown>
  contact: Record<string, unknown>
  contacts: ContactRecord[]
  entity: Record<string, unknown>
  today: string
}

interface ExportedRoutineEntry {
  path: string
  label: string
  category: string
  description: string
  status: 'resolved' | 'missing'
  value?: string
}

function toDirectoryLanguage(locale: AppLocale): DossierAiDirectoryLanguage {
  return locale === 'fr' ? 'fr' : 'en'
}

function getLocalePaths(locale: DossierAiDirectoryLanguage): DossierAiLocalePaths {
  if (locale === 'fr') {
    return {
      aiRootName: 'IA',
      templatesName: 'modeles',
      productionName: 'production',
      confidentialName: 'confidentiel'
    }
  }

  return {
    aiRootName: 'AI',
    templatesName: 'templates',
    productionName: 'production',
    confidentialName: 'confidential'
  }
}

function sanitizeExportFileStem(relativePath: string): string {
  return relativePath.replace(/[\\/]/g, '__').replace(/[^A-Za-z0-9._-]/g, '_')
}

function sanitizeDirectoryName(name: string): string {
  const normalized = name
    .trim()
    .replace(/[\\/]/g, '-')
    .replace(/[:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')

  return normalized || 'ordicab-export'
}

function ensureInside(basePath: string, candidatePath: string): string {
  const resolvedBase = resolve(basePath)
  const resolvedCandidate = resolve(candidatePath)

  if (resolvedCandidate !== resolvedBase && !resolvedCandidate.startsWith(`${resolvedBase}/`)) {
    throw new DossierTransferServiceError(
      IpcErrorCode.INVALID_INPUT,
      'Selected import path is outside the allowed production directory.'
    )
  }

  return resolvedCandidate
}

async function collectFiles(rootPath: string): Promise<string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(rootPath, entry.name)
      if (entry.isDirectory()) {
        return collectFiles(entryPath)
      }

      if (!entry.isFile()) {
        return []
      }

      return [entryPath]
    })
  )

  return files.flat().sort((left, right) => left.localeCompare(right))
}

async function readJsonIfExists<T>(path: string): Promise<T | null> {
  if (!(await pathExists(path))) {
    return null
  }

  return JSON.parse(await readFile(path, 'utf8')) as T
}

function createOfflineInstructions(options: {
  locale: DossierAiDirectoryLanguage
  paths: DossierAiLocalePaths
  dossierName: string
}): Record<string, string> {
  if (options.locale === 'fr') {
    return {
      'CLAUDE.md': `# Export IA Ordicab\n\nCet export peut etre utilise pour analyser le dossier, mais aussi pour creer de nouveaux documents a partir des informations et modeles fournis.\nCreez tous les nouveaux fichiers directement a la racine de ce repertoire.\nLisez les donnees du dossier dans \`${options.paths.aiRootName}/ordicab\`, les modeles dans \`${options.paths.aiRootName}/${options.paths.templatesName}\`, et la liste des routines dossier dans \`${options.paths.aiRootName}/ordicab/routines-dossier.json\`.\nQuand une donnee Ordicab correspond a une routine connue, preferez inserer la routine dans le document final plutot qu'une valeur inventee.\nSi une routine est marquee \`missing\`, laissez la routine dans le document final ou demandez la valeur a l'utilisateur. N'inventez jamais une valeur.\nQuand vous voyez un marker \`[[chemin.marker]]\` associe a une valeur visible, traitez cette valeur visible comme la valeur canonique a utiliser pour raisonner, lire les fichiers et rediger votre reponse.\nNe dites jamais que cette valeur est fictive, pseudonymisee, masquee ou absente du dossier partage. Ne cherchez jamais la valeur reelle derriere le marker.\nUtilisez uniquement la valeur visible (sans le marker) dans vos reponses et documents produits. Ne reproduisez jamais le format \`[[chemin.marker]]\` dans les documents generes.\nCette regle s'applique a toutes les reponses, brouillons, analyses et documents intermediaires produits dans cet export.\nN'utilisez jamais le repertoire \`${options.paths.confidentialName}\`.\nSi ce repertoire est visible, avertissez l'utilisateur et demandez-lui de ne partager que le repertoire \`${options.paths.aiRootName}\`.\nLe dossier cible est: ${options.dossierName}.\n`,
      'AGENTS.md': `# Consignes exportees\n\nCet espace peut servir a rediger et creer de nouveaux documents pour le dossier.\nCreez tous les nouveaux fichiers directement a la racine de ce repertoire.\nQuand une routine Ordicab existe, utilisez-la dans le document final. Si la valeur manque, laissez la routine en place au lieu d'inventer.\nQuand une valeur apparait avec un marker \`[[chemin.marker]]\`, utilisez uniquement la valeur visible dans vos documents et reponses, sans reproduire le marker.\n`,
      '.github/copilot-instructions.md': `N'accedez pas au repertoire ${options.paths.confidentialName}.`
    }
  }

  return {
    'CLAUDE.md': `# Ordicab AI Export\n\nThis export can be used to analyze the dossier, but also to create new documents from the provided data and templates.\nCreate every new file directly at the root of this directory.\nRead dossier data from \`${options.paths.aiRootName}/ordicab\`, templates from \`${options.paths.aiRootName}/${options.paths.templatesName}\`, and the dossier routine inventory from \`${options.paths.aiRootName}/ordicab/dossier-routines.json\`.\nWhen an Ordicab value maps to a known routine, prefer writing the routine in the final user-facing document instead of inventing a value.\nIf a routine is marked \`missing\`, keep the routine in the final document or ask the user for the value. Never invent one.\nWhenever you see a marker \`[[path.marker]]\` attached to a visible value, treat that visible value as the canonical working value for reading the shared files, reasoning, and drafting your response.\nNever say that this value is fake, pseudonymized, masked, or missing from the shared dossier. Never try to recover the real value behind the marker.\nUse only the visible value (without the marker) in your responses and produced documents. Never reproduce the \`[[path.marker]]\` format in generated documents.\nThis rule applies to all responses, drafts, analyses, and intermediate documents produced in this export.\nNever use the \`${options.paths.confidentialName}\` directory.\nIf that directory is visible, warn the user and ask them to share only the \`${options.paths.aiRootName}\` directory.\nTarget dossier: ${options.dossierName}.\n`,
    'AGENTS.md': `# Exported Instructions\n\nThis workspace can be used to draft and create new dossier documents.\nCreate every new file directly at the root of this directory.\nWhen an Ordicab routine exists, use that routine in the final document. If the value is missing, leave the routine in place instead of inventing data.\nWhenever a value appears with a \`[[path.marker]]\` marker, use the visible value directly in your documents and responses, without reproducing the marker.\n`,
    '.github/copilot-instructions.md': `Never access the ${options.paths.confidentialName} directory.`
  }
}

async function loadEntityProfile(domainPath: string): Promise<EntityProfile | null> {
  const entityPath = getDomainEntityPath(domainPath)
  const raw = await readJsonIfExists<unknown>(entityPath)
  if (!raw) {
    return null
  }

  const parsed = entityProfileSchema.safeParse(raw)
  if (!parsed.success) {
    return null
  }

  // Normalize managedFields to ensure required arrays are present
  const normalized: EntityProfile = {
    ...parsed.data,
    managedFields: parsed.data.managedFields
      ? normalizeManagedFieldsConfig(parsed.data.managedFields, parsed.data.profession)
      : undefined
  }
  return normalized
}

function toTemplateLookup(
  entries: Array<{ label: string; value: string }>
): Record<string, string> {
  return entries.reduce<Record<string, string>>((acc, entry) => {
    acc[labelToKey(entry.label)] = entry.value
    return acc
  }, {})
}

function resolvePathValue(input: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || typeof acc !== 'object') {
      return undefined
    }

    return (acc as Record<string, unknown>)[key]
  }, input)
}

function buildFirstNameFields(contact: ContactRecord | null | undefined): { firstNames: string } {
  const firstNames = [
    contact?.firstName,
    getContactManagedFieldValue(contact ?? {}, 'additionalFirstNames')
  ]
    .map((value) => value?.trim() ?? '')
    .filter(Boolean)
    .join(' ')

  return { firstNames }
}

function createTransferTemplateContext(
  dossier: DossierDetail,
  contacts: ContactRecord[],
  entity: EntityProfile | null
): TemplateContext {
  const managedFields = normalizeManagedFieldsConfig(entity?.managedFields, entity?.profession)
  const primaryContact = contacts[0] ?? undefined
  const keyDates = toTemplateLookup(
    dossier.keyDates.map((entry) => ({ label: entry.label, value: entry.date }))
  )
  const keyRefs = toTemplateLookup(
    dossier.keyReferences.map((entry) => ({ label: entry.label, value: entry.value }))
  )
  const contactByRole: Record<string, Record<string, unknown>> = {}

  for (const contact of contacts) {
    if (!contact.role) {
      continue
    }

    const displayName = computeContactDisplayName(contact)
    contactByRole[labelToKey(contact.role)] = {
      ...contact,
      ...getContactManagedFieldValues(contact),
      ...getContactManagedFieldTemplateValues(contact, managedFields.contacts),
      displayName,
      ...buildFirstNameFields(contact),
      ...buildSalutationFields(contact.gender, contact.lastName, displayName),
      ...buildAddressFields(contact)
    }
  }

  return {
    dossier: {
      name: dossier.name,
      reference: dossier.id,
      status: dossier.status,
      type: dossier.type,
      keyDate: keyDates,
      keyRef: keyRefs
    },
    contact: {
      ...(primaryContact ?? {}),
      ...(primaryContact ? getContactManagedFieldValues(primaryContact) : {}),
      ...(primaryContact
        ? getContactManagedFieldTemplateValues(primaryContact, managedFields.contacts)
        : {}),
      ...(primaryContact ? { displayName: computeContactDisplayName(primaryContact) } : {}),
      ...buildFirstNameFields(primaryContact),
      ...buildSalutationFields(
        primaryContact?.gender,
        primaryContact?.lastName,
        primaryContact ? computeContactDisplayName(primaryContact) : ''
      ),
      ...(primaryContact ? buildAddressFields(primaryContact) : {}),
      ...contactByRole
    },
    contacts,
    entity: {
      ...(entity ?? {}),
      ...buildAddressFields(entity ?? {}),
      displayName:
        [entity?.title, entity?.firstName, entity?.lastName].filter(Boolean).join(' ') || undefined
    },
    today: new Date().toISOString().slice(0, 10)
  }
}

function buildRoutineInventory(
  context: TemplateContext,
  locale: DossierAiDirectoryLanguage
): ExportedRoutineEntry[] {
  return templateRoutineCatalog.map((entry) => {
    const path = normalizeTagPath(entry.tag.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, ''))
    const value = resolvePathValue(context, path)
    const stringValue =
      value === undefined || value === null || value === '' ? undefined : String(value)

    return {
      path,
      label: locale === 'fr' ? (entry.tagFr ?? entry.tag) : entry.tag,
      category: entry.group,
      description: locale === 'fr' ? (entry.descriptionFr ?? entry.description) : entry.description,
      status: stringValue ? 'resolved' : 'missing',
      value: stringValue
    }
  })
}

function resolveKnownRoutinesInText(content: string, context: TemplateContext): string {
  return content.replace(RAW_TAG_PATTERN, (_match, rawPath: string) => {
    const normalizedPath = normalizeTagPath(rawPath.trim())
    const value = resolvePathValue(context, normalizedPath)
    if (value === undefined || value === null || value === '') {
      return _match
    }
    return String(value)
  })
}

function toPiiContext(
  dossier: DossierDetail,
  contacts: ContactRecord[]
): ConstructorParameters<typeof PiiPseudonymizer>[0] {
  return {
    contacts: contacts.map((contact) => ({
      id: contact.uuid,
      role: contact.role,
      gender: contact.gender,
      firstName: contact.firstName,
      lastName: contact.lastName,
      displayName: contact.displayName,
      email: contact.email,
      phone: contact.phone,
      addressLine: contact.addressLine,
      addressLine2: contact.addressLine2,
      zipCode: contact.zipCode,
      city: contact.city,
      institution: contact.institution,
      socialSecurityNumber: getContactManagedFieldValue(contact, 'socialSecurityNumber'),
      maidenName: getContactManagedFieldValue(contact, 'maidenName'),
      occupation: getContactManagedFieldValue(contact, 'occupation'),
      information: contact.information
    })),
    keyDates: dossier.keyDates.map((entry) => ({
      label: entry.label,
      value: entry.date,
      note: entry.note
    })),
    keyRefs: dossier.keyReferences.map((entry) => ({
      label: entry.label,
      value: entry.value,
      note: entry.note
    }))
  }
}

function pseudonymizeJsonString(pseudonymizer: PiiPseudonymizer | null, value: unknown): string {
  const raw = `${JSON.stringify(value, null, 2)}\n`
  return pseudonymizer ? `${JSON.stringify(pseudonymizer.pseudonymizeJson(value), null, 2)}\n` : raw
}

function restoreMarkers(
  text: string,
  mappingEntries: MappingFileEntry[] | null
): { value: string; restored: boolean } {
  if (!mappingEntries || mappingEntries.length === 0) {
    return { value: text, restored: false }
  }

  const mapping = new PiiMapping()
  for (const entry of mappingEntries) {
    mapping.add(entry.original, entry.markerPath, entry.fakeValue)
  }
  const restored = mapping.revert(text)

  return { value: restored, restored: restored !== text }
}

async function createUniqueDestinationPath(
  rootPath: string,
  relativePath: string
): Promise<{ absolutePath: string; savedRelativePath: string }> {
  const initialPath = ensureInside(rootPath, join(rootPath, relativePath))
  if (!(await pathExists(initialPath))) {
    return { absolutePath: initialPath, savedRelativePath: relativePath }
  }

  const ext = extname(relativePath)
  const stem = ext ? relativePath.slice(0, -ext.length) : relativePath
  let counter = 2

  while (true) {
    const candidateRelativePath = `${stem} (${counter})${ext}`
    const candidateAbsolutePath = ensureInside(rootPath, join(rootPath, candidateRelativePath))
    if (!(await pathExists(candidateAbsolutePath))) {
      return {
        absolutePath: candidateAbsolutePath,
        savedRelativePath: candidateRelativePath
      }
    }
    counter += 1
  }
}

async function loadTemplates(domainPath: string): Promise<TemplateRecord[]> {
  return (await readJsonIfExists<TemplateRecord[]>(getDomainTemplatesPath(domainPath))) ?? []
}

async function loadTemplateHtml(domainPath: string, templateId: string): Promise<string | null> {
  const path = getDomainTemplateContentPath(domainPath, templateId)
  if (!(await pathExists(path))) {
    return null
  }

  return readFile(path, 'utf8')
}

async function writeInstructionFiles(
  rootPath: string,
  files: Record<string, string>
): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = join(rootPath, relativePath)
    await mkdir(dirname(targetPath), { recursive: true })
    await writeFile(targetPath, content, 'utf8')
  }
}

const DOCX_TEXT_XML_PATHS = [
  'word/document.xml',
  'word/header1.xml',
  'word/header2.xml',
  'word/header3.xml',
  'word/footer1.xml',
  'word/footer2.xml',
  'word/footer3.xml',
  'word/comments.xml',
  'word/endnotes.xml',
  'word/footnotes.xml'
]

function applyTransformationsToDocx(
  buffer: Buffer,
  mappingEntries: MappingFileEntry[] | null,
  templateContext: TemplateContext | null
): { buffer: Buffer; restoredPii: boolean; resolvedRoutines: boolean } {
  const zip = new PizZip(buffer)
  let changed = false
  let restoredPii = false
  let resolvedRoutines = false

  for (const xmlPath of DOCX_TEXT_XML_PATHS) {
    const file = zip.files[xmlPath]
    if (!file) {
      continue
    }

    const original = file.asText()
    let current = original

    if (mappingEntries && mappingEntries.length > 0) {
      const { value: restored, restored: wasRestored } = restoreMarkers(current, mappingEntries)
      if (wasRestored) {
        current = restored
        restoredPii = true
      }
    }

    if (templateContext) {
      const resolved = resolveKnownRoutinesInText(current, templateContext)
      if (resolved !== current) {
        current = resolved
        resolvedRoutines = true
      }
    }

    if (current !== original) {
      zip.file(xmlPath, current)
      changed = true
    }
  }

  return {
    buffer: changed
      ? Buffer.from(zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }))
      : buffer,
    restoredPii,
    resolvedRoutines
  }
}

async function summarizeForIndexing(
  text: string,
  fallbackName: string
): Promise<{ description: string; tags: string[] }> {
  const normalized = text.replace(/\s+/g, ' ').trim()
  const analysis = extractStructuredDocumentAnalysis(normalized)
  const firstSentence = normalized.slice(0, 240).trim()
  const description = firstSentence || `Imported production file ${fallbackName}.`
  const tags = [...new Set(['imported', ...analysis.suggestedTags])]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 5)
  return { description, tags }
}

export function createDossierTransferService(
  options: DossierTransferServiceOptions
): DossierTransferService {
  const analyzeExport = async (input: {
    dossierId: string
  }): Promise<DossierAiExportAnalyzeResult> => {
    const locale = toDirectoryLanguage(options.getActiveLocale())
    const paths = getLocalePaths(locale)
    const dossier = await options.dossierService.getDossier(input)
    const documents = await options.documentService.listDocuments(input)
    const missingExtractionDocuments = documents
      .filter(
        (document) =>
          document.textExtraction.isExtractable && document.textExtraction.state !== 'extracted'
      )
      .map((document) => ({
        documentId: document.id,
        filename: document.filename,
        relativePath: document.relativePath
      }))

    const extractableDocumentCount = documents.filter(
      (document) => document.textExtraction.isExtractable
    ).length
    const extractedDocumentCount = documents.filter(
      (document) => document.textExtraction.state === 'extracted'
    ).length

    return {
      dossierId: dossier.id,
      dossierName: dossier.name,
      locale,
      paths,
      totalDocumentCount: documents.length,
      extractableDocumentCount,
      extractedDocumentCount,
      missingExtractionCount: missingExtractionDocuments.length,
      missingExtractionDocuments,
      canExport: missingExtractionDocuments.length === 0
    }
  }

  const exportForAi = async (input: DossierAiExportInput): Promise<DossierAiExportResult> => {
    const analysis = await analyzeExport({ dossierId: input.dossierId })

    const domainPath = await options.getDomainPath()
    const dossierPath = await options.documentService.resolveRegisteredDossierRoot({
      dossierId: input.dossierId
    })
    const dossier = await options.dossierService.getDossier({ dossierId: input.dossierId })
    const contacts = await options.contactService.list(input.dossierId)
    const documents = await options.documentService.listDocuments({ dossierId: input.dossierId })
    const templates = await loadTemplates(domainPath)
    const entity = await loadEntityProfile(domainPath)
    const locale = analysis.locale
    const paths = analysis.paths
    const exportFolderName = `${sanitizeDirectoryName(dossier.name)}__export_${new Date().toISOString().slice(0, 10)}`
    const exportRootPath = join(input.rootPath, exportFolderName)
    const aiPath = join(exportRootPath, paths.aiRootName)
    const confidentialPath = input.anonymize ? join(exportRootPath, paths.confidentialName) : null
    const ordicabExportPath = join(aiPath, 'ordicab')
    const contentExportPath = join(ordicabExportPath, 'content')
    const templatesExportPath = join(aiPath, paths.templatesName)
    const productionExportPath = join(aiPath, paths.productionName)
    const pseudonymizer = input.anonymize
      ? new PiiPseudonymizer(toPiiContext(dossier, contacts))
      : null
    const routineInventory = buildRoutineInventory(
      createTransferTemplateContext(dossier, contacts, entity),
      locale
    )

    await mkdir(contentExportPath, { recursive: true })
    await mkdir(templatesExportPath, { recursive: true })
    await mkdir(productionExportPath, { recursive: true })
    if (confidentialPath) {
      await mkdir(confidentialPath, { recursive: true })
    }

    const cacheDir = getDossierContentCachePath(dossierPath)
    const exportedDocuments: DossierAiExportDocumentEntry[] = []

    for (const document of documents) {
      if (!document.textExtraction.isExtractable || document.textExtraction.state !== 'extracted') {
        continue
      }

      const cached = await readCachedDocumentText(
        join(dossierPath, document.relativePath),
        cacheDir
      )
      if (!cached) {
        continue
      }

      const exportedTextPath = `content/${sanitizeExportFileStem(document.relativePath)}.txt`
      const exportedText = pseudonymizer ? pseudonymizer.pseudonymize(cached.text) : cached.text
      await writeFile(join(ordicabExportPath, exportedTextPath), `${exportedText}\n`, 'utf8')
      exportedDocuments.push({
        documentId: document.id,
        sourceRelativePath: document.relativePath,
        filename: document.filename,
        exportedTextPath,
        modifiedAt: document.modifiedAt,
        description: document.description,
        tags: document.tags
      })
    }

    const metadataJson = await readJsonIfExists<unknown>(getDossierMetadataPath(dossierPath))
    const validatedMetadata = metadataJson ? dossierMetadataFileSchema.parse(metadataJson) : null
    await writeFile(
      join(ordicabExportPath, 'dossier.json'),
      pseudonymizeJsonString(pseudonymizer, validatedMetadata ?? dossier),
      'utf8'
    )
    await writeFile(
      join(ordicabExportPath, 'contacts.json'),
      pseudonymizeJsonString(pseudonymizer, contacts),
      'utf8'
    )
    await writeFile(
      join(ordicabExportPath, 'documents.json'),
      pseudonymizeJsonString(pseudonymizer, exportedDocuments),
      'utf8'
    )
    await writeFile(
      join(ordicabExportPath, locale === 'fr' ? 'routines-dossier.json' : 'dossier-routines.json'),
      pseudonymizeJsonString(pseudonymizer, routineInventory),
      'utf8'
    )

    const templateIndex = templates.map((template) => {
      const record = { ...template }
      delete record.content
      return record
    })
    await writeFile(
      join(templatesExportPath, 'templates.json'),
      pseudonymizeJsonString(pseudonymizer, templateIndex),
      'utf8'
    )

    for (const template of templates) {
      const html = await loadTemplateHtml(domainPath, template.id)
      if (!html) {
        if (template.hasDocxSource) {
          const docxPath = getDomainTemplateDocxPath(domainPath, template.id)
          if (await pathExists(docxPath)) {
            await writeFile(
              join(templatesExportPath, `${template.id}.docx`),
              await readFile(docxPath)
            )
          }
        }
        continue
      }
      const output = pseudonymizer ? pseudonymizer.pseudonymize(html) : html
      await writeFile(join(templatesExportPath, `${template.id}.html`), output, 'utf8')
      if (template.hasDocxSource) {
        const docxPath = getDomainTemplateDocxPath(domainPath, template.id)
        if (await pathExists(docxPath)) {
          await writeFile(
            join(templatesExportPath, `${template.id}.docx`),
            await readFile(docxPath)
          )
        }
      }
    }

    const routinesPath = getDomainTemplateRoutinesPath(domainPath)
    if (await pathExists(routinesPath)) {
      const routines = await readFile(routinesPath, 'utf8')
      await writeFile(
        join(templatesExportPath, 'template-routines.md'),
        pseudonymizer ? pseudonymizer.pseudonymize(routines) : routines,
        'utf8'
      )
    }

    await writeInstructionFiles(
      aiPath,
      createOfflineInstructions({
        locale,
        paths,
        dossierName: dossier.name
      })
    )

    if (confidentialPath && pseudonymizer) {
      await writeFile(
        join(confidentialPath, 'pii-mapping.json'),
        `${JSON.stringify(pseudonymizer.exportMapping(), null, 2)}\n`,
        'utf8'
      )
    }

    return {
      dossierId: input.dossierId,
      rootPath: exportRootPath,
      aiPath,
      confidentialPath,
      locale,
      exportedDocumentCount: exportedDocuments.length,
      exportedTemplateCount: templates.length,
      anonymized: input.anonymize
    }
  }

  const analyzeImport = async (
    input: DossierAiImportAnalyzeInput
  ): Promise<DossierAiImportAnalyzeResult> => {
    const locale = toDirectoryLanguage(options.getActiveLocale())
    const localePaths = getLocalePaths(locale)
    const rootStats = await stat(input.sourcePath).catch(() => null)
    if (!rootStats?.isDirectory()) {
      throw new DossierTransferServiceError(
        IpcErrorCode.NOT_FOUND,
        'Selected import source is not a directory.'
      )
    }

    const aiPath =
      basename(input.sourcePath) === localePaths.aiRootName
        ? input.sourcePath
        : (await pathExists(join(input.sourcePath, localePaths.aiRootName)))
          ? join(input.sourcePath, localePaths.aiRootName)
          : null

    const importRootPath = aiPath ?? input.sourcePath

    const confidentialPath =
      aiPath && (await pathExists(join(dirname(aiPath), localePaths.confidentialName)))
        ? join(dirname(aiPath), localePaths.confidentialName)
        : (await pathExists(join(input.sourcePath, localePaths.confidentialName)))
          ? join(input.sourcePath, localePaths.confidentialName)
          : null

    const excludedTopLevel = new Set([
      localePaths.templatesName,
      localePaths.confidentialName,
      'ordicab',
      '.github',
      'CLAUDE.md',
      'AGENTS.md'
    ])

    const allFiles = await collectFiles(importRootPath)
    const files = allFiles
      .filter((absolutePath) => {
        const rel = relative(importRootPath, absolutePath)
        const topLevel = rel.split('/')[0]
        return !excludedTopLevel.has(topLevel)
      })
      .map(
        (absolutePath): DossierAiImportSourceFile => ({
          absolutePath,
          relativePath: relative(importRootPath, absolutePath)
        })
      )

    return {
      dossierId: input.dossierId,
      locale,
      paths: localePaths,
      sourcePath: input.sourcePath,
      resolvedAiPath: aiPath,
      resolvedProductionPath: importRootPath,
      resolvedConfidentialPath: confidentialPath,
      hasPiiMapping: confidentialPath
        ? await pathExists(join(confidentialPath, 'pii-mapping.json'))
        : false,
      fileCount: files.length,
      files
    }
  }

  const importProduction = async (input: DossierAiImportInput): Promise<DossierAiImportResult> => {
    const analysis = await analyzeImport(input)
    const dossierPath = await options.documentService.resolveRegisteredDossierRoot({
      dossierId: input.dossierId
    })
    const dossier = await options.dossierService.getDossier({ dossierId: input.dossierId })
    const contacts = await options.contactService.list(input.dossierId)
    const domainPath = await options.getDomainPath()
    const entity = await loadEntityProfile(domainPath)
    const templateContext = createTransferTemplateContext(dossier, contacts, entity)
    const mappingEntries =
      analysis.hasPiiMapping && analysis.resolvedConfidentialPath
        ? await readJsonIfExists<MappingFileEntry[]>(
            join(analysis.resolvedConfidentialPath, 'pii-mapping.json')
          )
        : null
    const selectedSet = input.selectedRelativePaths ? new Set(input.selectedRelativePaths) : null
    const filesToImport = selectedSet
      ? analysis.files.filter((f) => selectedSet.has(f.relativePath))
      : analysis.files
    const reports: ImportedProductionFileReport[] = []

    for (const file of filesToImport) {
      const sourceBuffer = await readFile(file.absolutePath)
      const destination = await createUniqueDestinationPath(dossierPath, file.relativePath)
      await mkdir(dirname(destination.absolutePath), { recursive: true })

      const ext = extname(file.relativePath).toLowerCase()
      const isBinary = [
        '.docx',
        '.doc',
        '.pdf',
        '.xlsx',
        '.xls',
        '.pptx',
        '.ppt',
        '.odt',
        '.ods',
        '.odp'
      ].includes(ext)

      let restoredPii = false
      let resolvedRoutines = false
      if (isBinary) {
        const isDocx = ext === '.docx' || ext === '.doc'
        if (isDocx) {
          const result = applyTransformationsToDocx(sourceBuffer, mappingEntries, templateContext)
          restoredPii = result.restoredPii
          resolvedRoutines = result.resolvedRoutines
          await writeFile(destination.absolutePath, result.buffer)
        } else {
          await writeFile(destination.absolutePath, sourceBuffer)
        }
      } else {
        const sourceText = sourceBuffer.toString('utf8')
        const restoredMarkers = restoreMarkers(sourceText, mappingEntries)
        const routineResolved = resolveKnownRoutinesInText(restoredMarkers.value, templateContext)
        await writeFile(destination.absolutePath, routineResolved, 'utf8')
        restoredPii = restoredMarkers.restored
        resolvedRoutines = routineResolved !== restoredMarkers.value
      }

      let extractedText = false
      let indexed = false
      let message: string | null = null

      try {
        const extracted = await options.documentService.extractContent({
          dossierId: input.dossierId,
          documentId: destination.savedRelativePath
        })
        let normalizedExtractedText = extracted.text
        if (mappingEntries && mappingEntries.length > 0) {
          const restoredExtracted = restoreMarkers(normalizedExtractedText, mappingEntries)
          if (restoredExtracted.restored) {
            normalizedExtractedText = restoredExtracted.value
            restoredPii = true
          }
        }
        const resolvedExtractedText = resolveKnownRoutinesInText(
          normalizedExtractedText,
          templateContext
        )
        if (resolvedExtractedText !== normalizedExtractedText) {
          normalizedExtractedText = resolvedExtractedText
          resolvedRoutines = true
        }
        if (normalizedExtractedText !== extracted.text) {
          const cacheDir = getDossierContentCachePath(dossierPath)
          await updateCachedDocumentText(
            destination.absolutePath,
            cacheDir,
            normalizedExtractedText
          )
        }

        extractedText = Boolean(normalizedExtractedText.trim())
        if (extractedText) {
          const summary = await summarizeForIndexing(
            normalizedExtractedText,
            basename(destination.savedRelativePath)
          )
          await options.documentService.saveMetadata({
            dossierId: input.dossierId,
            documentId: destination.savedRelativePath,
            description: summary.description,
            tags: summary.tags
          })
          indexed = true
        }
      } catch (error) {
        message = error instanceof Error ? error.message : 'Imported file without text extraction.'
      }

      reports.push({
        sourceRelativePath: file.relativePath,
        savedRelativePath: destination.savedRelativePath,
        restoredPii,
        extractedText,
        indexed,
        status: 'imported',
        message: resolvedRoutines
          ? message
            ? `${message} Known Ordicab routines were resolved.`
            : 'Known Ordicab routines were resolved during import.'
          : message
      })
    }

    return {
      dossierId: input.dossierId,
      resolvedProductionPath: analysis.resolvedProductionPath,
      importedCount: reports.filter((entry) => entry.status === 'imported').length,
      skippedCount: reports.filter((entry) => entry.status === 'skipped').length,
      failedCount: reports.filter((entry) => entry.status === 'failed').length,
      files: reports
    }
  }

  return {
    analyzeExport,
    exportForAi,
    analyzeImport,
    importProduction
  }
}
