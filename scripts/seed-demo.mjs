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

function touchFile(filePath) {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, '', 'utf8')
  console.log(`  ✓ ${filePath.replace(ROOT, '.')}`)
}

// ─── UUIDs générés au lancement ───────────────────────────────────────────────

// Dossiers
const D1_UUID = randomUUID()
const D2_UUID = randomUUID()
const D3_UUID = randomUUID()

// Contacts
const C1_UUID = randomUUID() // Bernard Dupont
const C2_UUID = randomUUID() // Philippe Moreau
const C3_UUID = randomUUID() // Claire Renard
const C4_UUID = randomUUID() // Julien Renard
const C5_UUID = randomUUID() // Antoine Fontaine
const C6_UUID = randomUUID() // Sécuritas Assurances

// Conventions d'honoraires
const FA1_ID = randomUUID()
const FA2_ID = randomUUID()
const FA3_ID = randomUUID()

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

// Factures
const INV1_ID = randomUUID()
const INV2_ID = randomUUID()
const INV3_ID = randomUUID()
const INV4_ID = randomUUID()

// Paiements
const PAY1_ID = randomUUID()
const PAY3_ID = randomUUID()
const PAY4_ID = randomUUID()

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
    nextSequence: 5,
    currentSequenceYear: 2026,
    creditNoteNumberPattern: 'AV-{YYYY}-{SEQ}',
    creditNoteNextSequence: 1,
    creditNoteCurrentSequenceYear: 2026,
    correctiveInvoiceNumberPattern: 'FCR-{YYYY}-{SEQ}',
    correctiveInvoiceNextSequence: 1,
    correctiveInvoiceCurrentSequenceYear: 2026,
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
    invoiceNumber: 'FAC-2026-0002'
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
    invoiceNumber: 'FAC-2026-0002'
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
    invoiceNumber: 'FAC-2026-0003'
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
    invoiceNumber: 'FAC-2026-0003'
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
    invoiceNumber: 'FAC-2026-0003'
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

  // ── FAC-2026-0002 : Dupont — audience + analyse pièces adverses (4h = 100 000 ct HT) — émise
  {
    id: INV2_ID,
    documentType: 'invoice',
    number: 'FAC-2026-0002',
    sequenceYear: 2026,
    sequenceValue: 2,
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

  // ── FAC-2026-0003 : Renard — requête + consultations + échanges adverses (1 u + 3h = 130 000 ct HT) — payée
  {
    id: INV3_ID,
    documentType: 'invoice',
    number: 'FAC-2026-0003',
    sequenceYear: 2026,
    sequenceValue: 3,
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

touchFile(join(ROOT, 'Dupont-c-Moreau-SARL', 'Contrat_de_prestation_Dupont-Moreau.pdf'))
touchFile(join(ROOT, 'Dupont-c-Moreau-SARL', 'Assignation.pdf'))
touchFile(join(ROOT, 'Dupont-c-Moreau-SARL', 'PV_signification.pdf'))
touchFile(join(ROOT, 'Dupont-c-Moreau-SARL', 'Conclusions_n1_Dupont.pdf'))
touchFile(join(ROOT, 'Dupont-c-Moreau-SARL', 'Conclusions_adverses_Moreau.pdf'))
touchFile(join(ROOT, 'Dupont-c-Moreau-SARL', 'Pieces_communiquees_Moreau.pdf'))

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

touchFile(join(ROOT, 'Renard-Divorce', 'Requete_initiale.pdf'))
touchFile(join(ROOT, 'Renard-Divorce', 'Acte_de_mariage.pdf'))
touchFile(join(ROOT, 'Renard-Divorce', 'Convention_parentale_projet.pdf'))
touchFile(join(ROOT, 'Renard-Divorce', 'Convocation_audience_JAF.pdf'))
touchFile(join(ROOT, 'Renard-Divorce', 'Pieces_financieres_Renard.pdf'))

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

touchFile(join(ROOT, 'Fontaine-Accident', 'PV_constat.pdf'))
touchFile(join(ROOT, 'Fontaine-Accident', 'Rapport_medical_initial.pdf'))
touchFile(join(ROOT, 'Fontaine-Accident', 'Rapport_medical_expertise.pdf'))
touchFile(join(ROOT, 'Fontaine-Accident', 'LRAR_mise_en_demeure.pdf'))
touchFile(join(ROOT, 'Fontaine-Accident', 'Reponse_assureur_Securitas.pdf'))

console.log('\n✅ Terminé. Ouvrez Ordicab et sélectionnez ce dossier comme domaine :\n')
console.log(`   ${ROOT}\n`)
