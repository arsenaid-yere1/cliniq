// Server-side resolver for the per-note "narrative directive": a compact
// object that pre-resolves the cell of the paintone × plan-coherence ×
// series-volatility matrix into a single set of directives. The LLM receives
// it alongside the existing matrix rules so it can apply the resolved cell
// directly without having to route itself through 9+ paragraphs of
// conditionals. The existing matrix blocks stay in the system prompt as a
// safety belt — if the model misses the directive, the matrix still routes
// correctly.

import type { PainToneLabel, PainToneSignals, SeriesVolatility } from './pain-tone'
import type { PlanAlignment } from '../procedures/compute-plan-alignment'

export type NarrativeTone =
  | 'baseline'
  | 'improved'
  | 'minimally_improved'
  | 'stable'
  | 'worsened'
  | 'mixed_with_final_uptick'
  | 'mixed_with_recovery'
  | 'missing_vitals'

export interface NarrativeDirective {
  /** Resolved tone label after combining vsBaseline + vsPrevious + volatility. */
  tone: NarrativeTone
  /** Short summary sentence describing the arc. Suitable as a reference for prose. */
  reference_sentence: string
  /** Phrases the LLM must include verbatim somewhere in the narrative (subjective + assessment). */
  must_acknowledge: string[]
  /** Phrases the LLM is forbidden from using note-wide (in addition to existing forbidden phrases). */
  forbidden_phrases: string[]
  /** Plan-coherence sub-directive resolved from planAlignment. Null when no plan signal applies (e.g. discharge note). */
  plan_directive: PlanDirective | null
}

export interface PlanDirective {
  status: PlanAlignment['status']
  required_sentence: string | null
  forbidden_phrases: string[]
}

interface ResolveProcedureArgs {
  paintoneSignals: PainToneSignals
  seriesVolatility: SeriesVolatility
  planAlignment: PlanAlignment
}

interface ResolveDischargeArgs {
  vsBaseline: PainToneLabel
  vsPrevious: PainToneLabel | null
  seriesVolatility: SeriesVolatility
}

const BASE_FORBIDDEN = [
  'continued improvement since the prior injection',
  'sustained progressive improvement',
  'steady reduction',
] as const

function toneFromSignals(
  vsBaseline: PainToneLabel,
  vsPrevious: PainToneLabel | null,
  volatility: SeriesVolatility,
): NarrativeTone {
  if (vsBaseline === 'missing_vitals' || vsPrevious === 'missing_vitals') return 'missing_vitals'
  if (volatility === 'mixed_with_regression') {
    if (vsBaseline === 'improved' && vsPrevious === 'worsened') return 'mixed_with_final_uptick'
    if (vsBaseline === 'improved') return 'mixed_with_recovery'
  }
  if (vsBaseline === 'improved') return 'improved'
  if (vsBaseline === 'minimally_improved') return 'minimally_improved'
  if (vsBaseline === 'worsened') return 'worsened'
  if (vsBaseline === 'stable') return 'stable'
  return 'baseline'
}

function referenceFor(tone: NarrativeTone): string {
  switch (tone) {
    case 'improved':
      return 'Cumulative pain decreased from baseline to the current evaluation, reflecting meaningful and sustained improvement across the series.'
    case 'minimally_improved':
      return 'A modest reduction in pain intensity is noted from baseline, with persistent functional limitations remaining.'
    case 'stable':
      return 'Pain intensity is unchanged from baseline; functional status reflects the persistent injury pattern.'
    case 'worsened':
      return 'Pain has increased relative to baseline, prompting reconsideration of the active management plan.'
    case 'mixed_with_final_uptick':
      return 'Cumulative reduction is documented across the series, with a transient uptick noted between the penultimate and final encounters.'
    case 'mixed_with_recovery':
      return 'Cumulative improvement is documented across the series despite mid-course variability; the trajectory has recovered by the current evaluation.'
    case 'missing_vitals':
      return 'A prior visit is on the chart without recorded pain ratings; comparison defers to qualitative findings.'
    case 'baseline':
    default:
      return 'This is the baseline encounter for series comparison; no prior pain anchor is available.'
  }
}

function mustAcknowledgeFor(tone: NarrativeTone): string[] {
  switch (tone) {
    case 'mixed_with_final_uptick':
      return ['modest uptick between the penultimate and final injections']
    case 'mixed_with_recovery':
      return ['mid-course variability']
    case 'minimally_improved':
      return ['modest reduction in pain intensity']
    case 'worsened':
      return ['pain has increased relative to baseline']
    case 'missing_vitals':
      return ['qualitative comparative language']
    default:
      return []
  }
}

function forbiddenFor(tone: NarrativeTone): string[] {
  const extra: string[] = []
  if (tone === 'mixed_with_final_uptick' || tone === 'mixed_with_recovery') {
    extra.push('linear improvement', 'uninterrupted improvement')
  }
  if (tone === 'minimally_improved') {
    extra.push('significant improvement', 'substantial gains', 'marked reduction')
  }
  if (tone === 'worsened') {
    extra.push('continued improvement', 'favorable response')
  }
  if (tone === 'missing_vitals') {
    extra.push('improved by N points', 'declined by N points')
  }
  return [...BASE_FORBIDDEN, ...extra]
}

function planDirectiveFor(plan: PlanAlignment): PlanDirective {
  switch (plan.status) {
    case 'aligned':
      return {
        status: 'aligned',
        required_sentence: 'The performed procedure aligns with the prior treatment plan.',
        forbidden_phrases: [],
      }
    case 'deviation':
      return {
        status: 'deviation',
        required_sentence: 'The performed procedure differs from the prior treatment plan; the deviation is explained below.',
        forbidden_phrases: ['as planned', 'consistent with the prior plan'],
      }
    case 'unplanned':
      return {
        status: 'unplanned',
        required_sentence: 'No prior plan covered the performed body region; the procedure was pursued on clinical-judgment grounds.',
        forbidden_phrases: ['as planned', 'per the prior treatment plan'],
      }
    case 'no_plan_on_file':
    default:
      return {
        status: 'no_plan_on_file',
        required_sentence: null,
        forbidden_phrases: ['as planned', 'per the prior treatment plan'],
      }
  }
}

export function resolveProcedureNarrativeDirective(args: ResolveProcedureArgs): NarrativeDirective {
  const { paintoneSignals, seriesVolatility, planAlignment } = args
  const tone = toneFromSignals(paintoneSignals.vsBaseline, paintoneSignals.vsPrevious, seriesVolatility)
  return {
    tone,
    reference_sentence: referenceFor(tone),
    must_acknowledge: mustAcknowledgeFor(tone),
    forbidden_phrases: forbiddenFor(tone),
    plan_directive: planDirectiveFor(planAlignment),
  }
}

export function resolveDischargeNarrativeDirective(args: ResolveDischargeArgs): NarrativeDirective {
  const tone = toneFromSignals(args.vsBaseline, args.vsPrevious, args.seriesVolatility)
  return {
    tone,
    reference_sentence: referenceFor(tone),
    must_acknowledge: mustAcknowledgeFor(tone),
    forbidden_phrases: forbiddenFor(tone),
    plan_directive: null,
  }
}
