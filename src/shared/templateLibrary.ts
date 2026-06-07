// Static, bundled template library. Mirrors the pattern of serviceCatalogLibrary.ts:
// items are HTML templates (with {{routines}} smart-tag markup) ready to import into
// a user's personal templates collection. Edits to existing imports stay local;
// re-importing creates a duplicate. Tariff/content updates require a release.
//
// Design system & routines (see plan): every model uses only tags from the routine
// catalog (src/shared/templateRoutines.ts), in their French alias form. Chronology
// extensions ({{date.<label>.formate}}) and contact role extensions
// ({{contact.<role>.<field>}}) are resolved dynamically at generation time —
// users add the corresponding key date or role-tagged contact to their dossier.

import type { TemplateDocumentKind } from './domain/template'

export interface TemplateLibraryItem {
  /** Stable, prefixed identifier. Used only for de-duplication in the UI. */
  id: string
  name: string
  description?: string
  tags?: string[]
  /** Document family. Defaults to 'document' (correspondence) when omitted. */
  kind?: TemplateDocumentKind
  /** HTML content with smart-tag spans (data-tag="..." wrapping {{tag}}). */
  content: string
}

interface TemplateLibraryTheme {
  id: string
  label: string
  description?: string
  items: TemplateLibraryItem[]
}

// Helper to render a routine span identical to SmartTagExtension output.
const t = (path: string): string => `<span data-tag="${path}">{{${path}}}</span>`

// =============================================================================
// DESIGN SYSTEM — typographic & layout constants reused across templates
// =============================================================================

// Sender block (firm letterhead, left-aligned).
const SENDER_BLOCK = `<p><strong>${t('cabinet.nomCabinet')}</strong><br/>${t('cabinet.adresseFormatee')}<br/>${t('cabinet.telephone')} — ${t('cabinet.email')}</p>`

// Recipient block, right-aligned (French letter convention).
const recipientRight = (nameTag: string, addressTag: string): string =>
  `<p style="text-align:right">${nameTag}<br/>${addressTag}</p>`

const RECIPIENT_CLIENT = recipientRight(t('contact.civiliteNom'), t('contact.adresseFormatee'))
const RECIPIENT_CONFRERE = recipientRight(
  t('contact.conseilAdverse.nomAffiche'),
  t('contact.conseilAdverse.adresseFormatee')
)
const RECIPIENT_GREFFE = `<p style="text-align:right">Madame, Monsieur le Greffier<br/>${t('dossier.tribunal')}</p>`

// Place + date line, right-aligned, immediately before the subject.
const PLACE_DATE_RIGHT = `<p style="text-align:right">Fait à ${t('cabinet.ville')}, le ${t('aujourdhuiTexte')}.</p>`

// Reference line (dossier + RG, discreet grey).
const REFERENCE_LINE = `<p style="font-size:0.9em;color:#5c5c5a">Nos réf. : ${t('dossier.nom')} — RG : ${t('aCompleter')}</p>`

// Subject line, bold tag, body filled per template.
const subject = (body: string): string => `<p><strong>Objet :</strong> ${body}</p>`

// Body wrapper — justified for letter bodies.
const body = (html: string): string => `<div style="text-align:justify">${html}</div>`

// Closing formulas.
const CLOSING_CLIENT = `<p>Je vous prie d'agréer, ${t('contact.civiliteNom')}, l'expression de mes salutations distinguées.</p>`
const CLOSING_CONFRERE = `<p>Je vous prie de croire, Cher Confrère, à l'expression de mes sentiments confraternels les meilleurs.</p>`
const CLOSING_GREFFE = `<p>Je vous prie d'agréer, Madame, Monsieur le Greffier, l'expression de ma considération distinguée.</p>`

// Lawyer signature block.
const SIGNATURE_SOLO = `<p>${t('cabinet.avocat.titre')} ${t('cabinet.nomAffiche')}<br/>Avocat au Barreau de ${t('cabinet.barreau')}<br/>Toque ${t('cabinet.toque')}</p>`

// Email signature (no toque on second line, slimmer).
const EMAIL_SIGNATURE = `<p>Bien à vous,<br/>${t('cabinet.avocat.titre')} ${t('cabinet.nomAffiche')}<br/><span style="font-size:0.9em;color:#5c5c5a">${t('cabinet.nomCabinet')} — ${t('cabinet.telephone')}</span></p>`
const EMAIL_SIGNATURE_CONFRERE = `<p>Bien confraternellement,<br/>${t('cabinet.avocat.titre')} ${t('cabinet.nomAffiche')}<br/><span style="font-size:0.9em;color:#5c5c5a">Avocat au Barreau de ${t('cabinet.barreau')} — Toque ${t('cabinet.toque')}</span></p>`
const EMAIL_SIGNATURE_GREFFE = `<p>${t('cabinet.avocat.titre')} ${t('cabinet.nomAffiche')}<br/><span style="font-size:0.9em;color:#5c5c5a">Avocat au Barreau de ${t('cabinet.barreau')} — Toque ${t('cabinet.toque')}</span></p>`

// Convention article title.
const art = (n: number, label: string): string => `<p><strong>Article ${n} — ${label}.</strong>`

// Standardized footer line for client letters (PJ mention).
const enclosure = (label: string): string =>
  `<p style="font-size:0.9em;color:#5c5c5a">P.J. : ${label}</p>`

// =============================================================================
// 1. CORRESPONDANCE CLIENT — formal paper letters to the client
// =============================================================================

