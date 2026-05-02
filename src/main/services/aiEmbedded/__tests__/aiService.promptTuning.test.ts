import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  AiCommandContext,
  AppLocale,
  ContactRecord,
  DocumentRecord,
  DossierDetail,
  DossierSummary,
  InternalAiCommand
} from '@shared/types'

import { createAiService } from '../aiService'
import { ActionToolExecutor } from '../actionToolExecutor'
import type { AiAgentRuntime } from '../../../lib/aiEmbedded/aiSdkAgentRuntime'
import type { InternalAICommandDispatcher } from '../../../lib/aiEmbedded/aiCommandDispatcher'
import { getDomainEntityPath } from '../../../lib/ordicab/ordicabPaths'
import { PiiPseudonymizer } from '../../../lib/aiEmbedded/pii/piiPseudonymizer'

interface PromptTuningScenario {
  name: string
  command: string
  context: AiCommandContext
  runtimeIntent?: InternalAiCommand
  expectedFeedback?: string
  locale?: AppLocale
}

interface CapturedRuntimeCall {
  command: string
  context: AiCommandContext
  systemPrompt: string
  toolSystemPrompt: string
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  model?: string
  domainPath?: string
}

const PROMPT_TUNING_SCENARIOS: PromptTuningScenario[] = [
  {
    name: 'lookup active dossier contacts',
    command: 'Liste les contacts de ce dossier',
    context: { dossierId: 'dossier-testcase-a' },
    runtimeIntent: { type: 'contact_lookup', query: 'contacts' },
    expectedFeedback: 'Dispatched contact_lookup'
  },
  {
    name: 'generate an email for a known contact',
    command: 'Rédige un email poli à John Martin pour demander un rendez-vous la semaine prochaine',
    context: { dossierId: 'dossier-testcase-a', contactId: 'contact-john-martin' },
    runtimeIntent: {
      type: 'text_generate',
      textType: 'email',
      contactId: 'contact-john-martin',
      language: 'fr',
      instructions: 'Demander un rendez-vous la semaine prochaine'
    },
    expectedFeedback: 'generated text'
  },
  {
    name: 'fill missing tag values',
    command: '15 avril 2026',
    context: {
      dossierId: 'dossier-testcase-a',
      templateId: 'template-mise-en-demeure',
      pendingTagPaths: ['hearing.date']
    }
  }
]

const CONTACTS: ContactRecord[] = [
  {
    uuid: 'contact-john-martin',
    dossierId: 'dossier-testcase-a',
    firstName: 'John',
    lastName: 'Martin',
    role: 'Client',
    email: 'john.martin@test-example.com'
  },
  {
    uuid: 'contact-julie-lastname-b',
    dossierId: 'dossier-testcase-a',
    firstName: 'Julie',
    lastName: 'LASTNAME-B',
    role: 'Avocate adverse',
    email: 'julie.lastname-b@example.test'
  }
]

const DOSSIERS: DossierSummary[] = [
  {
    id: 'dossier-testcase-a',
    uuid: 'uuid-dossier-testcase-a',
    name: 'Succession TestCase-A',
    status: 'active',
    type: 'succession',
    updatedAt: '2026-03-21T10:00:00.000Z',
    lastOpenedAt: null,
    nextUpcomingKeyDate: null,
    nextUpcomingKeyDateLabel: null
  },
  {
    id: 'dossier-lastname-b',
    uuid: 'uuid-dossier-lastname-b',
    name: 'Contentieux LASTNAME-B',
    status: 'active',
    type: 'contentieux',
    updatedAt: '2026-03-19T10:00:00.000Z',
    lastOpenedAt: null,
    nextUpcomingKeyDate: null,
    nextUpcomingKeyDateLabel: null
  }
]

const DOSSIER_DETAIL: DossierDetail = {
  id: 'dossier-testcase-a',
  uuid: 'uuid-dossier-testcase-a',
  name: 'Succession TestCase-A',
  status: 'active',
  type: 'succession',
  description: 'Dossier de test pour le tuning des prompts',
  createdAt: '2026-03-20T10:00:00.000Z',
  updatedAt: '2026-03-21T10:00:00.000Z',
  lastOpenedAt: null,
  nextUpcomingKeyDate: null,
  nextUpcomingKeyDateLabel: null,
  registeredAt: '2026-03-20T10:00:00.000Z',
  keyDates: [],
  keyReferences: []
}

const DOCUMENTS: DocumentRecord[] = [
  {
    id: 'document-note-strategie',
    dossierId: 'dossier-testcase-a',
    filename: 'note-strategie.docx',
    byteLength: 1024,
    relativePath: 'note-strategie.docx',
    modifiedAt: '2026-03-21T09:15:00.000Z',
    description: 'Synthèse de stratégie',
    tags: ['strategie'],
    textExtraction: { state: 'extractable', isExtractable: true }
  }
]

const TEMPLATES = [
  {
    id: 'template-mise-en-demeure',
    name: 'Lettre de mise en demeure',
    description: 'Relance formelle',
    macros: ['client.nom', 'hearing.date']
  },
  {
    id: 'template-courrier-audience',
    name: "Courrier d'audience",
    description: "Convocation et informations d'audience",
    macros: ['hearing.date']
  }
]

