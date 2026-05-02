import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type {
  ContactRecord,
  ContactUpsertInput,
  DocumentRecord,
  DossierDetail,
  DossierRegistrationInput,
  DossierUpdateInput,
  TemplateDeleteInput,
  TemplateDraft,
  TemplateRecord,
  TemplateUpdate
} from '@shared/types'
import { IpcErrorCode } from '@shared/types'
import {
  contactRecordSchema,
  entityProfileDraftSchema,
  templateRecordSchema,
  type DocumentRelocationInput,
  type DocumentMetadataUpdate,
  type EntityProfileDraft,
  type GenerateDocumentInput
} from '@shared/validation'
import { GenerateServiceError, type GenerateService } from '../../services/domain/generateService'
import { atomicWrite } from '../system/atomicWrite'
import { pathExists } from '../system/domainState'
import {
  getDomainEntityPath,
  getDomainTemplatesPath,
  getDossierContactsPath
} from '../ordicab/ordicabPaths'
import {
  delegatedAiActionPayloadSchemas,
  type DelegatedAiAction
} from './aiDelegatedActionContracts'
import type { z } from 'zod'
import { normalizeManagedFieldsConfig } from '@shared/managedFields'

export interface OrdicabActionContactService {
  list(dossierId: string): Promise<ContactRecord[]>
  upsert(input: ContactUpsertInput): Promise<ContactRecord>
  delete(dossierId: string, contactId: string): Promise<void>
}

export interface OrdicabActionDossierService {
  getDossier: (input: { dossierId: string }) => Promise<DossierDetail>
  updateDossier: (input: DossierUpdateInput) => Promise<unknown>
  upsertKeyDate: (input: {
    dossierId: string
    id?: string
    label: string
    date: string
    note?: string
  }) => Promise<unknown>
  deleteKeyDate: (input: { dossierId: string; keyDateId: string }) => Promise<unknown>
  upsertKeyReference: (input: {
    dossierId: string
    id?: string
    label: string
    value: string
    note?: string
  }) => Promise<unknown>
  deleteKeyReference: (input: { dossierId: string; keyReferenceId: string }) => Promise<unknown>
  registerDossier: (input: DossierRegistrationInput) => Promise<unknown>
}

export interface OrdicabActionDocumentService {
  resolveRegisteredDossierRoot: (input: { dossierId: string }) => Promise<string>
  listDocuments: (input: { dossierId: string }) => Promise<DocumentRecord[]>
  saveMetadata: (input: DocumentMetadataUpdate) => Promise<unknown>
  relocateMetadata: (input: DocumentRelocationInput) => Promise<unknown>
}

type GenerateServiceLike = Pick<GenerateService, 'generateDocument'>

export interface DelegatedAiActionExecutorOptions {
  contactService?: OrdicabActionContactService
  dossierService?: OrdicabActionDossierService
  documentService?: OrdicabActionDocumentService
  generateService?: GenerateServiceLike
  resolveDomainPath?: () => Promise<string>
  now?: () => Date
  /** Absolute path to the directory containing Tesseract traineddata files. */
  tessDataPath?: string
}

export interface DelegatedAiActionExecutor {
  execute(action: DelegatedAiAction, payload: unknown): Promise<unknown>
}

export class OrdicabActionError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string,
    readonly instructions?: string
  ) {
    super(message)
    this.name = 'OrdicabActionError'
  }
}

function formatZodIssues(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>
}): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'payload'
      return `${path}: ${issue.message}`
    })
    .join('; ')
}

function requireDependency<T>(value: T | undefined, action: DelegatedAiAction, name: string): T {
  if (value) {
    return value
  }

  throw new OrdicabActionError(
    IpcErrorCode.FILE_SYSTEM_ERROR,
    `Missing ${name} for action "${action}".`
  )
}

function pickDefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([, entryValue]) => typeof entryValue !== 'undefined'
    )
  ) as Partial<T>
}

function normalizeTemplateNameForComparison(name: string): string {
  return name.trim().toLocaleLowerCase()
}

