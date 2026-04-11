'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { generateImagingOrders, generateChiropracticOrder, type ClinicalOrderInputData } from '@/lib/claude/generate-clinical-orders'
import { type OrderType } from '@/lib/validations/clinical-orders'
import { assertCaseNotClosed } from '@/actions/case-status'
import { type NoteVisitType } from '@/lib/claude/generate-initial-visit'

// --- Helper: gather input data from finalized note for a specific visit type ---

async function gatherOrderInputData(
  supabase: Awaited<ReturnType<typeof createClient>>,
  caseId: string,
  visitType: NoteVisitType,
): Promise<{ data?: ClinicalOrderInputData; noteId?: string; error?: string }> {
  // Fetch the note matching BOTH case_id and visit_type
  const { data: note, error: noteError } = await supabase
    .from('initial_visit_notes')
    .select(`
      id,
      status,
      diagnoses,
      chief_complaint,
      treatment_plan,
      visit_date,
      finalized_at,
      case:cases!inner(
        id,
        patient:patients!inner(first_name, last_name, date_of_birth, gender)
      )
    `)
    .eq('case_id', caseId)
    .eq('visit_type', visitType)
    .is('deleted_at', null)
    .in('status', ['finalized', 'draft'])
    .maybeSingle()

  if (noteError || !note) {
    return { error: 'No Initial Visit note found. Generate the note before creating orders.' }
  }

  if (!note.diagnoses) {
    return { error: 'The Initial Visit note has no diagnoses section. Generate or complete the note first.' }
  }

  // Fetch provider and clinic info
  const [providerRes, clinicRes] = await Promise.all([
    supabase
      .from('provider_profiles')
      .select('display_name, credentials, npi_number')
      .limit(1)
      .maybeSingle(),
    supabase
      .from('clinic_settings')
      .select('clinic_name, address_line1, city, state, zip_code, phone, fax')
      .limit(1)
      .maybeSingle(),
  ])

  const caseData = note.case as unknown as {
    id: string
    patient: { first_name: string; last_name: string; date_of_birth: string | null; gender: string | null }
  }

  return {
    noteId: note.id,
    data: {
      patientInfo: {
        first_name: caseData.patient.first_name,
        last_name: caseData.patient.last_name,
        date_of_birth: caseData.patient.date_of_birth,
        gender: caseData.patient.gender,
      },
      diagnoses: (note.diagnoses as string) ?? '',
      chiefComplaint: (note.chief_complaint as string) ?? null,
      treatmentPlan: (note.treatment_plan as string) ?? null,
      providerInfo: {
        display_name: providerRes.data?.display_name ?? null,
        credentials: providerRes.data?.credentials ?? null,
        npi_number: providerRes.data?.npi_number ?? null,
      },
      clinicInfo: {
        clinic_name: clinicRes.data?.clinic_name ?? null,
        address_line1: clinicRes.data?.address_line1 ?? null,
        city: clinicRes.data?.city ?? null,
        state: clinicRes.data?.state ?? null,
        zip_code: clinicRes.data?.zip_code ?? null,
        phone: clinicRes.data?.phone ?? null,
        fax: clinicRes.data?.fax ?? null,
      },
      dateOfVisit: note.visit_date
        ? new Date(`${note.visit_date}T00:00:00`).toISOString()
        : note.finalized_at ?? new Date().toISOString(),
    },
  }
}

// --- Generate a clinical order, scoped to a specific visit type ---

