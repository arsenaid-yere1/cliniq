import { describe, it, expect } from 'vitest'
import { prpProcedureFormSchema } from '../prp-procedure'

const validForm = {
  procedure_date: '2025-03-01',
  sites: [
    {
      label: 'Knee',
      laterality: 'right' as const,
      volume_ml: 5,
      target_confirmed_imaging: true,
    },
  ],
  diagnoses: [
    { icd10_code: 'M17.11', description: 'Primary osteoarthritis, right knee' },
  ],
  consent_obtained: true,
  vital_signs: {
    bp_systolic: 120,
    bp_diastolic: 80,
    heart_rate: 72,
    respiratory_rate: 16,
    temperature_f: 98.6,
    spo2_percent: 98,
    pain_score_min: 3,
    pain_score_max: 6,
  },
  prp_preparation: {
    blood_draw_volume_ml: 60,
    centrifuge_duration_min: 15,
    prep_protocol: 'Double-spin protocol',
    kit_lot_number: 'LOT-2025-001',
  },
  anesthesia: {
    anesthetic_agent: 'Lidocaine 1%',
    anesthetic_dose_ml: 5,
    patient_tolerance: 'tolerated_well' as const,
  },
  injection: {
    injection_volume_ml: 5,
    needle_gauge: '22G',
    guidance_method: 'ultrasound' as const,
    target_structure: null,
  },
  post_procedure: {
    complications: 'None',
    supplies_used: 'Sterile drape, betadine',
    compression_bandage: true,
    activity_restriction_hrs: 48,
  },
}

