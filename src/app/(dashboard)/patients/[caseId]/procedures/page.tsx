import { listProcedures, getCaseDiagnoses, getProcedureDefaults } from '@/actions/procedures'
import { createClient } from '@/lib/supabase/server'
import { ProcedureTable } from '@/components/procedures/procedure-table'
import { listProcedureOrders } from '@/actions/procedure-orders'
import { listProcedureAppointments } from '@/actions/procedure-appointments'
import { listProviderProfiles } from '@/actions/settings'
import { ProcedureAppointmentTable } from '@/components/procedures/procedure-appointment-table'

export default async function ProceduresPage({
  params,
}: {
  params: Promise<{ caseId: string }>
}) {
  const { caseId } = await params
  const supabase = await createClient()

  const [{ data: procedures }, { data: diagnosisSuggestions }, { data: procedureDefaults }, caseRes, orderResult, appointmentResult, providerResult] = await Promise.all([
    listProcedures(caseId),
    getCaseDiagnoses(caseId),
    getProcedureDefaults(caseId),
    supabase
      .from('cases')
      .select('assigned_provider_id,patient:patients!inner(last_name)')
      .eq('id', caseId)
      .is('deleted_at', null)
      .single(),
    listProcedureOrders(caseId),
    listProcedureAppointments(caseId),
    listProviderProfiles(),
  ])

  const patient = caseRes.data?.patient as unknown as { last_name: string } | null
  const patientLastName = patient?.last_name ?? null

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
      <ProcedureAppointmentTable
        caseId={caseId}
        orders={orderResult.data ?? []}
        appointments={appointmentResult.data ?? []}
        providers={(providerResult.data ?? []).map((provider) => ({ id: provider.id, display_name: provider.display_name }))}
        defaultProviderId={caseRes.data?.assigned_provider_id ?? null}
        diagnosisSuggestions={diagnosisSuggestions}
        procedureDefaults={procedureDefaults}
        patientLastName={patientLastName}
      />
      <h2 className="text-lg font-semibold">Performed</h2>
      <ProcedureTable
        procedures={procedures}
        caseId={caseId}
        diagnosisSuggestions={diagnosisSuggestions}
        noteStatuses={noteStatusMap}
        procedureDefaults={procedureDefaults}
        patientLastName={patientLastName}
      />
    </div>
  )
}
