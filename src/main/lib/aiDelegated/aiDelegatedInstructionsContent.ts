import { basename } from 'node:path'

import type { AiMode } from '@shared/types'
import { TEMPLATE_ROUTINE_GROUPS, templateRoutineCatalog } from '@shared/templateRoutines'

import {
  contactRecordSchema,
  dossierMetadataFileSchema,
  entityProfileSchema,
  keyDateSchema,
  keyReferenceSchema,
  templateRecordSchema,
  type DossierMetadataFile
} from '@shared/validation'
import {
  delegatedAiActionPayloadSchemas,
  type DelegatedAiAction
} from './aiDelegatedActionContracts'
import {
  getDomainDelegatedFailedPath,
  getDomainDelegatedInboxPath,
  getDomainDelegatedResponsesPath,
  getDomainEntityPath,
  getDomainOrdicabPath,
  getDomainRegistryPath,
  getDomainTemplateRoutinesPath,
  getDomainTemplatesPath,
  getDossierContactsPath,
  getDossierMetadataPath
} from '../ordicab/ordicabPaths'

/**
 * Minimal dossier descriptor used while rendering delegated instructions for external assistants.
 */
export interface DelegatedInstructionDossier {
  id: string
  uuid?: string
  folderPath: string
  folderName: string
}

/**
 * Inputs required to render the delegated workflow instructions written into domain root files.
 */
export interface BuildDelegatedInstructionsParams {
  domainPath: string
  dossiers: DelegatedInstructionDossier[]
  scope: 'domain' | 'dossier'
  entityCountry?: string
  contactRoles?: string[]
  originDeviceId: string
}

// Loaded canonical dossier state used to reference real paths and persisted identifiers in the prompt.
export interface LoadedDossierContextForInstructions {
  dossierPath: string
  metadata: DossierMetadataFile
}

// Helper for embedding structured examples inside markdown instruction files.
function toJsonSnippet(value: unknown): string {
  return ['```json', JSON.stringify(value, null, 2), '```'].join('\n')
}

const delegatedIntentPayloadSchemas = delegatedAiActionPayloadSchemas

type DelegatedIntentAction = DelegatedAiAction

function buildIntentEnvelopeExample<A extends DelegatedIntentAction>(input: {
  action: A
  payload: unknown
  originDeviceId: string
  commandId: string
  createdAt: string
  sequence?: {
    groupId: string
    index: number
    total: number
  }
}): {
  version: 1
  commandId: string
  createdAt: string
  actor: 'claude-cowork'
  originDeviceId: string
  action: A
  payload: unknown
  sequence?: {
    groupId: string
    index: number
    total: number
  }
} {
  return {
    version: 1,
    commandId: input.commandId,
    createdAt: input.createdAt,
    actor: 'claude-cowork',
    originDeviceId: input.originDeviceId,
    action: input.action,
    payload: delegatedIntentPayloadSchemas[input.action].parse(input.payload),
    sequence: input.sequence
  }
}

// Example payloads are schema-validated so the generated instructions stay aligned with runtime contracts.

function buildDelegatedExamples(): {
  keyDate: ReturnType<typeof keyDateSchema.parse>
  keyReference: ReturnType<typeof keyReferenceSchema.parse>
  contact: ReturnType<typeof contactRecordSchema.parse>
  entity: ReturnType<typeof entityProfileSchema.parse>
  template: ReturnType<typeof templateRecordSchema.parse>
  dossier: ReturnType<typeof dossierMetadataFileSchema.parse>
} {
  const keyDate = keyDateSchema.parse({
    id: '5f8f5d83-f0d3-4a53-9db4-feb6b6db03c7',
    dossierId: 'example-dossier',
    label: 'Audience de mise en etat',
    date: '2026-04-15',
    note: 'Salle 2, arrivee 15 minutes avant'
  })

  const keyReference = keyReferenceSchema.parse({
    id: '9d086d17-cf57-4743-bb05-d8f12a2706d8',
    dossierId: 'example-dossier',
    label: 'Numero RG',
    value: 'RG 26/00124',
    note: 'Tribunal judiciaire de Paris'
  })

  const contact = contactRecordSchema.parse({
    id: '7aa77f6f-84f6-4d54-9b79-8bb4c1570a11',
    uuid: '7aa77f6f-84f6-4d54-9b79-8bb4c1570a11',
    dossierId: 'example-dossier',
    title: 'Me',
    firstName: 'Alex',
    lastName: 'Dupres',
    gender: 'M',
    role: 'Avocat',
    institution: 'Cabinet Exemple',
    addressLine: '12 rue du Palais',
    zipCode: '75001',
    city: 'Paris',
    country: 'France',
    phone: '+33 6 12 34 56 78',
    email: 'alex.dupres@example.fr'
  })

  const entity = entityProfileSchema.parse({
    firmName: 'Cabinet Exemple',
    profession: 'lawyer',
    title: 'Me',
    firstName: 'Alex',
    lastName: 'Dupres',
    addressLine: '12 rue du Palais',
    zipCode: '75001',
    city: 'Paris',
    country: 'France',
    vatNumber: 'FR00123456789',
    phone: '+33 1 23 45 67 89',
    email: 'contact@cabinet-exemple.fr'
  })

  const template = templateRecordSchema.parse({
    id: '3f84e5b6-3912-49dc-9c7d-8c446df43b0f',
    name: 'Lettre de mise en demeure',
    content: 'Objet : Mise en demeure\n\nBonjour {{contact.displayName}},',
    description: 'Modele de courrier initial',
    macros: ['contact.displayName', 'dossier.name'],
    hasDocxSource: false,
    updatedAt: '2026-03-20T12:00:00.000Z'
  })

  const dossier = dossierMetadataFileSchema.parse({
    id: 'example-dossier',
    name: 'Dossier Exemple',
    type: 'Contentieux civil',
    status: 'active',
    updatedAt: '2026-03-20T12:00:00.000Z',
    lastOpenedAt: '2026-03-19T16:30:00.000Z',
    nextUpcomingKeyDate: keyDate.date,
    nextUpcomingKeyDateLabel: keyDate.label,
    registeredAt: '2026-03-01T09:00:00.000Z',
    keyDates: [keyDate],
    keyReferences: [keyReference],
    documents: []
  })

  return { keyDate, keyReference, contact, entity, template, dossier }
}

