/**
 * AiPage — full-height chat UI for the AI Assistant tab.
 *
 * Design inspired by Claude, ChatGPT, and OpenCode:
 *   - Centered message column (max-w-2xl) with avatar indicators
 *   - User bubbles right-aligned with aurora accent tint
 *   - Assistant bubbles left-aligned, glass-card style
 *   - Elevated rounded input bar at bottom (send button inside)
 *   - Animated typing dots for loading state
 *   - Welcome screen with suggested prompts on empty state
 *
 * Mounted by: DomainDashboard (AI Assistant tab).
 * Reads from: aiStore (messages, commandLoading, availableModels, selectedModel…)
 */
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAiStore } from '@renderer/stores/aiStore'
import { useDossierStore } from '@renderer/stores/dossierStore'
import { useUiStore } from '@renderer/stores/uiStore'
import { useToast } from '@renderer/contexts/ToastContext'
import { getRemoteToolModelDetails, inferRemoteProviderKind } from '@shared/ai/remoteProviders'
import { AiDialog } from '../settings/AiSettings'
import { DelegatedReference } from '../delegated/DelegatedReference'

const CLOUD_MANAGED_MODES = ['claude-code', 'copilot', 'codex'] as const
const AI_LAST_DOSSIER_STORAGE_KEY = 'ordicab.ai.lastDossierId'

function readStoredPreference(key: string): string | null {
  if (typeof window === 'undefined') return null

  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStoredPreference(key: string, value: string | null): void {
  if (typeof window === 'undefined') return

  try {
    if (value) {
      window.localStorage.setItem(key, value)
    } else {
      window.localStorage.removeItem(key)
    }
  } catch {
    // Ignore storage errors in renderer-only preference persistence.
  }
}

interface AiPageProps {
  entityName: string | null
  sampleDossierName: string | null
  dossierId?: string
}

// ── Icons ──────────────────────────────────────────────────────────────────

function IconCopy(): React.JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function IconCheck(): React.JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function IconSend(): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  )
}

function IconSparkle(): React.JSX.Element {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z" />
      <path d="M5 3l.7 2.3L8 6l-2.3.7L5 9l-.7-2.3L2 6l2.3-.7z" />
      <path d="M19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z" />
    </svg>
  )
}

function IconFolder(): React.JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function IconPlus(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function IconStop(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  )
}

function IconInfo(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  )
}

// ── Copy button ────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  const handleCopy = (): void => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <button onClick={handleCopy} title={copied ? 'Copié !' : 'Copier'} className="ai-copy-btn">
      {copied ? <IconCheck /> : <IconCopy />}
    </button>
  )
}

// ── Typing dots loader ─────────────────────────────────────────────────────

function TypingDots(): React.JSX.Element {
  return (
    <div className="ai-typing-dots">
      <span />
      <span />
      <span />
    </div>
  )
}

// ── Lightweight markdown renderer ──────────────────────────────────────────

