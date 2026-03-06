'use server'

import { createClient } from '@/lib/supabase/server'

export async function listProcedures(caseId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('procedures')
    .select('*, provider:users!provider_id(full_name)')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .order('procedure_date', { ascending: false })

  if (error) return { error: error.message, data: [] }
  return { data: data ?? [] }
}

export async function getProcedureCount(caseId: string) {
  const supabase = await createClient()

  const { count, error } = await supabase
    .from('procedures')
    .select('*', { count: 'exact', head: true })
    .eq('case_id', caseId)
    .is('deleted_at', null)

  if (error) return { error: error.message, count: 0 }
  return { count: count ?? 0 }
}
