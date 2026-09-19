import { buildReviewTrajectory } from './review-trajectory'
import { validateDischargeTrajectoryConsistency } from '@/lib/claude/pain-trajectory-validator'
import type { DischargeNoteResult } from '@/lib/validations/discharge-note'
import { validateNarrative } from './narrative-validator'
import { validateTelehealthFollowUpOutput } from './telehealth-follow-up'
import { ACCIDENT_TYPE_EXPECTATIONS, isExternalCauseCode } from '@/lib/icd10/external-cause'
import { isInitialEncounterSuffix } from '@/lib/icd10/seventh-character'
import { defaultScoreForSeverity } from '@/lib/validations/case-quality-review'
import type { PainFollowUpNoteResult } from '@/lib/validations/pain-follow-up-note'
import type { ReviewSnapshot, ReviewNote, ReviewValue } from './review-types'
import type { GroundedFinding } from './review-findings'
import type { DeterministicReviewRule } from './review-rules'

const sourceTables = {initial_visit:'initial_visit_notes',pain_evaluation:'initial_visit_notes',procedure:'procedure_notes',discharge:'discharge_notes',pain_follow_up:'pain_follow_up_notes'} as const
export function noteSourceId(note: ReviewNote) { return `${sourceTables[note.step]}:${note.id}` }
export function originalDiagnosisCodes(text: string | null): string[] {
  return [...new Set((text?.match(/\b[A-TV-Z]\d[0-9A-Z](?:\.[0-9A-Z]{1,4})?\b/gi) ?? []).map(code => code.toUpperCase()))]
}
function object(value: ReviewValue | undefined): Record<string,ReviewValue> { return value && typeof value === 'object' && !Array.isArray(value) ? value : {} }
export function validateReviewSnapshot(snapshot: ReviewSnapshot): GroundedFinding[] {
  const findings: GroundedFinding[] = []
  const accidentType = snapshot.sources.find(s => s.type === 'cases')?.fields.accident_type
  const expectation = typeof accidentType === 'string' ? ACCIDENT_TYPE_EXPECTATIONS[accidentType] : null
  for (const note of snapshot.notes) {
    if (!['draft','finalized'].includes(note.status)) continue
    function add(rule: DeterministicReviewRule,section: string | null,message: string,entity = '',severity: 'info' | 'warning' | 'critical' = 'warning',field = section ?? 'status') {
      const value = Object.hasOwn(note.sections,field) ? note.sections[field] : Object.hasOwn(note.context,field) ? note.context[field] : field === 'decision' ? {...note.decision} : note.status
      const absent = value === null || value === ''
      findings.push({rule_id:rule,entity_key:entity,severity,step:note.step,note_id:note.id,procedure_id:note.procedure_id,encounter_id:note.encounter_id,section_key:section,message,rationale:'Checked against the current saved source.',suggested_tone_hint:null,score:defaultScoreForSeverity(severity),provenance:'deterministic',evidence:[{source_id:noteSourceId(note),field,quote:absent ? null : typeof value === 'string' ? value : JSON.stringify(value),missing:absent}]})
    }
    const narrativeScope = Object.keys(note.sections).filter(s => !['clinician_disclaimer','patient_education','allergies','current_medications','diagnoses','objective_vitals','time_complexity_attestation'].includes(s))
    for (const warning of validateNarrative(note.sections,{duplicateScope:narrativeScope,lengthScope:narrativeScope})) {
      const target = warning.section.split('+')[0]
      add(warning.code,target,warning.message,warning.code === 'duplicate_across_sections' ? warning.section : '',warning.code === 'forbidden_phrase' ? 'warning' : 'info')
    }
    // Existing follow-up edit schema permits empty narrative strings; do not invent min-length requirements.
    if (note.step !== 'pain_follow_up') for (const [section,text] of Object.entries(note.sections)) {
      if (!text?.trim()) add('required_section',section,`Required section ${section} is empty.`)
    }
    const rawStructured = note.context.diagnoses
    const codes = note.step === 'procedure' && Array.isArray(rawStructured)
      ? rawStructured.flatMap(d => typeof object(d).icd10_code === 'string' ? [String(object(d).icd10_code).toUpperCase()] : [])
      : originalDiagnosisCodes(note.sections.diagnoses)
    const diagnosisSection = note.step === 'procedure' ? null : 'diagnoses'
    for (const code of codes) {
      if (code === 'M54.5') add('m545_parent',diagnosisSection,'M54.5 is a parent code; review the required specific subcode.',code,'warning','diagnoses')
      if (['procedure','discharge'].includes(note.step) && isExternalCauseCode(code)) add('external_cause_excluded',diagnosisSection,`External cause code ${code} is excluded from this note type by existing coding policy.`,code,'critical','diagnoses')
      if (!isExternalCauseCode(code) && isInitialEncounterSuffix(code) && (note.step === 'discharge' || (note.step === 'procedure' && Number(note.context.procedure_number) >= 2))) add('encounter_suffix',diagnosisSection,`Initial-encounter code ${code} conflicts with the existing subsequent-encounter coding rule.`,code,note.step === 'discharge' ? 'critical' : 'warning','diagnoses')
    }
    if (expectation && ['initial_visit','pain_evaluation'].includes(note.step) && !codes.some(c => c.startsWith(expectation.prefix))) add('external_cause_missing','diagnoses',`Expected accident-related external cause code (${expectation.example}) is absent.`,expectation.prefix)
    if (note.status === 'draft' && note.decision.state === 'stale') add('stale_decision',null,'The saved treatment decision refers to a different plan or visit date. Review and save the decision again.','','warning','decision')
    if (note.step === 'pain_follow_up' && object(note.context.encounter).modality === 'telehealth') {
      for (const section of ['telehealth_observations','assessment']) {
        const text = note.sections[section]
        if (!text) continue
        const result = validateTelehealthFollowUpOutput({telehealth_observations:text,assessment:''} as PainFollowUpNoteResult)
        if (result.error) add(result.error.includes('vital signs') ? 'telehealth_vitals' : 'telehealth_exam',section,result.error)
      }
    }
  }
  const discharge = snapshot.notes.find(n => n.step === 'discharge' && ['draft','finalized'].includes(n.status))
  const trajectory = buildReviewTrajectory(snapshot)
  if (discharge && trajectory) {
    const result = validateDischargeTrajectoryConsistency(Object.fromEntries(Object.entries(discharge.sections).map(([k,v]) => [k,v ?? ''])) as DischargeNoteResult,trajectory)
    for (const issue of result.issues ?? []) findings.push({
      rule_id:issue.code,entity_key:issue.code === 'trajectory_value' ? issue.value : '',severity:'warning',score:5,step:'discharge',note_id:discharge.id,procedure_id:null,encounter_id:discharge.encounter_id,section_key:issue.section,message:issue.message,rationale:'Compared with the current dated source readings; estimated endpoints remain labeled as estimates.',suggested_tone_hint:null,provenance:'deterministic',evidence:[
        {source_id:noteSourceId(discharge),field:issue.section,quote:discharge.sections[issue.section] ?? null,missing:!discharge.sections[issue.section]},
        {source_id:`qc_trajectory:${discharge.id}`,field:'arrowChain',quote:trajectory.arrowChain,missing:false},
      ],
    })
  }
  return findings
}