const correspondanceClient: TemplateLibraryItem[] = [
  {
    id: 'corr-ouverture-dossier',
    name: 'Lettre — Ouverture de dossier',
    description:
      "Confirme l'ouverture du dossier après le premier rendez-vous, joint la convention d'honoraires et liste les pièces requises.",
    tags: ['client', 'ouverture'],
    content:
      SENDER_BLOCK +
      RECIPIENT_CLIENT +
      PLACE_DATE_RIGHT +
      REFERENCE_LINE +
      subject(`ouverture de votre dossier — ${t('dossier.nom')}`) +
      `<p>${t('contact.formuleAppel')},</p>` +
      body(
        `<p>Faisant suite à notre entretien du ${t('aujourdhuiTexte')}, je vous confirme l'ouverture de votre dossier relatif à ${t('convention.objet')}.</p>` +
          `<p>Vous trouverez ci-joint la <strong>convention d'honoraires</strong> détaillant le périmètre de ma mission et les modalités financières (${t('convention.forfait')} HT, soit ${t('convention.forfaitTtc')} TTC). Je vous remercie de bien vouloir me la retourner signée avant le ${t('date.j+8.formate')}.</p>` +
          `<p>Afin d'engager utilement l'instruction de votre dossier, je vous prie également de me communiquer les pièces suivantes :</p>` +
          `<ul><li>${t('aCompleter')} ;</li><li>${t('aCompleter')} ;</li><li>${t('aCompleter')}.</li></ul>` +
          `<p>Je reste à votre entière disposition pour toute question que cette lettre appellerait.</p>`
      ) +
      CLOSING_CLIENT +
      SIGNATURE_SOLO +
      enclosure("Convention d'honoraires")
  },
  {
    id: 'corr-demande-pieces',
    name: 'Lettre — Demande de pièces',
    description: 'Sollicite la transmission de pièces complémentaires avec échéance à 15 jours.',
    tags: ['client', 'pièces'],
    content:
      SENDER_BLOCK +
      RECIPIENT_CLIENT +
      PLACE_DATE_RIGHT +
      REFERENCE_LINE +
      subject(`demande de pièces — ${t('dossier.nom')}`) +
      `<p>${t('contact.formuleAppel')},</p>` +
      body(
        `<p>Afin de poursuivre l'instruction de votre dossier dans les meilleures conditions, je vous remercie de me communiquer, <strong>avant le ${t('date.j+15.formate')}</strong>, les pièces suivantes :</p>` +
          `<ul><li>${t('aCompleter')} ;</li><li>${t('aCompleter')} ;</li><li>${t('aCompleter')} ;</li><li>${t('aCompleter')}.</li></ul>` +
          `<p>À défaut de réception dans ce délai, je serai contraint de différer les diligences correspondantes, ce qui pourrait avoir une incidence sur le calendrier de votre dossier.</p>` +
          `<p>Je vous remercie par avance de votre diligence.</p>`
      ) +
      CLOSING_CLIENT +
      SIGNATURE_SOLO
  },
  {
    id: 'corr-ar-pieces',
    name: 'Lettre — Accusé de réception de pièces',
    description: 'Accuse formellement réception des pièces transmises par le client.',
    tags: ['client', 'pièces'],
    content:
      SENDER_BLOCK +
      RECIPIENT_CLIENT +
      PLACE_DATE_RIGHT +
      REFERENCE_LINE +
      subject(`accusé de réception de pièces — ${t('dossier.nom')}`) +
      `<p>${t('contact.formuleAppel')},</p>` +
      body(
        `<p>J'accuse réception, ce jour, des pièces que vous m'avez adressées concernant votre dossier référencé en objet.</p>` +
          `<p>Après examen attentif de ces éléments, je reviendrai vers vous dans les meilleurs délais — à titre indicatif, sous huitaine — pour vous faire part de mon analyse et des prochaines étapes envisagées.</p>` +
          `<p>Dans l'intervalle, je reste à votre disposition pour toute information complémentaire.</p>`
      ) +
      CLOSING_CLIENT +
      SIGNATURE_SOLO
  },
  {
    id: 'corr-relance-honoraires-1',
    name: 'Lettre — Relance honoraires (1ʳᵉ relance)',
    description: 'Première relance amiable au titre des honoraires restant dus.',
    tags: ['client', 'honoraires'],
    content:
      SENDER_BLOCK +
      RECIPIENT_CLIENT +
      PLACE_DATE_RIGHT +
      REFERENCE_LINE +
      subject(`relance — règlement des honoraires — ${t('dossier.nom')}`) +
      `<p>${t('contact.formuleAppel')},</p>` +
      body(
        `<p>Sauf erreur ou règlement intervenu entre-temps, il résulte de ma comptabilité que la somme de <strong>${t('convention.soldeDu')}</strong> reste due au titre des honoraires liés à votre dossier, conformément à la convention conclue le ${t('convention.dateSignature')}.</p>` +
          `<p>Je vous serais reconnaissant de bien vouloir procéder au règlement de cette somme <strong>avant le ${t('date.j+8.formate')}</strong>, par virement sur le compte suivant :</p>` +
          `<p>IBAN : ${t('cabinet.iban')}<br/>BIC : ${t('cabinet.bic')}<br/>Titulaire : ${t('cabinet.nomCabinet')}</p>` +
          `<p>Si vous deviez rencontrer une difficulté ponctuelle, n'hésitez pas à me contacter sans délai afin que nous puissions convenir, le cas échéant, d'un échéancier.</p>`
      ) +
      CLOSING_CLIENT +
      SIGNATURE_SOLO
  },
  {
    id: 'corr-cloture-dossier',
    name: 'Lettre — Clôture de dossier',
    description: 'Clôture amiable du dossier après accomplissement de la mission.',
    tags: ['client', 'clôture'],
    content:
      SENDER_BLOCK +
      RECIPIENT_CLIENT +
      PLACE_DATE_RIGHT +
      REFERENCE_LINE +
      subject(`clôture de votre dossier — ${t('dossier.nom')}`) +
      `<p>${t('contact.formuleAppel')},</p>` +
      body(
        `<p>La mission que vous avez bien voulu me confier étant à présent arrivée à son terme, je procède ce jour à la clôture de votre dossier.</p>` +
          `<p>Vous trouverez ci-joint :</p>` +
          `<ul><li>l'ensemble des pièces originales que vous m'aviez communiquées ;</li><li>copie des actes et correspondances échangés dans le cadre de la procédure ;</li><li>${t('aCompleter')}.</li></ul>` +
          `<p>Je vous invite à conserver précieusement ces documents, qui pourraient vous être utiles ultérieurement. Mon archive numérique sera, pour sa part, conservée pendant la durée légale de cinq ans.</p>` +
          `<p>Je vous remercie sincèrement de la confiance que vous m'avez témoignée et reste à votre disposition pour toute mission future.</p>`
      ) +
      CLOSING_CLIENT +
      SIGNATURE_SOLO +
      enclosure('Pièces et actes du dossier')
  }
]

// =============================================================================
// 2. EMAILS — CLIENT (short, daily exchanges; no letterhead, sober signature)
// =============================================================================

const emailsClient: TemplateLibraryItem[] = [
  {
    id: 'email-rdv-confirmation',
    name: 'Email — Confirmation de rendez-vous',
    description:
      'Email court confirmant un rendez-vous au cabinet. Suppose une date clé « RDV » dans la chronologie pour la date du rendez-vous.',
    tags: ['email', 'rdv'],
    content:
      `<p>${t('contact.formuleAppel')},</p>` +
      `<p>Je vous confirme notre <strong>rendez-vous le ${t('date.rdv.formate')}</strong> au cabinet, à l'adresse suivante :</p>` +
      `<p>${t('cabinet.adresseCompacte')}</p>` +
      `<p>Merci de prévoir, dans la mesure du possible, l'ensemble des pièces utiles à la bonne tenue de notre entretien. En cas d'empêchement, je vous remercie de me prévenir au plus tôt afin que nous puissions convenir d'un nouveau créneau.</p>` +
      `<p>Je me réjouis de vous rencontrer.</p>` +
      EMAIL_SIGNATURE
  },
  {
    id: 'email-transmission-pieces',
    name: 'Email — Transmission de pièces',
    description: 'Email accompagnant la transmission de pièces au client.',
    tags: ['email', 'pièces'],
    content:
      `<p>${t('contact.formuleAppel')},</p>` +
      `<p>Vous trouverez en pièces jointes, dans le cadre de votre dossier <strong>${t('dossier.nom')}</strong>, les documents suivants :</p>` +
      `<ul><li>${t('aCompleter')} ;</li><li>${t('aCompleter')}.</li></ul>` +
      `<p>Je vous remercie de bien vouloir m'en accuser réception et reste à votre disposition pour toute précision.</p>` +
      `<p style="font-size:0.9em;color:#5c5c5a">Ces documents contiennent des données à caractère personnel : merci de les conserver dans un espace sécurisé.</p>` +
      EMAIL_SIGNATURE
  },
  {
    id: 'email-point-avancement',
    name: 'Email — Point d’avancement',
    description:
      "Email d'étape sur l'avancement du dossier (situation actuelle / prochaine étape / délai).",
    tags: ['email', 'suivi'],
    content:
      `<p>${t('contact.formuleAppel')},</p>` +
      `<p>Je reviens vers vous afin de faire un point sur l'avancement de votre dossier <strong>${t('dossier.nom')}</strong>.</p>` +
      `<p><strong>État actuel.</strong> ${t('aCompleter')}</p>` +
      `<p><strong>Prochaine étape.</strong> ${t('aCompleter')}</p>` +
      `<p><strong>Échéance.</strong> ${t('aCompleter')}</p>` +
      `<p>Je reste à votre disposition pour échanger sur ces éléments.</p>` +
      EMAIL_SIGNATURE
  },
  {
    id: 'email-relance-honoraires',
    name: 'Email — Relance honoraires',
    description: "Relance amiable des honoraires par email, avec rappel de l'IBAN cabinet.",
    tags: ['email', 'honoraires'],
    content:
      `<p>${t('contact.formuleAppel')},</p>` +
      `<p>Sauf erreur ou règlement intervenu entre-temps, le solde de <strong>${t('convention.soldeDu')}</strong> reste dû au titre des honoraires de votre dossier ${t('dossier.nom')}.</p>` +
      `<p>Pourriez-vous me confirmer la date prévue de règlement ? Pour mémoire, le virement peut être effectué sur le compte suivant :</p>` +
      `<p>IBAN : ${t('cabinet.iban')}<br/>BIC : ${t('cabinet.bic')}</p>` +
      `<p>Je vous en remercie par avance.</p>` +
      EMAIL_SIGNATURE
  },
  {
    id: 'email-instruction-urgente',
    name: 'Email — Demande d’instruction urgente',
    description: 'Sollicite une décision rapide du client sur un point précis.',
    tags: ['email', 'urgent'],
    content:
      `<p><strong>URGENT — Décision requise sous huitaine</strong></p>` +
      `<p>${t('contact.formuleAppel')},</p>` +
      `<p>Concernant votre dossier <strong>${t('dossier.nom')}</strong>, j'ai besoin de votre instruction sur le point suivant :</p>` +
      `<p style="margin-left:1em;border-left:3px solid #5c5c5a;padding-left:0.6em">${t('aCompleter')}</p>` +
      `<p>Je vous remercie de bien vouloir me répondre <strong>avant le ${t('date.j+8.formate')}</strong>, faute de quoi je serai contraint d'adopter la position la plus prudente pour préserver vos intérêts.</p>` +
      `<p>Je me tiens à votre disposition par téléphone si un échange direct vous semble préférable.</p>` +
      EMAIL_SIGNATURE
  },
  {
    id: 'email-cloture',
    name: 'Email — Clôture amiable',
    description: 'Email court de clôture de dossier après mission accomplie.',
    tags: ['email', 'clôture'],
    content:
      `<p>${t('contact.formuleAppel')},</p>` +
      `<p>Je vous confirme que votre dossier <strong>${t('dossier.nom')}</strong> est désormais clos, la mission qui m'a été confiée étant arrivée à son terme.</p>` +
      `<p>Je vous remercie chaleureusement de la confiance que vous m'avez accordée et reste, bien entendu, à votre disposition pour toute mission future.</p>` +
      `<p>N'hésitez pas, si vous le souhaitez, à recommander mes services à votre entourage.</p>` +
      EMAIL_SIGNATURE
  }
]

