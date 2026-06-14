/**
 * conflictCheckService — conflict-of-interest check (vérification des
 * conflits d'intérêts) across registered dossiers.
 *
 * Given a contact name and the dossier it belongs to, scans the contacts of
 * every OTHER registered dossier for a person with a matching name. The pure
 * matching/normalization rules live in src/shared/domain/conflictCheck.ts.
 *
 * Called by: contactHandler (contact:check-conflicts IPC channel)
 */
import { computeContactDisplayName } from '@shared/computeContactDisplayName'
import type { ConflictCheckInput, ConflictMatch, ContactRecord } from '@shared/types'
import {
  compareConflictMatches,
  evaluateNameConflict,
  normalizeNameForConflictCheck
} from '@shared/domain/conflictCheck'

import type { DocumentService } from './documentService'
import type { DossierRegistryService } from './dossierRegistryService'
import { readContactsForDossierPath } from './contactService'

export interface ConflictCheckService {
  check(input: ConflictCheckInput): Promise<ConflictMatch[]>
}

export function createConflictCheckService(options: {
  dossierRegistryService: DossierRegistryService
  documentService: DocumentService
}): ConflictCheckService {
  const { dossierRegistryService, documentService } = options

  return {
    async check(input: ConflictCheckInput): Promise<ConflictMatch[]> {
      // Both match rules require a last name — nothing to compare without one.
      if (!normalizeNameForConflictCheck(input.lastName)) {
        return []
      }

      const dossiers = await dossierRegistryService.listRegisteredDossiers()
      const otherDossiers = dossiers.filter(
        (dossier) => dossier.slug !== input.dossierId && dossier.uuid !== input.dossierId
      )

      const matchesPerDossier = await Promise.all(
        otherDossiers.map(async (dossier): Promise<ConflictMatch[]> => {
          let contacts: ContactRecord[]
          try {
            const dossierPath = await documentService.resolveRegisteredDossierRoot({
              dossierId: dossier.slug
            })
            contacts = await readContactsForDossierPath(dossierPath)
          } catch {
            // The check is advisory: skip dossiers whose contacts cannot be read.
            return []
          }

          return contacts.flatMap((contact) => {
            const matchKind = evaluateNameConflict(input, contact)
            if (!matchKind) {
              return []
            }

            return [
              {
                dossierId: dossier.slug,
                dossierName: dossier.name,
                contactUuid: contact.uuid,
                contactDisplayName: computeContactDisplayName(contact),
                contactRole: contact.role,
                matchKind
              }
            ]
          })
        })
      )

      return matchesPerDossier.flat().sort(compareConflictMatches)
    }
  }
}
