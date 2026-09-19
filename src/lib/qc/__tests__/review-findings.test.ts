import { describe, expect, it } from 'vitest'
import { validateGroundedFinding, deriveReviewAssessment, type GroundedFinding } from '../review-findings'
import { identifyFinding, reconcileReviewFindings } from '../review-identity'
import type { ReviewSnapshot } from '../review-types'
import type { FindingOverrideEntry } from '@/lib/validations/case-quality-review'
const snapshot: ReviewSnapshot = {version:'qc-v3',case_id:'case',episode_id:'episode',episode_status:'active',coverage:{complete:true,limitations:[]},versions:[],notes:[{id:'note',step:'pain_follow_up',episode_id:'episode',encounter_id:'enc',procedure_id:null,status:'draft',date:'2026-01-01',sections:{assessment:'Left-sided pain',subjective:'Right-sided pain'},context:{},decision:{state:'absent',decision:null,details:null,reviewed_plan:null,visit_date:null}}],sources:[{id:'pain_follow_up_notes:note',type:'pain_follow_up_notes',scope:'episode',date:'2026-01-01',fields:{assessment:'Left-sided pain',subjective:'Right-sided pain',imaging_review:null}}]}
function finding(): GroundedFinding { return {rule_id:'anatomy_consistency',entity_key:'',severity:'warning',score:5,step:'pain_follow_up',note_id:'note',procedure_id:null,encounter_id:'enc',section_key:'assessment',message:'Side differs',rationale:null,suggested_tone_hint:null,evidence:[{source_id:'pain_follow_up_notes:note',field:'assessment',quote:'Left-sided pain',missing:false},{source_id:'pain_follow_up_notes:note',field:'subjective',quote:'Right-sided pain',missing:false}]} }
function disposition(status: FindingOverrideEntry['status']): FindingOverrideEntry { return {status,actor_user_id:'user',set_at:'date',resolved_at:null,resolution_source:null,dismissed_reason:null,edited_message:null,edited_rationale:null,edited_suggested_tone_hint:null,fix_attempted_at:null,fix_section_regenerated:null,fix_recheck_result:null} }
describe('grounded findings', () => {
  it('accepts supported comparisons with exact targets and real quotes', () => expect(validateGroundedFinding(finding(),snapshot,'ai')).toBeNull())
  it.each(['note','encounter','section','quote','rule','entity','one-source','missing'])('rejects invalid %s', kind => {
    const f = finding()
    if (kind === 'note') f.note_id = 'other'
    if (kind === 'encounter') f.encounter_id = 'other'
    if (kind === 'section') f.section_key = 'made_up'
    if (kind === 'quote') f.evidence[0].quote = 'invented'
    if (kind === 'rule') f.rule_id = 'm545_parent'
    if (kind === 'entity') f.entity_key = 'model invented identity'
    if (kind === 'one-source') f.evidence.pop()
    if (kind === 'missing') f.evidence[0] = {...f.evidence[0],missing:true,quote:null}
    expect(validateGroundedFinding(f,snapshot,'ai')).not.toBeNull()
  })
  it('retains identity after wording/severity changes, but fingerprints changed evidence', () => {
    const original = identifyFinding(finding(),snapshot,'ai')
    expect(identifyFinding({...finding(),message:'Rephrased',severity:'critical'},snapshot,'ai').key).toBe(original.key)
    const edited = structuredClone(snapshot)
    edited.sources[0].fields.assessment = 'Right-sided pain'
    expect(identifyFinding(finding(),edited,'ai').source_fingerprint).not.toBe(original.source_fingerprint)
  })
  it('reopens recurrence and records nondetection without verification', () => {
    const f = identifyFinding(finding(),snapshot,'ai')
    const resolved = {[f.key!]:disposition('resolved')}
    const recurrence = reconcileReviewFindings([f],[f],resolved,'now')
    expect(recurrence.overrides).toEqual({})
    expect(recurrence.transitions[0].outcome).toBe('recurring')
    expect(reconcileReviewFindings([f],[],resolved,'now').transitions[0].outcome).toBe('not_detected')
  })
  it('carries dispositions only while evidence and severity stay unchanged', () => {
    const f = identifyFinding(finding(),snapshot,'ai')
    const overrides = {[f.key!]:disposition('dismissed')}
    expect(reconcileReviewFindings([f],[f],overrides,'now').overrides).toEqual(overrides)
    expect(reconcileReviewFindings([f],[{...f,severity:'critical'}],overrides,'now').overrides).toEqual({})
    expect(reconcileReviewFindings([f],[{...f,source_fingerprint:'changed'}],overrides,'now').overrides).toEqual({})
  })
  it('derives assessment from all merged findings and dispositions', () => {
    const f = {...finding(),severity:'critical' as const,score:8}
    expect(deriveReviewAssessment([f],{},true,() => 'key').overall_assessment).toBe('major_issues')
    expect(deriveReviewAssessment([f],{key:disposition('dismissed')},true,() => 'key')).toMatchObject({overall_assessment:'clean',active_count:0,total_score:0})
    expect(deriveReviewAssessment([f],{key:disposition('acknowledged')},true,() => 'key').active_count).toBe(1)
    expect(deriveReviewAssessment([f],{},false,() => 'key').overall_assessment).toBe('incomplete')
  })
})
