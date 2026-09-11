import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { createMockSupabase } from '@/test-utils/supabase-mock'
import { saveVisitDecision } from '../save-visit-decision'

const selector = { column: 'visit_type', value: 'initial_visit' } as const
const values = { treatment_plan: 'Exercise', patient_education: 'Exercise reviewed.', expected_updated_at: 'v1', treatment_decision: { decision: 'accepted', details: null } } as const

describe('explicit visit decision saves', () => {
  it('does not turn a missing decision or version into default acceptance', async () => {
    const mock = createMockSupabase()
    const client = mock as unknown as SupabaseClient<Database>
    expect(await saveVisitDecision(client, 'initial_visit_notes', 'case', selector, {})).toHaveProperty('error')
    expect(await saveVisitDecision(client, 'initial_visit_notes', 'case', selector, { treatment_decision: values.treatment_decision })).toHaveProperty('error')
    expect(mock.from).not.toHaveBeenCalled()
    expect(mock.rpc).not.toHaveBeenCalled()
  })
  it('atomically sends only reviewed fields and clinician selection for the exact draft', async () => {
    const mock = createMockSupabase({ data: { id: 'note' }, error: null })
    mock.rpc.mockResolvedValue({ data: { id: 'note', updated_at: 'v2' }, error: null })
    const result = await saveVisitDecision(mock as unknown as SupabaseClient<Database>, 'initial_visit_notes', 'case', selector, values)
    expect(mock._builder.eq.mock.calls).toEqual(expect.arrayContaining([['case_id', 'case'], ['visit_type', 'initial_visit'], ['status', 'draft']]))
    expect(mock.rpc).toHaveBeenCalledWith('save_visit_note_decision', {
      p_kind: 'initial_visit_notes', p_note_id: 'note', p_case_id: 'case', p_expected_updated_at: 'v1',
      p_patch: { treatment_plan: 'Exercise', patient_education: 'Exercise reviewed.' }, p_decision: values.treatment_decision,
    })
    expect(result).toEqual({ savedNote: { id: 'note', updated_at: 'v2' } })
  })
  it('propagates a stale-save failure without reporting a saved decision', async () => {
    const mock = createMockSupabase({ data: { id: 'note' }, error: null })
    mock.rpc.mockResolvedValue({ data: null, error: { message: 'Note changed. Reload before saving' } })
    expect(await saveVisitDecision(mock as unknown as SupabaseClient<Database>, 'initial_visit_notes', 'case', selector, values)).toEqual({ error: 'Note changed. Reload before saving' })
  })
})