// =============================================================================
// 3. EMAILS — CONFRÈRES / JURIDICTIONS
// =============================================================================

const emailsConfreresJuridictions: TemplateLibraryItem[] = [
  {
    id: 'email-confrere-transmission-pieces',
    name: 'Email — Transmission de pièces (confrère)',
    description: 'Transmission confraternelle de pièces par email (RPVA ou messagerie sécurisée).',
    tags: ['email', 'confrère'],
    content:
      `<p>Cher Confrère,</p>` +
      `<p>Vous trouverez en pièce jointe, dans le cadre du dossier <strong>${t('dossier.nom')}</strong> inscrit devant ${t('dossier.tribunal')} (RG ${t('aCompleter')}), la communication des pièces numérotées ${t('aCompleter')}.</p>` +
      `<p>Le bordereau récapitulatif accompagne cette communication.</p>` +
      EMAIL_SIGNATURE_CONFRERE
  },
  {
    id: 'email-confrere-renvoi',
    name: 'Email — Demande de renvoi (confrère)',
    description:
      'Demande amiable de renvoi adressée au confrère. Suppose une date clé « Audience ».',
    tags: ['email', 'confrère', 'renvoi'],
    content:
      `<p>Cher Confrère,</p>` +
      `<p>Concernant le dossier <strong>${t('dossier.nom')}</strong> fixé devant ${t('dossier.tribunal')} <strong>à l'audience du ${t('date.audience.formate')}</strong>, je sollicite votre accord pour solliciter conjointement un renvoi de l'affaire.</p>` +
      `<p><strong>Motif.</strong> ${t('aCompleter')}</p>` +
      `<p>Sous réserve de votre accord, j'adresserai un courrier en ce sens au greffe de la juridiction.</p>` +
      `<p>Je vous remercie par avance de votre réponse.</p>` +
      EMAIL_SIGNATURE_CONFRERE
  },
  {
    id: 'email-confrere-point-audience',
    name: 'Email — Point sur audience (confrère)',
    description: 'Point factuel sur une audience à venir. Suppose une date clé « Audience ».',
    tags: ['email', 'confrère', 'audience'],
    content:
      `<p>Cher Confrère,</p>` +
      `<p>Pour le bon ordre du dossier <strong>${t('dossier.nom')}</strong>, je vous confirme <strong>l'audience du ${t('date.audience.formate')}</strong> devant ${t('dossier.tribunal')}.</p>` +
      `<p><strong>Pièces et écritures.</strong> ${t('aCompleter')}</p>` +
      `<p><strong>Points à coordonner.</strong> ${t('aCompleter')}</p>` +
      `<p>Je reste à votre disposition pour tout échange préparatoire.</p>` +
      EMAIL_SIGNATURE_CONFRERE
  },
  {
    id: 'email-greffe-production',
    name: 'Email — Production de pièces (greffe)',
    description: 'Email au greffe accompagnant la production de pièces.',
    tags: ['email', 'greffe'],
    content:
      `<p>Madame, Monsieur le Greffier,</p>` +
      `<p>Veuillez trouver en pièce jointe, pour le dossier <strong>${t('dossier.nom')}</strong> inscrit devant ${t('dossier.tribunal')} sous le RG ${t('aCompleter')}, ${t('aCompleter')}.</p>` +
      `<p>Je vous en remercie par avance.</p>` +
      EMAIL_SIGNATURE_GREFFE
  },
  {
    id: 'email-greffe-copie-jugement',
    name: 'Email — Demande de copie de jugement (greffe)',
    description:
      'Sollicite copie simple ou exécutoire du jugement rendu. Suppose, le cas échéant, une date clé « Jugement ».',
    tags: ['email', 'greffe', 'jugement'],
    content:
      `<p>Madame, Monsieur le Greffier,</p>` +
      `<p>Je sollicite par la présente la délivrance d'une copie ${t('aCompleter')} (simple / exécutoire) du jugement rendu le ${t('date.jugement.formate')} dans le dossier <strong>${t('dossier.nom')}</strong> (RG ${t('aCompleter')}) par ${t('dossier.tribunal')}.</p>` +
      `<p>Je m'acquitterai du timbre fiscal correspondant à réception de votre demande.</p>` +
      `<p>Avec mes remerciements anticipés.</p>` +
      EMAIL_SIGNATURE_GREFFE
  }
]

// =============================================================================
// 4. CONVENTION / HONORAIRES — formal fee agreements (loi Macron 2015)
// =============================================================================

const CONVENTION_PARTIES = `<p><strong>Entre les soussignés :</strong></p>
<p>${t('cabinet.avocat.titre')} ${t('cabinet.nomAffiche')}, Avocat au Barreau de ${t('cabinet.barreau')} (Toque ${t('cabinet.toque')}), exerçant au sein de ${t('cabinet.nomCabinet')} (${t('cabinet.formeJuridique')} au capital de ${t('cabinet.capitalSocial')} — SIREN ${t('cabinet.siren')}), dont le siège est sis ${t('cabinet.adresseFormatee')},</p>
<p>ci-après désigné « <strong>l'Avocat</strong> »,</p>
<p style="text-align:center"><strong>D'une part,</strong></p>
<p>Et</p>
<p>${t('convention.client.civiliteNom')}, demeurant ${t('convention.client.adresseFormatee')},</p>
<p>ci-après désigné « <strong>le Client</strong> »,</p>
<p style="text-align:center"><strong>D'autre part.</strong></p>`

const CONVENTION_PREAMBULE = `<p><strong>Il a été préalablement exposé ce qui suit :</strong></p>
<p>Le Client a sollicité l'Avocat afin de l'assister dans l'affaire suivante : ${t('convention.objet')}.</p>
<p>Conformément aux dispositions de l'article 10 de la loi du 31 décembre 1971 modifiée et de l'article 11.2 du Règlement Intérieur National de la profession d'avocat, les parties ont convenu de formaliser leurs relations par la présente convention.</p>
<p><strong>Ceci exposé, il a été convenu ce qui suit :</strong></p>`

const CONVENTION_COMMON_ARTICLES = (startNo: number): string =>
  `${art(startNo, "Devoir d'information et reddition de comptes")} L'Avocat informera régulièrement le Client de l'évolution du dossier et lui rendra compte des diligences accomplies. Toute facture détaillera la nature des diligences ainsi que le temps consacré.</p>` +
  `${art(startNo + 1, 'Confidentialité et secret professionnel')} L'Avocat est tenu au secret professionnel le plus absolu, conformément à l'article 66-5 de la loi du 31 décembre 1971 modifiée. Toute correspondance ou pièce communiquée par le Client demeure confidentielle.</p>` +
  `${art(startNo + 2, 'Résiliation')} Chaque partie peut mettre fin à la présente convention à tout moment, par lettre recommandée avec accusé de réception. ${t('convention.resiliation')} Les honoraires correspondant aux diligences déjà accomplies resteront en tout état de cause dus.</p>` +
  `${art(startNo + 3, 'Médiation de la consommation')} En cas de litige relatif à la fixation ou au paiement des honoraires, le Client peut, préalablement à toute action contentieuse, saisir le médiateur de la consommation de la profession d'avocat (<em>mediateur-consommation-avocat.fr</em>) ou Monsieur le Bâtonnier de l'Ordre des Avocats du Barreau de ${t('cabinet.barreau')}.</p>` +
  `${art(startNo + 4, 'Droit applicable et juridiction')} La présente convention est régie par le droit français. Tout litige relatif à son interprétation ou à son exécution relèvera de la compétence des juridictions du ressort de la Cour d'appel de ${t('cabinet.barreau')}.</p>`

