// Static, bundled service catalog. Intentionally hardcoded in TypeScript so the
// library ships with the app and stays type-checked. Tariff updates therefore
// require a release. If updates become frequent, migrate to a versioned JSON
// resource loaded at runtime.
import type { BillingType, CabinetServiceUsage } from './domain/billing'

export interface ServiceLibraryItem {
  id: string
  name: string
  description?: string
  usage: CabinetServiceUsage
  billingType: BillingType
  flatFeeHtCents?: number
  hourlyRateHtCents?: number
  estimatedHours?: number
  retainerHtCents?: number
  successFeePercentBasisPoints?: number
  vatRateBasisPoints: number
  paymentTerms?: string
  expenseTerms?: string
}

interface ServiceLibraryTheme {
  id: string
  label: string
  items: ServiceLibraryItem[]
}

type ServiceLibraryItemInput = Omit<ServiceLibraryItem, 'usage'> & {
  usage?: CabinetServiceUsage
}

function withLibraryUsage(
  defaultUsage: CabinetServiceUsage,
  items: ServiceLibraryItemInput[]
): ServiceLibraryItem[] {
  return items.map((item) => ({
    usage: defaultUsage,
    ...item
  }))
}

const PAY_30J = 'Paiement à réception de facture, délai 30 jours.'
const PAY_PROVISION =
  'Provision demandée à la constitution du dossier. Solde à réception de facture.'
const PAY_PROVISION_50 = 'Provision 50 % à la constitution. Solde à réception de facture.'
const DEBOURS =
  'Les débours (frais d’huissier, frais de greffe, etc.) sont refacturés au coût réel.'
const VAT = 2000 // 20 %

