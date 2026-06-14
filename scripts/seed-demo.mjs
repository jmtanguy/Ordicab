#!/usr/bin/env node
/**
 * seed-demo.mjs — génère un environnement de démonstration pour un cabinet d'avocat solo fictif.
 *
 * Usage:
 *   node scripts/seed-demo.mjs ~/Documents/CabinetDemo
 *   node scripts/seed-demo.mjs ~/Documents/CabinetDemo --force
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import HTMLToDOCX from 'html-to-docx'

// ─── CLI ─────────────────────────────────────────────────────────────────────

const targetArg = process.argv[2]
const forceFlag = process.argv.includes('--force')

if (!targetArg) {
  console.error('Usage: node scripts/seed-demo.mjs <target-path> [--force]')
  process.exit(1)
}

const ROOT = resolve(targetArg)

const domainJsonPath = join(ROOT, '.ordicab', 'domain.json')
if (existsSync(domainJsonPath) && !forceFlag) {
  console.error(`Un domaine existe déjà à ${ROOT}. Utilisez --force pour écraser.`)
  process.exit(1)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function writeJson(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8')
  console.log(`  ✓ ${filePath.replace(ROOT, '.')}`)
}

/**
 * Génère un vrai document .docx lisible à partir d'un corps HTML.
 * Les documents de démonstration sont ainsi ouvrables et indexables par Ordicab
 * (extraction de texte via mammoth), contrairement aux PDF vides précédents.
 */