export async function generateClinicalOrder(
  caseId: string,
  visitType: NoteVisitType,
  orderType: OrderType,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  // Gather input data from the visit-type-specific note
  const { data: inputData, noteId, error: gatherError } = await gatherOrderInputData(supabase, caseId, visitType)
  if (gatherError || !inputData || !noteId) return { error: gatherError ?? 'Failed to gather order data' }

  // Create order row in generating state
  const { data: order, error: insertError } = await supabase
    .from('clinical_orders')
    .insert({
      case_id: caseId,
      initial_visit_note_id: noteId,
      order_type: orderType,
      status: 'generating',
      created_by_user_id: user.id,
      updated_by_user_id: user.id,
    })
    .select('id')
    .single()

  if (insertError || !order) return { error: 'Failed to create order record' }

  // Generate via AI
  let result: { data?: unknown; rawResponse?: unknown; error?: string }

  if (orderType === 'imaging') {
    result = await generateImagingOrders(inputData)
  } else {
    result = await generateChiropracticOrder(inputData)
  }

  if (result.error || !result.data) {
    await supabase
      .from('clinical_orders')
      .update({
        status: 'failed',
        generation_error: result.error ?? 'Generation failed',
        updated_by_user_id: user.id,
      })
      .eq('id', order.id)

    return { error: result.error ?? 'Order generation failed' }
  }

  // Fetch clinic/provider/patient for PDF rendering
  const [clinicRes, providerRes, patientRes] = await Promise.all([
    supabase.from('clinic_settings').select('*').limit(1).maybeSingle(),
    supabase.from('provider_profiles').select('*').limit(1).maybeSingle(),
    supabase
      .from('cases')
      .select('patient:patients!inner(date_of_birth)')
      .eq('id', caseId)
      .is('deleted_at', null)
      .single(),
  ])

  const patientDob = (patientRes.data?.patient as unknown as { date_of_birth: string | null })?.date_of_birth ?? null

  // Render PDF immediately
  let pdfBuffer: Buffer
  let fileName: string
  const orderData = result.data as Record<string, unknown>

  if (orderType === 'imaging') {
    const { renderImagingOrdersPdf } = await import('@/lib/pdf/render-imaging-orders-pdf')
    pdfBuffer = await renderImagingOrdersPdf({
      orderData,
      clinicSettings: clinicRes.data,
      providerProfile: providerRes.data,
      patientDob,
    })
    fileName = 'Imaging Orders'
  } else {
    const { renderChiropracticOrderPdf } = await import('@/lib/pdf/render-chiropractic-order-pdf')
    pdfBuffer = await renderChiropracticOrderPdf({
      orderData,
      clinicSettings: clinicRes.data,
      providerProfile: providerRes.data,
      patientDob,
    })
    fileName = 'Chiropractic Therapy Order'
  }

  // Upload PDF
  const storagePath = `cases/${caseId}/${orderType}-order-${Date.now()}.pdf`
  const fileBlob = new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' })

  const { error: uploadError } = await supabase.storage
    .from('case-documents')
    .upload(storagePath, fileBlob, {
      contentType: 'application/pdf',
      upsert: false,
    })

  if (uploadError) return { error: `Failed to upload order PDF: ${uploadError.message}` }

  // Create documents row
  const { data: doc, error: docError } = await supabase
    .from('documents')
    .insert({
      case_id: caseId,
      document_type: 'generated',
      file_name: fileName,
      file_path: storagePath,
      file_size_bytes: pdfBuffer.length,
      mime_type: 'application/pdf',
      status: 'reviewed',
      uploaded_by_user_id: user.id,
      created_by_user_id: user.id,
      updated_by_user_id: user.id,
    })
    .select('id')
    .single()

  if (docError || !doc) return { error: 'Failed to create document record' }

  // Update order as completed with PDF attached
  const { error: updateError } = await supabase
    .from('clinical_orders')
    .update({
      order_data: orderData,
      raw_ai_response: result.rawResponse as Record<string, unknown>,
      ai_model: 'claude-sonnet-4-6',
      status: 'completed',
      document_id: doc.id,
      finalized_by_user_id: user.id,
      finalized_at: new Date().toISOString(),
      updated_by_user_id: user.id,
    })
    .eq('id', order.id)

  if (updateError) return { error: 'Failed to save generated order' }

  revalidatePath(`/patients/${caseId}`)
  return { data: { orderId: order.id } }
}

// --- Get clinical orders for a case scoped to a specific visit type ---

export async function getClinicalOrders(caseId: string, visitType: NoteVisitType) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Resolve the note row for this (case, visit_type). Orders are linked to
  // a specific note row so we use that id as the scope filter.
  const { data: note } = await supabase
    .from('initial_visit_notes')
    .select('id')
    .eq('case_id', caseId)
    .eq('visit_type', visitType)
    .is('deleted_at', null)
    .maybeSingle()

  // No note for this visit type yet — there can be no orders either.
  if (!note) return { data: [] }

  const { data, error } = await supabase
    .from('clinical_orders')
    .select('id, order_type, order_data, status, generation_error, finalized_at, document_id, created_at, document:documents(file_path)')
    .eq('case_id', caseId)
    .eq('initial_visit_note_id', note.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) return { error: 'Failed to load orders' }
  return { data: data ?? [] }
}

// --- Finalize a clinical order (generate PDF, upload, create document) ---