async function loadContacts(contactsPath: string): Promise<ContactRecord[]> {
  if (!(await pathExists(contactsPath))) {
    return []
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(await readFile(contactsPath, 'utf8')) as unknown
  } catch {
    throw new OrdicabActionError(IpcErrorCode.FILE_SYSTEM_ERROR, 'Unable to read dossier contacts.')
  }

  const result = contactRecordSchema.array().safeParse(parsed)
  if (!result.success) {
    throw new OrdicabActionError(
      IpcErrorCode.VALIDATION_FAILED,
      'Stored dossier contacts are invalid.'
    )
  }

  return result.data
}

async function saveContacts(contactsPath: string, contacts: ContactRecord[]): Promise<void> {
  await atomicWrite(contactsPath, `${JSON.stringify(contacts, null, 2)}\n`)
}

async function loadEntityProfile(entityPath: string): Promise<EntityProfileDraft | null> {
  if (!(await pathExists(entityPath))) {
    return null
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(await readFile(entityPath, 'utf8')) as unknown
  } catch {
    throw new OrdicabActionError(
      IpcErrorCode.FILE_SYSTEM_ERROR,
      'Unable to read professional entity profile.'
    )
  }

  const result = entityProfileDraftSchema.safeParse(parsed)
  if (!result.success) {
    throw new OrdicabActionError(
      IpcErrorCode.VALIDATION_FAILED,
      'Stored professional entity profile is invalid.'
    )
  }

  return result.data as EntityProfileDraft
}

async function saveEntityProfile(entityPath: string, draft: EntityProfileDraft): Promise<void> {
  await mkdir(dirname(entityPath), { recursive: true })
  await atomicWrite(entityPath, `${JSON.stringify(draft, null, 2)}\n`)
}

async function loadTemplates(templatesPath: string): Promise<TemplateRecord[]> {
  if (!(await pathExists(templatesPath))) {
    return []
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(await readFile(templatesPath, 'utf8')) as unknown
  } catch {
    throw new OrdicabActionError(IpcErrorCode.FILE_SYSTEM_ERROR, 'Unable to read templates.')
  }

  const result = templateRecordSchema.array().safeParse(parsed)
  if (!result.success) {
    throw new OrdicabActionError(IpcErrorCode.VALIDATION_FAILED, 'Stored templates are invalid.')
  }

  return result.data
}

async function saveTemplates(templatesPath: string, templates: TemplateRecord[]): Promise<void> {
  const index = templates.map((template) => {
    const record = { ...template }
    delete record.content
    return record
  })
  await atomicWrite(templatesPath, `${JSON.stringify(index, null, 2)}\n`)
}

function ensureNoDuplicateTemplateName(
  templates: TemplateRecord[],
  name: string,
  excludeId?: string
): void {
  const normalized = normalizeTemplateNameForComparison(name)
  const duplicate = templates.some((template) => {
    if (template.id === excludeId) {
      return false
    }

    return normalizeTemplateNameForComparison(template.name) === normalized
  })

  if (!duplicate) {
    return
  }

  throw new OrdicabActionError(
    IpcErrorCode.INVALID_INPUT,
    'A template with this name already exists.',
    `A template named "${name}" already exists. Read the templates index to find the existing template id, then either update it with template.update or choose a different name.`
  )
}

function createTemplateRecord(input: {
  id: string
  name: string
  content: string
  description?: string
  updatedAt: string
}): TemplateRecord {
  return templateRecordSchema.parse(input)
}

async function createTemplate(
  domainPath: string,
  input: TemplateDraft,
  now: () => Date
): Promise<TemplateRecord> {
  const templatesPath = getDomainTemplatesPath(domainPath)
  const templates = await loadTemplates(templatesPath)

  ensureNoDuplicateTemplateName(templates, input.name)

  const nextTemplate = createTemplateRecord({
    id: randomUUID(),
    name: input.name,
    content: input.content,
    description: input.description,
    updatedAt: now().toISOString()
  })

  await saveTemplates(templatesPath, [...templates, nextTemplate])
  return nextTemplate
}

