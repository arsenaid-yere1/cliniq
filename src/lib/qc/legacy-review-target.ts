import type { QualityReviewInputData } from '@/lib/claude/generate-quality-review'
import type { QualityFinding } from '@/lib/validations/case-quality-review'

/** History is evidence, never a target. Also used for persisted legacy findings. */
export function validateLegacyReviewTarget(finding: QualityFinding, input: QualityReviewInputData): string | null {
  const invalid = 'Finding target does not match a current episode note. Reload the review.'
  if (finding.step === 'cross_step') return finding.note_id || finding.procedure_id || finding.encounter_id || finding.section_key ? invalid : null
  if (finding.step === 'case_summary') return !input.caseSummary || finding.procedure_id || finding.encounter_id || (finding.note_id && finding.note_id !== input.caseSummary.id) ? invalid : null
  const target = finding.step === 'initial_visit' ? input.initialVisitNote
    : finding.step === 'pain_evaluation' ? input.painEvaluationNote
    : finding.step === 'discharge' ? input.dischargeNote
    : finding.step === 'procedure' ? input.procedureNotes.find(n => n.id === finding.note_id)
    : input.painFollowUpNotes?.find(n => n.id === finding.note_id)
  if (!target || target.id !== finding.note_id) return invalid
  const procedureId = 'procedure_id' in target ? target.procedure_id : null
  const encounterId = 'encounter_id' in target ? target.encounter_id ?? null : null
  // Older evaluation/discharge findings did not carry an encounter ID. A
  // supplied ID must match; follow-up fixes always require the exact encounter.
  if (finding.procedure_id !== procedureId || (finding.encounter_id != null && finding.encounter_id !== encounterId)
    || (finding.step === 'pain_follow_up' && finding.encounter_id !== encounterId)) return invalid
  return null
}