const CONVENTION_SIGNATURE_LINE = `<p>Fait à ${t('cabinet.ville')}, le ${t('aujourdhuiTexte')}, en deux exemplaires originaux dont un est remis à chacune des parties.</p><table style="margin-top:1em"><tr><td><strong>L'Avocat</strong><br/><span style="font-size:0.9em;color:#5c5c5a">(signature précédée de « lu et approuvé »)</span><br/><br/><br/><br/>${t('cabinet.avocat.titre')} ${t('cabinet.nomAffiche')}</td><td>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</td><td><strong>Le Client</strong><br/><span style="font-size:0.9em;color:#5c5c5a">(signature précédée de « lu et approuvé »)</span><br/><br/><br/><br/>${t('convention.client.nomAffiche')}</td></tr></table>`

const conventionHonoraires: TemplateLibraryItem[] = [
  {
    id: 'conv-forfait',
    name: 'Convention d’honoraires — Forfait',
    description:
      'Convention au forfait — structure complète conforme à la loi Macron 2015 (mission, honoraires, paiement, médiation, résiliation).',
    tags: ['convention', 'forfait'],
    content:
      `<h2 style="text-align:center">CONVENTION D'HONORAIRES</h2>` +
      CONVENTION_PARTIES +
      CONVENTION_PREAMBULE +
      body(
        `${art(1, 'Mission et étendue')} L'Avocat est chargé par le Client de la mission suivante : ${t('convention.mission')}. Toute extension de la mission devra faire l'objet d'un avenant écrit.</p>` +
          `${art(2, 'Honoraires au forfait')} En contrepartie des diligences décrites à l'article 1, le Client versera à l'Avocat un honoraire forfaitaire de <strong>${t('convention.forfait')} HT</strong>, soit <strong>${t('convention.forfaitTtc')} TTC</strong> (TVA au taux de ${t('convention.tva')}).</p>` +
          `${art(3, 'Provision')} Une provision de ${t('convention.provision')} sera versée à la signature des présentes, par virement sur le compte CARPA suivant : IBAN ${t('cabinet.ibanCarpa')}. Cette provision s'imputera sur le forfait final.</p>` +
          `${art(4, 'Frais et débours')} ${t('convention.frais')} Les frais exposés (déplacements, copies, frais postaux, etc.) sont refacturés au Client au réel, sur justificatifs.</p>` +
          `${art(5, 'Facturation et paiement')} ${t('convention.paiement')} À défaut de paiement à l'échéance, des intérêts de retard au taux légal majoré seront appliqués de plein droit, sans mise en demeure préalable.</p>` +
          CONVENTION_COMMON_ARTICLES(6)
      ) +
      CONVENTION_SIGNATURE_LINE
  },
  {
    id: 'conv-temps-passe',
    name: 'Convention d’honoraires — Temps passé',
    description:
      'Convention au temps passé — taux horaire, provision, suivi détaillé des diligences.',
    tags: ['convention', 'horaire'],
    content:
      `<h2 style="text-align:center">CONVENTION D'HONORAIRES AU TEMPS PASSÉ</h2>` +
      CONVENTION_PARTIES +
      CONVENTION_PREAMBULE +
      body(
        `${art(1, 'Mission et étendue')} L'Avocat est chargé par le Client de la mission suivante : ${t('convention.mission')}.</p>` +
          `${art(2, 'Honoraires au temps passé')} Les honoraires seront calculés en fonction du temps effectivement consacré au dossier, au taux horaire HT de <strong>${t('convention.tauxHoraire')}</strong> (TVA au taux de ${t('convention.tva')}). Le temps passé fera l'objet d'un décompte détaillé, transmis périodiquement au Client.</p>` +
          `${art(3, 'Provision')} Une provision initiale de <strong>${t('convention.provision')} HT</strong> sera versée à la signature des présentes, par virement sur le compte CARPA suivant : IBAN ${t('cabinet.ibanCarpa')}. Cette provision s'imputera sur les diligences à venir et sera complétée, le cas échéant, par des provisions complémentaires selon l'avancement du dossier.</p>` +
          `${art(4, 'Frais et débours')} ${t('convention.frais')}</p>` +
          `${art(5, 'Facturation et paiement')} Les factures seront émises mensuellement ou à étapes-clés du dossier. ${t('convention.paiement')}</p>` +
          CONVENTION_COMMON_ARTICLES(6)
      ) +
      CONVENTION_SIGNATURE_LINE
  },
  {
    id: 'conv-mixte',
    name: 'Convention d’honoraires — Mixte (forfait + résultat)',
    description: 'Convention combinant honoraire fixe et honoraire complémentaire de résultat.',
    tags: ['convention', 'mixte'],
    content:
      `<h2 style="text-align:center">CONVENTION D'HONORAIRES MIXTE</h2>` +
      CONVENTION_PARTIES +
      CONVENTION_PREAMBULE +
      body(
        `${art(1, 'Mission et étendue')} L'Avocat est chargé par le Client de la mission suivante : ${t('convention.mission')}.</p>` +
          `${art(2, 'Honoraire fixe')} En contrepartie de la mission ci-dessus, le Client versera à l'Avocat un honoraire fixe de <strong>${t('convention.forfait')} HT</strong>, soit <strong>${t('convention.forfaitTtc')} TTC</strong> (TVA au taux de ${t('convention.tva')}).</p>` +
          `${art(3, 'Provision')} Une provision de ${t('convention.provision')} sera versée à la signature des présentes, par virement sur le compte CARPA suivant : IBAN ${t('cabinet.ibanCarpa')}.</p>` +
          `${art(4, 'Honoraire complémentaire de résultat')} En complément de l'honoraire fixe, le Client versera à l'Avocat un honoraire de résultat égal à <strong>${t('convention.honoraireResultat')}</strong> calculé conformément à la clause suivante : ${t('convention.clauseResultat')}. Cet honoraire ne sera dû qu'en cas d'obtention effective du résultat ainsi défini.</p>` +
          `${art(5, 'Frais et débours')} ${t('convention.frais')}</p>` +
          `${art(6, 'Facturation et paiement')} ${t('convention.paiement')}</p>` +
          CONVENTION_COMMON_ARTICLES(7)
      ) +
      CONVENTION_SIGNATURE_LINE
  },
  {
    id: 'conv-lettre-mission',
    name: 'Lettre de mission',
    description:
      "Lettre de mission courte pour mission ponctuelle (consultation, rédaction d'acte, etc.).",
    tags: ['mission'],
    content:
      SENDER_BLOCK +
      RECIPIENT_CLIENT +
      PLACE_DATE_RIGHT +
      REFERENCE_LINE +
      subject(`lettre de mission — ${t('dossier.nom')}`) +
      `<p>${t('contact.formuleAppel')},</p>` +
      body(
        `<p>Faisant suite à nos échanges, je vous confirme par la présente la mission que vous souhaitez me confier dans le cadre de votre dossier référencé en objet.</p>` +
          `<p><strong>1. Mission.</strong> ${t('convention.mission')}</p>` +
          `<p><strong>2. Honoraires.</strong> Mes honoraires sont fixés à <strong>${t('convention.forfait')} HT</strong>, soit <strong>${t('convention.forfaitTtc')} TTC</strong> (TVA au taux de ${t('convention.tva')}). ${t('convention.paiement')}</p>` +
          `<p><strong>3. Frais et débours.</strong> ${t('convention.frais')}</p>` +
          `<p><strong>4. Résiliation.</strong> Chaque partie peut mettre fin à cette mission à tout moment, par écrit ; les diligences déjà accomplies demeurent dues.</p>` +
          `<p>Je vous remercie de bien vouloir me retourner la présente, datée et signée, avec la mention manuscrite « bon pour accord ». Le virement de la provision pourra être effectué sur le compte CARPA suivant : IBAN ${t('cabinet.ibanCarpa')}.</p>`
      ) +
      CLOSING_CLIENT +
      SIGNATURE_SOLO
  }
]

// =============================================================================
// 5. ACTES DE PROCÉDURE — formal procedural documents
// =============================================================================

