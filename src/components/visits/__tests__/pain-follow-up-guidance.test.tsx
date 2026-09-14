// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tables } from '@/types/database'
import { painFollowUpNoteSections } from '@/lib/validations/pain-follow-up-note'
import { buildPainFollowUpEditorKey } from '@/lib/clinical/pain-follow-up-editor-key'
const m = vi.hoisted(() => ({ save: vi.fn(), tone: vi.fn(), regen: vi.fn(), finalize: vi.fn(), refresh: vi.fn(), error: vi.fn(), success: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: m.refresh }) }))
vi.mock('sonner', () => ({ toast: { success: m.success, error: m.error } }))
vi.mock('@/components/patients/case-status-context', () => ({ useCaseStatus: () => 'active' }))
vi.mock('@/components/clinical/clinical-reset-dialog', () => ({ ClinicalResetDialog: ({ disabled }: { disabled: boolean }) => <button disabled={disabled}>Reset</button> }))
vi.mock('@/components/procedures/procedure-order-dialog', () => ({ ProcedureOrderDialog: () => null }))
vi.mock('@/components/clinical/generating-progress', () => ({ GeneratingProgress: () => <p role="status">Generating</p> }))
vi.mock('@/actions/pain-follow-up-notes', () => ({ savePainFollowUpNote: m.save, savePainFollowUpNoteToneHint: m.tone, regeneratePainFollowUpSectionAction: m.regen, finalizePainFollowUpNote: m.finalize, generatePainFollowUpNote: vi.fn() }))
import { PainFollowUpEditor } from '../pain-follow-up-editor'
const encounter = { id: 'visit', status: 'in_progress', encounter_date: '2026-09-14' } as Tables<'clinical_encounters'>
const initial = { ...Object.fromEntries(painFollowUpNoteSections.map((section) => [section, 'Original'])), id: 'note', case_id: 'case', encounter_id: 'visit', status: 'draft', updated_at: 'v1', tone_hint: null, procedure_recommendations: [], visit_treatment_decision: null } as unknown as Tables<'pain_follow_up_notes'>
function Host({ note = initial, writable = true, visit = encounter }: { note?: typeof initial; writable?: boolean; visit?: typeof encounter }) {
  return <PainFollowUpEditor key={buildPainFollowUpEditorKey('case', visit.id, note)} caseId="case" encounter={visit} initialNote={note} episodeWritable={writable} />
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes })
  return { promise, resolve }
}
function changeTone(text = 'Concise') {
  const field = screen.getByRole('textbox', { name: 'Tone & Direction (optional)' })
  fireEvent.change(field, { target: { value: text } })
  return field
}
async function confirmRegen() {
  fireEvent.click(screen.getAllByRole('button', { name: 'Regenerate' })[0])
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Regenerate' }))
}
beforeEach(() => {
  vi.clearAllMocks()
  m.save.mockResolvedValue({ data: { savedNote: { ...initial, updated_at: 'v3' } } })
  m.tone.mockImplementation(async (_case, _visit, tone) => ({ data: { updated_at: 'v2', tone_hint: tone, savedNote: { ...initial, updated_at: 'v2', tone_hint: tone } } }))
  m.regen.mockResolvedValue({ data: { savedNote: { ...initial, updated_at: 'v3', subjective: 'Regenerated' } } })
  m.finalize.mockResolvedValue({ data: { success: true } })
})
afterEach(cleanup)

