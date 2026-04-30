import { describe, it, expect } from 'vitest'
import {
  computePlanAlignment,
  normalizeRegion,
} from '@/lib/procedures/compute-plan-alignment'

describe('normalizeRegion', () => {
  it('maps lumbosacral → lumbar', () => {
    expect(normalizeRegion('lumbosacral')).toBe('lumbar')
  })

  it('maps low back → lumbar', () => {
    expect(normalizeRegion('low back')).toBe('lumbar')
  })

  it('strips laterality prefix before lookup', () => {
    expect(normalizeRegion('Left Knee')).toBe('knee')
    expect(normalizeRegion('Bilateral Knees')).toBe('knee')
  })

  it('returns null for empty', () => {
    expect(normalizeRegion(null)).toBeNull()
    expect(normalizeRegion('')).toBeNull()
  })

  it('finds canonical via substring', () => {
    expect(normalizeRegion('Cervical spine — posterior')).toBe('cervical')
  })
})

describe('computePlanAlignment', () => {
  const performedLumbar = {
    injection_site: 'Lumbar L4-L5',
    sites: [
      {
        label: 'L4-L5',
        laterality: 'left' as 'left' | 'right' | 'bilateral' | null,
        volume_ml: null,
        target_confirmed_imaging: null,
      },
    ],
    guidance_method: 'ultrasound' as const,
  }

  it('returns no_plan_on_file when both sources are empty', () => {
    const result = computePlanAlignment({
      performed: performedLumbar,
      pmTreatmentPlan: null,
      initialVisitTreatmentPlan: null,
    })
    expect(result.status).toBe('no_plan_on_file')
    expect(result.planned).toBeNull()
    expect(result.mismatches).toEqual([])
  })

  it('returns no_plan_on_file when PM plan has no injection items', () => {
    const result = computePlanAlignment({
      performed: performedLumbar,
      pmTreatmentPlan: [
        { description: 'Continue physical therapy 3x/week', type: 'therapy', body_region: 'lumbar' },
        { description: 'Naproxen 500mg BID', type: 'medication', body_region: null },
      ],
      initialVisitTreatmentPlan: null,
    })
    expect(result.status).toBe('no_plan_on_file')
  })

  it('returns aligned when PM injection plan matches performed', () => {
    const result = computePlanAlignment({
      performed: performedLumbar,
      pmTreatmentPlan: [
        {
          description: 'PRP injection under ultrasound guidance',
          type: 'injection',
          body_region: 'lumbar',
        },
      ],
      initialVisitTreatmentPlan: null,
    })
    expect(result.status).toBe('aligned')
    expect(result.planned?.source).toBe('pm_extraction')
    expect(result.mismatches).toEqual([])
  })

  it('returns deviation on laterality mismatch', () => {
    const result = computePlanAlignment({
      performed: {
        ...performedLumbar,
        sites: [
          {
            label: 'L4-L5',
            laterality: 'right' as 'left' | 'right' | 'bilateral' | null,
            volume_ml: null,
            target_confirmed_imaging: null,
          },
        ],
      },
      pmTreatmentPlan: [
        {
          description: 'Left-sided PRP injection',
          type: 'injection',
          body_region: 'lumbar',
        },
      ],
      initialVisitTreatmentPlan: null,
    })
    expect(result.status).toBe('deviation')
    expect(result.mismatches).toContainEqual({
      field: 'laterality',
      planned: 'left',
      performed: 'right',
    })
  })

  it('returns deviation on guidance mismatch', () => {
    const result = computePlanAlignment({
      performed: { ...performedLumbar, guidance_method: 'fluoroscopy' },
      pmTreatmentPlan: [
        {
          description: 'PRP injection under ultrasound guidance',
          type: 'injection',
          body_region: 'lumbar',
        },
      ],
      initialVisitTreatmentPlan: null,
    })
    expect(result.status).toBe('deviation')
    expect(result.mismatches).toContainEqual({
      field: 'guidance_method',
      planned: 'ultrasound',
      performed: 'fluoroscopy',
    })
  })

  it('returns deviation on target levels divergence', () => {
    const result = computePlanAlignment({
      performed: { ...performedLumbar, injection_site: 'Lumbar L5-S1' },
      pmTreatmentPlan: [
        {
          description: 'PRP injection at L4-L5',
          type: 'injection',
          body_region: 'lumbar',
        },
      ],
      initialVisitTreatmentPlan: null,
    })
    expect(result.status).toBe('deviation')
    expect(
      result.mismatches.some((m) => m.field === 'target_levels'),
    ).toBe(true)
  })

  it('returns unplanned when plan exists but no candidate matches performed region', () => {
    const result = computePlanAlignment({
      performed: performedLumbar,
      pmTreatmentPlan: [
        {
          description: 'Cervical PRP injection',
          type: 'injection',
          body_region: 'cervical',
        },
      ],
      initialVisitTreatmentPlan: null,
    })
    expect(result.status).toBe('unplanned')
    expect(result.mismatches[0]).toMatchObject({
      field: 'body_region',
      performed: 'lumbar',
    })
  })

  it('falls back to initial visit plan narrative when PM has no injection items', () => {
    const result = computePlanAlignment({
      performed: performedLumbar,
      pmTreatmentPlan: [
        { description: 'Physical therapy', type: 'therapy', body_region: 'lumbar' },
      ],
      initialVisitTreatmentPlan:
        'The patient will continue conservative care. Plan to proceed with left-sided PRP injection to the lumbar spine at L4-L5 under ultrasound guidance within the next 2 weeks.',
    })
    expect(result.status).toBe('aligned')
    expect(result.planned?.source).toBe('initial_visit_note')
  })

  it('prefers PM candidate matching performed region over first PM item', () => {
    const result = computePlanAlignment({
      performed: performedLumbar,
      pmTreatmentPlan: [
        {
          description: 'Cervical PRP injection',
          type: 'injection',
          body_region: 'cervical',
        },
        {
          description: 'Lumbar PRP injection under ultrasound guidance',
          type: 'injection',
          body_region: 'lumbar',
        },
      ],
      initialVisitTreatmentPlan: null,
    })
    expect(result.status).toBe('aligned')
    expect(result.planned?.body_region).toBe('lumbar')
  })

  it('detects injection-like description even when type is not "injection"', () => {
    const result = computePlanAlignment({
      performed: performedLumbar,
      pmTreatmentPlan: [
        {
          description: 'PRP to lumbar spine under ultrasound',
          type: 'other',
          body_region: 'lumbar',
        },
      ],
      initialVisitTreatmentPlan: null,
    })
    expect(result.status).toBe('aligned')
  })

  it('treats missing planned laterality as non-mismatch', () => {
    const result = computePlanAlignment({
      performed: performedLumbar,
      pmTreatmentPlan: [
        {
          description: 'Lumbar PRP injection under ultrasound',
          type: 'injection',
          body_region: 'lumbar',
        },
      ],
      initialVisitTreatmentPlan: null,
    })
    // planned description has no laterality word → no mismatch on laterality
    expect(result.status).toBe('aligned')
  })

  it('aligns multi-region procedure (cervical + lumbar) when IV plan names both', () => {
    // Regression test for case ac41b1a7: bilateral C5-C6 + bilateral L5-S1
    // procedure with IV plan calling out both cervical and lumbar PRP must
    // classify as 'aligned', not 'unplanned'. Pre-fix the legacy
    // injection_site string ("Bilateral C5-C6, Bilateral L5-S1") collapsed
    // into a single unrecognised region and missed the plan match.
    const result = computePlanAlignment({
      performed: {
        injection_site: 'Bilateral C5-C6, Bilateral L5-S1',
        sites: [
          { label: 'C5-C6', laterality: 'bilateral', volume_ml: 3, target_confirmed_imaging: true },
          { label: 'L5-S1', laterality: 'bilateral', volume_ml: 3, target_confirmed_imaging: true },
        ],
        guidance_method: 'ultrasound',
      },
      pmTreatmentPlan: null,
      initialVisitTreatmentPlan:
        'Cervical Spine: Ultrasound-guided PRP injection at the C5-C6 level. Lumbar Spine: Ultrasound-guided PRP injection at the L5-S1 level.',
    })
    expect(result.status).toBe('aligned')
    expect(result.mismatches).toEqual([])
  })

  it('flags unplanned when performed multi-region has no plan match', () => {
    // Multi-region knee + shoulder procedure with only a lumbar plan should
    // still classify as 'unplanned' — the union semantics require ANY
    // performed region to match a plan, not all.
    const result = computePlanAlignment({
      performed: {
        injection_site: 'Bilateral knee, Right shoulder',
        sites: [
          { label: 'Right Knee', laterality: 'right', volume_ml: 3, target_confirmed_imaging: true },
          { label: 'Right Shoulder', laterality: 'right', volume_ml: 3, target_confirmed_imaging: true },
        ],
        guidance_method: 'ultrasound',
      },
      pmTreatmentPlan: [
        { description: 'Lumbar PRP injection', type: 'injection', body_region: 'lumbar' },
      ],
      initialVisitTreatmentPlan: null,
    })
    expect(result.status).toBe('unplanned')
  })

  it('normalizeRegion maps vertebral level prefixes to canonical region', () => {
    expect(normalizeRegion('C5-C6')).toBe('cervical')
    expect(normalizeRegion('L5-S1')).toBe('lumbar')
    expect(normalizeRegion('T12-L1')).toBe('thoracic')
    expect(normalizeRegion('S1')).toBe('lumbar')
  })

  it('treats mixed laterality across sites as incomparable (no laterality mismatch)', () => {
    const result = computePlanAlignment({
      performed: {
        ...performedLumbar,
        sites: [
          { label: 'L4-L5', laterality: 'left', volume_ml: null, target_confirmed_imaging: null },
          { label: 'L5-S1', laterality: 'right', volume_ml: null, target_confirmed_imaging: null },
        ],
      },
      pmTreatmentPlan: [
        {
          description: 'Left-sided lumbar PRP injection',
          type: 'injection',
          body_region: 'lumbar',
        },
      ],
      initialVisitTreatmentPlan: null,
    })
    // Mixed laterality is meta-state — does not fire single-laterality mismatch
    expect(result.mismatches.find((m) => m.field === 'laterality')).toBeUndefined()
  })
})
