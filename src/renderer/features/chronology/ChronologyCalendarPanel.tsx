import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { KeyDate } from '@shared/types'
import { useDossierStore, type ChronologyEntry } from '@renderer/stores'

import { CalendarNav } from './CalendarNav'
import { ChronologyCalendar } from './ChronologyCalendar'
import { getStoredCalendarMode, setStoredCalendarMode } from './calendarPrefs'
import type { CalendarCreateSlot, CalendarEvent, CalendarViewMode } from './calendarTypes'
import { EventDialog, type EventDialogInitial } from './EventDialog'

type PanelDialog =
  | { kind: 'create'; defaults: CalendarCreateSlot }
  | { kind: 'edit'; entry: ChronologyEntry }
  | null

interface ChronologyCalendarPanelProps {
  /** Entrées à afficher (chronologie complète, éventuellement filtrée par la surface). */
  entries: ChronologyEntry[]
  locale: string
  /**
   * Contexte dossier : les événements des autres dossiers sont atténués et la
   * création se fait dans ce dossier (nom fixe dans le dialogue).
   */
  focusDossier?: { id: string; name: string }
  disabled?: boolean
  onOpenDossier?: (dossierId: string) => void
  /**
   * Édition d'une échéance du dossier courant via l'éditeur riche de la
   * section (libellés configurés, facturation…) plutôt que le dialogue
   * générique du panneau.
   */
  onEditOwnKeyDate?: (keyDate: KeyDate) => void
  /** Convertit une échéance rattachée à un dossier en prestation (depuis le dialogue). */
  onConvertKeyDateToBilling?: (dossierId: string, keyDate: KeyDate) => void
}

/**
 * Vue calendrier de la chronologie, partagée entre l'accueil et la section
 * échéances d'un dossier : navigation, gestes (créer/déplacer/redimensionner)
 * et dialogue d'événement. Seuls le dimming et le dialogue varient selon le
 * contexte.
 */
