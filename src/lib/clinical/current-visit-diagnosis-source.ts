import { providerIntakeSchema } from '@/lib/validations/initial-visit-note'

type PainFollowUpSourceInput = {
  reason_for_visit: unknown
  provider_intake: unknown
  patient_reported_pain_min: unknown
  patient_reported_pain_max: unknown
}

type CurrentEncounterSourceInput = PainFollowUpSourceInput & {
  encounter_type: unknown
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().replace(/\s+/g, ' ')
  return normalized || null
}

function painScore(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10
    ? value
    : null
}

export function buildEvaluationDiagnosisSource(providerIntake: unknown) {
  const parsed = providerIntakeSchema.safeParse(providerIntake)
  if (!parsed.success) return null

  const complaints = parsed.data.chief_complaints.complaints
    .map((complaint) => ({
      body_region: text(complaint.body_region),
      pain_character: text(complaint.pain_character),
      severity_min: painScore(complaint.severity_min),
      severity_max: painScore(complaint.severity_max),
      is_persistent: complaint.is_persistent,
      radiates_to: text(complaint.radiates_to),
      aggravating_factors: text(complaint.aggravating_factors),
      alleviating_factors: text(complaint.alleviating_factors),
    }))
    .filter((complaint) => (
      complaint.body_region
      || complaint.pain_character
      || complaint.radiates_to
      || complaint.aggravating_factors
      || complaint.alleviating_factors
    ))

  const examRegions = parsed.data.exam_findings.regions
    .map((region) => ({
      region: text(region.region),
      palpation_findings: text(region.palpation_findings),
      muscle_spasm: region.muscle_spasm,
      additional_findings: text(region.additional_findings),
    }))
    .filter((region) => (
      region.region || region.palpation_findings || region.muscle_spasm || region.additional_findings
    ))

  const currentVisit = {
    chief_complaints: complaints,
    sleep_disturbance: parsed.data.chief_complaints.sleep_disturbance,
    additional_symptom_notes: text(parsed.data.chief_complaints.additional_notes),
    incident_symptoms: text(parsed.data.accident_details.immediate_symptoms),
    incident_narrative_recorded_today: text(parsed.data.accident_details.narrative),
    loss_of_consciousness_reported: parsed.data.accident_details.lost_consciousness === true,
    exam: {
      general_appearance: text(parsed.data.exam_findings.general_appearance),
      regions: examRegions,
      neurological_notes: text(parsed.data.exam_findings.neurological_notes),
    },
  }

  const meaningful = complaints.length > 0
    || Boolean(currentVisit.additional_symptom_notes)
    || Boolean(currentVisit.incident_symptoms)
    || Boolean(currentVisit.incident_narrative_recorded_today)
    || currentVisit.loss_of_consciousness_reported
    || examRegions.length > 0
    || Boolean(currentVisit.exam.neurological_notes)

  return meaningful
    ? { source_kind: 'evaluation' as const, current_visit: currentVisit }
    : null
}

export function buildPainFollowUpDiagnosisSource(input: PainFollowUpSourceInput) {
  const intake = input.provider_intake && typeof input.provider_intake === 'object' && !Array.isArray(input.provider_intake)
    ? input.provider_intake as Record<string, unknown>
    : {}

  const currentVisit = {
    reason_for_visit: text(input.reason_for_visit),
    chief_complaint: text(intake.chief_complaint),
    interval_history: text(intake.interval_history),
    review_of_systems: text(intake.review_of_systems),
    video_observations: text(intake.video_observations),
    patient_reported_pain_min: painScore(input.patient_reported_pain_min),
    patient_reported_pain_max: painScore(input.patient_reported_pain_max),
  }

  const meaningful = Boolean(
    currentVisit.reason_for_visit
    || currentVisit.chief_complaint
    || currentVisit.interval_history
    || currentVisit.review_of_systems
    || currentVisit.video_observations,
  )

  return meaningful
    ? { source_kind: 'pain_follow_up' as const, current_visit: currentVisit }
    : null
}

export function buildCurrentEncounterDiagnosisSource(
  encounter: CurrentEncounterSourceInput,
  evaluationProviderIntake?: unknown,
) {
  if (encounter.encounter_type === 'initial_evaluation' || encounter.encounter_type === 'pain_evaluation') {
    return buildEvaluationDiagnosisSource(evaluationProviderIntake)
  }
  if (encounter.encounter_type === 'pain_follow_up') {
    return buildPainFollowUpDiagnosisSource(encounter)
  }
  return null
}

export type CurrentVisitDiagnosisSource = NonNullable<
  ReturnType<typeof buildEvaluationDiagnosisSource>
  | ReturnType<typeof buildPainFollowUpDiagnosisSource>
>
