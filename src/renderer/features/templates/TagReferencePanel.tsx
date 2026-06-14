import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { normalizeManagedFieldsConfig } from '@shared/managedFields'
import { labelToKey } from '@shared/templateContent'

import { useEntityStore } from '@renderer/stores'

import { roleToTagKey } from '../dossiers/rolePresets'
import { getTagCatalog, TAG_GROUPS, type TagCatalogEntry, type TagGroup } from './tagCatalog'

interface TagReferencePanelProps {
  onInsertTag: (tag: string) => void | Promise<boolean | void>
  referenceMode?: boolean
}

const groupLabelKeys: Record<TagGroup, string> = {
  dossier: 'templates.tagPanel.groups.dossier',
  contact: 'templates.tagPanel.groups.contact',
  entity: 'templates.tagPanel.groups.entity',
  keyDates: 'templates.tagPanel.groups.keyDates',
  feeAgreement: 'templates.tagPanel.groups.feeAgreement',
  invoice: 'templates.tagPanel.groups.invoice',
  system: 'templates.tagPanel.groups.system'
}

const GROUP_DISPLAY_ORDER: TagGroup[] = [
  'keyDates',
  'contact',
  'dossier',
  'entity',
  'system',
  'feeAgreement'
]

const TAG_BUTTON_CLASS =
  'flex w-full items-baseline gap-2 rounded-lg border border-hairline bg-parchment px-2.5 py-1.5 text-left transition-all duration-300 hover:border-aurora/45 hover:bg-parchment'

const ROLE_TAG_RE = /^\{\{contact\.([^.{}]+)\.[^.{}]+\}\}$/

