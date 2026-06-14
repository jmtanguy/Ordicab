/**
 * coworkExportService — one-click pseudonymized export of a dossier to a
 * `Cowork/` workspace that Claude Cowork can open, and re-import of its
 * deliverables with the original PII restored.
 *
 * Export writes Markdown only (dossier.md synthesis + documents/*.md from
 * extracted text + CLAUDE.md instructions): binaries cannot be reliably
 * pseudonymized, so they are inventoried but never copied. The PII mapping
 * produced by the export is merged into `.ordicab/pii-mapping.json` (never
 * inside Cowork/), which makes re-exports fake-stable and lets reimport
 * revert deliverables written to `resultats/`.
 */

import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'

import type {
  ContactRecord,
  CoworkExportProgress,
  CoworkExportResult,
  CoworkReimportResult,
  CoworkStatus,
  DocumentRecord,
  DossierDetail
} from '@shared/types'
import { IpcErrorCode } from '@shared/types'
import type { EntityProfile } from '@shared/validation/entity'

import { buildPiiPseudonymizer } from '../../lib/aiEmbedded/pii/piiContextBuilder'
import type { PiiPseudonymizer } from '../../lib/aiEmbedded/pii/piiPseudonymizer'
import { revertWithMappingEntries } from '../../lib/aiEmbedded/pii/piiMapping'
import {
  mergeMappingEntries,
  readDossierPiiMapping,
  writeDossierPiiMapping
} from '../../lib/aiEmbedded/pii/piiMappingStore'
import { readPiiPersonaMap } from '../../lib/aiEmbedded/pii/personaRegistry'
import { isModelPresent, NER_MODEL } from '../../lib/aiEmbedded/modelDownloadService'
import {
  getDossierCoworkClaudeMdPath,
  getDossierCoworkDocumentsPath,
  getDossierCoworkImportedResultsPath,
  getDossierCoworkPath,
  getDossierCoworkResultsPath,
  getDossierCoworkSynthesisPath
} from '../../lib/ordicab/ordicabPaths'
import { pathExists } from '../../lib/system/domainState'
import { buildCoworkInstructions } from '../../lib/aiDelegated/coworkInstructionsContent'
import { readAiSettings } from '../aiEmbedded/aiService'

const REIMPORT_TARGET_FOLDER = 'Résultats Cowork'
const REIMPORTABLE_EXTENSIONS = new Set(['.md', '.txt'])

export class CoworkServiceError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'CoworkServiceError'
  }
}

interface DossierServiceLike {
  getDossier(input: { dossierId: string }): Promise<DossierDetail>
  listRegisteredDossiers(): Promise<Array<{ name: string }>>
}

interface DocumentServiceLike {
  resolveRegisteredDossierRoot(input: { dossierId: string }): Promise<string>
  listDocuments(input: { dossierId: string }): Promise<DocumentRecord[]>
  extractContent(input: { dossierId: string; documentPath: string }): Promise<{ text: string }>
}

export interface CoworkExportServiceOptions {
  documentService: DocumentServiceLike
  contactService: { list(dossierId: string): Promise<ContactRecord[]> }
  dossierService: DossierServiceLike
  templateService: { list(): Promise<Array<{ name: string }>> }
  loadEntityProfile: () => Promise<EntityProfile | null>
  localeService: { getLocale(): string }
  stateFilePath: string
  nerModelPath?: string | null
  /** RGPD gate override for tests (see aiService.isNerModelReady). */
  isNerModelReady?: () => Promise<boolean>
}

export interface CoworkExportService {
  exportDossier(
    input: { dossierId: string },
    onProgress?: (progress: CoworkExportProgress) => void
  ): Promise<CoworkExportResult>
  reimportResults(input: { dossierId: string }): Promise<CoworkReimportResult>
  getStatus(input: { dossierId: string }): Promise<CoworkStatus>
}