async function writeDocx(filePath, { title, bodyHtml }) {
  mkdirSync(dirname(filePath), { recursive: true })
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>${title}</title></head><body>${bodyHtml}</body></html>`
  const output = await HTMLToDOCX(html, undefined, {
    title,
    creator: 'Ordicab — Démo',
    lastModifiedBy: 'Ordicab — Démo',
    font: 'Aptos',
    fontSize: 22,
    decodeUnicode: true,
    lang: 'fr-FR'
  })
  let buffer
  if (output instanceof Uint8Array) {
    buffer = output
  } else if (typeof Blob !== 'undefined' && output instanceof Blob) {
    buffer = new Uint8Array(await output.arrayBuffer())
  } else {
    buffer = new Uint8Array(output)
  }
  writeFileSync(filePath, buffer)
  console.log(`  ✓ ${filePath.replace(ROOT, '.')}`)
}

function writeDossierNotes(dossierId, notes) {
  for (const note of notes) {
    writeJson(join(ROOT, dossierId, '.ordicab', 'notes', `${note.uuid}.json`), note)
  }
}

/** En-tête commun (papier à en-tête du cabinet) pour les documents de démo. */
function letterhead() {
  return `
    <p style="text-align:right;color:#555;font-size:11px;margin:0">
      Cabinet Delacroix — Me Sophie Delacroix, Avocat au Barreau de Lyon (toque L-0847)<br/>
      12, rue de la République — 69001 Lyon — Tél. +33 4 72 00 10 10 — contact@cabinet-delacroix.fr
    </p>
    <hr/>`
}

// ─── UUIDs générés au lancement ───────────────────────────────────────────────

// Dossiers
const D1_UUID = randomUUID()
const D2_UUID = randomUUID()
const D3_UUID = randomUUID()
const D4_UUID = randomUUID()

// Contacts
const C1_UUID = randomUUID() // Bernard Dupont
const C2_UUID = randomUUID() // Philippe Moreau
const C3_UUID = randomUUID() // Claire Renard
const C4_UUID = randomUUID() // Julien Renard
const C5_UUID = randomUUID() // Antoine Fontaine
const C6_UUID = randomUUID() // Sécuritas Assurances
const C7_UUID = randomUUID() // Nadia Lemoine (cliente AJ)
const C8_UUID = randomUUID() // Transports Veyrat SAS (employeur adverse)

// Prestations du catalogue cabinet
const SVC1_UUID = randomUUID() // Honoraires au temps passé
const SVC2_UUID = randomUUID() // Forfait divorce

// Conventions d'honoraires
const FA1_UUID = randomUUID()
const FA2_UUID = randomUUID()
const FA3_UUID = randomUUID()
const FA4_UUID = randomUUID() // Convention AJ partielle

// Prestations (billing items)
const BI1A_UUID = randomUUID()
const BI1B_UUID = randomUUID()
const BI1C_UUID = randomUUID()
const BI1D_UUID = randomUUID()
const BI1E_UUID = randomUUID()
const BI1F_UUID = randomUUID()
const BI1G_UUID = randomUUID()

const BI2A_UUID = randomUUID()
const BI2B_UUID = randomUUID()
const BI2C_UUID = randomUUID()
const BI2D_UUID = randomUUID()
const BI2E_UUID = randomUUID()
const BI2F_UUID = randomUUID()

const BI3A_UUID = randomUUID()
const BI3B_UUID = randomUUID()
const BI3C_UUID = randomUUID()
const BI3D_UUID = randomUUID()
const BI3E_UUID = randomUUID()

// Dossier 4 — AJ partielle : rétribution État + complément client
const BI4_STATE_UUID = randomUUID() // Rétribution AJ - État (exonérée TVA)
const BI4_COMPL_UUID = randomUUID() // Complément d'honoraires - AJ partielle (avec TVA)

// Factures
const INV1_UUID = randomUUID()
const INV2_UUID = randomUUID()
const INV3_UUID = randomUUID()
const INV4_UUID = randomUUID()
const INV5_UUID = randomUUID() // FAC AJ — rétribution État (CARPA)
const INV6_UUID = randomUUID() // FAC AJ — complément client

// Paiements
const PAY1_UUID = randomUUID()
const PAY3_UUID = randomUUID()
const PAY4_UUID = randomUUID()
const PAY5_UUID = randomUUID() // Paiement rétribution État (CARPA)

// Dates clés
const KD1A_UUID = randomUUID()
const KD1B_UUID = randomUUID()
const KD1C_UUID = randomUUID()
const KD1D_UUID = randomUUID()
const KD1E_UUID = randomUUID()
const KD1F_UUID = randomUUID()

const KD2A_UUID = randomUUID()
const KD2B_UUID = randomUUID()
const KD2C_UUID = randomUUID()
const KD2D_UUID = randomUUID()
const KD2E_UUID = randomUUID()

const KD3A_UUID = randomUUID()
const KD3B_UUID = randomUUID()
const KD3C_UUID = randomUUID()
const KD3D_UUID = randomUUID()
const KD3E_UUID = randomUUID()

const KD4A_UUID = randomUUID()
const KD4B_UUID = randomUUID()
const KD4C_UUID = randomUUID()
const KD4D_UUID = randomUUID()
const KD4E_UUID = randomUUID()

// Références clés
const KR1_UUID = randomUUID()
const KR2_UUID = randomUUID()
const KR3_UUID = randomUUID()
const KR4_UUID = randomUUID()
const KR5_UUID = randomUUID()
const KR6_UUID = randomUUID()
const KR7_UUID = randomUUID()
const KR8_UUID = randomUUID()
const KR9_UUID = randomUUID()
const KR10_UUID = randomUUID()
const KR11_UUID = randomUUID()
const KR12_UUID = randomUUID()

// Notes de dossier
const NOTE1A_UUID = randomUUID()
const NOTE1B_UUID = randomUUID()
const NOTE2A_UUID = randomUUID()
const NOTE2B_UUID = randomUUID()
const NOTE3A_UUID = randomUUID()
const NOTE3B_UUID = randomUUID()
const NOTE4A_UUID = randomUUID()
const NOTE4B_UUID = randomUUID()

// ─── Helper: calcul d'une prestation ─────────────────────────────────────────

function makeBillingItem({
  uuid,
  dossierId,
  date,
  label,
  description,
  quantity,
  quantityUnit,
  unitPriceHtCents,
  vatRateBasisPoints,
  status,
  sourceFeeAgreementUuid,
  invoiceUuid,
  invoiceNumber
}) {
  const subtotalHtCents = Math.round(quantity * unitPriceHtCents)
  const totalHtCents = subtotalHtCents
  const totalTtcCents = Math.round(totalHtCents * (1 + vatRateBasisPoints / 10000))
  return {
    uuid,
    dossierId,
    date,
    label,
    ...(description ? { description } : {}),
    quantity,
    quantityUnit,
    unitPriceHtCents,
    discountHtCents: 0,
    subtotalHtCents,
    totalHtCents,
    vatRateBasisPoints,
    totalTtcCents,
    status,
    ...(sourceFeeAgreementUuid ? { sourceFeeAgreementUuid } : {}),
    ...(invoiceUuid ? { invoiceUuid, invoiceNumber } : {}),
    createdAt: date + 'T09:00:00.000Z',
    updatedAt: date + 'T09:00:00.000Z'
  }
}

function makeInvoiceLineFromBillingItem(item) {
  return {
    billingItemUuid: item.uuid,
    date: item.date,
    label: item.label,
    ...(item.description ? { description: item.description } : {}),
    quantity: item.quantity,
    quantityUnit: item.quantityUnit,
    unitPriceHtCents: item.unitPriceHtCents,
    discountHtCents: item.discountHtCents,
    subtotalHtCents: item.subtotalHtCents,
    totalHtCents: item.totalHtCents,
    vatRateBasisPoints: item.vatRateBasisPoints,
    totalTtcCents: item.totalTtcCents
  }
}

function makeInvoiceLines(items) {
  return items.map(makeInvoiceLineFromBillingItem)
}

function sumCents(items, selector) {
  return items.reduce((total, item) => total + selector(item), 0)
}

function makeVatBreakdown(lines) {
  const byRate = new Map()
  for (const line of lines) {
    const current = byRate.get(line.vatRateBasisPoints) ?? {
      vatRateBasisPoints: line.vatRateBasisPoints,
      taxableHtCents: 0,
      vatCents: 0,
      totalTtcCents: 0
    }
    current.taxableHtCents += line.totalHtCents
    current.vatCents += line.totalTtcCents - line.totalHtCents
    current.totalTtcCents += line.totalTtcCents
    byRate.set(line.vatRateBasisPoints, current)
  }
  return [...byRate.values()].sort((a, b) => a.vatRateBasisPoints - b.vatRateBasisPoints)
}

function makeInvoiceAmounts(lines) {
  const totalHtCents = sumCents(lines, (line) => line.totalHtCents)
  const totalTtcCents = sumCents(lines, (line) => line.totalTtcCents)
  return {
    totalHtCents,
    totalVatCents: totalTtcCents - totalHtCents,
    totalTtcCents,
    vatBreakdown: makeVatBreakdown(lines)
  }
}

function applyInvoiceAmounts(lines) {
  return {
    ...makeInvoiceAmounts(lines),
    lines
  }
}

function makeDossierNote({
  uuid,
  dossierId,
  title,
  content,
  kind = 'note',
  status,
  tags,
  pinned,
  source = 'user',
  createdAt,
  updatedAt
}) {
  return {
    uuid,
    dossierId,
    title,
    content,
    kind,
    ...(status ? { status } : {}),
    ...(tags?.length ? { tags } : {}),
    ...(pinned !== undefined ? { pinned } : {}),
    source,
    createdAt,
    updatedAt: updatedAt ?? createdAt
  }
}

// ─── Données du domaine ───────────────────────────────────────────────────────

const domainData = {
  domainPath: ROOT,
  initializedAt: '2026-01-15T09:00:00.000Z'
}

const registryData = {
  dossiers: [
    {
      slug: 'Dupont-c-Moreau-SARL',
      uuid: D1_UUID,
      name: 'Dupont c/ Moreau SARL',
      registeredAt: '2026-01-20T10:00:00.000Z'
    },
    {
      slug: 'Renard-Divorce',
      uuid: D2_UUID,
      name: 'Renard - Procédure de divorce',
      registeredAt: '2026-02-01T14:00:00.000Z'
    },
    {
      slug: 'Fontaine-Accident',
      uuid: D3_UUID,
      name: 'Fontaine - Accident de la route',
      registeredAt: '2026-03-10T11:00:00.000Z'
    },
    {
      slug: 'Lemoine-Prudhommes-AJ',
      uuid: D4_UUID,
      name: 'Lemoine c/ Transports Veyrat — Prud’hommes (aide juridictionnelle)',
      registeredAt: '2026-04-02T09:30:00.000Z'
    }
  ]
}

const entityData = {
  firmName: 'Cabinet Delacroix',
  gender: 'F',
  firstName: 'Sophie',
  lastName: 'Delacroix',
  addressLine: '12, rue de la République',
  zipCode: '69001',
  city: 'Lyon',
  country: 'France',
  vatNumber: 'FR42501234567',
  siren: '501 234 567',
  legalForm: 'SELARL',
  shareCapital: '10 000 €',
  rcsNumber: '501 234 567',
  rcsCity: 'Lyon',
  siret: '501 234 567 00012',
  iban: 'FR76 3000 6000 0112 3456 7890 189',
  bic: 'AGRIFRPP',
  carpaIban: 'FR76 4255 9000 0612 3456 7890 121',
  phone: '+33 4 72 00 10 10',
  email: 'contact@cabinet-delacroix.fr',
  barreau: 'Lyon',
  toque: 'L-0847'
}

const cabinetBillingData = {
  services: [
    {
      uuid: SVC1_UUID,
      name: 'Honoraires au temps passé',
      description: "Facturation à l'heure pour toutes missions de conseil et contentieux",
      usage: 'feeAgreement',
      billingType: 'hourly',
      hourlyRateHtCents: 25000,
      vatRateBasisPoints: 2000,
      paymentTerms: 'Paiement à 30 jours à compter de la date de facturation.',
      updatedAt: '2026-01-10T09:00:00.000Z'
    },
    {
      uuid: SVC2_UUID,
      name: 'Forfait divorce par consentement mutuel',
      usage: 'feeAgreement',
      billingType: 'flat',
      flatFeeHtCents: 180000,
      vatRateBasisPoints: 2000,
      paymentTerms: "50 % à la signature de la convention, 50 % à l'homologation.",
      updatedAt: '2026-01-10T09:00:00.000Z'
    }
  ],
  defaultServiceUuid: SVC1_UUID,
  invoiceSettings: {
    numberPattern: 'FAC-{YYYY}-{SEQ}',
    sequencePadding: 4,
    resetSequenceYearly: true,
    nextSequence: 6,
    currentSequenceYear: 2026,
    creditNoteNumberPattern: 'AV-{YYYY}-{SEQ}',
    creditNoteNextSequence: 1,
    creditNoteCurrentSequenceYear: 2026,
    correctiveInvoiceNumberPattern: 'FCR-{YYYY}-{SEQ}',
    correctiveInvoiceNextSequence: 1,
    correctiveInvoiceCurrentSequenceYear: 2026,
    stateRetributionNumberPattern: 'RET-{YYYY}-{SEQ}',
    stateRetributionNextSequence: 2,
    stateRetributionCurrentSequenceYear: 2026,
    legalFooter:
      'Cabinet Delacroix — SIREN 501 234 567 — TVA FR42501234567 — Barreau de Lyon, toque L-0847',
    defaultPaymentTerms: 'Paiement à 30 jours à compter de la date de facturation.',
    defaultDueDays: 30
  },
  updatedAt: '2026-01-10T09:00:00.000Z'
}

// ─── Échéances générales (hors dossier) ──────────────────────────────────────
// Vie du cabinet : obligations fiscales et ordinales, formation, permanences.

const generalKeyDates = [
  {
    uuid: randomUUID(),
    label: 'Maintenance du logiciel du cabinet',
    date: '2026-05-15',
    isClosed: true,
    note: 'Mise à jour effectuée par le prestataire — RAS.'
  },
  {
    uuid: randomUUID(),
    label: 'CARPA — point trimestriel des maniements de fonds',
    date: '2026-06-16',
    time: '10:00',
    duration: 60,
    isClosed: false
  },
  {
    uuid: randomUUID(),
    label: 'Permanence aide juridictionnelle (Ordre des avocats)',
    date: '2026-06-19',
    time: '08:30',
    duration: 240,
    isClosed: false
  },
  {
    uuid: randomUUID(),
    label: 'Formation continue — secret professionnel et RGPD',
    date: '2026-06-26',
    time: '09:00',
    duration: 420,
    isClosed: false,
    note: '7 heures validées au titre de la formation continue obligatoire.'
  },
  {
    uuid: randomUUID(),
    label: 'Cotisation ordinale — échéance de paiement',
    date: '2026-06-30',
    tags: ['to_do'],
    isClosed: false
  },
  {
    uuid: randomUUID(),
    label: "Assemblée générale de l'Ordre",
    date: '2026-07-03',
    time: '18:00',
    duration: 120,
    isClosed: false
  },
  {
    uuid: randomUUID(),
    label: 'Déclaration TVA — 2e trimestre 2026',
    date: '2026-07-20',
    tags: ['imperative'],
    isClosed: false,
    note: 'Télédéclaration CA3 + télépaiement avant le 20/07.'
  },
  {
    uuid: randomUUID(),
    label: 'Fermeture estivale du cabinet',
    date: '2026-08-03',
    isClosed: false,
    note: 'Fermeture du 3 au 21 août — prévoir le suivi des délais en cours.'
  },
  {
    uuid: randomUUID(),
    label: 'Renouvellement assurance RC professionnelle',
    date: '2026-09-30',
    tags: ['to_confirm'],
    isClosed: false
  }
]

// ─── Dossier 1 : Dupont c/ Moreau SARL ───────────────────────────────────────

const D1_ID = 'Dupont-c-Moreau-SARL'

const contacts1 = [
  {
    uuid: C1_UUID,
    dossierId: D1_ID,
    displayName: 'Bernard Dupont',
    firstName: 'Bernard',
    lastName: 'Dupont',
    gender: 'M',
    role: 'Client',
    phone: '+33 6 12 34 56 78',
    email: 'b.dupont@email.fr',
    addressLine: '45, avenue des Frères Lumière',
    zipCode: '69008',
    city: 'Lyon',
    country: 'France'
  },
  {
    uuid: C2_UUID,
    dossierId: D1_ID,
    displayName: 'Philippe Moreau',
    firstName: 'Philippe',
    lastName: 'Moreau',
    gender: 'M',
    role: 'Adversaire (gérant)',
    institution: 'Moreau SARL',
    addressLine: '8, rue du Commerce',
    zipCode: '69007',
    city: 'Lyon',
    country: 'France'
  }
]

// D1 — 7 prestations : 5 facturées (FAC-0001 + FAC-0002), 2 en draft
// FAC-0001 : BI1A (1h) + BI1B (3h) + BI1C (1h) = 5h = 125 000 ct HT
// FAC-0002 : BI1D (2h) + BI1E (2h) = 4h = 100 000 ct HT
const billingItems1 = [
  makeBillingItem({
    uuid: BI1A_UUID,
    dossierId: D1_ID,
    date: '2026-02-03',
    label: 'Consultation initiale et analyse du dossier',
    description: 'Première consultation, recueil des faits, analyse des pièces contractuelles',
    quantity: 1,
    quantityUnit: 'hours',
    unitPriceHtCents: 25000,
    vatRateBasisPoints: 2000,
    status: 'billed',
    sourceFeeAgreementUuid: FA1_UUID,
    invoiceUuid: INV1_UUID,
    invoiceNumber: 'FAC-2026-0001'
  }),
  makeBillingItem({
    uuid: BI1B_UUID,
    dossierId: D1_ID,
    date: '2026-02-20',
    label: "Rédaction de l'assignation",
    description: 'Assignation devant le Tribunal de Commerce de Lyon',
    quantity: 3,
    quantityUnit: 'hours',
    unitPriceHtCents: 25000,
    vatRateBasisPoints: 2000,
    status: 'billed',
    sourceFeeAgreementUuid: FA1_UUID,
    invoiceUuid: INV1_UUID,
    invoiceNumber: 'FAC-2026-0001'
  }),
  makeBillingItem({
    uuid: BI1C_UUID,
    dossierId: D1_ID,
    date: '2026-02-25',
    label: 'Signification et mise en état du dossier',
    description: "Coordination avec l'huissier, constitution du dossier de pièces",
    quantity: 1,
    quantityUnit: 'hours',
    unitPriceHtCents: 25000,
    vatRateBasisPoints: 2000,
    status: 'billed',
    sourceFeeAgreementUuid: FA1_UUID,
    invoiceUuid: INV1_UUID,
    invoiceNumber: 'FAC-2026-0001'
  }),
  makeBillingItem({
    uuid: BI1D_UUID,
    dossierId: D1_ID,
    date: '2026-03-12',
    label: 'Audience de mise en état',
    description: 'Présentation au Tribunal de Commerce de Lyon, fixation du calendrier',
    quantity: 2,
    quantityUnit: 'hours',
    unitPriceHtCents: 25000,
    vatRateBasisPoints: 2000,
    status: 'billed',
    sourceFeeAgreementUuid: FA1_UUID,
    invoiceUuid: INV2_UUID,
    invoiceNumber: 'FAC-2026-0005'
  }),
  makeBillingItem({
    uuid: BI1E_UUID,
    dossierId: D1_ID,
    date: '2026-03-28',
    label: 'Analyse des pièces adverses',
    description: 'Examen des conclusions et pièces communiquées par Moreau SARL',
    quantity: 2,
    quantityUnit: 'hours',
    unitPriceHtCents: 25000,
    vatRateBasisPoints: 2000,
    status: 'billed',
    sourceFeeAgreementUuid: FA1_UUID,
    invoiceUuid: INV2_UUID,
    invoiceNumber: 'FAC-2026-0005'
  }),
  makeBillingItem({
    uuid: BI1F_UUID,
    dossierId: D1_ID,
    date: '2026-04-10',
    label: 'Rédaction des conclusions en réponse',
    description: 'Réponse aux conclusions adverses, développement des moyens de droit',
    quantity: 5,
    quantityUnit: 'hours',
    unitPriceHtCents: 25000,
    vatRateBasisPoints: 2000,
    status: 'draft',
    sourceFeeAgreementUuid: FA1_UUID
  }),
  makeBillingItem({
    uuid: BI1G_UUID,
    dossierId: D1_ID,
    date: '2026-04-28',
    label: "Préparation de l'audience de plaidoirie",
    description: 'Synthèse du dossier, préparation des arguments oraux',
    quantity: 3,
    quantityUnit: 'hours',
    unitPriceHtCents: 25000,
    vatRateBasisPoints: 2000,
    status: 'draft',
    sourceFeeAgreementUuid: FA1_UUID
  })
]

const keyDates1 = [
  {
    uuid: KD1A_UUID,
    dossierId: D1_ID,
    label: "Saisine et dépôt de l'assignation",
    date: '2026-02-25',
    isClosed: true,
    note: 'Huissier mandaté : Me Bertrand, 69001 Lyon'
  },
  {
    uuid: KD1B_UUID,
    dossierId: D1_ID,
    label: 'Audience de mise en état',
    date: '2026-03-12',
    time: '09:00',
    duration: 60,
    isClosed: true
  },
  {
    uuid: KD1C_UUID,
    dossierId: D1_ID,
    label: 'Communication des pièces adverses',
    date: '2026-03-25',
    isClosed: true,
    note: 'Reçu 12 pièces + conclusions adverses'
  },
  {
    uuid: KD1D_UUID,
    dossierId: D1_ID,
    label: 'Dépôt conclusions en réponse',
    date: '2026-04-30',
    tags: ['imperative'],
    isClosed: false,
    note: 'Délai impératif fixé par ordonnance du 12/03/2026'
  },
  {
    uuid: KD1E_UUID,
    dossierId: D1_ID,
    label: 'Audience de plaidoirie',
    date: '2026-06-18',
    time: '14:00',
    duration: 90,
    tags: ['important'],
    isClosed: false
  },
  {
    uuid: KD1F_UUID,
    dossierId: D1_ID,
    label: 'Délibéré',
    date: '2026-07-10',
    tags: ['to_confirm'],
    isClosed: false
  },
  {
    uuid: randomUUID(),
    dossierId: D1_ID,
    label: 'Relance client — pièces complémentaires',
    date: '2026-04-18',
    tags: ['to_do'],
    isClosed: true,
    note: 'Échanges de validation des livrables et relevé bancaire reçus le 24/04/2026.'
  },
  {
    uuid: randomUUID(),
    dossierId: D1_ID,
    label: 'Audience de plaidoirie (date initiale)',
    date: '2026-05-28',
    time: '14:00',
    duration: 90,
    tags: ['postponed'],
    isClosed: true,
    note: 'Renvoyée au 18/06/2026 à la demande du conseil adverse.'
  },
  {
    uuid: randomUUID(),
    dossierId: D1_ID,
    label: 'Communication des pièces nos 9 à 12',
    date: '2026-06-10',
    isClosed: true,
    note: 'Bordereau complémentaire signifié par RPVA.'
  },
  {
    uuid: randomUUID(),
    dossierId: D1_ID,
    label: 'Date limite des notes en délibéré',
    date: '2026-06-25',
    tags: ['imperative'],
    isClosed: false,
    note: 'Sur autorisation du tribunal uniquement.'
  }
]

const notes1 = [
  makeDossierNote({
    uuid: NOTE1A_UUID,
    dossierId: D1_ID,
    title: 'Synthèse stratégie audience',
    content:
      'Insister sur la chronologie des livrables acceptés sans réserve. Préparer un tableau simple facture / bon de commande / livraison / règlement partiel pour neutraliser la contestation qualité.',
    kind: 'note',
    tags: ['strategie', 'audience', 'pieces'],
    pinned: true,
    createdAt: '2026-03-26T09:30:00.000Z',
    updatedAt: '2026-04-15T16:00:00.000Z'
  }),
  makeDossierNote({
    uuid: NOTE1B_UUID,
    dossierId: D1_ID,
    title: 'Relancer le client pour pièces complémentaires',
    content:
      'Demander à M. Dupont les échanges de validation des livrables d’octobre et le relevé bancaire montrant les paiements partiels de Moreau SARL.',
    kind: 'todo',
    status: 'open',
    tags: ['client', 'pieces'],
    createdAt: '2026-04-12T10:15:00.000Z',
    updatedAt: '2026-04-12T10:15:00.000Z'
  })
]

const dossier1 = {
  slug: D1_ID,
  uuid: D1_UUID,
  name: 'Dupont c/ Moreau SARL',
  status: 'active',
  type: 'Contentieux commercial',
  juridiction: 'Tribunal de Commerce de Lyon',
  tribunal: 'Tribunal de Commerce de Lyon',
  information:
    'Litige pour impayé de prestations de services. M. Dupont réclame 15 000 € à la société Moreau SARL.',
  registeredAt: '2026-01-20T10:00:00.000Z',
  updatedAt: '2026-04-15T16:00:00.000Z',
  lastOpenedAt: '2026-04-15T16:00:00.000Z',
  nextUpcomingKeyDate: '2026-06-18',
  nextUpcomingKeyDateLabel: 'Audience de plaidoirie',
  keyReferences: [
    {
      uuid: KR1_UUID,
      dossierId: D1_ID,
      label: 'Nom du dossier',
      value: 'Dupont c/ Moreau SARL',
      note: 'Référence interne utilisée dans les modèles.'
    },
    {
      uuid: KR2_UUID,
      dossierId: D1_ID,
      label: 'N° RG',
      value: '2026/00123',
      note: 'Numéro confirmé par le greffe après enrôlement.'
    },
    {
      uuid: KR3_UUID,
      dossierId: D1_ID,
      label: 'Juridiction',
      value: 'Tribunal de Commerce de Lyon',
      note: 'Compétence retenue au regard du contrat de prestation.'
    }
  ],
  feeAgreements: [
    {
      uuid: FA1_UUID,
      createdAt: '2026-01-22T10:00:00.000Z',
      updatedAt: '2026-01-25T14:00:00.000Z',
      isActive: true,
      status: 'signed',
      matterLabel: 'Contentieux commercial Dupont c/ Moreau SARL',
      scopeDescription:
        'Représentation et assistance dans le cadre du litige commercial opposant M. Bernard Dupont à la société Moreau SARL, pour impayé de prestations de services.',
      clientContactUuid: C1_UUID,
      billingType: 'hourly',
      hourlyRateHtCents: 25000,
      estimatedHours: 20,
      vatRateBasisPoints: 2000,
      paymentTerms: 'Paiement à 30 jours à compter de la date de facturation.',
      notes:
        'Convention signée sans remise. Prévoir un point de facturation après les conclusions en réponse.',
      sentAt: '2026-01-22',
      signedAt: '2026-01-25'
    }
  ],
  billingItems: [],
  keyDates: [],
  notes: [],
  documents: [],
  pieces: []
}

// ─── Dossier 2 : Renard - Procédure de divorce ───────────────────────────────

const D2_ID = 'Renard-Divorce'

const contacts2 = [
  {
    uuid: C3_UUID,
    dossierId: D2_ID,
    displayName: 'Claire Renard',
    firstName: 'Claire',
    lastName: 'Renard',
    gender: 'F',
    role: 'Cliente',
    phone: '+33 6 98 76 54 32',
    email: 'claire.renard@email.fr',
    addressLine: '22, rue Garibaldi',
    zipCode: '69006',
    city: 'Lyon',
    country: 'France',
    information:
      'Préférence pour les rendez-vous le matin. 2 enfants : Emma (8 ans) et Lucas (5 ans).'
  },
  {
    uuid: C4_UUID,
    dossierId: D2_ID,
    displayName: 'Julien Renard',
    firstName: 'Julien',
    lastName: 'Renard',
    gender: 'M',
    role: 'Époux adverse',
    addressLine: '14, cours Lafayette',
    zipCode: '69003',
    city: 'Lyon',
    country: 'France'
  }
]

// D2 — 6 prestations : 3 facturées (FAC-0003), 3 en draft
// FAC-0003 : BI2A (1 unité 900 HT) + BI2B (2h) + BI2C (1h) = 130 000 ct HT
const billingItems2 = [
  makeBillingItem({
    uuid: BI2A_UUID,
    dossierId: D2_ID,
    date: '2026-02-15',
    label: 'Rédaction et dépôt de la requête en divorce',
    description: 'Requête initiale, constitution du dossier JAF, bordereau de pièces',
    quantity: 1,
    quantityUnit: 'units',
    unitPriceHtCents: 90000,
    vatRateBasisPoints: 2000,
    status: 'billed',
    sourceFeeAgreementUuid: FA2_UUID,
    invoiceUuid: INV3_UUID,
    invoiceNumber: 'FAC-2026-0002'
  }),
  makeBillingItem({
    uuid: BI2B_UUID,
    dossierId: D2_ID,
    date: '2026-03-05',
    label: 'Consultations et préparation des pièces',
    description:
      'Deux rendez-vous avec Mme Renard, collecte des pièces justificatives (revenus, patrimoine)',
    quantity: 2,
    quantityUnit: 'hours',
    unitPriceHtCents: 20000,
    vatRateBasisPoints: 2000,
    status: 'billed',
    sourceFeeAgreementUuid: FA2_UUID,
    invoiceUuid: INV3_UUID,
    invoiceNumber: 'FAC-2026-0002'
  }),
  makeBillingItem({
    uuid: BI2C_UUID,
    dossierId: D2_ID,
    date: '2026-03-18',
    label: 'Échanges avec le conseil adverse',
    description: 'Courriers et appels téléphoniques avec Me Launay, conseil de M. Renard',
    quantity: 1,
    quantityUnit: 'hours',
    unitPriceHtCents: 20000,
    vatRateBasisPoints: 2000,
    status: 'billed',
    sourceFeeAgreementUuid: FA2_UUID,
    invoiceUuid: INV3_UUID,
    invoiceNumber: 'FAC-2026-0002'
  }),
  makeBillingItem({
    uuid: BI2D_UUID,
    dossierId: D2_ID,
    date: '2026-04-20',
    label: 'Rédaction des conclusions de forme',
    description: 'Demandes sur résidence habituelle des enfants et pension alimentaire',
    quantity: 3,
    quantityUnit: 'hours',
    unitPriceHtCents: 20000,
    vatRateBasisPoints: 2000,
    status: 'draft',
    sourceFeeAgreementUuid: FA2_UUID
  }),
  makeBillingItem({
    uuid: BI2E_UUID,
    dossierId: D2_ID,
    date: '2026-05-12',
    label: "Préparation de l'audience de conciliation",
    description: "Rendez-vous de préparation avec Mme Renard, simulation de l'audience",
    quantity: 1.5,
    quantityUnit: 'hours',
    unitPriceHtCents: 20000,
    vatRateBasisPoints: 2000,
    status: 'draft',
    sourceFeeAgreementUuid: FA2_UUID
  }),
  makeBillingItem({
    uuid: BI2F_UUID,
    dossierId: D2_ID,
    date: '2026-05-20',
    label: 'Audience JAF — tentative de conciliation',
    description: "Représentation à l'audience, présentation des demandes",
    quantity: 2,
    quantityUnit: 'hours',
    unitPriceHtCents: 20000,
    vatRateBasisPoints: 2000,
    status: 'draft',
    sourceFeeAgreementUuid: FA2_UUID
  })
]

const keyDates2 = [
  {
    uuid: KD2A_UUID,
    dossierId: D2_ID,
    label: 'Dépôt de la requête en divorce',
    date: '2026-02-15',
    isClosed: true,
    note: 'Déposée au greffe du TJ Lyon, reçu le 15/02/2026'
  },
  {
    uuid: KD2B_UUID,
    dossierId: D2_ID,
    label: 'Notification à M. Renard',
    date: '2026-02-22',
    isClosed: true,
    note: "Signifié par voie d'huissier"
  },
  {
    uuid: KD2C_UUID,
    dossierId: D2_ID,
    label: 'Convocation audience JAF reçue',
    date: '2026-03-10',
    isClosed: true
  },
  {
    uuid: KD2D_UUID,
    dossierId: D2_ID,
    label: 'Rendez-vous avec cliente (préparation audience)',
    date: '2026-05-15',
    time: '14:00',
    duration: 60,
    tags: ['to_do'],
    isClosed: false,
    note: 'Apporter pièces fiscales N-1 et bulletins de salaire'
  },
  {
    uuid: KD2E_UUID,
    dossierId: D2_ID,
    label: 'Audience JAF — tentative de conciliation',
    date: '2026-05-20',
    time: '10:30',
    duration: 60,
    tags: ['important'],
    isClosed: false
  },
  {
    uuid: randomUUID(),
    dossierId: D2_ID,
    label: "Séance d'information à la médiation familiale",
    date: '2026-04-28',
    time: '15:00',
    duration: 90,
    isClosed: true,
    note: 'Médiation non poursuivie — désaccord persistant sur la résidence.'
  },
  {
    uuid: randomUUID(),
    dossierId: D2_ID,
    label: 'RDV cliente — point pension alimentaire',
    date: '2026-06-20',
    time: '11:00',
    duration: 45,
    tags: ['to_do'],
    isClosed: false,
    note: 'Préparer le tableau des charges fixes et frais de garde.'
  },
  {
    uuid: randomUUID(),
    dossierId: D2_ID,
    label: 'Remise des attestations de témoins (art. 202 CPC)',
    date: '2026-06-30',
    tags: ['to_do'],
    isClosed: false
  },
  {
    uuid: randomUUID(),
    dossierId: D2_ID,
    label: 'Échange confidentiel — éléments médicaux M. Renard',
    date: '2026-07-02',
    tags: ['confidential'],
    isClosed: false,
    note: 'À ne pas verser au débat sans accord de la cliente.'
  },
  {
    uuid: randomUUID(),
    dossierId: D2_ID,
    label: 'Audience JAF — plaidoirie sur les mesures définitives',
    date: '2026-09-15',
    time: '09:00',
    duration: 120,
    tags: ['important'],
    isClosed: false
  }
]

const notes2 = [
  makeDossierNote({
    uuid: NOTE2A_UUID,
    dossierId: D2_ID,
    title: 'Points sensibles pour l’audience JAF',
    content:
      'Préparer Mme Renard sur les questions relatives à l’organisation quotidienne des enfants. Éviter les griefs personnels non utiles et revenir sur la stabilité scolaire.',
    kind: 'note',
    tags: ['audience', 'enfants', 'strategie'],
    pinned: true,
    createdAt: '2026-03-11T11:20:00.000Z',
    updatedAt: '2026-04-20T11:00:00.000Z'
  }),
  makeDossierNote({
    uuid: NOTE2B_UUID,
    dossierId: D2_ID,
    title: 'Vérifier les justificatifs revenus',
    content:
      'Contrôler que les bulletins de salaire, avis d’imposition et charges de garde couvrent bien les périodes demandées par le juge.',
    kind: 'to_verify',
    status: 'open',
    tags: ['pieces', 'finances'],
    createdAt: '2026-04-18T09:45:00.000Z',
    updatedAt: '2026-04-18T09:45:00.000Z'
  })
]

const dossier2 = {
  slug: D2_ID,
  uuid: D2_UUID,
  name: 'Renard - Procédure de divorce',
  status: 'active',
  type: 'Droit de la famille — Divorce',
  juridiction: 'Juge aux Affaires Familiales de Lyon',
  tribunal: 'Tribunal judiciaire de Lyon',
  information:
    'Divorce judiciaire avec désaccord sur la résidence des enfants. Audience de tentative de conciliation fixée.',
  registeredAt: '2026-02-01T14:00:00.000Z',
  updatedAt: '2026-04-20T11:00:00.000Z',
  lastOpenedAt: '2026-04-20T11:00:00.000Z',
  nextUpcomingKeyDate: '2026-05-15',
  nextUpcomingKeyDateLabel: 'Rendez-vous avec cliente (préparation audience)',
  keyReferences: [
    {
      uuid: KR4_UUID,
      dossierId: D2_ID,
      label: 'Nom du dossier',
      value: 'Renard - Procédure de divorce',
      note: 'Libellé volontairement neutre pour les exports.'
    },
    {
      uuid: KR5_UUID,
      dossierId: D2_ID,
      label: 'N° RG',
      value: '2026/FAM/00087',
      note: 'À reprendre dans tous les courriers au greffe.'
    },
    {
      uuid: KR6_UUID,
      dossierId: D2_ID,
      label: 'Juge référent',
      value: 'Mme la juge Martin',
      note: 'Mention issue de la convocation JAF.'
    }
  ],
  feeAgreements: [
    {
      uuid: FA2_UUID,
      createdAt: '2026-02-03T10:00:00.000Z',
      updatedAt: '2026-02-05T09:00:00.000Z',
      isActive: true,
      status: 'signed',
      matterLabel: 'Divorce Renard — procédure complète',
      scopeDescription:
        "Assistance et représentation de Mme Claire Renard dans le cadre de la procédure de divorce judiciaire, jusqu'à la décision définitive incluant le règlement des conséquences du divorce.",
      clientContactUuid: C3_UUID,
      billingType: 'mixed',
      flatFeeHtCents: 180000,
      hourlyRateHtCents: 20000,
      vatRateBasisPoints: 2000,
      paymentTerms: '50 % à la signature de la convention — solde à la clôture de la procédure.',
      notes:
        'Forfait initial ventilé en prestations facturables pour illustrer le suivi des diligences.',
      sentAt: '2026-02-03',
      signedAt: '2026-02-05'
    }
  ],
  billingItems: [],
  keyDates: [],
  notes: [],
  documents: [],
  pieces: []
}

// ─── Dossier 3 : Fontaine - Accident de la route ─────────────────────────────

const D3_ID = 'Fontaine-Accident'

const contacts3 = [
  {
    uuid: C5_UUID,
    dossierId: D3_ID,
    displayName: 'Antoine Fontaine',
    firstName: 'Antoine',
    lastName: 'Fontaine',
    gender: 'M',
    role: 'Client',
    phone: '+33 6 55 44 33 22',
    email: 'a.fontaine@email.fr',
    addressLine: '78, rue Paul Bert',
    zipCode: '69003',
    city: 'Lyon',
    country: 'France',
    information:
      'Piéton renversé le 12/11/2025. Fracture du poignet droit et traumatisme crânien léger. En arrêt maladie.'
  },
  {
    uuid: C6_UUID,
    dossierId: D3_ID,
    displayName: 'Sécuritas Assurances',
    lastName: 'Sécuritas Assurances',
    gender: 'N',
    role: 'Assureur adverse',
    institution: 'Sécuritas Assurances SA',
    addressLine: 'Tour Part-Dieu, 129 rue Servient',
    zipCode: '69003',
    city: 'Lyon',
    country: 'France',
    information: 'N° police adverse : SEC-2025-L3-44821'
  }
]

// D3 — 5 prestations : 2 facturées (FAC-0004 provision), 3 en draft
// FAC-0004 : BI3A (1,5h) + BI3B (2h) = 3,5h = 87 500 ct HT
const billingItems3 = [
  makeBillingItem({
    uuid: BI3A_UUID,
    dossierId: D3_ID,
    date: '2026-03-15',
    label: 'Consultation initiale et analyse du dossier',
    description:
      'Première consultation, recueil des faits, examen du PV de constat et rapport médical initial',
    quantity: 1.5,
    quantityUnit: 'hours',
    unitPriceHtCents: 25000,
    vatRateBasisPoints: 2000,
    status: 'billed',
    sourceFeeAgreementUuid: FA3_UUID,
    invoiceUuid: INV4_UUID,
    invoiceNumber: 'FAC-2026-0004'
  }),
  makeBillingItem({
    uuid: BI3B_UUID,
    dossierId: D3_ID,
    date: '2026-04-05',
    label: "Étude du rapport médical et préparation de l'expertise",
    description:
      "Analyse approfondie du rapport médical de consolidation, préparation des questions à l'expert",
    quantity: 2,
    quantityUnit: 'hours',
    unitPriceHtCents: 25000,
    vatRateBasisPoints: 2000,
    status: 'billed',
    sourceFeeAgreementUuid: FA3_UUID,
    invoiceUuid: INV4_UUID,
    invoiceNumber: 'FAC-2026-0004'
  }),
  makeBillingItem({
    uuid: BI3C_UUID,
    dossierId: D3_ID,
    date: '2026-04-22',
    label: "Mise en demeure de l'assureur",
    description: 'Rédaction et envoi de la lettre de mise en demeure à Sécuritas Assurances',
    quantity: 1,
    quantityUnit: 'hours',
    unitPriceHtCents: 25000,
    vatRateBasisPoints: 2000,
    status: 'draft',
    sourceFeeAgreementUuid: FA3_UUID
  }),
  makeBillingItem({
    uuid: BI3D_UUID,
    dossierId: D3_ID,
    date: '2026-05-10',
    label: "Préparation de l'expertise médicale amiable",
    description:
      'Réunion avec M. Fontaine, constitution du dossier médical, désignation du médecin conseil',
    quantity: 2,
    quantityUnit: 'hours',
    unitPriceHtCents: 25000,
    vatRateBasisPoints: 2000,
    status: 'draft',
    sourceFeeAgreementUuid: FA3_UUID
  }),
  makeBillingItem({
    uuid: BI3E_UUID,
    dossierId: D3_ID,
    date: '2026-06-05',
    label: 'Expertise médicale amiable',
    description:
      "Assistance lors de l'expertise contradictoire, observations écrites post-expertise",
    quantity: 3,
    quantityUnit: 'hours',
    unitPriceHtCents: 25000,
    vatRateBasisPoints: 2000,
    status: 'draft',
    sourceFeeAgreementUuid: FA3_UUID
  })
]

const keyDates3 = [
  {
    uuid: KD3A_UUID,
    dossierId: D3_ID,
    label: "Déclaration sinistre à l'assureur",
    date: '2026-03-12',
    isClosed: true,
    note: 'Déclaration envoyée par LRAR à Sécuritas Assurances'
  },
  {
    uuid: KD3B_UUID,
    dossierId: D3_ID,
    label: "Mise en demeure de l'assureur",
    date: '2026-04-22',
    isClosed: true
  },
  {
    uuid: KD3C_UUID,
    dossierId: D3_ID,
    label: 'Réponse assureur reçue',
    date: '2026-05-05',
    isClosed: true,
    note: 'Assureur conteste le taux de responsabilité. Contre-expertise demandée.'
  },
  {
    uuid: KD3D_UUID,
    dossierId: D3_ID,
    label: 'Expertise médicale amiable',
    date: '2026-06-05',
    time: '10:00',
    duration: 120,
    tags: ['imperative'],
    isClosed: false,
    note: 'Dr. Moretti (médecin conseil) présent. Lieu : cabinet Dr. Chauvet, 69003 Lyon.'
  },
  {
    uuid: KD3E_UUID,
    dossierId: D3_ID,
    label: 'Délai réponse offre indemnitaire',
    date: '2026-09-01',
    tags: ['urgent'],
    isClosed: false,
    note: "Délai légal de réponse à l'offre indemnitaire (art. L211-9 C. assur.)"
  },
  {
    uuid: randomUUID(),
    dossierId: D3_ID,
    label: 'Relance du médecin conseil (Dr Moretti)',
    date: '2026-05-26',
    tags: ['to_do'],
    isClosed: true,
    note: 'Dossier médical complet transmis au médecin conseil.'
  },
  {
    uuid: randomUUID(),
    dossierId: D3_ID,
    label: "Contre-visite demandée par l'assureur",
    date: '2026-06-02',
    time: '09:00',
    tags: ['cancelled'],
    isClosed: true,
    note: "Annulée par Sécuritas Assurances — fusionnée avec l'expertise amiable du 05/06."
  },
  {
    uuid: randomUUID(),
    dossierId: D3_ID,
    label: "Réception du rapport d'expertise amiable",
    date: '2026-07-15',
    tags: ['to_confirm'],
    isClosed: false,
    note: "Délai annoncé par l'expert : 5 à 6 semaines après la réunion d'expertise."
  },
  {
    uuid: randomUUID(),
    dossierId: D3_ID,
    label: 'RDV client — restitution du rapport et stratégie',
    date: '2026-07-22',
    time: '14:30',
    duration: 60,
    isClosed: false
  },
  {
    uuid: randomUUID(),
    dossierId: D3_ID,
    label: 'Point provision complémentaire si offre insuffisante',
    date: '2026-08-20',
    tags: ['to_do'],
    isClosed: false
  }
]

const notes3 = [
  makeDossierNote({
    uuid: NOTE3A_UUID,
    dossierId: D3_ID,
    title: 'Préparer discussion médecin conseil',
    content:
      'Lister les séquelles fonctionnelles concrètes : gêne écriture, conduite, port de charges et retentissement professionnel. Demander au client des exemples quotidiens précis.',
    kind: 'todo',
    status: 'open',
    tags: ['expertise', 'medical', 'client'],
    pinned: true,
    createdAt: '2026-04-06T14:00:00.000Z',
    updatedAt: '2026-04-22T09:30:00.000Z'
  }),
  makeDossierNote({
    uuid: NOTE3B_UUID,
    dossierId: D3_ID,
    title: 'Hypothèse offre provisionnelle',
    content:
      'Si l’assureur maintient la contestation de responsabilité, envisager une demande de provision limitée et documentée avant discussion globale sur les postes de préjudice.',
    kind: 'idea',
    tags: ['indemnisation', 'assureur'],
    createdAt: '2026-05-05T16:10:00.000Z',
    updatedAt: '2026-05-05T16:10:00.000Z'
  })
]

const dossier3 = {
  slug: D3_ID,
  uuid: D3_UUID,
  name: 'Fontaine - Accident de la route',
  status: 'pending',
  type: 'Préjudice corporel',
  information:
    'Accident survenu le 12 novembre 2025 à Lyon 3e. Client piéton renversé par un véhicule assuré chez Sécuritas Assurances. Fracture du poignet droit et traumatisme crânien léger. Expertise médicale amiable en cours de programmation.',
  registeredAt: '2026-03-10T11:00:00.000Z',
  updatedAt: '2026-04-05T10:00:00.000Z',
  lastOpenedAt: '2026-04-05T10:00:00.000Z',
  nextUpcomingKeyDate: '2026-06-05',
  nextUpcomingKeyDateLabel: 'Expertise médicale amiable',
  keyReferences: [
    {
      uuid: KR7_UUID,
      dossierId: D3_ID,
      label: 'Nom du dossier',
      value: 'Fontaine - Accident de la route',
      note: 'Dossier de préjudice corporel en phase amiable.'
    },
    {
      uuid: KR8_UUID,
      dossierId: D3_ID,
      label: 'N° police adverse',
      value: 'SEC-2025-L3-44821',
      note: 'Référence à rappeler dans les échanges assureur.'
    },
    {
      uuid: KR9_UUID,
      dossierId: D3_ID,
      label: "Date de l'accident",
      value: '12 novembre 2025',
      note: 'Date pivot pour les délais loi Badinter.'
    }
  ],
  feeAgreements: [
    {
      uuid: FA3_UUID,
      createdAt: '2026-03-12T10:00:00.000Z',
      updatedAt: '2026-03-12T10:00:00.000Z',
      isActive: true,
      status: 'draft',
      matterLabel: 'Réparation du préjudice corporel — accident du 12/11/2025',
      scopeDescription:
        "Assistance et représentation de M. Antoine Fontaine aux fins d'indemnisation intégrale de son préjudice corporel consécutif à l'accident de la route du 12 novembre 2025 à Lyon.",
      clientContactUuid: C5_UUID,
      billingType: 'mixed',
      hourlyRateHtCents: 25000,
      retainerHtCents: 50000,
      successFeePercentBasisPoints: 1000,
      successFeeClause:
        "Honoraires de résultat de 10 % HT calculés sur les sommes obtenues au-delà de 10 000 € d'indemnisation totale.",
      vatRateBasisPoints: 2000,
      paymentTerms:
        "Provision de 500 € HT à la signature — honoraires complémentaires à l'issue de la procédure.",
      notes:
        'Convention encore en projet : attente retour client avant facturation des diligences non provisionnées.'
    }
  ],
  billingItems: [],
  keyDates: [],
  notes: [],
  documents: [],
  pieces: []
}

// ─── Dossier 4 : Lemoine c/ Transports Veyrat — Prud'hommes (aide juridictionnelle) ─
//
// Démonstration de l'aide juridictionnelle PARTIELLE (55 %) et de son intégration
// dans la facturation :
//   • Honoraires totaux estimés ......... 2 000 € HT
//   • Rétribution versée par l'État ..... 1 080 € HT  (exonérée de TVA)
//   • Complément négocié au client ......   500 € HT  (+ TVA 20 % = 600 € TTC)
//   • Plafond du complément ............. 2 000 − 1 080 = 920 € HT (complément sous plafond)
//
// Deux prestations et DEUX pièces séparées sont générées (cf. orchestration AJ) :
//   - RET-2026-0001 : rétribution État (pièce distincte, exonérée TVA, recouvrée CARPA)
//   - FAC-2026-0003 : complément d'honoraires facturé à la cliente (facture, avec TVA)

const D4_ID = 'Lemoine-Prudhommes-AJ'

const D4_MATTER_LABEL = 'Lemoine c/ Transports Veyrat — Prud’hommes (aide juridictionnelle)'
const D4_STATE_RETRIBUTION_HT = 108000 // 1 080 € HT
const D4_COMPLEMENT_HT = 50000 //   500 € HT
const D4_TOTAL_HONORAIRES_HT = 200000 // 2 000 € HT (assiette de calcul du plafond)
const D4_COMPLEMENT_CAP_HT = D4_TOTAL_HONORAIRES_HT - D4_STATE_RETRIBUTION_HT // 920 € HT

const contacts4 = [
  {
    uuid: C7_UUID,
    dossierId: D4_ID,
    displayName: 'Nadia Lemoine',
    firstName: 'Nadia',
    lastName: 'Lemoine',
    gender: 'F',
    role: 'Cliente (bénéficiaire AJ)',
    phone: '+33 6 21 09 87 65',
    email: 'nadia.lemoine@email.fr',
    addressLine: '5, rue de la Part-Dieu',
    zipCode: '69003',
    city: 'Lyon',
    country: 'France',
    information:
      "Bénéficiaire de l'aide juridictionnelle partielle (55 %). Licenciée le 15/01/2026. Revenus modestes, justificatifs CAF fournis."
  },
  {
    uuid: C8_UUID,
    dossierId: D4_ID,
    displayName: 'Transports Veyrat SAS',
    lastName: 'Transports Veyrat SAS',
    gender: 'N',
    role: 'Employeur adverse',
    institution: 'Transports Veyrat SAS',
    addressLine: '14, route de Vienne',
    zipCode: '69007',
    city: 'Lyon',
    country: 'France',
    information: 'SIREN 412 887 305. Conseil adverse : Me Garnier (Barreau de Lyon).'
  }
]

// D4 — 2 prestations issues de la convention AJ :
//   • Rétribution État : 1 080 € HT, exonérée de TVA (pièce RET-0001, recouvrée CARPA)
//   • Complément client :  500 € HT + TVA 20 % (facture FAC-2026-0003)
const billingItems4 = [
  makeBillingItem({
    uuid: BI4_STATE_UUID,
    dossierId: D4_ID,
    date: '2026-04-05',
    label: `Rétribution AJ - État - ${D4_MATTER_LABEL}`,
    description:
      "Mission au titre de l'aide juridictionnelle. Rétribution au titre de l'aide juridictionnelle : 1 080,00 € HT. Rétribution exonérée de TVA.",
    quantity: 1,
    quantityUnit: 'units',
    unitPriceHtCents: D4_STATE_RETRIBUTION_HT,
    vatRateBasisPoints: 0,
    status: 'billed',
    sourceFeeAgreementUuid: FA4_UUID,
    invoiceUuid: INV5_UUID,
    invoiceNumber: 'RET-2026-0001'
  }),
  makeBillingItem({
    uuid: BI4_COMPL_UUID,
    dossierId: D4_ID,
    date: '2026-04-05',
    label: `Complément d'honoraires - AJ partielle - ${D4_MATTER_LABEL}`,
    description:
      "Mission au titre de l'aide juridictionnelle. Complément d'honoraires librement négocié : 500,00 € HT.",
    quantity: 1,
    quantityUnit: 'units',
    unitPriceHtCents: D4_COMPLEMENT_HT,
    vatRateBasisPoints: 2000,
    status: 'billed',
    sourceFeeAgreementUuid: FA4_UUID,
    invoiceUuid: INV6_UUID,
    invoiceNumber: 'FAC-2026-0003'
  })
]
// Renseigne le type de prestation AJ (source convention) — non géré par makeBillingItem.
billingItems4[0].sourceFeeAgreementBillingKind = 'stateRetribution'
billingItems4[1].sourceFeeAgreementBillingKind = 'legalAidComplement'

