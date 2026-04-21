import { describe, it, expect } from 'vitest'
import { validateDischargeTrajectoryConsistency } from '@/lib/claude/pain-trajectory-validator'
import type { DischargeNoteResult } from '@/lib/validations/discharge-note'
import type { DischargePainTrajectory } from '@/lib/claude/pain-trajectory'

function baseResult(overrides: Partial<DischargeNoteResult> = {}): DischargeNoteResult {
  return {
    subjective: '',
    objective_vitals: '',
    objective_general: '',
    objective_cervical: '',
    objective_lumbar: '',
    objective_neurological: '',
    diagnoses: '',
    assessment: '',
    plan_and_recommendations: '',
    patient_education: '',
    prognosis: '',
    clinician_disclaimer: '',
    ...overrides,
  }
}

const goodTrajectory: DischargePainTrajectory = {
  entries: [
    { date: '2026-01-01', label: 'procedure 1', min: 7, max: 7, source: 'procedure', estimated: false },
    { date: '2026-02-01', label: 'procedure 2', min: 4, max: 4, source: 'procedure', estimated: false },
    { date: null, label: "today's discharge evaluation", min: 2, max: 2, source: 'discharge_estimate', estimated: true },
  ],
  arrowChain: "7/10 → 4/10 across the injection series, 2/10 at today's discharge evaluation",
  baselineDisplay: '7/10',
  dischargeDisplay: '2/10',
  dischargeEntry: { date: null, label: "today's discharge evaluation", min: 2, max: 2, source: 'discharge_estimate', estimated: true },
  dischargeEstimated: true,
}

describe('validateDischargeTrajectoryConsistency', () => {
  it('returns no warnings for a clean note that includes the arrow chain and endpoint', () => {
    const r = validateDischargeTrajectoryConsistency(
      baseResult({
        subjective: "The patient's pain has decreased from 7/10 → 4/10 across the injection series, 2/10 at today's discharge evaluation.",
        objective_vitals: '• BP: 120/78 mmHg\n• Pain: 2/10',
        assessment: 'Pain reduction from 7/10 at baseline to 2/10 at today\'s evaluation.',
        prognosis: 'Favorable — pain now 2/10.',
      }),
      goodTrajectory,
    )
    expect(r.warnings).toEqual([])
  })

  it('flags a fabricated pain value in subjective', () => {
    const r = validateDischargeTrajectoryConsistency(
      baseResult({
        subjective: 'Pain decreased from 9/10 to 2/10.',
        objective_vitals: '• Pain: 2/10',
        assessment: 'From 7/10 to 2/10.',
        prognosis: '2/10 now.',
      }),
      goodTrajectory,
    )
    expect(r.warnings.some((w) => w.includes('9/10'))).toBe(true)
  })

  it('flags a missing discharge value in subjective', () => {
    const r = validateDischargeTrajectoryConsistency(
      baseResult({
        subjective: 'Pain decreased from 7/10 to 4/10.',
        objective_vitals: '• Pain: 2/10',
        assessment: 'From 7/10 to 2/10.',
        prognosis: 'Patient doing well.',
      }),
      goodTrajectory,
    )
    expect(r.warnings.some((w) => w.includes('subjective') && w.includes('2/10'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('prognosis') && w.includes('2/10'))).toBe(true)
  })

  it('flags mismatch between objective_vitals Pain bullet and discharge endpoint', () => {
    const r = validateDischargeTrajectoryConsistency(
      baseResult({
        subjective: "7/10 → 4/10 across the injection series, 2/10 at today's discharge evaluation",
        objective_vitals: '• BP: 120/78 mmHg\n• Pain: 4/10',
        assessment: 'From 7/10 to 2/10.',
        prognosis: '2/10 at today\'s evaluation.',
      }),
      goodTrajectory,
    )
    expect(r.warnings.some((w) => w.includes('objective_vitals'))).toBe(true)
  })

  it('flags paraphrased arrow chain', () => {
    const r = validateDischargeTrajectoryConsistency(
      baseResult({
        subjective: 'Pain went from seven to four and now two.',
        objective_vitals: '• Pain: 2/10',
        assessment: 'From 7/10 to 2/10.',
        prognosis: '2/10 now.',
      }),
      goodTrajectory,
    )
    expect(r.warnings.some((w) => w.includes('paraphrased'))).toBe(true)
  })

  it('ignores date strings like 05/10/2025 when extracting pain values', () => {
    const r = validateDischargeTrajectoryConsistency(
      baseResult({
        subjective: "Date of visit: 05/10/2025. 7/10 → 4/10 across the injection series, 2/10 at today's discharge evaluation.",
        objective_vitals: '• Pain: 2/10',
        assessment: 'From 7/10 to 2/10.',
        prognosis: '2/10 at today\'s evaluation.',
      }),
      goodTrajectory,
    )
    expect(r.warnings.every((w) => !w.includes('05/10'))).toBe(true)
  })

  it('returns no warnings when trajectory has no entries (legacy path)', () => {
    const emptyTrajectory: DischargePainTrajectory = {
      entries: [],
      arrowChain: '',
      baselineDisplay: null,
      dischargeDisplay: null,
      dischargeEntry: null,
      dischargeEstimated: false,
    }
    const r = validateDischargeTrajectoryConsistency(
      baseResult({ subjective: 'Anything goes here 5/10.', objective_vitals: '• Pain: 5/10' }),
      emptyTrajectory,
    )
    expect(r.warnings).toEqual([])
  })
})
