import { describe, expect, it } from 'vitest'
import {
  validateExternalCauseChain,
  validateSeventhCharacterIntegrity,
  SECTION_QC_EXTERNAL_CAUSE_CHAIN,
  SECTION_QC_SEVENTH_CHARACTER_INTEGRITY,
} from '../diagnosis-validators'
import { computeFindingHash } from '@/lib/validations/case-quality-review'
import type { QualityReviewInputData } from '@/lib/claude/generate-quality-review'

const IVN_ID = '11111111-1111-1111-1111-111111111111'
const PROC_NOTE_1_ID = '22222222-2222-2222-2222-222222222221'
const PROC_NOTE_2_ID = '22222222-2222-2222-2222-222222222222'
const PROC_NOTE_3_ID = '22222222-2222-2222-2222-222222222223'
const PROC_1_ID = '33333333-3333-3333-3333-333333333331'
const PROC_2_ID = '33333333-3333-3333-3333-333333333332'
const PROC_3_ID = '33333333-3333-3333-3333-333333333333'
const DC_ID = '44444444-4444-4444-4444-444444444444'

function baseInput(
  overrides: Partial<QualityReviewInputData> = {},
): QualityReviewInputData {
  return {
    caseDetails: {
      case_number: 'C-001',
      accident_type: null,
      accident_date: null,
    },
    patientInfo: {
      first_name: 'Test',
      last_name: 'Patient',
      date_of_birth: null,
      age: null,
    },
    caseSummary: null,
    initialVisitNote: null,
    painEvaluationNote: null,
    procedureNotes: [],
    dischargeNote: null,
    extractionsSummary: {
      mri_count: 0,
      pt_count: 0,
      pm_count: 0,
      chiro_count: 0,
      ortho_count: 0,
      ct_count: 0,
      xray_count: 0,
    },
    ...overrides,
  }
}

function makeIvnNote(diagnosesText: string): QualityReviewInputData['initialVisitNote'] {
  return {
    id: IVN_ID,
    visit_type: 'initial_visit',
    visit_date: '2026-01-01',
    status: 'finalized',
    diagnoses: diagnosesText,
    chief_complaint: null,
    physical_exam: null,
    treatment_plan: null,
    medical_necessity: null,
    prognosis: null,
    raw_ai_response: null,
  }
}

function makeProcNote(args: {
  id: string
  procedure_id: string
  procedure_number: number
  diagnoses: Array<{ icd10_code: string; description: string }>
}): QualityReviewInputData['procedureNotes'][number] {
  return {
    id: args.id,
    procedure_id: args.procedure_id,
    procedure_date: '2026-02-01',
    procedure_number: args.procedure_number,
    status: 'finalized',
    subjective: null,
    assessment_summary: null,
    procedure_injection: null,
    assessment_and_plan: null,
    prognosis: null,
    plan_alignment_status: 'aligned',
    pain_score_min: null,
    pain_score_max: null,
    diagnoses: args.diagnoses,
    raw_ai_response: null,
  }
}

function makeDischarge(diagnosesText: string): QualityReviewInputData['dischargeNote'] {
  return {
    id: DC_ID,
    visit_date: '2026-04-01',
    status: 'finalized',
    subjective: null,
    objective_vitals: null,
    diagnoses: diagnosesText,
    assessment: null,
    plan_and_recommendations: null,
    prognosis: null,
    pain_score_max: null,
    pain_trajectory_text: null,
    raw_ai_response: null,
  }
}

describe('validateExternalCauseChain', () => {
  it('flags V code on procedure note (critical)', () => {
    const input = baseInput({
      procedureNotes: [
        makeProcNote({
          id: PROC_NOTE_1_ID,
          procedure_id: PROC_1_ID,
          procedure_number: 1,
          diagnoses: [
            { icd10_code: 'V43.52XA', description: 'Car collision, initial' },
            { icd10_code: 'M54.50', description: 'Low back pain' },
          ],
        }),
      ],
    })
    const findings = validateExternalCauseChain(input)
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('critical')
    expect(findings[0].step).toBe('procedure')
    expect(findings[0].section_key).toBe(SECTION_QC_EXTERNAL_CAUSE_CHAIN)
    expect(findings[0].message).toContain('V43.52XA')
    expect(findings[0].message).toContain('procedure note 1')
  })

  it('flags V code on discharge (critical)', () => {
    const input = baseInput({
      dischargeNote: makeDischarge('• V43.52XA — Car collision\n• M54.50 — Low back pain'),
    })
    const findings = validateExternalCauseChain(input)
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('critical')
    expect(findings[0].step).toBe('discharge')
    expect(findings[0].message).toContain('V43.52XA')
  })

  it('warning when accident_type=auto but IV missing V code', () => {
    const input = baseInput({
      caseDetails: { case_number: 'C', accident_type: 'auto', accident_date: null },
      initialVisitNote: makeIvnNote('• M54.50 — Low back pain'),
    })
    const findings = validateExternalCauseChain(input)
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('warning')
    expect(findings[0].step).toBe('initial_visit')
    expect(findings[0].message).toContain('accident_type=auto')
  })

  it('no IV finding when V code present and accident_type=auto', () => {
    const input = baseInput({
      caseDetails: { case_number: 'C', accident_type: 'auto', accident_date: null },
      initialVisitNote: makeIvnNote('• V43.52XA — Car collision\n• M54.50 — Low back pain'),
    })
    expect(validateExternalCauseChain(input)).toHaveLength(0)
  })

  it('no IV finding when accident_type is null', () => {
    const input = baseInput({
      initialVisitNote: makeIvnNote('• M54.50 — Low back pain'),
    })
    expect(validateExternalCauseChain(input)).toHaveLength(0)
  })

  it('multiple V/W codes on a procedure note → multiple findings', () => {
    const input = baseInput({
      procedureNotes: [
        makeProcNote({
          id: PROC_NOTE_2_ID,
          procedure_id: PROC_2_ID,
          procedure_number: 2,
          diagnoses: [
            { icd10_code: 'V43.52XA', description: 'Car' },
            { icd10_code: 'W18.49XA', description: 'Workplace' },
          ],
        }),
      ],
    })
    expect(validateExternalCauseChain(input)).toHaveLength(2)
  })

  it('no findings on a clean case', () => {
    const input = baseInput({
      caseDetails: { case_number: 'C', accident_type: 'auto', accident_date: null },
      initialVisitNote: makeIvnNote('• V43.52XA — Car\n• M54.50 — LBP'),
      procedureNotes: [
        makeProcNote({
          id: PROC_NOTE_1_ID,
          procedure_id: PROC_1_ID,
          procedure_number: 1,
          diagnoses: [{ icd10_code: 'M54.50', description: 'LBP' }],
        }),
      ],
      dischargeNote: makeDischarge('• M54.50 — LBP'),
    })
    expect(validateExternalCauseChain(input)).toHaveLength(0)
  })
})

