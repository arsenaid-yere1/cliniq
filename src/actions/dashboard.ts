'use server'

import { createClient } from '@/lib/supabase/server'

export interface CaseDashboardStats {
  documentCount: number
  procedureCount: number
  totalBilled: number
  totalPaid: number
  balanceDue: number
  lastProcedureDate: string | null
}

export async function getCaseDashboardStats(caseId: string): Promise<{ data: CaseDashboardStats, error?: string }> {
  const supabase = await createClient()

  const [docRes, procRes, caseRes, lastProcRes] = await Promise.all([
    supabase
      .from('documents')
      .select('*', { count: 'exact', head: true })
      .eq('case_id', caseId)
      .is('deleted_at', null),
    supabase
      .from('procedures')
      .select('*', { count: 'exact', head: true })
      .eq('case_id', caseId)
      .is('deleted_at', null),
    supabase
      .from('cases')
      .select('total_billed, total_paid, balance_due')
      .eq('id', caseId)
      .single(),
    supabase
      .from('procedures')
      .select('procedure_date')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .order('procedure_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  return {
    data: {
      documentCount: docRes.count ?? 0,
      procedureCount: procRes.count ?? 0,
      totalBilled: Number(caseRes.data?.total_billed ?? 0),
      totalPaid: Number(caseRes.data?.total_paid ?? 0),
      balanceDue: Number(caseRes.data?.balance_due ?? 0),
      lastProcedureDate: lastProcRes.data?.procedure_date ?? null,
    },
  }
}
