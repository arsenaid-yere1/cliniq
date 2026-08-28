import { describe, expect, it } from 'vitest'
import { isEarlierEncounter } from '@/lib/clinical/visit-diagnosis-history'

const current = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  completed_at: null,
  encounter_date: '2026-08-20',
  scheduled_start: '2026-08-20T16:00:00Z',
  created_at: '2026-08-19T16:00:00Z',
  provider_id: null,
}

describe('visit diagnosis history ordering', () => {
  it('uses completed time before encounter date and schedule', () => {
    expect(isEarlierEncounter({
      ...current,
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      completed_at: '2026-08-19T23:59:00Z',
      encounter_date: '2026-08-30',
    }, current)).toBe(true)
  })

  it('uses the id as a stable tie-breaker', () => {
    expect(isEarlierEncounter({
      ...current,
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    }, current)).toBe(true)
    expect(isEarlierEncounter({
      ...current,
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    }, current)).toBe(false)
  })
})