const actesProcedure: TemplateLibraryItem[] = [
  {
    id: 'acte-conclusions',
    name: 'Conclusions (trame)',
    description:
      'Trame de conclusions. Utilise les extensions « Partie adverse » et « Conseil adverse » si ces contacts sont déclarés.',
    tags: ['procédure', 'conclusions'],
    content:
      `<p style="text-align:center"><strong>${t('dossier.tribunal')}</strong></p>` +
      `<p style="text-align:center;font-size:0.9em;color:#5c5c5a">RG n° ${t('aCompleter')} — Audience du ${t('date.audience.formate')}</p>` +
      `<h3 style="text-align:center">CONCLUSIONS</h3>` +
      `<p><strong>POUR :</strong> ${t('contact.civiliteNom')},<br/>demeurant ${t('contact.adresseFormatee')},<br/>${t('contact.profession')}, de nationalité ${t('contact.nationalite')},<br/>né(e) le ${t('contact.dateNaissance')}.</p>` +
      `<p>Ayant pour avocat : ${t('cabinet.avocat.titre')} ${t('cabinet.nomAffiche')}, Avocat au Barreau de ${t('cabinet.barreau')} (Toque ${t('cabinet.toque')}), ${t('cabinet.adresseFormatee')}.</p>` +
      `<p><strong>CONTRE :</strong> ${t('contact.partieAdverse.nomAffiche')},<br/>demeurant ${t('contact.partieAdverse.adresseFormatee')}.</p>` +
      `<p>Ayant pour conseil : ${t('contact.conseilAdverse.nomAffiche')} (${t('contact.conseilAdverse.institution')}).</p>` +
      body(
        `<h3>I — Rappel des faits et de la procédure</h3>` +
          `<p>${t('aCompleter')}</p>` +
          `<h3>II — Discussion</h3>` +
          `<p><strong>II.1 — En droit.</strong> ${t('aCompleter')}</p>` +
          `<p><strong>II.2 — En fait.</strong> ${t('aCompleter')}</p>` +
          `<h3>III — Sur les frais irrépétibles et les dépens</h3>` +
          `<p>Conformément aux dispositions de l'article 700 du Code de procédure civile, il serait inéquitable de laisser à la charge du concluant l'intégralité des frais qu'il a dû exposer pour faire valoir ses droits. Une somme de ${t('aCompleter')} euros lui sera utilement allouée à ce titre, outre les entiers dépens de l'instance.</p>` +
          `<p style="text-align:center"><strong>PAR CES MOTIFS,</strong></p>` +
          `<p>Vu les pièces versées aux débats,</p>` +
          `<p>Il est demandé à ${t('dossier.tribunal')} de bien vouloir :</p>` +
          `<ul><li>${t('aCompleter')} ;</li><li>${t('aCompleter')} ;</li><li>Condamner ${t('contact.partieAdverse.nomAffiche')} au paiement de la somme de ${t('aCompleter')} euros sur le fondement de l'article 700 du Code de procédure civile ;</li><li>Condamner ${t('contact.partieAdverse.nomAffiche')} aux entiers dépens de l'instance.</li></ul>` +
          `<p><strong>SOUS TOUTES RÉSERVES.</strong></p>`
      ) +
      `<p>Fait à ${t('cabinet.ville')}, le ${t('aujourdhuiTexte')}.</p>` +
      SIGNATURE_SOLO
  },
  {
    id: 'acte-assignation',
    name: 'Assignation (trame)',
    description: "Trame d'assignation. Utilise les extensions « Huissier » et « Partie adverse ».",
    tags: ['procédure', 'assignation'],
    content:
      `<p style="text-align:center"><strong>ASSIGNATION DEVANT ${t('dossier.tribunal')}</strong></p>` +
      `<p style="text-align:center;font-size:0.9em;color:#5c5c5a">Audience d'appel des causes du ${t('date.audience.formate')}</p>` +
      `<p><strong>L'AN DEUX MIL ${t('aCompleter')} ET LE ${t('date.assignation.formate')}.</strong></p>` +
      `<p><strong>À LA REQUÊTE DE :</strong></p>` +
      `<p>${t('contact.civiliteNom')}, ${t('contact.profession')}, de nationalité ${t('contact.nationalite')}, né(e) le ${t('contact.dateNaissance')}, demeurant ${t('contact.adresseFormatee')}.</p>` +
      `<p>Ayant pour avocat constitué : ${t('cabinet.avocat.titre')} ${t('cabinet.nomAffiche')}, Avocat au Barreau de ${t('cabinet.barreau')} (Toque ${t('cabinet.toque')}), au cabinet duquel domicile est élu, sis ${t('cabinet.adresseFormatee')}.</p>` +
      `<p><strong>J'AI, ${t('contact.huissier.nomAffiche')}, Commissaire de justice (${t('contact.huissier.institution')}),</strong></p>` +
      `<p><strong>DONNÉ ASSIGNATION À :</strong></p>` +
      `<p>${t('contact.partieAdverse.nomAffiche')}, demeurant ${t('contact.partieAdverse.adresseFormatee')}.</p>` +
      `<p>D'avoir à comparaître devant ${t('dossier.tribunal')}, à <strong>l'audience du ${t('date.audience.formate')}</strong>.</p>` +
      body(
        `<h3>I — Objet de la demande</h3>` +
          `<p>${t('aCompleter')}</p>` +
          `<h3>II — Exposé des faits</h3>` +
          `<p>${t('aCompleter')}</p>` +
          `<h3>III — Discussion en droit</h3>` +
          `<p>${t('aCompleter')}</p>` +
          `<p style="text-align:center"><strong>PAR CES MOTIFS,</strong></p>` +
          `<p>Il est demandé à ${t('dossier.tribunal')} de bien vouloir :</p>` +
          `<ul><li>${t('aCompleter')} ;</li><li>Condamner ${t('contact.partieAdverse.nomAffiche')} au paiement de la somme de ${t('aCompleter')} euros sur le fondement de l'article 700 du Code de procédure civile ;</li><li>Condamner ${t('contact.partieAdverse.nomAffiche')} aux entiers dépens.</li></ul>` +
          `<p><strong>SOUS TOUTES RÉSERVES.</strong></p>`
      ) +
      SIGNATURE_SOLO
  },
  {
    id: 'acte-requete',
    name: 'Requête (trame)',
    description: 'Trame de requête (procédure gracieuse ou sur requête).',
    tags: ['procédure', 'requête'],
    content:
      `<p style="text-align:center"><strong>REQUÊTE</strong></p>` +
      `<p style="text-align:center">À Madame, Monsieur le Président de ${t('dossier.tribunal')}</p>` +
      `<p><strong>LE REQUÉRANT :</strong></p>` +
      `<p>${t('contact.civiliteNom')}, ${t('contact.profession')}, demeurant ${t('contact.adresseFormatee')}.</p>` +
      `<p>Représenté par : ${t('cabinet.avocat.titre')} ${t('cabinet.nomAffiche')}, Avocat au Barreau de ${t('cabinet.barreau')} (Toque ${t('cabinet.toque')}), au cabinet duquel domicile est élu, sis ${t('cabinet.adresseFormatee')}.</p>` +
      body(
        `<h3>I — Exposé des faits</h3>` +
          `<p>${t('aCompleter')}</p>` +
          `<h3>II — En droit</h3>` +
          `<p>${t('aCompleter')}</p>` +
          `<h3>III — Pièces à l'appui</h3>` +
          `<p>Sont produites les pièces visées au bordereau ci-joint.</p>` +
          `<p style="text-align:center"><strong>PAR CES MOTIFS,</strong></p>` +
          `<p>Vu les pièces produites,</p>` +
          `<p>Il est sollicité de Madame, Monsieur le Président de bien vouloir :</p>` +
          `<ul><li>${t('aCompleter')} ;</li><li>Réserver les dépens.</li></ul>` +
          `<p><strong>SOUS TOUTES RÉSERVES.</strong></p>`
      ) +
      `<p>Fait à ${t('cabinet.ville')}, le ${t('aujourdhuiTexte')}.</p>` +
      SIGNATURE_SOLO
  },
  {
    id: 'acte-bordereau-pieces',
    name: 'Bordereau de communication de pièces',
    description: 'Bordereau récapitulatif des pièces produites.',
    tags: ['procédure', 'pièces'],
    content:
      `<p style="text-align:center"><strong>BORDEREAU DE COMMUNICATION DE PIÈCES</strong></p>` +
      `<p style="text-align:center;font-size:0.9em;color:#5c5c5a">Dossier ${t('dossier.nom')} — ${t('dossier.tribunal')} — RG ${t('aCompleter')}</p>` +
      `<p><strong>POUR :</strong> ${t('contact.civiliteNom')}</p>` +
      `<p>Ayant pour avocat : ${t('cabinet.avocat.titre')} ${t('cabinet.nomAffiche')}, Avocat au Barreau de ${t('cabinet.barreau')} (Toque ${t('cabinet.toque')}).</p>` +
      `<p><strong>CONTRE :</strong> ${t('contact.partieAdverse.nomAffiche')}</p>` +
      `<p>Je verse aux débats les pièces suivantes :</p>` +
      `<ol><li>${t('aCompleter')} ;</li><li>${t('aCompleter')} ;</li><li>${t('aCompleter')} ;</li><li>${t('aCompleter')} ;</li><li>${t('aCompleter')}.</li></ol>` +
      `<p>Fait à ${t('cabinet.ville')}, le ${t('aujourdhuiTexte')}.</p>` +
      SIGNATURE_SOLO
  }
]

