'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { FieldValues, UseFormReturn } from 'react-hook-form'
import { toast } from 'sonner'
import { saveProviderIntake } from '@/actions/initial-visit-notes'
import { defaultProviderIntake, type ProviderIntakeValues } from '@/lib/validations/initial-visit-note'
import type { NoteVisitType } from '@/lib/claude/generate-initial-visit'

type Draft = { dirty: boolean; saving: boolean; save: () => Promise<boolean>; read?: () => unknown }
type DraftContext = {
  dirty: boolean
  busy: boolean
  flush: (onFailure?: (section: string) => void) => Promise<boolean>
  register: (key: string, value: Draft) => () => void
  readSection: (key: keyof ProviderIntakeValues) => unknown
}
const IntakeDraftContext = createContext<DraftContext | null>(null)

export function IntakeDraftProvider({ children }: { children: ReactNode }) {
  const drafts = useRef(new Map<string, Draft>())
  const [revision, setRevision] = useState(0)
  const [flushing, setFlushing] = useState(false)
  const register = useCallback((key: string, value: Draft) => {
    drafts.current.set(key, value)
    setRevision(v => v + 1)
    return () => { drafts.current.delete(key); setRevision(v => v + 1) }
  }, [])
  const readSection = useCallback((key: keyof ProviderIntakeValues) => drafts.current.get(key)?.read?.(), [])
  const flush = useCallback(async (onFailure?: (section: string) => void) => {
    setFlushing(true)
    try {
      // Sequential writes avoid racing the note's optimistic version check.
      for (const [section, draft] of [...drafts.current.entries()]) {
        if ((draft.dirty || draft.saving) && !await draft.save()) {
          onFailure?.(section)
          return false
        }
      }
      return true
    } finally { setFlushing(false) }
  }, [])
  const value = useMemo(() => {
    void revision
    return {
      register, flush, readSection,
      dirty: [...drafts.current.values()].some(d => d.dirty),
      busy: flushing || [...drafts.current.values()].some(d => d.saving),
    }
  }, [revision, flushing, register, flush, readSection])

  useEffect(() => {
    if (!value.dirty && !value.busy) return
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const beforeNavigate = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!anchor || anchor.getAttribute('href')?.startsWith('#')) return
      if (!window.confirm('Unsaved intake changes will be lost. Leave this page?')) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', beforeNavigate, true)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', beforeNavigate, true)
    }
  }, [value.dirty, value.busy])

  return <IntakeDraftContext.Provider value={value}>
    <fieldset disabled={value.busy} className="min-w-0 border-0 p-0 m-0" aria-busy={value.busy}>{children}</fieldset>
  </IntakeDraftContext.Provider>
}

export function useIntakeDrafts() {
  const context = useContext(IntakeDraftContext)
  if (!context) throw new Error('IntakeDraftProvider is required')
  return context
}

export function useIntakeSectionSave<T extends FieldValues>(
  form: UseFormReturn<T>, caseId: string, visitType: NoteVisitType,
  section: keyof ProviderIntakeValues, initialIntake: ProviderIntakeValues | null,
) {
  const { register } = useIntakeDrafts()
  const { isDirty } = form.formState
  const [isSaving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasSaved, setHasSaved] = useState(false)
  const inFlight = useRef<Promise<boolean> | null>(null)
  const save = useCallback((): Promise<boolean> => {
    if (inFlight.current) return inFlight.current
    const operation = async () => {
      setSaving(true)
      setError(null)
      try {
        if (!await form.trigger()) return false
        const values = form.getValues()
        const full = { ...defaultProviderIntake, ...initialIntake, [section]: values[section] }
        const result = await saveProviderIntake(caseId, visitType, full, section)
        if (result.error) throw new Error(result.error)
        form.reset(values)
        setHasSaved(true)
        toast.success('Intake section saved')
        return true
      } catch (failure) {
        const message = failure instanceof Error ? failure.message : 'Save failed. Please retry.'
        setError(message)
        toast.error(message)
        return false
      } finally { setSaving(false); inFlight.current = null }
    }
    inFlight.current = operation()
    return inFlight.current
  }, [form, caseId, visitType, section, initialIntake])
  const read = useCallback(() => form.getValues()[section], [form, section])
  useEffect(() => register(section, { dirty: isDirty, saving: isSaving, save, read }), [register, section, isDirty, isSaving, save, read])
  return { isSaving, error, save, isDirty, hasSaved }
}