const keyDates4 = [
  {
    uuid: KD4A_UUID,
    dossierId: D4_ID,
    label: "Décision d'admission à l'aide juridictionnelle (BAJ)",
    date: '2026-03-28',
    isClosed: true,
    note: 'AJ partielle 55 % — décision n° 2026/0457 du BAJ de Lyon.'
  },
  {
    uuid: KD4B_UUID,
    dossierId: D4_ID,
    label: 'AJ — dépôt de la demande / désignation',
    date: '2026-04-09',
    tags: ['important'],
    isClosed: true,
    note: 'Désignation transmise au greffe du Conseil de Prud’hommes.'
  },
  {
    uuid: KD4C_UUID,
    dossierId: D4_ID,
    label: 'Audience de conciliation (Bureau de conciliation)',
    date: '2026-06-12',
    time: '09:30',
    duration: 60,
    tags: ['important'],
    isClosed: false
  },
  {
    uuid: KD4D_UUID,
    dossierId: D4_ID,
    label: 'AJ — attestation de fin de mission',
    date: '2026-06-04',
    tags: ['to_do'],
    isClosed: false,
    note: 'À adresser à la CARPA pour le recouvrement de la rétribution.'
  },
  {
    uuid: KD4E_UUID,
    dossierId: D4_ID,
    label: 'AJ — recouvrement de la rétribution (CARPA)',
    date: '2026-07-04',
    tags: ['imperative'],
    isClosed: false,
    note: 'Rétribution État 1 080 € HT — pièce RET-2026-0001.'
  },
  {
    uuid: randomUUID(),
    dossierId: D4_ID,
    label: 'Transmission du dossier de pièces au CPH',
    date: '2026-05-30',
    isClosed: true,
    note: 'Bordereau de 14 pièces déposé au greffe.'
  },
  {
    uuid: randomUUID(),
    dossierId: D4_ID,
    label: 'Relance CARPA si rétribution non versée',
    date: '2026-08-15',
    tags: ['to_do'],
    isClosed: false
  },
  {
    uuid: randomUUID(),
    dossierId: D4_ID,
    label: 'Audience de jugement (bureau de jugement)',
    date: '2026-10-08',
    time: '14:00',
    duration: 120,
    tags: ['important', 'to_confirm'],
    isClosed: false,
    note: 'Date indicative annoncée en conciliation — convocation à confirmer.'
  }
]