// =============================================================================
// 6. COURRIERS CONFRÈRES — formal letters between counsels
// =============================================================================

const courriersConfreres: TemplateLibraryItem[] = [
  {
    id: 'conf-officielle',
    name: 'Lettre confraternelle officielle',
    description: 'Courrier officiel adressé à un confrère. Suppose un contact « Conseil adverse ».',
    tags: ['confrère', 'officiel'],
    content:
      SENDER_BLOCK +
      RECIPIENT_CONFRERE +
      PLACE_DATE_RIGHT +
      `<p style="font-size:0.9em;color:#5c5c5a">Nos réf. : ${t('dossier.nom')} — RG : ${t('aCompleter')}</p>` +
      `<p><strong>OFFICIELLE</strong></p>` +
      subject(`${t('dossier.nom')}`) +
      `<p>Cher Confrère,</p>` +
      body(
        `<p>${t('aCompleter')}</p>` +
          `<p>Je reste à votre disposition pour toute précision utile à la bonne tenue du dossier.</p>`
      ) +
      CLOSING_CONFRERE +
      SIGNATURE_SOLO
  },
  {
    id: 'conf-transmission-pieces',
    name: 'Lettre — Transmission de pièces au confrère',
    description:
      'Transmission formelle de pièces au confrère adverse. Suppose un contact « Conseil adverse ».',
    tags: ['confrère', 'pièces'],
    content:
      SENDER_BLOCK +
      RECIPIENT_CONFRERE +
      PLACE_DATE_RIGHT +
      `<p style="font-size:0.9em;color:#5c5c5a">Nos réf. : ${t('dossier.nom')} — RG : ${t('aCompleter')}</p>` +
      subject(`${t('dossier.nom')} — Communication de pièces`) +
      `<p>Cher Confrère,</p>` +
      body(
        `<p>Vous trouverez ci-joint, selon le bordereau récapitulatif annexé, la communication des pièces numérotées <strong>${t('aCompleter')}</strong> relatives au dossier référencé en objet.</p>` +
          `<p>Je vous remercie de bien vouloir m'en accuser réception.</p>`
      ) +
      CLOSING_CONFRERE +
      SIGNATURE_SOLO +
      enclosure('Bordereau et pièces numérotées')
  },
  {
    id: 'conf-demande-renvoi',
    name: 'Lettre — Demande de renvoi (confrère)',
    description:
      'Demande formelle de renvoi adressée au confrère. Suppose les contacts « Conseil adverse » et une date clé « Audience ».',
    tags: ['confrère', 'renvoi'],
    content:
      SENDER_BLOCK +
      RECIPIENT_CONFRERE +
      PLACE_DATE_RIGHT +
      `<p style="font-size:0.9em;color:#5c5c5a">Nos réf. : ${t('dossier.nom')} — RG : ${t('aCompleter')}</p>` +
      subject(`${t('dossier.nom')} — Demande de renvoi`) +
      `<p>Cher Confrère,</p>` +
      body(
        `<p>Concernant <strong>l'audience fixée au ${t('date.audience.formate')}</strong> devant ${t('dossier.tribunal')}, je sollicite votre accord afin de demander conjointement à la juridiction le renvoi de l'affaire.</p>` +
          `<p><strong>Motif.</strong> ${t('aCompleter')}</p>` +
          `<p>Sous réserve de votre accord, j'adresserai une lettre en ce sens à Madame, Monsieur le Greffier, dont copie vous sera bien entendu communiquée.</p>` +
          `<p>Je vous remercie par avance de votre retour.</p>`
      ) +
      CLOSING_CONFRERE +
      SIGNATURE_SOLO
  },
  {
    id: 'conf-constitution',
    name: 'Lettre — Constitution',
    description:
      'Constitution adressée au confrère adverse. Suppose les contacts « Conseil adverse » et une date clé « Audience » si connue.',
    tags: ['confrère', 'constitution'],
    content:
      SENDER_BLOCK +
      RECIPIENT_CONFRERE +
      PLACE_DATE_RIGHT +
      `<p style="font-size:0.9em;color:#5c5c5a">Nos réf. : ${t('dossier.nom')} — RG : ${t('aCompleter')}</p>` +
      subject(`${t('dossier.nom')} — Constitution`) +
      `<p>Cher Confrère,</p>` +
      body(
        `<p>J'ai l'honneur de vous informer que je me <strong>constitue dans les intérêts de ${t('contact.civiliteNom')}</strong> dans le dossier référencé en objet, inscrit devant ${t('dossier.tribunal')}.</p>` +
          `<p>L'affaire est, à ce jour, fixée à l'audience du <strong>${t('date.audience.formate')}</strong>. Je m'en rapprocherai en temps utile pour préparer le contradictoire.</p>` +
          `<p>Toute correspondance et toute communication de pièces relative à ce dossier devront m'être adressées directement.</p>`
      ) +
      CLOSING_CONFRERE +
      SIGNATURE_SOLO
  }
]

// =============================================================================
// 7. COURRIERS JURIDICTIONS — formal letters to court registries
// =============================================================================

const courriersJuridictions: TemplateLibraryItem[] = [
  {
    id: 'jur-greffe-production',
    name: 'Lettre — Production au greffe',
    description: 'Production de pièces au greffe avec bordereau.',
    tags: ['greffe', 'production'],
    content:
      SENDER_BLOCK +
      RECIPIENT_GREFFE +
      PLACE_DATE_RIGHT +
      `<p style="font-size:0.9em;color:#5c5c5a">Nos réf. : ${t('dossier.nom')} — RG : ${t('aCompleter')}</p>` +
      subject(`production au greffe — ${t('dossier.nom')}`) +
      `<p>Madame, Monsieur le Greffier,</p>` +
      body(
        `<p>Je vous prie de bien vouloir trouver ci-joint, dans le cadre du dossier référencé en objet, les éléments suivants :</p>` +
          `<ol><li>${t('aCompleter')} ;</li><li>${t('aCompleter')} ;</li><li>${t('aCompleter')}.</li></ol>` +
          `<p>Je vous remercie de bien vouloir verser ces pièces au dossier de la procédure.</p>`
      ) +
      CLOSING_GREFFE +
      SIGNATURE_SOLO +
      enclosure('Pièces visées au corps de la lettre')
  },
  {
    id: 'jur-copie-jugement',
    name: 'Lettre — Demande de copie de jugement',
    description:
      'Sollicite copie simple ou exécutoire du jugement rendu. Suppose, le cas échéant, une date clé « Jugement ».',
    tags: ['greffe', 'jugement'],
    content:
      SENDER_BLOCK +
      RECIPIENT_GREFFE +
      PLACE_DATE_RIGHT +
      `<p style="font-size:0.9em;color:#5c5c5a">Nos réf. : ${t('dossier.nom')} — RG : ${t('aCompleter')}</p>` +
      subject(`demande de copie de jugement — ${t('dossier.nom')}`) +
      `<p>Madame, Monsieur le Greffier,</p>` +
      body(
        `<p>Je sollicite, par la présente, la délivrance d'une <strong>copie ${t('aCompleter')} (simple / exécutoire)</strong> du jugement rendu le ${t('date.jugement.formate')} dans le dossier référencé en objet par ${t('dossier.tribunal')}.</p>` +
          `<p>Je m'engage à régler le timbre fiscal correspondant à réception de votre demande, et à venir retirer la copie sollicitée au greffe — ou à recevoir celle-ci par voie postale, selon vos modalités habituelles.</p>` +
          `<p>Je vous en remercie par avance.</p>`
      ) +
      CLOSING_GREFFE +
      SIGNATURE_SOLO
  },
  {
    id: 'jur-demande-date',
    name: 'Lettre — Demande de date d’audience',
    description: "Sollicite la fixation d'une date d'audience.",
    tags: ['greffe', 'audience'],
    content:
      SENDER_BLOCK +
      RECIPIENT_GREFFE +
      PLACE_DATE_RIGHT +
      `<p style="font-size:0.9em;color:#5c5c5a">Nos réf. : ${t('dossier.nom')} — RG : ${t('aCompleter')}</p>` +
      subject(`demande de date d'audience — ${t('dossier.nom')}`) +
      `<p>Madame, Monsieur le Greffier,</p>` +
      body(
        `<p>Je sollicite respectueusement la fixation d'une date d'audience dans le dossier référencé en objet.</p>` +
          `<p><strong>Stade procédural.</strong> ${t('aCompleter')}</p>` +
          `<p><strong>Diligences accomplies.</strong> ${t('aCompleter')}</p>` +
          `<p>À toutes fins utiles, je vous indique mes disponibilités sur les périodes suivantes : ${t('aCompleter')}.</p>` +
          `<p>Je me tiens à votre disposition pour toute information complémentaire.</p>`
      ) +
      CLOSING_GREFFE +
      SIGNATURE_SOLO
  }
]

