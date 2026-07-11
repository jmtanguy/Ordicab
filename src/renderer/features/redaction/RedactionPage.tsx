/**
 * « Rédaction assistée » — dossier-level page (sidebar level 2).
 * Shows the drafting workspace when a session is open, otherwise the wizard
 * (resume an active draft / start from one of the five sources).
 */

import React, { useEffect } from 'react'

import { useRedactionStore } from '../../stores/redactionStore'
import { RedactionWizard } from './RedactionWizard'
import { RedactionWorkspace } from './RedactionWorkspace'

export function RedactionPage({ dossierId }: { dossierId: string }): React.JSX.Element {
  const activeSessionId = useRedactionStore((state) => state.activeSessionId)
  const activeDossierId = useRedactionStore((state) => state.activeDossierId)
  const snapshot = useRedactionStore((state) => state.snapshot)
  const pendingOpenSessionId = useRedactionStore((state) => state.pendingOpenSessionId)
  const setPendingOpenSessionId = useRedactionStore((state) => state.setPendingOpenSessionId)
  const loadSessions = useRedactionStore((state) => state.loadSessions)
  const openSession = useRedactionStore((state) => state.openSession)
  const closeWorkspace = useRedactionStore((state) => state.closeWorkspace)

  // Changing dossier closes any workspace belonging to another dossier.
  useEffect(() => {
    if (activeDossierId && activeDossierId !== dossierId) {
      closeWorkspace()
    }
    void loadSessions(dossierId)
  }, [dossierId, activeDossierId, closeWorkspace, loadSessions])

  // Deep-link from the AI assistant (document_augment → drafting session).
  useEffect(() => {
    if (!pendingOpenSessionId) return
    setPendingOpenSessionId(null)
    void openSession(dossierId, pendingOpenSessionId)
  }, [pendingOpenSessionId, dossierId, openSession, setPendingOpenSessionId])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {activeSessionId && snapshot ? (
        <RedactionWorkspace />
      ) : (
        <RedactionWizard dossierId={dossierId} />
      )}
    </div>
  )
}
