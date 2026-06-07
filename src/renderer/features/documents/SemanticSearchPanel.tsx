import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { SemanticSearchHit } from '@shared/types'

import { useDocumentStore } from '@renderer/stores'
import { Button, Card } from '@renderer/components/ui'
import { SearchField, SectionHeader } from '@renderer/features/dossiers/sectionLayout'

interface SemanticSearchPanelProps {
  dossierId: string
  onOpenDocument: (input: { dossierId: string; documentId: string }) => void | Promise<void>
}

function renderSnippet(
  snippet: string,
  matchStart: number | undefined,
  matchEnd: number | undefined
): React.ReactNode {
  if (
    matchStart === undefined ||
    matchEnd === undefined ||
    matchStart < 0 ||
    matchEnd <= matchStart ||
    matchEnd > snippet.length
  ) {
    return snippet
  }
  const before = snippet.slice(0, matchStart)
  const match = snippet.slice(matchStart, matchEnd)
  const after = snippet.slice(matchEnd)
  return (
    <>
      {before}
      <mark className="bg-aurora/10 text-[#1a1a1a] font-medium rounded px-0.5">{match}</mark>
      {after}
    </>
  )
}

function HitButton({
  hit,
  isActive,
  onSelect
}: {
  hit: SemanticSearchHit
  isActive: boolean
  onSelect: (hit: SemanticSearchHit) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={() => onSelect(hit)}
      className={`w-full rounded-lg border bg-white px-3 py-2 text-left transition hover:border-aurora/50 hover:bg-aurora/5 ${
        isActive ? 'border-aurora/60 bg-aurora/5' : 'border-[#e5e3da]'
      }`}
    >
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-semibold text-[#1a1a1a]">{hit.filename}</p>
        {/* Score is a cosine similarity for semantic hits; for keyword hits it
            is a word-count, not meaningful to show — so display it only for
            approximate (semantic) results. */}
        {hit.matchKind !== 'keyword' ? (
          <span className="shrink-0 text-xs tabular-nums text-[#5c5c5a]">
            {t('documents.semantic_search_score', { score: hit.score.toFixed(2) })}
          </span>
        ) : null}
      </div>
      <p className="line-clamp-3 select-text whitespace-pre-line text-xs leading-relaxed text-[#8a8a85]">
        {renderSnippet(hit.snippet, hit.snippetMatchStart, hit.snippetMatchEnd)}
      </p>
    </button>
  )
}

// Render the full extracted text with the matched passage highlighted. The hit
// carries character offsets into the same extracted text the viewer shows, so we
// slice on those offsets directly — no fuzzy matching needed. The highlighted
// span is given a ref so it can be scrolled into view when a result is opened.
function ExtractedText({
  text,
  charStart,
  charEnd,
  matchRef
}: {
  text: string
  charStart: number | null
  charEnd: number | null
  matchRef: React.RefObject<HTMLElement | null>
}): React.JSX.Element {
  if (
    charStart === null ||
    charEnd === null ||
    charStart < 0 ||
    charEnd <= charStart ||
    charEnd > text.length
  ) {
    return (
      <pre className="whitespace-pre-wrap wrap-break-word text-sm leading-6 text-[#1a1a1a]">
        {text}
      </pre>
    )
  }
  return (
    <pre className="whitespace-pre-wrap wrap-break-word text-sm leading-6 text-[#1a1a1a]">
      {text.slice(0, charStart)}
      <mark
        ref={matchRef as React.RefObject<HTMLElement>}
        className="rounded bg-aurora/30 px-0.5 font-medium text-[#1a1a1a]"
      >
        {text.slice(charStart, charEnd)}
      </mark>
      {text.slice(charEnd)}
    </pre>
  )
}

export function SemanticSearchPanel({
  dossierId,
  onOpenDocument
}: SemanticSearchPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const state = useDocumentStore((store) => store.semanticSearchStatesByDossierId[dossierId])
  const runSemanticSearch = useDocumentStore((store) => store.runSemanticSearch)
  const clearSemanticSearch = useDocumentStore((store) => store.clearSemanticSearch)
  const extractContent = useDocumentStore((store) => store.extractContent)
  const contentStates = useDocumentStore((store) => store.contentStatesByDossierId[dossierId])
  const [query, setQuery] = useState(state?.query ?? '')
  // The hit whose document is shown in the right-hand viewer. We key on the hit
  // itself (not just the document id) so reopening a different passage of the
  // same document re-highlights and re-scrolls to the new offsets.
  const [activeHit, setActiveHit] = useState<SemanticSearchHit | null>(null)
  const matchRef = useRef<HTMLElement | null>(null)

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const trimmed = query.trim()
      if (!trimmed) return
      setActiveHit(null)
      void runSemanticSearch({ dossierId, query: trimmed })
    },
    [dossierId, query, runSemanticSearch]
  )

  const handleClear = useCallback(() => {
    setQuery('')
    setActiveHit(null)
    clearSemanticSearch(dossierId)
  }, [clearSemanticSearch, dossierId])

  // Selecting a result loads its extracted text into the viewer. extractContent
  // is cached per document, so reopening a previously viewed passage is instant.
  const handleSelect = useCallback(
    (hit: SemanticSearchHit) => {
      setActiveHit(hit)
      void extractContent({ dossierId, documentId: hit.documentId })
    },
    [dossierId, extractContent]
  )

  const status = state?.status ?? 'idle'
  const hits = useMemo(() => state?.results?.hits ?? [], [state?.results?.hits])
  // Group hits by how they were found: 'keyword' = the document literally
  // contains the query word (exact); anything else = semantic / approximate.
  const exactHits = useMemo(() => hits.filter((h) => h.matchKind === 'keyword'), [hits])
  const approxHits = useMemo(() => hits.filter((h) => h.matchKind !== 'keyword'), [hits])

  const activeContentState = activeHit ? (contentStates?.[activeHit.documentId] ?? null) : null
  const activeContentStatus = activeContentState?.status ?? 'idle'
  const activeText = activeContentState?.content?.text ?? ''

  // Scroll the highlighted passage into view once the text is rendered. Runs on
  // the hit (offsets change) and on extraction completing for that document.
  useEffect(() => {
    if (activeContentStatus !== 'ready') return
    const node = matchRef.current
    if (!node) return
    node.scrollIntoView({ block: 'center' })
  }, [activeHit, activeContentStatus])

  const countLabel =
    state && status === 'ready'
      ? t('documents.semantic_search_count', {
          count: hits.length,
          defaultValue: '{{count}} résultat(s)'
        })
      : null

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <SectionHeader
        badge={t('documents.semantic_search_badge')}
        count={countLabel}
        actions={
          state ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClear}
              disabled={status === 'loading'}
            >
              {t('documents.semantic_search_clear')}
            </Button>
          ) : null
        }
      />

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.75fr)]">
        <div className="flex min-h-0 flex-col gap-3">
          <Card className="space-y-3">
            <form className="flex flex-wrap items-center gap-2" onSubmit={handleSubmit}>
              <SearchField
                id="semantic-search-query"
                value={query}
                onChange={setQuery}
                placeholder={t('documents.semantic_search_placeholder')}
                ariaLabel={t('documents.semantic_search_input_label')}
              />
              <Button type="submit" disabled={status === 'loading' || !query.trim()}>
                {status === 'loading'
                  ? t('documents.semantic_search_searching')
                  : t('documents.semantic_search_submit')}
              </Button>
            </form>
            <p className="text-xs text-[#8a8a85]">
              {t('documents.semantic_search_hint_extraction')}
            </p>
          </Card>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {status === 'error' && state ? (
              <p className="rounded-lg border border-[#e8c7c7] bg-[#fbf0f0] px-3 py-2 text-sm text-[#9c2f2f]">
                {t('documents.semantic_search_error', { error: state.error ?? '' })}
              </p>
            ) : null}

            {status === 'ready' && hits.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[#e5e3da] bg-white px-3 py-2 text-sm text-[#5c5c5a]">
                {t('documents.semantic_search_no_results')}
              </p>
            ) : null}

            {hits.length > 0 ? (
              <div className="space-y-4">
                {exactHits.length > 0 ? (
                  <div className="space-y-2">
                    <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5c5c5a]">
                      {t('documents.search_group_exact')}
                    </p>
                    {exactHits.map((hit, index) => (
                      <HitButton
                        key={`kw-${hit.documentId}-${hit.charStart}-${index}`}
                        hit={hit}
                        isActive={
                          activeHit?.documentId === hit.documentId &&
                          activeHit?.charStart === hit.charStart
                        }
                        onSelect={handleSelect}
                      />
                    ))}
                  </div>
                ) : null}

                {approxHits.length > 0 ? (
                  <div className="space-y-2">
                    <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5c5c5a]">
                      {t('documents.search_group_approximate')}
                    </p>
                    <p className="px-1 text-xs text-[#8a8a85]">
                      {exactHits.length === 0
                        ? t('documents.search_no_exact_hint')
                        : t('documents.search_approximate_caveat')}
                    </p>
                    {approxHits.map((hit, index) => (
                      <HitButton
                        key={`sem-${hit.documentId}-${hit.charStart}-${index}`}
                        hit={hit}
                        isActive={
                          activeHit?.documentId === hit.documentId &&
                          activeHit?.charStart === hit.charStart
                        }
                        onSelect={handleSelect}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <Card className="flex min-h-0 flex-col overflow-hidden">
          {activeHit ? (
            <>
              <div className="mb-3 flex shrink-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold text-[#1a1a1a]">
                    {activeHit.filename}
                  </h2>
                  {activeContentState?.content ? (
                    <p className="mt-0.5 text-xs text-[#8a8a85]">
                      {t('documents.extraction_chars_label', {
                        count: activeContentState.content.textLength
                      })}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void onOpenDocument({ dossierId, documentId: activeHit.documentId })
                  }
                >
                  {t('documents.preview_open_action')}
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-[#f4f3ee] p-3">
                {activeContentStatus === 'loading' ? (
                  <p className="text-sm text-[#5c5c5a]">
                    {t('documents.semantic_search_searching')}
                  </p>
                ) : activeContentStatus === 'error' ? (
                  <p className="text-sm text-[#9c2f2f]">
                    {activeContentState?.error ?? t('documents.extraction_error_body')}
                  </p>
                ) : activeContentStatus === 'ready' ? (
                  activeText ? (
                    <ExtractedText
                      text={activeText}
                      charStart={activeHit.charStart}
                      charEnd={activeHit.charEnd}
                      matchRef={matchRef}
                    />
                  ) : (
                    <p className="text-sm text-[#5c5c5a]">{t('documents.preview_text_empty')}</p>
                  )
                ) : null}
              </div>
            </>
          ) : (
            <p className="text-sm text-[#5c5c5a]">
              {t('documents.semantic_search_viewer_empty', {
                defaultValue: 'Sélectionnez un résultat pour consulter le document.'
              })}
            </p>
          )}
        </Card>
      </div>
    </section>
  )
}
