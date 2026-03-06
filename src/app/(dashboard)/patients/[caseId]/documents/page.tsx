import { listDocuments } from '@/actions/documents'
import { DocumentList } from '@/components/documents/document-list'

export default async function DocumentsPage({
  params,
}: {
  params: Promise<{ caseId: string }>
}) {
  const { caseId } = await params
  const { data: documents } = await listDocuments(caseId)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Documents</h1>
      <DocumentList documents={documents} />
    </div>
  )
}