function makeRuntime(intent: InternalAiCommand = { type: 'contact_lookup', query: 'contacts' }): {
  runtime: AiAgentRuntime
  capturedCall: CapturedRuntimeCall | null
} {
  let capturedCall: CapturedRuntimeCall | null = null

  const runtime: AiAgentRuntime = {
    sendCommand: vi.fn().mockImplementation(async (input) => {
      capturedCall = input as CapturedRuntimeCall
      return intent
    }),
    getDebugTrace: vi.fn().mockReturnValue(null),
    getLastToolLoopEntries: vi.fn().mockReturnValue([]),
    appendHistory: vi.fn(),
    resetConversation: vi.fn().mockResolvedValue(undefined),
    generateText: vi.fn().mockResolvedValue('generated text'),
    generateOneShot: vi.fn().mockResolvedValue('generated text'),
    streamText: vi.fn().mockResolvedValue('generated text'),
    cancelCommand: vi.fn(),
    setLocalLanguageModel: vi.fn(),
    setRemoteLanguageModel: vi.fn(),
    dispose: vi.fn()
  }

  return {
    runtime,
    get capturedCall() {
      return capturedCall
    }
  }
}

function makeDispatcher(): InternalAICommandDispatcher {
  return {
    dispatch: vi.fn().mockImplementation(async (intent) => ({
      intent,
      feedback: `Dispatched ${intent.type}`
    }))
  }
}

async function writeStateFile(mode: 'local' | 'remote' = 'local'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ordicab-ai-service-tests-'))
  const filePath = join(dir, 'state.json')
  await writeFile(filePath, JSON.stringify({ ai: { mode } }), 'utf8')
  return filePath
}

async function writeDomainRegistry(
  entries: Array<{ id: string; uuid?: string; name: string }>
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ordicab-ai-domain-tests-'))
  await mkdir(join(dir, '.ordicab'), { recursive: true })
  await writeFile(
    join(dir, '.ordicab', 'registry.json'),
    JSON.stringify({ dossiers: entries }),
    'utf8'
  )
  return dir
}

async function writeEntityProfile(
  domainPath: string,
  profile: Record<string, unknown>
): Promise<void> {
  await writeFile(getDomainEntityPath(domainPath), JSON.stringify(profile), 'utf8')
}

