import { describe, expect, it } from 'vitest'
import { buildPrpTargetEvidence, validatePrpTargetSelections } from './prp-target-evidence'
import { renderPrpTreatmentPlan } from './render-prp-treatment-plan'

describe('renderPrpTreatmentPlan', () => {
  const bundle = buildPrpTargetEvidence({
    imagingRows: [{ id: 'ct-1', source_table: 'ct_scan_extractions', modality: 'CT',
      body_region: 'Lumbar', study_date: '2026-08-01', findings: [{ level: 'L5-S1', description: 'Facet arthropathy' }] }],
    providerIntake: { chief_complaints: { complaints: [{ body_region: 'Low back' }] },
      exam_findings: { regions: [{ region: 'Lumbar', palpation_findings: 'Focal tenderness' }] } },
  })

  it('renders validated ultrasound targets in the prior narrative template', () => {
    const validated = validatePrpTargetSelections([{ candidate_id: bundle.candidates[0].id,
      target_structure: 'facet-capsular structures', guidance_method: 'ultrasound', approach: 'periarticular',
      clinical_rationale: 'The focal examination is concordant.' }], bundle).data!
    const text = renderPrpTreatmentPlan(
      'Clinical rationale.\n\n[[PRP_TARGET_RECOMMENDATIONS]]\n\nContinue rehabilitation.',
      validated,
      bundle,
    )
    expect(text).toContain('Given the incomplete response to conservative measures')
    expect(text).toContain('• Lumbar Spine: Ultrasound-guided PRP injections at L5-S1')
    expect(text).toContain('targeting the facet-mediated pain generators at this level, where the corresponding facet pathology is documented')
    expect(text).toContain('An initial staged course of one to three injection sessions is planned')
    expect(text).toContain('The patient will be re-evaluated after each injection')
    expect(text).toContain('persistent functional impairment support additional treatment')
    expect(text.indexOf('Clinical rationale.')).toBeLessThan(text.indexOf('Given the incomplete response'))
    expect(text.indexOf('Given the incomplete response')).toBeLessThan(text.indexOf('Continue rehabilitation.'))
  })

  it('does not add target confirmation text when no target qualifies', () => {
    const text = renderPrpTreatmentPlan('Clinical rationale.\n\n[[PRP_TARGET_RECOMMENDATIONS]]\n\nContinue care.', [], bundle)
    expect(text).toBe('Clinical rationale.\n\nContinue care.')
  })

  it('groups multiple supported spinal levels into one regional bullet', () => {
    const multiLevelBundle = buildPrpTargetEvidence({
      imagingRows: [{
        id: 'mri-cervical', source_table: 'mri_extractions', modality: 'MRI',
        body_region: 'Cervical spine', study_date: '2026-08-01',
        findings: [
          { level: 'C5-C6', description: 'Disc protrusion with foraminal narrowing' },
          { level: 'C6-C7', description: 'Disc bulge with annular fissure' },
        ],
      }],
      providerIntake: {
        chief_complaints: { complaints: [{ body_region: 'Neck' }] },
        exam_findings: { regions: [{ region: 'Cervical spine', palpation_findings: 'Focal tenderness' }] },
      },
    })
    const validated = validatePrpTargetSelections(
      multiLevelBundle.candidates.map((candidate) => ({
        candidate_id: candidate.id,
        target_structure: 'documented pain generator',
        guidance_method: 'ultrasound' as const,
        approach: 'targeted',
        clinical_rationale: 'Concordant current symptoms and examination findings.',
      })),
      multiLevelBundle,
    ).data!

    const text = renderPrpTreatmentPlan('[[PRP_TARGET_RECOMMENDATIONS]]', validated, multiLevelBundle)
    expect(text).toContain('• Cervical Spine: Ultrasound-guided PRP injections at C5-C6 and C6-C7')
    expect(text).toContain('targeting the discogenic pain generators at these levels, where the most significant disc pathology and foraminal narrowing are documented')
    expect(text).not.toContain('Disc protrusion with foraminal narrowing')
    expect(text.match(/• Cervical Spine:/g)).toHaveLength(1)
  })

  it('summarizes shoulder targets without repeating full imaging findings', () => {
    const shoulderBundle = buildPrpTargetEvidence({
      imagingRows: [{
        id: 'mri-shoulder', source_table: 'mri_extractions', modality: 'MRI',
        body_region: 'Left shoulder', laterality: 'left', study_date: '2026-08-01',
        findings: [
          { level: 'conjoined supraspinatus and infraspinatus tendons', description: 'Full thickness rotator cuff tear measuring 11 x 7 mm.' },
          { level: 'subacromial/subdeltoid bursa', description: 'Moderate bursitis.' },
          { level: 'long head of biceps tendon', description: 'Severe bicipital tenosynovitis.' },
        ],
      }],
      providerIntake: {
        chief_complaints: { complaints: [{ body_region: 'Left shoulder' }] },
        exam_findings: { regions: [{ region: 'Left shoulder', palpation_findings: 'Focal tenderness' }] },
      },
    })
    const validated = validatePrpTargetSelections(shoulderBundle.candidates.map((candidate) => ({
      candidate_id: candidate.id, target_structure: 'verbose model target', guidance_method: 'ultrasound' as const,
      approach: 'targeted', clinical_rationale: 'Concordant.',
    })), shoulderBundle).data!
    const text = renderPrpTreatmentPlan('[[PRP_TARGET_RECOMMENDATIONS]]', validated, shoulderBundle)
    expect(text).toContain('• Left Shoulder: Ultrasound-guided PRP injection targeting the rotator cuff tear, the subacromial/subdeltoid bursa and the biceps tendon sheath.')
    expect(text).not.toContain('11 x 7 mm')
    expect(text).not.toContain('verbose model target')
  })
})