// =============================================================================
// 8. FACTURATION — invoice / credit note / corrective invoice
// =============================================================================
// - Issuer block uses entity tags directly (cabinet.*) — the entity IS the
//   party invoicing. Legacy `facture.emetteur.*` snapshot fields are
//   superseded.
// - Client block uses contact.* tags grouped on the primary contact, so
//   `contact.adresseFormatee` resolves to the full postal address rather
//   than the truncated invoice client snapshot.
// - Payment terms come from the active fee agreement, not a duplicated
//   invoice-side field.
// - Legal footer is composed from entity legal fields (forme juridique,
//   capital social, SIREN, RCS, TVA) rather than free-form text on the
//   invoice settings.
// - {{facture.tableauPrestations}} is replaced by the rendered lines table
//   during DOCX generation; in HTML it stays as literal text.

const INVOICE_HEADER = `<p><strong>${t('cabinet.nomCabinet')}</strong><br/>${t('cabinet.adresseFormatee')}<br/>${t('cabinet.telephone')} — ${t('cabinet.email')}</p>`

const INVOICE_CLIENT_BLOCK = `<p style="text-align:right">${t('contact.civiliteNom')}<br/>${t('contact.adresseFormatee')}</p>`

const INVOICE_TOTALS_BLOCK = `<table style="width:60%;margin-left:auto"><tr><td style="text-align:right">Total HT</td><td style="text-align:right">${t('facture.totalHt')}</td></tr><tr><td style="text-align:right">TVA (${t('convention.tva')})</td><td style="text-align:right">${t('facture.totalTva')}</td></tr><tr><td style="text-align:right"><strong>Total TTC</strong></td><td style="text-align:right"><strong>${t('facture.totalTtc')}</strong></td></tr></table>`

const INVOICE_PAYMENT_BLOCK = `<p><strong>Modalités de paiement.</strong> ${t('convention.paiement')}</p><p>Coordonnées bancaires :<br/>IBAN : ${t('cabinet.iban')} — BIC : ${t('cabinet.bic')}<br/><span style="font-size:0.9em;color:#5c5c5a">Pour les provisions, IBAN CARPA : ${t('cabinet.ibanCarpa')}</span></p>`

const INVOICE_LEGAL_FOOTER = `<p style="font-size:0.85em;color:#5c5c5a">${t('cabinet.nomCabinet')} — ${t('cabinet.formeJuridique')} au capital de ${t('cabinet.capitalSocial')}<br/>SIREN ${t('cabinet.siren')} — RCS ${t('cabinet.villeGreffe')} ${t('cabinet.numeroRcs')} — TVA intracommunautaire ${t('cabinet.tva')}<br/>En cas de retard de paiement, indemnité forfaitaire pour frais de recouvrement de 40 € (art. L441-10 C. com.).</p>`

const facturation: TemplateLibraryItem[] = [
  {
    id: 'fac-standard',
    name: 'Facture — Standard',
    description:
      'Facture standard : en-tête cabinet, bloc client, métadonnées, tableau des prestations, totaux, coordonnées bancaires et mentions légales.',
    tags: ['facture', 'standard'],
    kind: 'invoice',
    content:
      INVOICE_HEADER +
      INVOICE_CLIENT_BLOCK +
      `<h2 style="text-align:center">${t('facture.typeDocument')} N° ${t('facture.numero')}</h2>` +
      `<p style="text-align:center;font-size:0.9em;color:#5c5c5a">Émise le ${t('facture.dateEmission')} — Échéance le ${t('facture.dateEcheance')}<br/>Dossier : ${t('dossier.nom')}</p>` +
      `<p>${t('facture.tableauPrestations')}</p>` +
      INVOICE_TOTALS_BLOCK +
      INVOICE_PAYMENT_BLOCK +
      INVOICE_LEGAL_FOOTER
  },
  {
    id: 'avoir-standard',
    name: 'Avoir — Standard',
    description:
      "Avoir total ou partiel sur facture, avec mention de la facture d'origine, motif et ventilation TVA.",
    tags: ['avoir', 'standard'],
    kind: 'creditNote',
    content:
      INVOICE_HEADER +
      INVOICE_CLIENT_BLOCK +
      `<h2 style="text-align:center">AVOIR N° ${t('facture.numero')}</h2>` +
      `<p style="text-align:center;font-size:0.9em;color:#5c5c5a">Émis le ${t('facture.dateEmission')}<br/>Dossier : ${t('dossier.nom')}</p>` +
      `<p><strong>Avoir relatif à :</strong> ${t('facture.facturesOrigine')}<br/><strong>Motif :</strong> ${t('facture.motifCorrection')}</p>` +
      `<p>${t('facture.tableauPrestations')}</p>` +
      INVOICE_TOTALS_BLOCK +
      INVOICE_LEGAL_FOOTER
  },
  {
    id: 'facture-rectificative-standard',
    name: 'Facture rectificative — Standard',
    description:
      'Facture rectificative annulant et remplaçant une facture précédente, avec motif de correction.',
    tags: ['facture', 'rectificative'],
    kind: 'correctiveInvoice',
    content:
      INVOICE_HEADER +
      INVOICE_CLIENT_BLOCK +
      `<h2 style="text-align:center">${t('facture.typeDocument')} N° ${t('facture.numero')}</h2>` +
      `<p style="text-align:center;font-size:0.9em;color:#5c5c5a">Émise le ${t('facture.dateEmission')} — Échéance le ${t('facture.dateEcheance')}<br/>Dossier : ${t('dossier.nom')}</p>` +
      `<p><strong>Annule et remplace :</strong> ${t('facture.facturesOrigine')}<br/><strong>Motif de correction :</strong> ${t('facture.motifCorrection')}</p>` +
      `<p>${t('facture.tableauPrestations')}</p>` +
      INVOICE_TOTALS_BLOCK +
      INVOICE_PAYMENT_BLOCK +
      INVOICE_LEGAL_FOOTER
  }
]

// =============================================================================
// AIDE JURIDICTIONNELLE — désignation, attestation, convention de complément
// et factures (rétribution État + complément client).
// =============================================================================

const AJ_LEGAL_FOOTER = `<p style="font-size:0.85em;color:#5c5c5a">${t('cabinet.avocat.titre')} ${t('cabinet.nomAffiche')} — Avocat au Barreau de ${t('cabinet.barreau')}, Toque ${t('cabinet.toque')}<br/>Rétribution versée par l'État au titre de l'aide juridictionnelle (loi n° 91-647 du 10 juillet 1991).</p>`

