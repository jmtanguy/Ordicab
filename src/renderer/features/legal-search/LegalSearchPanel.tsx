import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type {
  JudilibreJurisdiction,
  JudilibreSort,
  LegalReferenceCheckResult,
  LegalSearchResultItem,
  LegifranceFond,
  LegifranceSort
} from '@shared/types'

import { Button, Card, Field, Input, Select } from '@renderer/components/ui'
import { SectionHeader } from '@renderer/features/dossiers/sectionLayout'
import { getOrdicabApi } from '@renderer/stores/ipc'
import { GLOBAL_LEGAL_SCOPE, useLegalStore } from '@renderer/stores/legalStore'

type SourceKind = 'all' | 'legifrance' | 'judilibre'

const LEGIFRANCE_FOND_OPTIONS: Array<{ value: LegifranceFond; label: string }> = [
  { value: 'ALL', label: 'Tous les fonds' },
  { value: 'CODE_ETAT', label: 'Codes' },
  { value: 'LODA_ETAT', label: 'Lois & décrets' },
  { value: 'JORF', label: 'Journal officiel' },
  { value: 'JURI', label: 'Jurisprudence' },
  { value: 'KALI', label: 'Conventions collectives' }
]

const LEGIFRANCE_SORT_OPTIONS: Array<{ value: LegifranceSort; label: string }> = [
  { value: 'PERTINENCE', label: 'Pertinence' },
  { value: 'DATE_PUBLI_DESC', label: 'Date (récent)' },
  { value: 'DATE_PUBLI_ASC', label: 'Date (ancien)' }
]

const JUDILIBRE_JURISDICTION_OPTIONS: Array<{ value: JudilibreJurisdiction; label: string }> = [
  { value: 'cc', label: 'Cour de cassation' },
  { value: 'ca', label: "Cour d'appel" },
  { value: 'tj', label: 'Tribunal judiciaire' },
  { value: 'tcom', label: 'Tribunal de commerce' }
]

const JUDILIBRE_SORT_OPTIONS: Array<{ value: JudilibreSort; label: string }> = [
  { value: 'scorepub', label: 'Pertinence' },
  { value: 'date', label: 'Date (récent)' }
]

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// Words too common in legal texts to be useful as highlights — they appear in
// almost every decision and would drown the page in marks.
const HIGHLIGHT_STOP_WORDS = new Set([
  'code',
  'civil',
  'civile',
  'penal',
  'loi',
  'article',
  'articles',
  'cour',
  'arret',
  'appel',
  'cassation',
  'les',
  'des',
  'une',
  'pour',
  'par',
  'que',
  'qui',
  'dans',
  'sur',
  'aux',
  'avec',
  'son',
  'ses'
])

interface HighlightTerm {
  // Accent-insensitive, lower-cased comparison key.
  key: string
  // Regex source matching the term (number references stay as-is, words match
  // any accent variant so "responsabilite" highlights "responsabilité").
  source: string
  number: boolean
}

// Turn a query into highlight terms, ranked so the distinctive bits win:
// article/pourvoi numbers first (the real anchors), then meaningful words,
// dropping ultra-common legal stop-words that would highlight everything.
function buildHighlightTerms(query: string | null): HighlightTerm[] {
  if (!query) return []
  const terms = new Map<string, HighlightTerm>()

  // Numbers and article-style references: 1382, 14-1, 16-15.752, R. 431-5...
  for (const match of query.matchAll(/[0-9]+(?:[.\-/][0-9]+)*/g)) {
    const value = match[0]
    if (value.length < 2) continue
    terms.set(value, { key: value, source: escapeRegExp(value), number: true })
  }

  for (const rawWord of query.split(/\s+/)) {
    const word = stripDiacritics(rawWord.toLowerCase()).replace(/[^a-z0-9]/g, '')
    if (word.length <= 3 || HIGHLIGHT_STOP_WORDS.has(word)) continue
    if (terms.has(word)) continue
    // Match the word regardless of accents by allowing any combining marks
    // between its letters in the source text.
    const source = word
      .split('')
      .map((char) => escapeRegExp(char))
      .join('[\\u0300-\\u036f]*')
    terms.set(word, { key: word, source: `${source}[\\u0300-\\u036f]*`, number: false })
  }

  // Numbers first (most distinctive), then by length so specific words win.
  return Array.from(terms.values()).sort((a, b) => {
    if (a.number !== b.number) return a.number ? -1 : 1
    return b.key.length - a.key.length
  })
}

