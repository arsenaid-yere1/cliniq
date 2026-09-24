import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockQueryBuilder, createMockSupabase } from '@/test-utils/supabase-mock'
import type { BotoxProcedureFormValues } from '@/lib/validations/botox-procedure'

const mocks = vi.hoisted(() => ({ client: vi.fn(), episode: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }))
vi.mock('@/lib/clinical/episode-context', () => ({ getActiveOrLatestEpisode: mocks.episode }))
vi.mock('@/actions/case-status', () => ({ assertCaseNotClosed: vi.fn(async () => ({ error: null })), autoAdvanceFromIntake: vi.fn() }))
vi.mock('@/lib/features/return-tele-visits', () => ({ requireReturnTeleVisitsMutation: vi.fn(() => null) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { getCaseDiagnoses, updateBotoxProcedure } from '../procedures'

describe('procedure evaluation Episode scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.episode.mockResolvedValue({ id: 'episode-2' })
  })

  it('uses the current Episode for diagnosis suggestions', async () => {
    const client = createMockSupabase()
    mocks.client.mockResolvedValue(client)
    const notes = createMockQueryBuilder({ data: [{ visit_type: 'pain_evaluation_visit', diagnoses: 'M54.2 - Cervicalgia' }], error: null })
    client.from.mockImplementation(table => table === 'initial_visit_notes' ? notes : createMockQueryBuilder())

    const result = await getCaseDiagnoses('case-1')

    expect(notes.eq).toHaveBeenCalledWith('episode_id', 'episode-2')
    expect(result.data.some(diagnosis => diagnosis.icd10_code === 'M54.2')).toBe(true)
  })

  it('checks an older procedure date against its own Episode, not the current Episode', async () => {
    const client = createMockSupabase()
    mocks.client.mockResolvedValue(client)
    const procedure = createMockQueryBuilder({ data: { id: 'procedure-1', procedure_number: 1, episode_id: 'episode-1' }, error: null })
    const notes = createMockQueryBuilder({ data: [{ visit_date: '2026-01-01' }], error: null })
    client.from.mockImplementation(table => table === 'procedures' ? procedure : table === 'initial_visit_notes' ? notes : createMockQueryBuilder())
    const values: BotoxProcedureFormValues = {
      procedure_date: '2026-01-02', sites: [], diagnoses: [], consent_obtained: true,
      vital_signs: { bp_systolic: null, bp_diastolic: null, heart_rate: null, respiratory_rate: null, temperature_f: null, spo2_percent: null, pain_score_min: null, pain_score_max: null },
      botox_dosing: { product_name: 'BOTOX', reconstitution_units: 100, reconstitution_diluent_ml: 3, units_administered: 60, units_discarded: 40 },
    }

    const result = await updateBotoxProcedure('procedure-1', 'case-1', values)

    expect(result.error).toBeUndefined()
    expect(notes.eq).toHaveBeenCalledWith('episode_id', 'episode-1')
    expect(procedure.eq).toHaveBeenCalledWith('case_id', 'case-1')
    expect(mocks.episode).not.toHaveBeenCalled()
  })
})
