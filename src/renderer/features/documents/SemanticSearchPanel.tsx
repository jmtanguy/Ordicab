import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useDocumentStore } from '@renderer/stores'
import { Button, Card, Input } from '@renderer/components/ui'

interface SemanticSearchPanelProps {
  dossierId: string
  onOpenDocument: (input: { dossierId: string; documentId: string }) => void | Promise<void>
}

function formatSemanticSearchSnippet(snippet: string): string {
  return snippet.replace(/<NL>/g, '\n')
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

  return (
    <Card className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-[0.16em] text-aurora-soft">
          {t('documents.semantic_search_badge')}
        </p>
        <h3 className="mt-1 text-lg font-semibold text-slate-50">
          {t('documents.semantic_search_title')}
        </h3>
        <p className="mt-1 text-sm text-slate-400">{t('documents.semantic_search_description')}</p>
      </div>

      <form className="flex flex-wrap items-center gap-2" onSubmit={handleSubmit}>
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('documents.semantic_search_placeholder')}
          aria-label={t('documents.semantic_search_input_label')}
          className="min-w-0 flex-1"
        />
        <Button type="submit" disabled={status === 'loading' || !query.trim()}>
          {status === 'loading'
            ? t('documents.semantic_search_searching')
            : t('documents.semantic_search_submit')}
        </Button>
        {state ? (
          <Button
            type="button"
            variant="ghost"
            onClick={handleClear}
            disabled={status === 'loading'}
          >
            {t('documents.semantic_search_clear')}
          </Button>
        ) : null}
      </form>

      {status === 'error' && state ? (
        <p className="text-sm text-rose-300">
          {t('documents.semantic_search_error', { error: state.error ?? '' })}
        </p>
      ) : null}

      {status === 'ready' && hits.length === 0 ? (
        <p className="text-sm text-slate-400">{t('documents.semantic_search_no_results')}</p>
      ) : null}

      {hits.length > 0 ? (
        <ol className="space-y-2">
          {hits.map((hit, index) => (
            <li key={`${hit.documentId}-${hit.charStart}-${index}`}>
              <button
                type="button"
                onClick={() => void onOpenDocument({ dossierId, documentId: hit.documentId })}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/35 p-3 text-left text-sm transition hover:border-aurora/50 hover:bg-slate-950/55"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate font-medium text-slate-100">{hit.filename}</p>
                  <span className="shrink-0 text-xs text-slate-400">
                    {t('documents.semantic_search_score', {
                      score: hit.score.toFixed(2)
                    })}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-line text-xs text-slate-300">
                  {formatSemanticSearchSnippet(hit.snippet)}
                </p>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </Card>
  )
}
