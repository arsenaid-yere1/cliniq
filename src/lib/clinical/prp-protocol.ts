export const PRP_NSAID_PROTOCOL = {
  avoidanceWindowWeeks: 2,
} as const

export function nsaidHeldPreProcedureClause(): string {
  const { avoidanceWindowWeeks } = PRP_NSAID_PROTOCOL
  return `held NSAIDs for ${avoidanceWindowWeeks} weeks prior to the procedure per protocol`
}

export function nsaidPostCareInstructionSentence(): string {
  const { avoidanceWindowWeeks } = PRP_NSAID_PROTOCOL
  return `Avoid NSAIDs (ibuprofen, naproxen, aspirin, etc.) for ${avoidanceWindowWeeks} weeks before and after the procedure, as they may interfere with the healing response.`
}

export function nsaidScreeningContraindicationLabel(): string {
  const { avoidanceWindowWeeks } = PRP_NSAID_PROTOCOL
  return `NSAIDs in past ${avoidanceWindowWeeks} weeks`
}

export function nsaidAvoidanceTreatmentPlanFragment(): string {
  const { avoidanceWindowWeeks } = PRP_NSAID_PROTOCOL
  return `avoid NSAIDs for ${avoidanceWindowWeeks} weeks before and after each PRP injection`
}
