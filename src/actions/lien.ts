'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { assertCaseNotClosed } from '@/actions/case-status'

export async function generateLienAgreement(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Verify case exists and is not closed
  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  // Verify case has an attorney assigned
  const { data: caseData, error: caseError } = await supabase
    .from('cases')
    .select('attorney_id')
    .eq('id', caseId)
    .is('deleted_at', null)
    .single()

  if (caseError || !caseData) return { error: 'Case not found' }
  if (!caseData.attorney_id) return { error: 'An attorney must be assigned before generating a lien agreement' }

  // Render PDF
  const { renderLienAgreementPdf } = await import('@/lib/pdf/render-lien-agreement-pdf')
  const pdfBuffer = await renderLienAgreementPdf({ caseId })

  // Upload PDF to Supabase Storage
  const storagePath = `cases/${caseId}/lien-agreement-${Date.now()}.pdf`
  const fileBlob = new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' })

  const { error: uploadError } = await supabase.storage
    .from('case-documents')
    .upload(storagePath, fileBlob, {
      contentType: 'application/pdf',
      upsert: false,
    })

  if (uploadError) return { error: `Failed to upload lien agreement: ${uploadError.message}` }

  // Create documents row
  const { error: docError } = await supabase
    .from('documents')
    .insert({
      case_id: caseId,
      document_type: 'lien_agreement',
      file_name: 'Authorization and Lien Agreement',
      file_path: storagePath,
      file_size_bytes: pdfBuffer.length,
      mime_type: 'application/pdf',
      status: 'reviewed',
      uploaded_by_user_id: user.id,
      created_by_user_id: user.id,
      updated_by_user_id: user.id,
    })

  if (docError) return { error: `Failed to save document record: ${docError.message}` }

  // Set lien_on_file = true
  await supabase
    .from('cases')
    .update({ lien_on_file: true, updated_by_user_id: user.id })
    .eq('id', caseId)

  // Convert to base64 for immediate download
  const base64 = Buffer.from(pdfBuffer).toString('base64')

  revalidatePath(`/patients/${caseId}`)
  revalidatePath(`/patients/${caseId}/documents`)

  return { data: { base64 } }
}
