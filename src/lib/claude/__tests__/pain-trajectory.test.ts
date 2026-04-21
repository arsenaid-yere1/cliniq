import { describe, it, expect } from 'vitest'
import {
  buildDischargePainTrajectory,
  estimateDischargeFromLatest,
  formatPainValue,
  type BuildTrajectoryInput,
} from '@/lib/claude/pain-trajectory'

function baseInput(overrides: Partial<BuildTrajectoryInput> = {}): BuildTrajectoryInput {
  return {
    procedures: [],
    latestVitals: null,
    dischargeVitals: null,
    baselinePain: null,
    intakePain: null,
    overallPainTrend: 'baseline',
    finalIntervalWorsened: false,
    ...overrides,
  }
}

describe('formatPainValue', () => {
  it('returns null when both bounds are null', () => {
    expect(formatPainValue(null, null)).toBeNull()
  })
  it('returns single value when min and max are equal', () => {
    expect(formatPainValue(5, 5)).toBe('5/10')
    expect(formatPainValue(0, 0)).toBe('0/10')
  })
  it('returns range when min != max', () => {
    expect(formatPainValue(3, 4)).toBe('3-4/10')
    expect(formatPainValue(7, 8)).toBe('7-8/10')
  })
  it('falls back to single side when only one bound present', () => {
    expect(formatPainValue(null, 5)).toBe('5/10')
    expect(formatPainValue(3, null)).toBe('3/10')
  })
})

describe('estimateDischargeFromLatest', () => {
  it('applies -2 with floor at 0', () => {
    expect(estimateDischargeFromLatest(null, 7)).toEqual({ min: null, max: 5 })
    expect(estimateDischargeFromLatest(3, 4)).toEqual({ min: 1, max: 2 })
    expect(estimateDischargeFromLatest(1, 2)).toEqual({ min: 0, max: 0 })
    expect(estimateDischargeFromLatest(0, 1)).toEqual({ min: 0, max: 0 })
    expect(estimateDischargeFromLatest(0, 0)).toEqual({ min: 0, max: 0 })
  })
  it('preserves nulls', () => {
    expect(estimateDischargeFromLatest(null, null)).toEqual({ min: null, max: null })
  })
})

