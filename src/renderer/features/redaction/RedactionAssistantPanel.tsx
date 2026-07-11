/**
 * Left panel of the drafting workspace: the AI drafting assistant.
 * Tabs: Discussion (scoped chat) | Révisions (accept/reject per operation) |
 * Plan (document outline). Composer with quick actions on the selected
 * paragraph, tone/length chips and verified-citation helper.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SegmentedControl } from '../dossiers/sectionLayout'
import { MarkdownBubble } from '../ai/AiPage'
import { useAiStore } from '../../stores/aiStore'
import { useRedactionStore, type RedactionAssistantTab } from '../../stores/redactionStore'

type ToneChip = 'soutenu' | 'neutre' | 'concis'

// Same icons as the AI assistant (AiPage) so both composers read identically.
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

function IconStop(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="4" y="4" width="16" height="16" rx="2" />
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

interface QuickAction {
  id: string
  label: string
  prompt: (paragraphIndex: number, paragraphText: string) => string
}

function buildQuickActions(
  t: (key: string, options?: Record<string, unknown>) => string
): QuickAction[] {
  return [
    {
      id: 'rephrase',
      label: t('redaction.qa_rephrase', { defaultValue: 'Reformuler' }),
      prompt: (i) => `Reformule le paragraphe ${i} en conservant le sens et le registre juridique.`
    },
    {
      id: 'expand',
      label: t('redaction.qa_expand', { defaultValue: 'Développer' }),
      prompt: (i) =>
        `Développe le paragraphe ${i} en étoffant l'argumentation à partir des éléments du dossier.`
    },
    {
      id: 'shorten',
      label: t('redaction.qa_shorten', { defaultValue: 'Raccourcir' }),
      prompt: (i) => `Condense le paragraphe ${i} sans perdre d'argument.`
    },
    {
      id: 'fix',
      label: t('redaction.qa_fix', { defaultValue: 'Corriger' }),
      prompt: (i) => `Corrige l'orthographe, la grammaire et la ponctuation du paragraphe ${i}.`
    },
    {
      id: 'cite',
      label: t('redaction.qa_cite', { defaultValue: 'Citer' }),
      prompt: (i) =>
        `Recherche sur Légifrance/Judilibre les fondements juridiques pertinents pour le paragraphe ${i}, vérifie les références (legal_verify_references), puis insère la citation exacte à l'appui de ce paragraphe.`
    }
  ]
}

export function RedactionAssistantPanel({
  onRevealParagraph
}: {
  onRevealParagraph(index: number): void
}): React.JSX.Element {
  const { t } = useTranslation()
  const snapshot = useRedactionStore((state) => state.snapshot)
  const chat = useRedactionStore((state) => state.chat)
  const chatBusy = useRedactionStore((state) => state.chatBusy)
  const loading = useRedactionStore((state) => state.loading)
  const streamingText = useRedactionStore((state) => state.streamingText)
  const reflections = useRedactionStore((state) => state.reflections)
  const assistantTab = useRedactionStore((state) => state.assistantTab)
  const setAssistantTab = useRedactionStore((state) => state.setAssistantTab)
  const sendChat = useRedactionStore((state) => state.sendChat)
  const cancelChat = useRedactionStore((state) => state.cancelChat)
  const resetChat = useRedactionStore((state) => state.resetChat)
  const decideOp = useRedactionStore((state) => state.decideOp)
  const acceptAllOps = useRedactionStore((state) => state.acceptAllOps)
  const selectedParagraphIndex = useRedactionStore((state) => state.selectedParagraphIndex)

  // Same model choice as the main assistant (persisted per provider).
  const aiSettings = useAiStore((state) => state.settings)
  const loadAiSettings = useAiStore((state) => state.loadSettings)
  const aiMode = aiSettings?.mode ?? 'none'
  const availableModels = useAiStore((state) => state.availableModels)
  const selectedModel = useAiStore((state) => state.selectedModel)
  const setSelectedModel = useAiStore((state) => state.setSelectedModel)
  const checkConnection = useAiStore((state) => state.checkConnection)

  // The user may open this page without ever visiting the AI assistant —
  // load the AI settings here too, or the model selector never shows up.
  useEffect(() => {
    if (!aiSettings) void loadAiSettings()
  }, [aiSettings, loadAiSettings])

  useEffect(() => {
    if (aiMode === 'remote' && availableModels.length === 0) {
      void checkConnection({ mode: 'remote' })
    }
  }, [aiMode, availableModels.length, checkConnection])

  const [draft, setDraft] = useState('')
  const [tone, setTone] = useState<ToneChip | null>(null)
  const threadRef = useRef<HTMLDivElement | null>(null)
  const quickActions = useMemo(() => buildQuickActions(t), [t])

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight })
  }, [chat.length, streamingText, reflections.length])

  if (!snapshot) return <></>

  const pendingOps = snapshot.pendingOps
  const pendingCount = pendingOps.filter((op) => op.decision === 'keep_tracked').length

  const submit = (): void => {
    if (!draft.trim() || chatBusy) return
    const toneSuffix =
      tone === 'soutenu'
        ? ' (registre soutenu)'
        : tone === 'neutre'
          ? ' (ton neutre)'
          : tone === 'concis'
            ? ' (réponse et modifications concises)'
            : ''
    void sendChat(`${draft.trim()}${toneSuffix}`)
    setDraft('')
  }

  const runQuickAction = (action: QuickAction): void => {
    if (selectedParagraphIndex === null || chatBusy) return
    const paragraph = snapshot.paragraphs.find((p) => p.index === selectedParagraphIndex)
    void sendChat(action.prompt(selectedParagraphIndex, paragraph?.text ?? ''))
  }

  return (
    <aside className="flex w-105 shrink-0 flex-col overflow-hidden rounded-2xl border border-hairline bg-white shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-2">
        <SegmentedControl
          value={assistantTab}
          onChange={(tab) => setAssistantTab(tab as RedactionAssistantTab)}
          options={[
            {
              value: 'chat' as RedactionAssistantTab,
              label: t('redaction.tab_chat', { defaultValue: 'Discussion' })
            },
            {
              value: 'revisions' as RedactionAssistantTab,
              label:
                pendingCount > 0
                  ? t('redaction.tab_revisions_count', {
                      defaultValue: 'Révisions ({{count}})',
                      count: pendingCount
                    })
                  : t('redaction.tab_revisions', { defaultValue: 'Révisions' })
            },
            {
              value: 'outline' as RedactionAssistantTab,
              label: t('redaction.tab_outline', { defaultValue: 'Plan' })
            }
          ]}
        />
        {assistantTab === 'chat' && chat.length > 0 && (
          <button
            type="button"
            disabled={chatBusy}
            onClick={() => void resetChat()}
            title={t('redaction.new_chat_hint', {
              defaultValue:
                'Repartir d’une conversation vierge (le document et ses révisions sont conservés).'
            })}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-aurora px-3.5 py-1.5 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-aurora/90 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <IconPlus />
            {t('redaction.new_chat', { defaultValue: 'Nouvelle demande' })}
          </button>
        )}
      </div>

      {assistantTab === 'chat' && (
        <>
          <div ref={threadRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {chat.length === 0 && !chatBusy && (
              <div className="rounded-xl bg-parchment px-3 py-3 text-sm text-ink-muted">
                {t('redaction.chat_welcome', {
                  defaultValue:
                    'Décrivez ce que vous voulez rédiger ou modifier. L’assistant s’appuie sur les données du dossier (contacts, pièces, références, Légifrance) et propose ses modifications en révisions à accepter ou rejeter.'
                })}
              </div>
            )}
            {chat.map((message) => (
              <div
                key={message.id}
                className={
                  message.role === 'user'
                    ? 'ml-8 rounded-2xl rounded-br-sm bg-aurora/10 px-3 py-2 text-sm text-ink'
                    : message.role === 'error'
                      ? 'mr-4 rounded-2xl border border-destructive-border bg-destructive-tint px-3 py-2 text-sm text-destructive'
                      : 'mr-4 rounded-2xl rounded-bl-sm bg-parchment px-3 py-2 text-sm text-ink'
                }
              >
                {message.role === 'assistant' ? (
                  <MarkdownBubble text={message.text} />
                ) : (
                  <span className="whitespace-pre-wrap">{message.text}</span>
                )}
              </div>
            ))}
            {chatBusy && (
              <div className="mr-4 rounded-2xl rounded-bl-sm bg-parchment px-3 py-2 text-sm text-ink-muted">
                {streamingText ? (
                  <MarkdownBubble text={streamingText} />
                ) : reflections.length > 0 ? (
                  <span className="italic">{reflections[reflections.length - 1]}</span>
                ) : (
                  <span className="italic">
                    {t('redaction.chat_thinking', { defaultValue: 'Analyse du document…' })}
                  </span>
                )}
              </div>
            )}
          </div>

          {selectedParagraphIndex !== null && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-hairline px-3 py-2">
              <span className="text-xs text-ink-subtle">
                {t('redaction.qa_prefix', {
                  defaultValue: '§ {{index}} :',
                  index: selectedParagraphIndex
                })}
              </span>
              {quickActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  disabled={chatBusy}
                  onClick={() => runQuickAction(action)}
                  className="rounded-full border border-hairline px-2.5 py-1 text-xs text-ink-muted transition-colors hover:border-aurora hover:text-aurora disabled:opacity-50"
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}

          <div className="border-t border-hairline p-3">
            <div className="mb-2 flex items-center gap-1.5">
              {(['soutenu', 'neutre', 'concis'] as ToneChip[]).map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setTone(tone === chip ? null : chip)}
                  title={t('redaction.tone_hint', {
                    defaultValue: 'Ajouté comme consigne à la fin de votre message.'
                  })}
                  className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                    tone === chip
                      ? 'border-aurora bg-aurora/10 text-aurora'
                      : 'border-hairline text-ink-subtle hover:text-ink'
                  }`}
                >
                  {t(`redaction.tone_${chip}`, { defaultValue: chip })}
                </button>
              ))}
              <div className="flex-1" />
              {aiMode === 'remote' && availableModels.length > 0 && (
                <select
                  value={selectedModel ?? ''}
                  onChange={(event) => setSelectedModel(event.target.value)}
                  aria-label={t('redaction.model_label', { defaultValue: 'Modèle IA' })}
                  title={t('redaction.model_label', { defaultValue: 'Modèle IA' })}
                  className="max-w-44 truncate rounded-full border border-hairline bg-white px-2 py-0.5 text-xs text-ink-muted outline-none transition focus:border-aurora"
                >
                  {availableModels.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    submit()
                  }
                }}
                rows={2}
                placeholder={t('redaction.chat_placeholder', {
                  defaultValue: 'Rédiger, modifier, citer… (Entrée pour envoyer)'
                })}
                className="min-h-11 flex-1 resize-y rounded-xl border border-hairline bg-white px-3 py-2 text-sm text-ink focus:border-aurora focus:outline-none focus:ring-2 focus:ring-aurora/35"
              />
              {chatBusy ? (
                <button
                  type="button"
                  onClick={() => void cancelChat()}
                  className="ai-send-btn ai-send-btn--stop"
                  title={t('redaction.chat_stop', { defaultValue: 'Interrompre' })}
                >
                  <IconStop />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!draft.trim()}
                  onClick={submit}
                  className="ai-send-btn"
                  title={t('redaction.chat_send', { defaultValue: 'Envoyer' })}
                >
                  <IconSend />
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {assistantTab === 'revisions' && (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {pendingOps.length === 0 ? (
            <p className="rounded-xl bg-parchment px-3 py-3 text-sm text-ink-muted">
              {t('redaction.revisions_empty', {
                defaultValue:
                  'Aucune modification pour l’instant. Les propositions de l’IA et vos retouches apparaîtront ici.'
              })}
            </p>
          ) : (
            <>
              {pendingCount > 1 && (
                <button
                  type="button"
                  disabled={chatBusy || loading}
                  onClick={() => void acceptAllOps()}
                  className="mb-3 w-full rounded-full border border-aurora/40 px-3 py-1.5 text-sm text-aurora transition-colors hover:bg-aurora/10"
                >
                  {t('redaction.revisions_accept_all', {
                    defaultValue: 'Tout accepter ({{count}})',
                    count: pendingCount
                  })}
                </button>
              )}
              <ul className="space-y-2">
                {pendingOps.map((op) => {
                  const targetIndex = op.index ?? op.anchorIndex ?? 0
                  return (
                    <li
                      key={op.opId}
                      className="rounded-xl border border-hairline bg-parchment-bright p-3"
                    >
                      <button
                        type="button"
                        onClick={() => onRevealParagraph(targetIndex)}
                        className="flex w-full items-center justify-between text-left"
                      >
                        <span className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                          {t(`redaction.op_${op.op}`, { defaultValue: op.op })} · § {targetIndex}
                          {op.authorKind === 'user'
                            ? ` · ${t('redaction.op_author_user', { defaultValue: 'vous' })}`
                            : ''}
                        </span>
                        <span
                          className={
                            op.decision === 'accept'
                              ? 'rounded-full bg-success-tint px-2 py-0.5 text-xs text-success'
                              : op.decision === 'reject'
                                ? 'rounded-full bg-destructive-tint px-2 py-0.5 text-xs text-destructive'
                                : 'rounded-full bg-warning-tint px-2 py-0.5 text-xs text-warning'
                          }
                        >
                          {op.decision === 'accept'
                            ? t('redaction.decision_accepted', { defaultValue: 'Acceptée' })
                            : op.decision === 'reject'
                              ? t('redaction.decision_rejected', { defaultValue: 'Rejetée' })
                              : t('redaction.decision_pending', { defaultValue: 'En révision' })}
                        </span>
                      </button>
                      {op.text && (
                        <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-ink">
                          {op.text}
                        </p>
                      )}
                      {op.rationale && (
                        <p className="mt-1 text-xs italic text-ink-muted">{op.rationale}</p>
                      )}
                      {op.legalRefs && op.legalRefs.length > 0 && (
                        <p className="mt-1 text-xs text-aurora">{op.legalRefs.join(' · ')}</p>
                      )}
                      {op.decision === 'keep_tracked' && (
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            disabled={chatBusy || loading}
                            onClick={() => void decideOp(op.opId, 'accept')}
                            className="rounded-full bg-success-tint px-3 py-1 text-xs font-medium text-success transition-colors hover:brightness-95"
                          >
                            {t('redaction.decision_accept', { defaultValue: 'Accepter' })}
                          </button>
                          <button
                            type="button"
                            disabled={chatBusy || loading}
                            onClick={() => void decideOp(op.opId, 'reject')}
                            className="rounded-full bg-destructive-tint px-3 py-1 text-xs font-medium text-destructive transition-colors hover:brightness-95"
                          >
                            {t('redaction.decision_reject', { defaultValue: 'Rejeter' })}
                          </button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      )}

      {assistantTab === 'outline' && (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {snapshot.outline.length === 0 ? (
            <p className="rounded-xl bg-parchment px-3 py-3 text-sm text-ink-muted">
              {t('redaction.outline_empty', {
                defaultValue:
                  'Aucun titre détecté. Utilisez les styles Titre de Word pour structurer le document.'
              })}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {snapshot.outline.map((entry) => (
                <li key={`${entry.paragraphIndex}-${entry.text}`}>
                  <button
                    type="button"
                    onClick={() => onRevealParagraph(entry.paragraphIndex)}
                    style={{ paddingLeft: `${8 + Math.max(0, entry.level - 1) * 14}px` }}
                    className="w-full truncate rounded-lg py-1.5 pr-2 text-left text-sm text-ink-muted transition-colors hover:bg-aurora-soft/40 hover:text-ink"
                  >
                    {entry.text}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  )
}