function buildHighlightRegExp(query: string | null): RegExp | null {
  const terms = buildHighlightTerms(query)
  if (terms.length === 0) return null
  // Word-style terms get word boundaries so "civil" doesn't light up inside
  // "civilement"; number references match anywhere.
  const sources = terms.map((term) => (term.number ? term.source : `\\b${term.source}\\b`))
  return new RegExp(`(${sources.join('|')})`, 'giu')
}

function HighlightedText({
  text,
  pattern
}: {
  text: string
  pattern: RegExp | null
}): React.JSX.Element {
  if (!pattern) return <>{text}</>
  // split() with a capturing group keeps the delimiters, so odd indices are matches.
  const parts = text.split(pattern)
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <mark key={index} className="rounded bg-aurora/30 px-0.5 font-medium text-[#1a1a1a]">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  )
}

// Markers that conventionally open a new section of a French court decision.
// We force a paragraph break before each so the wall-of-text regains structure.
const LEGAL_SECTION_MARKERS = [
  'LA COUR DE CASSATION',
  'LA COUR,',
  'Statuant sur',
  'Sur le rapport',
  'Sur le premier moyen',
  'Sur le second moyen',
  'Sur le moyen',
  'Sur les moyens',
  'Vu la communication',
  "Vu l'article",
  'Vu les articles',
  'Attendu que',
  "Attendu qu'",
  'Attendu, ',
  "Qu'en statuant",
  "Qu'en l'état",
  'Mais attendu',
  'PAR CES MOTIFS',
  'CASSE ET ANNULE',
  'REJETTE',
  'Condamne',
  'Dit que',
  'Ainsi fait et jugé',
  'MOYEN ANNEXE',
  'MOYENS ANNEXES',
  'Moyen produit',
  'AUX MOTIFS QUE',
  'AUX MOTIFS',
  'ALORS QUE',
  "ALORS QU'",
  'Il est fait grief'
]

interface LegalBlock {
  kind: 'title' | 'paragraph'
  text: string
}

// Detect "spaced caps" headers like "R É P U B L I Q U E F R A N Ç A I S E"
// (every letter separated by a space). The flat API text gives a single space
// everywhere, so we can't reliably recover word boundaries — we keep the spaced
// form (still readable) and just flag it as a title.
function isSpacedCaps(value: string): boolean {
  const compact = value.trim()
  if (compact.length < 5) return false
  return /^[A-ZÀ-Þ](?: [A-ZÀ-Þ0-9])+$/u.test(compact)
}

// Reconstruct paragraph/title structure from the flat text the PISTE APIs
// return for decisions (Judilibre ships a single unbroken string). We split on
// existing newlines, separator rules, spaced-caps headers, and the canonical
// section markers, then break long considérants on their closing "; ".
function parseLegalText(text: string): LegalBlock[] {
  // Insert line breaks around the structural anchors before splitting:
  //  - underscore separators that frame the header,
  //  - spaced-caps headers buried mid-line (e.g. "R É P U B L I Q U E ..."),
  //  - the canonical section markers.
  let prepared = text.replace(/_{3,}/g, '\n')
  prepared = prepared.replace(/(?:[A-ZÀ-Þ] ){4,}[A-ZÀ-Þ]/gu, (match) => `\n${match}\n`)
  const withBreaks = LEGAL_SECTION_MARKERS.reduce(
    (acc, marker) => acc.split(marker).join(`\n${marker}`),
    prepared
  )

  const blocks: LegalBlock[] = []
  for (const rawLine of withBreaks.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    // Drop the decorative underscore separators entirely.
    if (/^_{3,}$/.test(line.replace(/\s/g, ''))) continue

    if (isSpacedCaps(line)) {
      blocks.push({ kind: 'title', text: line })
      continue
    }

    if (line === line.toUpperCase() && line.length < 60 && /[A-ZÀ-Þ]/u.test(line)) {
      blocks.push({ kind: 'title', text: line })
      continue
    }

    // Each considérant ends with " ; " — turn those into separate paragraphs
    // so dense reasoning blocks become scannable.
    const sentences = line
      .split(/\s*;\s+(?=[A-ZÀ-Þa-zà-ÿ])/u)
      .map((part, idx, arr) => (idx < arr.length - 1 ? `${part.trim()} ;` : part.trim()))
      .filter(Boolean)
    for (const sentence of sentences) {
      blocks.push({ kind: 'paragraph', text: sentence })
    }
  }
  return blocks
}

