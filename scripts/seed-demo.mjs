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

// Conventions d'honoraires
const FA1_ID = randomUUID()
const FA2_ID = randomUUID()
const FA3_ID = randomUUID()
const FA4_ID = randomUUID() // Convention AJ partielle

// Prestations (billing items)
const BI1A_ID = randomUUID()
const BI1B_ID = randomUUID()
const BI1C_ID = randomUUID()
const BI1D_ID = randomUUID()
const BI1E_ID = randomUUID()
const BI1F_ID = randomUUID()
const BI1G_ID = randomUUID()

const BI2A_ID = randomUUID()
const BI2B_ID = randomUUID()
const BI2C_ID = randomUUID()
const BI2D_ID = randomUUID()
const BI2E_ID = randomUUID()
const BI2F_ID = randomUUID()

const BI3A_ID = randomUUID()
const BI3B_ID = randomUUID()
const BI3C_ID = randomUUID()
const BI3D_ID = randomUUID()
const BI3E_ID = randomUUID()

// Dossier 4 — AJ partielle : rétribution État + complément client
const BI4_STATE_ID = randomUUID() // Rétribution AJ - État (exonérée TVA)
const BI4_COMPL_ID = randomUUID() // Complément d'honoraires - AJ partielle (avec TVA)

// Factures
const INV1_ID = randomUUID()
const INV2_ID = randomUUID()
const INV3_ID = randomUUID()
const INV4_ID = randomUUID()
const INV5_ID = randomUUID() // FAC AJ — rétribution État (CARPA)
const INV6_ID = randomUUID() // FAC AJ — complément client

// Paiements
const PAY1_ID = randomUUID()
const PAY3_ID = randomUUID()
const PAY4_ID = randomUUID()
const PAY5_ID = randomUUID() // Paiement rétribution État (CARPA)

// Dates clés
const KD1A_ID = randomUUID()
const KD1B_ID = randomUUID()
const KD1C_ID = randomUUID()
const KD1D_ID = randomUUID()
const KD1E_ID = randomUUID()
const KD1F_ID = randomUUID()

const KD2A_ID = randomUUID()
const KD2B_ID = randomUUID()
const KD2C_ID = randomUUID()
const KD2D_ID = randomUUID()
const KD2E_ID = randomUUID()

const KD3A_ID = randomUUID()
const KD3B_ID = randomUUID()
const KD3C_ID = randomUUID()
const KD3D_ID = randomUUID()
const KD3E_ID = randomUUID()

const KD4A_ID = randomUUID()
const KD4B_ID = randomUUID()
const KD4C_ID = randomUUID()
const KD4D_ID = randomUUID()
const KD4E_ID = randomUUID()

// Références clés
const KR1_ID = randomUUID()
const KR2_ID = randomUUID()
const KR3_ID = randomUUID()
const KR4_ID = randomUUID()
const KR5_ID = randomUUID()
const KR6_ID = randomUUID()
const KR7_ID = randomUUID()
const KR8_ID = randomUUID()
const KR9_ID = randomUUID()
const KR10_ID = randomUUID()
const KR11_ID = randomUUID()
const KR12_ID = randomUUID()

// ─── Helper: calcul d'une prestation ─────────────────────────────────────────

