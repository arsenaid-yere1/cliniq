import { buildDischargePainTrajectory } from '@/lib/claude/pain-trajectory'
import { computePainToneLabel } from '@/lib/claude/pain-tone'
import type { ReviewSnapshot, ReviewValue } from './review-types'
function object(value: ReviewValue | undefined): Record<string,ReviewValue> {return value && typeof value === 'object' && !Array.isArray(value) ? value : {}}
function numeric(value: ReviewValue | undefined) {return typeof value === 'number' && Number.isFinite(value) ? value : null}
export function buildReviewTrajectory(snapshot: ReviewSnapshot) {
  const discharge = snapshot.notes.find(n => n.step === 'discharge')
  const notes = snapshot.notes.filter(n => n.step === 'procedure').sort((a,b) => (a.date ?? '').localeCompare(b.date ?? '') || Number(a.context.procedure_number)-Number(b.context.procedure_number) || a.id.localeCompare(b.id))
  // Missing anchors cannot establish a numeric contradiction or prove resolution.
  if (!discharge || !notes.length || notes.length !== snapshot.sources.filter(s => s.type === 'procedures' && s.scope === 'episode').length || notes.some(n => !n.date || !n.context.vitals || numeric(object(n.context.vitals).pain_score_max) === null)) return null
  const procedures = notes.map(n => ({procedure_date:n.date!,procedure_number:Number(n.context.procedure_number),pain_score_min:numeric(object(n.context.vitals).pain_score_min),pain_score_max:numeric(object(n.context.vitals).pain_score_max)}))
  const first = procedures[0],last = procedures.at(-1)!
  const previous = procedures.slice(0,-1).reverse().find(p => p.pain_score_max !== null)
  const label = computePainToneLabel(last.pain_score_max,first.pain_score_max,'prior_with_vitals')
  const trend = label === 'minimally_improved' ? 'improved' : label === 'missing_vitals' ? 'baseline' : label
  const origin = snapshot.notes.find(n => n.step === 'initial_visit') ?? snapshot.notes.find(n => n.step === 'pain_evaluation')
  const intakeVitals = object(origin?.context.vitals)
  const dischargeVitals = object(discharge.context.discharge_measurements)
  const min = numeric(dischargeVitals.pain_score_min),max = numeric(dischargeVitals.pain_score_max)
  const trajectory = buildDischargePainTrajectory({procedures,latestVitals:last,baselinePain:first,
    intakePain:origin?.context.vitals ? {recorded_at:origin.date,pain_score_min:numeric(intakeVitals.pain_score_min),pain_score_max:numeric(intakeVitals.pain_score_max)} : null,
    dischargeVitals:min === null && max === null ? null : {pain_score_min:min,pain_score_max:max},
    overallPainTrend:trend,finalIntervalWorsened:!!previous && computePainToneLabel(last.pain_score_max,previous.pain_score_max,'prior_with_vitals') === 'worsened',visitDate:discharge.date})
  return {...trajectory,endpoint_basis:min !== null || max !== null ? 'measured_at_discharge' : trajectory.dischargeEstimated ? 'estimated_from_procedure' : 'carried_forward_from_procedure'}
}