function CopyIcon(): React.JSX.Element {
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
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function CheckIcon(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function getRoleKey(tag: string): string | null {
  const match = ROLE_TAG_RE.exec(tag)
  return match ? (match[1] ?? null) : null
}

function applyDynamicLabel(tag: string, key: string): string {
  return tag.replace('<label>', key)
}

// When no chronology label is typed, strip the `.<label>` placeholder so the
// button reads e.g. `{{date.formate}}` instead of `{{date.<label>.formate}}`.
// The author inserts the placeholder tag and is expected to fill the label
// segment manually in the editor later.
function stripLabelPlaceholder(tag: string): string {
  return tag.replace('.<label>', '').replace('<label>.', '').replace('<label>', '')
}

function TagButton({
  description,
  isCopied = false,
  tag,
  onClick
}: {
  description: string
  isCopied?: boolean
  tag: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      data-copied={isCopied ? 'true' : 'false'}
      className={`${TAG_BUTTON_CLASS} ${
        isCopied
          ? 'border-success-border bg-success-tint shadow-[0_0_0_1px_rgba(79,121,66,0.25)] translate-x-1'
          : ''
      }`}
    >
      <span
        className={`shrink-0 font-mono text-sm transition-colors duration-300 ${
          isCopied ? 'text-success-deep' : 'text-aurora-soft'
        }`}
      >
        {tag}
      </span>
      <span
        className={`min-w-0 flex-1 truncate text-sm transition-colors duration-300 ${
          isCopied ? 'text-success-deep/90' : 'text-ink-muted'
        }`}
      >
        {description}
      </span>
      <span
        className={`ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors duration-300 ${
          isCopied ? 'bg-[#dfead6] text-success-deep' : 'text-ink-subtle'
        }`}
      >
        {isCopied ? <CheckIcon /> : <CopyIcon />}
      </span>
    </button>
  )
}

type SectionVariant = 'boxed' | 'flat'

interface PreviewEntry {
  tag: string
  description: string
}

// Visual atoms shared across the section components. `boxed` is the
// reference-panel look (floating panel with white card per group); `flat` is
// the inline editor sidebar (no card, headers in caps-tracking).

function SectionContainer({
  variant,
  children
}: {
  variant: SectionVariant
  children: ReactNode
}): React.JSX.Element {
  return variant === 'boxed' ? (
    <div className="rounded-lg border border-hairline bg-white p-3">{children}</div>
  ) : (
    <div className="space-y-1.5">{children}</div>
  )
}

function SectionHeader({
  variant,
  label,
  hint
}: {
  variant: SectionVariant
  label: string
  hint?: string
}): React.JSX.Element {
  if (variant === 'boxed') {
    return (
      <div className="mb-2">
        <p className="text-sm font-semibold text-ink">{label}</p>
        {hint ? <p className="text-xs text-ink-muted">{hint}</p> : null}
      </div>
    )
  }
  return (
    <>
      <h5 className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-muted">{label}</h5>
      {hint ? <p className="text-xs text-ink-subtle">{hint}</p> : null}
    </>
  )
}

function SectionInput({
  variant,
  value,
  onChange,
  placeholder
}: {
  variant: SectionVariant
  value: string
  onChange: (next: string) => void
  placeholder: string
}): React.JSX.Element {
  const base =
    'rounded-lg border border-hairline px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-ink-subtle focus:border-aurora/45 focus:ring-1 focus:ring-aurora/25'
  const surface = variant === 'boxed' ? 'w-full bg-white' : 'bg-parchment'
  return (
    <input
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={`${base} ${surface}`}
    />
  )
}

function ChipRow({
  variant,
  labels,
  onSelect,
  keyPrefix
}: {
  variant: SectionVariant
  labels: string[]
  onSelect: (label: string) => void
  keyPrefix: string
}): React.JSX.Element | null {
  if (labels.length === 0) return null
  const spacing = variant === 'boxed' ? 'mt-2' : ''
  return (
    <div className={`${spacing} flex flex-wrap gap-1`}>
      {labels.map((label) => (
        <button
          key={`${keyPrefix}-${label}`}
          type="button"
          onClick={() => onSelect(label)}
          className="rounded-full border border-hairline bg-parchment px-2 py-1 text-xs text-ink transition hover:border-aurora/40 hover:text-ink"
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function TagButtonList({
  variant,
  items,
  copiedTag,
  onAction
}: {
  variant: SectionVariant
  items: PreviewEntry[]
  copiedTag: string | null
  onAction: (tag: string) => void
}): React.JSX.Element | null {
  if (items.length === 0) return null
  if (variant === 'boxed') {
    return (
      <ul className="mt-2 divide-y divide-hairline">
        {items.map((entry) => (
          <li key={entry.tag} className="py-1.5">
            <TagButton
              tag={entry.tag}
              description={entry.description}
              isCopied={copiedTag === entry.tag}
              onClick={() => onAction(entry.tag)}
            />
          </li>
        ))}
      </ul>
    )
  }
  return (
    <>
      {items.map((entry) => (
        <TagButton
          key={entry.tag}
          tag={entry.tag}
          description={entry.description}
          isCopied={copiedTag === entry.tag}
          onClick={() => onAction(entry.tag)}
        />
      ))}
    </>
  )
}

function SubGroupBlock({
  title,
  hint,
  items,
  copiedTag,
  onAction
}: {
  title: string
  hint?: string
  items: PreviewEntry[]
  copiedTag: string | null
  onAction: (tag: string) => void
}): React.JSX.Element | null {
  if (items.length === 0) return null
  return (
    <div className="space-y-0.5 pt-0.5">
      <p className="px-0.5 text-xs text-ink-subtle">
        {title}
        {hint ? <span className="ml-1.5 italic text-[#a3a39e]">{hint}</span> : null}
      </p>
      {items.map((entry) => (
        <TagButton
          key={entry.tag}
          tag={entry.tag}
          description={entry.description}
          isCopied={copiedTag === entry.tag}
          onClick={() => onAction(entry.tag)}
        />
      ))}
    </div>
  )
}

// Section: chronology key dates. Without a label typed, shows 5 default variant
// placeholders ({{date}}, {{date.formate}}, .texte, .court, .libelle); with a
// label typed, substitutes the label into the 5 catalog entries.
function KeyDatesSection({
  variant,
  entries,
  label,
  setLabel,
  configuredLabels,
  localizedTag,
  localizedDescription,
  copiedTag,
  onAction
}: {
  variant: SectionVariant
  entries: TagCatalogEntry[]
  label: string
  setLabel: (next: string) => void
  configuredLabels: string[]
  localizedTag: (entry: TagCatalogEntry) => string
  localizedDescription: (entry: TagCatalogEntry) => string
  copiedTag: string | null
  onAction: (tag: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const previewKey = label.trim() ? labelToKey(label.trim()) : null
  const previewEntries: PreviewEntry[] = previewKey
    ? entries.map((entry) => ({
        tag: applyDynamicLabel(localizedTag(entry), previewKey),
        description: localizedDescription(entry)
      }))
    : entries.map((entry) => ({
        tag: stripLabelPlaceholder(localizedTag(entry)),
        description: localizedDescription(entry)
      }))

  return (
    <SectionContainer variant={variant}>
      <SectionHeader
        variant={variant}
        label={t(groupLabelKeys.keyDates)}
        hint={t('templates.tagPanel.keyLabelHint')}
      />
      <SectionInput
        variant={variant}
        value={label}
        onChange={setLabel}
        placeholder={t('templates.tagPanel.keyLabelPlaceholder')}
      />
      <ChipRow
        variant={variant}
        labels={configuredLabels}
        onSelect={setLabel}
        keyPrefix="keyDates"
      />
      <TagButtonList
        variant={variant}
        items={previewEntries}
        copiedTag={copiedTag}
        onAction={onAction}
      />
    </SectionContainer>
  )
}

// Section: contacts. With a role typed, shows that role's tags; otherwise the
// primary-contact tags. In both variants, entries are split by subGroup
// (identity, salutation, address, personalInfo) for readability.
function ContactSection({
  variant,
  entries,
  roleLabel,
  setRoleLabel,
  configuredRoles,
  localizedTag,
  localizedDescription,
  copiedTag,
  onAction
}: {
  variant: SectionVariant
  entries: TagCatalogEntry[]
  roleLabel: string
  setRoleLabel: (next: string) => void
  configuredRoles: string[]
  localizedTag: (entry: TagCatalogEntry) => string
  localizedDescription: (entry: TagCatalogEntry) => string
  copiedTag: string | null
  onAction: (tag: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const primaryEntries = entries.filter((entry) => getRoleKey(entry.tag) === null)
  const roleEntries = entries.filter((entry) => getRoleKey(entry.tag) !== null)
  const previewRoleKey = roleLabel.trim() ? roleToTagKey(roleLabel) : ''
  const previewEntries = previewRoleKey
    ? roleEntries.filter((entry) => getRoleKey(entry.tag) === previewRoleKey)
    : primaryEntries
  const hasRoles = configuredRoles.length > 0 || roleEntries.length > 0

  const toPreview = (entry: TagCatalogEntry): PreviewEntry => ({
    tag: localizedTag(entry),
    description: localizedDescription(entry)
  })

  const noSubGroup = previewEntries.filter((entry) => !entry.subGroup).map(toPreview)
  const identityItems = previewEntries
    .filter((entry) => entry.subGroup === 'identity')
    .map(toPreview)
  const salutationItems = previewEntries
    .filter((entry) => entry.subGroup === 'salutation')
    .map(toPreview)
  const addressItems = previewEntries.filter((entry) => entry.subGroup === 'address').map(toPreview)
  const personalInfoItems = previewEntries
    .filter((entry) => entry.subGroup === 'personalInfo')
    .map(toPreview)

  return (
    <SectionContainer variant={variant}>
      <SectionHeader
        variant={variant}
        label={t(groupLabelKeys.contact)}
        hint={hasRoles ? t('templates.tagPanel.contactRoleHint') : undefined}
      />
      {hasRoles ? (
        <>
          <SectionInput
            variant={variant}
            value={roleLabel}
            onChange={setRoleLabel}
            placeholder={t('templates.tagPanel.contactRolePlaceholder')}
          />
          <ChipRow
            variant={variant}
            labels={configuredRoles}
            onSelect={setRoleLabel}
            keyPrefix="contact"
          />
        </>
      ) : null}
      <TagButtonList
        variant={variant}
        items={noSubGroup}
        copiedTag={copiedTag}
        onAction={onAction}
      />
      <SubGroupBlock
        title={t('templates.tagPanel.subGroup.identity')}
        items={identityItems}
        copiedTag={copiedTag}
        onAction={onAction}
      />
      <SubGroupBlock
        title={t('templates.tagPanel.subGroup.salutation')}
        items={salutationItems}
        copiedTag={copiedTag}
        onAction={onAction}
      />
      <SubGroupBlock
        title={t('templates.tagPanel.subGroup.address')}
        items={addressItems}
        copiedTag={copiedTag}
        onAction={onAction}
      />
      <SubGroupBlock
        title={t('contacts.form.personalInfo')}
        hint={t('templates.tagPanel.subGroup.personalInfoHint')}
        items={personalInfoItems}
        copiedTag={copiedTag}
        onAction={onAction}
      />
    </SectionContainer>
  )
}

// Section: any other group (dossier, entity, system, invoice, feeAgreement).
// Flat list of all entries; subGroup partitioning is contact-specific.
function DefaultSection({
  variant,
  group,
  entries,
  localizedTag,
  localizedDescription,
  copiedTag,
  onAction
}: {
  variant: SectionVariant
  group: TagGroup
  entries: TagCatalogEntry[]
  localizedTag: (entry: TagCatalogEntry) => string
  localizedDescription: (entry: TagCatalogEntry) => string
  copiedTag: string | null
  onAction: (tag: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const items: PreviewEntry[] = entries.map((entry) => ({
    tag: localizedTag(entry),
    description: localizedDescription(entry)
  }))

  return (
    <SectionContainer variant={variant}>
      <SectionHeader variant={variant} label={t(groupLabelKeys[group])} />
      <TagButtonList variant={variant} items={items} copiedTag={copiedTag} onAction={onAction} />
    </SectionContainer>
  )
}

export function TagReferencePanel({
  onInsertTag,
  referenceMode = false
}: TagReferencePanelProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isFr = i18n.language === 'fr'
  const profile = useEntityStore((state) => state.profile)
  const loadProfile = useEntityStore((state) => state.load)
  const managedFields = normalizeManagedFieldsConfig(profile?.managedFields)
  const catalog = getTagCatalog(managedFields)

  function localizedTag(entry: TagCatalogEntry): string {
    return isFr && entry.tagFr ? entry.tagFr : entry.tag
  }

  function localizedDescription(entry: TagCatalogEntry): string {
    return isFr && entry.descriptionFr ? entry.descriptionFr : entry.description
  }

  useEffect(() => {
    void loadProfile()
  }, [loadProfile])

  const [filterText, setFilterText] = useState('')
  const [keyDateLabel, setKeyDateLabel] = useState('')
  const [contactRoleLabel, setContactRoleLabel] = useState('')
  const [copiedTag, setCopiedTag] = useState<string | null>(null)

  useEffect(() => {
    if (!copiedTag) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setCopiedTag((current) => (current === copiedTag ? null : current))
    }, 650)

    return () => window.clearTimeout(timeoutId)
  }, [copiedTag])

  async function handleTagAction(tag: string): Promise<void> {
    const result = await onInsertTag(tag)

    if (referenceMode && result !== false) {
      setCopiedTag(tag)
    }
  }

  const filter = filterText.trim().toLowerCase()

  const filteredEntries = filter
    ? catalog
        .filter((entry) => {
          const tag = localizedTag(entry).toLowerCase()
          const description = localizedDescription(entry).toLowerCase()
          return tag.includes(filter) || description.includes(filter)
        })
        .sort((a, b) => {
          const aIndex = GROUP_DISPLAY_ORDER.indexOf(a.group)
          const bIndex = GROUP_DISPLAY_ORDER.indexOf(b.group)
          return aIndex - bIndex
        })
    : null

  const orderedGroups = useMemo(() => {
    const remaining = TAG_GROUPS.filter((group) => !GROUP_DISPLAY_ORDER.includes(group))
    return [...GROUP_DISPLAY_ORDER, ...remaining]
  }, [])

  const variant: SectionVariant = referenceMode ? 'boxed' : 'flat'

  // Single render path: only the outer chrome (search bar layout, container)
  // differs between referenceMode and inline mode. The grouped sections share
  // one implementation via the *Section components above.
  function renderGroupedSections(): React.JSX.Element {
    return (
      <>
        {orderedGroups.map((group) => {
          const entries = catalog.filter((entry) => entry.group === group)
          if (entries.length === 0) return null

          if (group === 'keyDates') {
            return (
              <KeyDatesSection
                key={group}
                variant={variant}
                entries={entries}
                label={keyDateLabel}
                setLabel={setKeyDateLabel}
                configuredLabels={managedFields.keyDates.map((definition) => definition.label)}
                localizedTag={localizedTag}
                localizedDescription={localizedDescription}
                copiedTag={copiedTag}
                onAction={(tag) => void handleTagAction(tag)}
              />
            )
          }

          if (group === 'contact') {
            return (
              <ContactSection
                key={group}
                variant={variant}
                entries={entries}
                roleLabel={contactRoleLabel}
                setRoleLabel={setContactRoleLabel}
                configuredRoles={managedFields.contactRoles}
                localizedTag={localizedTag}
                localizedDescription={localizedDescription}
                copiedTag={copiedTag}
                onAction={(tag) => void handleTagAction(tag)}
              />
            )
          }

          return (
            <DefaultSection
              key={group}
              variant={variant}
              group={group}
              entries={entries}
              localizedTag={localizedTag}
              localizedDescription={localizedDescription}
              copiedTag={copiedTag}
              onAction={(tag) => void handleTagAction(tag)}
            />
          )
        })}
      </>
    )
  }

  if (referenceMode) {
    return (
      <div className="flex max-h-[80vh] min-h-0 flex-col gap-4">
        <input
          type="search"
          value={filterText}
          onChange={(event) => setFilterText(event.target.value)}
          placeholder={t('templates.tagPanel.filterPlaceholder')}
          className="w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm"
        />

        <div className="flex-1 overflow-y-auto pr-1">
          {filteredEntries ? (
            filteredEntries.length === 0 ? (
              <p className="rounded-lg border border-dashed border-hairline bg-white p-4 text-sm text-ink-muted">
                {t('templates.tagPanel.filterEmpty')}
              </p>
            ) : (
              <div className="rounded-lg border border-hairline bg-white p-3">
                <ul className="divide-y divide-hairline">
                  {filteredEntries.map((entry) => (
                    <li key={entry.tag} className="py-1.5">
                      <TagButton
                        tag={localizedTag(entry)}
                        description={localizedDescription(entry)}
                        isCopied={copiedTag === localizedTag(entry)}
                        onClick={() => void handleTagAction(localizedTag(entry))}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )
          ) : (
            <div className="flex flex-col gap-4">{renderGroupedSections()}</div>
          )}
        </div>
      </div>
    )
  }

  return (
    <section className="flex h-full min-h-0 flex-col gap-3 rounded-2xl border border-hairline bg-white p-3">
      <div>
        <h4 className="text-sm font-semibold text-ink">{t('templates.tagPanel.title')}</h4>
        <p className="mt-1 text-sm text-ink-muted">{t('templates.tagPanel.helperText')}</p>
      </div>

      <input
        type="search"
        value={filterText}
        onChange={(event) => setFilterText(event.target.value)}
        placeholder={t('templates.tagPanel.filterPlaceholder')}
        className="shrink-0 rounded-lg border border-hairline bg-parchment px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-ink-subtle focus:border-aurora/45 focus:ring-1 focus:ring-aurora/25"
      />

      {filteredEntries ? (
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {filteredEntries.length === 0 ? (
            <p className="px-1 text-sm text-ink-subtle">{t('templates.tagPanel.filterEmpty')}</p>
          ) : (
            filteredEntries.map((entry) => (
              <TagButton
                key={entry.tag}
                tag={localizedTag(entry)}
                description={localizedDescription(entry)}
                isCopied={copiedTag === localizedTag(entry)}
                onClick={() => void handleTagAction(localizedTag(entry))}
              />
            ))
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-7 overflow-y-auto">{renderGroupedSections()}</div>
      )}
    </section>
  )
}
