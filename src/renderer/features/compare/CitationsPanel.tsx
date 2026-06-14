import { useTranslation } from 'react-i18next'

import type { ComparisonCitations } from '@shared/types'

import { AlertBanner } from '@renderer/components/ui'

import { scrollToBlock } from './diffNavigation'

type CitationStatus = ComparisonCitations['references'][number]['status']

// Same palette as the legal-search verification pills: green = confirmed,
// amber = needs a human look, red = absent / API failure.
const STATUS_STYLES: Record<CitationStatus, string> = {
  found: 'bg-emerald-50 text-emerald-700',
  ambiguous: 'bg-amber-50 text-amber-700',
  not_found: 'bg-red-50 text-red-600',
  api_error: 'bg-red-50 text-red-600'
}

function StatusPill({ status }: { status: CitationStatus }): React.JSX.Element {
  const { t } = useTranslation()
  const labels: Record<CitationStatus, string> = {
    found: t('legal_search.status_found', { defaultValue: 'Trouvée' }),
    ambiguous: t('legal_search.status_ambiguous', { defaultValue: 'À vérifier' }),
    not_found: t('legal_search.status_not_found', { defaultValue: 'Introuvable' }),
    api_error: t('legal_search.status_api_error', { defaultValue: 'Erreur API' })
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[status]}`}>
      {labels[status]}
    </span>
  )
}

export function CitationsPanel({
  citations
}: {
  citations: ComparisonCitations | undefined
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <section className="rounded-2xl border border-hairline bg-white/80 p-4">
      <h3 className="text-sm font-semibold text-ink">
        {t('compare.citations_title', { defaultValue: 'Citations juridiques ajoutées' })}
      </h3>
      <div className="mt-2 space-y-2">
        {citations === undefined ? (
          <p className="text-sm text-ink-muted">
            {t('compare.no_added_text', {
              defaultValue: 'Aucun texte ajouté — rien à vérifier.'
            })}
          </p>
        ) : citations.unavailable ? (
          <AlertBanner tone="warning">
            {t('compare.citations_unavailable', {
              defaultValue:
                'Vérification indisponible — configurez l’accès Légifrance dans les réglages.'
            })}
            {citations.error ? (
              <span className="mt-1 block text-xs opacity-80">{citations.error}</span>
            ) : null}
          </AlertBanner>
        ) : citations.references.length === 0 ? (
          <p className="text-sm text-ink-muted">
            {t('compare.citations_none', {
              defaultValue: 'Aucune référence juridique détectée dans le texte ajouté.'
            })}
          </p>
        ) : (
          <>
            {citations.truncated ? (
              <AlertBanner tone="neutral">
                {t('compare.citations_truncated', {
                  defaultValue:
                    'Le texte ajouté contient de nombreuses références — certaines ont pu être ignorées.'
                })}
              </AlertBanner>
            ) : null}
            <ul className="space-y-2">
              {citations.references.map((reference) => (
                <li
                  key={reference.normalizedReference ?? reference.reference}
                  className="rounded-lg border border-hairline bg-white p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{reference.reference}</span>
                    <StatusPill status={reference.status} />
                  </div>
                  {reference.normalizedReference &&
                  reference.normalizedReference !== reference.reference ? (
                    <p className="mt-1 text-xs text-ink-subtle">{reference.normalizedReference}</p>
                  ) : null}
                  {reference.matches.length > 0 && reference.matches[0] ? (
                    <p className="mt-1 text-xs text-ink-muted">{reference.matches[0].title}</p>
                  ) : null}
                  {reference.error ? (
                    <p className="mt-1 text-xs text-red-500">{reference.error}</p>
                  ) : null}
                  {reference.blockIndex !== undefined ? (
                    <button
                      type="button"
                      className="mt-1 text-xs font-medium text-aurora hover:underline"
                      onClick={() => scrollToBlock(reference.blockIndex!)}
                    >
                      {t('compare.scroll_to_block', { defaultValue: 'Voir le passage' })}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}