function LegalText({ text, pattern }: { text: string; pattern: RegExp | null }): React.JSX.Element {
  const blocks = useMemo(() => parseLegalText(text), [text])
  return (
    <div className="space-y-2.5">
      {blocks.map((block, index) =>
        block.kind === 'title' ? (
          <p
            key={index}
            className="text-center text-xs font-semibold uppercase tracking-wide text-[#5c5c5a]"
          >
            <HighlightedText text={block.text} pattern={pattern} />
          </p>
        ) : (
          <p key={index} className="wrap-break-word leading-relaxed text-[#1a1a1a]">
            <HighlightedText text={block.text} pattern={pattern} />
          </p>
        )
      )}
    </div>
  )
}

function SourceBadge({ source }: { source: LegalSearchResultItem['source'] }): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <span className="rounded-full bg-aurora/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-aurora">
      {source === 'legifrance'
        ? t('legal_search.source_legifrance', { defaultValue: 'Légifrance' })
        : t('legal_search.source_judilibre', { defaultValue: 'Judilibre' })}
    </span>
  )
}

function ResultButton({
  item,
  onOpen
}: {
  item: LegalSearchResultItem
  onOpen: (item: LegalSearchResultItem) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="w-full rounded-lg border border-[#e5e3da] bg-white px-3 py-2 text-left transition hover:border-aurora/50 hover:bg-aurora/5"
    >
      <div className="mb-1 flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-semibold text-[#1a1a1a]">{item.title}</p>
        <SourceBadge source={item.source} />
      </div>
      <div className="flex flex-wrap gap-2 text-[11px] text-[#8a8a85]">
        <span>{item.id}</span>
        {item.date ? <span>{item.date.slice(0, 10)}</span> : null}
        {item.jurisdiction ? <span>{item.jurisdiction}</span> : null}
        {typeof item.score === 'number' ? (
          <span className="font-medium text-aurora">
            {t('legal_search.score', {
              defaultValue: 'Pertinence {{score}}',
              score: item.score.toFixed(1)
            })}
          </span>
        ) : null}
      </div>
      {item.summary ? (
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[#5c5c5a]">{item.summary}</p>
      ) : null}
    </button>
  )
}

// Status pill colours: green = confirmed, amber = needs a human look,
// red = absent / API failure. Keeps the verdict scannable at a glance.
const VERIFY_STATUS_STYLES: Record<
  LegalReferenceCheckResult['references'][number]['status'],
  string
> = {
  found: 'bg-emerald-50 text-emerald-700',
  ambiguous: 'bg-amber-50 text-amber-700',
  not_found: 'bg-red-50 text-red-600',
  api_error: 'bg-red-50 text-red-600'
}

function StatusPill({
  status
}: {
  status: LegalReferenceCheckResult['references'][number]['status']
}): React.JSX.Element {
  const { t } = useTranslation()
  const labels: Record<typeof status, string> = {
    found: t('legal_search.status_found', { defaultValue: 'Trouvée' }),
    ambiguous: t('legal_search.status_ambiguous', { defaultValue: 'À vérifier' }),
    not_found: t('legal_search.status_not_found', { defaultValue: 'Introuvable' }),
    api_error: t('legal_search.status_api_error', { defaultValue: 'Erreur API' })
  }
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${VERIFY_STATUS_STYLES[status]}`}
    >
      {labels[status]}
    </span>
  )
}

function VerificationResults({
  result
}: {
  result: LegalReferenceCheckResult | null
}): React.JSX.Element | null {
  const { t } = useTranslation()

  if (!result) return null
  if (result.references.length === 0) {
    return (
      <p className="rounded-lg border border-[#e5e3da] bg-white px-3 py-2 text-sm text-[#5c5c5a]">
        {t('legal_search.verify_empty', {
          defaultValue: 'Aucune référence juridique détectée.'
        })}
      </p>
    )
  }
  return (
    <div className="space-y-2">
      {result.references.map((entry) => (
        <div key={entry.reference} className="rounded-lg border border-[#e5e3da] bg-white p-3">
          <div className="flex flex-wrap items-center gap-2">
            <SourceBadge source={entry.source} />
            <span className="text-sm font-semibold text-[#1a1a1a]">{entry.reference}</span>
            <StatusPill status={entry.status} />
          </div>
          {entry.normalizedReference && entry.normalizedReference !== entry.reference ? (
            <p className="mt-1 text-xs text-[#8a8a85]">
              {t('legal_search.verify_normalized', {
                defaultValue: 'Interprétée comme : {{ref}}',
                ref: entry.normalizedReference
              })}
            </p>
          ) : null}
          {entry.error ? <p className="mt-1 text-xs text-red-500">{entry.error}</p> : null}
          {entry.matches.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs text-[#5c5c5a]">
              {entry.matches.slice(0, 3).map((match) => (
                <li key={match.id}>
                  {match.title} <span className="text-[#8a8a85]">({match.id})</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  )
}

export function LegalSearchPanel({
  dossierId,
  mode = 'search'
}: {
  dossierId?: string
  mode?: 'search' | 'verify'
}): React.JSX.Element {
  const { t } = useTranslation()

  // Each context (global search, or a specific dossier) owns an isolated entry in
  // the store, so searches/results never leak across them. The component is keyed
  // by scope at its call sites, so these useState initializers re-seed from the
  // correct scope snapshot on mount.
  const scope = dossierId ?? GLOBAL_LEGAL_SCOPE
  const scopeState = useLegalStore((s) => s.searchByScope[scope])

  const [source, setSource] = useState<SourceKind>(scopeState?.source ?? 'all')
  const [query, setQuery] = useState(scopeState?.query ?? '')
  const [referenceText, setReferenceText] = useState(scopeState?.referenceText ?? '')
  const [showFilters, setShowFilters] = useState(scopeState?.showFilters ?? false)
  const [fond, setFond] = useState<LegifranceFond>(scopeState?.fond ?? 'ALL')
  const [legifranceSort, setLegifranceSort] = useState<LegifranceSort>(
    scopeState?.legifranceSort ?? 'PERTINENCE'
  )
  const [juridiction, setJuridiction] = useState<JudilibreJurisdiction | ''>(
    scopeState?.juridiction ?? ''
  )
  const [chambre, setChambre] = useState(scopeState?.chambre ?? '')
  const [theme, setTheme] = useState(scopeState?.theme ?? '')
  const [judilibreSort, setJudilibreSort] = useState<JudilibreSort>(
    scopeState?.judilibreSort ?? 'scorepub'
  )
  const [dateDebut, setDateDebut] = useState(scopeState?.dateDebut ?? '')
  const [dateFin, setDateFin] = useState(scopeState?.dateFin ?? '')

  const settings = useLegalStore((s) => s.settings)
  const loadSettings = useLegalStore((s) => s.loadSettings)
  const searchLegifrance = useLegalStore((s) => s.searchLegifrance)
  const searchJudilibre = useLegalStore((s) => s.searchJudilibre)
  const searchAll = useLegalStore((s) => s.searchAll)
  const consultLegifrance = useLegalStore((s) => s.consultLegifrance)
  const consultJudilibre = useLegalStore((s) => s.consultJudilibre)
  const verifyReferences = useLegalStore((s) => s.verifyReferences)
  const saveScopeForm = useLegalStore((s) => s.saveScopeForm)
  const chambers = useLegalStore((s) => s.chambers)
  const themes = useLegalStore((s) => s.themes)
  const loadJudilibreTaxonomy = useLegalStore((s) => s.loadJudilibreTaxonomy)

  const isSearching = scopeState?.isSearching ?? false
  const searchResult = scopeState?.searchResult ?? null
  const searchError = scopeState?.searchError ?? null
  const isConsulting = scopeState?.isConsulting ?? false
  const consultResult = scopeState?.consultResult ?? null
  const consultError = scopeState?.consultError ?? null
  // The query string of the last search, used to highlight matches in the
  // consulted text. Survives query edits because it's snapshotted at search time.
  const searchToken = scopeState?.searchToken ?? null
  const highlightPattern = useMemo(() => buildHighlightRegExp(searchToken), [searchToken])
  const isVerifying = scopeState?.isVerifying ?? false
  const verificationResult = scopeState?.verificationResult ?? null
  const verificationError = scopeState?.verificationError ?? null

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  // Persist the form snapshot to the scope's store entry on every change so the
  // page restores its exact state (query + filters) when navigated back to.
  useEffect(() => {
    saveScopeForm(scope, {
      source,
      query,
      referenceText,
      showFilters,
      fond,
      legifranceSort,
      juridiction,
      chambre,
      theme,
      judilibreSort,
      dateDebut,
      dateFin
    })
  }, [
    saveScopeForm,
    scope,
    source,
    query,
    referenceText,
    showFilters,
    fond,
    legifranceSort,
    juridiction,
    chambre,
    theme,
    judilibreSort,
    dateDebut,
    dateFin
  ])

  const credentials = settings?.credentials
  const configured = Boolean(credentials?.hasClientId && credentials.hasClientSecret)

  // Lazily load Judilibre taxonomy (chambers/themes) the first time the user
  // opens the filters on a Judilibre search and credentials are configured.
  useEffect(() => {
    if (configured && source === 'judilibre' && showFilters) {
      void loadJudilibreTaxonomy()
    }
  }, [configured, source, showFilters, loadJudilibreTaxonomy])

  async function handleSearch(): Promise<void> {
    const trimmed = query.trim()
    if (!trimmed) return
    const start = dateDebut.trim() || undefined
    const end = dateFin.trim() || undefined
    if (source === 'all') {
      // Common sort: reuse the Légifrance sort and map it to its Judilibre equivalent.
      const judilibreTri: JudilibreSort = legifranceSort === 'PERTINENCE' ? 'scorepub' : 'date'
      await searchAll(scope, {
        legifrance: {
          recherche: trimmed,
          fond: 'ALL',
          tri: legifranceSort,
          dateDebut: start,
          dateFin: end,
          pageTaille: 20
        },
        judilibre: {
          recherche: trimmed,
          tri: judilibreTri,
          dateDebut: start,
          dateFin: end,
          nombreResultats: 20
        }
      })
      return
    }
    if (source === 'legifrance') {
      await searchLegifrance(scope, {
        recherche: trimmed,
        fond,
        tri: legifranceSort,
        dateDebut: start,
        dateFin: end,
        pageTaille: 20
      })
      return
    }
    await searchJudilibre(scope, {
      recherche: trimmed,
      juridiction: juridiction || undefined,
      chambre: chambre.trim() || undefined,
      theme: theme.trim() || undefined,
      tri: judilibreSort,
      dateDebut: start,
      dateFin: end,
      nombreResultats: 20
    })
  }

  async function handleOpen(item: LegalSearchResultItem): Promise<void> {
    if (item.source === 'legifrance') await consultLegifrance(scope, item.id)
    else await consultJudilibre(scope, item.id)
  }

  async function handleVerify(): Promise<void> {
    const text = referenceText.trim()
    if (!text) return
    await verifyReferences(scope, { text })
  }

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <SectionHeader
        badge={
          mode === 'verify'
            ? t('legal_search.verify_badge', { defaultValue: 'Références à vérifier' })
            : t('legal_search.badge', { defaultValue: 'Recherche juridique' })
        }
      />

      {!configured ? (
        <Card className="border-[#e8d5a3] bg-[#fbf5e3]">
          <p className="text-sm font-semibold text-[#7a5a00]">
            {t('legal_search.credentials_missing_title', {
              defaultValue: 'Clés PISTE non configurées.'
            })}
          </p>
          <p className="mt-1 text-xs text-[#7a5a00]">
            {t('legal_search.credentials_missing_body', {
              defaultValue:
                'Ajoutez le client ID et le client secret PISTE dans les paramètres pour utiliser la recherche juridique.'
            })}
          </p>
        </Card>
      ) : null}

      <div
        className={
          mode === 'verify'
            ? 'flex min-h-0 flex-1 flex-col'
            : 'grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.75fr)]'
        }
      >
        <div className="flex min-h-0 flex-col gap-3">
          {mode === 'search' ? (
            <Card className="space-y-3">
              <div className="grid gap-3 md:grid-cols-[13rem_minmax(0,1fr)_auto]">
                <Field label={t('legal_search.source_label', { defaultValue: 'Source' })}>
                  <Select
                    value={source}
                    onChange={(event) => setSource(event.target.value as SourceKind)}
                  >
                    <option value="all">
                      {t('legal_search.source_all', { defaultValue: 'Toutes les sources' })}
                    </option>
                    <option value="legifrance">
                      {t('legal_search.source_legifrance', { defaultValue: 'Légifrance' })}
                    </option>
                    <option value="judilibre">
                      {t('legal_search.source_judilibre', { defaultValue: 'Judilibre' })}
                    </option>
                  </Select>
                </Field>
                <Field label={t('legal_search.query_label', { defaultValue: 'Recherche' })}>
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void handleSearch()
                    }}
                    placeholder={t('legal_search.query_placeholder', {
                      defaultValue: 'Article 1240 code civil, responsabilité civile, 14-82.234...'
                    })}
                  />
                </Field>
                <div className="flex items-end">
                  <Button
                    disabled={!configured || isSearching || !query.trim()}
                    onClick={() => void handleSearch()}
                  >
                    {isSearching
                      ? t('common.loading')
                      : t('legal_search.search_action', { defaultValue: 'Rechercher' })}
                  </Button>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setShowFilters((value) => !value)}
                  className="text-xs font-semibold text-aurora transition hover:text-aurora/80"
                >
                  {showFilters
                    ? t('legal_search.filters_hide', { defaultValue: 'Masquer les filtres' })
                    : t('legal_search.filters_show', { defaultValue: 'Filtres avancés' })}
                </button>
              </div>

              {showFilters ? (
                <div className="grid gap-3 border-t border-[#e5e3da] pt-3 md:grid-cols-2">
                  {source === 'all' ? (
                    <Field label={t('legal_search.sort_label', { defaultValue: 'Tri' })}>
                      <Select
                        value={legifranceSort}
                        onChange={(event) =>
                          setLegifranceSort(event.target.value as LegifranceSort)
                        }
                      >
                        {LEGIFRANCE_SORT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ) : source === 'legifrance' ? (
                    <>
                      <Field label={t('legal_search.fond_label', { defaultValue: 'Fonds' })}>
                        <Select
                          value={fond}
                          onChange={(event) => setFond(event.target.value as LegifranceFond)}
                        >
                          {LEGIFRANCE_FOND_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label={t('legal_search.sort_label', { defaultValue: 'Tri' })}>
                        <Select
                          value={legifranceSort}
                          onChange={(event) =>
                            setLegifranceSort(event.target.value as LegifranceSort)
                          }
                        >
                          {LEGIFRANCE_SORT_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </>
                  ) : (
                    <>
                      <Field
                        label={t('legal_search.jurisdiction_label', {
                          defaultValue: 'Juridiction'
                        })}
                      >
                        <Select
                          value={juridiction}
                          onChange={(event) =>
                            setJuridiction(event.target.value as JudilibreJurisdiction | '')
                          }
                        >
                          <option value="">
                            {t('legal_search.any_option', { defaultValue: 'Toutes' })}
                          </option>
                          {JUDILIBRE_JURISDICTION_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label={t('legal_search.sort_label', { defaultValue: 'Tri' })}>
                        <Select
                          value={judilibreSort}
                          onChange={(event) =>
                            setJudilibreSort(event.target.value as JudilibreSort)
                          }
                        >
                          {JUDILIBRE_SORT_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label={t('legal_search.chamber_label', { defaultValue: 'Chambre' })}>
                        <Select
                          value={chambre}
                          onChange={(event) => setChambre(event.target.value)}
                        >
                          <option value="">
                            {t('legal_search.any_option', { defaultValue: 'Toutes' })}
                          </option>
                          {chambers.map((option) => (
                            <option key={option.code} value={option.code}>
                              {option.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label={t('legal_search.theme_label', { defaultValue: 'Matière' })}>
                        <Select value={theme} onChange={(event) => setTheme(event.target.value)}>
                          <option value="">
                            {t('legal_search.any_option', { defaultValue: 'Toutes' })}
                          </option>
                          {themes.map((option) => (
                            <option key={option.code} value={option.code}>
                              {option.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </>
                  )}
                  <Field label={t('legal_search.date_from_label', { defaultValue: 'Date début' })}>
                    <Input
                      type="date"
                      value={dateDebut}
                      onChange={(event) => setDateDebut(event.target.value)}
                    />
                  </Field>
                  <Field label={t('legal_search.date_to_label', { defaultValue: 'Date fin' })}>
                    <Input
                      type="date"
                      value={dateFin}
                      onChange={(event) => setDateFin(event.target.value)}
                    />
                  </Field>
                </div>
              ) : null}

              <p className="text-xs text-[#8a8a85]">
                {t('legal_search.environment_notice', {
                  defaultValue: 'Les résultats doivent être contrôlés avant usage professionnel.'
                })}
              </p>
            </Card>
          ) : null}

          {mode === 'verify' ? (
            <Card className="space-y-3">
              <Field
                label={t('legal_search.verify_label', {
                  defaultValue: 'Références à vérifier'
                })}
              >
                <textarea
                  value={referenceText}
                  onChange={(event) => setReferenceText(event.target.value)}
                  className="min-h-28 w-full rounded-lg border border-[#d1cfc6] bg-white px-3 py-2 text-sm text-[#1a1a1a] outline-none transition placeholder:text-[#8a8a85] focus:border-aurora focus:ring-2 focus:ring-aurora/35"
                  placeholder={t('legal_search.verify_placeholder', {
                    defaultValue:
                      'Collez un courrier, des conclusions ou une liste de références...'
                  })}
                />
              </Field>
              <Button
                disabled={!configured || isVerifying || !referenceText.trim()}
                onClick={() => void handleVerify()}
              >
                {isVerifying
                  ? t('common.loading')
                  : t('legal_search.verify_action', {
                      defaultValue: 'Vérifier les références'
                    })}
              </Button>
              {verificationError ? (
                <p className="text-sm text-red-500">{verificationError}</p>
              ) : null}
              <VerificationResults result={verificationResult} />
            </Card>
          ) : null}

          {mode === 'search' ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {searchError ? <p className="mb-3 text-sm text-red-500">{searchError}</p> : null}
              {searchResult ? (
                searchResult.results.length === 0 ? (
                  <p className="rounded-lg border border-[#e5e3da] bg-white px-3 py-2 text-sm text-[#5c5c5a]">
                    {t('legal_search.results_empty', { defaultValue: 'Aucun résultat.' })}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {searchResult.results.map((item) => (
                      <ResultButton
                        key={`${item.source}:${item.id}`}
                        item={item}
                        onOpen={handleOpen}
                      />
                    ))}
                  </div>
                )
              ) : null}
            </div>
          ) : null}
        </div>

        {mode === 'search' ? (
          <Card className="min-h-0 overflow-y-auto">
            <h2 className="mb-3 text-sm font-semibold text-[#1a1a1a]">
              {t('legal_search.consult_title', { defaultValue: 'Consultation' })}
            </h2>
            {isConsulting ? <p className="text-sm text-[#5c5c5a]">{t('common.loading')}</p> : null}
            {consultError ? <p className="text-sm text-red-500">{consultError}</p> : null}
            {consultResult ? (
              <article className="space-y-3">
                <div>
                  <div className="flex items-center gap-2">
                    <SourceBadge source={consultResult.source} />
                    {consultResult.url ? (
                      <button
                        type="button"
                        onClick={() => {
                          void getOrdicabApi()?.app.openExternal({
                            url: consultResult.url as string
                          })
                        }}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-aurora transition hover:text-aurora/80"
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                        {t('legal_search.consult_open_source', {
                          defaultValue: 'Ouvrir la source'
                        })}
                      </button>
                    ) : null}
                  </div>
                  <h3 className="mt-2 text-base font-semibold text-[#1a1a1a]">
                    {consultResult.title ?? consultResult.id}
                  </h3>
                  {consultResult.date ? (
                    <p className="text-xs text-[#8a8a85]">{consultResult.date.slice(0, 10)}</p>
                  ) : null}
                </div>
                {consultResult.text ? (
                  <div className="rounded-lg bg-[#f4f3ee] p-3 text-sm text-[#1a1a1a]">
                    <LegalText text={consultResult.text} pattern={highlightPattern} />
                  </div>
                ) : (
                  <p className="text-sm text-[#5c5c5a]">
                    {t('legal_search.consult_no_text', {
                      defaultValue:
                        'Aucun texte normalisé disponible. Le payload brut reste disponible côté debug.'
                    })}
                  </p>
                )}
              </article>
            ) : (
              <p className="text-sm text-[#5c5c5a]">
                {t('legal_search.consult_empty', {
                  defaultValue: 'Sélectionnez un résultat pour consulter le détail.'
                })}
              </p>
            )}
          </Card>
        ) : null}
      </div>
    </section>
  )
}
