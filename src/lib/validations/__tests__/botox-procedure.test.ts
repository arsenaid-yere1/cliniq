import { describe, it, expect } from 'vitest'
import { botoxProcedureFormSchema } from '../botox-procedure'

// Sandaljian TMJ case: masseter + temporalis, 60 U administered, 40 U discarded, 100-U vial.
const validForm = {
  procedure_date: '2026-05-29',
  sites: [
    { label: 'Masseter', laterality: 'right' as const, volume_ml: null, target_confirmed_imaging: null, points: 3, units: 20 },
    { label: 'Masseter', laterality: 'left' as const, volume_ml: null, target_confirmed_imaging: null, points: 3, units: 20 },
    { label: 'Temporalis', laterality: 'right' as const, volume_ml: null, target_confirmed_imaging: null, points: 2, units: 10 },
    { label: 'Temporalis', laterality: 'left' as const, volume_ml: null, target_confirmed_imaging: null, points: 2, units: 10 },
  ],
  diagnoses: [
    { icd10_code: 'M26.623', description: 'Arthralgia of bilateral temporomandibular joint' },
    { icd10_code: 'M79.11', description: 'Myalgia of mastication muscle' },
  ],
  consent_obtained: true,
  vital_signs: {
    bp_systolic: null,
    bp_diastolic: null,
    heart_rate: null,
    respiratory_rate: null,
    temperature_f: null,
    spo2_percent: null,
    pain_score_min: null,
    pain_score_max: null,
  },
  botox_dosing: {
    product_name: 'BOTOX Cosmetic (onabotulinumtoxinA)',
    ndc: '0023-9232-01',
    lot_number: 'D0801C2',
    expiration: '2028-03',
    reconstitution_units: 100,
    reconstitution_diluent_ml: 3.0,
    units_administered: 60,
    units_discarded: 40,
  },
  needle_gauge: '30-gauge',
  complications: 'None',
}

describe('botoxProcedureFormSchema', () => {
  it('accepts the valid Sandaljian-style form', () => {
    const result = botoxProcedureFormSchema().safeParse(validForm)
    if (!result.success) console.error(result.error)
    expect(result.success).toBe(true)
  })

  it('accepts all-null vitals (BOTOX note has no vitals block)', () => {
    const result = botoxProcedureFormSchema().safeParse(validForm)
    expect(result.success).toBe(true)
  })

  // --- Vial reconciliation ---
  it('rejects when administered + discarded != vial total', () => {
    const bad = { ...validForm, botox_dosing: { ...validForm.botox_dosing, units_discarded: 30 } }
    const result = botoxProcedureFormSchema().safeParse(bad)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join('.') === 'botox_dosing.units_discarded')).toBe(true)
    }
  })

  it('accepts 100 administered + 0 discarded (whole vial used)', () => {
    const whole = {
      ...validForm,
      sites: validForm.sites.map((s) => ({ ...s, units: 25 })), // 4 × 25 = 100
      botox_dosing: { ...validForm.botox_dosing, units_administered: 100, units_discarded: 0 },
    }
    const result = botoxProcedureFormSchema().safeParse(whole)
    if (!result.success) console.error(result.error)
    expect(result.success).toBe(true)
  })

  // --- Per-site units sum ---
  it('rejects when per-site units sum != units_administered', () => {
    const bad = {
      ...validForm,
      sites: validForm.sites.map((s, i) => (i === 0 ? { ...s, units: 25 } : s)), // sum = 65, not 60
    }
    const result = botoxProcedureFormSchema().safeParse(bad)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join('.') === 'botox_dosing.units_administered')).toBe(true)
    }
  })

  it('skips per-site sum check when any site lacks units', () => {
    const partial = {
      ...validForm,
      sites: validForm.sites.map((s, i) => (i === 0 ? { ...s, units: null } : s)),
    }
    const result = botoxProcedureFormSchema().safeParse(partial)
    expect(result.success).toBe(true) // vial still reconciles; per-site check skipped
  })

  // --- Required dosing fields ---
  it('rejects missing product_name', () => {
    const bad = { ...validForm, botox_dosing: { ...validForm.botox_dosing, product_name: '' } }
    expect(botoxProcedureFormSchema().safeParse(bad).success).toBe(false)
  })

  it('rejects non-positive reconstitution_units', () => {
    const bad = {
      ...validForm,
      sites: validForm.sites.map((s) => ({ ...s, units: 0 })),
      botox_dosing: { ...validForm.botox_dosing, reconstitution_units: 0, units_administered: 60, units_discarded: 40 },
    }
    expect(botoxProcedureFormSchema().safeParse(bad).success).toBe(false)
  })

  // --- Consent gate (mirrors PRP) ---
  it('requires plan_deviation_reason when consent not obtained', () => {
    const bad = { ...validForm, consent_obtained: false }
    const result = botoxProcedureFormSchema().safeParse(bad)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join('.') === 'plan_deviation_reason')).toBe(true)
    }
  })

  it('accepts consent not obtained with a deviation reason', () => {
    const ok = { ...validForm, consent_obtained: false, plan_deviation_reason: 'Patient declined written consent form; verbal consent documented.' }
    const result = botoxProcedureFormSchema().safeParse(ok)
    expect(result.success).toBe(true)
  })

  // --- Date order ---
  it('rejects procedure_date before earliestDate', () => {
    const result = botoxProcedureFormSchema({ earliestDate: '2026-06-01' }).safeParse(validForm)
    expect(result.success).toBe(false)
  })

  // --- Required top-level ---
  it('rejects empty sites', () => {
    const bad = { ...validForm, sites: [] }
    expect(botoxProcedureFormSchema().safeParse(bad).success).toBe(false)
  })

  it('rejects empty diagnoses', () => {
    const bad = { ...validForm, diagnoses: [] }
    expect(botoxProcedureFormSchema().safeParse(bad).success).toBe(false)
  })
})
