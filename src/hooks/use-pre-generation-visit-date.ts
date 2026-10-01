'use client'

import { useCallback, useEffect, useMemo, useReducer } from 'react'
import { savePreGenerationVisitDate } from '@/actions/visit-date'
import { useVisitUnsavedChanges } from '@/components/visits/visit-unsaved-changes-context'
import { persistedVisitDateSchema, type PreGenerationVisitKind, type VisitDateSaveResult, type VisitDateToken } from '@/lib/validations/visit-date'

type Options = {
  caseId: string; episodeId?: string; kind: PreGenerationVisitKind; enabled: boolean
  noteId?: string; visitDate?: string | null; updatedAt?: string | null
  min?: string | null; max?: string | null
}

export function usePreGenerationVisitDate(options: Options) {
  const scope = `${options.caseId}:${options.episodeId ?? ''}:${options.kind}`
  const [, render] = useReducer((v: number) => v + 1, 0)
  // One controller per visit identity; old completions may not touch a new visit.
  const model = useMemo(() => ({
    value: options.visitDate ?? new Date().toISOString().slice(0, 10),
    baseline: options.visitDate ?? new Date().toISOString().slice(0, 10),
    token: options.noteId && options.visitDate ? { noteId: options.noteId, visitDate: options.visitDate, updatedAt: options.updatedAt ?? '' } : null as VisitDateToken | null,
    observedNoteId: options.noteId ?? null,
    observedDate: options.visitDate ?? null,
    revision: 0, savedRevision: 0, active: true, enabled: options.enabled,
    pending: null as Promise<VisitDateSaveResult> | null,
    failure: null as Exclude<VisitDateSaveResult, { data: VisitDateToken }> | null,
    bounds: { min: options.min, max: options.max },
    caseId: options.caseId, episodeId: options.episodeId, kind: options.kind,
    // Scope changes intentionally initialize a fresh controller from current props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [scope])
  useEffect(() => { model.active = true; return () => { model.active = false } }, [model])
  useEffect(() => {
    model.enabled = options.enabled
    model.bounds = { min: options.min, max: options.max }
    if (model.pending || model.value !== model.baseline || model.failure) return
    if (!options.noteId || !options.visitDate) return
    // Revalidation from a save that started earlier cannot move the token backward.
    if (model.token?.noteId === options.noteId && model.token.updatedAt
      && (!options.updatedAt || options.updatedAt <= model.token.updatedAt)) return
    model.token = { noteId: options.noteId, visitDate: options.visitDate, updatedAt: options.updatedAt ?? '' }
    model.observedNoteId = options.noteId
    model.observedDate = options.visitDate
    model.value = model.baseline = options.visitDate
    render()
  }, [model, options.enabled, options.min, options.max, options.noteId, options.visitDate, options.updatedAt])

  const change = useCallback((value: string) => {
    if (!model.enabled || !model.active) return
    model.value = value; model.revision += 1
    // Keep a conflict visible until the user explicitly adopts its canonical token.
    if (model.failure?.code !== 'conflict') model.failure = null
    render()
  }, [model])

  const save = useCallback((): Promise<VisitDateSaveResult> => {
    if (model.pending) return model.pending
    if (!model.enabled || !model.active || !model.episodeId) {
      return Promise.resolve({ code: 'locked', error: 'Reload this visit before saving its date.' })
    }
    if (model.failure?.code === 'conflict') return Promise.resolve(model.failure)
    if (model.token && model.value === model.token.visitDate && !model.failure) return Promise.resolve({ data: model.token })
    const valid = persistedVisitDateSchema.safeParse(model.value)
    let message = valid.success ? null : valid.error.issues[0]?.message ?? 'Enter a valid date'
    if (!message && model.bounds.min && model.value < model.bounds.min) message = 'Visit date cannot precede the earliest allowed date.'
    if (!message && model.bounds.max && model.value > model.bounds.max) message = 'Visit date cannot exceed the latest allowed date.'
    if (message) {
      model.failure = { code: 'invalid_date', error: message }; render()
      return Promise.resolve(model.failure)
    }
    const value = model.value; const revision = model.revision
    const request = { caseId: model.caseId, episodeId: model.episodeId, kind: model.kind, visitDate: value,
      expectedNoteId: model.token?.noteId ?? model.observedNoteId,
      expectedDate: model.token?.visitDate ?? model.observedDate ?? model.baseline }
    model.failure = null
    model.pending = Promise.resolve().then(() => savePreGenerationVisitDate(request)).catch((): VisitDateSaveResult => (
      { code: 'save_failed', error: 'Unable to save the visit date. Retry saving.' }
    )).then(result => {
      if (!model.active) return result
      if (result.data) {
        model.token = result.data; model.baseline = result.data.visitDate; model.savedRevision = revision
        model.observedNoteId = result.data.noteId; model.observedDate = result.data.visitDate
      } else model.failure = result
      return result
    }).finally(() => { model.pending = null; if (model.active) render() })
    render()
    return model.pending
  }, [model])

  const flush = useCallback(async (): Promise<VisitDateSaveResult> => {
    // Await an already-started blur failure; never silently retry it for Generate.
    let result = model.failure ?? await save()
    while (result.data && model.active && model.enabled && model.value !== result.data.visitDate) result = await save()
    return result
  }, [model, save])
  const useSaved = useCallback(() => {
    const token = model.failure?.conflict
    if (!token || !model.enabled) return
    model.token = token; model.value = model.baseline = token.visitDate
    model.observedNoteId = token.noteId; model.observedDate = token.visitDate
    model.failure = null; model.revision += 1; render()
  }, [model])
  const keepMine = useCallback(() => {
    const token = model.failure?.conflict
    if (!token || !model.enabled) return Promise.resolve(undefined)
    model.token = token; model.baseline = token.visitDate; model.failure = null
    return save()
  }, [model, save])
  const dirty = model.value !== model.baseline || Boolean(model.failure)
  useVisitUnsavedChanges(options.enabled && dirty, options.enabled && Boolean(model.pending))
  return {
    value: model.value, change, save, flush, useSaved, keepMine, dirty,
    blur: () => { if (model.value !== model.baseline || model.pending || model.failure) return save() },
    saving: Boolean(model.pending), error: model.failure?.error,
    conflict: model.failure?.conflict,
    status: model.pending ? 'Saving date…' : model.failure ? 'Date not saved' : dirty ? 'Unsaved date' : model.token ? 'Date saved' : 'Not saved yet',
  }
}
