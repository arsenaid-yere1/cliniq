'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { assertCaseNotClosed } from '@/actions/case-status'

interface GenerateProcedureConsentInput {
  caseId: string
  procedureId?: string
  override?: {
    treatmentArea?: string
    laterality?: 'left' | 'right' | 'bilateral'
    procedureNumber?: number
  }
}

export async function generateProcedureConsent(input: GenerateProcedureConsentInput) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, input.caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  // Verify case exists
  const { data: caseData, error: caseError } = await supabase
    .from('cases')
    .select('id')
    .eq('id', input.caseId)
    .is('deleted_at', null)
    .single()
  if (caseError || !caseData) return { error: 'Case not found' }

  // Render PDF
  const { renderProcedureConsentPdf } = await import('@/lib/pdf/render-procedure-consent-pdf')
  const pdfBuffer = await renderProcedureConsentPdf({
    caseId: input.caseId,
    procedureId: input.procedureId,
    override: input.override,
  })

  // Upload
  const storagePath = `cases/${input.caseId}/procedure-consent-${Date.now()}.pdf`
  const fileBlob = new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' })

  const { error: uploadError } = await supabase.storage
    .from('case-documents')
    .upload(storagePath, fileBlob, {
      contentType: 'application/pdf',
      upsert: false,
    })
  if (uploadError) return { error: `Failed to upload consent form: ${uploadError.message}` }

  // Insert documents row
  const { error: docError } = await supabase
    .from('documents')
    .insert({
      case_id: input.caseId,
      document_type: 'procedure_consent',
      file_name: 'Procedure Consent Form (Unsigned)',
      file_path: storagePath,
      file_size_bytes: pdfBuffer.length,
      mime_type: 'application/pdf',
      status: 'reviewed',
      uploaded_by_user_id: user.id,
      created_by_user_id: user.id,
      updated_by_user_id: user.id,
    })
  if (docError) return { error: `Failed to save document record: ${docError.message}` }

  const base64 = Buffer.from(pdfBuffer).toString('base64')

  revalidatePath(`/patients/${input.caseId}`)
  revalidatePath(`/patients/${input.caseId}/documents`)

  return { data: { base64 } }
}
