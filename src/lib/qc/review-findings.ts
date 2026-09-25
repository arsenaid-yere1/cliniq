import { z } from 'zod'
import { qualityFindingSchema, type FindingOverridesMap, type QualityFinding, type QcOverallAssessment, getFindingScore } from '@/lib/validations/case-quality-review'
import { AI_REVIEW_RULES, isDeterministicReviewRule } from './review-rules'
import { reviewSections, type ReviewSnapshot, type ReviewNoteStep, type ReviewValue } from './review-types'

export const reviewEvidenceSchema = z.object({ source_id:z.string(),field:z.string(),quote:z.string().nullable(),missing:z.boolean(),source_date:z.string().nullable().optional() })
export const groundedFindingSchema = qualityFindingSchema.extend({
  rule_id:z.string(), entity_key:z.string().max(120), evidence:z.array(reviewEvidenceSchema).min(1),
  key:z.string().optional(), provenance:z.enum(['ai','deterministic']).optional(), source_fingerprint:z.string().optional(),
})
export type GroundedFinding = z.infer<typeof groundedFindingSchema>
export type FindingTransition = { key:string; finding:GroundedFinding; outcome:'not_detected' | 'verified_resolved' | 'recurring'; at:string; previous_disposition?:FindingOverridesMap[string] | null }
export function sourceField(fields: Record<string,ReviewValue>, path: string): {exists:boolean;value:ReviewValue | undefined} {
  const parts = path.split('.')
  let value: ReviewValue | undefined = fields
  for (const part of parts) {
    if (['__proto__','prototype','constructor'].includes(part) || value === null || typeof value !== 'object' || !Object.hasOwn(value,part)) return {exists:false,value:undefined}
    value = (value as Record<string,ReviewValue>)[part]
  }
  return {exists:true,value}
}
export function validateGroundedFinding(finding: GroundedFinding, snapshot: ReviewSnapshot, provenance: 'ai' | 'deterministic'): string | null {
  if (provenance === 'ai' && !Object.hasOwn(AI_REVIEW_RULES,finding.rule_id)) return 'Unsupported AI rule'
  if (provenance === 'deterministic' && !isDeterministicReviewRule(finding.rule_id)) return 'Unsupported deterministic rule'
  const note = snapshot.notes.find(n => n.id === finding.note_id)
  if (finding.step === 'cross_step') {
    if (finding.note_id || finding.procedure_id || finding.encounter_id || finding.section_key) return 'Cross-step findings cannot have a single editor target'
  } else if (finding.step === 'case_summary') {
    if (finding.procedure_id || finding.encounter_id || finding.section_key || !snapshot.sources.some(s => s.type === 'case_summaries' && s.id === `case_summaries:${finding.note_id}`)) return 'Invalid summary target'
  } else {
    if (!note || note.step !== finding.step || note.procedure_id !== finding.procedure_id || note.encounter_id !== (finding.encounter_id ?? null)) return 'Finding target does not match source note'
    if (!['draft','finalized'].includes(note.status)) return 'Unfinished note cannot support a narrative finding'
    if (finding.section_key && !(reviewSections[finding.step as ReviewNoteStep] as readonly string[]).includes(finding.section_key)) return 'Unknown note section'
  }
  for (const evidence of finding.evidence) {
    const source = snapshot.sources.find(s => s.id === evidence.source_id)
    if (!source || source.fields.available === false) return 'Unavailable source reference'
    if (source.scope === 'historical_episode' && !source.date) return 'Undated historical evidence is unavailable'
    const field = sourceField(source.fields,evidence.field)
    if (!field.exists) return 'Unknown evidence field'
    if (evidence.missing) {
      if (evidence.quote !== null || !(field.value === null || field.value === '' || (Array.isArray(field.value) && !field.value.length))) return 'Invalid missing evidence claim'
    } else {
      const text = typeof field.value === 'string' ? field.value : JSON.stringify(field.value)
      if (!evidence.quote || !text?.includes(evidence.quote)) return 'Evidence quote not found in current source'
    }
    if (note?.date && source.date && (source.scope === 'case' || source.scope === 'historical_episode') && source.date.slice(0,10) > note.date.slice(0,10)) return 'Later evidence cannot establish an earlier note contradiction'
  }
  if (provenance === 'ai') {
    const references = new Set(finding.evidence.map(e => `${e.source_id}:${e.field}:${e.quote}`))
    if (references.size < 2) return 'Consistency findings require two distinct evidence references'
    if (finding.entity_key !== '') return 'AI identity is aggregated per rule and target; entity_key must be empty'
  }
  return null
}
export function findingIsActive(entry: FindingOverridesMap[string] | undefined): boolean {
  return !entry || !['dismissed','resolved'].includes(entry.status)
}
export function deriveReviewAssessment(findings: QualityFinding[], overrides: FindingOverridesMap, complete: boolean, keyOf: (f: QualityFinding) => string) {
  const active = findings.filter(f => findingIsActive(overrides[keyOf(f)]))
  const assessment: QcOverallAssessment = !complete ? 'incomplete' : active.some(f => f.severity === 'critical') ? 'major_issues' : active.length ? 'minor_issues' : 'clean'
  return { overall_assessment:assessment,summary:`${active.length} outstanding finding${active.length === 1 ? '' : 's'}; ${findings.length - active.length} dispositioned.${complete ? '' : ' Review coverage is incomplete.'}`,total_score:active.reduce((sum,f) => sum + getFindingScore(f),0),active_count:active.length }
}
