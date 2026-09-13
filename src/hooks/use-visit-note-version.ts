'use client'

import { useCallback, useEffect, useRef } from 'react'

/** Only non-narrative refreshes may advance the editor's save version.
 * External narrative/decision edits still require reload; local unsaved text is retained. */
export function useVisitNoteVersion(note: object, fields: readonly string[], setVersion: (version: string) => void) {
  const fingerprint = (value: object) => {
    const row = value as Record<string, unknown>
    return JSON.stringify([...fields, 'id', 'status', 'deleted_at', 'visit_date', 'visit_treatment_decision', 'prp_target_recommendations', 'procedure_recommendations'].map((key) => row[key] ?? null))
  }
  const currentFingerprint = fingerprint(note)
  const baseline = useRef(currentFingerprint)
  const version = (note as { updated_at: string }).updated_at
  const acknowledged = useRef(version)
  const superseded = useRef(new Set<string>())
  const acceptVersion = useCallback((next: string) => {
    if (superseded.current.has(next)) return
    if (acknowledged.current !== next) superseded.current.add(acknowledged.current)
    acknowledged.current = next
    setVersion(next)
  }, [setVersion])
  useEffect(() => {
    if (currentFingerprint === baseline.current) acceptVersion(version)
  }, [currentFingerprint, version, acceptVersion])

  return {
    acknowledgeSavedNote(saved: object) {
      baseline.current = fingerprint(saved)
      acceptVersion((saved as { updated_at: string }).updated_at)
    },
    acknowledgeMetadataVersion(expected: string, saved: string) {
      if (expected !== saved) superseded.current.add(expected)
      acceptVersion(saved)
    },
  }
}