describe('validateSeventhCharacterIntegrity', () => {
  it('A-suffix at discharge → critical', () => {
    const input = baseInput({
      dischargeNote: makeDischarge('• S33.5XXA — Lumbar sprain, initial encounter'),
    })
    const findings = validateSeventhCharacterIntegrity(input)
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('critical')
    expect(findings[0].step).toBe('discharge')
    expect(findings[0].message).toContain('S33.5XXA')
  })

  it('A-suffix on procedure_number=1 → no finding (intake encounter)', () => {
    const input = baseInput({
      procedureNotes: [
        makeProcNote({
          id: PROC_NOTE_1_ID,
          procedure_id: PROC_1_ID,
          procedure_number: 1,
          diagnoses: [{ icd10_code: 'S13.4XXA', description: 'Cervical sprain' }],
        }),
      ],
    })
    expect(validateSeventhCharacterIntegrity(input)).toHaveLength(0)
  })

  it('A-suffix on procedure_number=3 → warning', () => {
    const input = baseInput({
      procedureNotes: [
        makeProcNote({
          id: PROC_NOTE_3_ID,
          procedure_id: PROC_3_ID,
          procedure_number: 3,
          diagnoses: [{ icd10_code: 'S13.4XXA', description: 'Cervical sprain' }],
        }),
      ],
    })
    const findings = validateSeventhCharacterIntegrity(input)
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('warning')
    expect(findings[0].message).toContain('procedure note #3')
  })

  it('M54.5 parent in procedure jsonb → warning (free-text M54.5 auto-normalized by parseIvnDiagnoses)', () => {
    const input = baseInput({
      // parseIvnDiagnoses normalizes M54.5 → M54.50 via NON_BILLABLE_PARENT_CODES,
      // so free-text IV / discharge entries don't trip the parent guard. Only
      // raw jsonb on procedures.diagnoses (which bypasses parseIvnDiagnoses)
      // surfaces here.
      initialVisitNote: makeIvnNote('• M54.5 — Low back pain'),
      dischargeNote: makeDischarge('• M54.5 — Low back pain'),
      procedureNotes: [
        makeProcNote({
          id: PROC_NOTE_2_ID,
          procedure_id: PROC_2_ID,
          procedure_number: 2,
          diagnoses: [{ icd10_code: 'M54.5', description: 'Low back pain' }],
        }),
      ],
    })
    const findings = validateSeventhCharacterIntegrity(input)
    const parentFindings = findings.filter((f) => f.message.includes('M54.5 parent'))
    expect(parentFindings).toHaveLength(1)
    expect(parentFindings[0].step).toBe('procedure')
  })

  it('skips external-cause codes (handled by other validator)', () => {
    const input = baseInput({
      dischargeNote: makeDischarge('• V43.52XA — Car collision'),
    })
    expect(validateSeventhCharacterIntegrity(input)).toHaveLength(0)
  })

  it('hash stability: repeated calls produce identical finding hashes', () => {
    const input = baseInput({
      dischargeNote: makeDischarge('• S33.5XXA — Lumbar sprain, initial encounter\n• M54.5 — LBP'),
      procedureNotes: [
        makeProcNote({
          id: PROC_NOTE_2_ID,
          procedure_id: PROC_2_ID,
          procedure_number: 2,
          diagnoses: [{ icd10_code: 'S13.4XXA', description: 'Cervical sprain' }],
        }),
      ],
    })
    const run1 = validateSeventhCharacterIntegrity(input).map(computeFindingHash)
    const run2 = validateSeventhCharacterIntegrity(input).map(computeFindingHash)
    expect(run2).toEqual(run1)
    expect(new Set(run1).size).toBe(run1.length) // all distinct
  })
})

describe('hash stability across both validators', () => {
  it('external-cause findings hash identically run-to-run', () => {
    const input = baseInput({
      caseDetails: { case_number: 'C', accident_type: 'auto', accident_date: null },
      initialVisitNote: makeIvnNote('• V43.52XA — Car\n• M54.50'),
      procedureNotes: [
        makeProcNote({
          id: PROC_NOTE_1_ID,
          procedure_id: PROC_1_ID,
          procedure_number: 1,
          diagnoses: [{ icd10_code: 'V43.52XA', description: 'Car' }],
        }),
      ],
    })
    const run1 = validateExternalCauseChain(input).map(computeFindingHash)
    const run2 = validateExternalCauseChain(input).map(computeFindingHash)
    expect(run2).toEqual(run1)
  })
})