function formatExportDate(locale: string): string {
  const resolvedLocale = locale === 'en' ? 'en-US' : 'fr-FR'
  return new Date().toLocaleDateString(resolvedLocale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}

/** Filesystem-safe single path segment (keeps accents, drops separators). */
function toSafePathSegment(value: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || 'document'
}

function formatContactLine(contact: ContactRecord): string[] {
  const lines: string[] = []
  const identity = [contact.title, contact.firstName, contact.lastName].filter(Boolean).join(' ')
  lines.push(`### ${contact.role || 'Contact'} — ${identity || contact.displayName || 'N/A'}`)
  if (contact.institution) lines.push(`- Institution : ${contact.institution}`)
  const address = [
    contact.addressLine,
    contact.addressLine2,
    contact.zipCode,
    contact.city,
    contact.country
  ]
    .filter(Boolean)
    .join(', ')
  if (address) lines.push(`- Adresse : ${address}`)
  if (contact.email) lines.push(`- Email : ${contact.email}`)
  if (contact.phone) lines.push(`- Téléphone : ${contact.phone}`)
  if (contact.information) lines.push(`- Informations : ${contact.information}`)
  return lines
}

interface ExportedDocumentEntry {
  record: DocumentRecord
  /** Pseudonymized relative path inside Cowork/documents/, null when not exported. */
  exportRelativePath: string | null
  pseudonymizedText: string | null
}

export function createCoworkExportService(
  options: CoworkExportServiceOptions
): CoworkExportService {
  const {
    documentService,
    contactService,
    dossierService,
    templateService,
    loadEntityProfile,
    localeService,
    stateFilePath,
    nerModelPath
  } = options

  const isNerModelReady =
    options.isNerModelReady ??
    (async () =>
      nerModelPath ? isModelPresent(nerModelPath, NER_MODEL).catch(() => false) : false)

  // Export / reimport / status calls for the same dossier are serialised so a
  // reimport never reads `resultats/` while an export is rewriting the folder.
  const dossierQueues = new Map<string, Promise<unknown>>()
  function enqueue<T>(dossierId: string, task: () => Promise<T>): Promise<T> {
    const previous = dossierQueues.get(dossierId) ?? Promise.resolve()
    const run = previous.then(task, task)
    dossierQueues.set(
      dossierId,
      run.catch(() => undefined)
    )
    return run
  }

  async function buildPseudonymizer(
    dossierPath: string,
    contacts: ContactRecord[],
    dossierDetail: DossierDetail,
    entityProfile: EntityProfile | null
  ): Promise<PiiPseudonymizer> {
    const locale = localeService.getLocale() === 'en' ? 'en' : 'fr'
    const [{ piiWordlist }, personas, persistedEntries, dossiers, templates] = await Promise.all([
      readAiSettings(stateFilePath),
      readPiiPersonaMap(stateFilePath),
      readDossierPiiMapping(dossierPath),
      dossierService.listRegisteredDossiers().catch(() => []),
      templateService.list().catch(() => [])
    ])

    return buildPiiPseudonymizer({
      contacts,
      dossierDetail,
      entityProfile,
      dossiers,
      templates,
      piiWordlist,
      currentDate: formatExportDate(locale),
      locale,
      nerModelPath,
      personas,
      priorEntries: persistedEntries
    })
  }

  async function pseudonymizeExportPath(
    piiPseudo: PiiPseudonymizer,
    relativePath: string,
    takenPaths: Set<string>
  ): Promise<string> {
    const segments = relativePath.split('/')
    const filename = segments.pop() ?? relativePath
    const extension = extname(filename)
    const stem = filename.slice(0, filename.length - extension.length)

    const pseudoSegments: string[] = []
    for (const segment of segments) {
      pseudoSegments.push(toSafePathSegment(await piiPseudo.pseudonymizeAsync(segment)))
    }
    const pseudoStem = toSafePathSegment(await piiPseudo.pseudonymizeAsync(stem))

    const base = [...pseudoSegments, pseudoStem].join('/')
    let candidate = `${base}.md`
    for (let attempt = 2; takenPaths.has(candidate); attempt++) {
      candidate = `${base}-${attempt}.md`
    }
    takenPaths.add(candidate)
    return candidate
  }

  function buildSynthesisMarkdown(
    dossierDetail: DossierDetail,
    contacts: ContactRecord[],
    documents: ExportedDocumentEntry[]
  ): string {
    const lines: string[] = []

    lines.push(`# Dossier — ${dossierDetail.name}`, '')
    lines.push('## Métadonnées', '')
    lines.push(`- Type : ${dossierDetail.type || 'N/A'}`)
    lines.push(`- Statut : ${dossierDetail.status}`)
    if (dossierDetail.juridiction) lines.push(`- Juridiction : ${dossierDetail.juridiction}`)
    if (dossierDetail.tribunal) lines.push(`- Tribunal : ${dossierDetail.tribunal}`)
    if (dossierDetail.description) lines.push(`- Description : ${dossierDetail.description}`)
    if (dossierDetail.information) lines.push('', dossierDetail.information)

    if (contacts.length > 0) {
      lines.push('', '## Parties et contacts', '')
      for (const contact of contacts) {
        lines.push(...formatContactLine(contact), '')
      }
    }

    if (dossierDetail.keyDates.length > 0) {
      lines.push('', '## Dates clés', '')
      for (const keyDate of dossierDetail.keyDates) {
        const time = keyDate.time ? ` ${keyDate.time}` : ''
        const note = keyDate.note ? ` — ${keyDate.note}` : ''
        lines.push(`- ${keyDate.date}${time} : ${keyDate.label}${note}`)
      }
    }

    if (dossierDetail.keyReferences.length > 0) {
      lines.push('', '## Références clés', '')
      for (const keyReference of dossierDetail.keyReferences) {
        const note = keyReference.note ? ` — ${keyReference.note}` : ''
        lines.push(`- ${keyReference.label} : ${keyReference.value}${note}`)
      }
    }

    if (dossierDetail.notes.length > 0) {
      lines.push('', '## Notes', '')
      for (const note of dossierDetail.notes) {
        lines.push(`### ${note.title}`, '')
        if (note.content) lines.push(note.content, '')
      }
    }

    lines.push('', '## Inventaire des documents', '')
    if (documents.length === 0) {
      lines.push('Aucun document dans ce dossier.')
    }
    for (const entry of documents) {
      if (entry.exportRelativePath) {
        lines.push(`- ${entry.record.relativePath} → \`documents/${entry.exportRelativePath}\``)
      } else {
        lines.push(`- ${entry.record.relativePath} — non extrait (fichier binaire non copié)`)
      }
    }

    return `${lines.join('\n')}\n`
  }

  async function exportDossierInner(
    dossierId: string,
    onProgress?: (progress: CoworkExportProgress) => void
  ): Promise<CoworkExportResult> {
    const dossierPath = await documentService.resolveRegisteredDossierRoot({ dossierId })

    // RGPD gate: same rule as the embedded assistant — when the NER model is
    // configured it must be ready, otherwise detection silently degrades to
    // regex-only and the export could leak under-redacted text.
    if (nerModelPath && !(await isNerModelReady())) {
      throw new CoworkServiceError(
        IpcErrorCode.AI_RUNTIME_UNAVAILABLE,
        'PII protection is still downloading. Export is paused until it finishes.'
      )
    }

    const [dossierDetail, contacts, documents, entityProfile] = await Promise.all([
      dossierService.getDossier({ dossierId }),
      contactService.list(dossierId).catch(() => [] as ContactRecord[]),
      documentService.listDocuments({ dossierId }).catch(() => [] as DocumentRecord[]),
      loadEntityProfile().catch(() => null)
    ])

    const piiPseudo = await buildPseudonymizer(dossierPath, contacts, dossierDetail, entityProfile)

    // Extract and pseudonymize every document that has extractable text.
    const exportedDocuments: ExportedDocumentEntry[] = []
    const takenPaths = new Set<string>()
    for (const [index, record] of documents.entries()) {
      onProgress?.({
        dossierId,
        current: index + 1,
        total: documents.length,
        filename: record.filename
      })

      if (!record.textExtraction.isExtractable) {
        exportedDocuments.push({ record, exportRelativePath: null, pseudonymizedText: null })
        continue
      }

      try {
        const { text } = await documentService.extractContent({
          dossierId,
          documentPath: record.relativePath
        })
        if (!text.trim()) {
          exportedDocuments.push({ record, exportRelativePath: null, pseudonymizedText: null })
          continue
        }
        const exportRelativePath = await pseudonymizeExportPath(
          piiPseudo,
          record.relativePath,
          takenPaths
        )
        exportedDocuments.push({
          record,
          exportRelativePath,
          pseudonymizedText: await piiPseudo.pseudonymizeAsync(text)
        })
      } catch {
        // Extraction failure → inventory-only entry; the export must not fail
        // because one PDF resists OCR.
        exportedDocuments.push({ record, exportRelativePath: null, pseudonymizedText: null })
      }
    }

    // Synthesis is built in clear text from data the pseudonymizer was seeded
    // with, then pseudonymized in a single pass.
    const synthesisClear = buildSynthesisMarkdown(dossierDetail, contacts, exportedDocuments)
    const synthesis = await piiPseudo.pseudonymizeAsync(synthesisClear)
    const pseudoDossierName = await piiPseudo.pseudonymizeAsync(dossierDetail.name)

    // Regenerate dossier.md / documents/ / CLAUDE.md from scratch; never touch
    // resultats/ so work-in-progress deliverables survive a re-export.
    const coworkPath = getDossierCoworkPath(dossierPath)
    const documentsPath = getDossierCoworkDocumentsPath(dossierPath)
    await rm(documentsPath, { recursive: true, force: true })
    await rm(getDossierCoworkSynthesisPath(dossierPath), { force: true })
    await rm(getDossierCoworkClaudeMdPath(dossierPath), { force: true })
    await mkdir(coworkPath, { recursive: true })
    await mkdir(getDossierCoworkResultsPath(dossierPath), { recursive: true })

    const exportedAt = new Date().toISOString()
    await writeFile(getDossierCoworkSynthesisPath(dossierPath), synthesis, 'utf8')
    await writeFile(
      getDossierCoworkClaudeMdPath(dossierPath),
      buildCoworkInstructions({
        dossierName: pseudoDossierName,
        exportedAt: formatExportDate(localeService.getLocale())
      }),
      'utf8'
    )

    let documentCount = 0
    for (const entry of exportedDocuments) {
      if (!entry.exportRelativePath || entry.pseudonymizedText === null) continue
      const targetPath = join(documentsPath, ...entry.exportRelativePath.split('/'))
      await mkdir(dirname(targetPath), { recursive: true })
      const header = `# ${basename(entry.exportRelativePath, '.md')}\n\nPièce du dossier — texte extrait.\n\n---\n\n`
      await writeFile(targetPath, `${header}${entry.pseudonymizedText}\n`, 'utf8')
      documentCount += 1
    }

    // Persist the merged mapping so reimport can revert and the next export
    // (or the embedded assistant) reuses the same fakes.
    const persisted = await readDossierPiiMapping(dossierPath)
    await writeDossierPiiMapping(
      dossierPath,
      mergeMappingEntries(persisted, piiPseudo.exportMapping())
    )

    return {
      exportPath: coworkPath,
      exportedAt,
      documentCount,
      unextractedCount: exportedDocuments.length - documentCount,
      noteCount: dossierDetail.notes.length
    }
  }

  async function reimportResultsInner(dossierId: string): Promise<CoworkReimportResult> {
    const dossierPath = await documentService.resolveRegisteredDossierRoot({ dossierId })
    const entries = await readDossierPiiMapping(dossierPath)
    if (entries.length === 0) {
      throw new CoworkServiceError(
        IpcErrorCode.NOT_FOUND,
        'No PII mapping found for this dossier — export it to Claude Cowork first.'
      )
    }

    const resultsPath = getDossierCoworkResultsPath(dossierPath)
    const resultEntries = (await readdir(resultsPath, { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort()

    const targetFolder = join(dossierPath, REIMPORT_TARGET_FOLDER)
    const importedFolder = getDossierCoworkImportedResultsPath(dossierPath)
    const imported: CoworkReimportResult['imported'] = []
    const manual: CoworkReimportResult['manual'] = []

    for (const filename of resultEntries) {
      const extension = extname(filename).toLowerCase()
      if (!REIMPORTABLE_EXTENSIONS.has(extension)) {
        manual.push({ filename })
        continue
      }

      const sourcePath = join(resultsPath, filename)
      const content = await readFile(sourcePath, 'utf8')
      const reverted = revertWithMappingEntries(content, entries)

      const stem = filename.slice(0, filename.length - extension.length)
      const revertedStem = toSafePathSegment(revertWithMappingEntries(stem, entries))

      await mkdir(targetFolder, { recursive: true })
      let targetName = `${revertedStem}${extension}`
      for (let attempt = 2; await pathExists(join(targetFolder, targetName)); attempt++) {
        targetName = `${revertedStem} (${attempt})${extension}`
      }
      await writeFile(join(targetFolder, targetName), reverted, 'utf8')

      // Move the source out of resultats/ so it is not re-imported next time.
      await mkdir(importedFolder, { recursive: true })
      let archivedName = filename
      if (await pathExists(join(importedFolder, archivedName))) {
        archivedName = `${Date.now()}-${filename}`
      }
      await rename(sourcePath, join(importedFolder, archivedName))

      imported.push({
        filename: targetName,
        relativePath: `${REIMPORT_TARGET_FOLDER}/${targetName}`
      })
    }

    return { imported, manual }
  }

  async function getStatusInner(dossierId: string): Promise<CoworkStatus> {
    const dossierPath = await documentService.resolveRegisteredDossierRoot({ dossierId })
    const synthesisStats = await stat(getDossierCoworkSynthesisPath(dossierPath)).catch(() => null)
    const resultEntries = await readdir(getDossierCoworkResultsPath(dossierPath), {
      withFileTypes: true
    }).catch(() => [])

    return {
      exportPath: getDossierCoworkPath(dossierPath),
      lastExportAt: synthesisStats ? synthesisStats.mtime.toISOString() : null,
      pendingResultCount: resultEntries.filter(
        (entry) => entry.isFile() && !entry.name.startsWith('.')
      ).length
    }
  }

  return {
    exportDossier: (input, onProgress) =>
      enqueue(input.dossierId, () => exportDossierInner(input.dossierId, onProgress)),
    reimportResults: (input) =>
      enqueue(input.dossierId, () => reimportResultsInner(input.dossierId)),
    getStatus: (input) => enqueue(input.dossierId, () => getStatusInner(input.dossierId))
  }
}
