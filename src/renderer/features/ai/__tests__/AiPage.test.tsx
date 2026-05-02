// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockAiStore = {
  settings: { mode: 'local' as const },
  messages: [] as Array<{ id: string; role: 'user' | 'assistant' | 'error'; text: string }>,
  commandLoading: false,
  pendingClarification: null as { question: string; options: string[] } | null,
  availableModels: ['model-a'],
  selectedModel: 'model-a',
  executeCommand: vi.fn(),
  cancelCommand: vi.fn(),
  resolveClarification: vi.fn(),
  subscribeToIntentEvents: vi.fn(() => () => undefined),
  subscribeToTextTokens: vi.fn(() => () => undefined),
  subscribeToReflections: vi.fn(() => () => undefined),
  reflections: [] as Array<{ id: string; text: string }>,
  streamingMessageId: null as string | null,
  checkConnection: vi.fn(),
  setSelectedModel: vi.fn(),
  setActiveDossierId: vi.fn(),
  loadSettings: vi.fn(),
  resetConversation: vi.fn()
}

const mockDossierStore = {
  dossiers: [
    { id: 'dos-1', name: 'Client Alpha' },
    { id: 'dos-2', name: 'Client Beta' }
  ]
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key
  })
}))

vi.mock('@renderer/stores/aiStore', () => ({
  useAiStore: (selector: (state: typeof mockAiStore) => unknown) => selector(mockAiStore)
}))

vi.mock('@renderer/stores/dossierStore', () => ({
  useDossierStore: (selector: (state: typeof mockDossierStore) => unknown) =>
    selector(mockDossierStore)
}))

const mockUiStore = {
  openFolder: vi.fn(async () => ({ success: true as const, data: null }))
}

vi.mock('@renderer/stores/uiStore', () => ({
  useUiStore: (selector: (state: typeof mockUiStore) => unknown) => selector(mockUiStore)
}))

vi.mock('@renderer/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn() })
}))

vi.mock('@renderer/stores/ipc', () => ({
  getOrdicabApi: () => null
}))

vi.mock('../settings/AiSettings', () => ({
  AiDialog: () => null
}))

vi.mock('../delegated/DelegatedReference', () => ({
  DelegatedReference: () => null
}))

import { AiPage, MarkdownBubble } from '../AiPage'

function getDossierSelect(): HTMLSelectElement {
  const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
  const dossierSelect = selects.find((select) =>
    Array.from(select.options).some(
      (option) => option.value === 'dos-1' || option.value === 'dos-2'
    )
  )
  if (!dossierSelect) {
    throw new Error('Dossier select not found')
  }
  return dossierSelect
}