function makeBillingItem({
  id,
  dossierId,
  date,
  label,
  description,
  quantity,
  quantityUnit,
  unitPriceHtCents,
  vatRateBasisPoints,
  status,
  sourceFeeAgreementId,
  invoiceId,
  invoiceNumber
}) {
  const subtotalHtCents = Math.round(quantity * unitPriceHtCents)
  const totalHtCents = subtotalHtCents
  const totalTtcCents = Math.round(totalHtCents * (1 + vatRateBasisPoints / 10000))
  return {
    id,
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
    ...(sourceFeeAgreementId ? { sourceFeeAgreementId } : {}),
    ...(invoiceId ? { invoiceId, invoiceNumber } : {}),
    createdAt: date + 'T09:00:00.000Z',
    updatedAt: date + 'T09:00:00.000Z'
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
      id: 'Dupont-c-Moreau-SARL',
      uuid: D1_UUID,
      name: 'Dupont c/ Moreau SARL',
      registeredAt: '2026-01-20T10:00:00.000Z'
    },
    {
      id: 'Renard-Divorce',
      uuid: D2_UUID,
      name: 'Renard - Procédure de divorce',
      registeredAt: '2026-02-01T14:00:00.000Z'
    },
    {
      id: 'Fontaine-Accident',
      uuid: D3_UUID,
      name: 'Fontaine - Accident de la route',
      registeredAt: '2026-03-10T11:00:00.000Z'
    },
    {
      id: 'Lemoine-Prudhommes-AJ',
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
  legalForm: 'Avocat individuel',
  iban: 'FR76 3000 6000 0112 3456 7890 189',
  bic: 'AGRIFRPP',
  phone: '+33 4 72 00 10 10',
  email: 'contact@cabinet-delacroix.fr',
  barreau: 'Lyon',
  toque: 'L-0847'
}

const cabinetBillingData = {
  services: [
    {
      id: 'svc-horaire-standard',
      name: 'Honoraires au temps passé',
      description: "Facturation à l'heure pour toutes missions de conseil et contentieux",
      billingType: 'hourly',
      hourlyRateHtCents: 25000,
      vatRateBasisPoints: 2000,
      paymentTerms: 'Paiement à 30 jours à compter de la date de facturation.',
      updatedAt: '2026-01-10T09:00:00.000Z'
    },
    {
      id: 'svc-forfait-divorce',
      name: 'Forfait divorce par consentement mutuel',
      billingType: 'flat',
      flatFeeHtCents: 180000,
      vatRateBasisPoints: 2000,
      paymentTerms: "50 % à la signature de la convention, 50 % à l'homologation.",
      updatedAt: '2026-01-10T09:00:00.000Z'
    }
  ],
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
    issuerName: 'Cabinet Delacroix — Me Sophie Delacroix',
    issuerAddress: '12, rue de la République — 69001 Lyon',
    issuerSiret: '501 234 567 00012',
    issuerVatNumber: 'FR42501234567',
    issuerIban: 'FR76 3000 6000 0112 3456 7890 189',
    legalFooter:
      'Cabinet Delacroix — SIREN 501 234 567 — TVA FR42501234567 — Barreau de Lyon, toque L-0847',
    defaultPaymentTerms: 'Paiement à 30 jours à compter de la date de facturation.'
  },
  updatedAt: '2026-01-10T09:00:00.000Z'
}

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
    id: BI1A_ID,
    dossierId: D1_ID,
    date: '2026-02-03',
    label: 'Consultation initiale et analyse du dossier',
    description: 'Première consultation, recueil des faits, analyse des pièces contractuelles',
    quantity: 1,
    quantityUnit: 'hours',
    unitPriceHtCents: 25000,
    vatRateBasisPoints: 2000,
    status: 'billed',
    sourceFeeAgreementId: FA1_ID,
    invoiceId: INV1_ID,
    invoiceNumber: 'FAC-2026-0001'
  }),
  makeBillingItem({
    id: BI1B_ID,
    dossierId: D1_ID,
    date: '2026-02-20',
    label: "Rédaction de l'assignation",
    description: 'Assignation devant le Tribunal de Commerce de Lyon',
    quantity: 3,
    quantityUnit: 'hours',
    unitPriceHtCents: 25000,
    vatRateBasisPoints: 2000,
    status: 'billed',
    sourceFeeAgreementId: FA1_ID,
    invoiceId: INV1_ID,
    invoiceNumber: 'FAC-2026-0001'
  }),
  makeBillingItem({
    id: BI1C_ID,
    dossierId: D1_ID,
    date: '2026-02-25',
    label: 'Signification et mise en état du dossier',
    description: "Coordination avec l'huissier, constitution du dossier de pièces",
    quantity: 1,
    quantityUnit: 'hours',
    unitPriceHtCents: 25000,
    vatRateBasisPoints: 2000,
    status: 'billed',
    sourceFeeAgreementId: FA1_ID,
    invoiceId: INV1_ID,
    invoiceNumber: 'FAC-2026-0001'
  }),
  makeBillingItem({
    id: BI1D_ID,
    dossierId: D1_ID,
    date: '2026-03-12',
    label: 'Audience de mise en état',
    description: 'Présentation au Tribunal de Commerce de Lyon, fixation du calendrier',
    quantity: 2,
    quantityUnit: 'hours',
    unitPriceHtCents: 25000,
    vatRateBasisPoints: 2000,
    status: 'billed',
    sourceFeeAgreementId: FA1_ID,
    invoiceId: INV2_ID,
    invoiceNumber: 'FAC-2026-0005'
  }),
  makeBillingItem({
    id: BI1E_ID,
    dossierId: D1_ID,
    date: '2026-03-28',
    label: 'Analyse des pièces adverses',
    description: 'Examen des conclusions et pièces communiquées par Moreau SARL',
    quantity: 2,
    quantityUnit: 'hours',
    unitPriceHtCents: 25000,
    vatRateBasisPoints: 2000,
    status: 'billed',
    sourceFeeAgreementId: FA1_ID,
    invoiceId: INV2_ID,
    invoiceNumber: 'FAC-2026-0005'
  }),
  makeBillingItem({
    id: BI1F_ID,
    dossierId: D1_ID,
    date: '2026-04-10',
    label: 'Rédaction des conclusions en réponse',
    description: 'Réponse aux conclusions adverses, développement des moyens de droit',
    quantity: 5,
    quantityUnit: 'hours',
    unitPriceHtCents: 25000,
    vatRateBasisPoints: 2000,
    status: 'draft',
    sourceFeeAgreementId: FA1_ID
  }),
  makeBillingItem({
    id: BI1G_ID,
    dossierId: D1_ID,
    date: '2026-04-28',
    label: "Préparation de l'audience de plaidoirie",
    description: 'Synthèse du dossier, préparation des arguments oraux',
    quantity: 3,
    quantityUnit: 'hours',
    unitPriceHtCents: 25000,
    vatRateBasisPoints: 2000,
    status: 'draft',
    sourceFeeAgreementId: FA1_ID
  })
]

const keyDates1 = [
  {
    id: KD1A_ID,
    dossierId: D1_ID,
    label: "Saisine et dépôt de l'assignation",
    date: '2026-02-25',
    isClosed: true,
    note: 'Huissier mandaté : Me Bertrand, 69001 Lyon'
  },
  {
    id: KD1B_ID,
    dossierId: D1_ID,
    label: 'Audience de mise en état',
    date: '2026-03-12',
    time: '09:00',
    duration: 60,
    isClosed: true
  },
  {
    id: KD1C_ID,
    dossierId: D1_ID,
    label: 'Communication des pièces adverses',
    date: '2026-03-25',
    isClosed: true,
    note: 'Reçu 12 pièces + conclusions adverses'
  },
  {
    id: KD1D_ID,
    dossierId: D1_ID,
    label: 'Dépôt conclusions en réponse',
    date: '2026-04-30',
    tags: ['imperative'],
    isClosed: false,
    note: 'Délai impératif fixé par ordonnance du 12/03/2026'
  },
  {
    id: KD1E_ID,
    dossierId: D1_ID,
    label: 'Audience de plaidoirie',
    date: '2026-06-18',
    time: '14:00',
    duration: 90,
    tags: ['important'],
    isClosed: false
  },
  {
    id: KD1F_ID,
    dossierId: D1_ID,
    label: 'Délibéré',
    date: '2026-07-10',
    tags: ['to_confirm'],
    isClosed: false
  }
]

