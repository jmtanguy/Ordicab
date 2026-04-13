import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { normalizeManagedFieldsConfig } from '@shared/managedFields'
import { labelToKey } from '@shared/templateContent'

import { useEntityStore } from '@renderer/stores'

import { roleToTagKey } from '../dossiers/rolePresets'
import { getTagCatalog, TAG_GROUPS, type TagCatalogEntry, type TagGroup } from './tagCatalog'

interface TagReferencePanelProps {
  onInsertTag: (tag: string) => void
  referenceMode?: boolean
}

const groupLabelKeys: Record<TagGroup, string> = {
  dossier: 'templates.tagPanel.groups.dossier',
  contact: 'templates.tagPanel.groups.contact',
  entity: 'templates.tagPanel.groups.entity',
  keyDates: 'templates.tagPanel.groups.keyDates',
  keyRefs: 'templates.tagPanel.groups.keyRefs',
  system: 'templates.tagPanel.groups.system'
}

const GROUP_DISPLAY_ORDER: TagGroup[] = [
  'keyRefs',
  'keyDates',
  'contact',
  'dossier',
  'entity',
  'system'
]

const TAG_BUTTON_CLASS =
  'flex w-full items-baseline gap-2 rounded-lg border border-white/10 bg-slate-900/70 px-2.5 py-1.5 text-left transition-all duration-300 hover:border-aurora/45 hover:bg-slate-900'

const ROLE_TAG_RE = /^\{\{contact\.([^.{}]+)\.[^.{}]+\}\}$/

function getRoleKey(tag: string): string | null {
  const match = ROLE_TAG_RE.exec(tag)
  return match ? (match[1] ?? null) : null
}

