import { visitDecisionLabels, type VisitTreatmentDecision } from '@/lib/validations/visit-treatment-decision'
export function VisitFinalizationReview({ label, date, decision, consequence, requirements }: {
  label: string; date: string | null; decision: VisitTreatmentDecision; consequence: string; requirements?: string
}) {
  return <div className="space-y-3 text-sm">
    <dl className="grid gap-2">
      <div><dt className="font-medium">Note</dt><dd>{label}</dd></div>
      <div><dt className="font-medium">Date of Visit</dt><dd>{date || 'Not documented'}</dd></div>
      <div><dt className="font-medium">Treatment decision</dt><dd>{visitDecisionLabels[decision.decision]}</dd></div>
      {decision.details && <div><dt className="font-medium">Decision details</dt><dd className="whitespace-pre-wrap break-words">{decision.details}</dd></div>}
    </dl>
    {requirements && <p className="text-destructive">{requirements}</p>}
    <p>{consequence}</p>
  </div>
}