const dossier1 = {
  id: D1_ID,
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
    { id: KR1_ID, dossierId: D1_ID, label: 'Nom du dossier', value: 'Dupont c/ Moreau SARL' },
    { id: KR2_ID, dossierId: D1_ID, label: 'N° RG', value: '2026/00123' },
    { id: KR3_ID, dossierId: D1_ID, label: 'Juridiction', value: 'Tribunal de Commerce de Lyon' }
  ],
  feeAgreements: [
    {
      id: FA1_ID,
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
      sentAt: '2026-01-22',
      signedAt: '2026-01-25'
    }
  ],
  billingItems: [],
  keyDates: [],
  documents: []
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
    id: BI2A_ID,
    dossierId: D2_ID,
    date: '2026-02-15',
    label: 'Rédaction et dépôt de la requête en divorce',
    description: 'Requête initiale, constitution du dossier JAF, bordereau de pièces',
    quantity: 1,
    quantityUnit: 'units',
    unitPriceHtCents: 90000,
    vatRateBasisPoints: 2000,
    status: 'billed',
    sourceFeeAgreementId: FA2_ID,
    invoiceId: INV3_ID,
    invoiceNumber: 'FAC-2026-0002'
  }),
  makeBillingItem({
    id: BI2B_ID,
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
    sourceFeeAgreementId: FA2_ID,
    invoiceId: INV3_ID,
    invoiceNumber: 'FAC-2026-0002'
  }),
  makeBillingItem({
    id: BI2C_ID,
    dossierId: D2_ID,
    date: '2026-03-18',
    label: 'Échanges avec le conseil adverse',
    description: 'Courriers et appels téléphoniques avec Me Launay, conseil de M. Renard',
    quantity: 1,
    quantityUnit: 'hours',
    unitPriceHtCents: 20000,
    vatRateBasisPoints: 2000,
    status: 'billed',
    sourceFeeAgreementId: FA2_ID,
    invoiceId: INV3_ID,
    invoiceNumber: 'FAC-2026-0002'
  }),
  makeBillingItem({
    id: BI2D_ID,
    dossierId: D2_ID,
    date: '2026-04-20',
    label: 'Rédaction des conclusions de forme',
    description: 'Demandes sur résidence habituelle des enfants et pension alimentaire',
    quantity: 3,
    quantityUnit: 'hours',
    unitPriceHtCents: 20000,
    vatRateBasisPoints: 2000,
    status: 'draft',
    sourceFeeAgreementId: FA2_ID
  }),
  makeBillingItem({
    id: BI2E_ID,
    dossierId: D2_ID,
    date: '2026-05-12',
    label: "Préparation de l'audience de conciliation",
    description: "Rendez-vous de préparation avec Mme Renard, simulation de l'audience",
    quantity: 1.5,
    quantityUnit: 'hours',
    unitPriceHtCents: 20000,
    vatRateBasisPoints: 2000,
    status: 'draft',
    sourceFeeAgreementId: FA2_ID
  }),
  makeBillingItem({
    id: BI2F_ID,
    dossierId: D2_ID,
    date: '2026-05-20',
    label: 'Audience JAF — tentative de conciliation',
    description: "Représentation à l'audience, présentation des demandes",
    quantity: 2,
    quantityUnit: 'hours',
    unitPriceHtCents: 20000,
    vatRateBasisPoints: 2000,
    status: 'draft',
    sourceFeeAgreementId: FA2_ID
  })
]

const keyDates2 = [
  {
    id: KD2A_ID,
    dossierId: D2_ID,
    label: 'Dépôt de la requête en divorce',
    date: '2026-02-15',
    isClosed: true,
    note: 'Déposée au greffe du TJ Lyon, reçu le 15/02/2026'
  },
  {
    id: KD2B_ID,
    dossierId: D2_ID,
    label: 'Notification à M. Renard',
    date: '2026-02-22',
    isClosed: true,
    note: "Signifié par voie d'huissier"
  },
  {
    id: KD2C_ID,
    dossierId: D2_ID,
    label: 'Convocation audience JAF reçue',
    date: '2026-03-10',
    isClosed: true
  },
  {
    id: KD2D_ID,
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
    id: KD2E_ID,
    dossierId: D2_ID,
    label: 'Audience JAF — tentative de conciliation',
    date: '2026-05-20',
    time: '10:30',
    duration: 60,
    tags: ['important'],
    isClosed: false
  }
]

const dossier2 = {
  id: D2_ID,
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
      id: KR4_ID,
      dossierId: D2_ID,
      label: 'Nom du dossier',
      value: 'Renard - Procédure de divorce'
    },
    { id: KR5_ID, dossierId: D2_ID, label: 'N° RG', value: '2026/FAM/00087' },
    { id: KR6_ID, dossierId: D2_ID, label: 'Juge référent', value: 'Mme la juge Martin' }
  ],
  feeAgreements: [
    {
      id: FA2_ID,
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
      sentAt: '2026-02-03',
      signedAt: '2026-02-05'
    }
  ],
  billingItems: [],
  keyDates: [],
  documents: []
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
    id: BI3A_ID,
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
    sourceFeeAgreementId: FA3_ID,
    invoiceId: INV4_ID,
    invoiceNumber: 'FAC-2026-0004'
  }),
  makeBillingItem({
    id: BI3B_ID,
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
    sourceFeeAgreementId: FA3_ID,
    invoiceId: INV4_ID,
    invoiceNumber: 'FAC-2026-0004'
  }),
  makeBillingItem({
    id: BI3C_ID,
    dossierId: D3_ID,
    date: '2026-04-22',
    label: "Mise en demeure de l'assureur",
    description: 'Rédaction et envoi de la lettre de mise en demeure à Sécuritas Assurances',
    quantity: 1,
    quantityUnit: 'hours',
    unitPriceHtCents: 25000,
    vatRateBasisPoints: 2000,
    status: 'draft',
    sourceFeeAgreementId: FA3_ID
  }),
  makeBillingItem({
    id: BI3D_ID,
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
    sourceFeeAgreementId: FA3_ID
  }),
  makeBillingItem({
    id: BI3E_ID,
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
    sourceFeeAgreementId: FA3_ID
  })
]

