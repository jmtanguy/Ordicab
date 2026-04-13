/**
 * AiCommandPanel — natural language command input panel for the AI pipeline.
 *
 * Renders differently based on the active AI mode:
 *   - 'none'                  → informational message prompting the user to configure a mode.
 *   - cloud-managed modes     → informational message redirecting to the CLI tool.
 *   - 'local' / 'remote'      → the full textarea + submit form with feedback area.
 *
 * Interactions with aiStore:
 *   - executeCommand()        — called on form submit or Enter key.
 *   - resolveClarification()  — called when the user clicks a clarification option.
 *   - subscribeToIntentEvents() — registered in useEffect to keep lastIntent current
 *                                 via the ai:intent-received push channel.
 *
 * Feedback rendering priority (all exclusive):
 *   1. pendingClarification present → show question + option buttons.
 *   2. lastIntent.type === 'unknown' → show commandFeedback + hints.
 *   3. Any other successful intent   → show commandFeedback in green.
 *   4. commandError                  → show error in red.
 *
 * Mounted by: DomainDashboard (dossier grid and dossier detail views).
 * Reads from: aiStore
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AiCommandContext } from '@shared/types'

import { useAiStore } from '@renderer/stores/aiStore'

interface AiCommandPanelProps {
  context?: AiCommandContext
}

const CLOUD_MANAGED_MODES = ['claude-code', 'copilot', 'codex'] as const
type CloudMode = (typeof CLOUD_MANAGED_MODES)[number]

const CLOUD_MODE_LABELS: Record<CloudMode, string> = {
  'claude-code': 'Claude Code',
  copilot: 'Copilot',
  codex: 'Codex'
}

export function AiCommandPanel({ context }: AiCommandPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const [inputValue, setInputValue] = useState('')

  const settings = useAiStore((state) => state.settings)
  const commandLoading = useAiStore((state) => state.commandLoading)
  const commandFeedback = useAiStore((state) => state.commandFeedback)
  const commandError = useAiStore((state) => state.commandError)
  const lastIntent = useAiStore((state) => state.lastIntent)
  const pendingClarification = useAiStore((state) => state.pendingClarification)
  const executeCommand = useAiStore((state) => state.executeCommand)
  const resolveClarification = useAiStore((state) => state.resolveClarification)
  const subscribeToIntentEvents = useAiStore((state) => state.subscribeToIntentEvents)

  useEffect(() => {
    return subscribeToIntentEvents()
  }, [subscribeToIntentEvents])

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      const command = inputValue.trim()
      if (!command || commandLoading) return
      setInputValue('')
      void executeCommand(command, context)
    },
    [inputValue, commandLoading, executeCommand, context]
  )

  const handleOptionClick = useCallback(
    (option: string) => {
      void resolveClarification(option)
    },
    [resolveClarification]
  )

  const mode = settings?.mode ?? 'none'

  if (mode === 'none') {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 text-sm text-slate-400">
        {t('ai.panel.configure_message')}
      </div>
    )
  }

  if ((CLOUD_MANAGED_MODES as readonly string[]).includes(mode)) {
    const modeLabel = CLOUD_MODE_LABELS[mode as CloudMode] ?? mode
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 text-sm text-slate-400">
        {t('ai.panel.cloud_mode_message', { mode: modeLabel })}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <textarea
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            // Enter submits; Shift+Enter inserts a newline for multi-line commands.
            // The cast is needed because KeyboardEvent is not directly a FormEvent,
            // but handleSubmit only calls e.preventDefault() so the type is safe here.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void handleSubmit(e as unknown as React.FormEvent)
            }
          }}
          placeholder={t('ai.panel.placeholder')}
          disabled={commandLoading}
          rows={2}
          className="flex-1 resize-none rounded border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={commandLoading || !inputValue.trim()}
          className="self-end rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {commandLoading ? '...' : t('ai.panel.send')}
        </button>
      </form>

      {commandLoading && <div className="mt-2 text-xs text-slate-400">{t('ai.panel.loading')}</div>}

      {pendingClarification && (
        <div className="mt-3">
          <p className="text-sm text-slate-300">{pendingClarification.question}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {pendingClarification.options.map((option) => (
              <button
                key={option}
                onClick={() => handleOptionClick(option)}
                disabled={commandLoading}
                className="rounded border border-slate-600 bg-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-50"
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      )}

      {!pendingClarification && lastIntent?.type === 'unknown' && commandFeedback && (
        <div className="mt-3">
          <p className="text-sm text-slate-300">{commandFeedback}</p>
          <p className="mt-1 text-xs text-slate-500">{t('ai.panel.command_hints')}</p>
        </div>
      )}

      {!pendingClarification && lastIntent?.type !== 'unknown' && commandFeedback && (
        <div className="mt-3 text-sm text-emerald-400">{commandFeedback}</div>
      )}

      {commandError && <div className="mt-3 text-sm text-red-400">{commandError}</div>}
    </div>
  )
}