const notes4 = [
  makeDossierNote({
    uuid: NOTE4A_UUID,
    dossierId: D4_ID,
    title: 'Chaîne AJ à surveiller',
    content:
      'Vérifier que la rétribution État reste séparée de la facture de complément. À la fin de mission, joindre décision BAJ, attestation et référence CARPA AJ-2026-0457.',
    kind: 'note',
    tags: ['aide-juridictionnelle', 'carpa', 'facturation'],
    pinned: true,
    createdAt: '2026-04-05T12:30:00.000Z',
    updatedAt: '2026-04-08T12:00:00.000Z'
  }),
  makeDossierNote({
    uuid: NOTE4B_UUID,
    dossierId: D4_ID,
    title: 'À vérifier avant audience de conciliation',
    content:
      'Contrôler les griefs de licenciement, l’ancienneté exacte et les éléments de préjudice. Préparer une proposition transactionnelle minimale.',
    kind: 'to_verify',
    status: 'open',
    tags: ['prudhommes', 'conciliation'],
    createdAt: '2026-04-10T10:30:00.000Z',
    updatedAt: '2026-04-10T10:30:00.000Z'
  })
]

const dossier4 = {
  slug: D4_ID,
  uuid: D4_UUID,
  name: D4_MATTER_LABEL,
  status: 'active',
  type: 'Droit du travail — Contentieux prud’homal',
  juridiction: 'Conseil de Prud’hommes de Lyon',
  tribunal: 'Conseil de Prud’hommes de Lyon',
  information:
    "Contestation d'un licenciement pour motif personnel. Cliente admise à l'aide juridictionnelle partielle (55 %, décision BAJ du 28/03/2026). Rétribution de l'État recouvrée auprès de la CARPA ; complément d'honoraires de 500 € HT librement négocié avec la cliente conformément à l'article 35 de la loi n° 91-647 du 10 juillet 1991.",
  registeredAt: '2026-04-02T09:30:00.000Z',
  updatedAt: '2026-04-05T12:00:00.000Z',
  lastOpenedAt: '2026-04-05T12:00:00.000Z',
  nextUpcomingKeyDate: '2026-06-04',
  nextUpcomingKeyDateLabel: 'AJ — attestation de fin de mission',
  legalAid: {
    status: 'granted',
    type: 'partial',
    shareBasisPoints: 5500,
    bajDecisionNumber: '2026/0457',
    bajDecisionDate: '2026-03-28',
    bajOffice: 'Bureau d’aide juridictionnelle — TJ de Lyon',
    aidNumber: 'AJ-2026-0457',
    stateRetributionHtCents: D4_STATE_RETRIBUTION_HT,
    complementHtCents: D4_COMPLEMENT_HT,
    autoSetupDone: true,
    notes:
      "Complément d'honoraires de 500 € HT librement négocié (plafond légal : 920 € HT). Justificatifs de ressources au dossier."
  },
  keyReferences: [
    {
      uuid: KR10_UUID,
      dossierId: D4_ID,
      label: 'N° RG',
      value: '2026/F/00214',
      note: 'Référence prud’homale communiquée avec la convocation.'
    },
    {
      uuid: KR11_UUID,
      dossierId: D4_ID,
      label: 'Décision AJ (BAJ)',
      value: '2026/0457 — AJ partielle 55 %',
      note: 'Base du paramétrage AJ et de la convention de complément.'
    },
    {
      uuid: KR12_UUID,
      dossierId: D4_ID,
      label: 'N° AJ / CARPA',
      value: 'AJ-2026-0457',
      note: 'À mentionner sur la demande de recouvrement CARPA.'
    }
  ],
  feeAgreements: [
    {
      uuid: FA4_UUID,
      createdAt: '2026-04-03T09:00:00.000Z',
      updatedAt: '2026-04-05T11:00:00.000Z',
      isActive: true,
      status: 'signed',
      matterLabel: D4_MATTER_LABEL,
      scopeDescription: "Mission au titre de l'aide juridictionnelle.",
      clientContactUuid: C7_UUID,
      billingType: 'flat',
      flatFeeHtCents: D4_STATE_RETRIBUTION_HT,
      vatRateBasisPoints: 2000,
      legalAidMode: true,
      legalAidType: 'partial',
      legalAidShareBasisPoints: 5500,
      stateRetributionHtCents: D4_STATE_RETRIBUTION_HT,
      complementHtCents: D4_COMPLEMENT_HT,
      complementCapHtCents: D4_COMPLEMENT_CAP_HT,
      legalAidVatExempt: true,
      paymentTerms:
        "Rétribution de l'État recouvrée auprès de la CARPA. Complément d'honoraires de 500 € HT à la charge de la cliente, payable à réception de facture.",
      notes:
        'Convention AJ partielle : la note rappelle le plafond du complément et la séparation facture cliente / rétribution État.',
      sentAt: '2026-04-03',
      signedAt: '2026-04-05'
    }
  ],
  billingItems: [],
  keyDates: [],
  notes: [],
  documents: [],
  pieces: []
}