const keyDates3 = [
  {
    id: KD3A_ID,
    dossierId: D3_ID,
    label: "Déclaration sinistre à l'assureur",
    date: '2026-03-12',
    isClosed: true,
    note: 'Déclaration envoyée par LRAR à Sécuritas Assurances'
  },
  {
    id: KD3B_ID,
    dossierId: D3_ID,
    label: "Mise en demeure de l'assureur",
    date: '2026-04-22',
    isClosed: true
  },
  {
    id: KD3C_ID,
    dossierId: D3_ID,
    label: 'Réponse assureur reçue',
    date: '2026-05-05',
    isClosed: true,
    note: 'Assureur conteste le taux de responsabilité. Contre-expertise demandée.'
  },
  {
    id: KD3D_ID,
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
    id: KD3E_ID,
    dossierId: D3_ID,
    label: 'Délai réponse offre indemnitaire',
    date: '2026-09-01',
    tags: ['urgent'],
    isClosed: false,
    note: "Délai légal de réponse à l'offre indemnitaire (art. L211-9 C. assur.)"
  }
]

const dossier3 = {
  id: D3_ID,
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
      id: KR7_ID,
      dossierId: D3_ID,
      label: 'Nom du dossier',
      value: 'Fontaine - Accident de la route'
    },
    { id: KR8_ID, dossierId: D3_ID, label: 'N° police adverse', value: 'SEC-2025-L3-44821' },
    { id: KR9_ID, dossierId: D3_ID, label: "Date de l'accident", value: '12 novembre 2025' }
  ],
  feeAgreements: [
    {
      id: FA3_ID,
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
        "Provision de 500 € HT à la signature — honoraires complémentaires à l'issue de la procédure."
    }
  ],
  billingItems: [],
  keyDates: [],
  documents: []
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
//   • Complément client :  500 € HT + TVA 20 % (facture FAC-0005)
const billingItems4 = [
  makeBillingItem({
    id: BI4_STATE_ID,
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
    sourceFeeAgreementId: FA4_ID,
    invoiceId: INV5_ID,
    invoiceNumber: 'RET-2026-0001'
  }),
  makeBillingItem({
    id: BI4_COMPL_ID,
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
    sourceFeeAgreementId: FA4_ID,
    invoiceId: INV6_ID,
    invoiceNumber: 'FAC-2026-0003'
  })
]
// Renseigne le type de prestation AJ (source convention) — non géré par makeBillingItem.
billingItems4[0].sourceFeeAgreementBillingKind = 'stateRetribution'
billingItems4[1].sourceFeeAgreementBillingKind = 'legalAidComplement'

const keyDates4 = [
  {
    id: KD4A_ID,
    dossierId: D4_ID,
    label: "Décision d'admission à l'aide juridictionnelle (BAJ)",
    date: '2026-03-28',
    isClosed: true,
    note: 'AJ partielle 55 % — décision n° 2026/0457 du BAJ de Lyon.'
  },
  {
    id: KD4B_ID,
    dossierId: D4_ID,
    label: 'AJ — dépôt de la demande / désignation',
    date: '2026-04-09',
    tags: ['important'],
    isClosed: true,
    note: 'Désignation transmise au greffe du Conseil de Prud’hommes.'
  },
  {
    id: KD4C_ID,
    dossierId: D4_ID,
    label: 'Audience de conciliation (Bureau de conciliation)',
    date: '2026-06-12',
    time: '09:30',
    duration: 60,
    tags: ['important'],
    isClosed: false
  },
  {
    id: KD4D_ID,
    dossierId: D4_ID,
    label: 'AJ — attestation de fin de mission',
    date: '2026-06-04',
    tags: ['to_do'],
    isClosed: false,
    note: 'À adresser à la CARPA pour le recouvrement de la rétribution.'
  },
  {
    id: KD4E_ID,
    dossierId: D4_ID,
    label: 'AJ — recouvrement de la rétribution (CARPA)',
    date: '2026-07-04',
    tags: ['imperative'],
    isClosed: false,
    note: 'Rétribution État 1 080 € HT — pièce RET-2026-0001.'
  }
]

const dossier4 = {
  id: D4_ID,
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
      id: KR10_ID,
      dossierId: D4_ID,
      label: 'N° RG',
      value: '2026/F/00214'
    },
    {
      id: KR11_ID,
      dossierId: D4_ID,
      label: 'Décision AJ (BAJ)',
      value: '2026/0457 — AJ partielle 55 %'
    },
    { id: KR12_ID, dossierId: D4_ID, label: 'N° AJ / CARPA', value: 'AJ-2026-0457' }
  ],
  feeAgreements: [
    {
      id: FA4_ID,
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
      sentAt: '2026-04-03',
      signedAt: '2026-04-05'
    }
  ],
  billingItems: [],
  keyDates: [],
  documents: []
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

