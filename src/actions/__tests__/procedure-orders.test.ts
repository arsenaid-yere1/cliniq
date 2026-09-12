import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockQueryBuilder, createMockSupabase, type MockSupabaseClient } from '@/test-utils/supabase-mock'

let mockSupabase: MockSupabaseClient

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(() => mockSupabase) }))

import { createProcedureOrderFromRecommendation, listProcedureOrders, previewProcedureSeriesChoices } from '../procedure-orders'

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

  it('passes explicit reopening to the atomic order RPC', async () => {
    await createProcedureOrderFromRecommendation({...input, series_relationship: 'reopen', selected_series_id: '55555555-5555-4555-8555-555555555555'})
    expect(mockSupabase.rpc).toHaveBeenCalledWith('create_procedure_order_from_recommendation_v2', expect.objectContaining({p_series_relationship: 'reopen'}))
  })

  it('uses database eligibility without recalculating choices', async () => {
    mockSupabase = createMockSupabase({data: [{id: 'series', relationship: 'reopen', eligible: true, latestProcedureNumber: 1}], error: null})
    expect(await previewProcedureSeriesChoices(input.case_id, input.episode_id)).toEqual({data: [{id: 'series', relationship: 'reopen', eligible: true, latestProcedureNumber: 1}]})
    expect(mockSupabase.rpc).toHaveBeenCalledWith('preview_procedure_series_choices', {p_case_id: input.case_id, p_episode_id: input.episode_id})
  })

  it('fails closed when the database preview is unavailable', async () => {
    mockSupabase = createMockSupabase({data: null, error: {message: 'unavailable'}})
    expect(await previewProcedureSeriesChoices(input.case_id, input.episode_id)).toEqual({data: [], error: 'Unable to load procedure series choices'})
  })

  it('explains a pending note replacement instead of returning a generic failure', async () => {
    mockSupabase = createMockSupabase({data: null, error: {message: 'Finalize the replacement note before creating dependent orders or billing claims'}})
    expect(await createProcedureOrderFromRecommendation({...input, series_relationship: 'reopen', selected_series_id: '55555555-5555-4555-8555-555555555555'})).toEqual({error: 'Finish the replacement follow-up note before creating another order.'})
  })

  it('does not coerce an omitted relationship into a separate series', async () => {
    const result = await createProcedureOrderFromRecommendation(input as never)
    expect(result).toHaveProperty('error')
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })
})

describe('listProcedureOrders', () => {
  beforeEach(() => { mockSupabase = createMockSupabase() })

  it('keeps base orders available when optional relationship enrichment fails', async () => {
    mockSupabase.from.mockImplementation((table: string) => createMockQueryBuilder(table === 'procedure_orders'
      ? { data: [{ id: 'order-1' }], error: null }
      : { data: null, error: { message: 'relationship metadata unavailable' } }))

    const result = await listProcedureOrders('11111111-1111-4111-8111-111111111111')

    expect(result).not.toHaveProperty('error')
    expect(result.data[0]).toEqual(expect.objectContaining({
      id: 'order-1',
      seriesRelationship: 'unknown',
      seriesRelationshipLabel: 'Series relationship unavailable for legacy order',
    }))
  })
})
