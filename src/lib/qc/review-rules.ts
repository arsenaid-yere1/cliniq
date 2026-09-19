export const AI_REVIEW_RULES = {
  symptom_consistency: 'Compare documented symptoms, their resolution, diagnoses, and current plans.',
  anatomy_consistency: 'Compare site, laterality, examination, imaging, and performed procedures.',
  medication_consistency: 'Compare documented medication, allergy, dose, route, and unit statements. Do not infer prescribing policy.',
  chronology_consistency: 'Compare known dates; do not invent dates or treat unknown timing as a contradiction.',
  decision_consistency: 'Compare current saved decisions, their reviewed plans, education, and recommendations. Historical decisions do not confirm a changed plan.',
  plan_consistency: 'Compare applicable dated plans with indications and performed care, allowing documented explanations.',
  diagnosis_consistency: 'Compare current narrative and structured diagnoses with available dated clinical evidence.',
  follow_up_consistency: 'Compare interval history, recommendations, education, and return instructions; recommendations are not orders or consent.',
  consent_consistency: 'Distinguish telehealth consent, treatment decisions, and procedure consent; absence of evidence is not refusal.',
  copied_narrative: 'Identify unexplained copied visit-specific prose; exclude expected disclaimers, education boilerplate, and historical quotations.',
} as const
export type AiReviewRule = keyof typeof AI_REVIEW_RULES
export const DETERMINISTIC_REVIEW_RULES = [
  'banned_hedge','forbidden_phrase','duplicate_across_sections','bad_date_format','section_too_short',
  'required_section','m545_parent','external_cause_missing','external_cause_excluded','encounter_suffix',
  'trajectory_value','trajectory_endpoint','trajectory_arrow',
  'telehealth_exam','telehealth_vitals','stale_decision',
] as const
export type DeterministicReviewRule = typeof DETERMINISTIC_REVIEW_RULES[number]
export type ReviewRule = AiReviewRule | DeterministicReviewRule
export function isDeterministicReviewRule(rule: string): rule is DeterministicReviewRule {
  return (DETERMINISTIC_REVIEW_RULES as readonly string[]).includes(rule)
}
