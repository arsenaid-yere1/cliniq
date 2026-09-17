import { describe, expect, it } from 'vitest'
import { buildPrpTargetEvidence, validatePrpTargetSelections, type ImagingEvidenceRow } from './prp-target-evidence'

const imaging: ImagingEvidenceRow = {
  id: 'mri-1', source_table: 'mri_extractions', modality: 'MRI',
  body_region: 'Lumbar spine', study_date: '2026-08-01', laterality: null,
  findings: [{ level: 'L4-5', description: 'Disc protrusion with annular fissure' }],
}

const intake = {
  chief_complaints: { complaints: [{ body_region: 'Low back' }] },
  exam_findings: { regions: [{ region: 'Lumbar spine', palpation_findings: 'Focal tenderness', muscle_spasm: true }] },
}

describe('buildPrpTargetEvidence', () => {
  it('keeps cervical imaging levels associated with cervical clinical evidence', () => {
    const bundle = buildPrpTargetEvidence({
      imagingRows: [{ ...imaging, body_region: 'Cervical spine levels',
        findings: [{ level: 'C5-C6', description: 'Disc protrusion' }] }],
      providerIntake: {
        chief_complaints: { complaints: [{ body_region: 'Neck' }] },
        exam_findings: { regions: [{ region: 'Cervical', palpation_findings: 'Tenderness' }] },
      },
    })
    expect(bundle.candidates).toHaveLength(1)
    expect(bundle.candidates[0]).toMatchObject({
      region: 'cervical', level_or_location: 'C5-C6', eligible: true,
      anatomic_evidence_ids: ['mri-1:anatomic:0'],
      complaint_evidence_ids: ['current:complaint:0'],
      exam_evidence_ids: ['current:exam:0'],
      ineligibility_reasons: [],
    })
  })

  it('requires abnormal anatomy plus a current complaint and exam', () => {
    const bundle = buildPrpTargetEvidence({ imagingRows: [imaging], providerIntake: intake })
    expect(bundle.candidates).toHaveLength(1)
    expect(bundle.candidates[0]).toMatchObject({ region: 'lumbar', level_or_location: 'L4-L5', eligible: true })
  })

  it('keeps incidental anatomy but marks it ineligible', () => {
    const bundle = buildPrpTargetEvidence({ imagingRows: [imaging], providerIntake: null })
    expect(bundle.candidates[0].eligible).toBe(false)
    expect(bundle.candidates[0].ineligibility_reasons).toEqual([
      'missing_current_complaint', 'missing_current_exam',
    ])
  })

  it('applies provider overrides before normalization', () => {
    const bundle = buildPrpTargetEvidence({
      imagingRows: [{ ...imaging, provider_overrides: {
        body_region: 'Cervical spine', findings: [{ level: 'C5/6', description: 'Provider-confirmed protrusion' }],
      } }],
      providerIntake: {
        chief_complaints: { complaints: [{ body_region: 'Neck' }] },
        exam_findings: { regions: [{ region: 'Cervical', palpation_findings: 'Tenderness' }] },
      },
    })
    expect(bundle.candidates[0]).toMatchObject({ region: 'cervical', level_or_location: 'C5-C6', eligible: true })
    expect(bundle.anatomic_evidence[0].description).toBe('Provider-confirmed protrusion')
  })

  it('does not cross-support incompatible laterality', () => {
    const bundle = buildPrpTargetEvidence({
      imagingRows: [{ ...imaging, body_region: 'Right knee', laterality: 'right',
        findings: [{ level: 'patellar tendon', description: 'Tendinosis' }] }],
      providerIntake: {
        chief_complaints: { complaints: [{ body_region: 'Left knee' }] },
        exam_findings: { regions: [{ region: 'Left knee', palpation_findings: 'Tenderness' }] },
      },
    })
    expect(bundle.candidates[0].eligible).toBe(false)
    expect(bundle.candidates[0].ineligibility_reasons).toContain('laterality_mismatch')
  })
})

