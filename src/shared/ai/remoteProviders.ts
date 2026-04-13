export const REMOTE_PROVIDER_KIND_VALUES = [
  'openai',
  'anthropic',
  'google',
  'mistral',
  'infomaniak',
  'custom'
] as const

export type RemoteProviderKind = (typeof REMOTE_PROVIDER_KIND_VALUES)[number]

export interface RemoteProviderPreset {
  kind: RemoteProviderKind
  label: string
  baseUrl?: string
  baseUrlTemplate?: string
  requiresProjectRef?: boolean
}

export type ModelCostPerformance = 'low' | 'balanced' | 'high'

export interface RemoteToolModelDefinition {
  name: string
  comment: string
  costPerformance: ModelCostPerformance
}

export const REMOTE_PROVIDER_TOOL_MODELS: Readonly<
  Record<RemoteProviderKind, RemoteToolModelDefinition[]>
> = {
  // Low-cost model is intentionally first for default selection.
  openai: [
    {
      name: 'gpt-5.2',
      comment: 'Slightly cheaper frontier model with near GPT-5.3 performance.',
      costPerformance: 'balanced'
    },
    {
      name: 'gpt-5.3',
      comment: 'Flagship multimodal reasoning model for advanced tool orchestration.',
      costPerformance: 'high'
    },
    {
      name: 'gpt-5.4-mini',
      comment: 'Flagship multimodal reasoning model for advanced tool orchestration.',
      costPerformance: 'high'
    }
  ],
  anthropic: [
    {
      name: 'claude-haiku-4-5-20251001', // était: claude-4.5-haiku
      comment: 'Lowest-cost Anthropic model for fast lightweight tasks.',
      costPerformance: 'low'
    },
    {
      name: 'claude-sonnet-4-5', // était: claude-4.5-sonnet
      comment: 'Lower-cost model for cost-sensitive pipelines.',
      costPerformance: 'low'
    },
    {
      name: 'claude-sonnet-4-6', // était: claude-4.6-sonnet ✅ presque correct
      comment: 'Balanced model with strong tool use and structured reasoning.',
      costPerformance: 'balanced'
    },
    {
      name: 'claude-opus-4-6', // était: claude-4.6-opus ✅ presque correct
      comment: 'Top-tier reasoning model with very strong long-context performance.',
      costPerformance: 'high'
    }
  ],
  google: [
    {
      name: 'gemini-2.5-flash', // était: gemini-3-flash (n'existe pas en stable)
      comment: 'Ultra-fast, low-cost model for latency-sensitive tasks.',
      costPerformance: 'low'
    },
    {
      name: 'gemini-3.1-pro', // était: gemini-3.1-pro ✅ correct (preview)
      comment: 'Stable high-performance model with lower cost than flagship.',
      costPerformance: 'balanced'
    },
    {
      name: 'gemini-3.1-pro', // était: gemini-3-pro → SHUT DOWN le 9 mars 2026
      comment: 'Flagship multimodal model for tool-rich workflows.',
      costPerformance: 'high'
    }
  ],
  mistral: [
    {
      name: 'ministral-8b-latest', // ✅ nouveau
      comment: 'Ultra-fast edge model, ideal for high-volume low-latency tasks.',
      costPerformance: 'low'
    },
    {
      name: 'mistral-small-latest',
      comment: 'Lightweight and cost-efficient model.',
      costPerformance: 'low'
    },
    {
      name: 'mistral-medium-latest',
      comment: 'Balanced performance/cost model.',
      costPerformance: 'balanced'
    },
    {
      name: 'mistral-large-latest',
      comment: 'Strong multilingual frontier model for deeper reasoning.',
      costPerformance: 'high'
    }
  ],
  infomaniak: [
    {
      name: 'qwen3',
      comment: 'Cost-efficient default for general workflows.',
      costPerformance: 'low'
    },
    {
      name: 'mistral3',
      comment: 'Balanced model for day-to-day agent tasks.',
      costPerformance: 'balanced'
    },
    {
      name: 'mistral24b',
      comment: 'Higher-capacity model for harder reasoning cases.',
      costPerformance: 'high'
    },
    {
      name: 'openai/gpt-oss-120b',
      comment: 'Large open model for advanced reasoning and tool workflows.',
      costPerformance: 'high'
    }
  ],
  custom: [
    {
      name: 'gpt-5.1-mini',
      comment: 'Low-cost default for custom OpenAI-compatible providers.',
      costPerformance: 'low'
    },
    {
      name: 'qwen3-32b',
      comment: 'Balanced open model for general NLP and tool use.',
      costPerformance: 'balanced'
    },
    {
      name: 'llama-3.3-70b-versatile',
      comment: 'High-capability open model for complex reasoning.',
      costPerformance: 'high'
    }
  ]
}

