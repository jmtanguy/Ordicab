/**
 * coworkInstructionsContent — CLAUDE.md written at the root of a dossier's
 * Cowork/ export so Claude Cowork knows how to work on the pseudonymized
 * workspace: treat identities as real, read dossier.md first, write every
 * deliverable to resultats/.
 *
 * The file deliberately never mentions which fake corresponds to which real
 * identity (it cannot — the mapping stays in .ordicab/, outside the export).
 */

export interface CoworkInstructionsInput {
  /** Pseudonymized dossier name, as it appears in dossier.md. */
  dossierName: string
  exportedAt: string
}

export function buildCoworkInstructions(input: CoworkInstructionsInput): string {
  return `# Espace de travail juridique — ${input.dossierName}

Export généré par Ordicab le ${input.exportedAt}.

## Nature de cet espace

Ce dossier est un espace de travail juridique **pseudonymisé** : toutes les
identités (personnes, organisations, coordonnées, références) ont été
remplacées par des identités fictives cohérentes. Le cabinet restaurera les
identités réelles lors de la réintégration de vos livrables.

Règles impératives :

- **Traitez les identités comme réelles.** Utilisez-les telles quelles dans
  vos analyses et documents, sans les modifier, les abréger ni les
  reformuler. Recopiez chaque nom, adresse, référence et date **verbatim**.
- **Ne cherchez jamais à deviner ou retrouver les identités réelles.**
- Ne signalez pas le caractère fictif des identités dans vos livrables.

## Organisation

- \`dossier.md\` — synthèse du dossier : parties, dates clés, références,
  notes et inventaire des documents. **Lisez ce fichier en premier.**
- \`documents/\` — texte intégral des pièces du dossier, un fichier Markdown
  par document. Les pièces listées comme « non extraites » dans l'inventaire
  ne sont pas incluses.
- \`resultats/\` — votre espace de sortie.

## Vos livrables

- Écrivez **chaque livrable en Markdown** (\`.md\`) directement dans
  \`resultats/\` (pas de sous-dossiers).
- Un fichier par livrable, avec un nom descriptif en français
  (ex. \`analyse-prescription.md\`, \`projet-conclusions.md\`).
- Ne modifiez jamais \`dossier.md\`, \`documents/\` ni ce fichier : ils sont
  régénérés à chaque export et vos changements seraient perdus.
- Ne touchez pas à \`resultats/importes/\` — ce sont les livrables déjà
  réintégrés par le cabinet.
`
}