describe('guidance and draft mutation ordering', () => {
  it('does not write on mount and flushes guidance before save', async () => {
    render(<Host />)
    expect(m.tone).not.toHaveBeenCalled()
    changeTone('  Concise  ')
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
    await waitFor(() => expect(m.save).toHaveBeenCalled())
    expect(m.tone).toHaveBeenCalledWith('case', 'visit', 'Concise', { noteId: 'note', expectedUpdatedAt: 'v1' })
    expect(m.save.mock.calls[0][1].expected_updated_at).toBe('v2')
    expect(m.refresh).not.toHaveBeenCalled()
  })
  it('waits for pending blur, preserves local edits through refreshed props, then signs the saved version', async () => {
    const pending = deferred<unknown>()
    m.tone.mockReturnValueOnce(pending.promise)
    const { rerender } = render(<Host />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Assessment' }), { target: { value: 'Local assessment' } })
    fireEvent.blur(changeTone())
    fireEvent.click(screen.getByRole('button', { name: 'Finalize & Complete Visit' }))
    await waitFor(() => expect(m.tone).toHaveBeenCalledOnce())
    expect(m.save).not.toHaveBeenCalled()
    const saved = { ...initial, updated_at: 'v2', tone_hint: 'Concise' }
    rerender(<Host note={saved} />)
    expect((screen.getByRole('textbox', { name: 'Assessment' }) as HTMLTextAreaElement).value).toBe('Local assessment')
    await act(async () => { pending.resolve({ data: { updated_at: 'v2', tone_hint: 'Concise', savedNote: saved } }) })
    await waitFor(() => expect(m.finalize).toHaveBeenCalledWith('case', 'visit', 'v3'))
    expect(m.save.mock.calls[0][1]).toMatchObject({ assessment: 'Local assessment', expected_updated_at: 'v2' })
    expect(m.tone).toHaveBeenCalledOnce()
  })
  it('aborts an action waiting on failed blur and allows a later retry', async () => {
    const pending = deferred<unknown>()
    m.tone.mockReturnValueOnce(pending.promise)
    render(<Host />)
    fireEvent.blur(changeTone())
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
    await act(async () => { pending.resolve({ error: 'Tone conflict' }) })
    await waitFor(() => expect(m.error).toHaveBeenCalledWith('Tone conflict'))
    expect(m.save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
    await waitFor(() => expect(m.save).toHaveBeenCalledOnce())
    expect(m.tone).toHaveBeenCalledTimes(2)
  })
  it('acknowledges own guidance baseline and ignores delayed old props', async () => {
    const { rerender } = render(<Host />)
    fireEvent.blur(changeTone())
    await waitFor(() => expect(m.tone).toHaveBeenCalledOnce())
    await act(async () => {})
    rerender(<Host note={{ ...initial, tone_hint: 'Concise', updated_at: 'v4' }} />)
    rerender(<Host note={initial} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
    await waitFor(() => expect(m.save).toHaveBeenCalledOnce())
    expect(m.save.mock.calls[0][1].expected_updated_at).toBe('v4')
  })
  it.each(['assessment', 'tone_hint'])('does not adopt an external %s edit as a new save version', async (field) => {
    m.save.mockResolvedValue({ error: 'Note changed. Reload before saving' })
    const { rerender } = render(<Host />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Assessment' }), { target: { value: 'My unsaved text' } })
    rerender(<Host note={{ ...initial, [field]: 'External edit', updated_at: 'v8' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
    await waitFor(() => expect(m.save).toHaveBeenCalled())
    expect(m.save.mock.calls[0][1].expected_updated_at).toBe('v1')
    expect((screen.getByRole('textbox', { name: 'Assessment' }) as HTMLTextAreaElement).value).toBe('My unsaved text')
  })
  it('clears stored guidance explicitly', async () => {
    render(<Host note={{ ...initial, tone_hint: 'Previous' }} />)
    fireEvent.blur(changeTone(''))
    await waitFor(() => expect(m.tone).toHaveBeenCalledWith('case', 'visit', null, expect.any(Object)))
  })
  it('rejects an unconfirmed tone row before saving a draft', async () => {
    m.tone.mockResolvedValue({ data: { updated_at: 'v2', tone_hint: 'Concise' } })
    render(<Host />)
    changeTone()
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
    await waitFor(() => expect(m.error).toHaveBeenCalledWith('Unable to confirm the saved tone version. Reload the note.'))
    expect(m.save).not.toHaveBeenCalled()
  })
  it.each(['lock', 'unmount', 'encounter'])('skips queued save after %s', async (kind) => {
    const pending = deferred<unknown>()
    m.tone.mockReturnValueOnce(pending.promise)
    const { rerender, unmount } = render(<Host />)
    fireEvent.blur(changeTone())
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
    await waitFor(() => expect(m.tone).toHaveBeenCalled())
    if (kind === 'lock') rerender(<Host writable={false} />)
    else if (kind === 'unmount') unmount()
    else rerender(<Host visit={{ ...encounter, id: 'other' }} note={{ ...initial, encounter_id: 'other', id: 'other-note' }} />)
    await act(async () => { pending.resolve({ data: { updated_at: 'v2', tone_hint: 'Concise', savedNote: { ...initial, updated_at: 'v2', tone_hint: 'Concise' } } }) })
    expect(m.save).not.toHaveBeenCalled()
  })
})

describe('section replacement', () => {
  it('requires confirmation and leaves content intact when cancelled', async () => {
    render(<Host />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Regenerate' })[0])
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    expect(m.regen).not.toHaveBeenCalled()
  })
  it('flushes guidance and replaces only one local section, then saves that version', async () => {
    const { rerender } = render(<Host />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Assessment' }), { target: { value: 'Unsaved assessment' } })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'declined' } })
    changeTone()
    await confirmRegen()
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Subjective' }) as HTMLTextAreaElement).value).toBe('Regenerated'))
    expect(m.regen).toHaveBeenCalledWith('case', 'visit', 'subjective', undefined, 'v2')
    rerender(<Host note={{ ...initial, updated_at: 'v2', tone_hint: 'Concise' }} />)
    expect((screen.getByRole('textbox', { name: 'Assessment' }) as HTMLTextAreaElement).value).toBe('Unsaved assessment')
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('declined')
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
    await waitFor(() => expect(m.save).toHaveBeenCalledOnce())
    expect(m.save.mock.calls[0][1]).toMatchObject({ expected_updated_at: 'v3', subjective: 'Regenerated', assessment: 'Unsaved assessment' })
  })
  it('retains local content on regeneration failure', async () => {
    m.regen.mockResolvedValue({ error: 'Generation failed' })
    render(<Host />)
    await confirmRegen()
    await waitFor(() => expect(m.error).toHaveBeenCalledWith('Generation failed'))
    expect((screen.getByRole('textbox', { name: 'Subjective' }) as HTMLTextAreaElement).value).toBe('Original')
  })
})
