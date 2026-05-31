import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useDocumentStore } from '@renderer/stores'
import { Button } from '@renderer/components/ui'
import {
  ColumnHeader,
  ListContainer,
  SearchField,
  SectionHeader
} from '@renderer/features/dossiers/sectionLayout'

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

export function SemanticSearchPanel({
  dossierId,
  onOpenDocument
}: SemanticSearchPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const state = useDocumentStore((store) => store.semanticSearchStatesByDossierId[dossierId])
  const runSemanticSearch = useDocumentStore((store) => store.runSemanticSearch)
  const clearSemanticSearch = useDocumentStore((store) => store.clearSemanticSearch)
  const [query, setQuery] = useState(state?.query ?? '')

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const trimmed = query.trim()
      if (!trimmed) return
      void runSemanticSearch({ dossierId, query: trimmed })
    },
    [dossierId, query, runSemanticSearch]
  )

  const handleClear = useCallback(() => {
    setQuery('')
    clearSemanticSearch(dossierId)
  }, [clearSemanticSearch, dossierId])

  const status = state?.status ?? 'idle'
  const hits = state?.results?.hits ?? []

  const countLabel =
    state && status === 'ready'
      ? t('documents.semantic_search_count', {
          count: hits.length,
          defaultValue: '{{count}} résultat(s)'
        })
      : null

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
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

      <form className="flex shrink-0 flex-wrap items-center gap-2" onSubmit={handleSubmit}>
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

      {status === 'error' && state ? (
        <p className="shrink-0 rounded-2xl border border-[#e8c7c7] bg-[#fbf0f0] p-4 text-sm text-[#9c2f2f]">
          {t('documents.semantic_search_error', { error: state.error ?? '' })}
        </p>
      ) : null}

      {status === 'ready' && hits.length === 0 ? (
        <p className="shrink-0 rounded-2xl border border-dashed border-[#e5e3da] bg-white p-4 text-sm text-[#5c5c5a]">
          {t('documents.semantic_search_no_results')}
        </p>
      ) : null}

      {hits.length > 0 ? (
        <ListContainer>
          <ColumnHeader>
            <span className="flex-1">
              {t('documents.semantic_search_column_document', { defaultValue: 'Document' })}
            </span>
            <span className="w-20 shrink-0 text-right">
              {t('documents.semantic_search_column_score', { defaultValue: 'Score' })}
            </span>
          </ColumnHeader>
          <ol className="h-[calc(100%-2.25rem)] divide-y divide-deep-space overflow-y-auto">
            {hits.map((hit, index) => (
              <li
                key={`${hit.documentId}-${hit.charStart}-${index}`}
                className="flex flex-col gap-1 px-4 py-3 transition-colors duration-150 hover:bg-[#fbf9f4]"
              >
                <button
                  type="button"
                  onClick={() => void onOpenDocument({ dossierId, documentId: hit.documentId })}
                  className="group flex w-full items-baseline justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-aurora/40"
                >
                  <p className="min-w-0 truncate text-sm font-medium text-[#1a1a1a] group-hover:text-aurora group-focus-visible:text-aurora">
                    {hit.filename}
                  </p>
                  <span className="w-20 shrink-0 text-right text-xs tabular-nums text-[#5c5c5a]">
                    {t('documents.semantic_search_score', {
                      score: hit.score.toFixed(2)
                    })}
                  </span>
                </button>
                <p className="select-text whitespace-pre-line text-xs leading-relaxed text-[#8a8a85]">
                  {renderSnippet(hit.snippet, hit.snippetMatchStart, hit.snippetMatchEnd)}
                </p>
              </li>
            ))}
          </ol>
        </ListContainer>
      ) : null}
    </div>
  )
}