// ─── Factures ─────────────────────────────────────────────────────────────────

const issuerSnapshot = {
  name: 'Cabinet Delacroix — Me Sophie Delacroix',
  address: '12, rue de la République — 69001 Lyon',
  siret: '501 234 567 00012',
  vatNumber: 'FR42501234567',
  iban: 'FR76 3000 6000 0112 3456 7890 189',
  legalFooter:
    'Cabinet Delacroix — SIREN 501 234 567 — TVA FR42501234567 — Barreau de Lyon, toque L-0847'
}

const clientSnapshot1 = {
  name: 'M. Bernard Dupont',
  address: '45, avenue des Frères Lumière — 69008 Lyon'
}
const clientSnapshot2 = { name: 'Mme Claire Renard', address: '22, rue Garibaldi — 69006 Lyon' }
const clientSnapshot3 = { name: 'M. Antoine Fontaine', address: '78, rue Paul Bert — 69003 Lyon' }
const clientSnapshot4 = {
  name: 'Mme Nadia Lemoine',
  address: '5, rue de la Part-Dieu — 69003 Lyon'
}

const invoice1Lines = makeInvoiceLines([billingItems1[0], billingItems1[1], billingItems1[2]])
const invoice2Lines = makeInvoiceLines([billingItems1[3], billingItems1[4]])
const invoice3Lines = makeInvoiceLines([billingItems2[0], billingItems2[1], billingItems2[2]])
const invoice4Lines = makeInvoiceLines([billingItems3[0], billingItems3[1]])
const invoice5Lines = makeInvoiceLines([billingItems4[0]])
const invoice6Lines = makeInvoiceLines([billingItems4[1]])

