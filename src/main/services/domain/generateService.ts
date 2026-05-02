import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import Docxtemplater from 'docxtemplater'
import HTMLToDOCX from 'html-to-docx'
import { convert as htmlToText } from 'html-to-text'
import mammoth from 'mammoth'
import PizZip from 'pizzip'

import type {
  ContactRecord,
  DocxPreviewResult,
  DomainStatusSnapshot,
  EntityProfile,
  GenerateDocumentInput,
  GeneratePreviewInput,
  GeneratedDocumentResult,
  GeneratedDraftResult,
  SaveGeneratedDocumentInput,
  TemplateRecord
} from '@shared/types'
import { IpcErrorCode } from '@shared/types'
import { buildSalutationFields } from '@shared/contactSalutation'
import { buildAddressFields } from '@shared/addressFormatting'
import { computeContactDisplayName } from '@shared/computeContactDisplayName'
import {
  getContactManagedFieldTemplateValues,
  getContactManagedFieldValue,
  getContactManagedFieldValues,
  normalizeManagedFieldsConfig
} from '@shared/managedFields'
import {
  ensureTemplateHtml,
  isBlankTemplateContent,
  labelToKey,
  normalizeTagPath,
  RAW_TAG_PATTERN,
  renderSmartTagSpan,
  TAG_SPAN_PATTERN
} from '@shared/templateContent'

import {
  contactRecordSchema,
  dossierMetadataFileSchema,
  entityProfileSchema,
  type DossierMetadataFile,
  templateRecordSchema
} from '@shared/validation'
import { type DocumentService } from './documentService'
import { atomicWrite } from '../../lib/system/atomicWrite'
import { pathExists } from '../../lib/system/domainState'
import {
  getDomainEntityPath,
  getDomainTemplateContentPath,
  getDomainTemplateDocxPath,
  getDomainTemplatesPath,
  getDossierContactsPath,
  getDossierMetadataPath
} from '../../lib/ordicab/ordicabPaths'

interface DomainServiceLike {
  getStatus: () => Promise<DomainStatusSnapshot>
}

type DocumentServiceLike = Pick<DocumentService, 'resolveRegisteredDossierRoot'> &
  Partial<Pick<DocumentService, 'saveMetadata'>>

export interface GenerateService {
  generateDocument: (input: GenerateDocumentInput) => Promise<GeneratedDocumentResult>
  previewDocument: (input: GeneratePreviewInput) => Promise<GeneratedDraftResult>
  previewDocxDocument: (input: GeneratePreviewInput) => Promise<DocxPreviewResult>
  saveGeneratedDocument: (input: SaveGeneratedDocumentInput) => Promise<GeneratedDocumentResult>
}

export interface GenerateServiceOptions {
  domainService: DomainServiceLike
  documentService: DocumentServiceLike
  now?: () => Date
}

interface TemplateContext {
  app?: {
    content: string
  }
  dossier: {
    name: string
    reference: string
    status: string
    type: string
    createdAt: DateValue
    createdAtFormatted: string
    createdAtLong: string
    createdAtShort: string
    keyDate: Record<string, DateValue>
    keyRef: Record<string, string>
  }
  contact: Record<string, unknown>
  contacts: ContactRecord[]
  entity: Record<string, unknown>
  today: string
  todayFormatted: string
  todayLong: string
  todayShort: string
  createdAt: DateValue
}

interface DraftBuildResult {
  draftHtml: string
  suggestedFilename: string
  unresolvedTags: string[]
  resolvedTags: Record<string, string>
  dossierPath: string
}

interface LoadedGenerationData {
  templates: TemplateRecord[]
  dossier: DossierMetadataFile
  contacts: ContactRecord[]
  entity: EntityProfile | null
  domainPath: string
  dossierPath: string
}

export class GenerateServiceError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string,
    readonly unresolvedTags?: string[]
  ) {
    super(message)
    this.name = 'GenerateServiceError'
  }
}

async function resolveActiveDomainPath(domainService: DomainServiceLike): Promise<string> {
  const status = await domainService.getStatus()

  if (!status.registeredDomainPath) {
    throw new GenerateServiceError(IpcErrorCode.NOT_FOUND, 'Active domain is not configured.')
  }

  if (!status.isAvailable) {
    throw new GenerateServiceError(IpcErrorCode.NOT_FOUND, 'Active domain is unavailable.')
  }

  return status.registeredDomainPath
}