/**
 * Builds the reference guide listing supported template routines and formatting conventions.
 * This is consumed by delegated assistants before they create or edit template content.
 */
export function buildTemplateRoutinesGuide(domainPath: string): string {
  const routinesPath = getDomainTemplateRoutinesPath(domainPath)
  const lines: string[] = [
    '# Ordicab Template Routines',
    '',
    'This file lists the template routines supported directly by Ordicab.',
    'When selecting or writing template content, prefer the routines listed here before inventing a new placeholder.',
    'Use the canonical English paths exactly as shown below. Alias normalization may help at render time, but these canonical forms are the preferred source of truth.',
    '',
    '## Authoring Rules',
    '1. Prefer a routine from this file whenever it already matches the requested data.',
    '2. Do not invent unsupported roots or fields.',
    '3. For role-specific contacts, use `{{contact.<roleKey>.<field>}}` with the Ordicab role key in camelCase.',
    '4. For key dates and key references, replace `<label>` with the canonical camelCase key derived from the saved label.',
    '5. If the needed data is not supported by these routines, first store it in Ordicab canonical data or ask for clarification before creating template content that depends on it.',
    '',
    '## Date Formatting Principle',
    'All dates are **persisted in ISO 8601 format** (`YYYY-MM-DD` for calendar dates, full ISO timestamp for datetimes).',
    'Display formatting is always computed at render time using the user locale — never stored.',
    '- `{{dossier.createdAt}}` / `{{today}}` -> raw ISO date (e.g. `2026-03-15`) — use for sorting, filtering, or machine-readable contexts.',
    '- `{{dossier.createdAtFormatted}}` / `{{todayFormatted}}` -> locale date (e.g. `15/03/2026` in fr-FR).',
    '- `{{dossier.createdAtLong}}` / `{{todayLong}}` -> long text (e.g. `15 mars 2026`).',
    '- `{{dossier.createdAtShort}}` / `{{todayShort}}` -> abbreviated text (e.g. `15 mars 26`).',
    'Key dates (`{{dossier.keyDate.<label>}}`) are stored as ISO `YYYY-MM-DD` strings and also expose formatted variants:',
    '- `{{dossier.keyDate.<label>.formatted}}` -> locale date (e.g. `01/04/2026`)',
    '- `{{dossier.keyDate.<label>.long}}` -> long text (e.g. `1 avril 2026`)',
    '- `{{dossier.keyDate.<label>.short}}` -> abbreviated text (e.g. `1 avr. 26`)',
    '`{{createdAt}}` (generation timestamp) similarly exposes `.formatted`, `.long`, `.short` sub-paths.',
    'Prefer formatted variants for human-readable output in generated documents.',
    '',
    `Canonical path: ${routinesPath}`,
    ''
  ]

  for (const group of TEMPLATE_ROUTINE_GROUPS) {
    const entries = templateRoutineCatalog.filter((entry) => entry.group === group)
    if (entries.length === 0) {
      continue
    }

    lines.push(`## ${group}`, '')

    const ungrouped = entries.filter((entry) => !entry.subGroup)
    for (const entry of ungrouped) {
      lines.push(
        `- \`${entry.tag}\``,
        `  - ${entry.description}`,
        `  - Example: \`${entry.example}\``
      )
    }

    const salutationEntries = entries.filter((entry) => entry.subGroup === 'salutation')
    if (salutationEntries.length > 0) {
      lines.push('', '### Salutation')
      for (const entry of salutationEntries) {
        lines.push(
          `- \`${entry.tag}\``,
          `  - ${entry.description}`,
          `  - Example: \`${entry.example}\``
        )
      }
    }

    const addressEntries = entries.filter((entry) => entry.subGroup === 'address')
    if (addressEntries.length > 0) {
      lines.push('', '### Address')
      for (const entry of addressEntries) {
        lines.push(
          `- \`${entry.tag}\``,
          `  - ${entry.description}`,
          `  - Example: \`${entry.example}\``
        )
      }
    }

    lines.push('')
  }

  lines.push(
    '## Dynamic Families',
    '',
    '- Role-specific contacts: `{{contact.<roleKey>.<field>}}`',
    '  - Example: `{{contact.opposingCounsel.email}}`',
    '- Key dates: `{{dossier.keyDate.<label>}}`',
    '  - Example: `{{dossier.keyDate.hearingDate}}`',
    '- Key references: `{{dossier.keyRef.<label>}}`',
    '  - Example: `{{dossier.keyRef.caseNumber}}`',
    ''
  )

  return `${lines.join('\n')}\n`
}

/**
 * Builds the delegated workflow manual consumed by external assistants.
 * The output documents read/write boundaries, intent/response envelopes, and canonical file locations.
 */
