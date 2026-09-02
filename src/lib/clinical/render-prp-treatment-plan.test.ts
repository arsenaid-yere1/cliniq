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
    expect(text).toContain('Facet arthropathy is documented and clinically concordant')
    expect(text).toContain('Treatment will proceed in a staged manner')
    expect(text).toContain('Any subsequent injection is not predetermined')
    expect(text).toContain('current clinical findings establish continued medical necessity')
    expect(text).toContain('material risks, expected benefits, reasonable alternatives')
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
    expect(text.match(/• Cervical Spine:/g)).toHaveLength(1)
  })
})