// Optimized regex: compile once, use non-capturing groups to reduce memory overhead
const INLINE_MARKDOWN_PATTERN =
  /(?:\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(?:`([^`]+)`)|(?:\*\*([^*]+)\*\*)|(?:__([^_]+)__)|(?:\*([^*\n]+)\*)|(?:_([^_\n]+)_)/g

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = INLINE_MARKDOWN_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }

    const key = `${match.index}-${match[0]}`
    const [, linkLabel, linkUrl, inlineCode, boldA, boldB, italicA, italicB] = match

    if (linkLabel && linkUrl) {
      nodes.push(
        <a key={key} href={linkUrl} target="_blank" rel="noreferrer">
          {linkLabel}
        </a>
      )
    } else if (inlineCode) {
      nodes.push(<code key={key}>{inlineCode}</code>)
    } else if (boldA ?? boldB) {
      nodes.push(<strong key={key}>{boldA ?? boldB}</strong>)
    } else if (italicA ?? italicB) {
      nodes.push(<em key={key}>{italicA ?? italicB}</em>)
    }

    lastIndex = INLINE_MARKDOWN_PATTERN.lastIndex
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }

  return nodes
}

function renderParagraphLines(lines: string[]): React.ReactNode[] {
  return lines.flatMap((line, index) => {
    const nodes = renderInlineMarkdown(line)
    if (index === lines.length - 1) {
      return nodes
    }
    return [...nodes, <br key={`md-br-${index}`} />]
  })
}

function decodeHtmlEntities(text: string): string {
  if (typeof window === 'undefined') {
    return text
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
  }

  const textarea = window.document.createElement('textarea')
  textarea.innerHTML = text
  return textarea.value
}

function normalizeHtmlLikeText(text: string): string {
  const withoutStepPrefix = text.replace(/^\s*\[step:[^\]]+\]\s*/i, '')
  const withEscapedLines = withoutStepPrefix.replace(/\\n/g, '\n')
  const withLineBreaks = withEscapedLines.replace(/<br\s*\/?>/gi, '\n')
  const withoutDebugFrame = withLineBreaks
    .split('\n')
    .map((line) => line.replace(/^\s*║\s?/, ''))
    .filter((line) => !/^\s*[╔╚╠╟╒╘].*$/.test(line.trim()))
    .join('\n')

  return decodeHtmlEntities(withoutDebugFrame)
}

function parseMarkdownTableCells(line: string): string[] {
  const trimmedLine = line.trim()
  const content = trimmedLine.replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let current = ''
  let escaping = false

  for (const char of content) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }

    if (char === '\\') {
      escaping = true
      continue
    }

    if (char === '|') {
      cells.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  if (escaping) {
    current += '\\'
  }

  cells.push(current.trim())
  return cells
}

function isMarkdownTableRow(line: string): boolean {
  const trimmedLine = line.trim()
  // Must have at least 2 pipe-separated cells to be a valid table row
  return trimmedLine.includes('|') && /^\|?[^|]+\|[^|]+(\|[^|]*)*\|?$/.test(trimmedLine)
}

function parseMarkdownTableAlignment(line: string): Array<'left' | 'center' | 'right'> | null {
  const cells = parseMarkdownTableCells(line)
  if (cells.length === 0) return null

  const alignments = cells.map((cell) => {
    const normalized = cell.trim()
    if (!/^:?-{3,}:?$/.test(normalized)) {
      return null
    }
    if (normalized.startsWith(':') && normalized.endsWith(':')) return 'center'
    if (normalized.endsWith(':')) return 'right'
    return 'left'
  })

  if (alignments.some((alignment) => alignment === null)) {
    return null
  }

  return alignments as Array<'left' | 'center' | 'right'>
}

function parseLooseTableCells(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  if (trimmed.includes('\t')) {
    const cells = trimmed.split(/\t+/).map((cell) => cell.trim())
    return cells.length >= 2 ? cells : null
  }

  if (isMarkdownTableRow(trimmed)) {
    return parseMarkdownTableCells(trimmed)
  }

  return null
}

function normalizeTableRow(cells: string[], columnCount: number): string[] {
  if (cells.length === columnCount) return cells

  if (cells.length < columnCount) {
    return [...cells, ...new Array(columnCount - cells.length).fill('')]
  }

  const head = cells.slice(0, Math.max(0, columnCount - 1))
  const tail = cells.slice(Math.max(0, columnCount - 1)).join(' | ')
  return [...head, tail]
}

export function MarkdownBubble({ text }: { text: string }): React.JSX.Element {
  const MAX_COMPLEX_MARKDOWN_CHARS = 200_000
  const MAX_COMPLEX_MARKDOWN_LINES = 5_000

  // Memoize normalization to avoid re-parsing HTML entities on every render
  const normalizedText = React.useMemo(() => normalizeHtmlLikeText(text), [text])
  const lines = normalizedText.replace(/\r\n/g, '\n').split('\n')

  if (
    normalizedText.length > MAX_COMPLEX_MARKDOWN_CHARS ||
    lines.length > MAX_COMPLEX_MARKDOWN_LINES
  ) {
    return (
      <div className="ai-markdown">
        <pre className="ai-markdown-pre">
          <code>{normalizedText}</code>
        </pre>
      </div>
    )
  }

  const blocks: React.JSX.Element[] = []
  let index = 0
  let key = 0

  const nextKey = (): string => `md-${key++}`

  while (index < lines.length) {
    const line = lines[index] ?? ''

    if (!line.trim()) {
      index += 1
      continue
    }

    const fencedCodeMatch = line.match(/^```(\S+)?\s*$/)
    if (fencedCodeMatch) {
      const language = fencedCodeMatch[1]
      const codeLines: string[] = []
      index += 1

      while (index < lines.length && !/^```/.test(lines[index] ?? '')) {
        codeLines.push(lines[index] ?? '')
        index += 1
      }

      if (index < lines.length) {
        index += 1
      }

      blocks.push(
        <pre key={nextKey()} className="ai-markdown-pre">
          <code className={language ? `language-${language}` : undefined}>
            {codeLines.join('\n')}
          </code>
        </pre>
      )
      continue
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      const [, hashes = '', heading = ''] = headingMatch
      const level = Math.min(hashes.length, 6)
      const HeadingTag = `h${level}` as keyof React.JSX.IntrinsicElements
      blocks.push(
        <HeadingTag key={nextKey()} className="ai-markdown-heading">
          {renderInlineMarkdown(heading)}
        </HeadingTag>
      )
      index += 1
      continue
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index] ?? '')) {
        quoteLines.push((lines[index] ?? '').replace(/^>\s?/, ''))
        index += 1
      }

      blocks.push(
        <blockquote key={nextKey()} className="ai-markdown-blockquote">
          {quoteLines.map((quoteLine, quoteIndex) => (
            <p key={`${nextKey()}-${quoteIndex}`}>{renderInlineMarkdown(quoteLine)}</p>
          ))}
        </blockquote>
      )
      continue
    }

    const nextLine = lines[index + 1] ?? ''
    const tableAlignments =
      isMarkdownTableRow(line) && nextLine ? parseMarkdownTableAlignment(nextLine) : null
    if (tableAlignments) {
      const headerCells = parseMarkdownTableCells(line)
      const rows: string[][] = []
      index += 2

      while (index < lines.length && isMarkdownTableRow(lines[index] ?? '')) {
        rows.push(
          normalizeTableRow(parseMarkdownTableCells(lines[index] ?? ''), headerCells.length)
        )
        index += 1
      }

      blocks.push(
        <div key={nextKey()} className="ai-markdown-table-wrap">
          <table className="ai-markdown-table">
            <thead>
              <tr>
                {headerCells.map((cell, cellIndex) => (
                  <th
                    key={`header-${cellIndex}`}
                    scope="col"
                    style={{ textAlign: tableAlignments[cellIndex] ?? 'left' }}
                  >
                    {renderInlineMarkdown(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  {headerCells.map((_, cellIndex) => (
                    <td
                      key={`cell-${rowIndex}-${cellIndex}`}
                      style={{ textAlign: tableAlignments[cellIndex] ?? 'left' }}
                    >
                      {renderInlineMarkdown(row[cellIndex] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }

    const looseHeaderCells = parseLooseTableCells(line)
    const looseNextCells = parseLooseTableCells(nextLine)
    const canStartLooseTable =
      Boolean(looseHeaderCells && looseHeaderCells.length >= 2) &&
      Boolean(looseNextCells && looseNextCells.length >= 2)

    if (canStartLooseTable && looseHeaderCells) {
      const headerCells = looseHeaderCells
      const rows: string[][] = []
      index += 1

      while (index < lines.length) {
        const currentLine = lines[index] ?? ''
        const trimmedCurrentLine = currentLine.trim()
        if (!trimmedCurrentLine) break

        const parsedCells = parseLooseTableCells(currentLine)
        if (parsedCells && parsedCells.length >= 2) {
          rows.push(normalizeTableRow(parsedCells, headerCells.length))
          index += 1
          continue
        }

        // Only allow continuation lines if the last row exists AND has all columns
        if (rows.length > 0) {
          const lastRow = rows[rows.length - 1]
          // Ensure last row has all columns before adding continuation
          if (lastRow && lastRow.length === headerCells.length) {
            const continuation = trimmedCurrentLine.replace(/^\|+/, '').replace(/\|+$/, '').trim()
            if (continuation) {
              const lastCellIndex = Math.max(0, headerCells.length - 1)
              lastRow[lastCellIndex] = `${lastRow[lastCellIndex] ?? ''} ${continuation}`.trim()
              index += 1
              continue
            }
          }
        }

        break
      }

      blocks.push(
        <div key={nextKey()} className="ai-markdown-table-wrap">
          <table className="ai-markdown-table">
            <thead>
              <tr>
                {headerCells.map((cell, cellIndex) => (
                  <th key={`loose-header-${cellIndex}`} scope="col" style={{ textAlign: 'left' }}>
                    {renderInlineMarkdown(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`loose-row-${rowIndex}`}>
                  {headerCells.map((_, cellIndex) => (
                    <td key={`loose-cell-${rowIndex}-${cellIndex}`} style={{ textAlign: 'left' }}>
                      {renderInlineMarkdown(row[cellIndex] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }

    const unorderedMatch = line.match(/^\s*[-*+]\s+(.+)$/)
    const orderedMatch = line.match(/^\s*\d+\.\s+(.+)$/)
    if (unorderedMatch || orderedMatch) {
      const isOrdered = Boolean(orderedMatch)
      const items: string[] = []

      while (index < lines.length) {
        const currentLine = lines[index] ?? ''
        const currentMatch = isOrdered
          ? currentLine.match(/^\s*\d+\.\s+(.+)$/)
          : currentLine.match(/^\s*[-*+]\s+(.+)$/)

        if (!currentMatch) break

        items.push(currentMatch[1] ?? '')
        index += 1
      }

      const ListTag = isOrdered ? 'ol' : 'ul'
      blocks.push(
        <ListTag key={nextKey()} className="ai-markdown-list">
          {items.map((item) => (
            <li key={nextKey()}>{renderInlineMarkdown(item)}</li>
          ))}
        </ListTag>
      )
      continue
    }

    const paragraphLines: string[] = []
    while (index < lines.length) {
      const currentLine = lines[index] ?? ''
      if (
        !currentLine.trim() ||
        /^```/.test(currentLine) ||
        /^(#{1,6})\s+/.test(currentLine) ||
        /^>\s?/.test(currentLine) ||
        (isMarkdownTableRow(currentLine) &&
          Boolean(parseMarkdownTableAlignment(lines[index + 1] ?? ''))) ||
        (Boolean(parseLooseTableCells(currentLine)) &&
          Boolean(parseLooseTableCells(lines[index + 1] ?? ''))) ||
        /^\s*[-*+]\s+/.test(currentLine) ||
        /^\s*\d+\.\s+/.test(currentLine)
      ) {
        break
      }

      paragraphLines.push(currentLine)
      index += 1
    }

    blocks.push(
      <p key={nextKey()} className="ai-markdown-paragraph">
        {renderParagraphLines(paragraphLines)}
      </p>
    )
  }

  return <div className="ai-markdown">{blocks}</div>
}

