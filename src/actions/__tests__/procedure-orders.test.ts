import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockSupabase, type MockSupabaseClient } from '@/test-utils/supabase-mock'

let mockSupabase: MockSupabaseClient

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(() => mockSupabase) }))

import { createProcedureOrderFromRecommendation } from '../procedure-orders'

const input = {
  case_id: '11111111-1111-4111-8111-111111111111',
  episode_id: '22222222-2222-4222-8222-222222222222',
  source_encounter_id: '33333333-3333-4333-8333-333333333333',
  source_recommendation_id: '44444444-4444-4444-8444-444444444444',
  procedure_type: 'prp' as const,
  sites: ['Knee'], diagnoses: [], clinical_rationale: 'Persistent symptoms.',
  priority: 'routine' as const,
}

describe('createProcedureOrderFromRecommendation', () => {
  beforeEach(() => { mockSupabase = createMockSupabase({ data: { id: 'order' }, error: null }) })

  it('uses the versioned RPC with an explicit prior-series relationship', async () => {
    const selectedSeriesId = '55555555-5555-4555-8555-555555555555'
    await createProcedureOrderFromRecommendation({ ...input, series_relationship: 'prior', selected_series_id: selectedSeriesId })
    expect(mockSupabase.rpc).toHaveBeenCalledWith('create_procedure_order_from_recommendation_v2', expect.objectContaining({
      p_series_relationship: 'prior', p_selected_series_id: selectedSeriesId,
    }))
  })

  it('does not coerce an omitted relationship into a separate series', async () => {
    const result = await createProcedureOrderFromRecommendation(input as never)
    expect(result).toHaveProperty('error')
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })
})