const invoices = [
  // ── FAC-2026-0001 : Dupont — consultation + assignation + mise en état dossier (5h = 125 000 ct HT) — payée
  {
    uuid: INV1_UUID,
    documentType: 'invoice',
    number: 'FAC-2026-0001',
    sequenceYear: 2026,
    sequenceValue: 1,
    issuedAt: '2026-02-28',
    dueAt: '2026-03-30',
    dossierId: D1_ID,
    dossierLabel: 'Dupont c/ Moreau SARL',
    clientContactUuid: C1_UUID,
    clientLabel: 'M. Bernard Dupont',
    clientSnapshot: clientSnapshot1,
    issuerSnapshot,
    templateUuid: 'default',
    ...applyInvoiceAmounts(invoice1Lines),
    status: 'paid',
    paymentStatus: 'paid',
    paidAmountCents: makeInvoiceAmounts(invoice1Lines).totalTtcCents,
    remainingAmountCents: 0,
    paidAt: '2026-03-20',
    payments: [
      {
        uuid: PAY1_UUID,
        paidAt: '2026-03-20',
        amountCents: makeInvoiceAmounts(invoice1Lines).totalTtcCents,
        method: 'transfer',
        reference: 'VRT-20260320',
        notes: 'Règlement intégral de la première facture Dupont.',
        createdAt: '2026-03-20T10:00:00.000Z',
        updatedAt: '2026-03-20T10:00:00.000Z'
      }
    ],
    originalInvoiceRefs: [],
    paymentTerms: 'Paiement à 30 jours à compter de la date de facturation.',
    notes: 'Facture soldée. Les trois lignes sont dérivées des prestations facturées du dossier.',
    createdAt: '2026-02-28T10:00:00.000Z',
    updatedAt: '2026-03-20T10:00:00.000Z'
  },

  // ── FAC-2026-0005 : Dupont — audience + analyse pièces adverses (4h = 100 000 ct HT) — émise
  {
    uuid: INV2_UUID,
    documentType: 'invoice',
    number: 'FAC-2026-0005',
    sequenceYear: 2026,
    sequenceValue: 5,
    issuedAt: '2026-04-15',
    dueAt: '2026-05-15',
    dossierId: D1_ID,
    dossierLabel: 'Dupont c/ Moreau SARL',
    clientContactUuid: C1_UUID,
    clientLabel: 'M. Bernard Dupont',
    clientSnapshot: clientSnapshot1,
    issuerSnapshot,
    templateUuid: 'default',
    ...applyInvoiceAmounts(invoice2Lines),
    status: 'issued',
    paymentStatus: 'unpaid',
    paidAmountCents: 0,
    remainingAmountCents: makeInvoiceAmounts(invoice2Lines).totalTtcCents,
    payments: [],
    originalInvoiceRefs: [],
    paymentTerms: 'Paiement à 30 jours à compter de la date de facturation.',
    notes:
      'Facture en attente de règlement. Elle reprend uniquement les prestations marquées facturées sur FAC-2026-0005.',
    createdAt: '2026-04-15T10:00:00.000Z',
    updatedAt: '2026-04-15T10:00:00.000Z'
  },

  // ── FAC-2026-0002 : Renard — requête + consultations + échanges adverses (1 u + 3h = 130 000 ct HT) — payée
  {
    uuid: INV3_UUID,
    documentType: 'invoice',
    number: 'FAC-2026-0002',
    sequenceYear: 2026,
    sequenceValue: 2,
    issuedAt: '2026-03-25',
    dueAt: '2026-04-25',
    dossierId: D2_ID,
    dossierLabel: 'Renard - Procédure de divorce',
    clientContactUuid: C3_UUID,
    clientLabel: 'Mme Claire Renard',
    clientSnapshot: clientSnapshot2,
    issuerSnapshot,
    templateUuid: 'default',
    ...applyInvoiceAmounts(invoice3Lines),
    status: 'paid',
    paymentStatus: 'paid',
    paidAmountCents: makeInvoiceAmounts(invoice3Lines).totalTtcCents,
    remainingAmountCents: 0,
    paidAt: '2026-04-10',
    payments: [
      {
        uuid: PAY3_UUID,
        paidAt: '2026-04-10',
        amountCents: makeInvoiceAmounts(invoice3Lines).totalTtcCents,
        method: 'transfer',
        reference: 'VRT-20260410',
        notes: 'Règlement du premier appel forfaitaire et des diligences de préparation.',
        createdAt: '2026-04-10T10:00:00.000Z',
        updatedAt: '2026-04-10T10:00:00.000Z'
      }
    ],
    originalInvoiceRefs: [],
    paymentTerms: '50 % à la signature de la convention — solde à la clôture de la procédure.',
    notes:
      'Facture soldée. Montant aligné sur les prestations forfaitaires et horaires déjà facturées.',
    createdAt: '2026-03-25T10:00:00.000Z',
    updatedAt: '2026-04-10T10:00:00.000Z'
  },

  // ── FAC-2026-0004 : Fontaine — provision honoraires (3,5h = 87 500 ct HT) — payée
  {
    uuid: INV4_UUID,
    documentType: 'invoice',
    number: 'FAC-2026-0004',
    sequenceYear: 2026,
    sequenceValue: 4,
    issuedAt: '2026-04-10',
    dueAt: '2026-05-10',
    dossierId: D3_ID,
    dossierLabel: 'Fontaine - Accident de la route',
    clientContactUuid: C5_UUID,
    clientLabel: 'M. Antoine Fontaine',
    clientSnapshot: clientSnapshot3,
    issuerSnapshot,
    templateUuid: 'default',
    ...applyInvoiceAmounts(invoice4Lines),
    status: 'paid',
    paymentStatus: 'paid',
    paidAmountCents: makeInvoiceAmounts(invoice4Lines).totalTtcCents,
    remainingAmountCents: 0,
    paidAt: '2026-04-22',
    payments: [
      {
        uuid: PAY4_UUID,
        paidAt: '2026-04-22',
        amountCents: makeInvoiceAmounts(invoice4Lines).totalTtcCents,
        method: 'transfer',
        reference: 'VRT-20260422',
        notes: 'Provision réglée avant expertise médicale.',
        createdAt: '2026-04-22T10:00:00.000Z',
        updatedAt: '2026-04-22T10:00:00.000Z'
      }
    ],
    originalInvoiceRefs: [],
    paymentTerms:
      "Provision de 500 € HT à la signature — honoraires complémentaires à l'issue de la procédure.",
    notes:
      'Facture de provision sur honoraires — dossier préjudice corporel. Montants issus des prestations facturées.',
    createdAt: '2026-04-10T10:00:00.000Z',
    updatedAt: '2026-04-22T10:00:00.000Z'
  },

  // ── RET-2026-0001 : Lemoine (AJ) — rétribution de l'État (pièce distincte), exonérée de TVA, recouvrée CARPA — payée
  {
    uuid: INV5_UUID,
    documentType: 'stateRetribution',
    number: 'RET-2026-0001',
    sequenceYear: 2026,
    sequenceValue: 1,
    issuedAt: '2026-04-08',
    dueAt: '2026-05-08',
    dossierId: D4_ID,
    dossierLabel: D4_MATTER_LABEL,
    clientContactUuid: C7_UUID,
    clientLabel: 'CARPA de Lyon — Aide juridictionnelle',
    clientSnapshot: {
      name: 'CARPA de Lyon — Service Aide Juridictionnelle',
      address: '176, rue de Créqui — 69003 Lyon'
    },
    issuerSnapshot,
    templateUuid: 'default',
    ...applyInvoiceAmounts(invoice5Lines),
    status: 'paid',
    paymentStatus: 'paid',
    paidAmountCents: makeInvoiceAmounts(invoice5Lines).totalTtcCents,
    remainingAmountCents: 0,
    paidAt: '2026-05-02',
    payments: [
      {
        uuid: PAY5_UUID,
        paidAt: '2026-05-02',
        amountCents: makeInvoiceAmounts(invoice5Lines).totalTtcCents,
        method: 'transfer',
        reference: 'CARPA-AJ-20260502',
        notes: 'Versement CARPA de la rétribution AJ.',
        createdAt: '2026-05-02T10:00:00.000Z',
        updatedAt: '2026-05-02T10:00:00.000Z'
      }
    ],
    originalInvoiceRefs: [],
    paymentTerms: "Rétribution de l'État recouvrée auprès de la CARPA de Lyon.",
    notes:
      "Rétribution au titre de l'aide juridictionnelle (décision BAJ n° 2026/0457). Exonérée de TVA — art. 261-4-1° du CGI.",
    createdAt: '2026-04-08T10:00:00.000Z',
    updatedAt: '2026-05-02T10:00:00.000Z'
  },

  // ── FAC-2026-0003 : Lemoine (AJ) — complément d'honoraires négocié (500 € HT + TVA) — émise
  {
    uuid: INV6_UUID,
    documentType: 'invoice',
    number: 'FAC-2026-0003',
    sequenceYear: 2026,
    sequenceValue: 3,
    issuedAt: '2026-04-08',
    dueAt: '2026-05-08',
    dossierId: D4_ID,
    dossierLabel: D4_MATTER_LABEL,
    clientContactUuid: C7_UUID,
    clientLabel: 'Mme Nadia Lemoine',
    clientSnapshot: clientSnapshot4,
    issuerSnapshot,
    templateUuid: 'default',
    ...applyInvoiceAmounts(invoice6Lines),
    status: 'issued',
    paymentStatus: 'unpaid',
    paidAmountCents: 0,
    remainingAmountCents: makeInvoiceAmounts(invoice6Lines).totalTtcCents,
    payments: [],
    originalInvoiceRefs: [],
    paymentTerms: 'Paiement à 30 jours à compter de la date de facturation.',
    notes:
      "Complément d'honoraires librement négocié (AJ partielle), conformément à l'article 35 de la loi n° 91-647 du 10 juillet 1991. Plafond légal : 920 € HT.",
    createdAt: '2026-04-08T10:00:00.000Z',
    updatedAt: '2026-04-08T10:00:00.000Z'
  }
]

const allBillingItems = [...billingItems1, ...billingItems2, ...billingItems3, ...billingItems4]

