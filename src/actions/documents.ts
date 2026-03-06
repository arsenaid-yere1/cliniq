'use server'

import { createClient } from '@/lib/supabase/server'

export async function listDocuments(caseId: string, filters?: {
  search?: string
  documentType?: string
  status?: string
}) {
  const supabase = await createClient()

  let query = supabase
    .from('documents')
    .select('*, uploaded_by:users!uploaded_by_user_id(full_name), reviewed_by:users!reviewed_by_user_id(full_name)')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (filters?.documentType && filters.documentType !== 'all') {
    query = query.eq('document_type', filters.documentType)
  }

  if (filters?.status && filters.status !== 'all') {
    query = query.eq('status', filters.status)
  }

  if (filters?.search) {
    query = query.or(`file_name.ilike.%${filters.search}%,notes.ilike.%${filters.search}%`)
  }

  const { data, error } = await query

  if (error) return { error: error.message, data: [] }
  return { data: data ?? [] }
}

export async function getDocumentCount(caseId: string) {
  const supabase = await createClient()

  const { count, error } = await supabase
    .from('documents')
    .select('*', { count: 'exact', head: true })
    .eq('case_id', caseId)
    .is('deleted_at', null)

  if (error) return { error: error.message, count: 0 }
  return { count: count ?? 0 }
}