describe('buildDischargePainTrajectory', () => {
  it('returns empty chain when no procedures and no vitals', () => {
    const t = buildDischargePainTrajectory(baseInput())
    expect(t.arrowChain).toBe('')
    expect(t.entries).toHaveLength(0)
    expect(t.dischargeEntry).toBeNull()
    expect(t.dischargeEstimated).toBe(false)
  })

  it('applies -2 rule for improving trend when dischargeVitals is null', () => {
    const t = buildDischargePainTrajectory(
      baseInput({
        procedures: [
          { procedure_date: '2026-01-01', procedure_number: 1, pain_score_min: 8, pain_score_max: 8 },
          { procedure_date: '2026-02-01', procedure_number: 2, pain_score_min: 6, pain_score_max: 6 },
          { procedure_date: '2026-03-01', procedure_number: 3, pain_score_min: 3, pain_score_max: 4 },
        ],
        latestVitals: { pain_score_min: 3, pain_score_max: 4 },
        baselinePain: { procedure_date: '2026-01-01', pain_score_min: 8, pain_score_max: 8 },
        overallPainTrend: 'improved',
        finalIntervalWorsened: false,
      }),
    )
    expect(t.arrowChain).toBe('8/10 → 6/10 → 3-4/10 across the injection series, 1-2/10 at today\'s discharge evaluation')
    expect(t.dischargeDisplay).toBe('1-2/10')
    expect(t.dischargeEstimated).toBe(true)
    expect(t.dischargeEntry?.source).toBe('discharge_estimate')
    expect(t.baselineDisplay).toBe('8/10')
  })

  it('uses dischargeVitals verbatim when provider-entered (no fabrication)', () => {
    const t = buildDischargePainTrajectory(
      baseInput({
        procedures: [
          { procedure_date: '2026-01-01', procedure_number: 1, pain_score_min: 7, pain_score_max: 7 },
          { procedure_date: '2026-02-01', procedure_number: 2, pain_score_min: 3, pain_score_max: 3 },
        ],
        latestVitals: { pain_score_min: 3, pain_score_max: 3 },
        dischargeVitals: { pain_score_min: 2, pain_score_max: 2 },
        baselinePain: { procedure_date: '2026-01-01', pain_score_min: 7, pain_score_max: 7 },
        overallPainTrend: 'improved',
        finalIntervalWorsened: false,
      }),
    )
    expect(t.dischargeDisplay).toBe('2/10')
    expect(t.dischargeEstimated).toBe(false)
    expect(t.dischargeEntry?.source).toBe('discharge_vitals')
    expect(t.arrowChain).toBe('7/10 → 3/10 across the injection series, 2/10 at today\'s discharge evaluation')
  })

  it('suppresses -2 fabrication when final interval worsened', () => {
    const t = buildDischargePainTrajectory(
      baseInput({
        procedures: [
          { procedure_date: '2026-01-01', procedure_number: 1, pain_score_min: 8, pain_score_max: 8 },
          { procedure_date: '2026-02-01', procedure_number: 2, pain_score_min: 4, pain_score_max: 4 },
          { procedure_date: '2026-03-01', procedure_number: 3, pain_score_min: 6, pain_score_max: 6 },
        ],
        latestVitals: { pain_score_min: 6, pain_score_max: 6 },
        baselinePain: { procedure_date: '2026-01-01', pain_score_min: 8, pain_score_max: 8 },
        overallPainTrend: 'improved',
        finalIntervalWorsened: true,
      }),
    )
    expect(t.dischargeDisplay).toBe('6/10')
    expect(t.dischargeEstimated).toBe(false)
    expect(t.arrowChain).toBe('8/10 → 4/10 → 6/10 across the injection series, 6/10 at today\'s discharge evaluation')
  })

  it('suppresses -2 fabrication when overall trend is stable', () => {
    const t = buildDischargePainTrajectory(
      baseInput({
        procedures: [
          { procedure_date: '2026-01-01', procedure_number: 1, pain_score_min: 7, pain_score_max: 7 },
          { procedure_date: '2026-02-01', procedure_number: 2, pain_score_min: 6, pain_score_max: 6 },
        ],
        latestVitals: { pain_score_min: 6, pain_score_max: 6 },
        baselinePain: { procedure_date: '2026-01-01', pain_score_min: 7, pain_score_max: 7 },
        overallPainTrend: 'stable',
        finalIntervalWorsened: false,
      }),
    )
    expect(t.dischargeDisplay).toBe('6/10')
    expect(t.dischargeEstimated).toBe(false)
  })

  it('suppresses -2 fabrication when overall trend is worsened', () => {
    const t = buildDischargePainTrajectory(
      baseInput({
        procedures: [
          { procedure_date: '2026-01-01', procedure_number: 1, pain_score_min: 5, pain_score_max: 5 },
          { procedure_date: '2026-02-01', procedure_number: 2, pain_score_min: 8, pain_score_max: 8 },
        ],
        latestVitals: { pain_score_min: 8, pain_score_max: 8 },
        baselinePain: { procedure_date: '2026-01-01', pain_score_min: 5, pain_score_max: 5 },
        overallPainTrend: 'worsened',
        finalIntervalWorsened: false,
      }),
    )
    expect(t.dischargeDisplay).toBe('8/10')
    expect(t.dischargeEstimated).toBe(false)
  })

  it('skips procedures with missing pain in arrow chain but keeps endpoint', () => {
    const t = buildDischargePainTrajectory(
      baseInput({
        procedures: [
          { procedure_date: '2026-01-01', procedure_number: 1, pain_score_min: 8, pain_score_max: 8 },
          { procedure_date: '2026-02-01', procedure_number: 2, pain_score_min: null, pain_score_max: null },
          { procedure_date: '2026-03-01', procedure_number: 3, pain_score_min: 4, pain_score_max: 4 },
        ],
        latestVitals: { pain_score_min: 4, pain_score_max: 4 },
        baselinePain: { procedure_date: '2026-01-01', pain_score_min: 8, pain_score_max: 8 },
        overallPainTrend: 'improved',
        finalIntervalWorsened: false,
      }),
    )
    expect(t.arrowChain).toBe('8/10 → 4/10 across the injection series, 2/10 at today\'s discharge evaluation')
    expect(t.entries).toHaveLength(4)
  })

  it('floors at 0 when last procedure is 1 or 2', () => {
    const t1 = buildDischargePainTrajectory(
      baseInput({
        procedures: [
          { procedure_date: '2026-01-01', procedure_number: 1, pain_score_min: 7, pain_score_max: 7 },
          { procedure_date: '2026-02-01', procedure_number: 2, pain_score_min: 1, pain_score_max: 1 },
        ],
        latestVitals: { pain_score_min: 1, pain_score_max: 1 },
        baselinePain: { procedure_date: '2026-01-01', pain_score_min: 7, pain_score_max: 7 },
        overallPainTrend: 'improved',
      }),
    )
    expect(t1.dischargeDisplay).toBe('0/10')
    expect(t1.dischargeEstimated).toBe(true)

    const t2 = buildDischargePainTrajectory(
      baseInput({
        procedures: [
          { procedure_date: '2026-01-01', procedure_number: 1, pain_score_min: 6, pain_score_max: 6 },
          { procedure_date: '2026-02-01', procedure_number: 2, pain_score_min: 2, pain_score_max: 2 },
        ],
        latestVitals: { pain_score_min: 2, pain_score_max: 2 },
        baselinePain: { procedure_date: '2026-01-01', pain_score_min: 6, pain_score_max: 6 },
        overallPainTrend: 'improved',
      }),
    )
    expect(t2.dischargeDisplay).toBe('0/10')
  })

  it('preserves range on -2 rule (7-8 → 5-6, 3-4 → 1-2)', () => {
    const t = buildDischargePainTrajectory(
      baseInput({
        procedures: [
          { procedure_date: '2026-01-01', procedure_number: 1, pain_score_min: 7, pain_score_max: 8 },
          { procedure_date: '2026-02-01', procedure_number: 2, pain_score_min: 3, pain_score_max: 4 },
        ],
        latestVitals: { pain_score_min: 3, pain_score_max: 4 },
        baselinePain: { procedure_date: '2026-01-01', pain_score_min: 7, pain_score_max: 8 },
        overallPainTrend: 'improved',
      }),
    )
    expect(t.dischargeDisplay).toBe('1-2/10')
    expect(t.baselineDisplay).toBe('7-8/10')
  })

  it('single procedure series still produces endpoint when applicable', () => {
    const t = buildDischargePainTrajectory(
      baseInput({
        procedures: [
          { procedure_date: '2026-01-01', procedure_number: 1, pain_score_min: 6, pain_score_max: 6 },
        ],
        latestVitals: { pain_score_min: 6, pain_score_max: 6 },
        baselinePain: { procedure_date: '2026-01-01', pain_score_min: 6, pain_score_max: 6 },
        overallPainTrend: 'baseline',
      }),
    )
    expect(t.arrowChain).toBe('6/10 across the injection series, 4/10 at today\'s discharge evaluation')
    expect(t.dischargeEstimated).toBe(true)
  })

  it('returns empty arrow chain and null endpoint when no pain data anywhere', () => {
    const t = buildDischargePainTrajectory(
      baseInput({
        procedures: [
          { procedure_date: '2026-01-01', procedure_number: 1, pain_score_min: null, pain_score_max: null },
        ],
        latestVitals: null,
        baselinePain: { procedure_date: '2026-01-01', pain_score_min: null, pain_score_max: null },
        overallPainTrend: 'baseline',
      }),
    )
    expect(t.arrowChain).toBe('')
    expect(t.dischargeDisplay).toBeNull()
    expect(t.dischargeEntry).toBeNull()
  })

  it('prepends intake entry when intakePain has a value', () => {
    const t = buildDischargePainTrajectory(
      baseInput({
        procedures: [
          { procedure_date: '2026-01-10', procedure_number: 1, pain_score_min: 7, pain_score_max: 7 },
          { procedure_date: '2026-02-10', procedure_number: 2, pain_score_min: 4, pain_score_max: 4 },
        ],
        latestVitals: { pain_score_min: 4, pain_score_max: 4 },
        baselinePain: { procedure_date: '2026-01-10', pain_score_min: 7, pain_score_max: 7 },
        intakePain: { recorded_at: '2026-01-05T10:00:00Z', pain_score_min: 8, pain_score_max: 8 },
        overallPainTrend: 'improved',
      }),
    )
    expect(t.arrowChain).toBe("8/10 at initial evaluation, 7/10 → 4/10 across the injection series, 2/10 at today's discharge evaluation")
    expect(t.baselineDisplay).toBe('8/10')
    expect(t.baselineSource).toBe('intake')
    expect(t.intakePainDisplay).toBe('8/10')
    expect(t.firstProcedurePainDisplay).toBe('7/10')
    expect(t.entries).toHaveLength(4)
    expect(t.entries[0].source).toBe('intake')
  })

  it('falls back to first-procedure as baseline anchor when intakePain is null', () => {
    const t = buildDischargePainTrajectory(
      baseInput({
        procedures: [
          { procedure_date: '2026-01-10', procedure_number: 1, pain_score_min: 7, pain_score_max: 7 },
        ],
        latestVitals: { pain_score_min: 7, pain_score_max: 7 },
        baselinePain: { procedure_date: '2026-01-10', pain_score_min: 7, pain_score_max: 7 },
        intakePain: null,
        overallPainTrend: 'baseline',
      }),
    )
    expect(t.baselineDisplay).toBe('7/10')
    expect(t.baselineSource).toBe('procedure')
    expect(t.intakePainDisplay).toBeNull()
    expect(t.firstProcedurePainDisplay).toBe('7/10')
  })

  it('ignores intake entry when intakePain has only nulls', () => {
    const t = buildDischargePainTrajectory(
      baseInput({
        procedures: [
          { procedure_date: '2026-01-10', procedure_number: 1, pain_score_min: 6, pain_score_max: 6 },
        ],
        latestVitals: { pain_score_min: 6, pain_score_max: 6 },
        baselinePain: { procedure_date: '2026-01-10', pain_score_min: 6, pain_score_max: 6 },
        intakePain: { recorded_at: '2026-01-05T10:00:00Z', pain_score_min: null, pain_score_max: null },
        overallPainTrend: 'baseline',
      }),
    )
    expect(t.baselineSource).toBe('procedure')
    expect(t.intakePainDisplay).toBeNull()
    expect(t.entries[0].source).toBe('procedure')
  })

  it('renders intake-only chain when no procedures yet recorded', () => {
    const t = buildDischargePainTrajectory(
      baseInput({
        procedures: [],
        latestVitals: null,
        dischargeVitals: null,
        baselinePain: null,
        intakePain: { recorded_at: '2026-01-05T10:00:00Z', pain_score_min: 8, pain_score_max: 8 },
        overallPainTrend: 'baseline',
      }),
    )
    // No procedures means no endpoint either — but intake still leads.
    expect(t.arrowChain).toBe('8/10 at initial evaluation')
    expect(t.baselineDisplay).toBe('8/10')
    expect(t.baselineSource).toBe('intake')
  })

  it('annotates arrow chain with (day N) labels when visitDate is supplied (R9)', () => {
    const t = buildDischargePainTrajectory(
      baseInput({
        procedures: [
          { procedure_date: '2026-01-10', procedure_number: 1, pain_score_min: 8, pain_score_max: 8 },
          { procedure_date: '2026-02-10', procedure_number: 2, pain_score_min: 4, pain_score_max: 4 },
        ],
        latestVitals: { pain_score_min: 4, pain_score_max: 4 },
        baselinePain: { procedure_date: '2026-01-10', pain_score_min: 8, pain_score_max: 8 },
        intakePain: { recorded_at: '2026-01-05T00:00:00Z', pain_score_min: 9, pain_score_max: 9 },
        overallPainTrend: 'improved',
        visitDate: '2026-03-01',
      }),
    )
    // Anchor = intake = 2026-01-05.
    // Procedure 1 (2026-01-10) = day 5
    // Procedure 2 (2026-02-10) = day 36
    // Discharge visit (2026-03-01) = day 55
    expect(t.arrowChain).toBe(
      "9/10 at initial evaluation (day 0), 8/10 → 4/10 across the injection series (day 5 → day 36), 2/10 at today's discharge evaluation (day 55)",
    )
    expect(t.entries.find((e) => e.source === 'intake')?.dayOffset).toBe(0)
    expect(t.entries.find((e) => e.label === 'procedure 1')?.dayOffset).toBe(5)
    expect(t.entries.find((e) => e.label === 'procedure 2')?.dayOffset).toBe(36)
    expect(t.entries.find((e) => e.source === 'discharge_estimate')?.dayOffset).toBe(55)
  })

  it('no day labels when visitDate is omitted (backward-compat)', () => {
    const t = buildDischargePainTrajectory(
      baseInput({
        procedures: [
          { procedure_date: '2026-01-10', procedure_number: 1, pain_score_min: 7, pain_score_max: 7 },
        ],
        latestVitals: { pain_score_min: 7, pain_score_max: 7 },
        baselinePain: { procedure_date: '2026-01-10', pain_score_min: 7, pain_score_max: 7 },
        intakePain: { recorded_at: '2026-01-05T00:00:00Z', pain_score_min: 9, pain_score_max: 9 },
        overallPainTrend: 'improved',
        // no visitDate
      }),
    )
    expect(t.arrowChain).not.toContain('(day')
    expect(t.entries.every((e) => e.dayOffset === null)).toBe(true)
  })

  it('falls back to first-procedure as anchor when intake has no date', () => {
    const t = buildDischargePainTrajectory(
      baseInput({
        procedures: [
          { procedure_date: '2026-02-01', procedure_number: 1, pain_score_min: 6, pain_score_max: 6 },
        ],
        latestVitals: { pain_score_min: 6, pain_score_max: 6 },
        baselinePain: { procedure_date: '2026-02-01', pain_score_min: 6, pain_score_max: 6 },
        intakePain: null,
        overallPainTrend: 'baseline',
        visitDate: '2026-02-15',
      }),
    )
    // Anchor = first procedure = 2026-02-01 (day 0). Discharge = day 14.
    expect(t.entries.find((e) => e.label === 'procedure 1')?.dayOffset).toBe(0)
    expect(t.entries.find((e) => e.source === 'discharge_estimate')?.dayOffset).toBe(14)
    expect(t.arrowChain).toContain('(day 0)')
    expect(t.arrowChain).toContain('(day 14)')
  })

  it('gracefully handles malformed dates (null dayOffset, no crash)', () => {
    const t = buildDischargePainTrajectory(
      baseInput({
        procedures: [
          { procedure_date: 'not-a-date', procedure_number: 1, pain_score_min: 6, pain_score_max: 6 },
        ],
        latestVitals: { pain_score_min: 6, pain_score_max: 6 },
        baselinePain: { procedure_date: 'not-a-date', pain_score_min: 6, pain_score_max: 6 },
        overallPainTrend: 'baseline',
        visitDate: 'also-bad',
      }),
    )
    // No anchor can be parsed → no day labels at all.
    expect(t.arrowChain).not.toContain('(day')
    expect(t.entries.every((e) => e.dayOffset === null)).toBe(true)
  })

  it('dischargeVitals takes priority even when finalIntervalWorsened is true', () => {
    const t = buildDischargePainTrajectory(
      baseInput({
        procedures: [
          { procedure_date: '2026-01-01', procedure_number: 1, pain_score_min: 8, pain_score_max: 8 },
          { procedure_date: '2026-02-01', procedure_number: 2, pain_score_min: 3, pain_score_max: 3 },
          { procedure_date: '2026-03-01', procedure_number: 3, pain_score_min: 5, pain_score_max: 5 },
        ],
        latestVitals: { pain_score_min: 5, pain_score_max: 5 },
        dischargeVitals: { pain_score_min: 4, pain_score_max: 4 },
        baselinePain: { procedure_date: '2026-01-01', pain_score_min: 8, pain_score_max: 8 },
        overallPainTrend: 'improved',
        finalIntervalWorsened: true,
      }),
    )
    expect(t.dischargeDisplay).toBe('4/10')
    expect(t.dischargeEstimated).toBe(false)
    expect(t.dischargeEntry?.source).toBe('discharge_vitals')
  })
})
