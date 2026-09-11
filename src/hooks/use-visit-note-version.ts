'use client'

import { useEffect, useRef } from 'react'

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
  useEffect(() => {
    if (currentFingerprint === baseline.current) setVersion(version)
  }, [currentFingerprint, version, setVersion])
  return (saved: object) => { baseline.current = fingerprint(saved) }
}
