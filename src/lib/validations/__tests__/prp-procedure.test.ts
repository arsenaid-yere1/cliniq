import { describe, it, expect } from 'vitest'
import { prpProcedureFormSchema } from '../prp-procedure'

const validForm = {
  procedure_date: '2025-03-01',
  injection_site: 'Right knee',
  laterality: 'right' as const,
  diagnoses: [
    { icd10_code: 'M17.11', description: 'Primary osteoarthritis, right knee' },
  ],
  consent_obtained: true,
  pain_rating: 6,
  vital_signs: {
    bp_systolic: 120,
    bp_diastolic: 80,
    heart_rate: 72,
    respiratory_rate: 16,
    temperature_f: 98.6,
    spo2_percent: 98,
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
    target_confirmed_imaging: true,
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
    expect(prpProcedureFormSchema().safeParse(validForm).success).toBe(true)
  })

  // --- Required top-level fields ---

  it('rejects empty procedure_date', () => {
    expect(
      prpProcedureFormSchema().safeParse({ ...validForm, procedure_date: '' }).success,
    ).toBe(false)
  })

  it('rejects empty injection_site', () => {
    expect(
      prpProcedureFormSchema().safeParse({ ...validForm, injection_site: '' }).success,
    ).toBe(false)
  })

  it('rejects empty diagnoses array', () => {
    expect(
      prpProcedureFormSchema().safeParse({ ...validForm, diagnoses: [] }).success,
    ).toBe(false)
  })

  // --- Laterality enum ---

  it('accepts all laterality values', () => {
    for (const val of ['left', 'right', 'bilateral']) {
      expect(
        prpProcedureFormSchema().safeParse({ ...validForm, laterality: val }).success,
      ).toBe(true)
    }
  })

  it('rejects invalid laterality', () => {
    expect(
      prpProcedureFormSchema().safeParse({ ...validForm, laterality: 'both' }).success,
    ).toBe(false)
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

  // --- Pain rating ---

  it('accepts pain_rating as null', () => {
    expect(
      prpProcedureFormSchema().safeParse({ ...validForm, pain_rating: null }).success,
    ).toBe(true)
  })

  it('accepts pain_rating boundary values 0 and 10', () => {
    expect(prpProcedureFormSchema().safeParse({ ...validForm, pain_rating: 0 }).success).toBe(true)
    expect(prpProcedureFormSchema().safeParse({ ...validForm, pain_rating: 10 }).success).toBe(true)
  })

  it('rejects pain_rating out of range', () => {
    expect(prpProcedureFormSchema().safeParse({ ...validForm, pain_rating: -1 }).success).toBe(false)
    expect(prpProcedureFormSchema().safeParse({ ...validForm, pain_rating: 11 }).success).toBe(false)
  })

  // --- Vital signs ---

  it('accepts all vital signs as null', () => {
    const result = prpProcedureFormSchema().safeParse({
      ...validForm,
      vital_signs: {
        bp_systolic: null, bp_diastolic: null, heart_rate: null,
        respiratory_rate: null, temperature_f: null, spo2_percent: null,
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

  it('accepts target_confirmed_imaging as null', () => {
    expect(prpProcedureFormSchema().safeParse({
      ...validForm,
      injection: { ...validForm.injection, target_confirmed_imaging: null },
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
})
