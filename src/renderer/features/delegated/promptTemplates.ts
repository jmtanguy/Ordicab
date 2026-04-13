import { i18n } from '@renderer/i18n'

export type DelegatedAction = 'contacts' | 'keyDates' | 'keyReferences' | 'entity' | 'dossierSetup'

export interface DelegatedContext {
  entityName: string | null
  sampleDossierName: string | null
}

export interface DelegatedOperation {
  id: string
  priority: number
  name: string
  description: string
  buildPrompt: (context: DelegatedContext) => string
}

const DOSSIER_PLACEHOLDER = '[your dossier name]'
const ENTITY_PLACEHOLDER = '[firm name]'

const promptKeys: Record<DelegatedAction, string> = {
  contacts: 'delegated.prompts.contacts',
  keyDates: 'delegated.prompts.keyDates',
  keyReferences: 'delegated.prompts.keyReferences',
  entity: 'delegated.prompts.entity',
  dossierSetup: 'delegated.prompts.dossierSetup'
}

interface PromptContext {
  dossierName?: string
}

function resolveDossierName(context: DelegatedContext): string {
  return context.sampleDossierName?.trim() || DOSSIER_PLACEHOLDER
}

function resolveEntityName(context: DelegatedContext): string {
  return context.entityName?.trim() || ENTITY_PLACEHOLDER
}

export const DELEGATED_OPERATIONS: DelegatedOperation[] = [
  {
    id: 'dossierBulkSetup',
    priority: 1,
    get name() {
      return i18n.t('delegated.reference.operations.dossierBulkSetup.name')
    },
    get description() {
      return i18n.t('delegated.reference.operations.dossierBulkSetup.description')
    },
    buildPrompt: (context) =>
      i18n.t('delegated.reference.operations.dossierBulkSetup.prompt', {
        dossierName: resolveDossierName(context)
      })
  },
  {
    id: 'contactAddUpdate',
    priority: 2,
    get name() {
      return i18n.t('delegated.reference.operations.contactAddUpdate.name')
    },
    get description() {
      return i18n.t('delegated.reference.operations.contactAddUpdate.description')
    },
    buildPrompt: (context) =>
      i18n.t('delegated.reference.operations.contactAddUpdate.prompt', {
        dossierName: resolveDossierName(context)
      })
  },
  {
    id: 'keyDateExtraction',
    priority: 3,
    get name() {
      return i18n.t('delegated.reference.operations.keyDateExtraction.name')
    },
    get description() {
      return i18n.t('delegated.reference.operations.keyDateExtraction.description')
    },
    buildPrompt: (context) =>
      i18n.t('delegated.reference.operations.keyDateExtraction.prompt', {
        dossierName: resolveDossierName(context)
      })
  },
  {
    id: 'keyReferenceAdd',
    priority: 4,
    get name() {
      return i18n.t('delegated.reference.operations.keyReferenceAdd.name')
    },
    get description() {
      return i18n.t('delegated.reference.operations.keyReferenceAdd.description')
    },
    buildPrompt: (context) =>
      i18n.t('delegated.reference.operations.keyReferenceAdd.prompt', {
        dossierName: resolveDossierName(context)
      })
  },
  {
    id: 'entitySetup',
    priority: 5,
    get name() {
      return i18n.t('delegated.reference.operations.entitySetup.name')
    },
    get description() {
      return i18n.t('delegated.reference.operations.entitySetup.description')
    },
    buildPrompt: (context) =>
      i18n.t('delegated.reference.operations.entitySetup.prompt', {
        entityName: resolveEntityName(context)
      })
  },
  {
    id: 'documentTagging',
    priority: 6,
    get name() {
      return i18n.t('delegated.reference.operations.documentTagging.name')
    },
    get description() {
      return i18n.t('delegated.reference.operations.documentTagging.description')
    },
    buildPrompt: (context) =>
      i18n.t('delegated.reference.operations.documentTagging.prompt', {
        dossierName: resolveDossierName(context)
      })
  },
  {
    id: 'documentAnnotation',
    priority: 7,
    get name() {
      return i18n.t('delegated.reference.operations.documentAnnotation.name')
    },
    get description() {
      return i18n.t('delegated.reference.operations.documentAnnotation.description')
    },
    buildPrompt: (context) =>
      i18n.t('delegated.reference.operations.documentAnnotation.prompt', {
        dossierName: resolveDossierName(context)
      })
  },
  {
    id: 'templateAddUpdate',
    priority: 8,
    get name() {
      return i18n.t('delegated.reference.operations.templateAddUpdate.name')
    },
    get description() {
      return i18n.t('delegated.reference.operations.templateAddUpdate.description')
    },
    buildPrompt: (context) =>
      i18n.t('delegated.reference.operations.templateAddUpdate.prompt', {
        entityName: resolveEntityName(context)
      })
  },
  {
    id: 'documentGenerate',
    priority: 9,
    get name() {
      return i18n.t('delegated.reference.operations.documentGenerate.name')
    },
    get description() {
      return i18n.t('delegated.reference.operations.documentGenerate.description')
    },
    buildPrompt: (context) =>
      i18n.t('delegated.reference.operations.documentGenerate.prompt', {
        dossierName: resolveDossierName(context)
      })
  }
]

export function buildPrompt(action: DelegatedAction, context: PromptContext): string {
  const dossierName = context.dossierName?.trim() || 'Untitled dossier'

  return i18n.t(promptKeys[action], { dossierName })
}
