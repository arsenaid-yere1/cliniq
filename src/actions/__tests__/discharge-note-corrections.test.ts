import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockQueryBuilder, createMockSupabase, type MockSupabaseClient } from '@/test-utils/supabase-mock'
import { TEST_CASE_ID } from '@/test-utils/fixtures'

const EPISODE_ID = '110e8400-e29b-41d4-a716-446655440000'
const NOTE_ID = '220e8400-e29b-41d4-a716-446655440000'
const CORRECTION_ID = '330e8400-e29b-41d4-a716-446655440000'
const DOCUMENT_ID = '440e8400-e29b-41d4-a716-446655440000'

let mockSupabase: MockSupabaseClient & {
  storage: { from: ReturnType<typeof vi.fn> }
}
const upload = vi.fn()
const remove = vi.fn()

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(() => mockSupabase) }))
vi.mock('@/lib/pdf/render-discharge-note-pdf', () => ({
  renderDischargeNotePdf: vi.fn(async () => Buffer.from('corrected discharge pdf')),
}))

import {
  beginDischargeCorrection,
  finalizeDischargeCorrection,
  saveDischargeCorrection,
} from '../discharge-notes'

const validEdit = {
  visit_date: '2026-08-20',
  subjective: 'Subjective correction',
  objective_vitals: 'Vitals correction',
  objective_general: 'General correction',
  objective_cervical: 'Cervical correction',
  objective_lumbar: 'Lumbar correction',
  objective_neurological: 'Neurological correction',
  diagnoses: 'Diagnosis correction',
  assessment: 'Assessment correction',
  plan_and_recommendations: 'Plan correction',
  patient_education: 'Education correction',
  prognosis: 'Prognosis correction',
  clinician_disclaimer: 'Disclaimer correction',
}

describe('audited discharge correction actions', () => {
  beforeEach(() => {
    const base = createMockSupabase()
    mockSupabase = Object.assign(base, {
      storage: {
        from: vi.fn(() => ({ upload, remove })),
      },
    })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'users') {
        return createMockQueryBuilder({ data: { role: 'admin', is_active: true }, error: null })
      }
      if (table === 'cases') {
        return createMockQueryBuilder({
          data: { assigned_provider_id: 'test-user-id', case_status: 'closed' },
          error: null,
        })
      }
      if (table === 'discharge_notes') {
        return createMockQueryBuilder({
          data: {
            id: NOTE_ID,
            episode_id: EPISODE_ID,
            encounter_id: '550e8400-e29b-41d4-a716-446655440000',
            status: 'draft',
            pain_score_max: 4,
          },
          error: null,
        })
      }
      if (table === 'discharge_note_corrections') {
        return createMockQueryBuilder({
          data: { id: CORRECTION_ID, revision_number: 2, status: 'open' },
          error: null,
        })
      }
      if (table === 'documents') {
        return createMockQueryBuilder({ data: { id: DOCUMENT_ID }, error: null })
      }
      return createMockQueryBuilder()
    })
    upload.mockResolvedValue({ error: null })
    remove.mockResolvedValue({ error: null })
    vi.clearAllMocks()
  })

  it('rejects a correction reason shorter than ten characters', async () => {
    const result = await beginDischargeCorrection(TEST_CASE_ID, EPISODE_ID, NOTE_ID, 'typo')
    expect(result.error).toContain('at least 10 characters')
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })

  it('begins an admin correction on a locked case through the guarded RPC', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: CORRECTION_ID, error: null })
    const result = await beginDischargeCorrection(
      TEST_CASE_ID,
      EPISODE_ID,
      NOTE_ID,
      'Correct the discharge diagnosis text',
    )
    expect(result).toEqual({ data: { correctionId: CORRECTION_ID } })
    expect(mockSupabase.rpc).toHaveBeenCalledWith('begin_discharge_correction', {
      p_case_id: TEST_CASE_ID,
      p_episode_id: EPISODE_ID,
      p_note_id: NOTE_ID,
      p_reason: 'Correct the discharge diagnosis text',
    })
  })

  it('saves only through the correction RPC with explicit ownership IDs', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: NOTE_ID, error: null })
    const result = await saveDischargeCorrection(
      TEST_CASE_ID,
      EPISODE_ID,
      NOTE_ID,
      CORRECTION_ID,
      validEdit,
    )
    expect(result).toEqual({ data: { success: true } })
    expect(mockSupabase.rpc).toHaveBeenCalledWith('save_discharge_correction', expect.objectContaining({
      p_case_id: TEST_CASE_ID,
      p_episode_id: EPISODE_ID,
      p_note_id: NOTE_ID,
      p_correction_id: CORRECTION_ID,
      p_values: validEdit,
    }))
  })

  it('removes only the uncommitted replacement when correction finalization fails', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Remove this discharge visit from its invoice before finalizing the correction' },
    })
    const result = await finalizeDischargeCorrection(
      TEST_CASE_ID,
      EPISODE_ID,
      NOTE_ID,
      CORRECTION_ID,
    )
    expect(result.error).toContain('Remove this discharge visit')
    expect(upload).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledOnce()
    expect(remove.mock.calls[0][0][0]).toMatch(/discharge-correction-.*-v2-/)
  })
})