export const REMOTE_PROVIDER_TOOL_MODEL_NAMES: Readonly<Record<RemoteProviderKind, string[]>> = {
  openai: REMOTE_PROVIDER_TOOL_MODELS.openai.map((model) => model.name),
  anthropic: REMOTE_PROVIDER_TOOL_MODELS.anthropic.map((model) => model.name),
  google: REMOTE_PROVIDER_TOOL_MODELS.google.map((model) => model.name),
  mistral: REMOTE_PROVIDER_TOOL_MODELS.mistral.map((model) => model.name),
  infomaniak: REMOTE_PROVIDER_TOOL_MODELS.infomaniak.map((model) => model.name),
  custom: REMOTE_PROVIDER_TOOL_MODELS.custom.map((model) => model.name)
}

export const REMOTE_PROVIDER_PRESETS: ReadonlyArray<RemoteProviderPreset> = [
  { kind: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { kind: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1' },
  {
    kind: 'google',
    label: 'Google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai'
  },
  { kind: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1' },
  {
    kind: 'infomaniak',
    label: 'Infomaniak',
    baseUrlTemplate: 'https://api.infomaniak.com/2/ai/{projectRef}/openai/v1',
    requiresProjectRef: true
  },
  { kind: 'custom', label: 'Custom OpenAI-compatible' }
]

export function normalizeOpenAiCompatibleBaseUrl(raw: string): string {
  return raw
    .trim()
    .replace(/\/chat\/completions\/?$/, '')
    .replace(/\/$/, '')
}

export function getRemoteProviderPreset(kind: RemoteProviderKind): RemoteProviderPreset {
  return (
    REMOTE_PROVIDER_PRESETS.find((preset) => preset.kind === kind) ?? REMOTE_PROVIDER_PRESETS[0]
  )
}

export function inferRemoteProviderKind(remoteProvider?: string): RemoteProviderKind {
  const provider = normalizeOpenAiCompatibleBaseUrl(remoteProvider ?? '').toLowerCase()
  if (!provider) return 'custom'
  if (provider.includes('api.openai.com')) return 'openai'
  if (provider.includes('api.anthropic.com')) return 'anthropic'
  if (provider.includes('generativelanguage.googleapis.com')) return 'google'
  if (provider.includes('api.mistral.ai')) return 'mistral'
  if (provider.includes('api.infomaniak.com') && /\/2\/ai\/[^/]+\/openai\/v1/.test(provider)) {
    return 'infomaniak'
  }
  return 'custom'
}

export function inferInfomaniakProjectRef(remoteProvider?: string): string | undefined {
  const provider = normalizeOpenAiCompatibleBaseUrl(remoteProvider ?? '')
  const match = provider.match(/\/2\/ai\/([^/]+)\/openai\/v1$/i)
  const ref = match?.[1]?.trim()
  return ref ? ref : undefined
}

export function buildRemoteProviderUrl(input: {
  providerKind: RemoteProviderKind
  customProviderUrl?: string
  projectRef?: string
}): string | null {
  const projectRef = input.projectRef?.trim() ?? ''

  if (input.providerKind === 'custom') {
    const raw = input.customProviderUrl ?? ''
    const withRef = projectRef ? raw.replaceAll('{projectRef}', projectRef) : raw
    const url = normalizeOpenAiCompatibleBaseUrl(withRef)
    return url || null
  }

  const preset = getRemoteProviderPreset(input.providerKind)
  if (preset.baseUrlTemplate) {
    if (!projectRef) return null
    return normalizeOpenAiCompatibleBaseUrl(
      preset.baseUrlTemplate.replaceAll('{projectRef}', projectRef)
    )
  }

  return preset.baseUrl ?? null
}

export function resolveDefaultRemoteModel(
  remoteProvider?: string,
  providerKind?: RemoteProviderKind
): string {
  if (providerKind) {
    const models = REMOTE_PROVIDER_TOOL_MODEL_NAMES[providerKind]
    if (models && models.length > 0) return models[0]
  }

  const provider = normalizeOpenAiCompatibleBaseUrl(remoteProvider ?? '').toLowerCase()

  const inferredKind = inferRemoteProviderKind(provider)
  const inferredModels = REMOTE_PROVIDER_TOOL_MODEL_NAMES[inferredKind]
  if (inferredModels && inferredModels.length > 0) return inferredModels[0]
  return REMOTE_PROVIDER_TOOL_MODEL_NAMES.custom[0] ?? 'gpt-5.1-mini'
}

export function getRemoteToolModelDetails(
  providerKind: RemoteProviderKind,
  modelName: string
): RemoteToolModelDefinition | null {
  const normalized = modelName.trim().toLowerCase()
  const model =
    REMOTE_PROVIDER_TOOL_MODELS[providerKind].find(
      (entry) => entry.name.trim().toLowerCase() === normalized
    ) ?? null
  return model
}
