import {
  parseSitesJsonb,
  sitesFromLegacyString,
  type ProcedureSite,
} from '@/lib/procedures/sites-helpers'

export interface DischargeProcedureForPrpCounts {
  procedure_type: string
  sites: ReadonlyArray<unknown>
}

export interface DischargePrpCounts {
  prpSessionCount: number
  prpTargetAreaCount: number | null
}

/** Structured sites are authoritative; the denormalized string is only a
 * compatibility source for procedure rows created before sites[] existed. */
export function resolveDischargeProcedureSites(
  rawSites: unknown,
  injectionSite: string | null,
): ProcedureSite[] {
  const structuredSites = parseSitesJsonb(rawSites)
  return structuredSites.length > 0
    ? structuredSites
    : sitesFromLegacyString(injectionSite, null)
}

/**
 * Derive the two distinct PRP course counts used in Discharge-note prose.
 * A procedure row is one session; each structured site is one performed
 * target-area occurrence. If any PRP session has no usable site data, the
 * target-area total is unknown rather than an understated partial count.
 */
export function deriveDischargePrpCounts(
  procedures: ReadonlyArray<DischargeProcedureForPrpCounts>,
): DischargePrpCounts {
  const prpProcedures = procedures.filter((procedure) => procedure.procedure_type === 'prp')
  const prpSessionCount = prpProcedures.length

  if (prpProcedures.some((procedure) => procedure.sites.length === 0)) {
    return { prpSessionCount, prpTargetAreaCount: null }
  }

  return {
    prpSessionCount,
    prpTargetAreaCount: prpProcedures.reduce(
      (total, procedure) => total + procedure.sites.length,
      0,
    ),
  }
}
