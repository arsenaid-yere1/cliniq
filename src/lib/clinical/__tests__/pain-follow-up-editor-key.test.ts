import { describe, expect, it } from 'vitest'
import { buildPainFollowUpEditorKey } from '../pain-follow-up-editor-key'

describe('buildPainFollowUpEditorKey', () => {
  it('changes when a generated note first becomes available', () => {
    const emptyKey = buildPainFollowUpEditorKey(null)
    const generatedKey = buildPainFollowUpEditorKey({
      id: 'note-1',
      updated_at: '2026-08-27T17:10:00Z',
    })

    expect(generatedKey).not.toBe(emptyKey)
  })

  it('changes when persisted note content is regenerated', () => {
    const before = buildPainFollowUpEditorKey({
      id: 'note-1',
      updated_at: '2026-08-27T17:10:00Z',
    })
    const after = buildPainFollowUpEditorKey({
      id: 'note-1',
      updated_at: '2026-08-27T17:11:00Z',
    })

    expect(after).not.toBe(before)
  })

  it('stays stable during unrelated route refreshes', () => {
    const note = { id: 'note-1', updated_at: '2026-08-27T17:10:00Z' }
    expect(buildPainFollowUpEditorKey(note)).toBe(buildPainFollowUpEditorKey(note))
  })
})