function applyDynamicLabel(tag: string, key: string): string {
  return tag.replace('<label>', key)
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
          ? 'border-emerald-400/60 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(52,211,153,0.25)] translate-x-1'
          : ''
      }`}
    >
      <span
        className={`shrink-0 font-mono text-sm transition-colors duration-300 ${
          isCopied ? 'text-emerald-200' : 'text-aurora-soft'
        }`}
      >
        {tag}
      </span>
      <span
        className={`truncate text-sm transition-colors duration-300 ${
          isCopied ? 'text-emerald-100/90' : 'text-slate-400'
        }`}
      >
        {description}
      </span>
    </button>
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
  const managedFields = normalizeManagedFieldsConfig(profile?.managedFields, profile?.profession)
  const catalog = getTagCatalog(profile?.profession, managedFields)

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
  const [keyRefLabel, setKeyRefLabel] = useState('')
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

  function handleTagAction(tag: string): void {
    onInsertTag(tag)

    if (referenceMode) {
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

  return (
    <section className="flex h-full min-h-0 flex-col gap-3 rounded-2xl border border-white/10 bg-slate-950/50 p-3">
      <div>
        <h4 className="text-sm font-semibold text-slate-50">
          {referenceMode ? t('templates.macros.title') : t('templates.tagPanel.title')}
        </h4>
        <p className="mt-1 text-sm text-slate-400">
          {referenceMode ? t('templates.macros.helperText') : t('templates.tagPanel.helperText')}
        </p>
      </div>

      <input
        type="search"
        value={filterText}
        onChange={(event) => setFilterText(event.target.value)}
        placeholder={t('templates.tagPanel.filterPlaceholder')}
        className="shrink-0 rounded-lg border border-white/10 bg-slate-900/70 px-2.5 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-aurora/45 focus:ring-1 focus:ring-aurora/25"
      />

      {filteredEntries ? (
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {filteredEntries.length === 0 ? (
            <p className="px-1 text-sm text-slate-500">{t('templates.tagPanel.filterEmpty')}</p>
          ) : (
            filteredEntries.map((entry) => (
              <TagButton
                key={entry.tag}
                tag={localizedTag(entry)}
                description={localizedDescription(entry)}
                isCopied={copiedTag === localizedTag(entry)}
                onClick={() => handleTagAction(localizedTag(entry))}
              />
            ))
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-7 overflow-y-auto">
          {orderedGroups.map((group) => {
            const entries = catalog.filter((entry) => entry.group === group)

            if (entries.length === 0) {
              return null
            }

            if (group === 'contact') {
              const primaryEntries = entries.filter((entry) => getRoleKey(entry.tag) === null)
              const roleEntries = entries.filter((entry) => getRoleKey(entry.tag) !== null)
              const previewRoleKey = contactRoleLabel.trim() ? roleToTagKey(contactRoleLabel) : ''
              const previewEntries = previewRoleKey
                ? roleEntries.filter((entry) => getRoleKey(entry.tag) === previewRoleKey)
                : primaryEntries

              return (
                <div key={group} className="space-y-1.5">
                  <h5 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                    {t(groupLabelKeys[group])}
                  </h5>

                  <div className="space-y-1">
                    <div className="space-y-1 pt-0.5">
                      {managedFields.contactRoles.length > 0 || roleEntries.length > 0 ? (
                        <>
                          <p className="px-0.5 text-xs text-slate-500">
                            {t('templates.tagPanel.contactRoleHint')}
                          </p>
                          <input
                            type="text"
                            value={contactRoleLabel}
                            onChange={(event) => setContactRoleLabel(event.target.value)}
                            placeholder={t('templates.tagPanel.contactRolePlaceholder')}
                            className="rounded-lg border border-white/10 bg-slate-900/70 px-2.5 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-aurora/45 focus:ring-1 focus:ring-aurora/25"
                          />
                          {managedFields.contactRoles.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {managedFields.contactRoles.map((role) => (
                                <button
                                  key={role}
                                  type="button"
                                  onClick={() => setContactRoleLabel(role)}
                                  className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300 transition hover:border-aurora/40 hover:text-slate-50"
                                >
                                  {role}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </>
                      ) : null}
                      {previewEntries
                        .filter((entry) => !entry.subGroup)
                        .map((entry) => (
                          <TagButton
                            key={entry.tag}
                            tag={localizedTag(entry)}
                            description={localizedDescription(entry)}
                            isCopied={copiedTag === localizedTag(entry)}
                            onClick={() => handleTagAction(localizedTag(entry))}
                          />
                        ))}
                      {previewEntries.some((entry) => entry.subGroup === 'identity') ? (
                        <div className="space-y-0.5 pt-0.5">
                          <p className="px-0.5 text-xs text-slate-500">
                            {t('templates.tagPanel.subGroup.identity')}
                          </p>
                          {previewEntries
                            .filter((entry) => entry.subGroup === 'identity')
                            .map((entry) => (
                              <TagButton
                                key={entry.tag}
                                tag={localizedTag(entry)}
                                description={localizedDescription(entry)}
                                isCopied={copiedTag === localizedTag(entry)}
                                onClick={() => handleTagAction(localizedTag(entry))}
                              />
                            ))}
                        </div>
                      ) : null}
                      {previewEntries
                        .filter((entry) => !entry.subGroup)
                        .map((entry) => (
                          <TagButton
                            key={entry.tag}
                            tag={localizedTag(entry)}
                            description={localizedDescription(entry)}
                            isCopied={copiedTag === localizedTag(entry)}
                            onClick={() => handleTagAction(localizedTag(entry))}
                          />
                        ))}
                      {previewEntries.some((entry) => entry.subGroup === 'salutation') ? (
                        <div className="space-y-0.5 pt-0.5">
                          <p className="px-0.5 text-xs text-slate-500">
                            {t('templates.tagPanel.subGroup.salutation')}
                          </p>
                          {previewEntries
                            .filter((entry) => entry.subGroup === 'salutation')
                            .map((entry) => (
                              <TagButton
                                key={entry.tag}
                                tag={localizedTag(entry)}
                                description={localizedDescription(entry)}
                                isCopied={copiedTag === localizedTag(entry)}
                                onClick={() => handleTagAction(localizedTag(entry))}
                              />
                            ))}
                        </div>
                      ) : null}
                      {previewEntries.some((entry) => entry.subGroup === 'address') ? (
                        <div className="space-y-0.5 pt-0.5">
                          <p className="px-0.5 text-xs text-slate-500">
                            {t('templates.tagPanel.subGroup.address')}
                          </p>
                          {previewEntries
                            .filter((entry) => entry.subGroup === 'address')
                            .map((entry) => (
                              <TagButton
                                key={entry.tag}
                                tag={localizedTag(entry)}
                                description={localizedDescription(entry)}
                                isCopied={copiedTag === localizedTag(entry)}
                                onClick={() => handleTagAction(localizedTag(entry))}
                              />
                            ))}
                        </div>
                      ) : null}
                      {previewEntries.some((entry) => entry.subGroup === 'personalInfo') ? (
                        <div className="space-y-0.5 pt-0.5">
                          <p className="px-0.5 text-xs text-slate-500">
                            {t('contacts.form.personalInfo')}
                          </p>
                          {previewEntries
                            .filter((entry) => entry.subGroup === 'personalInfo')
                            .map((entry) => (
                              <TagButton
                                key={entry.tag}
                                tag={localizedTag(entry)}
                                description={localizedDescription(entry)}
                                isCopied={copiedTag === localizedTag(entry)}
                                onClick={() => handleTagAction(localizedTag(entry))}
                              />
                            ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              )
            }

            if (group === 'keyDates' || group === 'keyRefs') {
              const isKeyDates = group === 'keyDates'
              const label = isKeyDates ? keyDateLabel : keyRefLabel
              const setLabel = isKeyDates ? setKeyDateLabel : setKeyRefLabel
              const previewKey = label.trim() ? labelToKey(label.trim()) : null
              const previewEntries = previewKey
                ? entries.map((entry) => ({
                    tag: applyDynamicLabel(localizedTag(entry), previewKey),
                    description: localizedDescription(entry)
                  }))
                : []
              const configuredDefinitions = isKeyDates
                ? managedFields.keyDates
                : managedFields.keyReferences

              return (
                <div key={group} className="space-y-1.5">
                  <h5 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                    {t(groupLabelKeys[group])}
                  </h5>
                  <p className="text-xs text-slate-500">{t('templates.tagPanel.keyLabelHint')}</p>
                  <input
                    type="text"
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    placeholder={t('templates.tagPanel.keyLabelPlaceholder')}
                    className="rounded-lg border border-white/10 bg-slate-900/70 px-2.5 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-aurora/45 focus:ring-1 focus:ring-aurora/25"
                  />
                  {configuredDefinitions.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {configuredDefinitions.map((definition) => (
                        <button
                          key={`${group}-${definition.label}`}
                          type="button"
                          onClick={() => setLabel(definition.label)}
                          className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300 transition hover:border-aurora/40 hover:text-slate-50"
                        >
                          {definition.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {previewEntries.map((entry) => (
                    <TagButton
                      key={entry.tag}
                      tag={entry.tag}
                      description={entry.description}
                      isCopied={copiedTag === entry.tag}
                      onClick={() => handleTagAction(entry.tag)}
                    />
                  ))}
                </div>
              )
            }

            return (
              <div key={group} className="space-y-1.5">
                <h5 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  {t(groupLabelKeys[group])}
                </h5>

                <div className="space-y-1">
                  {entries
                    .filter((entry) => !entry.subGroup)
                    .map((entry) => (
                      <TagButton
                        key={entry.tag}
                        tag={localizedTag(entry)}
                        description={localizedDescription(entry)}
                        isCopied={copiedTag === localizedTag(entry)}
                        onClick={() => handleTagAction(localizedTag(entry))}
                      />
                    ))}

                  {entries.some((entry) => entry.subGroup === 'address') ? (
                    <div className="space-y-0.5 pt-0.5">
                      <p className="px-0.5 text-xs text-slate-500">
                        {t('templates.tagPanel.subGroup.address')}
                      </p>
                      {entries
                        .filter((entry) => entry.subGroup === 'address')
                        .map((entry) => (
                          <TagButton
                            key={entry.tag}
                            tag={localizedTag(entry)}
                            description={localizedDescription(entry)}
                            isCopied={copiedTag === localizedTag(entry)}
                            onClick={() => handleTagAction(localizedTag(entry))}
                          />
                        ))}
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
