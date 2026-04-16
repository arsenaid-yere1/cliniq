import { listDocuments } from '@/actions/documents'
import { DocumentList } from '@/components/documents/document-list'
import { createClient } from '@/lib/supabase/server'

export default async function DocumentsPage({
  params,
}: {
  params: Promise<{ caseId: string }>
}) {
  const { caseId } = await params
  const supabase = await createClient()

  const [{ data: documents }, caseRes] = await Promise.all([
    listDocuments(caseId),
    supabase
      .from('cases')
      .select('patient:patients!inner(last_name)')
      .eq('id', caseId)
      .is('deleted_at', null)
      .single(),
  ])

  const patient = caseRes.data?.patient as unknown as { last_name: string } | null
  const patientLastName = patient?.last_name ?? null

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Documents</h1>
      <DocumentList documents={documents} caseId={caseId} patientLastName={patientLastName} />
    </div>
  )
}