function logPromptDetails(name: string, runtimeCall: CapturedRuntimeCall): void {
  console.log(`\n[aiService prompt tuning] ${name}`)
  console.log(`command: ${runtimeCall.command}`)
  console.log(`context: ${JSON.stringify(runtimeCall.context)}`)
  console.log('\n--- systemPrompt ---')
  console.log(runtimeCall.systemPrompt)
  console.log('\n--- toolSystemPrompt ---')
  console.log(runtimeCall.toolSystemPrompt)
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('aiService prompt tuning harness', () => {
  it.each(PROMPT_TUNING_SCENARIOS)('$name', async (scenario) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-27T12:00:00.000Z'))

    const stateFilePath = await writeStateFile()
    const domainPath = await writeDomainRegistry([
      {
        id: 'Client Alpha',
        uuid: 'uuid-dossier-testcase-a',
        name: 'Succession TestCase-A'
      },
      {
        id: 'Client Beta',
        uuid: 'uuid-dossier-lastname-b',
        name: 'Contentieux LASTNAME-B'
      }
    ])
    const runtimeProbe = makeRuntime(scenario.runtimeIntent)
    const dispatcher = makeDispatcher()

    const service = createAiService({
      aiAgentRuntime: runtimeProbe.runtime,
      intentDispatcher: dispatcher,
      contactService: {
        list: vi.fn().mockResolvedValue(CONTACTS),
        upsert: vi.fn(),
        delete: vi.fn()
      },
      templateService: {
        list: vi.fn().mockResolvedValue(TEMPLATES),
        getContent: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
      },
      dossierService: {
        listRegisteredDossiers: vi.fn().mockResolvedValue(DOSSIERS),
        getDossier: vi.fn().mockResolvedValue(DOSSIER_DETAIL),
        registerDossier: vi.fn().mockResolvedValue(undefined),
        updateDossier: vi.fn().mockResolvedValue(undefined),
        upsertKeyDate: vi.fn().mockResolvedValue(undefined),
        deleteKeyDate: vi.fn().mockResolvedValue(undefined),
        upsertKeyReference: vi.fn().mockResolvedValue(undefined),
        deleteKeyReference: vi.fn().mockResolvedValue(undefined)
      },
      documentService: {
        listDocuments: vi.fn().mockResolvedValue(DOCUMENTS),
        saveMetadata: vi.fn(),
        relocateMetadata: vi.fn(),
        resolveRegisteredDossierRoot: vi.fn(),
        semanticSearch: vi.fn().mockResolvedValue({ dossierId: '', query: '', hits: [] })
      },
      domainService: {
        getStatus: vi.fn().mockResolvedValue({
          registeredDomainPath: domainPath,
          isAvailable: true
        })
      },
      localeService: {
        getLocale: vi.fn().mockReturnValue(scenario.locale ?? 'fr')
      },
      stateFilePath,
      tessDataPath: '/tmp/tessdata'
    })

    const result = await service.executeCommand({
      command: scenario.command,
      context: scenario.context
    })

    if (scenario.context.pendingTagPaths?.length) {
      expect(runtimeProbe.runtime.sendCommand).not.toHaveBeenCalled()
      expect(result.intent).toEqual({
        type: 'document_generate',
        dossierId: 'dossier-testcase-a',
        templateId: 'template-mise-en-demeure',
        tagOverrides: {
          'hearing.date': '15 avril 2026'
        }
      })
      vi.useRealTimers()
      return
    }

    const runtimeCall = runtimeProbe.capturedCall
    expect(runtimeCall).not.toBeNull()

    if (!runtimeCall) {
      vi.useRealTimers()
      throw new Error('Expected aiService to call aiAgentRuntime.sendCommand')
    }

    if (process.env.AI_SERVICE_PROMPT_DEBUG === '1') {
      logPromptDetails(scenario.name, runtimeCall)
    }

    expect(runtimeCall.command).toBe(scenario.command)
    expect(runtimeCall.context).toEqual(scenario.context)
    expect(runtimeCall.systemPrompt).toContain("Today's date: vendredi 27 mars 2026")
    expect(runtimeCall.systemPrompt).toContain('Succession TestCase-A')
    expect(runtimeCall.systemPrompt).toContain('John Martin')
    expect(runtimeCall.systemPrompt).toContain('Lettre de mise en demeure')
    expect(runtimeCall.toolSystemPrompt).toContain('## Runtime contract')
    expect(runtimeCall.toolSystemPrompt).toContain('contact_lookup')
    expect(runtimeCall.toolSystemPrompt).toContain('managed_fields_get')
    expect(runtimeCall.toolSystemPrompt).toContain('## Active context')
    expect(runtimeCall.toolSystemPrompt).toContain('uuid-dossier-testcase-a')

    if (scenario.runtimeIntent?.type === 'text_generate') {
      const streamTextCall = (runtimeProbe.runtime.streamText as ReturnType<typeof vi.fn>).mock
        .calls[0]
      expect(streamTextCall?.[0]).toBe(
        'Rédige un email professionnel pour: Demander un rendez-vous la semaine prochaine'
      )
      expect(streamTextCall?.[1]).toContain(
        'Recipient: John Martin, Client, john.martin@test-example.com.'
      )
    } else {
      expect(result.feedback).toContain(scenario.expectedFeedback ?? 'Dispatched')
    }

    expect(result.feedback).toContain(scenario.expectedFeedback ?? 'Dispatched')

    expect({
      command: runtimeCall.command,
      context: runtimeCall.context,
      systemPrompt: runtimeCall.systemPrompt,
      toolSystemPrompt: runtimeCall.toolSystemPrompt
    }).toMatchSnapshot()

    vi.useRealTimers()
  })

  it('explicitly forbids literal placeholders in contact_get arguments', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-27T12:00:00.000Z'))

    const stateFilePath = await writeStateFile()
    const domainPath = await writeDomainRegistry([
      {
        id: 'Client Alpha',
        uuid: 'uuid-dossier-testcase-a',
        name: 'Succession TestCase-A'
      }
    ])
    const runtimeProbe = makeRuntime()

    const service = createAiService({
      aiAgentRuntime: runtimeProbe.runtime,
      intentDispatcher: makeDispatcher(),
      contactService: {
        list: vi.fn().mockResolvedValue(CONTACTS),
        upsert: vi.fn(),
        delete: vi.fn()
      },
      templateService: {
        list: vi.fn().mockResolvedValue(TEMPLATES),
        getContent: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
      },
      dossierService: {
        listRegisteredDossiers: vi.fn().mockResolvedValue(DOSSIERS),
        getDossier: vi.fn().mockResolvedValue(DOSSIER_DETAIL),
        registerDossier: vi.fn().mockResolvedValue(undefined),
        updateDossier: vi.fn().mockResolvedValue(undefined),
        upsertKeyDate: vi.fn().mockResolvedValue(undefined),
        deleteKeyDate: vi.fn().mockResolvedValue(undefined),
        upsertKeyReference: vi.fn().mockResolvedValue(undefined),
        deleteKeyReference: vi.fn().mockResolvedValue(undefined)
      },
      documentService: {
        listDocuments: vi.fn().mockResolvedValue(DOCUMENTS),
        saveMetadata: vi.fn(),
        relocateMetadata: vi.fn(),
        resolveRegisteredDossierRoot: vi.fn(),
        semanticSearch: vi.fn().mockResolvedValue({ dossierId: '', query: '', hits: [] })
      },
      domainService: {
        getStatus: vi.fn().mockResolvedValue({
          registeredDomainPath: domainPath,
          isAvailable: true
        })
      },
      localeService: {
        getLocale: vi.fn().mockReturnValue('fr')
      },
      stateFilePath,
      tessDataPath: '/tmp/tessdata'
    })

    await service.executeCommand({
      command: 'Telephone de John Martin',
      context: { dossierId: 'dossier-testcase-a' }
    })

    const runtimeCall = runtimeProbe.capturedCall
    expect(runtimeCall).not.toBeNull()
    expect(runtimeCall?.systemPrompt).toContain(
      'User: "Phone number for John Martin" → { "type": "contact_get", "contactId": "contact-john-martin" }'
    )

    vi.useRealTimers()
  })

  it('documents contact_upsert as the correct tool for partial contact updates like email', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-27T12:00:00.000Z'))

    const stateFilePath = await writeStateFile()
    const domainPath = await writeDomainRegistry([
      {
        id: 'Client Alpha',
        uuid: 'uuid-dossier-testcase-a',
        name: 'Succession TestCase-A'
      }
    ])
    const runtimeProbe = makeRuntime()

    const service = createAiService({
      aiAgentRuntime: runtimeProbe.runtime,
      intentDispatcher: makeDispatcher(),
      contactService: {
        list: vi.fn().mockResolvedValue(CONTACTS),
        upsert: vi.fn(),
        delete: vi.fn()
      },
      templateService: {
        list: vi.fn().mockResolvedValue(TEMPLATES),
        getContent: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
      },
      dossierService: {
        listRegisteredDossiers: vi.fn().mockResolvedValue(DOSSIERS),
        getDossier: vi.fn().mockResolvedValue(DOSSIER_DETAIL),
        registerDossier: vi.fn().mockResolvedValue(undefined),
        updateDossier: vi.fn().mockResolvedValue(undefined),
        upsertKeyDate: vi.fn().mockResolvedValue(undefined),
        deleteKeyDate: vi.fn().mockResolvedValue(undefined),
        upsertKeyReference: vi.fn().mockResolvedValue(undefined),
        deleteKeyReference: vi.fn().mockResolvedValue(undefined)
      },
      documentService: {
        listDocuments: vi.fn().mockResolvedValue(DOCUMENTS),
        saveMetadata: vi.fn(),
        relocateMetadata: vi.fn(),
        resolveRegisteredDossierRoot: vi.fn(),
        semanticSearch: vi.fn().mockResolvedValue({ dossierId: '', query: '', hits: [] })
      },
      domainService: {
        getStatus: vi.fn().mockResolvedValue({
          registeredDomainPath: domainPath,
          isAvailable: true
        })
      },
      localeService: {
        getLocale: vi.fn().mockReturnValue('fr')
      },
      stateFilePath,
      tessDataPath: '/tmp/tessdata'
    })

    await service.executeCommand({
      command: 'Ajouter email john.martin@test-example.com a John Martin',
      context: { dossierId: 'dossier-testcase-a' }
    })

    const runtimeCall = runtimeProbe.capturedCall
    expect(runtimeCall).not.toBeNull()
    expect(runtimeCall?.systemPrompt).toContain(
      'Use this for any partial update such as adding an email'
    )
    expect(runtimeCall?.toolSystemPrompt).toContain(
      'For add/update contact flows, call `managed_fields_get` first'
    )
    expect(runtimeCall?.toolSystemPrompt).toContain('Managed fields are optional')
    expect(runtimeCall?.systemPrompt).toContain(
      'User: "Add email john.martin@test-example.com to John Martin" → { "type": "contact_upsert", "id": "contact-john-martin", "email": "john.martin@test-example.com" }'
    )

    vi.useRealTimers()
  })

  it('keeps managed_fields_get results in clear text even when remote PII pseudonymization is enabled', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-27T12:00:00.000Z'))

    const stateFilePath = await writeStateFile('remote')
    const domainPath = await writeDomainRegistry([
      {
        id: 'Client Alpha',
        uuid: 'uuid-dossier-testcase-a',
        name: 'Succession TestCase-A'
      }
    ])
    await writeEntityProfile(domainPath, {
      firmName: 'Cabinet Exemple',
      profession: 'lawyer',
      managedFields: {
        contactRoles: ['Partie représentée', 'Partie adverse'],
        contacts: [
          { label: 'Nationalité', type: 'text' },
          { label: 'Profession', type: 'text' }
        ],
        keyDates: [{ label: "Date d'audience", type: 'date' }],
        keyReferences: [{ label: 'N° RG', type: 'text' }]
      }
    })

    const runtime: AiAgentRuntime = {
      sendCommand: vi.fn().mockImplementation(async (payload) => {
        const result = await payload.executeDataTool?.('managed_fields_get', {})
        return { type: 'direct_response', message: result ?? '' }
      }),
      getDebugTrace: vi.fn().mockReturnValue(null),
      getLastToolLoopEntries: vi.fn().mockReturnValue([]),
      appendHistory: vi.fn(),
      resetConversation: vi.fn().mockResolvedValue(undefined),
      generateText: vi.fn().mockResolvedValue('generated text'),
      generateOneShot: vi.fn().mockResolvedValue('generated text'),
      streamText: vi.fn().mockResolvedValue('generated text'),
      cancelCommand: vi.fn(),
      setLocalLanguageModel: vi.fn(),
      setRemoteLanguageModel: vi.fn(),
      dispose: vi.fn()
    }

    const dispatcher: InternalAICommandDispatcher = {
      dispatch: vi.fn().mockImplementation(async (intent) => ({
        intent,
        feedback: intent.type === 'direct_response' ? intent.message : `Dispatched ${intent.type}`
      }))
    }

    const service = createAiService({
      aiAgentRuntime: runtime,
      intentDispatcher: dispatcher,
      contactService: {
        list: vi.fn().mockResolvedValue(CONTACTS),
        upsert: vi.fn(),
        delete: vi.fn()
      },
      templateService: {
        list: vi.fn().mockResolvedValue(TEMPLATES),
        getContent: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
      },
      dossierService: {
        listRegisteredDossiers: vi.fn().mockResolvedValue(DOSSIERS),
        getDossier: vi.fn().mockResolvedValue(DOSSIER_DETAIL),
        registerDossier: vi.fn().mockResolvedValue(undefined),
        updateDossier: vi.fn().mockResolvedValue(undefined),
        upsertKeyDate: vi.fn().mockResolvedValue(undefined),
        deleteKeyDate: vi.fn().mockResolvedValue(undefined),
        upsertKeyReference: vi.fn().mockResolvedValue(undefined),
        deleteKeyReference: vi.fn().mockResolvedValue(undefined)
      },
      documentService: {
        listDocuments: vi.fn().mockResolvedValue(DOCUMENTS),
        saveMetadata: vi.fn(),
        relocateMetadata: vi.fn(),
        resolveRegisteredDossierRoot: vi.fn(),
        semanticSearch: vi.fn().mockResolvedValue({ dossierId: '', query: '', hits: [] })
      },
      domainService: {
        getStatus: vi.fn().mockResolvedValue({
          registeredDomainPath: domainPath,
          isAvailable: true
        })
      },
      localeService: {
        getLocale: vi.fn().mockReturnValue('fr')
      },
      stateFilePath,
      tessDataPath: '/tmp'
    })

    const result = await service.executeCommand({
      command: 'Montre les champs gérés',
      context: { dossierId: 'dossier-testcase-a' }
    })

    expect(result.feedback).toContain('Partie représentée')
    expect(result.feedback).toContain('Partie adverse')
    expect(result.feedback).toContain('Nationalité')
    expect(result.feedback).toContain('Profession')
    expect(result.feedback).toContain("Date d'audience")
    expect(result.feedback).toContain('N° RG')
    expect(result.feedback).toContain('"contactRoles":["Partie représentée","Partie adverse"]')
    expect(result.feedback).not.toContain('"contactRoleFields"')
    expect(result.feedback).not.toContain('"contactRoleFields":{"partieRepresentee"')
    expect(result.feedback).not.toContain('"key":"partieRepresentee"')
    expect(result.feedback).not.toContain('"key":"nationality"')
    expect(result.feedback).not.toContain('"managedFieldKeys"')
    expect(result.feedback).not.toContain('[[')

    vi.useRealTimers()
  })

  it('returns human-readable role and field labels in managed_fields_get, not only internal routine keys', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-27T12:00:00.000Z'))

    const stateFilePath = await writeStateFile('remote')
    const domainPath = await writeDomainRegistry([
      {
        id: 'Client Alpha',
        uuid: 'uuid-dossier-testcase-a',
        name: 'Succession TestCase-A'
      }
    ])
    await writeEntityProfile(domainPath, {
      firmName: 'Cabinet Exemple',
      profession: 'lawyer',
      managedFields: {
        contactRoles: ['Huissier de justice'],
        contacts: [{ label: 'Profession', type: 'text' }],
        keyDates: [{ label: "Date d'audience", type: 'date' }],
        keyReferences: [{ label: 'N° RG', type: 'text' }],
        contactRoleFields: {
          huissierDeJustice: ['occupation']
        }
      }
    })

    const runtime: AiAgentRuntime = {
      sendCommand: vi.fn().mockImplementation(async (payload) => {
        const result = await payload.executeDataTool?.('managed_fields_get', {})
        return { type: 'direct_response', message: result ?? '' }
      }),
      getDebugTrace: vi.fn().mockReturnValue(null),
      getLastToolLoopEntries: vi.fn().mockReturnValue([]),
      appendHistory: vi.fn(),
      resetConversation: vi.fn().mockResolvedValue(undefined),
      generateText: vi.fn().mockResolvedValue('generated text'),
      generateOneShot: vi.fn().mockResolvedValue('generated text'),
      streamText: vi.fn().mockResolvedValue('generated text'),
      cancelCommand: vi.fn(),
      setLocalLanguageModel: vi.fn(),
      setRemoteLanguageModel: vi.fn(),
      dispose: vi.fn()
    }

    const dispatcher: InternalAICommandDispatcher = {
      dispatch: vi.fn().mockImplementation(async (intent) => ({
        intent,
        feedback: intent.type === 'direct_response' ? intent.message : `Dispatched ${intent.type}`
      }))
    }

    const service = createAiService({
      aiAgentRuntime: runtime,
      intentDispatcher: dispatcher,
      contactService: {
        list: vi.fn().mockResolvedValue(CONTACTS),
        upsert: vi.fn(),
        delete: vi.fn()
      },
      templateService: {
        list: vi.fn().mockResolvedValue(TEMPLATES),
        getContent: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
      },
      dossierService: {
        listRegisteredDossiers: vi.fn().mockResolvedValue(DOSSIERS),
        getDossier: vi.fn().mockResolvedValue(DOSSIER_DETAIL),
        registerDossier: vi.fn().mockResolvedValue(undefined),
        updateDossier: vi.fn().mockResolvedValue(undefined),
        upsertKeyDate: vi.fn().mockResolvedValue(undefined),
        deleteKeyDate: vi.fn().mockResolvedValue(undefined),
        upsertKeyReference: vi.fn().mockResolvedValue(undefined),
        deleteKeyReference: vi.fn().mockResolvedValue(undefined)
      },
      documentService: {
        listDocuments: vi.fn().mockResolvedValue(DOCUMENTS),
        saveMetadata: vi.fn(),
        relocateMetadata: vi.fn(),
        resolveRegisteredDossierRoot: vi.fn(),
        semanticSearch: vi.fn().mockResolvedValue({ dossierId: '', query: '', hits: [] })
      },
      domainService: {
        getStatus: vi.fn().mockResolvedValue({
          registeredDomainPath: domainPath,
          isAvailable: true
        })
      },
      localeService: {
        getLocale: vi.fn().mockReturnValue('fr')
      },
      stateFilePath,
      tessDataPath: '/tmp'
    })

    const result = await service.executeCommand({
      command: 'Montre les champs gérés',
      context: { dossierId: 'dossier-testcase-a' }
    })

    expect(result.feedback).toContain('Huissier de justice')
    expect(result.feedback).toContain('"label":"Profession"')
    expect(result.feedback).toContain('"contactRoles":["Huissier de justice"]')
    expect(result.feedback).not.toContain('"contactRoleFields"')
    expect(result.feedback).not.toContain('"contactRoles":[{"label":"Huissier de justice"')
    expect(result.feedback).not.toContain('"contactRoleFields":{"huissierDeJustice"')
    expect(result.feedback).not.toContain('huissierDeJustice')
    expect(result.feedback).not.toContain('"key":"occupation"')

    vi.useRealTimers()
  })

  it('reverts pseudonymized data-tool arguments before contact resolution in remote PII mode', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-27T12:00:00.000Z'))

    const stateFilePath = await writeStateFile('remote')
    const domainPath = await writeDomainRegistry([
      {
        id: 'Client Alpha',
        uuid: 'uuid-dossier-testcase-a',
        name: 'Succession TestCase-A'
      }
    ])

    const runtime: AiAgentRuntime = {
      sendCommand: vi.fn().mockImplementation(async (payload) => {
        const markerMatch = payload.command.match(/\[\[contact_1\.lastName\]\]\s+'[^']+'/)
        const result = await payload.executeDataTool?.('contact_get', {
          dossierId: 'dossier-testcase-a',
          contactId: markerMatch?.[0] ?? 'contact-1'
        })
        return { type: 'direct_response', message: result ?? '' }
      }),
      getDebugTrace: vi.fn().mockReturnValue(null),
      getLastToolLoopEntries: vi.fn().mockReturnValue([]),
      appendHistory: vi.fn(),
      resetConversation: vi.fn().mockResolvedValue(undefined),
      generateText: vi.fn().mockResolvedValue('generated text'),
      generateOneShot: vi.fn().mockResolvedValue('generated text'),
      streamText: vi.fn().mockResolvedValue('generated text'),
      cancelCommand: vi.fn(),
      setLocalLanguageModel: vi.fn(),
      setRemoteLanguageModel: vi.fn(),
      dispose: vi.fn()
    }

    const dispatcher: InternalAICommandDispatcher = {
      dispatch: vi.fn().mockImplementation(async (intent) => ({
        intent,
        feedback: intent.type === 'direct_response' ? intent.message : `Dispatched ${intent.type}`
      }))
    }

    const service = createAiService({
      aiAgentRuntime: runtime,
      intentDispatcher: dispatcher,
      contactService: {
        list: vi.fn().mockResolvedValue([
          {
            uuid: 'contact-1',
            dossierId: 'dossier-testcase-a',
            firstName: 'Caroline',
            lastName: 'Merlin'
          }
        ]),
        upsert: vi.fn(),
        delete: vi.fn()
      },
      templateService: {
        list: vi.fn().mockResolvedValue(TEMPLATES),
        getContent: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
      },
      dossierService: {
        listRegisteredDossiers: vi.fn().mockResolvedValue(DOSSIERS),
        getDossier: vi.fn().mockResolvedValue(DOSSIER_DETAIL),
        registerDossier: vi.fn().mockResolvedValue(undefined),
        updateDossier: vi.fn().mockResolvedValue(undefined),
        upsertKeyDate: vi.fn().mockResolvedValue(undefined),
        deleteKeyDate: vi.fn().mockResolvedValue(undefined),
        upsertKeyReference: vi.fn().mockResolvedValue(undefined),
        deleteKeyReference: vi.fn().mockResolvedValue(undefined)
      },
      documentService: {
        listDocuments: vi.fn().mockResolvedValue(DOCUMENTS),
        saveMetadata: vi.fn(),
        relocateMetadata: vi.fn(),
        resolveRegisteredDossierRoot: vi.fn(),
        semanticSearch: vi.fn().mockResolvedValue({ dossierId: '', query: '', hits: [] })
      },
      domainService: {
        getStatus: vi.fn().mockResolvedValue({
          registeredDomainPath: domainPath,
          isAvailable: true
        })
      },
      localeService: {
        getLocale: vi.fn().mockReturnValue('fr')
      },
      stateFilePath,
      tessDataPath: '/tmp'
    })

    const result = await service.executeCommand({
      command: 'supprimer merlin',
      context: { dossierId: 'dossier-testcase-a' }
    })

    expect(result.feedback).toContain('Caroline')
    expect(result.feedback).toContain('Merlin')
    expect(result.feedback).not.toContain('Contact not found')

    vi.useRealTimers()
  })

  it('uses the mixed NER+regex async pseudonymization path for command, history, and prompts in remote mode', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-27T12:00:00.000Z'))

    const stateFilePath = await writeStateFile('remote')
    const domainPath = await writeDomainRegistry([
      {
        id: 'Client Alpha',
        uuid: 'uuid-dossier-testcase-a',
        name: 'Succession TestCase-A'
      }
    ])

    const pseudonymizeAsyncSpy = vi
      .spyOn(PiiPseudonymizer.prototype, 'pseudonymizeAsync')
      .mockImplementation(async function (this: PiiPseudonymizer, text: string) {
        return this.pseudonymize(text)
      })
    const pseudonymizeAutoAsyncSpy = vi
      .spyOn(PiiPseudonymizer.prototype, 'pseudonymizeAutoAsync')
      .mockImplementation(async function (this: PiiPseudonymizer, text: string) {
        return this.pseudonymizeAuto(text)
      })

    const runtimeProbe = makeRuntime({
      type: 'direct_response',
      message: 'Réponse de test'
    })

    const service = createAiService({
      aiAgentRuntime: runtimeProbe.runtime,
      intentDispatcher: makeDispatcher(),
      contactService: {
        list: vi.fn().mockResolvedValue(CONTACTS),
        upsert: vi.fn(),
        delete: vi.fn()
      },
      templateService: {
        list: vi.fn().mockResolvedValue(TEMPLATES),
        getContent: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
      },
      dossierService: {
        listRegisteredDossiers: vi.fn().mockResolvedValue(DOSSIERS),
        getDossier: vi.fn().mockResolvedValue(DOSSIER_DETAIL),
        registerDossier: vi.fn().mockResolvedValue(undefined),
        updateDossier: vi.fn().mockResolvedValue(undefined),
        upsertKeyDate: vi.fn().mockResolvedValue(undefined),
        deleteKeyDate: vi.fn().mockResolvedValue(undefined),
        upsertKeyReference: vi.fn().mockResolvedValue(undefined),
        deleteKeyReference: vi.fn().mockResolvedValue(undefined)
      },
      documentService: {
        listDocuments: vi.fn().mockResolvedValue(DOCUMENTS),
        saveMetadata: vi.fn(),
        relocateMetadata: vi.fn(),
        resolveRegisteredDossierRoot: vi.fn(),
        semanticSearch: vi.fn().mockResolvedValue({ dossierId: '', query: '', hits: [] })
      },
      domainService: {
        getStatus: vi.fn().mockResolvedValue({
          registeredDomainPath: domainPath,
          isAvailable: true
        })
      },
      localeService: {
        getLocale: vi.fn().mockReturnValue('fr')
      },
      stateFilePath,
      tessDataPath: '/tmp',
      nerModelPath: '/tmp/local-models'
    })

    await service.executeCommand({
      command: 'Donne le téléphone de John Martin et cet IBAN FR76 1234 5678 9012 3456 7890 123',
      context: { dossierId: 'dossier-testcase-a' },
      history: [{ role: 'assistant', content: 'Le contact John Martin a été vu précédemment.' }]
    })

    const runtimeCall = runtimeProbe.capturedCall
    expect(runtimeCall).not.toBeNull()
    expect(runtimeCall?.command).not.toContain('John Martin')
    expect(runtimeCall?.command).not.toContain('FR76 1234 5678 9012 3456 7890 123')
    expect(runtimeCall?.history?.[0]?.content).not.toContain('John Martin')
    expect(runtimeCall?.systemPrompt).not.toContain('John Martin')
    expect(runtimeCall?.toolSystemPrompt).not.toContain('John Martin')
    expect(runtimeCall?.toolSystemPrompt).toContain('vendredi 27 mars 2026')
    expect(pseudonymizeAsyncSpy).toHaveBeenCalled()
    expect(pseudonymizeAutoAsyncSpy).not.toHaveBeenCalled()

    vi.useRealTimers()
  })

  it('pseudonymizes document_search query before feeding the tool result back to the model', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-27T12:00:00.000Z'))

    const stateFilePath = await writeStateFile('remote')
    const domainPath = await writeDomainRegistry([
      {
        id: 'Client Alpha',
        uuid: 'uuid-dossier-testcase-a',
        name: 'Succession TestCase-A'
      }
    ])

    vi.spyOn(PiiPseudonymizer.prototype, 'pseudonymizeAsync').mockImplementation(async function (
      this: PiiPseudonymizer,
      text: string
    ) {
      return this.pseudonymize(text)
    })
    vi.spyOn(PiiPseudonymizer.prototype, 'pseudonymizeAutoAsync').mockImplementation(
      async function (this: PiiPseudonymizer, text: string) {
        return this.pseudonymizeAuto(text)
      }
    )

    let safeToolResult = ''
    const runtime: AiAgentRuntime = {
      sendCommand: vi.fn().mockImplementation(async (payload) => {
        safeToolResult =
          (await payload.executeDataTool?.('document_search', {
            dossierId: 'dossier-testcase-a',
            query: 'John Martin'
          })) ?? ''
        return { type: 'direct_response', message: 'ok' }
      }),
      getDebugTrace: vi.fn().mockReturnValue(null),
      getLastToolLoopEntries: vi.fn().mockReturnValue([]),
      appendHistory: vi.fn(),
      resetConversation: vi.fn().mockResolvedValue(undefined),
      generateText: vi.fn().mockResolvedValue('generated text'),
      generateOneShot: vi.fn().mockResolvedValue('generated text'),
      streamText: vi.fn().mockResolvedValue('generated text'),
      cancelCommand: vi.fn(),
      setLocalLanguageModel: vi.fn(),
      setRemoteLanguageModel: vi.fn(),
      dispose: vi.fn()
    }

    const service = createAiService({
      aiAgentRuntime: runtime,
      intentDispatcher: makeDispatcher(),
      contactService: {
        list: vi.fn().mockResolvedValue(CONTACTS),
        upsert: vi.fn(),
        delete: vi.fn()
      },
      templateService: {
        list: vi.fn().mockResolvedValue(TEMPLATES),
        getContent: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
      },
      dossierService: {
        listRegisteredDossiers: vi.fn().mockResolvedValue(DOSSIERS),
        getDossier: vi.fn().mockResolvedValue(DOSSIER_DETAIL),
        registerDossier: vi.fn().mockResolvedValue(undefined),
        updateDossier: vi.fn().mockResolvedValue(undefined),
        upsertKeyDate: vi.fn().mockResolvedValue(undefined),
        deleteKeyDate: vi.fn().mockResolvedValue(undefined),
        upsertKeyReference: vi.fn().mockResolvedValue(undefined),
        deleteKeyReference: vi.fn().mockResolvedValue(undefined)
      },
      documentService: {
        listDocuments: vi.fn().mockResolvedValue(DOCUMENTS),
        saveMetadata: vi.fn(),
        relocateMetadata: vi.fn(),
        resolveRegisteredDossierRoot: vi.fn(),
        semanticSearch: vi.fn().mockResolvedValue({
          dossierId: 'dossier-testcase-a',
          query: 'John Martin',
          hits: [
            {
              documentId: 'document-note-strategie',
              filename: 'note-strategie.docx',
              snippet: 'John Martin conteste la décision.',
              score: 1.25,
              charStart: 0,
              charEnd: 34
            }
          ]
        })
      },
      domainService: {
        getStatus: vi.fn().mockResolvedValue({
          registeredDomainPath: domainPath,
          isAvailable: true
        })
      },
      localeService: {
        getLocale: vi.fn().mockReturnValue('fr')
      },
      stateFilePath,
      tessDataPath: '/tmp',
      nerModelPath: '/tmp/local-models'
    })

    await service.executeCommand({
      command: 'Cherche John Martin',
      context: { dossierId: 'dossier-testcase-a' }
    })

    expect(safeToolResult).toContain('"query":"[[contact.client.firstName]]')
    expect(safeToolResult).not.toContain('"query":"John Martin"')

    vi.useRealTimers()
  })

  it('stores pseudonymized document_analyze feedback in history in remote PII mode', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-27T12:00:00.000Z'))

    const stateFilePath = await writeStateFile('remote')
    const domainPath = await writeDomainRegistry([
      {
        id: 'Client Alpha',
        uuid: 'uuid-dossier-testcase-a',
        name: 'Succession TestCase-A'
      }
    ])

    vi.spyOn(PiiPseudonymizer.prototype, 'pseudonymizeAsync').mockImplementation(async function (
      this: PiiPseudonymizer,
      text: string
    ) {
      return this.pseudonymize(text)
    })
    vi.spyOn(ActionToolExecutor.prototype, 'runDocumentAnalysis').mockResolvedValue(
      JSON.stringify({
        uuid: 'document-note-strategie',
        rawContent: 'John Martin habite 12 rue Victor Hugo et appelle le 06 12 34 56 78.',
        totalChars: 68,
        charsReturned: 68
      })
    )

    const runtimeProbe = makeRuntime({
      type: 'document_analyze',
      documentId: 'document-note-strategie',
      dossierId: 'dossier-testcase-a'
    })

    const service = createAiService({
      aiAgentRuntime: runtimeProbe.runtime,
      intentDispatcher: makeDispatcher(),
      contactService: {
        list: vi.fn().mockResolvedValue(CONTACTS),
        upsert: vi.fn(),
        delete: vi.fn()
      },
      templateService: {
        list: vi.fn().mockResolvedValue(TEMPLATES),
        getContent: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
      },
      dossierService: {
        listRegisteredDossiers: vi.fn().mockResolvedValue(DOSSIERS),
        getDossier: vi.fn().mockResolvedValue(DOSSIER_DETAIL),
        registerDossier: vi.fn().mockResolvedValue(undefined),
        updateDossier: vi.fn().mockResolvedValue(undefined),
        upsertKeyDate: vi.fn().mockResolvedValue(undefined),
        deleteKeyDate: vi.fn().mockResolvedValue(undefined),
        upsertKeyReference: vi.fn().mockResolvedValue(undefined),
        deleteKeyReference: vi.fn().mockResolvedValue(undefined)
      },
      documentService: {
        listDocuments: vi.fn().mockResolvedValue(DOCUMENTS),
        saveMetadata: vi.fn(),
        relocateMetadata: vi.fn(),
        resolveRegisteredDossierRoot: vi.fn(),
        semanticSearch: vi.fn().mockResolvedValue({ dossierId: '', query: '', hits: [] })
      },
      domainService: {
        getStatus: vi.fn().mockResolvedValue({
          registeredDomainPath: domainPath,
          isAvailable: true
        })
      },
      localeService: {
        getLocale: vi.fn().mockReturnValue('fr')
      },
      stateFilePath,
      tessDataPath: '/tmp',
      nerModelPath: '/tmp/local-models'
    })

    const result = await service.executeCommand({
      command: 'Analyse la note de stratégie',
      context: { dossierId: 'dossier-testcase-a' }
    })

    expect(result.feedback).toContain('John Martin')
    expect(result.feedback).toContain('06 12 34 56 78')

    const appendHistoryMock = runtimeProbe.runtime.appendHistory as ReturnType<typeof vi.fn>
    const historyEntries = appendHistoryMock.mock.calls[0]?.[0] ?? []
    const historyPayload = JSON.stringify(historyEntries)

    expect(historyPayload).toContain('document-note-strategie')
    expect(historyPayload).not.toContain('John Martin')
    expect(historyPayload).not.toContain('06 12 34 56 78')
    expect(historyPayload).toContain('[[')

    vi.useRealTimers()
  })
})