export const SERVICE_LIBRARY_THEMES: ServiceLibraryTheme[] = [
  {
    id: 'standard',
    label: 'Pack standard',
    items: withLibraryUsage('billing', [
      {
        id: 'standard-rdv-1h',
        name: 'Rendez-vous cabinet / Consultation – 1 h',
        description: 'Consultation au cabinet d’une heure.',
        billingType: 'flat',
        flatFeeHtCents: 20000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'standard-rdv-45',
        name: 'Rendez-vous cabinet / Consultation – 45 min',
        description: 'Consultation au cabinet d’une durée de 45 minutes.',
        billingType: 'flat',
        flatFeeHtCents: 15000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'standard-consultation-ecrite',
        name: 'Consultation écrite',
        description: 'Consultation juridique rendue par écrit.',
        billingType: 'flat',
        flatFeeHtCents: 30000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'standard-courrier-med',
        name: 'Rédaction courrier (MED)',
        description: 'Rédaction d’un courrier, notamment mise en demeure.',
        billingType: 'flat',
        flatFeeHtCents: 30000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'standard-conclusions',
        name: 'Conclusions',
        description: 'Rédaction de conclusions.',
        billingType: 'flat',
        flatFeeHtCents: 50000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'standard-assignation',
        name: 'Assignation',
        description: 'Rédaction et délivrance d’une assignation.',
        billingType: 'flat',
        flatFeeHtCents: 100000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_PROVISION,
        expenseTerms: DEBOURS
      },
      {
        id: 'standard-dire-expert',
        name: 'Dire à expert',
        description: 'Rédaction d’un dire dans le cadre d’une expertise judiciaire.',
        billingType: 'flat',
        flatFeeHtCents: 35000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'standard-reunion-expertise',
        name: 'Assistance à réunion d’expertise',
        description: 'Assistance et représentation lors d’une réunion d’expertise.',
        billingType: 'flat',
        flatFeeHtCents: 40000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'standard-plaidoirie',
        name: 'Plaidoirie',
        description: 'Plaidoirie à l’audience.',
        billingType: 'flat',
        flatFeeHtCents: 50000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision demandée avant l’audience. Solde à réception de facture.'
      },
      {
        id: 'standard-plainte-penale',
        name: 'Plainte pénale',
        description:
          'Rédaction et dépôt d’une plainte pénale (avec ou sans constitution de partie civile).',
        billingType: 'flat',
        flatFeeHtCents: 75000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_PROVISION
      },
      {
        id: 'standard-audience-penale',
        name: 'Audience pénale',
        description: 'Assistance et représentation à une audience pénale.',
        billingType: 'flat',
        flatFeeHtCents: 75000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision demandée avant l’audience. Solde à réception de facture.'
      },
      {
        id: 'standard-requete-civile',
        name: 'Requête civile',
        description: 'Rédaction et dépôt d’une requête en matière civile.',
        billingType: 'flat',
        flatFeeHtCents: 100000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_PROVISION,
        expenseTerms: DEBOURS
      },
      {
        id: 'standard-requete-jaf',
        name: 'Requête affaires familiales',
        description: 'Rédaction et dépôt d’une requête devant le juge aux affaires familiales.',
        billingType: 'flat',
        flatFeeHtCents: 100000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_PROVISION,
        expenseTerms: DEBOURS
      },
      {
        id: 'standard-requete-gracieuse',
        name: 'Requête gracieuse',
        description: 'Rédaction et dépôt d’une requête gracieuse.',
        billingType: 'flat',
        flatFeeHtCents: 100000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_PROVISION,
        expenseTerms: DEBOURS
      },
      {
        id: 'standard-suivi-mise-en-etat',
        name: 'Suivi de mise en état',
        description:
          'Suivi de la mise en état : constitution, communications avec juge, greffe et avocats adverses.',
        billingType: 'flat',
        flatFeeHtCents: 25000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      }
    ])
  },
  {
    id: 'general',
    label: 'Prestations transversales',
    items: withLibraryUsage('billing', [
      {
        id: 'general-hourly',
        name: 'Consultation horaire',
        description: 'Consultation juridique facturée à l’heure, tous domaines.',
        billingType: 'hourly',
        hourlyRateHtCents: 25000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'general-consult-30',
        name: 'Consultation forfait 30 min',
        description: 'Première consultation rapide d’une demi-heure en cabinet.',
        billingType: 'flat',
        flatFeeHtCents: 15000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'general-consult-1h',
        name: 'Consultation forfait 1 h',
        description: 'Consultation approfondie d’une heure sur une problématique juridique.',
        billingType: 'flat',
        flatFeeHtCents: 25000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'general-legal-opinion',
        name: 'Avis juridique écrit',
        description: 'Note juridique écrite répondant à une question de droit spécifique.',
        billingType: 'flat',
        flatFeeHtCents: 80000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'general-letter',
        name: 'Rédaction de courrier juridique',
        description: 'Mise en demeure, courrier d’information ou lettre à portée juridique.',
        billingType: 'flat',
        flatFeeHtCents: 45000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'general-representation',
        name: 'Représentation en audience',
        description:
          'Plaidoirie et représentation lors d’une audience judiciaire (hors spécialités).',
        billingType: 'hourly',
        hourlyRateHtCents: 30000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision demandée avant l’audience. Solde à réception de facture.'
      },
      {
        id: 'general-appeal',
        usage: 'feeAgreement',
        name: 'Procédure d’appel (général)',
        description:
          'Rédaction des conclusions et plaidoirie en appel, hors matières spécialisées.',
        billingType: 'flat',
        flatFeeHtCents: 400000,
        retainerHtCents: 150000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Solde à réception de la décision.'
      },
      {
        id: 'general-negociation',
        usage: 'feeAgreement',
        name: 'Négociation et transaction amiable',
        description: 'Assistance à la négociation et rédaction d’un protocole transactionnel.',
        billingType: 'flat',
        flatFeeHtCents: 200000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      }
    ])
  },
  {
    id: 'civil',
    label: 'Droit civil, contrats et consommation',
    items: withLibraryUsage('feeAgreement', [
      {
        id: 'civil-contrat-litige',
        name: 'Litige contractuel civil ou commercial courant',
        description:
          "Analyse du contrat, mise en demeure, négociation et action en justice en cas d'inexécution, résiliation ou responsabilité contractuelle.",
        billingType: 'flat',
        flatFeeHtCents: 180000,
        retainerHtCents: 80000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_PROVISION
      },
      {
        id: 'civil-redaction-contrat',
        usage: 'both',
        name: 'Rédaction ou revue de contrat civil',
        description:
          'Rédaction, sécurisation ou relecture de contrat de prestation, devis, bon de commande, prêt ou reconnaissance de dette.',
        billingType: 'flat',
        flatFeeHtCents: 90000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'civil-vices-caches',
        name: 'Vices cachés / défaut de conformité',
        description:
          "Assistance de l'acheteur ou du vendeur dans un litige après vente (véhicule, bien mobilier, matériel, prestation).",
        billingType: 'mixed',
        flatFeeHtCents: 180000,
        successFeePercentBasisPoints: 1000,
        vatRateBasisPoints: VAT,
        paymentTerms:
          "Provision à la constitution. Honoraires de résultat à l'issue de la procédure."
      },
      {
        id: 'civil-consommation',
        name: 'Litige de consommation',
        description:
          'Clauses abusives, exécution défectueuse, vente à distance, démarchage, abonnements et contentieux avec un professionnel.',
        billingType: 'flat',
        flatFeeHtCents: 120000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'civil-responsabilite',
        name: 'Responsabilité civile et réparation du préjudice',
        description:
          'Action en indemnisation ou défense en matière de responsabilité délictuelle, trouble anormal, faute ou dommage matériel.',
        billingType: 'mixed',
        flatFeeHtCents: 180000,
        successFeePercentBasisPoints: 1000,
        vatRateBasisPoints: VAT,
        paymentTerms:
          "Provision à la constitution. Honoraires de résultat à l'issue de la procédure."
      },
      {
        id: 'civil-refere',
        name: 'Référé civil / mesures urgentes',
        description:
          "Procédure d'urgence devant le tribunal judiciaire pour obtenir une mesure conservatoire, une injonction ou une provision.",
        billingType: 'flat',
        flatFeeHtCents: 150000,
        retainerHtCents: 80000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Solde à réception de l’ordonnance.'
      },
      {
        id: 'civil-expertise',
        name: 'Référé expertise / expertise judiciaire',
        description:
          "Saisine en référé pour désignation d'un expert puis assistance pendant les opérations d'expertise.",
        billingType: 'flat',
        flatFeeHtCents: 180000,
        retainerHtCents: 80000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_PROVISION,
        expenseTerms: DEBOURS
      },
      {
        id: 'civil-jex',
        name: "Juge de l'exécution / contestation de saisie",
        description:
          "Assistance devant le JEX pour contester une saisie, demander des délais de paiement ou faire trancher un incident d'exécution.",
        billingType: 'flat',
        flatFeeHtCents: 160000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_PROVISION
      }
    ])
  },
  {
    id: 'procedure-civile',
    label: 'Procédure civile et exécution',
    items: withLibraryUsage('feeAgreement', [
      {
        id: 'proc-assignation-defense',
        name: 'Assignation / défense au fond',
        description:
          'Rédaction d’une assignation ou constitution en défense devant le tribunal judiciaire pour un litige civil de droit commun.',
        billingType: 'flat',
        flatFeeHtCents: 220000,
        retainerHtCents: 100000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_PROVISION
      },
      {
        id: 'proc-injonction-faire',
        name: 'Injonction de faire',
        description:
          "Procédure visant à contraindre un cocontractant à exécuter son obligation lorsqu'une exécution en nature demeure possible.",
        billingType: 'flat',
        flatFeeHtCents: 90000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J,
        expenseTerms: DEBOURS
      },
      {
        id: 'proc-refere-provision',
        name: 'Référé provision',
        description:
          "Procédure d'urgence pour obtenir une provision lorsque l'obligation n'est pas sérieusement contestable.",
        billingType: 'flat',
        flatFeeHtCents: 140000,
        retainerHtCents: 70000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Solde à réception de l’ordonnance.'
      },
      {
        id: 'proc-opposition-ordonnance',
        name: 'Opposition / rétractation de décision non contradictoire',
        description:
          'Recours contre ordonnance sur requête, injonction ou décision rendue sans débat contradictoire.',
        billingType: 'flat',
        flatFeeHtCents: 120000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_PROVISION
      },
      {
        id: 'proc-incidents',
        name: 'Incident de procédure / fin de non-recevoir',
        description:
          'Exception de procédure, irrecevabilité, caducité, nullité, radiation ou incident de mise en état.',
        billingType: 'hourly',
        hourlyRateHtCents: 26000,
        retainerHtCents: 80000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Facturation des diligences sur présentation.'
      },
      {
        id: 'proc-execution-provisoire',
        name: 'Exécution provisoire / arrêt de l’exécution',
        description:
          "Demande d'arrêt, d'aménagement ou de contestation de l'exécution provisoire d'une décision.",
        billingType: 'flat',
        flatFeeHtCents: 140000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_PROVISION
      },
      {
        id: 'proc-delais-paiement',
        name: 'Délais de paiement judiciaires',
        description:
          'Demande ou contestation de délais de paiement devant le juge compétent, y compris dans le cadre de l’exécution.',
        billingType: 'flat',
        flatFeeHtCents: 80000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      }
    ])
  },
  {
    id: 'famille',
    label: 'Famille, personnes et successions',
    items: withLibraryUsage('feeAgreement', [
      {
        id: 'famille-divorce-cmu',
        name: 'Divorce par consentement mutuel',
        description: 'Procédure amiable (acte sous signature privée contresigné par avocats).',
        billingType: 'flat',
        flatFeeHtCents: 250000,
        vatRateBasisPoints: VAT,
        paymentTerms:
          'Paiement en deux fois : 50 % à la signature de la convention, 50 % au dépôt.',
        expenseTerms: 'Frais notariaux (si intervention notaire) exclus.'
      },
      {
        id: 'famille-divorce-contentieux',
        name: 'Divorce contentieux',
        description:
          'Procédure judiciaire de divorce (pour faute, altération définitive du lien conjugal).',
        billingType: 'mixed',
        hourlyRateHtCents: 28000,
        estimatedHours: 15,
        retainerHtCents: 200000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Facturation mensuelle des diligences.'
      },
      {
        id: 'famille-autorite-parentale',
        name: 'Autorité parentale et garde d’enfants',
        description:
          'Saisine du JAF pour les modalités de garde et d’exercice de l’autorité parentale.',
        billingType: 'flat',
        flatFeeHtCents: 200000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_PROVISION_50
      },
      {
        id: 'famille-pension-alimentaire',
        name: 'Pension alimentaire',
        description: 'Fixation, révision ou recouvrement d’une pension alimentaire devant le JAF.',
        billingType: 'flat',
        flatFeeHtCents: 180000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'famille-separation-concubinage',
        name: 'Séparation hors mariage / concubinage',
        description:
          'Organisation de la séparation, partage amiable des biens, résidence des enfants et convention de séparation.',
        billingType: 'flat',
        flatFeeHtCents: 160000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_PROVISION_50
      },
      {
        id: 'famille-filiation',
        name: 'Filiation, reconnaissance ou contestation',
        description:
          "Action relative à l'établissement ou à la contestation d'un lien de filiation, reconnaissance de paternité ou maternité.",
        billingType: 'flat',
        flatFeeHtCents: 220000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_PROVISION
      },
      {
        id: 'famille-ordonnance-protection',
        name: 'Ordonnance de protection / violences intrafamiliales',
        description:
          "Procédure d'urgence devant le JAF pour solliciter des mesures de protection en cas de violences conjugales ou intrafamiliales.",
        billingType: 'flat',
        flatFeeHtCents: 180000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Paiement immédiat ou à réception de facture (procédure urgente).'
      },
      {
        id: 'famille-adoption',
        name: 'Adoption',
        description:
          'Procédure d’adoption simple ou plénière (constitution du dossier et audience).',
        billingType: 'flat',
        flatFeeHtCents: 350000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision 50 % à la constitution. Solde à réception du jugement.'
      },
      {
        id: 'famille-succession-amiable',
        name: 'Succession et partage amiable',
        description: 'Conseil et assistance pour le règlement amiable d’une succession.',
        billingType: 'flat',
        flatFeeHtCents: 250000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J,
        expenseTerms: 'Frais notariaux exclus.'
      },
      {
        id: 'famille-succession-contentieuse',
        name: 'Succession contentieuse',
        description:
          'Représentation et plaidoirie dans un litige successoral (partage judiciaire, recel, etc.).',
        billingType: 'hourly',
        hourlyRateHtCents: 32000,
        retainerHtCents: 200000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Facturation mensuelle des diligences.'
      },
      {
        id: 'famille-regime-matrimonial',
        name: 'Liquidation de régime matrimonial',
        description: 'Assistance pour la liquidation et le partage du régime matrimonial.',
        billingType: 'flat',
        flatFeeHtCents: 300000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J,
        expenseTerms: 'Frais notariaux exclus.'
      },
      {
        id: 'famille-protection-majeur',
        name: 'Protection du majeur vulnérable',
        description:
          'Ouverture ou gestion d’une mesure de tutelle, curatelle ou sauvegarde de justice.',
        billingType: 'flat',
        flatFeeHtCents: 150000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'famille-pacs',
        name: 'PACS – rédaction et conseil',
        description: 'Assistance à la rédaction et à l’enregistrement d’un PACS.',
        billingType: 'flat',
        flatFeeHtCents: 80000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      }
    ])
  },
  {
    id: 'travail',
    label: 'Droit du travail',
    items: withLibraryUsage('feeAgreement', [
      {
        id: 'travail-licenciement-conseil',
        name: 'Licenciement – conseil et négociation',
        description:
          'Accompagnement du salarié face à une procédure de licenciement, phase amiable.',
        billingType: 'flat',
        flatFeeHtCents: 200000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'travail-licenciement-prud',
        name: 'Licenciement – contentieux prud’homal',
        description: 'Représentation du salarié devant le Conseil de prud’hommes.',
        billingType: 'mixed',
        flatFeeHtCents: 250000,
        retainerHtCents: 100000,
        successFeePercentBasisPoints: 1000,
        vatRateBasisPoints: VAT,
        paymentTerms:
          'Provision à la constitution. Honoraires de résultat à l’issue de la procédure.'
      },
      {
        id: 'travail-licenciement-employeur',
        name: 'Licenciement – défense employeur',
        description:
          'Assistance à l’employeur lors de la procédure de licenciement et du contentieux.',
        billingType: 'flat',
        flatFeeHtCents: 300000,
        retainerHtCents: 100000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_PROVISION
      },
      {
        id: 'travail-rupture-conventionnelle',
        name: 'Rupture conventionnelle',
        description:
          'Négociation et sécurisation juridique d’une rupture conventionnelle homologuée.',
        billingType: 'flat',
        flatFeeHtCents: 150000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'travail-salaires-heures',
        name: 'Salaires impayés / heures supplémentaires',
        description:
          'Réclamation de rappels de salaire, primes, commissions, heures supplémentaires ou indemnités impayées.',
        billingType: 'flat',
        flatFeeHtCents: 160000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_PROVISION
      },
      {
        id: 'travail-resiliation-judiciaire',
        name: "Résiliation judiciaire / prise d'acte",
        description:
          "Accompagnement du salarié lorsque la poursuite du contrat est impossible en raison des manquements de l'employeur.",
        billingType: 'mixed',
        flatFeeHtCents: 220000,
        successFeePercentBasisPoints: 1000,
        vatRateBasisPoints: VAT,
        paymentTerms:
          "Provision à la constitution. Honoraires de résultat à l'issue de la procédure."
      },
      {
        id: 'travail-transaction-sortie',
        name: 'Transaction de départ / protocole',
        description:
          "Négociation et rédaction d'un accord transactionnel à l'occasion d'une rupture ou d'un différend social.",
        billingType: 'flat',
        flatFeeHtCents: 120000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'travail-harcelement',
        name: 'Harcèlement moral ou sexuel',
        description:
          'Défense d’une victime de harcèlement au travail (procédure prud’homale et/ou pénale).',
        billingType: 'flat',
        flatFeeHtCents: 300000,
        retainerHtCents: 100000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Solde à réception de facture.'
      },
      {
        id: 'travail-discrimination',
        name: 'Discrimination au travail',
        description:
          'Procédure pour discrimination à l’embauche, dans l’emploi ou lors de la rupture.',
        billingType: 'mixed',
        flatFeeHtCents: 300000,
        successFeePercentBasisPoints: 1000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Honoraires de résultat à l’issue.'
      },
      {
        id: 'travail-accident',
        name: 'Accident du travail / maladie professionnelle',
        description: 'Défense des droits de la victime, reconnaissance et indemnisation.',
        billingType: 'mixed',
        flatFeeHtCents: 250000,
        successFeePercentBasisPoints: 1000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Honoraires de résultat à l’issue.'
      },
      {
        id: 'travail-contrat',
        usage: 'both',
        name: 'Rédaction / révision de contrat de travail',
        description:
          'Rédaction ou audit d’un contrat de travail (CDI, CDD, conventions particulières).',
        billingType: 'flat',
        flatFeeHtCents: 80000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'travail-non-concurrence',
        usage: 'both',
        name: 'Clause de non-concurrence',
        description:
          'Conseil et contentieux relatif à l’exécution ou à la violation d’une clause de non-concurrence.',
        billingType: 'flat',
        flatFeeHtCents: 100000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'travail-pse',
        name: 'Plan de sauvegarde de l’emploi (PSE)',
        description: 'Accompagnement lors d’un licenciement collectif soumis à plan de sauvegarde.',
        billingType: 'hourly',
        hourlyRateHtCents: 32000,
        retainerHtCents: 200000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Facturation mensuelle des diligences.'
      },
      {
        id: 'travail-droit-syndical',
        name: 'Droit syndical et représentation du personnel',
        description: 'Conseil aux IRP (CSE), élections professionnelles, contentieux syndical.',
        billingType: 'hourly',
        hourlyRateHtCents: 28000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      }
    ])
  },
  {
    id: 'immobilier',
    label: 'Immobilier, baux et voisinage',
    items: withLibraryUsage('feeAgreement', [
      {
        id: 'immo-vente-conseil',
        usage: 'both',
        name: 'Vente immobilière – conseil et relecture',
        description:
          'Analyse de la promesse et de l’acte de vente, conseil lors de la transaction.',
        billingType: 'flat',
        flatFeeHtCents: 150000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J,
        expenseTerms: 'Frais notariaux exclus.'
      },
      {
        id: 'immo-bail-habitation',
        usage: 'both',
        name: 'Bail d’habitation – rédaction',
        description: 'Rédaction d’un contrat de bail d’habitation conforme à la loi de 1989.',
        billingType: 'flat',
        flatFeeHtCents: 60000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'immo-bail-commercial',
        usage: 'both',
        name: 'Bail commercial – rédaction',
        description: 'Rédaction d’un bail commercial (statut des baux commerciaux – décret 1953).',
        billingType: 'flat',
        flatFeeHtCents: 250000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'immo-bail-professionnel',
        usage: 'both',
        name: 'Bail professionnel – rédaction',
        description: 'Rédaction d’un bail professionnel pour professions libérales.',
        billingType: 'flat',
        flatFeeHtCents: 150000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'immo-contentieux-locatif',
        name: 'Contentieux locatif',
        description:
          'Procédure d’impayés de loyer, expulsion ou litige entre bailleur et locataire.',
        billingType: 'flat',
        flatFeeHtCents: 200000,
        retainerHtCents: 80000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Solde à réception de facture.',
        expenseTerms: DEBOURS
      },
      {
        id: 'immo-conge-expulsion',
        name: 'Congé, expulsion et reprise du logement',
        description:
          "Délivrance ou contestation d'un congé, procédure d'expulsion et gestion des litiges liés à l'occupation du logement.",
        billingType: 'flat',
        flatFeeHtCents: 220000,
        retainerHtCents: 80000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_PROVISION,
        expenseTerms: DEBOURS
      },
      {
        id: 'immo-bail-revision',
        usage: 'both',
        name: 'Révision ou renouvellement de bail commercial',
        description:
          'Assistance lors du renouvellement d’un bail commercial ou de la révision du loyer.',
        billingType: 'flat',
        flatFeeHtCents: 200000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'immo-vefa',
        name: 'VEFA – vente en l’état futur d’achèvement',
        description:
          'Conseil et litige relatif à une acquisition sur plan (livraison, garanties, pénalités).',
        billingType: 'flat',
        flatFeeHtCents: 300000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_PROVISION_50
      },
      {
        id: 'immo-copropriete',
        name: 'Copropriété – contentieux',
        description:
          'Représentation d’un copropriétaire ou du syndicat dans un litige de copropriété.',
        billingType: 'flat',
        flatFeeHtCents: 250000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_PROVISION
      },
      {
        id: 'immo-servitude',
        name: 'Servitude et troubles de voisinage',
        description:
          'Conseil et procédure relatifs à des servitudes ou troubles anormaux du voisinage.',
        billingType: 'flat',
        flatFeeHtCents: 200000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'immo-permis-construire',
        name: 'Permis de construire – recours',
        description: 'Recours contre un permis de construire ou défense d’un permis attaqué.',
        billingType: 'flat',
        flatFeeHtCents: 300000,
        retainerHtCents: 100000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Solde à réception de la décision.'
      },
      {
        id: 'immo-sci',
        usage: 'both',
        name: 'Société civile immobilière (SCI)',
        description:
          'Constitution d’une SCI, rédaction des statuts et formalités d’immatriculation.',
        billingType: 'flat',
        flatFeeHtCents: 200000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J,
        expenseTerms: 'Frais de greffe et de publication légale refacturés au coût réel.'
      }
    ])
  },
  {
    id: 'societes',
    label: 'Commercial et sociétés',
    items: withLibraryUsage('feeAgreement', [
      {
        id: 'soc-contrat-prestation',
        usage: 'both',
        name: 'Contrat commercial / prestation B2B',
        description:
          'Rédaction ou revue de contrat de prestation, sous-traitance, partenariat, distribution ou apporteur d’affaires.',
        billingType: 'flat',
        flatFeeHtCents: 150000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'soc-cgv-b2b',
        usage: 'billing',
        name: 'CGV / CGA / documentation contractuelle B2B',
        description:
          'Rédaction ou mise à jour des conditions générales, bons de commande, devis et clauses contractuelles de base pour l’activité.',
        billingType: 'flat',
        flatFeeHtCents: 120000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'soc-constitution',
        name: 'Constitution de société',
        description:
          'Rédaction des statuts et accompagnement à la création (SAS, SARL, SA, SNC, etc.).',
        billingType: 'flat',
        flatFeeHtCents: 200000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J,
        expenseTerms:
          'Frais de greffe, de publication légale et d’immatriculation refacturés au coût réel.'
      },
      {
        id: 'soc-cession-parts',
        name: 'Cession de parts sociales ou d’actions',
        description:
          'Rédaction du protocole de cession, garantie d’actif/passif et formalités post-cession.',
        billingType: 'flat',
        flatFeeHtCents: 300000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'soc-pacte-associes',
        name: 'Pacte d’associés',
        description: 'Négociation et rédaction d’un pacte d’associés ou d’actionnaires.',
        billingType: 'flat',
        flatFeeHtCents: 400000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'soc-conflit-associes',
        name: 'Conflit entre associés / gouvernance',
        description:
          'Gestion des blocages, exclusion, révocation de dirigeant, nullité des décisions sociales et négociation de sortie.',
        billingType: 'hourly',
        hourlyRateHtCents: 32000,
        retainerHtCents: 200000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Facturation mensuelle des diligences.'
      },
      {
        id: 'soc-augmentation-capital',
        name: 'Augmentation de capital',
        description:
          'Assistance juridique lors d’une augmentation de capital (apports numéraires ou en nature).',
        billingType: 'flat',
        flatFeeHtCents: 250000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J,
        expenseTerms: 'Frais de greffe et de publication refacturés au coût réel.'
      },
      {
        id: 'soc-age',
        usage: 'billing',
        name: 'Assemblée générale extraordinaire',
        description:
          'Rédaction des convocations, résolutions et PV lors d’une AGE (modifications statutaires).',
        billingType: 'flat',
        flatFeeHtCents: 300000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'soc-dissolution',
        name: 'Dissolution et liquidation amiable',
        description:
          'Assistance lors de la dissolution volontaire et de la liquidation de la société.',
        billingType: 'flat',
        flatFeeHtCents: 400000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_PROVISION_50,
        expenseTerms: 'Frais de greffe et de publication refacturés au coût réel.'
      },
      {
        id: 'soc-ma',
        name: 'Fusion-acquisition (due diligence juridique)',
        description: 'Audit juridique, structuration et conseil en fusions-acquisitions.',
        billingType: 'hourly',
        hourlyRateHtCents: 35000,
        retainerHtCents: 500000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Facturation mensuelle des diligences.'
      },
      {
        id: 'soc-bspce',
        usage: 'billing',
        name: 'BSA / BSPCE – management package',
        description:
          'Rédaction et émission de bons de souscription (BSPCE, BSA Air) pour associés et salariés.',
        billingType: 'flat',
        flatFeeHtCents: 400000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'soc-levee-fonds',
        name: 'Levée de fonds (Seed / Série A)',
        description:
          'Conseil et rédaction des documents relatifs à une opération de levée de fonds (term sheet, SHA, BSA).',
        billingType: 'flat',
        flatFeeHtCents: 500000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision 50 % à la constitution. Solde au closing.'
      },
      {
        id: 'soc-redressement',
        name: 'Procédure de sauvegarde / redressement',
        description:
          'Assistance du dirigeant dans l’ouverture et le suivi d’une procédure de sauvegarde ou de redressement judiciaire.',
        billingType: 'hourly',
        hourlyRateHtCents: 30000,
        retainerHtCents: 300000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Facturation mensuelle des diligences.'
      }
    ])
  },
  {
    id: 'fonds-commerce',
    label: 'Fonds de commerce, artisans et commerçants',
    items: withLibraryUsage('feeAgreement', [
      {
        id: 'fonds-cession',
        name: 'Cession de fonds de commerce',
        description:
          'Audit, rédaction du protocole, séquestre conventionnel, formalités et accompagnement du vendeur ou de l’acquéreur.',
        billingType: 'flat',
        flatFeeHtCents: 350000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision 50 % à la constitution. Solde au closing.',
        expenseTerms:
          'Frais de publicité légale, enregistrement et formalités refacturés au coût réel.'
      },
      {
        id: 'fonds-location-gerance',
        usage: 'both',
        name: 'Location-gérance',
        description:
          'Mise en place, négociation ou résiliation d’un contrat de location-gérance de fonds artisanal ou commercial.',
        billingType: 'flat',
        flatFeeHtCents: 180000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'fonds-gerance-mandat',
        usage: 'both',
        name: 'Gérance-mandat / exploitation déléguée',
        description:
          'Rédaction ou revue de contrat de gérance-mandat, mandat de gestion ou convention d’exploitation.',
        billingType: 'flat',
        flatFeeHtCents: 160000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'fonds-nantissement',
        usage: 'both',
        name: 'Nantissement de fonds de commerce',
        description:
          'Constitution, inscription, mainlevée ou contestation d’un nantissement de fonds de commerce.',
        billingType: 'flat',
        flatFeeHtCents: 140000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J,
        expenseTerms: DEBOURS
      },
      {
        id: 'fonds-clientele',
        name: 'Cession de clientèle civile ou libérale',
        description:
          'Structuration et rédaction de la cession ou présentation de clientèle pour activité libérale ou indépendante.',
        billingType: 'flat',
        flatFeeHtCents: 180000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'fonds-litige-exploitation',
        name: 'Litige d’exploitation commerciale',
        description:
          'Litige entre commerçants ou exploitants portant sur reprise, garantie, passif, concurrence locale ou exécution des conventions d’exploitation.',
        billingType: 'mixed',
        flatFeeHtCents: 220000,
        retainerHtCents: 100000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_PROVISION
      }
    ])
  },
  {
    id: 'associations',
    label: 'Associations et professions libérales',
    items: withLibraryUsage('feeAgreement', [
      {
        id: 'asso-creation',
        usage: 'both',
        name: 'Création d’association',
        description:
          'Rédaction des statuts, organisation de l’assemblée constitutive et formalités de déclaration.',
        billingType: 'flat',
        flatFeeHtCents: 120000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J,
        expenseTerms: 'Frais de déclaration et de publication refacturés au coût réel.'
      },
      {
        id: 'asso-mise-a-jour-statuts',
        usage: 'both',
        name: 'Mise à jour des statuts / gouvernance',
        description:
          'Modification statutaire, règlement intérieur, délégations de pouvoirs, bureau et conseil d’administration.',
        billingType: 'flat',
        flatFeeHtCents: 100000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'asso-ag-contentieux',
        name: 'Assemblée générale litigieuse',
        description:
          'Contestations relatives à la convocation, au vote, à la régularité des décisions ou à la qualité des dirigeants.',
        billingType: 'flat',
        flatFeeHtCents: 160000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_PROVISION
      },
      {
        id: 'asso-dirigeant-responsabilite',
        name: 'Responsabilité du dirigeant associatif',
        description:
          'Conseil ou défense d’un président, trésorier, membre du bureau ou mandataire social assimilé dans le cadre de ses fonctions.',
        billingType: 'hourly',
        hourlyRateHtCents: 26000,
        retainerHtCents: 80000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Facturation des diligences sur présentation.'
      },
      {
        id: 'liberal-structure',
        usage: 'both',
        name: 'Exercice libéral – structuration',
        description:
          'Choix et mise en place d’une structure d’exercice, convention entre associés, rétrocession ou collaboration libérale.',
        billingType: 'flat',
        flatFeeHtCents: 180000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'liberal-sortie-associe',
        name: 'Retrait / exclusion d’associé libéral',
        description:
          'Négociation ou contentieux lié à la sortie d’un associé, à la cession de droits ou à la valorisation de la patientèle ou clientèle.',
        billingType: 'hourly',
        hourlyRateHtCents: 30000,
        retainerHtCents: 150000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Facturation mensuelle des diligences.'
      }
    ])
  },
  {
    id: 'fiscal',
    label: 'Fiscal et patrimonial',
    items: withLibraryUsage('feeAgreement', [
      {
        id: 'fisc-controle',
        name: 'Contrôle fiscal / réponse à proposition de rectification',
        description:
          'Analyse du contrôle, rédaction des observations du contribuable et échanges avec l’administration fiscale.',
        billingType: 'hourly',
        hourlyRateHtCents: 32000,
        retainerHtCents: 150000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Facturation mensuelle des diligences.'
      },
      {
        id: 'fisc-contentieux',
        name: 'Réclamation contentieuse fiscale',
        description:
          'Contestations d’impôt sur le revenu, IS, TVA, plus-values, droits d’enregistrement ou impositions locales.',
        billingType: 'flat',
        flatFeeHtCents: 220000,
        retainerHtCents: 100000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_PROVISION
      },
      {
        id: 'fisc-patrimoine-audit',
        usage: 'both',
        name: 'Audit patrimonial juridique et fiscal',
        description:
          'Analyse de la détention des actifs, de la situation familiale et des objectifs de transmission pour proposer une structuration adaptée.',
        billingType: 'flat',
        flatFeeHtCents: 250000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'fisc-donation-transmission',
        usage: 'both',
        name: 'Donation / transmission anticipée',
        description:
          'Préparation juridique de la transmission familiale avec coordination notariale et anticipation des incidences civiles et fiscales.',
        billingType: 'flat',
        flatFeeHtCents: 220000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_PROVISION_50,
        expenseTerms: 'Frais notariaux et droits d’enregistrement exclus.'
      },
      {
        id: 'fisc-ifi-plus-values',
        usage: 'both',
        name: 'IFI / plus-values / fiscalité immobilière',
        description:
          'Conseil ciblé sur la détention immobilière, la cession, le remploi et les principaux impacts fiscaux patrimoniaux.',
        billingType: 'flat',
        flatFeeHtCents: 150000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'fisc-regularisation',
        name: 'Régularisation et mise en conformité',
        description:
          'Assistance à la régularisation d’une situation déclarative incomplète ou irrégulière avant ou pendant un échange avec l’administration.',
        billingType: 'hourly',
        hourlyRateHtCents: 30000,
        retainerHtCents: 120000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Facturation des diligences sur présentation.'
      }
    ])
  },
  {
    id: 'penal',
    label: 'Droit pénal',
    items: withLibraryUsage('feeAgreement', [
      {
        id: 'penal-garde-a-vue',
        name: 'Assistance en garde à vue',
        description:
          'Intervention immédiate lors du placement en garde à vue (entretien, assistance aux auditions).',
        billingType: 'flat',
        flatFeeHtCents: 120000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Paiement immédiat ou à réception de facture.'
      },
      {
        id: 'penal-correctionnel',
        name: 'Défense en tribunal correctionnel',
        description: 'Représentation et plaidoirie devant le tribunal correctionnel (délits).',
        billingType: 'flat',
        flatFeeHtCents: 350000,
        retainerHtCents: 150000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution du dossier. Solde avant l’audience.'
      },
      {
        id: 'penal-assises',
        name: 'Défense en cour d’assises',
        description: 'Représentation devant la cour d’assises (crimes – procédure longue).',
        billingType: 'flat',
        flatFeeHtCents: 800000,
        retainerHtCents: 300000,
        vatRateBasisPoints: VAT,
        paymentTerms:
          'Provision à la constitution. Appels à provision selon le calendrier d’audience.'
      },
      {
        id: 'penal-plainte-partie-civile',
        name: 'Plainte avec constitution de partie civile',
        description:
          'Dépôt de plainte et suivi de la procédure d’instruction en tant que partie civile.',
        billingType: 'flat',
        flatFeeHtCents: 250000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Solde à clôture de l’instruction.'
      },
      {
        id: 'penal-appel',
        name: 'Appel pénal',
        description: 'Procédure d’appel d’une décision pénale devant la cour d’appel.',
        billingType: 'flat',
        flatFeeHtCents: 350000,
        retainerHtCents: 150000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Solde à réception de la décision.'
      },
      {
        id: 'penal-comparution-immediate',
        name: 'Comparution immédiate',
        description:
          'Défense lors d’une comparution immédiate (flagrant délit, procédure accélérée).',
        billingType: 'flat',
        flatFeeHtCents: 200000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Paiement immédiat ou à réception de facture.'
      },
      {
        id: 'penal-crpc',
        name: 'CRPC / composition pénale',
        description:
          'Assistance lors d’une comparution sur reconnaissance préalable de culpabilité ou d’une composition pénale.',
        billingType: 'flat',
        flatFeeHtCents: 180000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Paiement immédiat ou à réception de facture.'
      },
      {
        id: 'penal-droit-routier',
        name: 'Droit routier / suspension ou annulation du permis',
        description:
          'Défense pénale et administrative à la suite d’une alcoolémie, stupéfiants, excès de vitesse, suspension ou annulation du permis.',
        billingType: 'flat',
        flatFeeHtCents: 180000,
        retainerHtCents: 80000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_PROVISION
      },
      {
        id: 'penal-victime',
        name: 'Victime – assistance et représentation',
        description:
          'Accompagnement de la victime tout au long de la procédure pénale (plainte, instruction, audience).',
        billingType: 'mixed',
        flatFeeHtCents: 200000,
        successFeePercentBasisPoints: 1000,
        vatRateBasisPoints: VAT,
        paymentTerms:
          'Provision à la constitution. Honoraires de résultat après indemnisation définitive.'
      },
      {
        id: 'penal-instruction',
        name: 'Instruction judiciaire – mise en examen',
        description:
          'Assistance d’une personne mise en examen au cours d’une instruction judiciaire.',
        billingType: 'hourly',
        hourlyRateHtCents: 30000,
        retainerHtCents: 300000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Facturation semestrielle des diligences.'
      }
    ])
  },
  {
    id: 'administratif',
    label: 'Droit administratif',
    items: withLibraryUsage('feeAgreement', [
      {
        id: 'admin-recours-gracieux',
        name: 'Recours gracieux ou hiérarchique',
        description:
          'Rédaction d’un recours administratif préalable auprès de l’autorité compétente.',
        billingType: 'flat',
        flatFeeHtCents: 120000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'admin-refere-suspension',
        name: 'Référé-suspension (tribunal administratif)',
        description:
          'Procédure d’urgence devant le TA pour suspendre l’exécution d’une décision administrative.',
        billingType: 'flat',
        flatFeeHtCents: 250000,
        retainerHtCents: 100000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Solde à réception de l’ordonnance.'
      },
      {
        id: 'admin-contentieux-fond',
        name: 'Contentieux administratif au fond',
        description:
          'Procédure au fond devant le tribunal administratif ou la cour administrative d’appel.',
        billingType: 'flat',
        flatFeeHtCents: 350000,
        retainerHtCents: 150000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Facturation selon l’avancement de la procédure.'
      },
      {
        id: 'admin-marches-publics',
        name: 'Marchés publics – conseil et contentieux',
        description:
          'Conseil et représentation dans les procédures de passation et d’exécution des marchés publics.',
        billingType: 'hourly',
        hourlyRateHtCents: 30000,
        retainerHtCents: 200000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Facturation mensuelle des diligences.'
      },
      {
        id: 'admin-fonction-publique',
        name: 'Fonction publique – contentieux',
        description:
          'Représentation d’un agent public dans un litige avec son administration (sanction, mutation, etc.).',
        billingType: 'flat',
        flatFeeHtCents: 250000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_PROVISION
      },
      {
        id: 'admin-urbanisme',
        name: 'Droit de l’urbanisme – conseil',
        description:
          'Conseil sur les règles d’urbanisme, PLU, droits à construire et procédures d’autorisation.',
        billingType: 'hourly',
        hourlyRateHtCents: 28000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      }
    ])
  },
  {
    id: 'pi',
    label: 'Propriété intellectuelle',
    items: withLibraryUsage('feeAgreement', [
      {
        id: 'pi-marque-conseil',
        usage: 'both',
        name: 'Protection de marque – conseil et dépôt',
        description:
          'Recherche d’antériorités, conseil stratégique et accompagnement au dépôt INPI/EUIPO.',
        billingType: 'flat',
        flatFeeHtCents: 120000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J,
        expenseTerms: 'Taxes INPI/EUIPO et frais de dépôt refacturées au coût réel.'
      },
      {
        id: 'pi-contrefacon-marque',
        name: 'Contrefaçon de marque – action en justice',
        description:
          'Action judiciaire en contrefaçon ou défense contre une action en contrefaçon de marque.',
        billingType: 'mixed',
        flatFeeHtCents: 500000,
        successFeePercentBasisPoints: 1000,
        retainerHtCents: 200000,
        vatRateBasisPoints: VAT,
        paymentTerms:
          'Provision à la constitution. Honoraires de résultat à l’issue de la procédure.'
      },
      {
        id: 'pi-droit-auteur-contrat',
        usage: 'both',
        name: 'Droit d’auteur – cession de droits',
        description: 'Rédaction d’un contrat de cession ou de licence de droits d’auteur.',
        billingType: 'flat',
        flatFeeHtCents: 150000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'pi-droit-auteur-litige',
        name: 'Droit d’auteur – litige',
        description:
          'Contentieux relatif à la violation, contrefaçon ou plagiat d’une œuvre protégée.',
        billingType: 'mixed',
        flatFeeHtCents: 400000,
        successFeePercentBasisPoints: 1000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Honoraires de résultat à l’issue.'
      },
      {
        id: 'pi-logiciel-saas',
        usage: 'both',
        name: 'Contrat de logiciel / SaaS',
        description:
          'Rédaction ou révision d’un contrat de licence de logiciel ou de prestation SaaS.',
        billingType: 'flat',
        flatFeeHtCents: 200000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'pi-concurrence-deloyale',
        name: 'Concurrence déloyale et parasitisme',
        description:
          'Action en concurrence déloyale, parasitisme commercial ou débauchage de clientèle.',
        billingType: 'mixed',
        flatFeeHtCents: 400000,
        successFeePercentBasisPoints: 1000,
        retainerHtCents: 150000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Honoraires de résultat à l’issue.'
      },
      {
        id: 'pi-nom-domaine',
        name: 'Nom de domaine et droit internet',
        description:
          'Récupération de nom de domaine (UDRP), contentieux en ligne, droit des plateformes.',
        billingType: 'flat',
        flatFeeHtCents: 150000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      }
    ])
  },
  {
    id: 'rgpd',
    label: 'Données personnelles et contrats numériques',
    items: withLibraryUsage('feeAgreement', [
      {
        id: 'rgpd-audit',
        usage: 'both',
        name: 'Audit de conformité RGPD',
        description:
          'Cartographie des traitements de données, analyse des risques et feuille de route de mise en conformité.',
        billingType: 'flat',
        flatFeeHtCents: 250000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'rgpd-politique',
        usage: 'billing',
        name: 'Politique de confidentialité',
        description:
          'Rédaction ou mise à jour d’une politique de confidentialité conforme au RGPD.',
        billingType: 'flat',
        flatFeeHtCents: 100000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'rgpd-cgv-cgu',
        usage: 'billing',
        name: 'CGV / CGU – rédaction',
        description:
          'Rédaction de conditions générales de vente ou d’utilisation (e-commerce, SaaS, marketplace).',
        billingType: 'flat',
        flatFeeHtCents: 200000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'rgpd-dpo',
        usage: 'billing',
        name: 'DPO externalisé (forfait mensuel)',
        description:
          'Mission de délégué à la protection des données externalisé (suivi continu, registre, formation).',
        billingType: 'flat',
        flatFeeHtCents: 80000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Facturation mensuelle, paiement à réception de facture.'
      },
      {
        id: 'rgpd-violation',
        name: 'Violation de données – gestion de crise',
        description:
          'Assistance en cas de violation de données (notification CNIL, communication aux victimes, gestion du risque).',
        billingType: 'hourly',
        hourlyRateHtCents: 30000,
        retainerHtCents: 150000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Facturation des diligences sur présentation.'
      },
      {
        id: 'rgpd-cnil-procedure',
        name: 'Procédure CNIL – mise en demeure ou sanction',
        description:
          'Représentation devant la CNIL lors d’une mise en demeure ou d’une procédure de sanction.',
        billingType: 'hourly',
        hourlyRateHtCents: 32000,
        retainerHtCents: 200000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Facturation mensuelle des diligences.'
      }
    ])
  },
  {
    id: 'recouvrement',
    label: 'Recouvrement, exécution et procédures collectives',
    items: withLibraryUsage('feeAgreement', [
      {
        id: 'rec-amiable',
        usage: 'both',
        name: 'Recouvrement amiable de créances',
        description:
          'Mise en demeure et démarches amiables pour obtenir le paiement d’une créance.',
        billingType: 'mixed',
        flatFeeHtCents: 50000,
        successFeePercentBasisPoints: 1000,
        vatRateBasisPoints: VAT,
        paymentTerms:
          'Forfait à la constitution. Honoraires de résultat sur les sommes effectivement recouvrées.'
      },
      {
        id: 'rec-injonction-payer',
        name: 'Injonction de payer',
        description:
          'Procédure d’injonction de payer devant le tribunal judiciaire ou de commerce.',
        billingType: 'flat',
        flatFeeHtCents: 80000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J,
        expenseTerms: DEBOURS
      },
      {
        id: 'rec-saisie-attribution',
        name: 'Saisie-attribution',
        description:
          'Procédure de saisie-attribution sur compte bancaire pour recouvrement forcé d’une créance.',
        billingType: 'flat',
        flatFeeHtCents: 100000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J,
        expenseTerms: 'Frais d’huissier de justice refacturés au coût réel.'
      },
      {
        id: 'rec-procedure-collective-creancier',
        name: 'Procédure collective – défense créancier',
        description:
          'Déclaration de créance et représentation dans une procédure de redressement ou liquidation judiciaire.',
        billingType: 'flat',
        flatFeeHtCents: 200000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'rec-procedure-collective-debiteur',
        name: 'Procédure collective – accompagnement débiteur',
        description:
          'Assistance du dirigeant dans une procédure de sauvegarde, redressement ou liquidation judiciaire.',
        billingType: 'flat',
        flatFeeHtCents: 300000,
        retainerHtCents: 150000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Solde selon l’avancement de la procédure.'
      },
      {
        id: 'rec-contentieux-commercial',
        name: 'Contentieux commercial',
        description:
          'Représentation devant le tribunal de commerce pour tout litige entre commerçants ou sociétés.',
        billingType: 'flat',
        flatFeeHtCents: 300000,
        retainerHtCents: 100000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Solde à réception de la décision.'
      }
    ])
  },
  {
    id: 'prejudice-corporel',
    label: 'Préjudice corporel et assurances',
    items: withLibraryUsage('feeAgreement', [
      {
        id: 'pc-expertise-amiable',
        usage: 'both',
        name: 'Assistance à expertise médicale amiable',
        description:
          "Accompagnement de la victime lors de l'expertise médicale amiable diligentée par l'assureur adverse.",
        billingType: 'flat',
        flatFeeHtCents: 100000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'pc-expertise-judiciaire',
        name: 'Assistance à expertise médicale judiciaire',
        description:
          "Accompagnement lors des opérations d'expertise judiciaire (réunions, dires, rapport final).",
        billingType: 'flat',
        flatFeeHtCents: 200000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_PROVISION
      },
      {
        id: 'pc-evaluation-prejudice',
        usage: 'both',
        name: 'Évaluation et chiffrage du préjudice corporel',
        description:
          'Analyse des postes de préjudice (AIPP, ITT, pretium doloris, préjudice esthétique, perte de gains) et chiffrage de la demande indemnitaire.',
        billingType: 'flat',
        flatFeeHtCents: 80000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'pc-accident-circulation',
        name: 'Accident de la circulation – victime (loi Badinter)',
        description:
          "Défense de la victime d'un accident de la route, de la phase amiable jusqu'à la transaction ou le jugement.",
        billingType: 'mixed',
        flatFeeHtCents: 200000,
        retainerHtCents: 100000,
        successFeePercentBasisPoints: 1500,
        vatRateBasisPoints: VAT,
        paymentTerms:
          'Provision à la constitution. Honoraires de résultat sur les sommes effectivement obtenues.'
      },
      {
        id: 'pc-negotiation-assureur',
        usage: 'both',
        name: 'Négociation amiable avec la compagnie adverse',
        description:
          "Représentation et négociation avec l'assureur adverse pour obtenir une offre indemnitaire satisfaisante.",
        billingType: 'mixed',
        flatFeeHtCents: 150000,
        successFeePercentBasisPoints: 1000,
        vatRateBasisPoints: VAT,
        paymentTerms:
          "Forfait à la constitution. Honoraires de résultat sur le surplus obtenu par rapport à l'offre initiale."
      },
      {
        id: 'pc-faute-medicale-crci',
        name: 'Faute médicale – CRCI / ONIAM',
        description:
          "Saisine de la Commission de conciliation et d'indemnisation (CRCI) et suivi de la procédure amiable devant l'ONIAM.",
        billingType: 'mixed',
        flatFeeHtCents: 250000,
        successFeePercentBasisPoints: 1000,
        vatRateBasisPoints: VAT,
        paymentTerms:
          "Provision à la constitution. Honoraires de résultat à l'issue de la procédure ONIAM."
      },
      {
        id: 'pc-faute-medicale-contentieux',
        name: 'Faute médicale – contentieux judiciaire',
        description:
          'Action en responsabilité médicale devant le tribunal judiciaire (médecin libéral, clinique, hôpital privé).',
        billingType: 'mixed',
        flatFeeHtCents: 350000,
        retainerHtCents: 150000,
        successFeePercentBasisPoints: 1000,
        vatRateBasisPoints: VAT,
        paymentTerms:
          "Provision à la constitution. Honoraires de résultat à l'issue de la procédure."
      },
      {
        id: 'pc-faute-medicale-administratif',
        name: 'Faute médicale – hôpital public (tribunal administratif)',
        description:
          'Action en responsabilité médicale devant le tribunal administratif (hôpital public, CHU, EHPAD public).',
        billingType: 'mixed',
        flatFeeHtCents: 350000,
        retainerHtCents: 150000,
        successFeePercentBasisPoints: 1000,
        vatRateBasisPoints: VAT,
        paymentTerms:
          "Provision à la constitution. Honoraires de résultat à l'issue de la procédure."
      },
      {
        id: 'pc-accident-travail-faute-inexcusable',
        name: "Accident du travail – faute inexcusable de l'employeur",
        description:
          "Action en reconnaissance de la faute inexcusable de l'employeur devant le pôle social du tribunal judiciaire.",
        billingType: 'mixed',
        flatFeeHtCents: 250000,
        retainerHtCents: 100000,
        successFeePercentBasisPoints: 1000,
        vatRateBasisPoints: VAT,
        paymentTerms:
          "Provision à la constitution. Honoraires de résultat à l'issue de la procédure."
      },
      {
        id: 'pc-invalidite-incapacite',
        name: 'Mise en jeu garantie invalidité / incapacité',
        description:
          "Contestation du taux d'invalidité retenu par l'assureur et activation des garanties prévoyance ou emprunteur.",
        billingType: 'mixed',
        flatFeeHtCents: 200000,
        successFeePercentBasisPoints: 1000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Honoraires de résultat sur les sommes obtenues.'
      },
      {
        id: 'pc-refus-garantie',
        name: "Recours contre refus de garantie de l'assureur",
        description:
          "Contestation d'un refus de prise en charge (assurance habitation, auto, santé, emprunteur, RC professionnelle).",
        billingType: 'flat',
        flatFeeHtCents: 200000,
        retainerHtCents: 80000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Solde à réception de la décision.'
      },
      {
        id: 'pc-assurance-habitation',
        name: 'Assurance habitation – litige sinistre',
        description:
          "Défense de l'assuré lors d'un litige avec son assureur habitation (sous-évaluation du sinistre, exclusion de garantie).",
        billingType: 'flat',
        flatFeeHtCents: 150000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'pc-assurance-vie',
        name: 'Assurance vie – contentieux',
        description:
          "Litige relatif au versement d'un capital décès, à la désignation du bénéficiaire ou à la nullité du contrat.",
        billingType: 'flat',
        flatFeeHtCents: 250000,
        retainerHtCents: 100000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Solde à réception de la décision.'
      },
      {
        id: 'pc-rc-produits-defectueux',
        name: 'Responsabilité du fait des produits défectueux',
        description:
          "Action en réparation contre le fabricant ou le distributeur d'un produit défectueux ayant causé un dommage corporel.",
        billingType: 'mixed',
        flatFeeHtCents: 300000,
        successFeePercentBasisPoints: 1000,
        vatRateBasisPoints: VAT,
        paymentTerms:
          "Provision à la constitution. Honoraires de résultat à l'issue de la procédure."
      }
    ])
  },
  {
    id: 'etrangers',
    label: 'Droit des étrangers / Immigration',
    items: withLibraryUsage('feeAgreement', [
      {
        id: 'etr-titre-sejour-premiere',
        name: 'Titre de séjour – première demande',
        description:
          'Constitution et dépôt du dossier de première demande de titre de séjour (salarié, étudiant, vie privée et familiale, talent).',
        billingType: 'flat',
        flatFeeHtCents: 150000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'etr-titre-sejour-renouvellement',
        usage: 'both',
        name: 'Titre de séjour – renouvellement',
        description:
          "Assistance au renouvellement d'un titre de séjour et recours en cas de refus implicite ou explicite.",
        billingType: 'flat',
        flatFeeHtCents: 80000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'etr-oqtf-recours',
        name: 'OQTF – recours devant le tribunal administratif',
        description:
          'Recours en annulation contre une obligation de quitter le territoire français (délai de 15 jours ou 30 jours).',
        billingType: 'flat',
        flatFeeHtCents: 150000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Paiement immédiat ou à réception de facture (procédure urgente).'
      },
      {
        id: 'etr-oqtf-refere',
        name: 'OQTF – référé-liberté / référé-suspension',
        description:
          "Procédure d'urgence pour suspendre l'exécution d'une mesure d'éloignement imminente.",
        billingType: 'flat',
        flatFeeHtCents: 120000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Paiement immédiat (intervention sous 48 h).'
      },
      {
        id: 'etr-retention',
        name: 'Rétention administrative – audience JLD',
        description:
          'Représentation devant le juge des libertés et de la détention lors du maintien en centre de rétention administrative (CRA).',
        billingType: 'flat',
        flatFeeHtCents: 80000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Paiement immédiat (intervention sous 48 h).'
      },
      {
        id: 'etr-asile-ofpra',
        name: "Demande d'asile – OFPRA",
        description:
          "Aide à la rédaction du récit et préparation à l'entretien OFPRA pour une demande de protection internationale.",
        billingType: 'flat',
        flatFeeHtCents: 150000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'etr-asile-cnda',
        name: 'Recours devant la CNDA',
        description:
          "Représentation devant la Cour nationale du droit d'asile en cas de rejet de la demande par l'OFPRA.",
        billingType: 'flat',
        flatFeeHtCents: 200000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_PROVISION
      },
      {
        id: 'etr-naturalisation',
        usage: 'both',
        name: 'Naturalisation – conseil et dossier',
        description:
          'Accompagnement pour la constitution du dossier de naturalisation par décret ou par déclaration.',
        billingType: 'flat',
        flatFeeHtCents: 100000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'etr-regroupement-familial',
        usage: 'both',
        name: 'Regroupement familial',
        description:
          'Assistance pour la procédure de regroupement familial (constitution du dossier, recours en cas de refus).',
        billingType: 'flat',
        flatFeeHtCents: 150000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'etr-visa-refus',
        usage: 'both',
        name: 'Refus de visa – recours',
        description:
          'Recours gracieux puis contentieux contre un refus de visa long séjour ou de visa de retour.',
        billingType: 'flat',
        flatFeeHtCents: 100000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      }
    ])
  },
  {
    id: 'bancaire',
    label: 'Droit bancaire et surendettement',
    items: withLibraryUsage('feeAgreement', [
      {
        id: 'bank-devoir-conseil',
        name: 'Litige bancaire – manquement au devoir de conseil',
        description:
          "Action contre un établissement bancaire pour défaut de conseil lors de la souscription d'un produit financier ou d'un crédit.",
        billingType: 'mixed',
        flatFeeHtCents: 200000,
        successFeePercentBasisPoints: 1000,
        vatRateBasisPoints: VAT,
        paymentTerms:
          "Provision à la constitution. Honoraires de résultat à l'issue de la procédure."
      },
      {
        id: 'bank-credit-immobilier-clause',
        name: 'Crédit immobilier – clause abusive / TEG erroné',
        description:
          'Contestation du taux effectif global (TEG) ou de clauses abusives dans un contrat de prêt immobilier.',
        billingType: 'mixed',
        flatFeeHtCents: 250000,
        successFeePercentBasisPoints: 1000,
        vatRateBasisPoints: VAT,
        paymentTerms:
          "Provision à la constitution. Honoraires de résultat à l'issue de la procédure."
      },
      {
        id: 'bank-saisie-immobiliere',
        name: 'Saisie immobilière – défense du débiteur',
        description:
          "Représentation du débiteur saisi devant le juge de l'exécution, contestation de la procédure et négociation avec le créancier.",
        billingType: 'flat',
        flatFeeHtCents: 300000,
        retainerHtCents: 100000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Provision à la constitution. Solde à réception de la décision.'
      },
      {
        id: 'bank-surendettement-bdf',
        name: 'Surendettement – dossier Banque de France',
        description:
          'Constitution et suivi du dossier de surendettement devant la commission de la Banque de France.',
        billingType: 'flat',
        flatFeeHtCents: 120000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'bank-surendettement-contestation',
        name: 'Surendettement – contestation devant le juge',
        description:
          'Recours contre une décision de la commission de surendettement ou représentation lors de la procédure de rétablissement personnel.',
        billingType: 'flat',
        flatFeeHtCents: 150000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'bank-caution-abusive',
        name: 'Cautionnement – mise en jeu abusive',
        description:
          "Défense d'une caution (personne physique) contre un appel en garantie disproportionné ou irrégulier.",
        billingType: 'flat',
        flatFeeHtCents: 200000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_PROVISION
      },
      {
        id: 'bank-compte-cloture',
        name: 'Clôture abusive de compte bancaire',
        description:
          "Contestation de la clôture ou du refus d'ouverture d'un compte bancaire, mise en jeu du droit au compte.",
        billingType: 'flat',
        flatFeeHtCents: 100000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'bank-pret-particulier',
        usage: 'both',
        name: 'Prêt entre particuliers – recouvrement',
        description:
          "Recouvrement amiable ou judiciaire d'un prêt consenti entre particuliers (reconnaissance de dette, ordonnance d'injonction de payer).",
        billingType: 'mixed',
        flatFeeHtCents: 80000,
        successFeePercentBasisPoints: 1000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Forfait à la constitution. Honoraires de résultat sur les sommes recouvrées.'
      }
    ])
  },
  {
    id: 'construction',
    label: 'Droit de la construction',
    items: withLibraryUsage('feeAgreement', [
      {
        id: 'const-garantie-decennale',
        name: 'Garantie décennale – mise en jeu',
        description:
          'Action contre le constructeur ou son assureur au titre de la garantie décennale pour des désordres apparus dans les dix ans suivant la réception.',
        billingType: 'mixed',
        flatFeeHtCents: 250000,
        retainerHtCents: 100000,
        successFeePercentBasisPoints: 1000,
        vatRateBasisPoints: VAT,
        paymentTerms:
          "Provision à la constitution. Honoraires de résultat à l'issue de la procédure."
      },
      {
        id: 'const-refere-expertise',
        name: 'Référé expertise en construction',
        description:
          'Procédure de référé préventif pour faire désigner un expert judiciaire et figer le constat des désordres avant tout travaux.',
        billingType: 'flat',
        flatFeeHtCents: 150000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_PROVISION
      },
      {
        id: 'const-malfacons',
        name: 'Malfaçons – contentieux après réception',
        description:
          'Action en responsabilité contre un entrepreneur ou un artisan pour malfaçons, vices cachés ou non-conformités constatés après réception.',
        billingType: 'mixed',
        flatFeeHtCents: 200000,
        retainerHtCents: 80000,
        successFeePercentBasisPoints: 1000,
        vatRateBasisPoints: VAT,
        paymentTerms:
          "Provision à la constitution. Honoraires de résultat à l'issue de la procédure."
      },
      {
        id: 'const-ccmi',
        usage: 'both',
        name: 'CCMI – litige avec le constructeur de maison individuelle',
        description:
          "Défense du maître d'ouvrage face à un constructeur (retards, désordres, non-respect du contrat de construction de maison individuelle).",
        billingType: 'mixed',
        flatFeeHtCents: 300000,
        retainerHtCents: 100000,
        successFeePercentBasisPoints: 1000,
        vatRateBasisPoints: VAT,
        paymentTerms:
          "Provision à la constitution. Honoraires de résultat à l'issue de la procédure."
      },
      {
        id: 'const-reception-reserves',
        usage: 'both',
        name: 'Réception de travaux et levée de réserves',
        description:
          'Assistance lors de la réception des travaux, rédaction des procès-verbaux de réserves et suivi de leur levée.',
        billingType: 'flat',
        flatFeeHtCents: 100000,
        vatRateBasisPoints: VAT,
        paymentTerms: PAY_30J
      },
      {
        id: 'const-dommage-ouvrage',
        name: 'Dommage-ouvrage – refus ou insuffisance',
        description:
          "Contestation du refus de prise en charge ou de l'indemnisation insuffisante proposée par l'assureur dommage-ouvrage.",
        billingType: 'mixed',
        flatFeeHtCents: 250000,
        successFeePercentBasisPoints: 1000,
        vatRateBasisPoints: VAT,
        paymentTerms:
          "Provision à la constitution. Honoraires de résultat à l'issue de la procédure."
      },
      {
        id: 'const-architecte-moe',
        name: "Responsabilité de l'architecte / maître d'œuvre",
        description:
          "Action en responsabilité contre l'architecte ou le maître d'œuvre pour fautes de conception, de direction ou de surveillance du chantier.",
        billingType: 'mixed',
        flatFeeHtCents: 300000,
        retainerHtCents: 100000,
        successFeePercentBasisPoints: 1000,
        vatRateBasisPoints: VAT,
        paymentTerms:
          "Provision à la constitution. Honoraires de résultat à l'issue de la procédure."
      },
      {
        id: 'const-sous-traitant',
        name: 'Action directe du sous-traitant',
        description:
          "Mise en jeu de l'action directe du sous-traitant contre le maître d'ouvrage pour obtenir le paiement de ses prestations (loi de 1975).",
        billingType: 'mixed',
        flatFeeHtCents: 150000,
        successFeePercentBasisPoints: 1000,
        vatRateBasisPoints: VAT,
        paymentTerms: 'Forfait à la constitution. Honoraires de résultat sur les sommes recouvrées.'
      }
    ])
  }
]