describe('prpProcedureFormSchema', () => {
  it('accepts valid complete form', () => {
    const result = prpProcedureFormSchema().safeParse(validForm)
    if (!result.success) console.error(result.error)
    expect(result.success).toBe(true)
  })

  // --- Required top-level fields ---

  it('rejects empty procedure_date', () => {
    expect(
      prpProcedureFormSchema().safeParse({ ...validForm, procedure_date: '' }).success,
    ).toBe(false)
  })

  it('rejects empty sites array', () => {
    expect(
      prpProcedureFormSchema().safeParse({ ...validForm, sites: [] }).success,
    ).toBe(false)
  })

  it('rejects site with empty label', () => {
    expect(
      prpProcedureFormSchema().safeParse({
        ...validForm,
        sites: [{ label: '', laterality: null, volume_ml: null, target_confirmed_imaging: null }],
      }).success,
    ).toBe(false)
  })

  it('rejects empty diagnoses array', () => {
    expect(
      prpProcedureFormSchema().safeParse({ ...validForm, diagnoses: [] }).success,
    ).toBe(false)
  })

  // --- Site laterality enum ---

  it('accepts all laterality values per-site', () => {
    for (const val of ['left', 'right', 'bilateral']) {
      expect(
        prpProcedureFormSchema().safeParse({
          ...validForm,
          sites: [{ label: 'Knee', laterality: val, volume_ml: 5, target_confirmed_imaging: true }],
        }).success,
      ).toBe(true)
    }
  })

  it('accepts site laterality as null', () => {
    expect(
      prpProcedureFormSchema().safeParse({
        ...validForm,
        sites: [{ label: 'Knee', laterality: null, volume_ml: 5, target_confirmed_imaging: null }],
      }).success,
    ).toBe(true)
  })

  it('rejects invalid site laterality', () => {
    expect(
      prpProcedureFormSchema().safeParse({
        ...validForm,
        sites: [{ label: 'Knee', laterality: 'both', volume_ml: 5, target_confirmed_imaging: null }],
      }).success,
    ).toBe(false)
  })

  // --- Per-site volume sum check ---

  it('accepts when all per-site volumes sum to total', () => {
    expect(
      prpProcedureFormSchema().safeParse({
        ...validForm,
        sites: [
          { label: 'L4-L5', laterality: null, volume_ml: 3, target_confirmed_imaging: null },
          { label: 'L5-S1', laterality: null, volume_ml: 3, target_confirmed_imaging: null },
        ],
        injection: { ...validForm.injection, injection_volume_ml: 6 },
      }).success,
    ).toBe(true)
  })

  it('accepts within 0.1 mL float tolerance', () => {
    expect(
      prpProcedureFormSchema().safeParse({
        ...validForm,
        sites: [
          { label: 'L4-L5', laterality: null, volume_ml: 3.05, target_confirmed_imaging: null },
          { label: 'L5-S1', laterality: null, volume_ml: 2.95, target_confirmed_imaging: null },
        ],
        injection: { ...validForm.injection, injection_volume_ml: 6 },
      }).success,
    ).toBe(true)
  })

  it('rejects when per-site sum mismatches total', () => {
    expect(
      prpProcedureFormSchema().safeParse({
        ...validForm,
        sites: [
          { label: 'L4-L5', laterality: null, volume_ml: 3, target_confirmed_imaging: null },
          { label: 'L5-S1', laterality: null, volume_ml: 3, target_confirmed_imaging: null },
        ],
        injection: { ...validForm.injection, injection_volume_ml: 5 },
      }).success,
    ).toBe(false)
  })

  it('skips sum check when any site volume is null (provider-entered total)', () => {
    expect(
      prpProcedureFormSchema().safeParse({
        ...validForm,
        sites: [
          { label: 'L4-L5', laterality: null, volume_ml: 3, target_confirmed_imaging: null },
          { label: 'L5-S1', laterality: null, volume_ml: null, target_confirmed_imaging: null },
        ],
        injection: { ...validForm.injection, injection_volume_ml: 6 },
      }).success,
    ).toBe(true)
  })

  // --- Diagnosis validation ---

  it('rejects empty icd10_code in diagnosis', () => {
    expect(
      prpProcedureFormSchema().safeParse({
        ...validForm,
        diagnoses: [{ icd10_code: '', description: 'Osteoarthritis' }],
      }).success,
    ).toBe(false)
  })

  it('rejects empty description in diagnosis', () => {
    expect(
      prpProcedureFormSchema().safeParse({
        ...validForm,
        diagnoses: [{ icd10_code: 'M17.11', description: '' }],
      }).success,
    ).toBe(false)
  })

  // --- Vital signs (including pain range) ---

  it('accepts all vital signs as null', () => {
    const result = prpProcedureFormSchema().safeParse({
      ...validForm,
      vital_signs: {
        bp_systolic: null, bp_diastolic: null, heart_rate: null,
        respiratory_rate: null, temperature_f: null, spo2_percent: null,
        pain_score_min: null, pain_score_max: null,
      },
    })
    expect(result.success).toBe(true)
  })

  it('rejects out-of-range vital signs', () => {
    expect(prpProcedureFormSchema().safeParse({
      ...validForm,
      vital_signs: { ...validForm.vital_signs, bp_systolic: 301 },
    }).success).toBe(false)
  })

  it('accepts pain score boundary values 0 and 10', () => {
    expect(prpProcedureFormSchema().safeParse({
      ...validForm,
      vital_signs: { ...validForm.vital_signs, pain_score_min: 0, pain_score_max: 10 },
    }).success).toBe(true)
  })

  it('rejects pain score out of range', () => {
    expect(prpProcedureFormSchema().safeParse({
      ...validForm,
      vital_signs: { ...validForm.vital_signs, pain_score_max: 11 },
    }).success).toBe(false)
    expect(prpProcedureFormSchema().safeParse({
      ...validForm,
      vital_signs: { ...validForm.vital_signs, pain_score_min: -1 },
    }).success).toBe(false)
  })

  it('rejects pain_score_min greater than pain_score_max', () => {
    expect(prpProcedureFormSchema().safeParse({
      ...validForm,
      vital_signs: { ...validForm.vital_signs, pain_score_min: 8, pain_score_max: 3 },
    }).success).toBe(false)
  })

  it('accepts pain range when only one side provided', () => {
    expect(prpProcedureFormSchema().safeParse({
      ...validForm,
      vital_signs: { ...validForm.vital_signs, pain_score_min: null, pain_score_max: 5 },
    }).success).toBe(true)
    expect(prpProcedureFormSchema().safeParse({
      ...validForm,
      vital_signs: { ...validForm.vital_signs, pain_score_min: 2, pain_score_max: null },
    }).success).toBe(true)
  })

  // --- PRP preparation ---

  it('rejects non-positive blood_draw_volume_ml', () => {
    expect(prpProcedureFormSchema().safeParse({
      ...validForm,
      prp_preparation: { ...validForm.prp_preparation, blood_draw_volume_ml: 0 },
    }).success).toBe(false)
  })

  it('accepts centrifuge_duration_min as null', () => {
    expect(prpProcedureFormSchema().safeParse({
      ...validForm,
      prp_preparation: { ...validForm.prp_preparation, centrifuge_duration_min: null },
    }).success).toBe(true)
  })

  // --- Anesthesia ---

  it('rejects empty anesthetic_agent', () => {
    expect(prpProcedureFormSchema().safeParse({
      ...validForm,
      anesthesia: { ...validForm.anesthesia, anesthetic_agent: '' },
    }).success).toBe(false)
  })

  it('accepts patient_tolerance as null', () => {
    expect(prpProcedureFormSchema().safeParse({
      ...validForm,
      anesthesia: { ...validForm.anesthesia, patient_tolerance: null },
    }).success).toBe(true)
  })

  it('rejects invalid patient_tolerance', () => {
    expect(prpProcedureFormSchema().safeParse({
      ...validForm,
      anesthesia: { ...validForm.anesthesia, patient_tolerance: 'fine' },
    }).success).toBe(false)
  })

  // --- Injection ---

  it('rejects non-positive injection_volume_ml', () => {
    expect(prpProcedureFormSchema().safeParse({
      ...validForm,
      injection: { ...validForm.injection, injection_volume_ml: 0 },
    }).success).toBe(false)
  })

  it('accepts all guidance_method values', () => {
    for (const val of ['ultrasound', 'fluoroscopy', 'landmark']) {
      expect(prpProcedureFormSchema().safeParse({
        ...validForm,
        injection: { ...validForm.injection, guidance_method: val },
      }).success).toBe(true)
    }
  })

  it('rejects invalid guidance_method', () => {
    expect(prpProcedureFormSchema().safeParse({
      ...validForm,
      injection: { ...validForm.injection, guidance_method: 'palpation' },
    }).success).toBe(false)
  })

  it('accepts site target_confirmed_imaging as null', () => {
    expect(prpProcedureFormSchema().safeParse({
      ...validForm,
      sites: [{ label: 'Knee', laterality: 'right', volume_ml: 5, target_confirmed_imaging: null }],
    }).success).toBe(true)
  })

  // --- Post-procedure ---

  it('rejects empty complications', () => {
    expect(prpProcedureFormSchema().safeParse({
      ...validForm,
      post_procedure: { ...validForm.post_procedure, complications: '' },
    }).success).toBe(false)
  })

  it('accepts compression_bandage as null', () => {
    expect(prpProcedureFormSchema().safeParse({
      ...validForm,
      post_procedure: { ...validForm.post_procedure, compression_bandage: null },
    }).success).toBe(true)
  })

  it('accepts activity_restriction_hrs as null', () => {
    expect(prpProcedureFormSchema().safeParse({
      ...validForm,
      post_procedure: { ...validForm.post_procedure, activity_restriction_hrs: null },
    }).success).toBe(true)
  })

  it('rejects non-positive activity_restriction_hrs', () => {
    expect(prpProcedureFormSchema().safeParse({
      ...validForm,
      post_procedure: { ...validForm.post_procedure, activity_restriction_hrs: 0 },
    }).success).toBe(false)
  })

  // --- target_structure (B2) ---

  it('accepts target_structure as null', () => {
    expect(prpProcedureFormSchema().safeParse({
      ...validForm,
      injection: { ...validForm.injection, target_structure: null },
    }).success).toBe(true)
  })

  it('accepts all target_structure values', () => {
    for (const val of [
      'periarticular', 'facet_capsular', 'intradiscal', 'epidural',
      'transforaminal', 'sacroiliac_adjacent', 'intra_articular',
    ]) {
      expect(prpProcedureFormSchema().safeParse({
        ...validForm,
        injection: { ...validForm.injection, target_structure: val },
      }).success).toBe(true)
    }
  })

  it('rejects invalid target_structure', () => {
    expect(prpProcedureFormSchema().safeParse({
      ...validForm,
      injection: { ...validForm.injection, target_structure: 'made_up' },
    }).success).toBe(false)
  })

  // --- C3 consent gate ---

  it('accepts consent_obtained=true with empty plan_deviation_reason', () => {
    expect(prpProcedureFormSchema().safeParse({
      ...validForm,
      consent_obtained: true,
      plan_deviation_reason: '',
    }).success).toBe(true)
  })

  it('rejects consent_obtained=false with empty plan_deviation_reason', () => {
    const result = prpProcedureFormSchema().safeParse({
      ...validForm,
      consent_obtained: false,
      plan_deviation_reason: '',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message)
      expect(messages).toContain('Plan deviation reason required when consent is not obtained.')
    }
  })

  it('rejects consent_obtained=false with whitespace-only plan_deviation_reason', () => {
    expect(prpProcedureFormSchema().safeParse({
      ...validForm,
      consent_obtained: false,
      plan_deviation_reason: '   \n  ',
    }).success).toBe(false)
  })

  it('accepts consent_obtained=false with substantive plan_deviation_reason', () => {
    expect(prpProcedureFormSchema().safeParse({
      ...validForm,
      consent_obtained: false,
      plan_deviation_reason: 'Patient verbally consented; written consent pending file recovery.',
    }).success).toBe(true)
  })
})