describe('AiPage', () => {
  beforeEach(() => {
    mockAiStore.messages = []
    mockAiStore.commandLoading = false
    mockAiStore.pendingClarification = null
    mockAiStore.selectedModel = 'model-a'
    mockAiStore.settings = { mode: 'local' }
    mockAiStore.executeCommand.mockClear()
    mockAiStore.cancelCommand.mockClear()
    mockAiStore.resolveClarification.mockClear()
    mockAiStore.subscribeToIntentEvents.mockClear()
    mockAiStore.subscribeToTextTokens.mockClear()
    mockAiStore.subscribeToReflections.mockClear()
    mockAiStore.reflections = []
    mockAiStore.streamingMessageId = null
    mockAiStore.checkConnection.mockClear()
    mockAiStore.setSelectedModel.mockClear()
    mockAiStore.setActiveDossierId.mockClear()
    mockAiStore.loadSettings.mockClear()
    mockAiStore.resetConversation.mockClear()
    window.localStorage.clear()
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    cleanup()
  })

  it('lets the user override the initial dossier selection from the selector', async () => {
    render(<AiPage entityName={null} sampleDossierName={null} dossierId="dos-1" />)

    const dossierSelect = getDossierSelect()
    expect(dossierSelect.value).toBe('dos-1')

    fireEvent.change(dossierSelect, { target: { value: 'dos-2' } })

    await waitFor(() => {
      expect(dossierSelect.value).toBe('dos-2')
    })

    fireEvent.change(screen.getByPlaceholderText('ai.panel.placeholder'), {
      target: { value: 'Liste les contacts' }
    })
    fireEvent.click(screen.getByTitle('ai.panel.send'))

    await waitFor(() => {
      expect(mockAiStore.executeCommand).toHaveBeenCalledWith('Liste les contacts', {
        dossierId: 'dos-2'
      })
    })
  })

  it('re-syncs the selector when the parent dossier prop changes', async () => {
    const { rerender } = render(
      <AiPage entityName={null} sampleDossierName={null} dossierId="dos-1" />
    )

    const dossierSelect = getDossierSelect()
    expect(dossierSelect.value).toBe('dos-1')

    rerender(<AiPage entityName={null} sampleDossierName={null} dossierId="dos-2" />)

    await waitFor(() => {
      expect(dossierSelect.value).toBe('dos-2')
    })
  })

  it('does not render the clarification question twice in the assistant bubble', () => {
    mockAiStore.messages = [
      {
        id: 'a1',
        role: 'assistant',
        text: 'Voulez-vous vraiment supprimer le contact Merlin ?'
      }
    ]
    mockAiStore.pendingClarification = {
      question: 'Voulez-vous vraiment supprimer le contact Merlin ?',
      options: ['Oui', 'Non']
    }

    render(<AiPage entityName={null} sampleDossierName={null} dossierId="dos-1" />)

    expect(screen.getAllByText('Voulez-vous vraiment supprimer le contact Merlin ?')).toHaveLength(
      1
    )
    expect(screen.getByRole('button', { name: 'Oui' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Non' })).toBeTruthy()
  })
})

describe('MarkdownBubble', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders markdown tables in assistant bubbles', () => {
    render(
      <MarkdownBubble
        text={[
          '| Rôle | Prénom(s) | Nom |',
          '|------|-----------|------|',
          '| Partie adverse | Contact | DATA-A |',
          '| Avocat de la partie adverse | Conseil | DATA-C |',
          '| Partie représentée | Contact secondaire | DATA-B |'
        ].join('\n')}
      />
    )

    const table = screen.getAllByRole('table').at(-1)
    expect(table).toBeTruthy()
    if (!table) return
    const headers = within(table).getAllByRole('columnheader')
    const rows = within(table).getAllByRole('row')

    expect(headers.map((header) => header.textContent)).toEqual(['Rôle', 'Prénom(s)', 'Nom'])
    expect(rows).toHaveLength(4)
    expect(
      within(rows[1]!)
        .getAllByRole('cell')
        .map((cell) => cell.textContent)
    ).toEqual(['Partie adverse', 'Contact', 'DATA-A'])
    expect(
      within(rows[3]!)
        .getAllByRole('cell')
        .map((cell) => cell.textContent)
    ).toEqual(['Partie représentée', 'Contact secondaire', 'DATA-B'])
  })

  it('keeps showing the streaming assistant message while loading', () => {
    mockAiStore.commandLoading = true
    mockAiStore.streamingMessageId = 'stream-1'
    mockAiStore.messages = [
      { id: 'u1', role: 'user', text: 'Analyse le dossier' },
      { id: 'stream-1', role: 'assistant', text: 'Je regarde les documents…' }
    ]
    mockAiStore.reflections = [
      {
        id: 'r1',
        text: 'Je vais rechercher les contacts et leurs rôles dans les documents du dossier actif.'
      }
    ]

    render(<AiPage entityName={null} sampleDossierName={null} dossierId="dos-1" />)

    expect(screen.getByText('Je regarde les documents…')).toBeTruthy()
  })

  it('renders intermediate reflections inside the loading bubble', () => {
    mockAiStore.commandLoading = true
    mockAiStore.streamingMessageId = null
    mockAiStore.reflections = [
      {
        id: 'r1',
        text: 'Je commence par une première recherche avec des termes généraux liés aux contacts.'
      }
    ]

    render(<AiPage entityName={null} sampleDossierName={null} dossierId="dos-1" />)

    expect(
      screen.getByText(
        'Je commence par une première recherche avec des termes généraux liés aux contacts.'
      )
    ).toBeTruthy()
  })

  it('preserves single line returns inside a paragraph', () => {
    render(
      <MarkdownBubble
        text={[
          '7 contact(s):',
          ' • Contact DATA-A — partie adverse',
          ' •  — juridiction <contact@example.test>',
          ' • Conseil DATA-C — avocat de la partie adverse'
        ].join('\n')}
      />
    )

    const markdownRoot = document.querySelector('.ai-markdown')
    expect(markdownRoot).toBeTruthy()
    expect(markdownRoot?.textContent).toContain('7 contact(s):')
    expect(markdownRoot?.textContent).toContain('Contact DATA-A')
    expect(markdownRoot?.textContent).toContain('Conseil DATA-C')
  })

  it('renders html line breaks from model output as visual line breaks', () => {
    render(
      <MarkdownBubble
        text={[
          'Source\tInformations relevées',
          'FILE-001\t• Nom / Prénom : Person-A LASTNAME-A <br>• Date et lieu de naissance : 01 janvier 1970, CITY-A <br>• Adresse : ADDRESS-A'
        ].join('\n')}
      />
    )

    expect(document.body.textContent).not.toContain('<br>')
    expect(document.body.textContent).toContain('Nom / Prénom : Person-A LASTNAME-A')
    expect(document.body.textContent).toContain(
      'Date et lieu de naissance : 01 janvier 1970, CITY-A'
    )
    expect(document.body.textContent).toContain('Adresse : ADDRESS-A')
  })

  it('renders loosely formatted mixed markdown/tabular tables from model output', () => {
    render(
      <MarkdownBubble
        text={[
          'Document\tExtraits pertinents (avec marqueurs)\tInformations clés',
          'FILE-002\t"DESTINATAIRE : CONVOCATION ... LASTNAME-A"\tNom : Person-A LASTNAME-A',
          '"Adresse : ADDRESS-B"',
          '| FILE-003 | "Vos prénoms : Person-C Person-D Person-E" | Confirme le nom d\'usage : LASTNAME-B |'
        ].join('\n')}
      />
    )

    const table = screen.getAllByRole('table').at(-1)
    expect(table).toBeTruthy()
    if (!table) return
    const headers = within(table).getAllByRole('columnheader')
    const rows = within(table).getAllByRole('row')

    expect(headers.map((header) => header.textContent)).toEqual([
      'Document',
      'Extraits pertinents (avec marqueurs)',
      'Informations clés'
    ])
    expect(rows.length).toBeGreaterThanOrEqual(3)
    expect(table.textContent).toContain('FILE-002')
    expect(table.textContent).toContain('FILE-003')
    expect(table.textContent).toContain('Adresse : ADDRESS-B')
  })

  it('renders a markdown table when response starts with a streamed step prefix', () => {
    render(
      <MarkdownBubble
        text={[
          '[step:text] Voici les informations extraites :',
          '',
          '| Document | Extraits pertinents | Informations clés |',
          '|----------|---------------------|-------------------|',
          '| **FILE-004** | "Madame `Person-B` LASTNAME-A"<br/>"Adresse : ADDRESS-C" | Nom : Person-B LASTNAME-A<br/>Adresse : ADDRESS-C |'
        ].join('\n')}
      />
    )

    const table = screen.getAllByRole('table').at(-1)
    expect(table).toBeTruthy()
    if (!table) return
    expect(table.textContent).toContain('Document')
    expect(table.textContent).toContain('FILE-004')
    expect(table.textContent).toContain('Person-B LASTNAME-A')
  })

  it('keeps table columns stable when excerpt cells contain extra pipe characters', () => {
    render(
      <MarkdownBubble
        text={[
          '| Document | Extrait | Info |',
          '|----------|---------|------|',
          '| 1.pdf | "Adresse: 12 rue A | 75000 Paris" | OK |'
        ].join('\n')}
      />
    )

    const table = screen.getAllByRole('table').at(-1)
    expect(table).toBeTruthy()
    if (!table) return

    const rows = within(table).getAllByRole('row')
    const firstDataCells = within(rows[1]!).getAllByRole('cell')
    expect(firstDataCells).toHaveLength(3)
    expect(firstDataCells[1]?.textContent).toContain('Adresse: 12 rue A')
    expect(firstDataCells[2]?.textContent).toContain('75000 Paris')
  })

  it('renders boxed feedback logs as markdown table by stripping debug frame prefixes', () => {
    render(
      <MarkdownBubble
        text={[
          '╔══ AI FEEDBACK ═══',
          '║ Voici les informations :',
          '║ | Document | Extrait pertinent | Informations clés |',
          '║ |----------|-------------------|-------------------|',
          '║ | **FILE-005** | "Madame LASTNAME-A" | Nom complet : Person-A LASTNAME-A |',
          '╚══════════════════'
        ].join('\n')}
      />
    )

    const table = screen.getAllByRole('table').at(-1)
    expect(table).toBeTruthy()
    if (!table) return
    expect(table.textContent).toContain('Document')
    expect(table.textContent).toContain('FILE-005')
    expect(table.textContent).toContain('Person-A LASTNAME-A')
  })
})
