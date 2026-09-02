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

  it('renders target evidence without relabeling the modality', () => {
    const validated = validatePrpTargetSelections([{ candidate_id: bundle.candidates[0].id,
      target_structure: 'facet-capsular structures', guidance_method: 'ultrasound', approach: 'periarticular',
      clinical_rationale: 'The focal examination is concordant.' }], bundle).data!
    const text = renderPrpTreatmentPlan('Continue rehabilitation.', validated, bundle)
    expect(text).toContain('CT 08/01/2026: Facet arthropathy')
    expect(text).not.toContain('MRI')
    expect(text).toContain('Clinical target justification')
  })

  it('renders a non-PRP plan when no target qualifies', () => {
    const text = renderPrpTreatmentPlan('Continue conservative care.', [], bundle)
    expect(text).toContain('No PRP treatment target is established')
    expect(text).toContain('Continue conservative care.')
  })
})