async function loadTemplateContent(domainPath: string, templateId: string): Promise<string> {
  const contentPath = getDomainTemplateContentPath(domainPath, templateId)

  if (!(await pathExists(contentPath))) {
    return ''
  }

  try {
    return await readFile(contentPath, 'utf8')
  } catch {
    return ''
  }
}

async function loadTemplates(templatesPath: string): Promise<TemplateRecord[]> {
  if (!(await pathExists(templatesPath))) {
    throw new GenerateServiceError(IpcErrorCode.NOT_FOUND, 'No templates are available.')
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(await readFile(templatesPath, 'utf8')) as unknown
  } catch {
    throw new GenerateServiceError(IpcErrorCode.FILE_SYSTEM_ERROR, 'Unable to read templates.')
  }

  const result = templateRecordSchema.array().safeParse(parsed)

  if (!result.success) {
    throw new GenerateServiceError(IpcErrorCode.FILE_SYSTEM_ERROR, 'Stored templates are invalid.')
  }

  return result.data
}

async function loadDossierMetadata(dossierPath: string): Promise<DossierMetadataFile> {
  const metadataPath = getDossierMetadataPath(dossierPath)

  if (!(await pathExists(metadataPath))) {
    throw new GenerateServiceError(IpcErrorCode.NOT_FOUND, 'Dossier metadata was not found.')
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(await readFile(metadataPath, 'utf8')) as unknown
  } catch {
    throw new GenerateServiceError(
      IpcErrorCode.FILE_SYSTEM_ERROR,
      'Unable to read dossier metadata.'
    )
  }

  const result = dossierMetadataFileSchema.safeParse(parsed)

  if (!result.success) {
    throw new GenerateServiceError(
      IpcErrorCode.FILE_SYSTEM_ERROR,
      'Stored dossier metadata is invalid.'
    )
  }

  return result.data
}

async function loadContacts(contactsPath: string): Promise<ContactRecord[]> {
  if (!(await pathExists(contactsPath))) {
    return []
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(await readFile(contactsPath, 'utf8')) as unknown
  } catch {
    throw new GenerateServiceError(
      IpcErrorCode.FILE_SYSTEM_ERROR,
      'Unable to read dossier contacts.'
    )
  }

  const result = contactRecordSchema.array().safeParse(parsed)

  if (!result.success) {
    throw new GenerateServiceError(
      IpcErrorCode.FILE_SYSTEM_ERROR,
      'Stored dossier contacts are invalid.'
    )
  }

  return result.data
}

async function loadEntity(entityPath: string): Promise<EntityProfile | null> {
  if (!(await pathExists(entityPath))) {
    return null
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(await readFile(entityPath, 'utf8')) as unknown
  } catch {
    throw new GenerateServiceError(
      IpcErrorCode.FILE_SYSTEM_ERROR,
      'Unable to read professional entity profile.'
    )
  }

  const result = entityProfileSchema.safeParse(parsed)

  if (!result.success) {
    throw new GenerateServiceError(
      IpcErrorCode.FILE_SYSTEM_ERROR,
      'Stored professional entity profile is invalid.'
    )
  }

  return result.data as EntityProfile
}

function toTemplateLookup(
  entries: Array<{
    label: string
    value: string
  }>
): Record<string, string> {
  return entries.reduce<Record<string, string>>((acc, entry) => {
    acc[labelToKey(entry.label)] = entry.value
    return acc
  }, {})
}

function resolvePath(input: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || typeof acc !== 'object') {
      return undefined
    }

    return (acc as Record<string, unknown>)[key]
  }, input)
}

function hasResolvedPath(input: unknown, path: string): boolean {
  return path.split('.').every((key) => {
    if (input === null || typeof input !== 'object') {
      return false
    }

    const current = input as Record<string, unknown>

    if (!(key in current)) {
      return false
    }

    input = current[key]
    return true
  })
}

function escapeHtmlText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function asHtmlText(value: unknown): string {
  return escapeHtmlText(String(value)).replace(/\r?\n/g, '<br />')
}

