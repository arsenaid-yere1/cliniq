import { describe, it, expect } from 'vitest'
import {
  buildPainObservations,
  extractPtPainObservation,
  extractPmPainObservations,
  extractChiroPainObservations,
  sortPainObservations,
  type PainObservation,
} from '@/lib/claude/pain-observations'

describe('extractPtPainObservation', () => {
  it('returns null when extraction is null', () => {
    expect(extractPtPainObservation(null)).toBeNull()
  })

  it('returns null when pain_ratings is absent or empty', () => {
    expect(extractPtPainObservation({ pain_ratings: null })).toBeNull()
    expect(
      extractPtPainObservation({ pain_ratings: { at_rest: null, with_activity: null, worst: null, best: null } }),
    ).toBeNull()
  })

  it('collapses at_rest / with_activity / worst / best into min/max with context', () => {
    const o = extractPtPainObservation({
      pain_ratings: { at_rest: 3, with_activity: 7, worst: 8, best: 2 },
      evaluation_date: '2026-02-10',
    })
    expect(o).not.toBeNull()
    expect(o!.min).toBe(2)
    expect(o!.max).toBe(8)
    expect(o!.date).toBe('2026-02-10')
    expect(o!.source).toBe('pt')
    expect(o!.context).toContain('at rest 3/10')
    expect(o!.context).toContain('with activity 7/10')
  })

  it('falls back to created_at when evaluation_date is missing', () => {
    const o = extractPtPainObservation({
      pain_ratings: { at_rest: 4, with_activity: null, worst: null, best: null },
      created_at: '2026-02-15T10:00:00Z',
    })
    expect(o?.date).toBe('2026-02-15T10:00:00Z')
  })
})

describe('extractPmPainObservations', () => {
  it('returns empty when extraction is null', () => {
    expect(extractPmPainObservations(null)).toEqual([])
  })

  it('returns empty when chief_complaints is missing', () => {
    expect(extractPmPainObservations({})).toEqual([])
  })

  it('extracts one observation per complaint with min/max', () => {
    const obs = extractPmPainObservations({
      chief_complaints: [
        { location: 'cervical', pain_rating_min: 5, pain_rating_max: 7 },
        { location: 'lumbar', pain_rating_min: 3, pain_rating_max: 4 },
      ],
      created_at: '2026-01-20',
    })
    expect(obs).toHaveLength(2)
    expect(obs[0].label).toBe('PM chief complaint: cervical')
    expect(obs[0].min).toBe(5)
    expect(obs[0].max).toBe(7)
    expect(obs[1].label).toBe('PM chief complaint: lumbar')
  })

  it('skips complaints with both ratings null', () => {
    const obs = extractPmPainObservations({
      chief_complaints: [
        { location: 'cervical', pain_rating_min: null, pain_rating_max: null },
        { location: 'lumbar', pain_rating_min: 4, pain_rating_max: 4 },
      ],
    })
    expect(obs).toHaveLength(1)
    expect(obs[0].label).toBe('PM chief complaint: lumbar')
  })
})

describe('extractChiroPainObservations', () => {
  it('returns empty when extraction is null or no pain_levels', () => {
    expect(extractChiroPainObservations(null)).toEqual([])
    expect(extractChiroPainObservations({})).toEqual([])
    expect(extractChiroPainObservations({ functional_outcomes: {} })).toEqual([])
  })

  it('extracts one observation per pain_level entry preserving date + context', () => {
    const obs = extractChiroPainObservations({
      functional_outcomes: {
        pain_levels: [
          { date: '2026-01-15', scale: 'NRS', score: 6, max_score: 10, context: 'initial eval' },
          { date: '2026-02-15', scale: 'NRS', score: 4, max_score: 10, context: 'mid-course' },
        ],
      },
    })
    expect(obs).toHaveLength(2)
    expect(obs[0].min).toBe(6)
    expect(obs[0].max).toBe(6)
    expect(obs[0].scale).toBe('nrs10')
    expect(obs[0].context).toBe('initial eval')
    expect(obs[1].date).toBe('2026-02-15')
  })

  it('detects VAS scale when max_score is 100', () => {
    const obs = extractChiroPainObservations({
      functional_outcomes: {
        pain_levels: [{ date: '2026-01-15', scale: 'VAS', score: 60, max_score: 100, context: null }],
      },
    })
    expect(obs[0].scale).toBe('vas100')
  })

  it('skips entries with null score', () => {
    const obs = extractChiroPainObservations({
      functional_outcomes: {
        pain_levels: [
          { date: '2026-01-15', scale: 'NRS', score: null, max_score: 10, context: null },
          { date: '2026-02-15', scale: 'NRS', score: 5, max_score: 10, context: null },
        ],
      },
    })
    expect(obs).toHaveLength(1)
  })
})

describe('sortPainObservations', () => {
  it('orders by date ascending, nulls last', () => {
    const input: PainObservation[] = [
      { date: '2026-03-01', source: 'pt', label: 'PT', min: 5, max: 5, scale: 'nrs10', context: null },
      { date: null, source: 'pm', label: 'PM', min: 6, max: 6, scale: 'nrs10', context: null },
      { date: '2026-01-15', source: 'chiro', label: 'chiro', min: 4, max: 4, scale: 'nrs10', context: null },
    ]
    const sorted = sortPainObservations(input)
    expect(sorted.map((o) => o.source)).toEqual(['chiro', 'pt', 'pm'])
  })
})

describe('buildPainObservations', () => {
  it('merges sources chronologically', () => {
    const obs = buildPainObservations({
      ptExtraction: {
        pain_ratings: { at_rest: 3, with_activity: 7, worst: 7, best: 3 },
        evaluation_date: '2026-02-20',
      },
      pmExtraction: {
        chief_complaints: [{ location: 'cervical', pain_rating_min: 6, pain_rating_max: 8 }],
        created_at: '2026-01-10',
      },
      chiroExtraction: {
        functional_outcomes: {
          pain_levels: [{ date: '2026-03-05', scale: 'NRS', score: 4, max_score: 10, context: null }],
        },
      },
    })
    expect(obs).toHaveLength(3)
    expect(obs.map((o) => o.source)).toEqual(['pm', 'pt', 'chiro'])
  })

  it('returns empty when all sources are null', () => {
    expect(
      buildPainObservations({
        ptExtraction: null,
        pmExtraction: null,
        chiroExtraction: null,
      }),
    ).toEqual([])
  })
})
