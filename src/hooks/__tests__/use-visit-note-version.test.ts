// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useVisitNoteVersion } from '../use-visit-note-version'

describe('visit editor version refresh', () => {
  it('acknowledges tone-only updates but never unrelated narrative changes', () => {
    const setVersion = vi.fn()
    const original = { id: 'note', updated_at: 'v1', treatment_plan: 'Exercise', tone_hint: '' }
    const { rerender } = renderHook(({ note }) => useVisitNoteVersion(note, ['treatment_plan'], setVersion), { initialProps: { note: original } })
    rerender({ note: { ...original, updated_at: 'v2', tone_hint: 'Concise' } })
    expect(setVersion).toHaveBeenLastCalledWith('v2')
    setVersion.mockClear()
    rerender({ note: { ...original, updated_at: 'v3', treatment_plan: 'Injection' } })
    expect(setVersion).not.toHaveBeenCalled()
  })
  it('uses an explicitly saved response as the next baseline', () => {
    const setVersion = vi.fn()
    const original = { id: 'note', updated_at: 'v1', patient_education: 'Discuss exercise' }
    const { result, rerender } = renderHook(({ note }) => useVisitNoteVersion(note, ['patient_education'], setVersion), { initialProps: { note: original } })
    const saved = { ...original, updated_at: 'v2', patient_education: 'Exercise reviewed. Patient agreed.' }
    act(() => result.current.acknowledgeSavedNote(saved))
    rerender({ note: { ...saved, updated_at: 'v3' } })
    expect(setVersion).toHaveBeenLastCalledWith('v3')
  })
})

it.each(['metadata', 'full'])('ignores delayed superseded props after %s acknowledgement', (kind) => {
  const setVersion = vi.fn()
  const original = { id: 'note', updated_at: 'v1', patient_education: 'Reviewed' }
  const { result, rerender } = renderHook(({ note }) => useVisitNoteVersion(note, ['patient_education'], setVersion), { initialProps: { note: original } })
  act(() => {
    result.current.acknowledgeMetadataVersion('v1', 'v2')
    if (kind === 'full') result.current.acknowledgeSavedNote({ ...original, updated_at: 'v3' })
    else result.current.acknowledgeMetadataVersion('v2', 'v3')
  })
  setVersion.mockClear()
  rerender({ note: { ...original, updated_at: 'v2' } })
  expect(setVersion).not.toHaveBeenCalled()
  rerender({ note: { ...original, updated_at: 'v4' } })
  expect(setVersion).toHaveBeenLastCalledWith('v4')
  setVersion.mockClear()
  rerender({ note: { ...original, updated_at: 'v5', patient_education: 'Someone else edited this' } })
  expect(setVersion).not.toHaveBeenCalled()
})
