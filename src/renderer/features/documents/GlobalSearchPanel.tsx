import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { GlobalSearchHit } from '@shared/types'

import { useDocumentStore } from '@renderer/stores'
import { Button, Card } from '@renderer/components/ui'
import { SearchField, SectionHeader } from '@renderer/features/dossiers/sectionLayout'

// Identifies a hit across dossiers: the same relative path + offset can exist in
// two different dossiers, so the dossier slug is part of the identity.
function hitKey(hit: GlobalSearchHit): string {
  return `${hit.dossierId}::${hit.documentPath}::${hit.charStart}`
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
      <mark className="bg-aurora/10 text-ink font-medium rounded px-0.5">{match}</mark>
      {after}
    </>
  )
}

function HitButton({
  hit,
  isActive,
  onSelect
}: {
  hit: GlobalSearchHit
  isActive: boolean
  onSelect: (hit: GlobalSearchHit) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={() => onSelect(hit)}
      className={`w-full rounded-lg border bg-white px-3 py-2 text-left transition hover:border-aurora/50 hover:bg-aurora/5 ${
        isActive ? 'border-aurora/60 bg-aurora/5' : 'border-hairline'
      }`}
    >
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-semibold text-ink">{hit.filename}</p>
        {/* Score is a cosine similarity for semantic hits; for keyword hits it
            is a word-count, not meaningful to show — so display it only for
            approximate (semantic) results. */}
        {hit.matchKind !== 'keyword' ? (
          <span className="shrink-0 text-xs tabular-nums text-ink-muted">
            {t('documents.semantic_search_score', { score: hit.score.toFixed(2) })}
          </span>
        ) : null}
      </div>
      {/* The source dossier — the whole point of cross-dossier search. */}
      <p className="mb-1 flex items-center gap-1 text-xs font-medium text-aurora">
        <svg
          width="11"
          height="11"
          viewBox="0 0 15 15"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M1.5 4a1 1 0 0 1 1-1h4l1.5 2H13a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V4z" />
        </svg>
        <span className="min-w-0 truncate" title={hit.dossierName}>
          {hit.dossierName}
        </span>
      </p>
      <p className="line-clamp-3 select-text whitespace-pre-line text-xs leading-relaxed text-ink-subtle">
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
      <pre className="whitespace-pre-wrap wrap-break-word text-sm leading-6 text-ink">{text}</pre>
    )
  }
  return (
    <pre className="whitespace-pre-wrap wrap-break-word text-sm leading-6 text-ink">
      {text.slice(0, charStart)}
      <mark
        ref={matchRef as React.RefObject<HTMLElement>}
        className="rounded bg-aurora/30 px-0.5 font-medium text-ink"
      >
        {text.slice(charStart, charEnd)}
      </mark>
      {text.slice(charEnd)}
    </pre>
  )
}

