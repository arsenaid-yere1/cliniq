import { listProcedures, getCaseDiagnoses, getProcedureDefaults } from '@/actions/procedures'
import { createClient } from '@/lib/supabase/server'
import { ProcedureTable } from '@/components/procedures/procedure-table'

export default async function ProceduresPage({
  params,
}: {
  params: Promise<{ caseId: string }>
}) {
  const { caseId } = await params
  const supabase = await createClient()

  const [{ data: procedures }, { data: diagnosisSuggestions }, { data: procedureDefaults }] = await Promise.all([
    listProcedures(caseId),
    getCaseDiagnoses(caseId),
    getProcedureDefaults(caseId),
  ])

  // Fetch note statuses for all procedures
  const procedureIds = procedures.map((p) => p.id)
  const noteStatusMap: Record<string, string> = {}
  if (procedureIds.length > 0) {
    const { data: noteStatuses } = await supabase
      .from('procedure_notes')
      .select('procedure_id, status')
      .in('procedure_id', procedureIds)
      .is('deleted_at', null)
    if (noteStatuses) {
      for (const ns of noteStatuses) {
        noteStatusMap[ns.procedure_id] = ns.status
      }
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Procedures</h1>
      <ProcedureTable
        procedures={procedures}
        caseId={caseId}
        diagnosisSuggestions={diagnosisSuggestions}
        noteStatuses={noteStatusMap}
        procedureDefaults={procedureDefaults}
      />
    </div>
  )
}