const aideJuridictionnelle: TemplateLibraryItem[] = [
  {
    id: 'designation-aj',
    name: 'Désignation — Aide juridictionnelle',
    description:
      "Acceptation de la mission au titre de l'aide juridictionnelle suite à la décision du BAJ.",
    tags: ['aide-juridictionnelle', 'designation'],
    content:
      SENDER_BLOCK +
      RECIPIENT_CLIENT +
      PLACE_DATE_RIGHT +
      REFERENCE_LINE +
      subject(`désignation au titre de l'aide juridictionnelle — ${t('dossier.nom')}`) +
      `<p>${t('contact.formuleAppel')},</p>` +
      body(
        `<p>J'ai l'honneur de vous informer que j'ai été désigné(e) pour assurer la défense de vos intérêts au titre de l'aide juridictionnelle ${t('dossier.aideJuridictionnelle.type')}.</p>` +
          `<p>Décision du bureau d'aide juridictionnelle n° ${t('dossier.aideJuridictionnelle.numeroDecision')} du ${t('dossier.aideJuridictionnelle.dateDecision')} (${t('dossier.aideJuridictionnelle.baj')}).</p>` +
          `<p>Référence du dossier d'aide juridictionnelle : ${t('dossier.aideJuridictionnelle.numeroAj')}.</p>`
      ) +
      CLOSING_CLIENT +
      SIGNATURE_SOLO
  },
  {
    id: 'attestation-fin-mission-aj',
    name: 'Attestation de fin de mission — AJ',
    description:
      "Attestation de mission accomplie au titre de l'aide juridictionnelle, à transmettre pour le versement de la rétribution.",
    tags: ['aide-juridictionnelle', 'attestation'],
    content:
      SENDER_BLOCK +
      PLACE_DATE_RIGHT +
      `<h2 style="text-align:center">Attestation de fin de mission</h2>` +
      body(
        `<p>Je soussigné(e) ${t('cabinet.avocat.titre')} ${t('cabinet.nomAffiche')}, Avocat au Barreau de ${t('cabinet.barreau')}, atteste avoir accompli la mission qui m'a été confiée au titre de l'aide juridictionnelle ${t('dossier.aideJuridictionnelle.type')} dans le dossier ${t('dossier.nom')}.</p>` +
          `<p>Décision du BAJ n° ${t('dossier.aideJuridictionnelle.numeroDecision')} du ${t('dossier.aideJuridictionnelle.dateDecision')}.</p>` +
          `<p>Cette attestation est délivrée pour servir et valoir ce que de droit, notamment en vue du versement de la rétribution due par l'État.</p>`
      ) +
      SIGNATURE_SOLO +
      AJ_LEGAL_FOOTER
  },
  {
    id: 'conv-complement-aj',
    name: "Convention de complément d'honoraires — AJ partielle",
    description:
      "Convention d'honoraires complémentaires en cas d'aide juridictionnelle partielle, avec mention légale et plafonnement.",
    tags: ['aide-juridictionnelle', 'convention', 'complement'],
    content:
      CONVENTION_PARTIES +
      CONVENTION_PREAMBULE +
      body(
        `${art(1, 'Objet')} La présente convention fixe le complément d'honoraires dû par le client, bénéficiaire de l'aide juridictionnelle partielle (prise en charge de ${t('dossier.aideJuridictionnelle.taux')} par l'État), en complément de la rétribution versée par l'État.</p>` +
          `${art(2, "Rétribution de l'État")} La part prise en charge par l'État s'élève à <strong>${t('dossier.feeAgreement.retributionEtat')} HT</strong>, versée par l'intermédiaire de la CARPA.</p>` +
          `${art(3, "Complément d'honoraires")} Le complément d'honoraires librement négocié, à la charge du client, est fixé à <strong>${t('dossier.feeAgreement.complementHonoraires')} HT</strong>, conformément à l'article 35 de la loi n° 91-647 du 10 juillet 1991.</p>` +
          `${art(4, 'Versement')} Le complément sera versé par virement sur le compte CARPA suivant : IBAN ${t('cabinet.ibanCarpa')}.</p>` +
          CONVENTION_COMMON_ARTICLES(5)
      ) +
      CONVENTION_SIGNATURE_LINE
  },
  {
    id: 'fac-aj-retribution-etat',
    name: 'Facture — Rétribution AJ (État)',
    description:
      "Facture de la rétribution versée par l'État au titre de l'aide juridictionnelle (paiement via CARPA).",
    tags: ['aide-juridictionnelle', 'facture', 'etat'],
    kind: 'invoice',
    content:
      INVOICE_HEADER +
      INVOICE_CLIENT_BLOCK +
      `<h2 style="text-align:center">${t('facture.typeDocument')} N° ${t('facture.numero')}</h2>` +
      `<p style="text-align:center;font-size:0.9em;color:#5c5c5a">Rétribution au titre de l'aide juridictionnelle<br/>Émise le ${t('facture.dateEmission')} — Dossier : ${t('dossier.nom')}</p>` +
      `<p>Décision BAJ n° ${t('dossier.aideJuridictionnelle.numeroDecision')} — Référence AJ : ${t('dossier.aideJuridictionnelle.numeroAj')}</p>` +
      `<p>${t('facture.tableauPrestations')}</p>` +
      INVOICE_TOTALS_BLOCK +
      `<p>Règlement par l'intermédiaire de la CARPA : IBAN ${t('cabinet.ibanCarpa')}.</p>` +
      AJ_LEGAL_FOOTER
  },
  {
    id: 'fac-aj-complement',
    name: "Facture — Complément d'honoraires (AJ partielle)",
    description:
      "Facture du complément d'honoraires à la charge du client en cas d'aide juridictionnelle partielle.",
    tags: ['aide-juridictionnelle', 'facture', 'complement'],
    kind: 'invoice',
    content:
      INVOICE_HEADER +
      INVOICE_CLIENT_BLOCK +
      `<h2 style="text-align:center">${t('facture.typeDocument')} N° ${t('facture.numero')}</h2>` +
      `<p style="text-align:center;font-size:0.9em;color:#5c5c5a">Complément d'honoraires — aide juridictionnelle partielle (${t('dossier.aideJuridictionnelle.taux')})<br/>Émise le ${t('facture.dateEmission')} — Échéance le ${t('facture.dateEcheance')}<br/>Dossier : ${t('dossier.nom')}</p>` +
      `<p>${t('facture.tableauPrestations')}</p>` +
      INVOICE_TOTALS_BLOCK +
      INVOICE_PAYMENT_BLOCK +
      INVOICE_LEGAL_FOOTER
  }
]

/**
 * IDs des modèles seedés automatiquement au bootstrap d'un domaine
 * (cf. templateService.seedDefaultTemplatesIfEmpty). Ces 9 modèles couvrent
 * le minimum vital : facturation, conventions d'honoraires, ouverture de
 * dossier et email de confirmation de rendez-vous.
 */
export const ESSENTIAL_TEMPLATE_IDS = [
  'fac-standard',
  'avoir-standard',
  'facture-rectificative-standard',
  'conv-forfait',
  'conv-temps-passe',
  'conv-mixte',
  'conv-lettre-mission',
  'corr-ouverture-dossier',
  'email-rdv-confirmation',
  'designation-aj',
  'attestation-fin-mission-aj',
  'conv-complement-aj',
  'fac-aj-retribution-etat',
  'fac-aj-complement'
] as const

export const TEMPLATE_LIBRARY_THEMES: TemplateLibraryTheme[] = [
  {
    id: 'correspondance-client',
    label: 'Correspondance client',
    description: 'Lettres papier adressées au client',
    items: correspondanceClient
  },
  {
    id: 'emails-client',
    label: 'Emails — Client',
    description: 'Emails courts du quotidien (remplacent souvent le courrier papier)',
    items: emailsClient
  },
  {
    id: 'emails-confreres-juridictions',
    label: 'Emails — Confrères / juridictions',
    description: 'Emails confraternels et emails au greffe',
    items: emailsConfreresJuridictions
  },
  {
    id: 'convention-honoraires',
    label: 'Convention / honoraires',
    description: "Conventions d'honoraires et lettres de mission",
    items: conventionHonoraires
  },
  {
    id: 'actes-procedure',
    label: 'Actes de procédure',
    description: 'Conclusions, assignations, requêtes',
    items: actesProcedure
  },
  {
    id: 'courriers-confreres',
    label: 'Courriers confrères',
    description: 'Lettres confraternelles officielles',
    items: courriersConfreres
  },
  {
    id: 'courriers-juridictions',
    label: 'Courriers juridictions',
    description: 'Courriers au greffe et aux juridictions',
    items: courriersJuridictions
  },
  {
    id: 'facturation',
    label: 'Facturation',
    description: 'Factures, avoirs et factures rectificatives',
    items: facturation
  },
  {
    id: 'aide-juridictionnelle',
    label: 'Aide juridictionnelle',
    description: 'Désignation, attestation, convention de complément et factures AJ',
    items: aideJuridictionnelle
  }
]

export function getLibraryItem(id: string): TemplateLibraryItem | undefined {
  for (const theme of TEMPLATE_LIBRARY_THEMES) {
    const found = theme.items.find((item) => item.id === id)
    if (found) return found
  }
  return undefined
}