async function updateTemplate(
  domainPath: string,
  input: TemplateUpdate,
  now: () => Date
): Promise<TemplateRecord> {
  const templatesPath = getDomainTemplatesPath(domainPath)
  const templates = await loadTemplates(templatesPath)
  const index = templates.findIndex((template) => template.id === input.id)

  if (index < 0) {
    throw new OrdicabActionError(
      IpcErrorCode.NOT_FOUND,
      'This template was not found.',
      `The template id "${input.id}" does not exist. Read the templates index to find the correct id, then re-emit the intent with the correct id.`
    )
  }

  ensureNoDuplicateTemplateName(templates, input.name, input.id)

  const nextTemplate = createTemplateRecord({
    id: input.id,
    name: input.name,
    content: input.content,
    description: input.description,
    updatedAt: now().toISOString()
  })

  const nextTemplates = [...templates]
  nextTemplates[index] = nextTemplate
  await saveTemplates(templatesPath, nextTemplates)

  return nextTemplate
}

async function deleteTemplate(domainPath: string, input: TemplateDeleteInput): Promise<void> {
  const templatesPath = getDomainTemplatesPath(domainPath)
  const templates = await loadTemplates(templatesPath)
  const nextTemplates = templates.filter((template) => template.id !== input.id)

  if (nextTemplates.length === templates.length) {
    throw new OrdicabActionError(
      IpcErrorCode.NOT_FOUND,
      'This template was not found.',
      `The template id "${input.id}" does not exist. Read the templates index to verify the correct id before re-emitting.`
    )
  }

  await saveTemplates(templatesPath, nextTemplates)
}

function parsePayload<A extends DelegatedAiAction>(
  action: A,
  payload: unknown
): z.output<(typeof delegatedAiActionPayloadSchemas)[A]> {
  const result = delegatedAiActionPayloadSchemas[action].safeParse(payload)
  if (!result.success) {
    throw new OrdicabActionError(
      IpcErrorCode.VALIDATION_FAILED,
      `Intent payload is invalid. ${formatZodIssues(result.error)}`
    )
  }

  return result.data as z.output<(typeof delegatedAiActionPayloadSchemas)[A]>
}

export function createFileBackedOrdicabActionContactService(options: {
  documentService: Pick<OrdicabActionDocumentService, 'resolveRegisteredDossierRoot'>
}): OrdicabActionContactService {
  const { documentService } = options

  // AI external only:
  // delegated intents operate from canonical files under the active domain and
  // therefore need a contact service backed by dossier JSON files. Internal AI
  // stays outside this executor and uses its regular contact service directly.
  return {
    async list(dossierId: string): Promise<ContactRecord[]> {
      const dossierPath = await documentService.resolveRegisteredDossierRoot({ dossierId })
      return loadContacts(getDossierContactsPath(dossierPath))
    },

    async upsert(input: ContactUpsertInput): Promise<ContactRecord> {
      const dossierPath = await documentService.resolveRegisteredDossierRoot({
        dossierId: input.dossierId
      })
      const contactsPath = getDossierContactsPath(dossierPath)
      const contacts = await loadContacts(contactsPath)
      const existingIndex = input.id
        ? contacts.findIndex((contact) => contact.uuid === input.id)
        : -1

      if (input.id && existingIndex === -1) {
        throw new OrdicabActionError(
          IpcErrorCode.NOT_FOUND,
          'This contact was not found.',
          `The contact id "${input.id}" does not exist in this dossier. Read the contacts.json file to find the correct id, then re-emit the intent with the correct id. To create a new contact instead, omit the id field.`
        )
      }

      const nextContact = contactRecordSchema.parse({
        ...pickDefined(input),
        uuid: input.id ?? randomUUID()
      })
      const nextContacts = [...contacts]

      if (existingIndex >= 0) {
        nextContacts[existingIndex] = nextContact
      } else {
        nextContacts.push(nextContact)
      }

      await saveContacts(contactsPath, nextContacts)
      return nextContact
    },

    async delete(dossierId: string, contactId: string): Promise<void> {
      const dossierPath = await documentService.resolveRegisteredDossierRoot({ dossierId })
      const contactsPath = getDossierContactsPath(dossierPath)
      const contacts = await loadContacts(contactsPath)

      if (!contacts.some((contact) => contact.uuid === contactId)) {
        throw new OrdicabActionError(
          IpcErrorCode.NOT_FOUND,
          'This contact was not found.',
          `The contact id "${contactId}" does not exist in this dossier. Read the contacts.json file to find the correct id, then re-emit the intent with the correct id.`
        )
      }

      await saveContacts(
        contactsPath,
        contacts.filter((contact) => contact.uuid !== contactId)
      )
    }
  }
}

