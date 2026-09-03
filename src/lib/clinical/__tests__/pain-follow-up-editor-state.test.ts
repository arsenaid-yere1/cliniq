import { describe, expect, it } from 'vitest'
import {
  getPainFollowUpEditorState,
  type PainFollowUpEditorNote,
} from '../pain-follow-up-editor-state'
import { painFollowUpNoteSections } from '@/lib/validations/pain-follow-up-note'

function note(overrides: Partial<PainFollowUpEditorNote> = {}): PainFollowUpEditorNote {
  return {
    status: 'draft',
    procedure_recommendations: [],
    ...Object.fromEntries(painFollowUpNoteSections.map((section) => [section, null])),
    ...overrides,
  }
}

describe('getPainFollowUpEditorState', () => {
  it('treats a missing note as empty', () => {
    expect(getPainFollowUpEditorState(null)).toBe('empty')
  })

  it('treats null and whitespace-only draft sections as empty', () => {
    expect(getPainFollowUpEditorState(note({ subjective: '   ' }))).toBe('empty')
  })

  it.each(painFollowUpNoteSections)('detects %s as draft content', (section) => {
    expect(getPainFollowUpEditorState(note({ [section]: 'content' }))).toBe('draft')
  })

  it('treats recommendations as draft content', () => {
    expect(getPainFollowUpEditorState(note({ procedure_recommendations: [{}] }))).toBe('draft')
  })

  it.each(['generating', 'failed', 'finalized'] as const)(
    'gives %s status precedence over content',
    (status) => {
      expect(getPainFollowUpEditorState(note({ status, subjective: 'stale content' }))).toBe(status)
    },
  )

  it('ignores unrelated generation metadata', () => {
    expect(getPainFollowUpEditorState({
      ...note(),
      generation_error: 'old error',
      source_data_hash: 'hash',
      sections_done: 11,
    } as PainFollowUpEditorNote)).toBe('empty')
  })
})
