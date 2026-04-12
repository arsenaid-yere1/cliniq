// Shared helpers for the medical-legal header block that appears at the top
// of clinical notes (Initial Visit, Pain Evaluation Visit, Discharge Note).
//
// Convention — per medical-legal best practice:
//   Indication = cause / injury context ("Personal injury — motor vehicle accident")
//   Visit Type = encounter purpose ("Initial Evaluation", "Pain Management Evaluation")
//
// Attorneys and adjusters scan Indication to confirm causation to the accident;
// Visit Type identifies the phase of care.

export type AccidentType = 'auto' | 'slip_and_fall' | 'workplace' | 'other'

const ACCIDENT_TYPE_CAUSE_LABEL: Record<AccidentType, string> = {
  auto: 'motor vehicle accident',
  slip_and_fall: 'slip and fall',
  workplace: 'workplace injury',
  other: 'personal injury',
}

/**
 * "Indication" header value — describes the injury cause, not the visit purpose.
 * Example: "Personal injury — motor vehicle accident"
 */
export function formatIndication(accidentType: string | null | undefined): string {
  if (!accidentType) return 'Personal injury'
  const cause = ACCIDENT_TYPE_CAUSE_LABEL[accidentType as AccidentType]
  if (!cause || accidentType === 'other') return 'Personal injury'
  return `Personal injury — ${cause}`
}

/**
 * "Visit Type" header value — describes the encounter purpose.
 * Maps the stored visit_type code to a medical-legal label.
 */
export function formatVisitTypeLabel(
  visitType: 'initial_visit' | 'pain_evaluation_visit' | null | undefined,
): string {
  if (visitType === 'pain_evaluation_visit') return 'Pain Management Evaluation'
  return 'Initial Evaluation'
}