export async function finalizeClinicalOrder(orderId: string, caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  // Fetch the order
  const { data: order, error: fetchError } = await supabase
    .from('clinical_orders')
    .select('*')
    .eq('id', orderId)
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .eq('status', 'completed')
    .single()

  if (fetchError || !order) return { error: 'No completed order found to finalize' }

  // Clean up previous document if re-finalizing
  if (order.document_id) {
    const { data: oldDoc } = await supabase
      .from('documents')
      .select('id, file_path')
      .eq('id', order.document_id)
      .is('deleted_at', null)
      .single()

    if (oldDoc) {
      await supabase
        .from('documents')
        .update({ deleted_at: new Date().toISOString(), updated_by_user_id: user.id })
        .eq('id', oldDoc.id)

      if (oldDoc.file_path) {
        await supabase.storage.from('case-documents').remove([oldDoc.file_path])
      }
    }
  }

  // Fetch clinic/provider/patient for PDF rendering
  const [clinicRes, providerRes, patientRes] = await Promise.all([
    supabase.from('clinic_settings').select('*').limit(1).maybeSingle(),
    supabase.from('provider_profiles').select('*').limit(1).maybeSingle(),
    supabase
      .from('cases')
      .select('patient:patients!inner(date_of_birth)')
      .eq('id', caseId)
      .is('deleted_at', null)
      .single(),
  ])

  const patientDob = (patientRes.data?.patient as unknown as { date_of_birth: string | null })?.date_of_birth ?? null

  // Render PDF based on order type
  let pdfBuffer: Buffer
  let fileName: string

  if (order.order_type === 'imaging') {
    const { renderImagingOrdersPdf } = await import('@/lib/pdf/render-imaging-orders-pdf')
    pdfBuffer = await renderImagingOrdersPdf({
      orderData: order.order_data as Record<string, unknown>,
      clinicSettings: clinicRes.data,
      providerProfile: providerRes.data,
      patientDob,
    })
    fileName = 'Imaging Orders'
  } else {
    const { renderChiropracticOrderPdf } = await import('@/lib/pdf/render-chiropractic-order-pdf')
    pdfBuffer = await renderChiropracticOrderPdf({
      orderData: order.order_data as Record<string, unknown>,
      clinicSettings: clinicRes.data,
      providerProfile: providerRes.data,
      patientDob,
    })
    fileName = 'Chiropractic Therapy Order'
  }

  // Upload PDF
  const storagePath = `cases/${caseId}/${order.order_type}-order-${Date.now()}.pdf`
  const fileBlob = new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' })

  const { error: uploadError } = await supabase.storage
    .from('case-documents')
    .upload(storagePath, fileBlob, {
      contentType: 'application/pdf',
      upsert: false,
    })

  if (uploadError) return { error: `Failed to upload order: ${uploadError.message}` }

  // Create documents row
  const { data: doc, error: docError } = await supabase
    .from('documents')
    .insert({
      case_id: caseId,
      document_type: 'generated',
      file_name: fileName,
      file_path: storagePath,
      file_size_bytes: pdfBuffer.length,
      mime_type: 'application/pdf',
      status: 'reviewed',
      uploaded_by_user_id: user.id,
      created_by_user_id: user.id,
      updated_by_user_id: user.id,
    })
    .select('id')
    .single()

  if (docError || !doc) return { error: 'Failed to create document record' }

  // Update order as finalized
  const { error: updateError } = await supabase
    .from('clinical_orders')
    .update({
      finalized_by_user_id: user.id,
      finalized_at: new Date().toISOString(),
      document_id: doc.id,
      updated_by_user_id: user.id,
    })
    .eq('id', orderId)

  if (updateError) return { error: 'Failed to finalize order' }

  revalidatePath(`/patients/${caseId}`)
  return { data: { success: true } }
}

// --- Delete a clinical order (soft delete) ---

export async function deleteClinicalOrder(orderId: string, caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  // Fetch the order to get linked document
  const { data: order } = await supabase
    .from('clinical_orders')
    .select('id, document_id')
    .eq('id', orderId)
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .single()

  if (!order) return { error: 'Order not found' }

  // Clean up linked document and storage file
  if (order.document_id) {
    const { data: doc } = await supabase
      .from('documents')
      .select('id, file_path')
      .eq('id', order.document_id)
      .is('deleted_at', null)
      .single()

    if (doc) {
      await supabase
        .from('documents')
        .update({ deleted_at: new Date().toISOString(), updated_by_user_id: user.id })
        .eq('id', doc.id)

      if (doc.file_path) {
        await supabase.storage.from('case-documents').remove([doc.file_path])
      }
    }
  }

  // Soft-delete the order
  const { error } = await supabase
    .from('clinical_orders')
    .update({
      deleted_at: new Date().toISOString(),
      updated_by_user_id: user.id,
    })
    .eq('id', orderId)
    .eq('case_id', caseId)

  if (error) return { error: 'Failed to delete order' }

  revalidatePath(`/patients/${caseId}`)
  return { data: { success: true } }
}