export function ChronologyCalendarPanel({
  entries,
  locale,
  focusDossier,
  disabled,
  onOpenDossier,
  onEditOwnKeyDate,
  onConvertKeyDateToBilling
}: ChronologyCalendarPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const dossiers = useDossierStore((state) => state.dossiers)
  const updateChronologyKeyDate = useDossierStore((state) => state.updateChronologyKeyDate)
  const deleteChronologyKeyDate = useDossierStore((state) => state.deleteChronologyKeyDate)
  const upsertGeneralKeyDate = useDossierStore((state) => state.upsertGeneralKeyDate)
  const deleteGeneralKeyDate = useDossierStore((state) => state.deleteGeneralKeyDate)
  const saveChronologyEvent = useDossierStore((state) => state.saveChronologyEvent)

  const [calendarMode, setCalendarMode] = useState<CalendarViewMode>(
    () => getStoredCalendarMode() ?? 'working-week'
  )
  const [referenceDate, setReferenceDate] = useState<Date>(() => new Date())
  const [dialog, setDialog] = useState<PanelDialog>(null)

  const calendarEvents = useMemo<CalendarEvent[]>(
    () =>
      entries.map((entry) => ({
        id: `${entry.dossierId}-${entry.keyDate.uuid}`,
        date: entry.keyDate.date,
        time: entry.keyDate.time,
        duration: entry.keyDate.duration,
        label: entry.keyDate.label,
        tags: entry.keyDate.tags,
        isClosed: entry.keyDate.isClosed,
        subtitle: entry.isGeneral
          ? t('home.general_event_dossier_label', { defaultValue: 'Hors dossier' })
          : entry.dossierName,
        canEdit: !disabled,
        dimmed: focusDossier ? entry.dossierId !== focusDossier.id : false,
        payload: entry
      })),
    [entries, focusDossier, disabled, t]
  )

  /** Dossiers proposés à la création depuis l'accueil — même ordre que la sidebar. */
  const dossierOptions = useMemo(
    () =>
      dossiers
        .filter((d) => d.status !== 'completed' && d.status !== 'archived')
        .map((d) => ({ id: d.slug, name: d.name })),
    [dossiers]
  )

  const handleEventClick = (event: CalendarEvent): void => {
    const entry = event.payload as ChronologyEntry
    if (
      onEditOwnKeyDate &&
      focusDossier &&
      !entry.isGeneral &&
      entry.dossierId === focusDossier.id
    ) {
      onEditOwnKeyDate(entry.keyDate as KeyDate)
      return
    }
    setDialog({ kind: 'edit', entry })
  }

  /** Sauvegarde un événement modifié par geste (déplacement ou redimensionnement). */
  const saveGestureChange = (
    entry: ChronologyEntry,
    changes: { date?: string; time?: string; duration?: number }
  ): void => {
    const keyDate = entry.keyDate
    const next = {
      uuid: keyDate.uuid,
      label: keyDate.label,
      date: changes.date ?? keyDate.date,
      time: changes.time ?? keyDate.time,
      duration: changes.duration ?? keyDate.duration,
      tags: keyDate.tags,
      isClosed: keyDate.isClosed,
      note: keyDate.note
    }
    if (entry.isGeneral) {
      void upsertGeneralKeyDate(next)
    } else {
      void updateChronologyKeyDate({ ...next, dossierId: entry.dossierId })
    }
  }

  const handleDialogDelete = async (entry: ChronologyEntry): Promise<boolean> => {
    if (entry.isGeneral) {
      return deleteGeneralKeyDate({ keyDateUuid: entry.keyDate.uuid })
    }
    return deleteChronologyKeyDate({ dossierId: entry.dossierId, keyDateUuid: entry.keyDate.uuid })
  }

  /** Rattachement et valeurs initiales du dialogue selon le geste (création/édition). */
  const dialogContext =
    dialog === null
      ? null
      : dialog.kind === 'create'
        ? {
            initial: null as EventDialogInitial | null,
            createDefaults: dialog.defaults as CalendarCreateSlot | undefined,
            dossierId: focusDossier ? focusDossier.id : null,
            dossierName: focusDossier?.name,
            entry: null as ChronologyEntry | null,
            onDelete: undefined as (() => Promise<boolean>) | undefined
          }
        : {
            initial: dialog.entry.keyDate as EventDialogInitial,
            createDefaults: undefined as CalendarCreateSlot | undefined,
            dossierId: dialog.entry.isGeneral ? null : dialog.entry.dossierId,
            dossierName: dialog.entry.isGeneral
              ? t('home.general_event_dossier_label', { defaultValue: 'Hors dossier' })
              : dialog.entry.dossierName,
            entry: dialog.entry as ChronologyEntry,
            onDelete: (() => handleDialogDelete(dialog.entry)) as () => Promise<boolean>
          }

  return (
    <>
      <CalendarNav
        viewMode={calendarMode}
        referenceDate={referenceDate}
        locale={locale}
        onChangeViewMode={(mode) => {
          setCalendarMode(mode)
          setStoredCalendarMode(mode)
        }}
        onChangeReferenceDate={setReferenceDate}
      />
      <ChronologyCalendar
        events={calendarEvents}
        viewMode={calendarMode}
        referenceDate={referenceDate}
        locale={locale}
        onEventClick={handleEventClick}
        onCreateSlot={
          disabled ? undefined : (slot) => setDialog({ kind: 'create', defaults: slot })
        }
        onEventMove={(event, next) => saveGestureChange(event.payload as ChronologyEntry, next)}
        onEventResize={(event, duration) =>
          saveGestureChange(event.payload as ChronologyEntry, { duration })
        }
        onOverflowClick={(day) => {
          setReferenceDate(day)
          setCalendarMode('week')
          setStoredCalendarMode('week')
        }}
      />
      {dialogContext ? (
        <EventDialog
          initial={dialogContext.initial}
          createDefaults={dialogContext.createDefaults}
          dossierOptions={dossierOptions}
          dossierId={dialogContext.dossierId}
          dossierName={dialogContext.dossierName}
          currentDossierId={focusDossier?.id ?? null}
          disabled={disabled}
          onDismiss={() => setDialog(null)}
          onSave={(toDossierId, fields) =>
            saveChronologyEvent({
              fromDossierId: dialogContext.dossierId,
              toDossierId,
              fields
            })
          }
          onDelete={dialogContext.onDelete}
          onOpenDossier={onOpenDossier}
          onConvertToBillingItem={
            dialogContext.entry && !dialogContext.entry.isGeneral && onConvertKeyDateToBilling
              ? () =>
                  onConvertKeyDateToBilling(
                    dialogContext.entry!.dossierId,
                    dialogContext.entry!.keyDate as KeyDate
                  )
              : undefined
          }
          isBilled={Boolean(
            dialogContext.entry &&
            !dialogContext.entry.isGeneral &&
            dialogContext.entry.billingItemUuids.length > 0
          )}
        />
      ) : null}
    </>
  )
}