export function buildDelegatedInstructions(params: BuildDelegatedInstructionsParams): string {
  const {
    contact: delegatedContactExample,
    keyDate: delegatedKeyDateExample,
    keyReference: delegatedKeyReferenceExample,
    entity: delegatedEntityExample,
    template: delegatedTemplateExample
  } = buildDelegatedExamples()
  const inboxPath = getDomainDelegatedInboxPath(params.domainPath)
  const responsesPath = getDomainDelegatedResponsesPath(params.domainPath)
  const failedPath = getDomainDelegatedFailedPath(params.domainPath)
  const entityPath = getDomainEntityPath(params.domainPath)
  const templatesPath = getDomainTemplatesPath(params.domainPath)
  const templateRoutinesPath = getDomainTemplateRoutinesPath(params.domainPath)
  const lines: string[] = [
    '## Delegated Instructions',
    '',
    '### How to use these instructions',
    params.scope === 'domain'
      ? 'Claude can read any canonical Ordicab files in this domain, including dossier documents and `.ordicab` metadata.'
      : 'Claude can read this dossier folder, its documents, and its `.ordicab` metadata without any extra path lookup.',
    'All writes must go through delegated intent files.',
    'Never modify `.ordicab/*.json`, dossier documents, templates, generated documents, or `CLAUDE.md` directly.',
    `The only allowed write target is the inbox folder: \`${inboxPath}\`.`,
    '',
    '### Device-Scoped Responses',
    'This domain may be synchronized across multiple devices, so the instructions file, inbox, and response folders can appear on more than one machine at the same time.',
    `Use this device-scoped origin id for every delegated intent emitted from this Ordicab installation: \`${params.originDeviceId}\`.`,
    'Always include `originDeviceId` in the intent envelope and keep using the same value for follow-up intents in the same workflow.',
    `After each intent is processed, Ordicab writes exactly one response file into \`${responsesPath}\`.`,
    'Only consume a response file when its `originDeviceId` matches this local device id exactly.',
    'If another synchronized device sees the same response file but the `originDeviceId` does not match its own local device id, it must ignore that response completely and must not continue the workflow.',
    '',
    '### Intent Workflow',
    '1. Read canonical files directly to discover current state, existing IDs, and any surfaced UUIDs.',
    '2. Write exactly one complete JSON intent file per mutation into the inbox folder.',
    '3. Wait for the matching response file after each emitted intent. Delegated workflows are multi-step and Ordicab may instruct you to continue, ask the user for missing information, or stop.',
    '4. For updates or deletes, use the real existing IDs from the canonical files and rely on UUIDs to disambiguate collisions before writing the payload.',
    '5. Never invent an `id` for an update. If the existing record ID is unknown, either omit `id` to create a new record when that matches the request, or ask for clarification before writing the intent.',
    '6. If the target entity cannot be identified uniquely, or if a field required by the action is missing, ask for clarification instead of guessing.',
    '7. For `contact.upsert`, include `id` to update an existing contact (merge — only the provided fields are changed, existing fields are preserved). Omit `id` to create a new contact.',
    '8. When names collide, prefer stable IDs, dossier UUIDs, and document UUIDs from the canonical files over display names or filenames.',
    '',
    '### Response Workflow',
    'Ordicab does not use silent success anymore. Every processed intent yields a response file with the same basename as the original inbox file.',
    `- Read responses from: \`${responsesPath}\``,
    `- Legacy failure folder retained during migration: \`${failedPath}\``,
    '- Treat the response file as the authoritative completion signal. Do not infer completion from the inbox file disappearing.',
    '- Read the response `status` and follow `nextStep` exactly.',
    '- `completed`: the action finished. Read canonical files if you need fresh state for the next step.',
    '- `needs_input`: Ordicab needs more information from the user before the workflow can continue. Ask for the missing values, then emit a new intent with a new `commandId` and the same `originDeviceId`.',
    '- `failed`: Ordicab rejected the action or hit a terminal error. Read `error` and `nextStep` before deciding whether to retry.',
    '',
    '### Chaining Actions',
    'When a task requires multiple mutations (e.g. create a dossier then immediately add contacts or key dates):',
    '1. Emit all required intent files in the correct logical order using ascending `commandId` timestamps.',
    '2. Use the `sequence` envelope field to signal ordering within a related group:',
    toJsonSnippet(
      buildIntentEnvelopeExample({
        commandId: '2026-03-20T21-45-12.000Z-dossier-create',
        createdAt: '2026-03-20T21:45:12.000Z',
        originDeviceId: params.originDeviceId,
        action: 'dossier.create',
        payload: { id: 'Nouveau Dossier Client' },
        sequence: { groupId: 'onboarding-client-alpha', index: 1, total: 3 }
      })
    ),
    '3. After each intent, read the response file before deciding whether the workflow is finished.',
    '4. For `generate.document`, Ordicab may return `needs_input` when some macros are unresolved. In that case, ask the user for every missing value, then re-emit `generate.document` with a `tagOverrides` object and the same `originDeviceId`.',
    '5. Do not let another synchronized device continue a workflow started on this device. Responses are origin-scoped.',
    '',
    '### Tag Taxonomy',
    'Use consistent, lowercase, hyphenated tags. Always sort tag arrays in alphabetical order before writing.',
    '',
    '#### Document tags (dossier-level)',
    'Tags on documents describe the content of a specific file within a dossier.',
    'Combine a document category tag with a year tag when the document date is clear:',
    '- Category: `assignation`, `conclusions`, `mise-en-demeure`, `jugement`, `ordonnance`',
    '- Category: `courrier-client`, `courrier-adverse`, `courrier-juridiction`',
    '- Category: `contrat`, `acte-notarie`, `expertise`, `rapport`',
    '- Category: `piece-justificative`, `convocation`, `accord-transactionnel`',
    '- Year: `2024`, `2025`, `2026`, etc.',
    '',
    '',
    '### Template Discovery',
    'Templates are a domain-level resource, independent of any individual dossier.',
    `Read the supported routine guide first: \`${templateRoutinesPath}\`.`,
    'When a template needs placeholders, select routines from that guide by preference because those routines are supported directly by Ordicab.',
    '',
    '#### Template storage layout',
    `\`${templatesPath}\` is a **lean index** — each record contains \`id\`, \`name\`, \`description\`, \`macros\`, \`hasDocxSource\`, \`updatedAt\`. No \`content\` field is present.`,
    'Full HTML content for each template lives in a separate file: `<domain>/.ordicab/templates/<id>.html`.',
    'When a DOCX source exists (`hasDocxSource: true`), it is at: `<domain>/.ordicab/templates/<id>.docx`.',
    '',
    '#### Using the index efficiently',
    '- **Variable compatibility check**: the `macros` array in the index lists every placeholder the template uses (e.g. `["contact.displayName", "dossier.name"]`). Use this to decide whether a template is compatible with the available dossier data — no need to load the HTML for this check.',
    '- **Content editing or generation preview**: read `<domain>/.ordicab/templates/<id>.html` on demand only when you need to inspect, modify, or show the full template text.',
    '',
    'To identify the right template for a `generate.document` action:',
    '1. Read the templates index file to list all available templates with their `id`, `name`, `description`, and `macros`.',
    '2. Filter templates by matching `name` or `description` against the desired document type.',
    '3. If multiple templates match, prefer the one whose name or description best fits the context; ask for clarification only if still ambiguous.',
    '4. Never invent a `templateId`. If no suitable template exists, suggest creating one first with `template.create`.',
    '5. Do not try to pre-validate `macros` against dossier data manually — many fields are computed at render time. Emit the intent and rely on the failure file (see "Verifying Intent Outcomes") if any fields are missing.',
    '',
    '### Procedure: "Organize the dossier"',
    'When the user asks to organize a dossier, follow this order:',
    '1. Read the dossier documents and canonical `.ordicab` files directly before writing any intent.',
    '2. Treat the process as incremental if the dossier was already organized: add only new elements and fill only missing details, without duplicating existing contacts, key dates, document summaries, or tags.',
    '3. For each relevant document, index it: extract its text content, then persist a concise summary and useful tags with `document.saveMetadata`. Use document category tags from the taxonomy above and include at least one year tag such as `2026` when the document date is clear.',
    '   - If you can read the document directly (plain text, already parsed), extract purpose and content from what you read.',
    '   - If the document is a binary format you cannot read directly (PDF, DOCX, supported images), use `document.analyze` first to get the extracted text locally, then use `result.text` to generate the description and tags before calling `document.saveMetadata`.',
    '   - "Indexing a document" always means: capture text content + generate description and tags via intents/tools.',
    'When the document clearly supports it, include at least one year tag such as `2011` in the document tags, and sort the final `tags` array in alphabetical order before writing the intent.',
    '4. Sort the final `tags` array in alphabetical order before writing the intent.',
    '5. Complete the dossier details that can be inferred reliably from the documents with `dossier.update`, such as dossier type, status, and the dossier `information` note when the evidence is clear.',
    '6. Extract contacts from the documents and persist them with `contact.upsert`.',
    '7. Extract key dates from the documents and persist them with `dossier.upsertKeyDate`.',
    '8. If a contact, key date, or dossier detail may already exist, re-read the canonical files first and use the real existing `id` only for updates.',
    '9. If a contact identity, role, date meaning, or dossier detail is ambiguous, ask for clarification instead of guessing.',
    '10. Emit multiple small intents in this order instead of one large batch payload: document metadata first, then dossier details, then contacts, then key dates.',
    '',
    '### Contact Extraction Rules',
    'When extracting contacts from documents, prioritize by role and data completeness:',
    '',
    '#### Priority 1: Parties to the Case',
    '**"partie représentée" (Represented Party) and "partie adverse" (Adverse Party)**',
    'These are the primary stakeholders. Extract and persist all available information:',
    '- Full identity: `title`, `firstName`, `additionalFirstNames`, `lastName`, `maidenName`, `gender`',
    `- Complete contact information: \`phone\`, \`email\`, \`addressLine\`, \`addressLine2\`, \`zipCode\`, \`city\`${params.entityCountry ? `, \`country\` (omit if "${params.entityCountry}" — only include when different from the practice's country)` : ', `country`'}`,
    '- Personal information when clearly documented: `dateOfBirth`, `maidenName`, `nationality`, `countryOfBirth`, `occupation`, `socialSecurityNumber`',
    "- Optional context: `information` field for notes about the party's role or status in the case",
    'Always include `gender` when it can be inferred from context or title so that salutation routines work correctly in generated documents.',
    'For the represented party, always use role `partie représentée`. For the adverse party, always use role `partie adverse`.',
    '',
    '#### Priority 2: Jurisdiction and Court Officials',
    '**"juridiction" (Jurisdiction/Court)**',
    'Use court and judicial documents to extract jurisdiction details:',
    '- Persist as a contact with role `juridiction`',
    '- Focus on the `institution` field: the name of the court or tribunal',
    '- Include any phone or email if provided in the court letterhead or signature block',
    '- Do not invent personal names; if the court is referenced generically, use the full court name in `institution`',
    '',
    '#### Priority 3: Other Legal Professionals and Advocates',
    '**Such as adverse counsel, other lawyers, notaries, bailiffs, etc.**',
    'Extract limited identity information for secondary actors:',
    '- Identify the role correctly from the document context (e.g., `avocat de la partie adverse`, `notaire`, `huissier de justice`)',
    '- Full identity: `title`, `firstName`, `lastName`, `gender` (when clearly marked)',
    '- Contact information: `phone`, `email`, `addressLine`, `zipCode`, `city`',
    '- Do NOT attempt to extract personal information (date of birth, etc.) for these roles unless explicitly stated',
    '- Include `institution` (firm or office name) when documented',
    '',
    '#### General Rules for All Contact Extraction',
    '- Always sort contact extraction to match document sections: parties first (in order of appearance), then judicial officials, then supporting professionals',
    params.entityCountry
      ? `- Omit the \`country\` field when the contact's country is "${params.entityCountry}" (the practice's country). Only populate \`country\` when a contact is clearly in a different country.`
      : '- Include `country` only when clearly documented; omit it when it can be reasonably inferred from context',
    '- Never invent or guess missing identity fields. If a field cannot be clearly extracted from the document, omit it rather than inferring a value',
    '- Use existing contact `id` values only when updating known contacts; for new contacts omit the `id` field',
    '- When a contact appears in multiple documents with the same role, use the most complete version and consolidate into a single `contact.upsert` per person',
    '- If the same person appears with different roles across documents, create separate contact records for each distinct role context',
    '',
    '### Supported Intent Actions',
    '- `dossier.create`',
    '- `contact.upsert`',
    '- `contact.delete`',
    '- `dossier.update`',
    '- `dossier.upsertKeyDate`',
    '- `dossier.deleteKeyDate`',
    '- `dossier.upsertKeyReference`',
    '- `dossier.deleteKeyReference`',
    '- `entity.update`',
    '- `document.analyze` — extract text and structured facts from supported documents locally (plain text, DOCX, digital PDF, scanned PDF/images via OCR). Returns the raw text for you to summarize.',
    '- `document.saveMetadata`',
    '- `document.relocate`',
    '- `template.create`',
    '- `template.update`',
    '- `template.delete`',
    '- `generate.document`',
    '',
    '### Intent File Format',
    'Each inbox file must contain one JSON object with this envelope:',
    toJsonSnippet(
      buildIntentEnvelopeExample({
        commandId: '2026-03-20T21-45-12.345Z-contact-upsert',
        createdAt: '2026-03-20T21:45:12.345Z',
        originDeviceId: params.originDeviceId,
        action: 'contact.upsert',
        payload: {
          dossierId: 'Client Alpha',
          role: delegatedContactExample.role,
          email: delegatedContactExample.email
        }
      })
    ),
    '`version` must be `1`.',
    '`actor` must be `claude-delegated`.',
    '`originDeviceId` must be the local device-scoped origin id for this Ordicab installation. Reuse the same value for follow-up intents in the same workflow.',
    '`commandId` must be unique for each intent file.',
    'Never batch multiple mutations into one intent file.',
    '',
    '### Response File Format',
    'After Ordicab processes an intent, it writes a response file with the same basename in the responses folder.',
    'Read the response and follow `nextStep` before taking any other action.',
    toJsonSnippet({
      version: 1,
      commandId: 'generate-document-1',
      action: 'generate.document',
      originDeviceId: params.originDeviceId,
      receivedAt: '2026-03-20T21:45:12.345Z',
      completedAt: '2026-03-20T21:45:12.789Z',
      status: 'needs_input',
      nextStep:
        'Ask the user for each missing field, then re-emit generate.document with tagOverrides and the same originDeviceId.',
      error: {
        code: 'VALIDATION_FAILED',
        message:
          'Document generation failed: some template fields could not be resolved from the dossier data.',
        unresolvedTags: [
          {
            path: 'dossier.keyDate.judgmentDate',
            description: 'Judgment date'
          }
        ]
      }
    }),
    '',
    '### Action Payload Examples',
    '',
    '#### Contacts',
    '**Important**: `displayName` is a **computed field** derived from `title`, `firstName`, `additionalFirstNames`, and `lastName`. Never include `displayName` in contact write intents—it is automatically computed at render time.',
    '**Partial update (merge semantics)**: when updating an existing contact, include `id` and only the fields you want to change — all other fields are preserved from the existing record. Only omit `id` when creating a new contact.',
    'Create or update:',
    'If role or another useful field is known, include it. If some action truly requires a missing field, ask the user before emitting the intent.',
    'For the `role` field, always prefer one of the configured contact roles listed below. Only use a custom role if none of the configured roles fits.',
    `Configured contact roles: ${params.contactRoles && params.contactRoles.length > 0 ? params.contactRoles.join(', ') : 'client, contact, partenaire'}`,
    '**Address fields**: `addressLine`, `addressLine2`, `zipCode`, `city`, `country` are stored as separate fields. When persisted, Ordicab automatically derives `addressFormatted` (multi-line) and `addressInline` (comma-separated) from these fields — do not compute them yourself.',
    '**Salutation fields**: `salutation`, `salutationFull`, and `dear` are derived from the `gender` field (`M`, `F`, or `N`) — do not set them directly. Always include `gender` when it can be inferred from context so that salutation routines work in generated documents.',
    '**Personal information fields**: `dateOfBirth`, `maidenName`, `nationality`, `countryOfBirth`, `occupation`, `socialSecurityNumber` apply primarily to clients and adversarial parties. Include these only when they are clearly documented; do not guess or infer them.',
    toJsonSnippet(
      buildIntentEnvelopeExample({
        commandId: 'contact-upsert-1',
        createdAt: '2026-03-20T21:45:12.345Z',
        originDeviceId: params.originDeviceId,
        action: 'contact.upsert',
        payload: {
          dossierId: 'Client Alpha',
          title: delegatedContactExample.title,
          firstName: delegatedContactExample.firstName,
          additionalFirstNames: 'Marie Hélène',
          lastName: delegatedContactExample.lastName,
          maidenName: 'Bertrand',
          gender: delegatedContactExample.gender,
          role: delegatedContactExample.role,
          institution: delegatedContactExample.institution,
          addressLine: delegatedContactExample.addressLine,
          addressLine2: delegatedContactExample.addressLine2,
          zipCode: delegatedContactExample.zipCode,
          city: delegatedContactExample.city,
          country: delegatedContactExample.country,
          phone: delegatedContactExample.phone,
          email: delegatedContactExample.email,
          dateOfBirth: '1985-06-15',
          countryOfBirth: 'France',
          nationality: 'Française',
          occupation: 'Ingénieure',
          socialSecurityNumber: '2 85 06 75 123 456 78',
          information:
            'Contact principal du dossier. Valide les choix procéduraux et reçoit les mises à jour.'
        }
      })
    ),
    'Delete:',
    toJsonSnippet(
      buildIntentEnvelopeExample({
        commandId: 'contact-delete-1',
        createdAt: '2026-03-20T21:45:12.345Z',
        originDeviceId: params.originDeviceId,
        action: 'contact.delete',
        payload: {
          dossierId: 'Client Alpha',
          contactUuid: delegatedContactExample.uuid
        }
      })
    ),
    '',
    '#### Key Dates',
    'Create a new key date: omit `id`.',
    toJsonSnippet(
      buildIntentEnvelopeExample({
        commandId: 'key-date-create-1',
        createdAt: '2026-03-20T21:45:12.345Z',
        originDeviceId: params.originDeviceId,
        action: 'dossier.upsertKeyDate',
        payload: {
          dossierId: delegatedKeyDateExample.dossierId,
          label: delegatedKeyDateExample.label,
          date: delegatedKeyDateExample.date,
          note: delegatedKeyDateExample.note
        }
      })
    ),
    'Update an existing key date: include the real existing `id` from canonical files. Never invent one.',
    toJsonSnippet(
      buildIntentEnvelopeExample({
        commandId: 'key-date-upsert-1',
        createdAt: '2026-03-20T21:45:12.345Z',
        originDeviceId: params.originDeviceId,
        action: 'dossier.upsertKeyDate',
        payload: delegatedKeyDateExample
      })
    ),
    'Delete:',
    toJsonSnippet(
      buildIntentEnvelopeExample({
        commandId: 'key-date-delete-1',
        createdAt: '2026-03-20T21:45:12.345Z',
        originDeviceId: params.originDeviceId,
        action: 'dossier.deleteKeyDate',
        payload: {
          dossierId: delegatedKeyDateExample.dossierId,
          keyDateId: delegatedKeyDateExample.id
        }
      })
    ),
    '',
    '#### Key References',
    'Create a new key reference: omit `id`.',
    toJsonSnippet(
      buildIntentEnvelopeExample({
        commandId: 'key-reference-create-1',
        createdAt: '2026-03-20T21:45:12.345Z',
        originDeviceId: params.originDeviceId,
        action: 'dossier.upsertKeyReference',
        payload: {
          dossierId: delegatedKeyReferenceExample.dossierId,
          label: delegatedKeyReferenceExample.label,
          value: delegatedKeyReferenceExample.value,
          note: delegatedKeyReferenceExample.note
        }
      })
    ),
    'Update an existing key reference: include the real existing `id` from canonical files. Never invent one.',
    toJsonSnippet(
      buildIntentEnvelopeExample({
        commandId: 'key-reference-upsert-1',
        createdAt: '2026-03-20T21:45:12.345Z',
        originDeviceId: params.originDeviceId,
        action: 'dossier.upsertKeyReference',
        payload: delegatedKeyReferenceExample
      })
    ),
    'Delete:',
    toJsonSnippet(
      buildIntentEnvelopeExample({
        commandId: 'key-reference-delete-1',
        createdAt: '2026-03-20T21:45:12.345Z',
        originDeviceId: params.originDeviceId,
        action: 'dossier.deleteKeyReference',
        payload: {
          dossierId: delegatedKeyReferenceExample.dossierId,
          keyReferenceId: delegatedKeyReferenceExample.id
        }
      })
    ),
    '',
    '#### Entity Profile',
    'Update the domain entity profile:',
    toJsonSnippet(
      buildIntentEnvelopeExample({
        commandId: 'entity-update-1',
        createdAt: '2026-03-20T21:45:12.345Z',
        originDeviceId: params.originDeviceId,
        action: 'entity.update',
        payload: delegatedEntityExample
      })
    ),
    '',
    '#### Dossier Creation',
    'Create a new dossier folder and register it in the domain. The `id` is the folder name (direct child of the domain root). The folder must not already exist as a registered dossier.',
    toJsonSnippet(
      buildIntentEnvelopeExample({
        commandId: 'dossier-create-1',
        createdAt: '2026-03-20T21:45:12.345Z',
        originDeviceId: params.originDeviceId,
        action: 'dossier.create',
        payload: {
          id: 'Nouveau Dossier Client'
        }
      })
    ),
    'After emitting a `dossier.create` intent, verify success by reading the domain registry file and confirming the new dossier `id` appears in the `dossiers` array.',
    '',
    '#### Dossier Metadata',
    'Update dossier setup:',
    toJsonSnippet(
      buildIntentEnvelopeExample({
        commandId: 'dossier-update-1',
        createdAt: '2026-03-20T21:45:12.345Z',
        originDeviceId: params.originDeviceId,
        action: 'dossier.update',
        payload: {
          id: 'Client Alpha',
          status: 'active',
          type: 'Civil litigation',
          information:
            'Running dossier summary and current status. Update this incrementally as new context becomes reliable.'
        }
      })
    ),
    '',
    '#### Indexing a Document (Content Extraction + Metadata)',
    '**"Indexer un document" means: extract its text content locally, then generate a description and tags from that text.**',
    'Use `document.analyze` to have Ordicab extract the full text from any supported document locally (no network, no images sent anywhere).',
    'Supported formats: `.pdf` (embedded text or scanned OCR), `.jpg`/`.jpeg`/`.png`/`.tif`/`.tiff` (OCR), `.docx` (mammoth extraction), `.txt`/`.md` and other plain-text files (direct read).',
    'The response `result.text` contains the raw extracted text, augmented with existing metadata (description, tags). Use it to write the description and tags yourself, then persist with `document.saveMetadata`.',
    'The response also includes `result.analysis` with detected parties, dates, monetary amounts, clauses, suggested tags, and an overall confidence score.',
    'The response also includes `result.method`: `direct` (plain text), `docx`, `embedded` (digital PDF), `tesseract` (scanned PDF/image OCR), or `cached`.',
    'This two-step workflow applies whenever you need to index a document you cannot read directly:',
    'Step 1 — emit `document.analyze` and wait for the response:',
    toJsonSnippet(
      buildIntentEnvelopeExample({
        commandId: 'document-analyze-1',
        createdAt: '2026-03-20T21:45:12.345Z',
        originDeviceId: params.originDeviceId,
        action: 'document.analyze',
        payload: {
          dossierId: 'Client Alpha',
          documentId: 'subfolder/filename.pdf'
        }
      })
    ),
    'The response includes `result.text` (full extracted text), `result.method` (`embedded`, `tesseract`, or `cached`), and `result.textLength`.',
    'Step 2 — after reading `result.text`, emit `document.saveMetadata` with the description and tags you generated:',
    toJsonSnippet(
      buildIntentEnvelopeExample({
        commandId: 'document-save-metadata-1',
        createdAt: '2026-03-20T21:45:12.345Z',
        originDeviceId: params.originDeviceId,
        action: 'document.saveMetadata',
        payload: {
          dossierId: 'Client Alpha',
          documentId: 'subfolder/filename.pdf',
          description: 'Description generated from the extracted text.',
          tags: ['2026', 'tag1', 'tag2']
        }
      })
    ),
    'The extracted text is cached in `.ordicab/content-cache/` (except plain-text files which are always read directly) — subsequent `document.analyze` calls for the same file return instantly.',
    '',
    '#### Document Annotations (Manual)',
    'When you can already read the document content yourself, skip `document.analyze` and emit `document.saveMetadata` directly:',
    toJsonSnippet(
      buildIntentEnvelopeExample({
        commandId: 'document-save-metadata-direct-1',
        createdAt: '2026-03-20T21:45:12.345Z',
        originDeviceId: params.originDeviceId,
        action: 'document.saveMetadata',
        payload: {
          dossierId: 'Client Alpha',
          documentId: 'subfolder/filename.pdf',
          description: 'Optional description',
          tags: ['tag1', 'tag2']
        }
      })
    ),
    'Use this action only to update `description` and `tags` for an existing document.',
    'Always sort document tags in alphabetical order before writing the payload.',
    'Execution is still relativePath-based today, so UUIDs are for discovery and disambiguation, while `documentId` remains the canonical relative path.',
    'If the same document was moved or renamed outside Ordicab and you know its UUID, use `document.relocate` to preserve the existing metadata binding:',
    toJsonSnippet(
      buildIntentEnvelopeExample({
        commandId: 'document-relocate-1',
        createdAt: '2026-03-20T21:45:12.345Z',
        originDeviceId: params.originDeviceId,
        action: 'document.relocate',
        payload: {
          dossierId: 'Client Alpha',
          documentUuid: 'document-uuid-1',
          fromDocumentId: 'old-folder/filename.pdf',
          toDocumentId: 'new-folder/filename.pdf'
        }
      })
    ),
    '',
    '#### Templates',
    'Templates are domain-level resources, not tied to any specific dossier.',
    `Before editing template content, read the supported routine guide at ${templateRoutinesPath}.`,
    'Prefer routines listed in that guide over ad hoc placeholders because those routines are supported directly by Ordicab.',
    'The `macros` field in the index is computed by Ordicab from the HTML content — do not include it in intent payloads.',
    'To edit an existing template, read its HTML content first from `<domain>/.ordicab/templates/<id>.html`, then emit a `template.update` intent with the modified content.',
    'Create:',
    toJsonSnippet(
      buildIntentEnvelopeExample({
        commandId: 'template-create-1',
        createdAt: '2026-03-20T21:45:12.345Z',
        originDeviceId: params.originDeviceId,
        action: 'template.create',
        payload: {
          name: delegatedTemplateExample.name,
          content: delegatedTemplateExample.content,
          description: delegatedTemplateExample.description
        }
      })
    ),
    'Update (read `<domain>/.ordicab/templates/<id>.html` first, then emit with modified content):',
    toJsonSnippet(
      buildIntentEnvelopeExample({
        commandId: 'template-update-1',
        createdAt: '2026-03-20T21:45:12.345Z',
        originDeviceId: params.originDeviceId,
        action: 'template.update',
        payload: {
          id: delegatedTemplateExample.id,
          name: delegatedTemplateExample.name,
          content: delegatedTemplateExample.content,
          description: delegatedTemplateExample.description
        }
      })
    ),
    'Delete:',
    toJsonSnippet(
      buildIntentEnvelopeExample({
        commandId: 'template-delete-1',
        createdAt: '2026-03-20T21:45:12.345Z',
        originDeviceId: params.originDeviceId,
        action: 'template.delete',
        payload: {
          id: delegatedTemplateExample.id
        }
      })
    ),
    '',
    '#### Document Generation',
    'Ask Ordicab to generate the document instead of writing it yourself.',
    'Always include `description` and `tags` in the payload so the generated document is annotated immediately after creation. Use document category tags from the taxonomy above and include at least one year tag when the document date is clear. Sort `tags` alphabetically.',
    toJsonSnippet(
      buildIntentEnvelopeExample({
        commandId: 'generate-document-1',
        createdAt: '2026-03-20T21:45:12.345Z',
        originDeviceId: params.originDeviceId,
        action: 'generate.document',
        payload: {
          dossierId: 'Client Alpha',
          templateId: delegatedTemplateExample.id,
          description: 'Concise description of the generated document purpose',
          tags: ['2026', 'example-tag']
        }
      })
    ),
    'If Ordicab replies with `status: "needs_input"` because some macros are unresolved, ask the user for every missing value and then emit a new `generate.document` intent with a new `commandId`, the same `originDeviceId`, and a `tagOverrides` object containing the collected values.',
    toJsonSnippet(
      buildIntentEnvelopeExample({
        commandId: 'generate-document-2',
        createdAt: '2026-03-20T21:46:10.000Z',
        originDeviceId: params.originDeviceId,
        action: 'generate.document',
        payload: {
          dossierId: 'Client Alpha',
          templateId: delegatedTemplateExample.id,
          description: 'Concise description of the generated document purpose',
          tags: ['2026', 'example-tag'],
          tagOverrides: {
            'dossier.keyDate.judgmentDate': '2026-04-22'
          }
        }
      })
    ),
    'Worked example for synchronized devices: device A submits the first intent and receives `needs_input`; device B may see the synchronized response file but must ignore it because the `originDeviceId` does not belong to device B. Only device A may ask the user for the missing macro and continue with the follow-up intent.',
    '',
    '### File Paths',
    '',
    '#### Domain Files',
    `- Entity profile: ${entityPath}`,
    `- Templates index (lean, no content): ${templatesPath}`,
    `- Template HTML content (on-demand): <domain>/.ordicab/templates/<id>.html`,
    `- Template routines guide: ${templateRoutinesPath}`,
    `- Delegated intent inbox: ${inboxPath}`,
    `- Delegated responses: ${responsesPath}`,
    `- Legacy failed responses during migration: ${failedPath}`,
    ''
  ]

  if (params.dossiers.length === 0) {
    lines.push('#### Dossier Files', 'No dossier file paths are available yet.', '')
  } else {
    lines.push('#### Dossier Files')

    for (const dossier of params.dossiers) {
      lines.push(
        `- ${dossier.folderName} (${dossier.id}${dossier.uuid ? `, uuid: ${dossier.uuid}` : ''})`,
        `  - contacts.json: ${getDossierContactsPath(dossier.folderPath)}`,
        `  - dossier.json: ${getDossierMetadataPath(dossier.folderPath)}`
      )
    }

    lines.push('')
  }

  return `${lines.join('\n')}\n`
}

