// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tables } from '@/types/database'
import { painFollowUpNoteSections } from '@/lib/validations/pain-follow-up-note'
import { buildPainFollowUpEditorKey } from '@/lib/clinical/pain-follow-up-editor-key'
const m = vi.hoisted(() => ({ generate: vi.fn(), progress: vi.fn(), error: vi.fn(), status: 'active' }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: m.error } }))
vi.mock('@/components/patients/case-status-context', () => ({ useCaseStatus: () => m.status }))
vi.mock('@/components/clinical/clinical-reset-dialog', () => ({ ClinicalResetDialog: () => <button>Reset</button> }))
vi.mock('@/components/procedures/procedure-order-dialog', () => ({ ProcedureOrderDialog: () => null }))
vi.mock('@/components/clinical/generating-progress', () => ({ GeneratingProgress: (props: unknown) => { m.progress(props); return <p role="status">Generating note</p> } }))
vi.mock('@/actions/pain-follow-up-notes', () => ({ generatePainFollowUpNote: m.generate, savePainFollowUpNote: vi.fn(), savePainFollowUpNoteToneHint: vi.fn(), regeneratePainFollowUpSectionAction: vi.fn(), finalizePainFollowUpNote: vi.fn() }))
import { PainFollowUpEditor } from '../pain-follow-up-editor'
const encounter = { id: 'visit', status: 'in_progress', encounter_date: '2026-09-14' } as Tables<'clinical_encounters'>
const initial = { ...Object.fromEntries(painFollowUpNoteSections.map((section) => [section, 'Draft text'])), id: 'note', case_id: 'case', encounter_id: 'visit', status: 'draft', updated_at: 'v1', tone_hint: 'Stored guidance', procedure_recommendations: [], visit_treatment_decision: null } as unknown as Tables<'pain_follow_up_notes'>
function Host({ note = null, visit = encounter, writable = true }: { note?: typeof initial | null; visit?: typeof encounter; writable?: boolean }) {
  return <PainFollowUpEditor key={buildPainFollowUpEditorKey('case', visit.id, note)} caseId="case" encounter={visit} initialNote={note} episodeWritable={writable} />
}
beforeEach(() => { vi.clearAllMocks(); m.status = 'active'; m.generate.mockResolvedValue({ error: 'Unavailable' }) })
afterEach(cleanup)

describe('follow-up generation states', () => {
  it('shows accessible optional guidance and submits trimmed input', async () => {
    render(<Host />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Tone & Direction (optional)' }), { target: { value: '  Concise  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate Follow-Up Note' }))
    await waitFor(() => expect(m.generate).toHaveBeenCalledWith('case', 'visit', 'Concise'))
    await screen.findByRole('button', { name: 'Generate Follow-Up Note' })
    expect((screen.getByRole('textbox', { name: 'Tone & Direction (optional)' }) as HTMLTextAreaElement).value).toBe('  Concise  ')
  })
  it('shows optimistic progress immediately and prevents another generation', async () => {
    let resolve!: (result: unknown) => void
    m.generate.mockReturnValue(new Promise((yes) => { resolve = yes }))
    render(<Host />)
    fireEvent.click(screen.getByRole('button', { name: 'Generate Follow-Up Note' }))
    expect(screen.getByRole('status').textContent).toBe('Generating note')
    expect(screen.queryByRole('button', { name: 'Generate Follow-Up Note' })).toBeNull()
    expect(m.progress).toHaveBeenCalledWith(expect.objectContaining({ startedAt: expect.any(String), initialProgress: null }))
    await act(async () => { resolve({ error: 'Unavailable' }) })
    expect(m.generate).toHaveBeenCalledOnce()
  })
  it('wires actual persisted progress', () => {
    render(<Host note={{ ...initial, status: 'generating', sections_done: 0, sections_total: 11 }} />)
    expect(m.progress).toHaveBeenCalledWith({ noteId: 'note', realtimeTable: 'pain_follow_up_notes', startedAt: 'v1', initialProgress: { done: 0, total: 11 } })
  })
  it('shows the failure and lets retry explicitly clear persisted guidance', async () => {
    render(<Host note={{ ...initial, status: 'failed', generation_error: 'Upstream unavailable' }} />)
    expect(screen.getByRole('alert').textContent).toContain('Upstream unavailable')
    fireEvent.change(screen.getByRole('textbox', { name: 'Tone & Direction (optional)' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(m.generate).toHaveBeenCalledWith('case', 'visit', null))
  })
  it.each(['scheduled', 'episode', 'case'])('disables generation when locked by %s', (reason) => {
    if (reason === 'case') m.status = 'closed'
    render(<Host visit={reason === 'scheduled' ? { ...encounter, status: 'scheduled' } : encounter} writable={reason !== 'episode'} />)
    expect((screen.getByRole('button', { name: 'Generate Follow-Up Note' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('textbox', { name: 'Tone & Direction (optional)' }) as HTMLTextAreaElement).disabled).toBe(true)
  })
  it('disables finalized content and exposes the existing PDF link', () => {
    render(<Host note={{ ...initial, status: 'finalized', document_id: 'document' }} />)
    expect(screen.queryByRole('textbox', { name: 'Tone & Direction (optional)' })).toBeNull()
    expect((screen.getByRole('textbox', { name: 'Assessment' }) as HTMLTextAreaElement).disabled).toBe(true)
    expect(screen.getByRole('link', { name: 'View finalized PDF' }).getAttribute('href')).toBe('/patients/case/documents')
    expect(screen.queryByRole('button', { name: 'Save Draft' })).toBeNull()
  })
  it('remounts the retained row on reset and initializes guidance for generation', () => {
    const { rerender } = render(<Host note={initial} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Assessment' }), { target: { value: 'Unsaved' } })
    const reset = { ...initial, ...Object.fromEntries(painFollowUpNoteSections.map((section) => [section, null])), updated_at: 'v2' }
    rerender(<Host note={reset} />)
    expect(screen.getByRole('button', { name: 'Generate Follow-Up Note' })).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'Tone & Direction (optional)' }) as HTMLTextAreaElement).value).toBe('Stored guidance')
  })
  it('initializes the draft again after finalized Edit', () => {
    const { rerender } = render(<Host note={{ ...initial, status: 'finalized' }} />)
    rerender(<Host note={{ ...initial, updated_at: 'v2', assessment: 'Reopened text' }} />)
    expect((screen.getByRole('textbox', { name: 'Assessment' }) as HTMLTextAreaElement).value).toBe('Reopened text')
    expect((screen.getByRole('button', { name: 'Save Draft' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