const invoices = [
  // ── FAC-2026-0001 : Dupont — consultation + assignation + mise en état dossier (5h = 125 000 ct HT) — payée
  {
    id: INV1_ID,
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
    templateId: 'default',
    totalHtCents: 125000,
    totalVatCents: 25000,
    totalTtcCents: 150000,
    vatBreakdown: [
      { vatRateBasisPoints: 2000, taxableHtCents: 125000, vatCents: 25000, totalTtcCents: 150000 }
    ],
    status: 'paid',
    paymentStatus: 'paid',
    paidAmountCents: 150000,
    remainingAmountCents: 0,
    paidAt: '2026-03-20',
    payments: [
      {
        id: PAY1_ID,
        paidAt: '2026-03-20',
        amountCents: 150000,
        method: 'transfer',
        reference: 'VRT-20260320',
        createdAt: '2026-03-20T10:00:00.000Z',
        updatedAt: '2026-03-20T10:00:00.000Z'
      }
    ],
    originalInvoiceRefs: [],
    paymentTerms: 'Paiement à 30 jours à compter de la date de facturation.',
    lines: [
      {
        billingItemId: BI1A_ID,
        date: '2026-02-03',
        label: 'Consultation initiale et analyse du dossier',
        description: 'Première consultation, recueil des faits, analyse des pièces contractuelles',
        quantity: 1,
        quantityUnit: 'hours',
        unitPriceHtCents: 25000,
        discountHtCents: 0,
        subtotalHtCents: 25000,
        totalHtCents: 25000,
        vatRateBasisPoints: 2000,
        totalTtcCents: 30000
      },
      {
        billingItemId: BI1B_ID,
        date: '2026-02-20',
        label: "Rédaction de l'assignation",
        description: 'Assignation devant le Tribunal de Commerce de Lyon',
        quantity: 3,
        quantityUnit: 'hours',
        unitPriceHtCents: 25000,
        discountHtCents: 0,
        subtotalHtCents: 75000,
        totalHtCents: 75000,
        vatRateBasisPoints: 2000,
        totalTtcCents: 90000
      },
      {
        billingItemId: BI1C_ID,
        date: '2026-02-25',
        label: 'Signification et mise en état du dossier',
        description: "Coordination avec l'huissier, constitution du dossier de pièces",
        quantity: 1,
        quantityUnit: 'hours',
        unitPriceHtCents: 25000,
        discountHtCents: 0,
        subtotalHtCents: 25000,
        totalHtCents: 25000,
        vatRateBasisPoints: 2000,
        totalTtcCents: 30000
      }
    ],
    createdAt: '2026-02-28T10:00:00.000Z',
    updatedAt: '2026-03-20T10:00:00.000Z'
  },

  // ── FAC-2026-0005 : Dupont — audience + analyse pièces adverses (4h = 100 000 ct HT) — émise
  {
    id: INV2_ID,
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
    templateId: 'default',
    totalHtCents: 100000,
    totalVatCents: 20000,
    totalTtcCents: 120000,
    vatBreakdown: [
      { vatRateBasisPoints: 2000, taxableHtCents: 100000, vatCents: 20000, totalTtcCents: 120000 }
    ],
    status: 'issued',
    paymentStatus: 'unpaid',
    paidAmountCents: 0,
    remainingAmountCents: 120000,
    payments: [],
    originalInvoiceRefs: [],
    paymentTerms: 'Paiement à 30 jours à compter de la date de facturation.',
    lines: [
      {
        billingItemId: BI1D_ID,
        date: '2026-03-12',
        label: 'Audience de mise en état',
        description: 'Présentation au Tribunal de Commerce de Lyon, fixation du calendrier',
        quantity: 2,
        quantityUnit: 'hours',
        unitPriceHtCents: 25000,
        discountHtCents: 0,
        subtotalHtCents: 50000,
        totalHtCents: 50000,
        vatRateBasisPoints: 2000,
        totalTtcCents: 60000
      },
      {
        billingItemId: BI1E_ID,
        date: '2026-03-28',
        label: 'Analyse des pièces adverses',
        description: 'Examen des conclusions et pièces communiquées par Moreau SARL',
        quantity: 2,
        quantityUnit: 'hours',
        unitPriceHtCents: 25000,
        discountHtCents: 0,
        subtotalHtCents: 50000,
        totalHtCents: 50000,
        vatRateBasisPoints: 2000,
        totalTtcCents: 60000
      }
    ],
    createdAt: '2026-04-15T10:00:00.000Z',
    updatedAt: '2026-04-15T10:00:00.000Z'
  },

  // ── FAC-2026-0002 : Renard — requête + consultations + échanges adverses (1 u + 3h = 130 000 ct HT) — payée
  {
    id: INV3_ID,
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
    templateId: 'default',
    totalHtCents: 130000,
    totalVatCents: 26000,
    totalTtcCents: 156000,
    vatBreakdown: [
      { vatRateBasisPoints: 2000, taxableHtCents: 130000, vatCents: 26000, totalTtcCents: 156000 }
    ],
    status: 'paid',
    paymentStatus: 'paid',
    paidAmountCents: 156000,
    remainingAmountCents: 0,
    paidAt: '2026-04-10',
    payments: [
      {
        id: PAY3_ID,
        paidAt: '2026-04-10',
        amountCents: 156000,
        method: 'transfer',
        reference: 'VRT-20260410',
        createdAt: '2026-04-10T10:00:00.000Z',
        updatedAt: '2026-04-10T10:00:00.000Z'
      }
    ],
    originalInvoiceRefs: [],
    paymentTerms: '50 % à la signature de la convention — solde à la clôture de la procédure.',
    lines: [
      {
        billingItemId: BI2A_ID,
        date: '2026-02-15',
        label: 'Rédaction et dépôt de la requête en divorce',
        description: 'Requête initiale, constitution du dossier JAF, bordereau de pièces',
        quantity: 1,
        quantityUnit: 'units',
        unitPriceHtCents: 90000,
        discountHtCents: 0,
        subtotalHtCents: 90000,
        totalHtCents: 90000,
        vatRateBasisPoints: 2000,
        totalTtcCents: 108000
      },
      {
        billingItemId: BI2B_ID,
        date: '2026-03-05',
        label: 'Consultations et préparation des pièces',
        description: 'Deux rendez-vous avec Mme Renard, collecte des pièces justificatives',
        quantity: 2,
        quantityUnit: 'hours',
        unitPriceHtCents: 20000,
        discountHtCents: 0,
        subtotalHtCents: 40000,
        totalHtCents: 40000,
        vatRateBasisPoints: 2000,
        totalTtcCents: 48000
      },
      {
        billingItemId: BI2C_ID,
        date: '2026-03-18',
        label: 'Échanges avec le conseil adverse',
        description: 'Courriers et appels téléphoniques avec Me Launay, conseil de M. Renard',
        quantity: 1,
        quantityUnit: 'hours',
        unitPriceHtCents: 20000,
        discountHtCents: 0,
        subtotalHtCents: 20000,
        totalHtCents: 20000,
        vatRateBasisPoints: 2000,
        totalTtcCents: 24000
      }
    ],
    createdAt: '2026-03-25T10:00:00.000Z',
    updatedAt: '2026-04-10T10:00:00.000Z'
  },

  // ── FAC-2026-0004 : Fontaine — provision honoraires (3,5h = 87 500 ct HT) — payée
  {
    id: INV4_ID,
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
    templateId: 'default',
    totalHtCents: 87500,
    totalVatCents: 17500,
    totalTtcCents: 105000,
    vatBreakdown: [
      { vatRateBasisPoints: 2000, taxableHtCents: 87500, vatCents: 17500, totalTtcCents: 105000 }
    ],
    status: 'paid',
    paymentStatus: 'paid',
    paidAmountCents: 105000,
    remainingAmountCents: 0,
    paidAt: '2026-04-22',
    payments: [
      {
        id: PAY4_ID,
        paidAt: '2026-04-22',
        amountCents: 105000,
        method: 'transfer',
        reference: 'VRT-20260422',
        createdAt: '2026-04-22T10:00:00.000Z',
        updatedAt: '2026-04-22T10:00:00.000Z'
      }
    ],
    originalInvoiceRefs: [],
    paymentTerms:
      "Provision de 500 € HT à la signature — honoraires complémentaires à l'issue de la procédure.",
    notes: 'Facture de provision sur honoraires — dossier préjudice corporel.',
    lines: [
      {
        billingItemId: BI3A_ID,
        date: '2026-03-15',
        label: 'Consultation initiale et analyse du dossier',
        description:
          'Première consultation, recueil des faits, examen du PV de constat et rapport médical initial',
        quantity: 1.5,
        quantityUnit: 'hours',
        unitPriceHtCents: 25000,
        discountHtCents: 0,
        subtotalHtCents: 37500,
        totalHtCents: 37500,
        vatRateBasisPoints: 2000,
        totalTtcCents: 45000
      },
      {
        billingItemId: BI3B_ID,
        date: '2026-04-05',
        label: "Étude du rapport médical et préparation de l'expertise",
        description:
          "Analyse approfondie du rapport médical de consolidation, préparation des questions à l'expert",
        quantity: 2,
        quantityUnit: 'hours',
        unitPriceHtCents: 25000,
        discountHtCents: 0,
        subtotalHtCents: 50000,
        totalHtCents: 50000,
        vatRateBasisPoints: 2000,
        totalTtcCents: 60000
      }
    ],
    createdAt: '2026-04-10T10:00:00.000Z',
    updatedAt: '2026-04-22T10:00:00.000Z'
  },

  // ── RET-2026-0001 : Lemoine (AJ) — rétribution de l'État (pièce distincte), exonérée de TVA, recouvrée CARPA — payée
  {
    id: INV5_ID,
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
    templateId: 'default',
    totalHtCents: D4_STATE_RETRIBUTION_HT,
    totalVatCents: 0,
    totalTtcCents: D4_STATE_RETRIBUTION_HT,
    vatBreakdown: [
      {
        vatRateBasisPoints: 0,
        taxableHtCents: D4_STATE_RETRIBUTION_HT,
        vatCents: 0,
        totalTtcCents: D4_STATE_RETRIBUTION_HT
      }
    ],
    status: 'paid',
    paymentStatus: 'paid',
    paidAmountCents: D4_STATE_RETRIBUTION_HT,
    remainingAmountCents: 0,
    paidAt: '2026-05-02',
    payments: [
      {
        id: PAY5_ID,
        paidAt: '2026-05-02',
        amountCents: D4_STATE_RETRIBUTION_HT,
        method: 'transfer',
        reference: 'CARPA-AJ-20260502',
        createdAt: '2026-05-02T10:00:00.000Z',
        updatedAt: '2026-05-02T10:00:00.000Z'
      }
    ],
    originalInvoiceRefs: [],
    paymentTerms: "Rétribution de l'État recouvrée auprès de la CARPA de Lyon.",
    notes:
      "Rétribution au titre de l'aide juridictionnelle (décision BAJ n° 2026/0457). Exonérée de TVA — art. 261-4-1° du CGI.",
    lines: [
      {
        billingItemId: BI4_STATE_ID,
        date: '2026-04-05',
        label: `Rétribution AJ - État - ${D4_MATTER_LABEL}`,
        description:
          "Rétribution au titre de l'aide juridictionnelle partielle (55 %). Exonérée de TVA.",
        quantity: 1,
        quantityUnit: 'units',
        unitPriceHtCents: D4_STATE_RETRIBUTION_HT,
        discountHtCents: 0,
        subtotalHtCents: D4_STATE_RETRIBUTION_HT,
        totalHtCents: D4_STATE_RETRIBUTION_HT,
        vatRateBasisPoints: 0,
        totalTtcCents: D4_STATE_RETRIBUTION_HT
      }
    ],
    createdAt: '2026-04-08T10:00:00.000Z',
    updatedAt: '2026-05-02T10:00:00.000Z'
  },

  // ── FAC-2026-0003 : Lemoine (AJ) — complément d'honoraires négocié (500 € HT + TVA) — émise
  {
    id: INV6_ID,
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
    templateId: 'default',
    totalHtCents: D4_COMPLEMENT_HT,
    totalVatCents: Math.round(D4_COMPLEMENT_HT * 0.2),
    totalTtcCents: Math.round(D4_COMPLEMENT_HT * 1.2),
    vatBreakdown: [
      {
        vatRateBasisPoints: 2000,
        taxableHtCents: D4_COMPLEMENT_HT,
        vatCents: Math.round(D4_COMPLEMENT_HT * 0.2),
        totalTtcCents: Math.round(D4_COMPLEMENT_HT * 1.2)
      }
    ],
    status: 'issued',
    paymentStatus: 'unpaid',
    paidAmountCents: 0,
    remainingAmountCents: Math.round(D4_COMPLEMENT_HT * 1.2),
    payments: [],
    originalInvoiceRefs: [],
    paymentTerms: 'Paiement à 30 jours à compter de la date de facturation.',
    notes:
      "Complément d'honoraires librement négocié (AJ partielle), conformément à l'article 35 de la loi n° 91-647 du 10 juillet 1991. Plafond légal : 920 € HT.",
    lines: [
      {
        billingItemId: BI4_COMPL_ID,
        date: '2026-04-05',
        label: `Complément d'honoraires - AJ partielle - ${D4_MATTER_LABEL}`,
        description: "Complément d'honoraires librement négocié : 500,00 € HT.",
        quantity: 1,
        quantityUnit: 'units',
        unitPriceHtCents: D4_COMPLEMENT_HT,
        discountHtCents: 0,
        subtotalHtCents: D4_COMPLEMENT_HT,
        totalHtCents: D4_COMPLEMENT_HT,
        vatRateBasisPoints: 2000,
        totalTtcCents: Math.round(D4_COMPLEMENT_HT * 1.2)
      }
    ],
    createdAt: '2026-04-08T10:00:00.000Z',
    updatedAt: '2026-04-08T10:00:00.000Z'
  }
]

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
  {
    filename: 'Conclusions_adverses_Moreau.docx',
    title: 'Conclusions en défense — Moreau SARL',
    bodyHtml: `${letterhead()}
      <h1>Conclusions en défense</h1>
      <p><strong>Pour :</strong> La société Moreau SARL, défenderesse.</p>
      <p>La défenderesse conteste la qualité d'une partie des prestations facturées et sollicite une réduction du montant réclamé à hauteur de 6 000 €.</p>
      <p>Elle produit en ce sens des échanges de courriels faisant état de réserves émises sur les livrables (pièces adverses n° 1 à 12).</p>`
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

console.log('📁 Domaine')
writeJson(join(ROOT, '.ordicab', 'domain.json'), domainData)
writeJson(join(ROOT, '.ordicab', 'registry.json'), registryData)
writeJson(join(ROOT, '.ordicab', 'entity.json'), entityData)
writeJson(join(ROOT, '.ordicab', 'cabinet-billing.json'), cabinetBillingData)

// Factures : un fichier par facture + index
const invoiceIndexEntries = invoices.map((inv) => ({
  id: inv.id,
  number: inv.number,
  dossierId: inv.dossierId,
  status: inv.status,
  paymentStatus: inv.paymentStatus,
  totalTtcCents: inv.totalTtcCents,
  documentType: inv.documentType,
  issuedAt: inv.issuedAt,
  updatedAt: inv.updatedAt
}))
writeJson(join(ROOT, '.ordicab', 'invoice-records-index.json'), {
  invoices: invoiceIndexEntries,
  updatedAt: '2026-04-22T10:00:00.000Z'
})
for (const inv of invoices) {
  writeJson(join(ROOT, '.ordicab', 'invoice-records', `${inv.id}.json`), inv)
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
writeJson(join(ROOT, 'Dupont-c-Moreau-SARL', '.ordicab', 'contacts-index.json'), {
  contacts: contacts1.map((c) => ({
    uuid: c.uuid,
    displayName: c.displayName,
    role: c.role,
    updatedAt: '2026-01-20T10:00:00.000Z'
  })),
  updatedAt: '2026-01-20T10:00:00.000Z'
})

for (const item of billingItems1) {
  writeJson(
    join(ROOT, 'Dupont-c-Moreau-SARL', '.ordicab', 'billing-items', `${item.id}.json`),
    item
  )
}
writeJson(join(ROOT, 'Dupont-c-Moreau-SARL', '.ordicab', 'billing-items-index.json'), {
  items: billingItems1.map((i) => ({
    id: i.id,
    dossierId: i.dossierId,
    label: i.label,
    status: i.status,
    date: i.date,
    totalTtcCents: i.totalTtcCents,
    invoiceId: i.invoiceId,
    updatedAt: i.updatedAt
  })),
  updatedAt: '2026-04-15T16:00:00.000Z'
})

for (const kd of keyDates1) {
  writeJson(join(ROOT, 'Dupont-c-Moreau-SARL', '.ordicab', 'key-dates', `${kd.id}.json`), kd)
}
writeJson(join(ROOT, 'Dupont-c-Moreau-SARL', '.ordicab', 'key-dates-index.json'), {
  keyDates: keyDates1.map((kd) => ({
    id: kd.id,
    dossierId: kd.dossierId,
    label: kd.label,
    date: kd.date,
    isClosed: kd.isClosed,
    updatedAt: kd.date + 'T09:00:00.000Z'
  })),
  updatedAt: '2026-04-15T16:00:00.000Z'
})

for (const doc of documents1) {
  await writeDocx(join(ROOT, 'Dupont-c-Moreau-SARL', doc.filename), doc)
}

// ─── Dossier 2 — Renard - Procédure de divorce ───────────────────────────────

console.log('\n📁 Dossier 2 — Renard - Procédure de divorce')
writeJson(join(ROOT, 'Renard-Divorce', '.ordicab', 'dossier.json'), dossier2)

for (const contact of contacts2) {
  writeJson(join(ROOT, 'Renard-Divorce', '.ordicab', 'contacts', `${contact.uuid}.json`), contact)
}
writeJson(join(ROOT, 'Renard-Divorce', '.ordicab', 'contacts-index.json'), {
  contacts: contacts2.map((c) => ({
    uuid: c.uuid,
    displayName: c.displayName,
    role: c.role,
    updatedAt: '2026-02-01T14:00:00.000Z'
  })),
  updatedAt: '2026-02-01T14:00:00.000Z'
})

for (const item of billingItems2) {
  writeJson(join(ROOT, 'Renard-Divorce', '.ordicab', 'billing-items', `${item.id}.json`), item)
}
writeJson(join(ROOT, 'Renard-Divorce', '.ordicab', 'billing-items-index.json'), {
  items: billingItems2.map((i) => ({
    id: i.id,
    dossierId: i.dossierId,
    label: i.label,
    status: i.status,
    date: i.date,
    totalTtcCents: i.totalTtcCents,
    invoiceId: i.invoiceId,
    updatedAt: i.updatedAt
  })),
  updatedAt: '2026-04-20T11:00:00.000Z'
})

for (const kd of keyDates2) {
  writeJson(join(ROOT, 'Renard-Divorce', '.ordicab', 'key-dates', `${kd.id}.json`), kd)
}
writeJson(join(ROOT, 'Renard-Divorce', '.ordicab', 'key-dates-index.json'), {
  keyDates: keyDates2.map((kd) => ({
    id: kd.id,
    dossierId: kd.dossierId,
    label: kd.label,
    date: kd.date,
    isClosed: kd.isClosed,
    updatedAt: kd.date + 'T09:00:00.000Z'
  })),
  updatedAt: '2026-04-20T11:00:00.000Z'
})

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
writeJson(join(ROOT, 'Fontaine-Accident', '.ordicab', 'contacts-index.json'), {
  contacts: contacts3.map((c) => ({
    uuid: c.uuid,
    displayName: c.displayName,
    role: c.role,
    updatedAt: '2026-03-10T11:00:00.000Z'
  })),
  updatedAt: '2026-03-10T11:00:00.000Z'
})

for (const item of billingItems3) {
  writeJson(join(ROOT, 'Fontaine-Accident', '.ordicab', 'billing-items', `${item.id}.json`), item)
}
writeJson(join(ROOT, 'Fontaine-Accident', '.ordicab', 'billing-items-index.json'), {
  items: billingItems3.map((i) => ({
    id: i.id,
    dossierId: i.dossierId,
    label: i.label,
    status: i.status,
    date: i.date,
    totalTtcCents: i.totalTtcCents,
    invoiceId: i.invoiceId,
    updatedAt: i.updatedAt
  })),
  updatedAt: '2026-04-05T10:00:00.000Z'
})

for (const kd of keyDates3) {
  writeJson(join(ROOT, 'Fontaine-Accident', '.ordicab', 'key-dates', `${kd.id}.json`), kd)
}
writeJson(join(ROOT, 'Fontaine-Accident', '.ordicab', 'key-dates-index.json'), {
  keyDates: keyDates3.map((kd) => ({
    id: kd.id,
    dossierId: kd.dossierId,
    label: kd.label,
    date: kd.date,
    isClosed: kd.isClosed,
    updatedAt: kd.date + 'T09:00:00.000Z'
  })),
  updatedAt: '2026-04-05T10:00:00.000Z'
})

for (const doc of documents3) {
  await writeDocx(join(ROOT, 'Fontaine-Accident', doc.filename), doc)
}

// ─── Dossier 4 — Lemoine c/ Transports Veyrat (aide juridictionnelle) ─────────

console.log('\n📁 Dossier 4 — Lemoine c/ Transports Veyrat (aide juridictionnelle)')
writeJson(join(ROOT, D4_ID, '.ordicab', 'dossier.json'), dossier4)

for (const contact of contacts4) {
  writeJson(join(ROOT, D4_ID, '.ordicab', 'contacts', `${contact.uuid}.json`), contact)
}
writeJson(join(ROOT, D4_ID, '.ordicab', 'contacts-index.json'), {
  contacts: contacts4.map((c) => ({
    uuid: c.uuid,
    displayName: c.displayName,
    role: c.role,
    updatedAt: '2026-04-02T09:30:00.000Z'
  })),
  updatedAt: '2026-04-02T09:30:00.000Z'
})

for (const item of billingItems4) {
  writeJson(join(ROOT, D4_ID, '.ordicab', 'billing-items', `${item.id}.json`), item)
}
writeJson(join(ROOT, D4_ID, '.ordicab', 'billing-items-index.json'), {
  items: billingItems4.map((i) => ({
    id: i.id,
    dossierId: i.dossierId,
    label: i.label,
    status: i.status,
    date: i.date,
    totalTtcCents: i.totalTtcCents,
    invoiceId: i.invoiceId,
    updatedAt: i.updatedAt
  })),
  updatedAt: '2026-04-08T12:00:00.000Z'
})

for (const kd of keyDates4) {
  writeJson(join(ROOT, D4_ID, '.ordicab', 'key-dates', `${kd.id}.json`), kd)
}
writeJson(join(ROOT, D4_ID, '.ordicab', 'key-dates-index.json'), {
  keyDates: keyDates4.map((kd) => ({
    id: kd.id,
    dossierId: kd.dossierId,
    label: kd.label,
    date: kd.date,
    isClosed: kd.isClosed,
    updatedAt: kd.date + 'T09:00:00.000Z'
  })),
  updatedAt: '2026-04-08T12:00:00.000Z'
})

for (const doc of documents4) {
  await writeDocx(join(ROOT, D4_ID, doc.filename), doc)
}

console.log('\n✅ Terminé. Ouvrez Ordicab et sélectionnez ce dossier comme domaine :\n')
console.log(`   ${ROOT}\n`)