/**
 * Builds the domain-root instructions file (`CLAUDE.md`, `AGENTS.md`, etc.) for a delegated mode.
 * The file provides startup rules plus canonical paths, then inlines the delegated workflow manual.
 */
export function buildDomainRootAiDelegatedInstructions(input: {
  mode: AiMode
  domainPath: string
  dossiers: LoadedDossierContextForInstructions[]
  entityCountry?: string
  contactRoles?: string[]
  originDeviceId: string
}): string {
  const registryPath = getDomainRegistryPath(input.domainPath)
  const templateRoutinesPath = getDomainTemplateRoutinesPath(input.domainPath)
  const operatingRulesLine =
    input.mode === 'copilot'
      ? 'This copilot instructions file is intentionally limited to workflow instructions and canonical source paths.'
      : input.mode === 'codex'
        ? 'This AGENTS.md file is intentionally limited to workflow instructions and canonical source paths.'
        : 'This CLAUDE.md is intentionally limited to workflow instructions and canonical source paths.'
  const lines: string[] = [
    '# Ordicab Domain Context',
    '',
    `Domain: ${input.domainPath}`,
    '',
    '## Session Startup',
    'At the start of every new session, greet the user in one short sentence confirming that Ordicab is detected and connected for this session.',
    'Example: "Ordicab est détecté et connecté pour cette session. Je suis prêt à vous aider."',
    '',
    '## Operating Rules',
    operatingRulesLine,
    'Always read the source files directly before acting. Do not trust this file as a live data snapshot.',
    '',
    '## Domain Source Files',
    `- Registry: ${registryPath}`,
    `- Entity profile: ${getDomainEntityPath(input.domainPath)}`,
    `- Templates index (lean, no content): ${getDomainTemplatesPath(input.domainPath)}`,
    `- Template HTML content (on-demand): ${getDomainOrdicabPath(input.domainPath)}/templates/<id>.html`,
    `- Template routines guide: ${templateRoutinesPath}`,
    '',
    `## Registered Dossier Source Paths (${input.dossiers.length} total)`,
    'Verify each dossier from its own canonical files before deciding whether to create or update records.',
    ''
  ]

  if (input.dossiers.length === 0) {
    lines.push('No registered dossiers available.', '')
  } else {
    for (const dossier of input.dossiers) {
      lines.push(
        `- ${basename(dossier.dossierPath)}`,
        `  - Folder: ${dossier.dossierPath}`,
        `  - dossier.json: ${getDossierMetadataPath(dossier.dossierPath)}`,
        `  - contacts.json: ${getDossierContactsPath(dossier.dossierPath)}`,
        `  - documents root: ${dossier.dossierPath}`
      )
    }
    lines.push('')
  }

  lines.push(
    ...buildDelegatedInstructions({
      domainPath: input.domainPath,
      scope: 'domain',
      entityCountry: input.entityCountry,
      contactRoles: input.contactRoles,
      originDeviceId: input.originDeviceId,
      dossiers: input.dossiers.map((dossier) => ({
        id: dossier.metadata.id,
        uuid: dossier.metadata.uuid,
        folderName: basename(dossier.dossierPath),
        folderPath: dossier.dossierPath
      }))
    })
      .trimEnd()
      .split('\n')
  )

  return `${lines.join('\n')}\n`
}
