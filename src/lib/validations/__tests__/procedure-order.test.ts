import { describe, expect, it } from 'vitest'
import { createProcedureOrderSchema } from '../procedure-order'

const order = {
  case_id: '11111111-1111-4111-8111-111111111111',
  episode_id: '22222222-2222-4222-8222-222222222222',
  source_encounter_id: '33333333-3333-4333-8333-333333333333',
  source_recommendation_id: '44444444-4444-4444-8444-444444444444',
  procedure_series_id: '55555555-5555-4555-8555-555555555555',
  procedure_type: 'botox' as const,
  sites: ['Cervical paraspinals'],
  diagnoses: [{ icd10_code: 'G43.709', description: 'Chronic migraine' }],
  clinical_rationale: 'Persistent symptoms despite conservative treatment.',
  priority: 'routine' as const,
}

describe('createProcedureOrderSchema', () => {
  it('accepts a confirmed procedure order', () => {
    expect(createProcedureOrderSchema.safeParse(order).success).toBe(true)
  })

  it('rejects unsupported procedure types', () => {
    expect(createProcedureOrderSchema.safeParse({
      ...order,
      procedure_type: 'legacy_mixed',
    }).success).toBe(false)
  })

  it('requires clinical rationale', () => {
    expect(createProcedureOrderSchema.safeParse({
      ...order,
      clinical_rationale: '',
    }).success).toBe(false)
  })
})
