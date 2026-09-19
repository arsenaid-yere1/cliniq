import { describe, it, expect } from 'vitest'
import { validateReviewSnapshot, originalDiagnosisCodes } from '../review-validators'
import { validateGroundedFinding } from '../review-findings'
import { reviewSections, type ReviewNoteStep, type ReviewSnapshot } from '../review-types'
function fixture(step: ReviewNoteStep): ReviewSnapshot {
  const sections = Object.fromEntries(reviewSections[step].map(section => [section,`${section} documents the current clinical record with sufficient explanatory detail for this visit.`]))
  if (step !== 'procedure') sections.diagnoses = 'Low back pain (M54.5)'
  const table = {initial_visit:'initial_visit_notes',pain_evaluation:'initial_visit_notes',pain_follow_up:'pain_follow_up_notes',procedure:'procedure_notes',discharge:'discharge_notes'}[step]
  return {version:'qc-v3',case_id:'case',episode_id:'episode',episode_status:'active',versions:[],coverage:{complete:true,limitations:[]},notes:[{id:'note',step,episode_id:'episode',encounter_id:'enc',procedure_id:step === 'procedure' ? 'proc' : null,status:'draft',date:'2026-01-01',sections,context:step === 'procedure' ? {diagnoses:[{icd10_code:'M54.5'}]} : {},decision:{state:'absent',decision:null,details:null,reviewed_plan:null,visit_date:null}}],sources:[{id:`${table}:note`,type:table,scope:'episode',date:null,fields:{...sections,diagnoses:step === 'procedure' ? [{icd10_code:'M54.5'}] : sections.diagnoses}}]}
}
describe('current-source validators', () => {
  it('does not normalize original parent codes before checking them', () => expect(originalDiagnosisCodes('Pain M54.5 and M54.50')).toEqual(['M54.5','M54.50']))
  it.each(Object.keys(reviewSections) as ReviewNoteStep[])('checks parent codes on %s', step => {
    const snapshot = fixture(step)
    const findings = validateReviewSnapshot(snapshot)
    expect(findings.some(f => f.rule_id === 'm545_parent')).toBe(true)
    for (const f of findings) expect(validateGroundedFinding(f,snapshot,'deterministic')).toBeNull()
  })
  it('does not interpret unfinished output as completed narrative', () => {
    const snapshot = fixture('pain_follow_up')
    snapshot.notes[0].status = 'failed'
    expect(validateReviewSnapshot(snapshot)).toEqual([])
  })
  it('checks current prose independently of saved generation warnings', () => {
    const snapshot = fixture('pain_follow_up')
    snapshot.notes[0].sections.interval_history = 'This guarantees full recovery.'
    expect(validateReviewSnapshot(snapshot).some(f => f.rule_id === 'forbidden_phrase' && f.section_key === 'interval_history')).toBe(true)
  })
  it('restricts telehealth examination checks to documented telehealth modality', () => {
    const snapshot = fixture('pain_follow_up')
    snapshot.notes[0].sections.telehealth_observations = 'Strength is 5/5.'
    snapshot.notes[0].context.encounter = {modality:'in_person'}
    expect(validateReviewSnapshot(snapshot).some(f => f.rule_id === 'telehealth_exam')).toBe(false)
    snapshot.notes[0].context.encounter = {modality:'telehealth'}
    expect(validateReviewSnapshot(snapshot).some(f => f.rule_id === 'telehealth_exam')).toBe(true)
    snapshot.notes[0].sections.telehealth_observations = 'Strength was not assessed by telehealth.'
    expect(validateReviewSnapshot(snapshot).some(f => f.rule_id === 'telehealth_exam')).toBe(false)
  })
})