// External action dispatcher
export function createDelegatedAiActionExecutor(
  options: DelegatedAiActionExecutorOptions
): DelegatedAiActionExecutor {
  const now = options.now ?? (() => new Date())

  return {
    async execute(action: DelegatedAiAction, rawPayload: unknown): Promise<unknown> {
      switch (action) {
        case 'contact.upsert': {
          const payload = parsePayload('contact.upsert', rawPayload)
          const contactService = requireDependency(options.contactService, action, 'contactService')
          const existingContact =
            payload.id && payload.dossierId
              ? (await contactService.list(payload.dossierId)).find(
                  (contact) => contact.uuid === payload.id
                )
              : undefined

          if (payload.id && !existingContact) {
            throw new OrdicabActionError(
              IpcErrorCode.NOT_FOUND,
              'This contact was not found.',
              `The contact id "${payload.id}" does not exist in this dossier. Read the contacts.json file to find the correct id, then re-emit the intent with the correct id. To create a new contact instead, omit the id field.`
            )
          }

          const mergedInput = {
            dossierId: payload.dossierId,
            ...(existingContact ?? {}),
            ...pickDefined(payload)
          } as ContactUpsertInput

          return contactService.upsert(mergedInput)
        }

        case 'contact.delete': {
          const payload = parsePayload('contact.delete', rawPayload)
          const contactService = requireDependency(options.contactService, action, 'contactService')
          await contactService.delete(payload.dossierId, payload.contactUuid)
          return
        }

        case 'dossier.create': {
          const payload = parsePayload('dossier.create', rawPayload)
          const resolveDomainPath = requireDependency(
            options.resolveDomainPath,
            action,
            'resolveDomainPath'
          )
          const dossierService = requireDependency(options.dossierService, action, 'dossierService')
          const domainPath = await resolveDomainPath()

          try {
            await mkdir(join(domainPath, payload.id), { recursive: true })
            return await dossierService.registerDossier({ id: payload.id })
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            if (message.includes('already registered')) {
              throw new OrdicabActionError(
                IpcErrorCode.INVALID_INPUT,
                message,
                `A dossier with the id "${payload.id}" is already registered. Read the domain registry to confirm, then either use a different id or skip this intent if the dossier already exists.`
              )
            }

            throw error
          }
        }

        case 'dossier.update': {
          const payload = parsePayload('dossier.update', rawPayload)
          const dossierService = requireDependency(options.dossierService, action, 'dossierService')
          const dossier = await dossierService.getDossier({ dossierId: payload.id })

          return dossierService.updateDossier({
            id: payload.id,
            status: payload.status ?? dossier.status,
            type: payload.type ?? dossier.type,
            information: payload.information ?? dossier.information
          })
        }

        case 'dossier.upsertKeyDate': {
          const payload = parsePayload('dossier.upsertKeyDate', rawPayload)
          return requireDependency(options.dossierService, action, 'dossierService').upsertKeyDate(
            payload
          )
        }

        case 'dossier.deleteKeyDate': {
          const payload = parsePayload('dossier.deleteKeyDate', rawPayload)
          await requireDependency(options.dossierService, action, 'dossierService').deleteKeyDate(
            payload
          )
          return
        }

        case 'dossier.upsertKeyReference': {
          const payload = parsePayload('dossier.upsertKeyReference', rawPayload)
          return requireDependency(
            options.dossierService,
            action,
            'dossierService'
          ).upsertKeyReference(payload)
        }

        case 'dossier.deleteKeyReference': {
          const payload = parsePayload('dossier.deleteKeyReference', rawPayload)
          await requireDependency(
            options.dossierService,
            action,
            'dossierService'
          ).deleteKeyReference(payload)
          return
        }

        case 'entity.update': {
          const payload = parsePayload('entity.update', rawPayload)
          const resolveDomainPath = requireDependency(
            options.resolveDomainPath,
            action,
            'resolveDomainPath'
          )
          const domainPath = await resolveDomainPath()
          const entityPath = getDomainEntityPath(domainPath)

          await loadEntityProfile(entityPath)
          // Normalize managedFields to ensure required arrays are present
          const normalized: EntityProfileDraft = {
            ...payload,
            managedFields: payload.managedFields
              ? normalizeManagedFieldsConfig(payload.managedFields, payload.profession)
              : undefined
          }
          await saveEntityProfile(entityPath, normalized)
          return
        }

        case 'document.saveMetadata': {
          const payload = parsePayload('document.saveMetadata', rawPayload)
          return requireDependency(options.documentService, action, 'documentService').saveMetadata(
            payload
          )
        }

        case 'document.relocate': {
          const payload = parsePayload('document.relocate', rawPayload)
          return requireDependency(
            options.documentService,
            action,
            'documentService'
          ).relocateMetadata(payload)
        }

        case 'document.analyze': {
          const payload = parsePayload('document.analyze', rawPayload)
          const documentService = requireDependency(
            options.documentService,
            action,
            'documentService'
          )
          const [dossierRoot, docs] = await Promise.all([
            documentService.resolveRegisteredDossierRoot({ dossierId: payload.dossierId }),
            documentService
              .listDocuments({ dossierId: payload.dossierId })
              .catch(() => [] as DocumentRecord[])
          ])
          const doc = docs.find((d) => d.id === payload.documentId)
          const absolutePath = join(dossierRoot, payload.documentId)
          const { getDossierContentCachePath } = await import('../ordicab/ordicabPaths')
          const cacheDir = getDossierContentCachePath(dossierRoot)
          const { readCachedDocumentText } = await import('../aiEmbedded/documentContentService')
          const result = await readCachedDocumentText(absolutePath, cacheDir)
          if (result === null) {
            return {
              documentId: payload.documentId,
              dossierId: payload.dossierId,
              extracted: false,
              warning: `Le texte de "${doc?.filename ?? payload.documentId}" n'a pas encore été extrait. Veuillez aller dans l'onglet Documents et utiliser "Tout extraire" pour extraire le texte des documents avant de relancer l'analyse.`,
              metadata: {
                description: doc?.description ?? null,
                tags: doc?.tags ?? []
              }
            }
          }
          // Return the full extracted payload here because delegated AI cannot
          // inspect in-memory state directly; it only sees the response file.
          return {
            documentId: payload.documentId,
            dossierId: payload.dossierId,
            extracted: true,
            method: result.method,
            textLength: result.text.length,
            text: result.text,
            metadata: {
              description: doc?.description ?? null,
              tags: doc?.tags ?? []
            }
          }
        }

        case 'template.create': {
          const payload = parsePayload('template.create', rawPayload)
          const resolveDomainPath = requireDependency(
            options.resolveDomainPath,
            action,
            'resolveDomainPath'
          )
          return createTemplate(await resolveDomainPath(), payload, now)
        }

        case 'template.update': {
          const payload = parsePayload('template.update', rawPayload)
          const resolveDomainPath = requireDependency(
            options.resolveDomainPath,
            action,
            'resolveDomainPath'
          )
          return updateTemplate(await resolveDomainPath(), payload, now)
        }

        case 'template.delete': {
          const payload = parsePayload('template.delete', rawPayload)
          const resolveDomainPath = requireDependency(
            options.resolveDomainPath,
            action,
            'resolveDomainPath'
          )
          await deleteTemplate(await resolveDomainPath(), payload)
          return
        }

        // Reusable logic, currently exercised by external AI:
        // internal AI calls `generateService.generateDocument()` directly after
        // intent resolution, while delegated external AI routes through here.
        case 'generate.document': {
          const payload = parsePayload('generate.document', rawPayload)
          return requireDependency(
            options.generateService,
            action,
            'generateService'
          ).generateDocument(payload as GenerateDocumentInput)
        }
      }
    }
  }
}

export function isDelegatedAiActionNeedsInputError(error: unknown): error is GenerateServiceError {
  return error instanceof GenerateServiceError && (error.unresolvedTags?.length ?? 0) > 0
}

export type OrdicabActionExecutorOptions = DelegatedAiActionExecutorOptions
export type OrdicabActionExecutor = DelegatedAiActionExecutor
export const createOrdicabActionExecutor = createDelegatedAiActionExecutor
export const isOrdicabActionNeedsInputError = isDelegatedAiActionNeedsInputError