export function GlobalSearchPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const state = useDocumentStore((store) => store.globalSearchState)
  const runGlobalSearch = useDocumentStore((store) => store.runGlobalSearch)
  const clearGlobalSearch = useDocumentStore((store) => store.clearGlobalSearch)
  const extractContent = useDocumentStore((store) => store.extractContent)
  const openFile = useDocumentStore((store) => store.openFile)
  const contentStatesByDossierId = useDocumentStore((store) => store.contentStatesByDossierId)
  const [query, setQuery] = useState(state?.query ?? '')
  // The hit whose document is shown in the right-hand viewer. We key on the hit
  // itself (not just the document id) so reopening a different passage of the
  // same document re-highlights and re-scrolls to the new offsets.
  const [activeHit, setActiveHit] = useState<GlobalSearchHit | null>(null)
  const matchRef = useRef<HTMLElement | null>(null)

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const trimmed = query.trim()
      if (!trimmed) return
      setActiveHit(null)
      void runGlobalSearch({ query: trimmed })
    },
    [query, runGlobalSearch]
  )

  const handleClear = useCallback(() => {
    setQuery('')
    setActiveHit(null)
    clearGlobalSearch()
  }, [clearGlobalSearch])

  // Selecting a result loads its extracted text into the viewer. extractContent
  // is cached per document, so reopening a previously viewed passage is instant.
  const handleSelect = useCallback(
    (hit: GlobalSearchHit) => {
      setActiveHit(hit)
      void extractContent({ dossierId: hit.dossierId, documentPath: hit.documentPath })
    },
    [extractContent]
  )

  const status = state?.status ?? 'idle'
  const hits = useMemo(() => state?.results?.hits ?? [], [state?.results?.hits])
  // Group hits by how they were found: 'keyword' = the document literally
  // contains the query word (exact); anything else = semantic / approximate.
  const exactHits = useMemo(() => hits.filter((h) => h.matchKind === 'keyword'), [hits])
  const approxHits = useMemo(() => hits.filter((h) => h.matchKind !== 'keyword'), [hits])

  const activeContentState = activeHit
    ? (contentStatesByDossierId?.[activeHit.dossierId]?.[activeHit.documentPath] ?? null)
    : null
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
      ? t('documents.global_search_count', {
          count: hits.length,
          defaultValue: '{{count}} résultat(s)'
        })
      : null

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <SectionHeader
        badge={t('documents.global_search_badge')}
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
              {t('documents.global_search_clear')}
            </Button>
          ) : null
        }
      />

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.75fr)]">
        <div className="flex min-h-0 flex-col gap-3">
          <Card className="space-y-3">
            <form className="flex flex-wrap items-center gap-2" onSubmit={handleSubmit}>
              <SearchField
                id="global-search-query"
                value={query}
                onChange={setQuery}
                placeholder={t('documents.global_search_placeholder')}
                ariaLabel={t('documents.global_search_input_label')}
              />
              <Button type="submit" disabled={status === 'loading' || !query.trim()}>
                {status === 'loading'
                  ? t('documents.global_search_searching')
                  : t('documents.global_search_submit')}
              </Button>
            </form>
            <p className="text-xs text-ink-subtle">{t('documents.global_search_hint')}</p>
          </Card>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {status === 'error' && state ? (
              <p className="rounded-lg border border-destructive-border bg-destructive-tint px-3 py-2 text-sm text-destructive">
                {t('documents.global_search_error', { error: state.error ?? '' })}
              </p>
            ) : null}

            {status === 'ready' && hits.length === 0 ? (
              <p className="rounded-lg border border-dashed border-hairline bg-white px-3 py-2 text-sm text-ink-muted">
                {t('documents.global_search_no_results')}
              </p>
            ) : null}

            {hits.length > 0 ? (
              <div className="space-y-4">
                {exactHits.length > 0 ? (
                  <div className="space-y-2">
                    <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
                      {t('documents.search_group_exact')}
                    </p>
                    {exactHits.map((hit) => (
                      <HitButton
                        key={hitKey(hit)}
                        hit={hit}
                        isActive={activeHit ? hitKey(activeHit) === hitKey(hit) : false}
                        onSelect={handleSelect}
                      />
                    ))}
                  </div>
                ) : null}

                {approxHits.length > 0 ? (
                  <div className="space-y-2">
                    <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
                      {t('documents.search_group_approximate')}
                    </p>
                    <p className="px-1 text-xs text-ink-subtle">
                      {exactHits.length === 0
                        ? t('documents.search_no_exact_hint')
                        : t('documents.search_approximate_caveat')}
                    </p>
                    {approxHits.map((hit) => (
                      <HitButton
                        key={hitKey(hit)}
                        hit={hit}
                        isActive={activeHit ? hitKey(activeHit) === hitKey(hit) : false}
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
                  <h2 className="truncate text-sm font-semibold text-ink">{activeHit.filename}</h2>
                  <p className="mt-0.5 truncate text-xs text-aurora" title={activeHit.dossierName}>
                    {activeHit.dossierName}
                  </p>
                  {activeContentState?.content ? (
                    <p className="mt-0.5 text-xs text-ink-subtle">
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
                    void openFile({
                      dossierId: activeHit.dossierId,
                      documentPath: activeHit.documentPath
                    })
                  }
                >
                  {t('documents.global_search_open_file')}
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-parchment p-3">
                {activeContentStatus === 'loading' ? (
                  <p className="text-sm text-ink-muted">{t('documents.global_search_searching')}</p>
                ) : activeContentStatus === 'error' ? (
                  <p className="text-sm text-destructive">
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
                    <p className="text-sm text-ink-muted">{t('documents.preview_text_empty')}</p>
                  )
                ) : null}
              </div>
            </>
          ) : (
            <p className="text-sm text-ink-muted">{t('documents.global_search_viewer_empty')}</p>
          )}
        </Card>
      </div>
    </section>
  )
}