function assertEqual(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${label}: attendu ${expected}, obtenu ${actual}`)
  }
}

function assertSeedInvoiceConsistency() {
  const billingItemsById = new Map(allBillingItems.map((item) => [item.uuid, item]))
  const invoicedLineIds = new Set()

  for (const invoice of invoices) {
    const amounts = makeInvoiceAmounts(invoice.lines)
    assertEqual(`${invoice.number} total HT`, invoice.totalHtCents, amounts.totalHtCents)
    assertEqual(`${invoice.number} total TVA`, invoice.totalVatCents, amounts.totalVatCents)
    assertEqual(`${invoice.number} total TTC`, invoice.totalTtcCents, amounts.totalTtcCents)

    const expectedVatBreakdown = JSON.stringify(amounts.vatBreakdown)
    const actualVatBreakdown = JSON.stringify(invoice.vatBreakdown)
    if (actualVatBreakdown !== expectedVatBreakdown) {
      throw new Error(`${invoice.number} ventilation TVA incohérente`)
    }

    const paidAmountCents = sumCents(invoice.payments, (payment) => payment.amountCents)
    assertEqual(`${invoice.number} paiements`, invoice.paidAmountCents, paidAmountCents)
    assertEqual(
      `${invoice.number} restant dû`,
      invoice.remainingAmountCents,
      invoice.totalTtcCents - invoice.paidAmountCents
    )

    for (const line of invoice.lines) {
      const item = billingItemsById.get(line.billingItemUuid)
      if (!item) {
        throw new Error(`${invoice.number}: prestation introuvable ${line.billingItemUuid}`)
      }
      if (item.status !== 'billed') {
        throw new Error(`${invoice.number}: prestation non facturée ${item.uuid}`)
      }
      assertEqual(`${invoice.number}/${item.uuid} invoiceUuid`, item.invoiceUuid, invoice.uuid)
      assertEqual(
        `${invoice.number}/${item.uuid} invoiceNumber`,
        item.invoiceNumber,
        invoice.number
      )
      assertEqual(`${invoice.number}/${item.uuid} HT`, line.totalHtCents, item.totalHtCents)
      assertEqual(`${invoice.number}/${item.uuid} TTC`, line.totalTtcCents, item.totalTtcCents)
      assertEqual(
        `${invoice.number}/${item.uuid} TVA`,
        line.vatRateBasisPoints,
        item.vatRateBasisPoints
      )
      invoicedLineIds.add(item.uuid)
    }
  }

  for (const item of allBillingItems) {
    if (item.status === 'billed' && !invoicedLineIds.has(item.uuid)) {
      throw new Error(`Prestation facturée absente des factures: ${item.uuid}`)
    }
  }
}

// ─── Documents de démonstration (vrais fichiers .docx, lisibles & indexables) ──

const documents1 = [
  {
    filename: 'Contrat_de_prestation_Dupont-Moreau.docx',
    title: "Convention d'honoraires — Dupont c/ Moreau SARL",
    bodyHtml: `${letterhead()}
      <h1>Convention d'honoraires</h1>
      <p><strong>Entre :</strong> Maître Sophie Delacroix, Avocat au Barreau de Lyon, ci-après « l'Avocat »,</p>
      <p><strong>Et :</strong> Monsieur Bernard Dupont, demeurant 45 avenue des Frères Lumière, 69008 Lyon, ci-après « le Client ».</p>
      <h2>Article 1 — Objet de la mission</h2>
      <p>L'Avocat assiste et représente le Client dans le litige commercial l'opposant à la société Moreau SARL, pour impayé de prestations de services d'un montant de 15 000 €.</p>
      <h2>Article 2 — Honoraires</h2>
      <p>Les honoraires sont fixés au temps passé, au taux horaire de <strong>250 € HT</strong> (TVA 20 %). Une estimation de 20 heures de travail est convenue à titre indicatif.</p>
      <h2>Article 3 — Modalités de paiement</h2>
      <p>Les factures sont payables à 30 jours à compter de leur date d'émission.</p>
      <p style="margin-top:32px">Fait à Lyon, le 25 janvier 2026, en deux exemplaires.</p>
      <p>L'Avocat : __________________  &nbsp;&nbsp;&nbsp; Le Client : __________________</p>`
  },
  {
    filename: 'Assignation.docx',
    title: 'Assignation devant le Tribunal de Commerce de Lyon',
    bodyHtml: `${letterhead()}
      <h1>Assignation</h1>
      <p><strong>À LA REQUÊTE DE :</strong> Monsieur Bernard Dupont, demeurant à Lyon (69008),</p>
      <p>Ayant pour avocat Maître Sophie Delacroix, Barreau de Lyon (toque L-0847).</p>
      <p><strong>DONNONS ASSIGNATION À :</strong> La société MOREAU SARL, prise en la personne de son gérant M. Philippe Moreau, dont le siège est 8 rue du Commerce, 69007 Lyon,</p>
      <p><strong>À COMPARAÎTRE</strong> devant le Tribunal de Commerce de Lyon.</p>
      <h2>I. Exposé des faits</h2>
      <p>Le requérant a réalisé pour le compte de la société Moreau SARL diverses prestations de services demeurées impayées à hauteur de 15 000 €, malgré plusieurs relances.</p>
      <h2>II. Discussion</h2>
      <p>En application des articles 1103 et 1217 du Code civil, le défaut de paiement engage la responsabilité contractuelle de la société défenderesse.</p>
      <h2>III. Par ces motifs</h2>
      <p>Condamner la société Moreau SARL à payer la somme de 15 000 € en principal, outre les intérêts de retard et les frais irrépétibles au titre de l'article 700 du CPC.</p>`
  },
  {
    filename: 'PV_signification.docx',
    title: 'Procès-verbal de signification',
    bodyHtml: `${letterhead()}
      <h1>Procès-verbal de signification</h1>
      <p>L'an deux mille vingt-six, le 25 février, à la requête de M. Bernard Dupont, j'ai, huissier de justice soussigné (Étude de Me Bertrand, 69001 Lyon),</p>
      <p>signifié à la société MOREAU SARL l'assignation devant le Tribunal de Commerce de Lyon, en parlant à une personne habilitée à recevoir l'acte au siège social.</p>
      <p>Dont acte. Coût de l'acte : 78,50 € TTC.</p>`
  },
  {
    filename: 'Conclusions_n1_Dupont.docx',
    title: 'Conclusions n° 1 pour M. Dupont',
    bodyHtml: `${letterhead()}
      <h1>Conclusions n° 1</h1>
      <p><strong>Pour :</strong> Monsieur Bernard Dupont, demandeur.</p>
      <p><strong>Contre :</strong> La société Moreau SARL, défenderesse.</p>
      <h2>Rappel de la procédure</h2>
      <p>Par assignation du 25 février 2026, le concluant a saisi le Tribunal aux fins de condamnation de la défenderesse au paiement de la somme de 15 000 €.</p>
      <h2>Moyens de droit</h2>
      <p>La preuve de la créance résulte des bons de commande signés et des factures produites (pièces n° 1 à 8). La défenderesse ne conteste pas la réalité des prestations.</p>
      <h2>Demandes</h2>
      <p>Confirmer la condamnation au paiement du principal, des intérêts et de 2 500 € au titre de l'article 700 du CPC.</p>`
  },
  // Paire de versions pour la fonctionnalité « Comparaison de conclusions » :
  // les n° 1 et n° 2 partagent l'essentiel de leurs paragraphes ; la n° 2
  // modifie les montants, supprime un paragraphe et AJOUTE deux moyens citant
  // des textes (vérification de citations) et de nouvelles pièces adverses
  // (détection « pièce n°X »).
  {
    filename: 'Conclusions_adverses_Moreau.docx',
    title: 'Conclusions en défense n° 1 — Moreau SARL',
    bodyHtml: `${letterhead()}
      <h1>Conclusions en défense n° 1</h1>
      <p><strong>Pour :</strong> La société Moreau SARL, défenderesse.</p>
      <p><strong>Contre :</strong> Monsieur Bernard Dupont, demandeur.</p>
      <h2>I. Rappel des faits</h2>
      <p>La société Moreau SARL a confié à M. Dupont diverses prestations de services informatiques au cours de l'année 2025, dans le cadre d'un contrat-cadre conclu le 15 mars 2025.</p>
      <p>Les livrables remis en septembre et octobre 2025 ont fait l'objet de réserves écrites circonstanciées, demeurées sans réponse du prestataire (pièces adverses n° 1 à 3).</p>
      <h2>II. Discussion</h2>
      <p>Plusieurs livrables présentent des défauts de conformité documentés par les comptes rendus de réunion et les échanges de courriels produits (pièces adverses n° 4 à 8).</p>
      <p>La défenderesse sollicite en conséquence une réduction du montant réclamé à hauteur de 6 000 €.</p>
      <p>Les paiements partiels intervenus en novembre 2025 démontrent la bonne foi de la société Moreau SARL (pièce adverse n° 9).</p>
      <h2>III. Par ces motifs</h2>
      <p>Débouter M. Dupont de ses demandes au-delà de la somme de 9 000 € en principal ;</p>
      <p>Rejeter la demande formée au titre de l'article 700 du CPC.</p>`
  },
  {
    filename: 'Conclusions_adverses_Moreau_n2.docx',
    title: 'Conclusions en défense n° 2 — Moreau SARL',
    bodyHtml: `${letterhead()}
      <h1>Conclusions en défense n° 2</h1>
      <p><strong>Pour :</strong> La société Moreau SARL, défenderesse.</p>
      <p><strong>Contre :</strong> Monsieur Bernard Dupont, demandeur.</p>
      <h2>I. Rappel des faits</h2>
      <p>La société Moreau SARL a confié à M. Dupont diverses prestations de services informatiques au cours de l'année 2025, dans le cadre d'un contrat-cadre conclu le 15 mars 2025.</p>
      <p>Les livrables remis en septembre et octobre 2025 ont fait l'objet de réserves écrites circonstanciées, demeurées sans réponse du prestataire (pièces adverses n° 1 à 3).</p>
      <h2>II. Discussion</h2>
      <p>Plusieurs livrables présentent des défauts de conformité documentés par les comptes rendus de réunion et les échanges de courriels produits (pièces adverses n° 4 à 8).</p>
      <p>La défenderesse sollicite en conséquence une réduction du montant réclamé à hauteur de 8 500 €.</p>
      <h2>II bis. Sur la prescription partielle des factures</h2>
      <p>Les factures émises antérieurement au 1er février 2021 sont prescrites par application de l'article L. 110-4 du Code de commerce, qui soumet les obligations nées entre commerçants à une prescription quinquennale. La créance correspondante, soit 2 400 €, ne peut donc être utilement réclamée (pièces adverses nos 13 à 15).</p>
      <h2>II ter. Sur la charge de la preuve</h2>
      <p>En application de l'article 1353 du Code civil et de l'article 9 du Code de procédure civile, il appartient au demandeur d'établir la conformité des prestations dont il réclame le paiement. Le rapport d'audit technique versé aux débats établit au contraire la non-conformité de trois livrables sur huit (pièce adverse n° 16).</p>
      <h2>III. Par ces motifs</h2>
      <p>Débouter M. Dupont de ses demandes au-delà de la somme de 6 500 € en principal ;</p>
      <p>Rejeter la demande formée au titre de l'article 700 du CPC.</p>`
  },
  {
    filename: 'Pieces_communiquees_Moreau.docx',
    title: 'Bordereau de pièces communiquées — Moreau SARL',
    bodyHtml: `${letterhead()}
      <h1>Bordereau de communication de pièces</h1>
      <p>Communiquées par la société Moreau SARL :</p>
      <ol>
        <li>Échange de courriels du 12/09/2025</li>
        <li>Compte rendu de réunion du 03/10/2025</li>
        <li>Réserves écrites sur les livrables</li>
        <li>Relevé de paiements partiels</li>
        <li>Attestation de M. Moreau</li>
      </ol>`
  }
]

const documents2 = [
  {
    filename: 'Requete_initiale.docx',
    title: 'Requête en divorce — Mme Renard',
    bodyHtml: `${letterhead()}
      <h1>Requête en divorce</h1>
      <p><strong>À Madame, Monsieur le Juge aux Affaires Familiales près le Tribunal judiciaire de Lyon.</strong></p>
      <p><strong>Pour :</strong> Madame Claire Renard, née le 4 mai 1988, demeurant 22 rue Garibaldi, 69006 Lyon, ayant pour avocat Maître Sophie Delacroix.</p>
      <h2>Objet</h2>
      <p>La requérante sollicite le prononcé du divorce d'avec M. Julien Renard ainsi que le règlement de ses conséquences, notamment s'agissant de la résidence des deux enfants mineurs, Emma (8 ans) et Lucas (5 ans).</p>
      <h2>Demandes au titre des mesures provisoires</h2>
      <ul>
        <li>Fixation de la résidence habituelle des enfants au domicile de la mère ;</li>
        <li>Fixation d'une pension alimentaire au titre du devoir de secours ;</li>
        <li>Attribution de la jouissance du logement familial.</li>
      </ul>`
  },
  {
    filename: 'Acte_de_mariage.docx',
    title: "Extrait d'acte de mariage",
    bodyHtml: `${letterhead()}
      <h1>Extrait d'acte de mariage</h1>
      <p><strong>Mairie de Lyon 6ᵉ arrondissement.</strong></p>
      <p>Le 18 juin 2015 ont été unis par les liens du mariage :</p>
      <p>Monsieur Julien RENARD, né le 2 mars 1986 à Lyon, et Madame Claire MARTIN, née le 4 mai 1988 à Villeurbanne.</p>
      <p>Régime matrimonial : communauté réduite aux acquêts (absence de contrat de mariage).</p>
      <p>Mention : pièce produite à titre de justificatif dans la procédure de divorce.</p>`
  },
  {
    filename: 'Convention_parentale_projet.docx',
    title: 'Projet de convention parentale',
    bodyHtml: `${letterhead()}
      <h1>Projet de convention parentale</h1>
      <p>Entre Mme Claire Renard et M. Julien Renard, parents d'Emma et de Lucas.</p>
      <h2>Résidence des enfants</h2>
      <p>La résidence habituelle des enfants est fixée au domicile de la mère. Un droit de visite et d'hébergement est aménagé au profit du père un week-end sur deux et la moitié des vacances scolaires.</p>
      <h2>Contribution à l'entretien et à l'éducation</h2>
      <p>Le père versera une pension alimentaire mensuelle de 350 € par enfant, indexée sur l'indice INSEE des prix à la consommation.</p>
      <p><em>Projet soumis à discussion — non signé.</em></p>`
  },
  // Seconde version du projet, pour la comparaison de documents : DVH étendu,
  // pension réévaluée, clause ajoutée citant le Code civil et une pièce nouvelle.
  {
    filename: 'Convention_parentale_projet_v2.docx',
    title: 'Projet de convention parentale — version 2',
    bodyHtml: `${letterhead()}
      <h1>Projet de convention parentale</h1>
      <p>Entre Mme Claire Renard et M. Julien Renard, parents d'Emma et de Lucas.</p>
      <h2>Résidence des enfants</h2>
      <p>La résidence habituelle des enfants est fixée au domicile de la mère. Un droit de visite et d'hébergement est aménagé au profit du père un week-end sur deux, du vendredi soir à la sortie des classes au lundi matin à la rentrée des classes, ainsi que la moitié des vacances scolaires.</p>
      <h2>Contribution à l'entretien et à l'éducation</h2>
      <p>Le père versera une pension alimentaire mensuelle de 420 € par enfant, indexée sur l'indice INSEE des prix à la consommation.</p>
      <h2>Frais exceptionnels</h2>
      <p>Conformément aux articles 373-2-2 et 373-2-9 du Code civil, les frais scolaires, médicaux et paramédicaux non remboursés seront partagés par moitié entre les parents, sur présentation de justificatifs (pièce n° 9 : attestation de l'employeur de Mme Renard sur ses horaires de travail).</p>
      <p><em>Projet — version 2 transmise au conseil adverse le 12 mai 2026.</em></p>`
  },
  {
    filename: 'Convocation_audience_JAF.docx',
    title: "Convocation à l'audience JAF",
    bodyHtml: `${letterhead()}
      <h1>Convocation à l'audience</h1>
      <p><strong>Tribunal judiciaire de Lyon — Juge aux Affaires Familiales.</strong></p>
      <p>Affaire : Renard c/ Renard — RG n° 2026/FAM/00087.</p>
      <p>Les parties sont convoquées à l'audience de tentative de conciliation qui se tiendra le <strong>20 mai 2026 à 10 h 30</strong>, salle 4.</p>
      <p>Présence des parties obligatoire. Pièces à produire : justificatifs de revenus N-1 et bulletins de salaire.</p>`
  },
  {
    filename: 'Pieces_financieres_Renard.docx',
    title: 'Pièces financières — Mme Renard',
    bodyHtml: `${letterhead()}
      <h1>Pièces financières</h1>
      <p>Récapitulatif des justificatifs produits par Mme Claire Renard :</p>
      <ol>
        <li>Avis d'imposition 2025 (revenus 2024)</li>
        <li>Trois derniers bulletins de salaire</li>
        <li>Relevé de prêt immobilier</li>
        <li>Justificatifs de charges (loyer, garde d'enfants, scolarité)</li>
      </ol>
      <p>Ces éléments fondent la demande de pension alimentaire et de contribution à l'entretien des enfants.</p>`
  }
]