/**
 * An object that holds an ISO date string plus locale-formatted variants.
 * Its `toString()` returns the raw ISO string so it is backward-compatible
 * wherever the value is converted to a string (template rendering, docxtemplater, etc.).
 */
interface DateValue {
  readonly formatted: string
  readonly long: string
  readonly short: string
  toString(): string
}

function makeDateValue(isoDate: string): DateValue {
  const date = new Date(isoDate.length === 10 ? `${isoDate}T12:00:00` : isoDate)
  const variants = isNaN(date.getTime())
    ? { formatted: isoDate, long: isoDate, short: isoDate }
    : {
        formatted: date.toLocaleDateString('fr-FR'),
        long: date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }),
        short: date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' })
      }
  return { ...variants, toString: () => isoDate }
}

function formatDateVariants(isoDate: string): { formatted: string; long: string; short: string } {
  const d = makeDateValue(isoDate)
  return { formatted: d.formatted, long: d.long, short: d.short }
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

function resolveTemplateHtml(
  content: string,
  context: TemplateContext,
  tagOverrides?: Record<string, string>
): Pick<GeneratedDraftResult, 'draftHtml' | 'unresolvedTags' | 'resolvedTags'> {
  const unresolvedTags = new Set<string>()
  const resolvedTags: Record<string, string> = {}
  const templateHtml = ensureTemplateHtml(content)

  const replaceTagPath = (path: string): string => {
    const normalizedPath = normalizeTagPath(path.trim())

    if (tagOverrides && normalizedPath in tagOverrides) {
      const overrideValue = tagOverrides[normalizedPath] ?? ''
      if (overrideValue === '') {
        unresolvedTags.add(normalizedPath)
        return renderSmartTagSpan(normalizedPath)
      }
      resolvedTags[normalizedPath] = overrideValue
      return asHtmlText(overrideValue)
    }

    const value = resolvePath(context, normalizedPath)

    if (value === undefined || value === null) {
      unresolvedTags.add(normalizedPath)
      return renderSmartTagSpan(normalizedPath)
    }

    if (value === '' && !hasResolvedPath(context, normalizedPath)) {
      unresolvedTags.add(normalizedPath)
      return renderSmartTagSpan(normalizedPath)
    }

    resolvedTags[normalizedPath] = String(value)
    return asHtmlText(value)
  }

  const afterSpanResolution = templateHtml.replace(
    TAG_SPAN_PATTERN,
    (_match, _quote: string, rawPath: string) => replaceTagPath(rawPath)
  )
  const draftHtml = afterSpanResolution.replace(RAW_TAG_PATTERN, (_match, rawPath: string) =>
    replaceTagPath(rawPath)
  )

  return {
    draftHtml,
    unresolvedTags: [...unresolvedTags],
    resolvedTags
  }
}

function sanitizeFilenameSegment(name: string): string {
  const sanitized = Array.from(name, (character) => {
    const code = character.charCodeAt(0)

    if ('<>:"/\\|?*'.includes(character) || code < 32) {
      return '-'
    }

    return character
  }).join('')

  const normalized = sanitized.trim()
  return normalized || 'generated-document'
}

function stripKnownExtension(filename: string): string {
  return filename
    .trim()
    .replace(/\.(txt|docx|md)$/i, '')
    .trim()
}

async function resolveUniqueOutputPath(
  dir: string,
  baseName: string,
  extension: string
): Promise<string> {
  const candidate = join(dir, `${baseName}.${extension}`)

  if (!(await pathExists(candidate))) {
    return candidate
  }

  for (let suffix = 2; suffix <= 99; suffix++) {
    const next = join(dir, `${baseName}-${suffix}.${extension}`)

    if (!(await pathExists(next))) {
      return next
    }
  }

  return join(dir, `${baseName}-${Date.now()}.${extension}`)
}

function createHtmlDocument(bodyHtml: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body>${bodyHtml}</body></html>`
}

function htmlToPlainText(html: string): string {
  return htmlToText(createHtmlDocument(html), {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' }
    ]
  }).trimEnd()
}

async function toDocxBuffer(html: string): Promise<Uint8Array> {
  const output = await HTMLToDOCX(createHtmlDocument(html), undefined, {
    title: 'Ordicab generated document',
    creator: 'Ordicab',
    lastModifiedBy: 'Ordicab',
    font: 'Aptos',
    fontSize: 22,
    decodeUnicode: true,
    lang: 'fr-FR'
  })

  if (output instanceof Uint8Array) {
    return output
  }

  if (typeof Blob !== 'undefined' && output instanceof Blob) {
    return new Uint8Array(await output.arrayBuffer())
  }

  return new Uint8Array(output as ArrayBuffer)
}

async function extractDocxTagPaths(docxSourcePath: string): Promise<string[]> {
  const content = await readFile(docxSourcePath)
  const capturedTags = new Set<string>()

  try {
    const zip = new PizZip(content)
    // Use docxtemplater's own parser to extract tags — it handles split XML runs
    // (Word splits {{tag}} across multiple <w:t> elements for spell/grammar checks).
    new Docxtemplater(zip, {
      delimiters: { start: '{{', end: '}}' },
      parser: (tag: string) => {
        const trimmed = tag.trim()
        if (
          trimmed &&
          !trimmed.startsWith('#') &&
          !trimmed.startsWith('/') &&
          !trimmed.startsWith('@') &&
          !trimmed.startsWith('app.')
        ) {
          capturedTags.add(normalizeTagPath(trimmed))
        }
        return { get: () => '' }
      },
      nullGetter: () => '',
      paragraphLoop: true,
      linebreaks: true
    })
  } catch {
    // If docxtemplater can't parse the template, return whatever was captured so far
  }

  return [...capturedTags]
}

async function generateDocxFromBinary(
  docxSourcePath: string,
  context: TemplateContext,
  outputPath: string,
  tagOverrides?: Record<string, string>
): Promise<void> {
  if (!(await pathExists(docxSourcePath))) {
    throw new GenerateServiceError(
      IpcErrorCode.NOT_FOUND,
      'Word source file not found. Re-import the .docx source in the template editor.'
    )
  }

  const content = await readFile(docxSourcePath)

  try {
    const zip = new PizZip(content)
    const doc = new Docxtemplater(zip, {
      delimiters: { start: '{{', end: '}}' },
      parser: (tag: string) => ({
        get: (scope: unknown) => {
          const normalizedTag = normalizeTagPath(tag.trim())
          if (tagOverrides && normalizedTag in tagOverrides) {
            const override = tagOverrides[normalizedTag]
            return override !== '' ? override : undefined
          }
          return resolvePath(scope, normalizedTag)
        }
      }),
      nullGetter: (part: { value?: string }) => {
        const rawValue = part.value ?? ''
        const label = rawValue.split('.').pop() ?? rawValue
        return `[${label} not set]`
      },
      paragraphLoop: true,
      linebreaks: true
    })

    doc.render(context)
    await atomicWrite(
      outputPath,
      doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' })
    )
  } catch (error) {
    if (error instanceof GenerateServiceError) {
      throw error
    }

    throw new GenerateServiceError(
      IpcErrorCode.UNKNOWN,
      `Invalid tag in Word template: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

function buildDocxAppContent(
  templateContent: string,
  context: TemplateContext,
  tagOverrides?: Record<string, string>
): string {
  if (isBlankTemplateContent(templateContent)) {
    return ''
  }

  const resolved = resolveTemplateHtml(templateContent, context, tagOverrides)
  return htmlToPlainText(resolved.draftHtml)
}

async function loadGenerationData(
  options: GenerateServiceOptions,
  input: GenerateDocumentInput | GeneratePreviewInput
): Promise<LoadedGenerationData> {
  const domainPath = await resolveActiveDomainPath(options.domainService)
  const dossierPath = await options.documentService.resolveRegisteredDossierRoot({
    dossierId: input.dossierId
  })
  const [templates, dossier, contacts, entity] = await Promise.all([
    loadTemplates(getDomainTemplatesPath(domainPath)),
    loadDossierMetadata(dossierPath),
    loadContacts(getDossierContactsPath(dossierPath)),
    loadEntity(getDomainEntityPath(domainPath))
  ])

  return {
    templates,
    dossier,
    contacts,
    entity,
    domainPath,
    dossierPath
  }
}

function createTemplateContext(
  dossier: DossierMetadataFile,
  contacts: ContactRecord[],
  entity: EntityProfile | null,
  timestamp: Date,
  contactRoleOverrides?: Record<string, string>,
  primaryContactId?: string
): TemplateContext {
  const managedFields = normalizeManagedFieldsConfig(entity?.managedFields, entity?.profession)
  const getManagedContactTemplateValues = (
    contact: ContactRecord | undefined
  ): Record<string, string> =>
    contact ? getContactManagedFieldTemplateValues(contact, managedFields.contacts) : {}
  const primaryContact =
    (primaryContactId
      ? contacts.find((contact) => contact.uuid === primaryContactId)
      : undefined) ??
    contacts[0] ??
    undefined
  const keyDates = toTemplateLookup(
    dossier.keyDates.map((entry) => ({
      label: entry.label,
      value: entry.date
    }))
  )
  const keyRefs = toTemplateLookup(
    dossier.keyReferences.map((entry) => ({
      label: entry.label,
      value: entry.value
    }))
  )

  // Build role-keyed contact map: contact.<roleKey>.<field>
  const contactByRole: Record<string, Record<string, unknown>> = {}

  for (const c of contacts) {
    if (c.role) {
      const displayName = computeContactDisplayName(c)
      contactByRole[labelToKey(c.role)] = {
        ...c,
        ...getContactManagedFieldValues(c),
        ...getManagedContactTemplateValues(c),
        displayName,
        ...buildFirstNameFields(c),
        ...buildSalutationFields(c.gender, c.lastName, displayName),
        ...buildAddressFields(c)
      }
    }
  }

  // Apply manual overrides: map role-key → contact by ID
  if (contactRoleOverrides) {
    for (const [roleKey, contactId] of Object.entries(contactRoleOverrides)) {
      const matched = contacts.find((c) => c.uuid === contactId)

      if (matched) {
        const displayName = computeContactDisplayName(matched)
        contactByRole[roleKey] = {
          ...matched,
          ...getContactManagedFieldValues(matched),
          ...getManagedContactTemplateValues(matched),
          displayName,
          ...buildFirstNameFields(matched),
          ...buildSalutationFields(matched.gender, matched.lastName, displayName),
          ...buildAddressFields(matched)
        }
      }
    }
  }

  const dossierCreatedAt = makeDateValue(dossier.registeredAt)
  const todayIso = timestamp.toISOString().slice(0, 10)
  const todayVariants = formatDateVariants(todayIso)
  const keyDateValues: Record<string, DateValue> = {}
  for (const [key, iso] of Object.entries(keyDates)) {
    keyDateValues[key] = makeDateValue(iso)
  }

  return {
    dossier: {
      name: dossier.name,
      reference: dossier.id,
      status: dossier.status,
      type: dossier.type,
      createdAt: dossierCreatedAt,
      createdAtFormatted: dossierCreatedAt.formatted,
      createdAtLong: dossierCreatedAt.long,
      createdAtShort: dossierCreatedAt.short,
      keyDate: keyDateValues,
      keyRef: keyRefs
    },
    // Spread primary contact first for backward-compat (contact.displayName still works).
    // primaryContactId overrides which contact is used for flat tags like {{contact.displayName}}.
    // Role-keyed map is spread last so contact.<role>.<field> paths resolve correctly.
    contact: {
      ...(primaryContact ?? {}),
      ...(primaryContact ? getContactManagedFieldValues(primaryContact) : {}),
      ...getManagedContactTemplateValues(primaryContact),
      ...(primaryContact
        ? {
            displayName: computeContactDisplayName(primaryContact)
          }
        : {}),
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
    today: todayIso,
    todayFormatted: todayVariants.formatted,
    todayLong: todayVariants.long,
    todayShort: todayVariants.short,
    createdAt: makeDateValue(timestamp.toISOString())
  }
}

function buildDraftFromLoadedData(
  loaded: LoadedGenerationData,
  input: GenerateDocumentInput | GeneratePreviewInput,
  timestamp: Date,
  templateContent: string
): DraftBuildResult {
  const template = loaded.templates.find((entry) => entry.id === input.templateId)

  if (!template) {
    throw new GenerateServiceError(IpcErrorCode.NOT_FOUND, 'Template was not found.')
  }

  const context = createTemplateContext(
    loaded.dossier,
    loaded.contacts,
    loaded.entity,
    timestamp,
    'contactRoleOverrides' in input ? input.contactRoleOverrides : undefined,
    'primaryContactId' in input ? input.primaryContactId : undefined
  )
  const tagOverrides = 'tagOverrides' in input ? input.tagOverrides : undefined
  const resolved = resolveTemplateHtml(templateContent, context, tagOverrides)
  const suggestedFilename = `${sanitizeFilenameSegment(template.name)}-${timestamp
    .toISOString()
    .slice(0, 10)}`

  return {
    draftHtml: resolved.draftHtml,
    suggestedFilename,
    unresolvedTags: resolved.unresolvedTags,
    resolvedTags: resolved.resolvedTags,
    dossierPath: loaded.dossierPath
  }
}

async function writeGeneratedDocument(draft: {
  html: string
  dossierPath: string
  filename: string
  format: 'txt' | 'docx'
}): Promise<GeneratedDocumentResult> {
  const safeBaseName = sanitizeFilenameSegment(stripKnownExtension(draft.filename))
  const extension = draft.format === 'docx' ? 'docx' : 'txt'
  const outputPath = await resolveUniqueOutputPath(draft.dossierPath, safeBaseName, extension)

  if (draft.format === 'docx') {
    const buffer = await toDocxBuffer(draft.html)
    await atomicWrite(outputPath, buffer)
    return { outputPath }
  }

  const text = htmlToText(createHtmlDocument(draft.html), {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' }
    ]
  }).trimEnd()

  await atomicWrite(outputPath, text)
  return { outputPath }
}

async function saveDocumentMetadataIfProvided(
  documentService: DocumentServiceLike,
  input: GenerateDocumentInput,
  dossierPath: string,
  outputPath: string
): Promise<void> {
  if (!input.description && (!input.tags || input.tags.length === 0)) return
  if (!documentService.saveMetadata) return
  const documentId = relative(dossierPath, outputPath)
  await documentService.saveMetadata({
    dossierId: input.dossierId,
    documentId,
    description: input.description ?? '',
    tags: input.tags ?? []
  })
}

export function createGenerateService(options: GenerateServiceOptions): GenerateService {
  const now = options.now ?? (() => new Date())

  return {
    previewDocxDocument: async (input): Promise<DocxPreviewResult> => {
      const loaded = await loadGenerationData(options, input)
      const template = loaded.templates.find((entry) => entry.id === input.templateId)

      if (!template) {
        throw new GenerateServiceError(IpcErrorCode.NOT_FOUND, 'Template was not found.')
      }

      if (!template.hasDocxSource) {
        throw new GenerateServiceError(
          IpcErrorCode.VALIDATION_FAILED,
          'Template does not have a .docx source.'
        )
      }

      const docxSourcePath = getDomainTemplateDocxPath(loaded.domainPath, template.id)
      const tagPaths = await extractDocxTagPaths(docxSourcePath)
      const timestamp = now()
      const context = createTemplateContext(
        loaded.dossier,
        loaded.contacts,
        loaded.entity,
        timestamp,
        input.contactRoleOverrides,
        input.primaryContactId
      )

      const tagOverrides = input.tagOverrides
      const resolvedTags: Record<string, string> = {}

      for (const path of tagPaths) {
        if (tagOverrides && path in tagOverrides) {
          const override = tagOverrides[path]
          if (override && override !== '') resolvedTags[path] = override
        } else {
          const value = resolvePath(context, path)
          if (value !== undefined && value !== null && value !== '') {
            resolvedTags[path] = String(value)
          }
        }
      }

      const suggestedFilename = `${sanitizeFilenameSegment(stripKnownExtension(template.name))}-${timestamp.toISOString().slice(0, 10)}`

      // Convert the .docx source to HTML for preview — always reflects the current binary,
      // then resolve tags with the same context + overrides used for generation.
      let htmlPreview = ''
      try {
        const docxBuffer = await readFile(docxSourcePath)
        const mammothResult = await mammoth.convertToHtml({ buffer: docxBuffer })
        const resolved = resolveTemplateHtml(mammothResult.value, context, tagOverrides)
        htmlPreview = resolved.draftHtml
      } catch {
        // HTML preview is best-effort — generation still works without it
      }

      return { tagPaths, resolvedTags, suggestedFilename, htmlPreview }
    },

    previewDocument: async (input): Promise<GeneratedDraftResult> => {
      const loaded = await loadGenerationData(options, input)
      const templateContent = await loadTemplateContent(loaded.domainPath, input.templateId)
      const draft = buildDraftFromLoadedData(loaded, input, now(), templateContent)

      return {
        draftHtml: draft.draftHtml,
        suggestedFilename: draft.suggestedFilename,
        unresolvedTags: draft.unresolvedTags,
        resolvedTags: draft.resolvedTags
      }
    },
    saveGeneratedDocument: async (input): Promise<GeneratedDocumentResult> => {
      if (input.outputPath) {
        // Custom path — write directly without auto-increment
        const buffer = await toDocxBuffer(input.html)
        await atomicWrite(input.outputPath, buffer)
        return { outputPath: input.outputPath }
      }

      const dossierPath = await options.documentService.resolveRegisteredDossierRoot({
        dossierId: input.dossierId
      })

      return writeGeneratedDocument({
        html: input.html,
        dossierPath,
        filename: input.filename,
        format: input.format
      })
    },
    generateDocument: async (input): Promise<GeneratedDocumentResult> => {
      const loaded = await loadGenerationData(options, input)
      const template = loaded.templates.find((entry) => entry.id === input.templateId)

      if (!template) {
        throw new GenerateServiceError(IpcErrorCode.NOT_FOUND, 'Template was not found.')
      }

      if (template.hasDocxSource) {
        const timestamp = now()
        const docxSourcePath = getDomainTemplateDocxPath(loaded.domainPath, template.id)
        const templateContent = await loadTemplateContent(loaded.domainPath, template.id)

        let outputPath: string
        if (input.outputPath) {
          outputPath = input.outputPath
        } else {
          const baseName = input.filename
            ? sanitizeFilenameSegment(stripKnownExtension(input.filename))
            : `${sanitizeFilenameSegment(stripKnownExtension(template.name))}-${timestamp.toISOString().slice(0, 10)}`
          outputPath = await resolveUniqueOutputPath(loaded.dossierPath, baseName, 'docx')
        }

        const tagPaths = await extractDocxTagPaths(docxSourcePath)
        const baseContext = createTemplateContext(
          loaded.dossier,
          loaded.contacts,
          loaded.entity,
          timestamp,
          input.contactRoleOverrides,
          input.primaryContactId
        )

        const unresolvedTags = tagPaths.filter((path) => {
          if (input.tagOverrides && path in input.tagOverrides) {
            const override = input.tagOverrides[path]
            return override === '' || override === undefined
          }
          const value = resolvePath(baseContext, path)
          return value === undefined || value === null
        })

        if (unresolvedTags.length > 0) {
          throw new GenerateServiceError(
            IpcErrorCode.VALIDATION_FAILED,
            'Document generation failed: some template fields could not be resolved from the dossier data.',
            unresolvedTags
          )
        }

        const context: TemplateContext = {
          ...baseContext,
          app: {
            content: buildDocxAppContent(templateContent, baseContext, input.tagOverrides)
          }
        }

        await generateDocxFromBinary(docxSourcePath, context, outputPath, input.tagOverrides)

        const result: GeneratedDocumentResult = { outputPath }
        await saveDocumentMetadataIfProvided(
          options.documentService,
          input,
          loaded.dossierPath,
          result.outputPath
        )
        return result
      }

      const templateContent = await loadTemplateContent(loaded.domainPath, template.id)
      const draft = buildDraftFromLoadedData(loaded, input, now(), templateContent)

      if (draft.unresolvedTags.length > 0) {
        throw new GenerateServiceError(
          IpcErrorCode.VALIDATION_FAILED,
          'Document generation failed: some template fields could not be resolved from the dossier data.',
          draft.unresolvedTags
        )
      }

      const result = await writeGeneratedDocument({
        html: draft.draftHtml,
        dossierPath: draft.dossierPath,
        filename: draft.suggestedFilename,
        format: 'docx'
      })
      await saveDocumentMetadataIfProvided(
        options.documentService,
        input,
        loaded.dossierPath,
        result.outputPath
      )
      return result
    }
  }
}
