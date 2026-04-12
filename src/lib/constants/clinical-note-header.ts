// Shared helpers for the medical-legal header block that appears at the top
// of clinical notes (Initial Visit, Pain Evaluation Visit, Discharge Note).
//
// Convention — per medical-legal best practice (treating-provider records
// read by plaintiff/defense attorneys and adjusters):
//
//   Reason for Visit = medical etiology, not legal claim classification.
//   Visit Type       = encounter purpose (Initial Evaluation, PRP Follow-Up).
//
// "Personal injury" is a legal-claim phrase and does not belong in a medical
// necessity field — defense attorneys cite that framing as evidence that the
// clinician organized the record around the lawsuit rather than the patient.
// Instead, describe the clinical condition (post-traumatic musculoskeletal
// pain) and subordinate the causal event to an etiology clause.
//
// "Motor vehicle accident" is avoided in favor of "motor vehicle collision"
// per current trauma-medicine and public-health convention (Stewart & Lord,
// 2002): "accident" implies an unavoidable event and has been deprecated.

export type AccidentType = 'auto' | 'slip_and_fall' | 'workplace' | 'other'

const REASON_FOR_VISIT_BY_ACCIDENT_TYPE: Record<AccidentType, string> = {
  auto: 'Post-traumatic musculoskeletal pain following motor vehicle collision',
  slip_and_fall: 'Post-traumatic musculoskeletal pain following slip-and-fall injury',
  workplace: 'Post-traumatic musculoskeletal pain sustained in workplace injury',
  other: 'Post-traumatic musculoskeletal pain following traumatic injury',
}

/**
 * "Reason for Visit" header value — medical etiology framing.
 * Used on the Initial Visit and Discharge Note header blocks (visit notes).
 * Procedure notes use "Clinical Indication" with ICD-10-first content, which
 * is a separate convention and not produced by this helper.
 */
export function formatReasonForVisit(accidentType: string | null | undefined): string {
  if (!accidentType) return REASON_FOR_VISIT_BY_ACCIDENT_TYPE.other
  const label = REASON_FOR_VISIT_BY_ACCIDENT_TYPE[accidentType as AccidentType]
  return label ?? REASON_FOR_VISIT_BY_ACCIDENT_TYPE.other
}

/**
 * "Visit Type" header value — encounter purpose.
 * Maps the stored visit_type code to a medical-legal label.
 */
export function formatVisitTypeLabel(
  visitType: 'initial_visit' | 'pain_evaluation_visit' | null | undefined,
): string {
  if (visitType === 'pain_evaluation_visit') return 'Pain Management Evaluation'
  return 'Initial Evaluation'
}
