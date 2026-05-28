import { describe, it, expect } from 'vitest'
import { curateInputDataForPrompt } from '@/lib/claude/context-bundle'

describe('curateInputDataForPrompt', () => {
  it('drops null and empty-array fields not in the preserved set', () => {
    const out = curateInputDataForPrompt({
      patientInfo: { first_name: 'A' },
      mriExtractions: [],
      caseSummary: null,
      pmExtraction: { chief_complaints: [] },
      pmSupplementaryDiagnoses: [],
    })
    expect(out.patientInfo).toEqual({ first_name: 'A' })
    expect(out.mriExtractions).toBeUndefined()
    expect(out.caseSummary).toBeUndefined()
    expect(out.pmSupplementaryDiagnoses).toBeUndefined()
    expect(out.pmExtraction).toEqual({ chief_complaints: [] })
  })

  it('preserves pain/trajectory fields even when null or empty', () => {
    const out = curateInputDataForPrompt({
      paintoneLabel: null,
      paintoneSignals: { vsBaseline: 'baseline', vsPrevious: null },
      painObservations: [],
      planAlignment: { status: 'no_plan_on_file' },
      diagnosisPool: [],
    })
    expect(Object.keys(out)).toEqual(
      expect.arrayContaining([
        'paintoneLabel',
        'paintoneSignals',
        'painObservations',
        'planAlignment',
        'diagnosisPool',
      ]),
    )
  })

  it('summarizes prior procedure note section text to first 3 sentences', () => {
    const out = curateInputDataForPrompt({
      priorProcedureNotes: [
        {
          procedure_date: '2026-01-01',
          sections: {
            subjective: 'One. Two. Three. Four. Five.',
            assessment_summary: null,
            procedure_injection: null,
            assessment_and_plan: null,
            prognosis: null,
          },
        },
      ],
    })
    const prior = (out.priorProcedureNotes as Array<{ sections: { subjective: string | null } }>)[0]
    expect(prior.sections.subjective).toBe('One. Two. Three. …')
  })

  it('passes through short prior-note sections unchanged', () => {
    const out = curateInputDataForPrompt({
      priorProcedureNotes: [
        {
          sections: {
            subjective: 'Short note.',
            assessment_summary: null,
            procedure_injection: null,
            assessment_and_plan: null,
            prognosis: null,
          },
        },
      ],
    })
    const prior = (out.priorProcedureNotes as Array<{ sections: { subjective: string | null } }>)[0]
    expect(prior.sections.subjective).toBe('Short note.')
  })
})