// ── Empty / welcome state ──────────────────────────────────────────────────

const SUGGESTED_PROMPTS = [
  'Extraire les dates clés du document',
  'Ajouter un contact avec ses informations',
  'Générer un document depuis un modèle'
]

function WelcomeScreen({ onPrompt }: { onPrompt: (p: string) => void }): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="ai-welcome">
      <div className="ai-welcome-icon">
        <IconSparkle />
      </div>
      <h2 className="ai-welcome-title">{t('ai.page.welcome_title')}</h2>
      <p className="ai-welcome-subtitle">{t('ai.page.welcome_subtitle')}</p>
      <div className="ai-suggestions">
        {SUGGESTED_PROMPTS.map((p) => (
          <button key={p} className="ai-suggestion-chip" onClick={() => onPrompt(p)}>
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export function AiPage({
  entityName,
  sampleDossierName,
  dossierId
}: AiPageProps): React.JSX.Element {
  const { t } = useTranslation()
  const mode = useAiStore((s) => s.settings?.mode ?? 'none')
  const messages = useAiStore((s) => s.messages)
  const commandLoading = useAiStore((s) => s.commandLoading)
  const pendingClarification = useAiStore((s) => s.pendingClarification)
  const availableModels = useAiStore((s) => s.availableModels)
  const selectedModel = useAiStore((s) => s.selectedModel)
  const executeCommand = useAiStore((s) => s.executeCommand)
  const cancelCommand = useAiStore((s) => s.cancelCommand)
  const resolveClarification = useAiStore((s) => s.resolveClarification)
  const subscribeToIntentEvents = useAiStore((s) => s.subscribeToIntentEvents)
  const subscribeToTextTokens = useAiStore((s) => s.subscribeToTextTokens)
  const subscribeToReflections = useAiStore((s) => s.subscribeToReflections)
  const reflections = useAiStore((s) => s.reflections)
  const streamingMessageId = useAiStore((s) => s.streamingMessageId)
  const checkConnection = useAiStore((s) => s.checkConnection)
  const setSelectedModel = useAiStore((s) => s.setSelectedModel)
  const setActiveDossierId = useAiStore((s) => s.setActiveDossierId)
  const loadSettings = useAiStore((s) => s.loadSettings)
  const resetConversation = useAiStore((s) => s.resetConversation)
  const settings = useAiStore((s) => s.settings)
  const saveSettings = useAiStore((s) => s.saveSettings)

  const dossiers = useDossierStore((s) => s.dossiers)
  const openFolder = useUiStore((state) => state.openFolder)
  const { showToast } = useToast()

  // Dossier context for the AI — initialized from the active dashboard dossier,
  // but overrideable by the user directly in the AI panel.
  const [selectedDossierId, setSelectedDossierId] = useState<string | null>(
    () => dossierId ?? readStoredPreference(AI_LAST_DOSSIER_STORAGE_KEY)
  )
  const availableDossierIds = dossiers.map((d) => d.id)
  const resolvedSelectedDossierId =
    selectedDossierId && availableDossierIds.includes(selectedDossierId) ? selectedDossierId : null

  const [input, setInput] = useState('')
  const [aiDialogOpen, setAiDialogOpen] = useState(false)
  const [showModelInfo, setShowModelInfo] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lastSyncedDossierIdRef = useRef<string | null>(dossierId ?? null)

  useEffect(() => {
    if (!settings) void loadSettings()
  }, [settings, loadSettings])

  useEffect(() => {
    if (!dossierId) {
      lastSyncedDossierIdRef.current = null
      return
    }
    if (!dossiers.some((dossier) => dossier.id === dossierId)) return
    if (lastSyncedDossierIdRef.current === dossierId) return

    lastSyncedDossierIdRef.current = dossierId

    const timer = setTimeout(() => {
      setSelectedDossierId((current) => (current === dossierId ? current : dossierId))
    }, 0)

    return () => {
      clearTimeout(timer)
    }
  }, [dossierId, dossiers])

  useEffect(() => {
    writeStoredPreference(AI_LAST_DOSSIER_STORAGE_KEY, resolvedSelectedDossierId)
  }, [resolvedSelectedDossierId])

  useEffect(() => {
    setActiveDossierId(resolvedSelectedDossierId)
  }, [resolvedSelectedDossierId, setActiveDossierId])

  useEffect(() => subscribeToIntentEvents(), [subscribeToIntentEvents])
  useEffect(() => subscribeToTextTokens(), [subscribeToTextTokens])
  useEffect(() => subscribeToReflections(), [subscribeToReflections])

  useEffect(() => {
    if ((mode === 'local' || mode === 'remote') && availableModels.length === 0) {
      void checkConnection({ mode })
    }
  }, [mode, availableModels.length, checkConnection])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, commandLoading, reflections.length])

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`
  }, [input])

  if ((CLOUD_MANAGED_MODES as readonly string[]).includes(mode)) {
    return <DelegatedReference entityName={entityName} sampleDossierName={sampleDossierName} />
  }

  if (mode === 'none') {
    return (
      <div className="ai-configure-screen">
        <div className="ai-welcome-icon">
          <IconSparkle />
        </div>
        <p className="ai-configure-text">{t('ai.page.empty_configure')}</p>
        <button onClick={() => setAiDialogOpen(true)} className="ai-configure-btn">
          {t('ai.page.configure_button')}
        </button>
        <AiDialog open={aiDialogOpen} onClose={() => setAiDialogOpen(false)} />
      </div>
    )
  }

  const handleSend = (text?: string): void => {
    const trimmed = (text ?? input).trim()
    if (!trimmed || commandLoading) return
    setInput('')
    void executeCommand(trimmed, { dossierId: resolvedSelectedDossierId ?? undefined })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleNewConversation = (): void => {
    setInput('')
    void resetConversation()
  }

  const selectedRemoteModelDetails =
    mode === 'remote' && selectedModel
      ? getRemoteToolModelDetails(
          settings?.remoteProviderKind ?? inferRemoteProviderKind(settings?.remoteProvider),
          selectedModel
        )
      : null

  const hasModelInfoToShow = !!(
    selectedRemoteModelDetails &&
    (selectedRemoteModelDetails.comment ||
      selectedRemoteModelDetails.costPerformance ||
      selectedRemoteModelDetails.pricing)
  )

  const costPerformanceLabel = (value: 'low' | 'balanced' | 'high'): string => {
    if (value === 'low') return 'Low cost'
    if (value === 'high') return 'High performance'
    return 'Balanced'
  }

  return (
    <div className="ai-page">
      {/* ── Messages area ── */}
      <div className="ai-messages-area">
        <div className="ai-messages-column">
          <div className="mb-4 flex justify-end">
            <button
              onClick={handleNewConversation}
              disabled={commandLoading}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <IconPlus />
              {t('ai.page.new_conversation')}
            </button>
          </div>

          {messages.length === 0 && !commandLoading && (
            <WelcomeScreen onPrompt={(p) => handleSend(p)} />
          )}

          {messages.map((msg) => {
            if (msg.role === 'user') {
              return (
                <div key={msg.id} className="ai-row ai-row--user">
                  <div className="ai-bubble-wrapper ai-bubble-wrapper--user group">
                    <CopyButton text={msg.text} />
                    <div className="ai-bubble ai-bubble--user">
                      <MarkdownBubble text={msg.text} />
                    </div>
                  </div>
                </div>
              )
            }

            if (msg.role === 'error') {
              return (
                <div key={msg.id} className="ai-row ai-row--assistant">
                  <div className="ai-avatar ai-avatar--error">!</div>
                  <div className="ai-bubble ai-bubble--error">{msg.text}</div>
                </div>
              )
            }

            // assistant
            const buildDebugText = (): string => {
              return msg.systemPrompt ?? ''
            }

            return (
              <div key={msg.id} className="ai-row ai-row--assistant">
                <button
                  className="ai-avatar ai-avatar--assistant ai-avatar--copyable"
                  title={t('ai.page.debug_copy_title')}
                  aria-label={t('ai.page.debug_copy_title')}
                  onClick={() => void navigator.clipboard.writeText(buildDebugText())}
                >
                  <IconSparkle />
                </button>
                <div className="ai-bubble-wrapper group">
                  <div className="ai-bubble ai-bubble--assistant">
                    <MarkdownBubble text={msg.text} />

                    {msg.filePath && (
                      <div className="ai-file-action">
                        <button
                          onClick={() => {
                            const path = msg.filePath
                            if (!path) return
                            void openFolder(path).then((result) => {
                              if (!result.success) {
                                showToast(result.error, 'error')
                              }
                            })
                          }}
                          className="ai-open-file-btn"
                        >
                          <IconFolder />
                          {t('generate.openFile')}
                        </button>
                      </div>
                    )}

                    {pendingClarification && msg.id === messages[messages.length - 1]?.id && (
                      <div className="ai-clarification">
                        <div className="ai-clarification-options">
                          {pendingClarification.options.map((option, idx) => (
                            <button
                              key={idx}
                              onClick={() => void resolveClarification(option)}
                              className="ai-option-chip"
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <CopyButton text={msg.text} />
                </div>
              </div>
            )
          })}

          {commandLoading && !streamingMessageId && (
            <div className="ai-row ai-row--assistant">
              <div className="ai-avatar ai-avatar--assistant">
                <IconSparkle />
              </div>
              <div className="ai-bubble ai-bubble--loading">
                {reflections.length > 0 &&
                  (() => {
                    const latest = reflections[reflections.length - 1]
                    if (!latest) return null
                    return (
                      <div className="ai-loading-reflections">
                        <div
                          key={latest.id}
                          className="ai-loading-reflection ai-loading-reflection--active"
                        >
                          <div className="ai-reflection-header">{t('ai.panel.reflection')}</div>
                          <MarkdownBubble text={latest.text} />
                        </div>
                      </div>
                    )
                  })()}
                <TypingDots />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* ── Input bar ── */}
      <div className="ai-input-bar">
        <div className="ai-input-column">
          <div className="ai-input-box">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={commandLoading}
              rows={1}
              placeholder={t('ai.panel.placeholder')}
              className="ai-textarea"
            />
            {commandLoading ? (
              <button
                onClick={() => cancelCommand()}
                className="ai-send-btn ai-send-btn--stop"
                title={t('ai.panel.stop', 'Interrompre')}
              >
                <IconStop />
              </button>
            ) : (
              <button
                onClick={() => handleSend()}
                disabled={!input.trim()}
                className="ai-send-btn"
                title={t('ai.panel.send')}
              >
                <IconSend />
              </button>
            )}
          </div>

          {(mode === 'remote' ||
            dossiers.length > 0 ||
            (mode === 'local' && availableModels.length > 0)) && (
            <div className="flex items-center gap-3 rounded-xl border border-slate-700/40 bg-slate-800/40 px-3 py-1.5">
              <div className="flex w-full min-w-0 items-center gap-3">
                {dossiers.length > 0 && (
                  <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
                    <span className="ai-model-label shrink-0">
                      {t('ai.page.dossier_selector_label', 'Dossier')}
                    </span>
                    <select
                      value={resolvedSelectedDossierId ?? ''}
                      onChange={(e) => setSelectedDossierId(e.target.value || null)}
                      className="ai-model-select"
                    >
                      <option value="" className="bg-slate-900 text-slate-400">
                        {t('ai.page.dossier_selector_none', '— aucun —')}
                      </option>
                      {dossiers.map((d) => (
                        <option key={d.id} value={d.id} className="bg-slate-900 text-slate-300">
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {(mode === 'local' || mode === 'remote') && availableModels.length > 0 && (
                  <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
                    <span className="ai-model-label shrink-0">
                      {t('ai.page.model_selector_label')}
                    </span>
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="relative flex items-center gap-1">
                        <select
                          value={selectedModel ?? ''}
                          onChange={(e) => {
                            setSelectedModel(e.target.value)
                            setShowModelInfo(false)
                          }}
                          className="ai-model-select"
                        >
                          {availableModels.map((m) => (
                            <option key={m} value={m} className="bg-slate-900 text-slate-300">
                              {m}
                            </option>
                          ))}
                        </select>
                        {hasModelInfoToShow && (
                          <button
                            type="button"
                            onClick={() => setShowModelInfo((v) => !v)}
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-700/70 text-slate-300 transition hover:bg-slate-700/50"
                            title={t('ai.page.model_info', 'Model info')}
                            aria-label={t('ai.page.model_info', 'Model info')}
                          >
                            <IconInfo />
                          </button>
                        )}
                        {hasModelInfoToShow && showModelInfo && selectedRemoteModelDetails && (
                          <div className="absolute bottom-9 right-0 z-20 w-72 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] text-slate-200 shadow-xl">
                            {selectedRemoteModelDetails.costPerformance && (
                              <div className="font-medium text-slate-100">
                                {costPerformanceLabel(selectedRemoteModelDetails.costPerformance)}
                              </div>
                            )}
                            {selectedRemoteModelDetails.comment && (
                              <div className="mt-1 text-slate-300">
                                {selectedRemoteModelDetails.comment}
                              </div>
                            )}
                            {selectedRemoteModelDetails.pricing && (
                              <div className="mt-2 border-t border-slate-700/70 pt-2 text-slate-400">
                                {t('ai.page.model_pricing', {
                                  input:
                                    selectedRemoteModelDetails.pricing.inputEurPer10k.toFixed(3),
                                  output:
                                    selectedRemoteModelDetails.pricing.outputEurPer10k.toFixed(3)
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {mode === 'remote' && (
                  <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
                    <span className="ai-model-label shrink-0">{t('ai_settings.pii_label')}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={settings?.piiEnabled ?? true}
                      onClick={() =>
                        void saveSettings({
                          mode: 'remote',
                          piiEnabled: !(settings?.piiEnabled ?? true)
                        })
                      }
                      className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${(settings?.piiEnabled ?? true) ? 'bg-sky-500' : 'bg-slate-600'}`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${(settings?.piiEnabled ?? true) ? 'translate-x-3' : 'translate-x-0'}`}
                      />
                    </button>
                  </div>
                )}

                <p className="ai-hint flex flex-1 items-center justify-center text-center">
                  {t('ai.page.send_hint')}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