describe('validatePrpTargetSelections', () => {
  const selection = {
    candidate_id: 'lumbar|L4-L5|unspecified', target_structure: 'facet-capsular structures',
    guidance_method: 'ultrasound' as const, approach: 'periarticular', clinical_rationale: 'Concordant pain and focal exam findings.',
  }

  it('hydrates trusted evidence from an eligible candidate', () => {
    const bundle = buildPrpTargetEvidence({ imagingRows: [imaging], providerIntake: intake })
    const result = validatePrpTargetSelections([selection], bundle)
    expect(result.error).toBeUndefined()
    expect(result.data?.[0]).toMatchObject({ region: 'lumbar', level_or_location: 'L4-L5' })
    expect(result.data?.[0].anatomic_evidence_ids).toEqual(['mri-1:anatomic:0'])
  })

  it('rejects unknown and ineligible targets', () => {
    const eligible = buildPrpTargetEvidence({ imagingRows: [imaging], providerIntake: intake })
    expect(validatePrpTargetSelections([{ ...selection, candidate_id: 'invented' }], eligible).error).toContain('Unknown')
    const ineligible = buildPrpTargetEvidence({ imagingRows: [imaging], providerIntake: null })
    expect(validatePrpTargetSelections([selection], ineligible).error).toContain('Ineligible')
  })

  it('requires ultrasound guidance for PRP recommendations', () => {
    const bundle = buildPrpTargetEvidence({ imagingRows: [imaging], providerIntake: intake })
    const result = validatePrpTargetSelections([
      { ...selection, guidance_method: 'fluoroscopy' },
    ], bundle)
    expect(result.error).toContain('must use ultrasound guidance')
  })
})

describe('current exam assessment completeness', () => {
  function evidence(palpation_findings: string, additional_findings: string, muscle_spasm: boolean | null = null) {
    return buildPrpTargetEvidence({ imagingRows: [imaging], providerIntake: { ...intake, exam_findings: {
      regions: [{ region: 'Lumbar spine', palpation_findings, additional_findings, muscle_spasm }],
    } } })
  }
  it.each([null, false, true])('preserves the existing spasm-only evidence policy for %s', value => {
    const bundle = evidence('', '', value)
    expect(bundle.candidates[0].eligible).toBe(value === true)
    expect(bundle.clinical_evidence.filter(item => item.source === 'current_exam')).toHaveLength(value === true ? 1 : 0)
  })
  it.each([
    'Palpation of Left lumbar region limited by pain',
    'Palpation of Left lumbar region not performed: declined',
    'Examination of Left lumbar region limited by clothing',
    'Active motion at Left lumbar region not assessed: pain',
    'Squatting not assessed: declined',
    'Straight leg raise, Left: Not performed — declined (symptom response: Not tested)',
    'Straight leg raise, Right: Unable to complete — positioning (symptom response: Not tested)',
  ])('does not count an unavailable assessment: %s', phrase => {
    expect(evidence(phrase.startsWith('Palpation') ? phrase : '', phrase.startsWith('Palpation') ? '' : phrase).candidates[0].eligible).toBe(false)
  })
  it('retains actual findings from mixed rows without including unavailable segments', () => {
    const bundle = evidence('Palpation of Left lumbar region limited by pain; Tenderness at Left lumbar region', 'Squatting not assessed: declined')
    expect(bundle.candidates[0].eligible).toBe(true)
    const exam = bundle.clinical_evidence.find(item => item.source === 'current_exam')!
    expect(exam.description).toBe('Lumbar spine: Tenderness at Left lumbar region')
  })
  it('preserves the bytes and ordering of custom evidence text', () => {
    const bundle = evidence('Custom;  spacing\n preserved', 'Additional;  text', true)
    expect(bundle.clinical_evidence.find(item => item.source === 'current_exam')?.description).toBe('Lumbar spine: Custom;  spacing\n preserved; Muscle spasm present; Additional;  text')
  })
  it.each(['Custom prose: examination incomplete, focal tenderness observed', 'Straight leg raise, Left: Negative — no symptoms (symptom response: No symptoms)', 'Straight leg raise, Left: Positive — leg pain (symptom response: Leg symptoms)'])('retains documented findings: %s', phrase => {
    expect(evidence('', phrase).candidates[0].eligible).toBe(true)
  })
})