const documents3 = [
  {
    filename: 'PV_constat.docx',
    title: 'Procès-verbal de constat — accident',
    bodyHtml: `${letterhead()}
      <h1>Procès-verbal de constat</h1>
      <p><strong>Accident de la circulation du 12 novembre 2025 — Lyon 3ᵉ.</strong></p>
      <p>À 18 h 10, à l'angle de la rue Servient et du cours Lafayette, un véhicule a renversé M. Antoine Fontaine, piéton engagé sur un passage protégé.</p>
      <p>Le conducteur du véhicule, assuré auprès de Sécuritas Assurances (police SEC-2025-L3-44821), reconnaît les faits sur le constat amiable.</p>
      <p>Conditions : chaussée sèche, visibilité bonne, signalisation lumineuse en fonctionnement.</p>`
  },
  {
    filename: 'Rapport_medical_initial.docx',
    title: 'Rapport médical initial',
    bodyHtml: `${letterhead()}
      <h1>Rapport médical initial</h1>
      <p><strong>Patient :</strong> M. Antoine Fontaine. <strong>Date d'examen :</strong> 13 novembre 2025.</p>
      <h2>Constatations</h2>
      <p>Fracture déplacée de l'extrémité distale du radius droit ; traumatisme crânien léger sans perte de connaissance prolongée.</p>
      <h2>Traitement</h2>
      <p>Réduction et immobilisation plâtrée. Arrêt de travail initial de 45 jours. Rééducation à prévoir.</p>`
  },
  {
    filename: 'Rapport_medical_expertise.docx',
    title: 'Rapport médical de consolidation',
    bodyHtml: `${letterhead()}
      <h1>Rapport médical de consolidation</h1>
      <p><strong>Patient :</strong> M. Antoine Fontaine. <strong>Date de consolidation :</strong> 30 avril 2026.</p>
      <h2>Postes de préjudice</h2>
      <ul>
        <li>Déficit fonctionnel temporaire total : 15 jours ;</li>
        <li>Déficit fonctionnel permanent : 4 % ;</li>
        <li>Souffrances endurées : 2,5/7 ;</li>
        <li>Préjudice esthétique : 1/7.</li>
      </ul>
      <p>Ces éléments serviront de base à l'évaluation de l'indemnisation.</p>`
  },
  {
    filename: 'LRAR_mise_en_demeure.docx',
    title: 'Lettre de mise en demeure — Sécuritas Assurances',
    bodyHtml: `${letterhead()}
      <h1>Mise en demeure</h1>
      <p>Lettre recommandée avec accusé de réception.</p>
      <p><strong>Destinataire :</strong> Sécuritas Assurances SA, Tour Part-Dieu, 129 rue Servient, 69003 Lyon.</p>
      <p>Objet : Indemnisation de M. Antoine Fontaine — sinistre SEC-2025-L3-44821.</p>
      <p>En votre qualité d'assureur du véhicule impliqué dans l'accident du 12 novembre 2025, nous vous mettons en demeure de formuler une offre d'indemnisation provisionnelle dans le délai de quinze jours, conformément à l'article L. 211-9 du Code des assurances.</p>
      <p>À défaut, nous saisirons la juridiction compétente.</p>`
  },
  {
    filename: 'Reponse_assureur_Securitas.docx',
    title: "Réponse de l'assureur",
    bodyHtml: `${letterhead()}
      <h1>Réponse de l'assureur</h1>
      <p><strong>De :</strong> Sécuritas Assurances SA.</p>
      <p>Nous accusons réception de votre mise en demeure. Nous contestons en l'état le taux de responsabilité retenu et sollicitons l'organisation d'une expertise médicale contradictoire avant toute offre.</p>
      <p>Nous vous proposons la désignation amiable d'un médecin expert.</p>`
  }
]

// Documents du dossier AJ : focus sur la chaîne « désignation → convention de
// complément → factures État/cliente → attestation de fin de mission ».
const documents4 = [
  {
    filename: 'Decision_admission_AJ_BAJ.docx',
    title: "Décision d'admission à l'aide juridictionnelle",
    bodyHtml: `${letterhead()}
      <h1>Décision d'admission à l'aide juridictionnelle</h1>
      <p><strong>Bureau d'aide juridictionnelle — Tribunal judiciaire de Lyon.</strong></p>
      <p>Décision n° <strong>2026/0457</strong> du 28 mars 2026.</p>
      <p>Madame Nadia LEMOINE, demeurant 5 rue de la Part-Dieu, 69003 Lyon, est admise au bénéfice de l'<strong>aide juridictionnelle partielle</strong>.</p>
      <p>Taux de prise en charge par l'État : <strong>55 %</strong>.</p>
      <p>Avocat désigné / choisi : Maître Sophie Delacroix (Barreau de Lyon, toque L-0847).</p>
      <p>Procédure concernée : contentieux prud'homal Lemoine c/ Transports Veyrat SAS.</p>`
  },
  {
    filename: 'Designation_avocat_AJ.docx',
    title: 'Désignation — Aide juridictionnelle',
    bodyHtml: `${letterhead()}
      <h1>Désignation au titre de l'aide juridictionnelle</h1>
      <p>Je soussignée, Maître Sophie Delacroix, Avocat au Barreau de Lyon, déclare accepter la mission d'assistance et de représentation de <strong>Madame Nadia Lemoine</strong> au titre de l'aide juridictionnelle partielle (décision BAJ n° 2026/0457 du 28 mars 2026, taux 55 %).</p>
      <p>Référence AJ / CARPA : <strong>AJ-2026-0457</strong>.</p>
      <p>La présente désignation est transmise au greffe du Conseil de Prud'hommes de Lyon (RG 2026/F/00214).</p>
      <p style="margin-top:32px">Fait à Lyon, le 9 avril 2026.</p>`
  },
  {
    filename: 'Convention_complement_honoraires_AJ.docx',
    title: "Convention de complément d'honoraires — AJ partielle",
    bodyHtml: `${letterhead()}
      <h1>Convention de complément d'honoraires</h1>
      <p><strong>Aide juridictionnelle partielle — article 35 de la loi n° 91-647 du 10 juillet 1991.</strong></p>
      <p>Entre Maître Sophie Delacroix, Avocat, et Madame Nadia Lemoine, bénéficiaire de l'aide juridictionnelle partielle (55 %).</p>
      <h2>Article 1 — Rétribution de l'État</h2>
      <p>La part prise en charge par l'État au titre de l'aide juridictionnelle s'élève à <strong>1 080 € HT</strong>, exonérée de TVA, recouvrée auprès de la CARPA de Lyon. Elle ne donne lieu à aucun versement de la part de la cliente.</p>
      <h2>Article 2 — Complément d'honoraires</h2>
      <p>Les parties conviennent librement d'un complément d'honoraires de <strong>500 € HT</strong> (soit 600 € TTC, TVA 20 %), à la charge de la cliente. Ce complément demeure inférieur au plafond légal de 920 € HT.</p>
      <h2>Article 3 — Paiement</h2>
      <p>Le complément est payable à réception de la facture FAC-2026-0003, à 30 jours.</p>
      <p style="margin-top:32px">Fait à Lyon, le 5 avril 2026, en deux exemplaires.</p>
      <p>L'Avocat : __________________ &nbsp;&nbsp;&nbsp; La Cliente : __________________</p>`
  },
  {
    filename: 'Attestation_fin_de_mission_AJ.docx',
    title: 'Attestation de fin de mission — AJ',
    bodyHtml: `${letterhead()}
      <h1>Attestation de fin de mission</h1>
      <p><strong>Aide juridictionnelle — décision BAJ n° 2026/0457.</strong></p>
      <p>Je soussignée, Maître Sophie Delacroix, atteste avoir accompli la mission d'assistance et de représentation de Madame Nadia Lemoine dans le cadre de la procédure prud'homale l'opposant à la société Transports Veyrat SAS.</p>
      <p>La présente attestation est destinée à la <strong>CARPA de Lyon</strong> aux fins de recouvrement de la rétribution de l'État (1 080 € HT).</p>
      <p><em>Document à compléter et signer à l'issue effective de la mission.</em></p>`
  },
  {
    filename: 'Justificatifs_ressources_Lemoine.docx',
    title: 'Justificatifs de ressources',
    bodyHtml: `${letterhead()}
      <h1>Justificatifs de ressources</h1>
      <p>Pièces produites par Mme Nadia Lemoine à l'appui de sa demande d'aide juridictionnelle :</p>
      <ol>
        <li>Avis d'imposition 2025 (revenus 2024)</li>
        <li>Attestation de droits CAF</li>
        <li>Justificatif d'allocations de retour à l'emploi</li>
        <li>Notification de licenciement du 15 janvier 2026</li>
      </ol>
      <p>Sur la base de ces éléments, le Bureau d'aide juridictionnelle a retenu un taux de prise en charge de 55 %.</p>`
  }
]

// ─── Écriture des fichiers ────────────────────────────────────────────────────

console.log(`\nGénération du domaine de démonstration : ${ROOT}\n`)

assertSeedInvoiceConsistency()

console.log('📁 Domaine')
writeJson(join(ROOT, '.ordicab', 'domain.json'), domainData)
writeJson(join(ROOT, '.ordicab', 'registry.json'), registryData)
writeJson(join(ROOT, '.ordicab', 'entity.json'), entityData)
writeJson(join(ROOT, '.ordicab', 'cabinet-billing.json'), cabinetBillingData)

// Échéances générales : un fichier par échéance (hors dossier)
for (const kd of generalKeyDates) {
  writeJson(join(ROOT, '.ordicab', 'general-key-dates', `${kd.uuid}.json`), kd)
}

// Factures : un fichier par facture (records, sans index)
for (const inv of invoices) {
  writeJson(join(ROOT, '.ordicab', 'invoices', `${inv.uuid}.json`), inv)
}

// ─── Dossier 1 — Dupont c/ Moreau SARL ───────────────────────────────────────

console.log('\n📁 Dossier 1 — Dupont c/ Moreau SARL')
writeJson(join(ROOT, 'Dupont-c-Moreau-SARL', '.ordicab', 'dossier.json'), dossier1)

for (const contact of contacts1) {
  writeJson(
    join(ROOT, 'Dupont-c-Moreau-SARL', '.ordicab', 'contacts', `${contact.uuid}.json`),
    contact
  )
}

for (const item of billingItems1) {
  writeJson(
    join(ROOT, 'Dupont-c-Moreau-SARL', '.ordicab', 'billing-items', `${item.uuid}.json`),
    item
  )
}

for (const kd of keyDates1) {
  writeJson(join(ROOT, 'Dupont-c-Moreau-SARL', '.ordicab', 'key-dates', `${kd.uuid}.json`), kd)
}

writeDossierNotes('Dupont-c-Moreau-SARL', notes1)

for (const doc of documents1) {
  await writeDocx(join(ROOT, 'Dupont-c-Moreau-SARL', doc.filename), doc)
}

// ─── Dossier 2 — Renard - Procédure de divorce ───────────────────────────────

console.log('\n📁 Dossier 2 — Renard - Procédure de divorce')
writeJson(join(ROOT, 'Renard-Divorce', '.ordicab', 'dossier.json'), dossier2)

for (const contact of contacts2) {
  writeJson(join(ROOT, 'Renard-Divorce', '.ordicab', 'contacts', `${contact.uuid}.json`), contact)
}

for (const item of billingItems2) {
  writeJson(join(ROOT, 'Renard-Divorce', '.ordicab', 'billing-items', `${item.uuid}.json`), item)
}

for (const kd of keyDates2) {
  writeJson(join(ROOT, 'Renard-Divorce', '.ordicab', 'key-dates', `${kd.uuid}.json`), kd)
}

writeDossierNotes('Renard-Divorce', notes2)

for (const doc of documents2) {
  await writeDocx(join(ROOT, 'Renard-Divorce', doc.filename), doc)
}

// ─── Dossier 3 — Fontaine - Accident de la route ─────────────────────────────

console.log('\n📁 Dossier 3 — Fontaine - Accident de la route')
writeJson(join(ROOT, 'Fontaine-Accident', '.ordicab', 'dossier.json'), dossier3)

for (const contact of contacts3) {
  writeJson(
    join(ROOT, 'Fontaine-Accident', '.ordicab', 'contacts', `${contact.uuid}.json`),
    contact
  )
}

for (const item of billingItems3) {
  writeJson(join(ROOT, 'Fontaine-Accident', '.ordicab', 'billing-items', `${item.uuid}.json`), item)
}

for (const kd of keyDates3) {
  writeJson(join(ROOT, 'Fontaine-Accident', '.ordicab', 'key-dates', `${kd.uuid}.json`), kd)
}

writeDossierNotes('Fontaine-Accident', notes3)

for (const doc of documents3) {
  await writeDocx(join(ROOT, 'Fontaine-Accident', doc.filename), doc)
}

// ─── Dossier 4 — Lemoine c/ Transports Veyrat (aide juridictionnelle) ─────────

console.log('\n📁 Dossier 4 — Lemoine c/ Transports Veyrat (aide juridictionnelle)')
writeJson(join(ROOT, D4_ID, '.ordicab', 'dossier.json'), dossier4)

for (const contact of contacts4) {
  writeJson(join(ROOT, D4_ID, '.ordicab', 'contacts', `${contact.uuid}.json`), contact)
}

for (const item of billingItems4) {
  writeJson(join(ROOT, D4_ID, '.ordicab', 'billing-items', `${item.uuid}.json`), item)
}

for (const kd of keyDates4) {
  writeJson(join(ROOT, D4_ID, '.ordicab', 'key-dates', `${kd.uuid}.json`), kd)
}

writeDossierNotes(D4_ID, notes4)

for (const doc of documents4) {
  await writeDocx(join(ROOT, D4_ID, doc.filename), doc)
}

console.log('\n✅ Terminé. Ouvrez Ordicab et sélectionnez ce dossier comme domaine :\n')
console.log(`   ${ROOT}\n`)
