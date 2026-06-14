import { useMemo } from 'react'

import { previewInvoiceNumber } from '@shared/types'

import { useInvoiceStore } from '@renderer/stores/invoiceStore'
import { useTemplateStore } from '@renderer/stores/templateStore'

export function useInvoiceSettingsSummary(): string {
  const settings = useInvoiceStore((s) => s.settings)
  const templates = useTemplateStore((s) => s.templates)

  return useMemo(() => {
    if (!settings) return 'Chargement…'
    let preview: string
    try {
      preview = previewInvoiceNumber(settings, new Date())
    } catch {
      preview = settings.numberPattern
    }
    const tpl = settings.defaultTemplateUuid
      ? (templates.find((t) => t.uuid === settings.defaultTemplateUuid)?.name ?? '—')
      : 'aucun'
    return `Prochain n° ${preview} · Modèle par défaut : ${tpl}`
  }, [settings, templates])
}
