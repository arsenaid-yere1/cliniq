export const PRP_NSAID_PROTOCOL = {
  preProcedureHoldDays: 7,
  protectiveWindowWeeks: 2,
  screeningRecentDays: 7,
} as const

export function nsaidHeldPreProcedureClause(): string {
  const { preProcedureHoldDays } = PRP_NSAID_PROTOCOL
  return `held NSAIDs for ${preProcedureHoldDays} days prior to the procedure per protocol`
}

export function nsaidPostCareInstructionSentence(): string {
  const { protectiveWindowWeeks } = PRP_NSAID_PROTOCOL
  return `Avoid NSAIDs (ibuprofen, naproxen, aspirin, etc.) for ${protectiveWindowWeeks} weeks before and after the procedure, as they may interfere with the healing response.`
}

export function nsaidScreeningContraindicationLabel(): string {
  const { screeningRecentDays } = PRP_NSAID_PROTOCOL
  return `NSAIDs in past ${screeningRecentDays} days`
}

export function nsaidAvoidanceTreatmentPlanFragment(): string {
  const { protectiveWindowWeeks } = PRP_NSAID_PROTOCOL
  return `avoid NSAIDs for ${protectiveWindowWeeks} weeks before and after each PRP injection`
}
