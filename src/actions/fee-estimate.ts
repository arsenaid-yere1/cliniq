'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  feeEstimateItemSchema,
  type FeeEstimateItemFormValues,
  type FeeEstimateTotals,
} from '@/lib/validations/fee-estimate'

export async function listFeeEstimateConfig() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('fee_estimate_config')
    .select('*')
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })

  if (error) return { error: error.message, data: [] }
  return { data: data ?? [] }
}

export async function createFeeEstimateItem(values: FeeEstimateItemFormValues) {
  const parsed = feeEstimateItemSchema.safeParse(values)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: maxRow } = await supabase
    .from('fee_estimate_config')
    .select('sort_order')
    .is('deleted_at', null)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextSortOrder = (maxRow?.sort_order ?? 0) + 1

  const { data, error } = await supabase
    .from('fee_estimate_config')
    .insert({
      description: parsed.data.description,
      fee_category: parsed.data.fee_category,
      price_min: parsed.data.price_min,
      price_max: parsed.data.price_max,
      sort_order: nextSortOrder,
      created_by_user_id: user?.id,
      updated_by_user_id: user?.id,
    })
    .select()
    .single()

  if (error) return { error: error.message }
  revalidatePath('/settings')
  return { data }
}

export async function updateFeeEstimateItem(id: string, values: FeeEstimateItemFormValues) {
  const parsed = feeEstimateItemSchema.safeParse(values)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from('fee_estimate_config')
    .update({
      description: parsed.data.description,
      fee_category: parsed.data.fee_category,
      price_min: parsed.data.price_min,
      price_max: parsed.data.price_max,
      updated_by_user_id: user?.id,
    })
    .eq('id', id)
    .select()
    .single()

  if (error) return { error: error.message }
  revalidatePath('/settings')
  return { data }
}

export async function deleteFeeEstimateItem(id: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('fee_estimate_config')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/settings')
  return { success: true }
}

// Aggregate: sum min/max per category — used by AI generation
export async function getFeeEstimateTotals(): Promise<FeeEstimateTotals> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('fee_estimate_config')
    .select('fee_category, price_min, price_max')
    .is('deleted_at', null)

  const totals: FeeEstimateTotals = {
    professional_min: 0,
    professional_max: 0,
    practice_center_min: 0,
    practice_center_max: 0,
  }

  for (const item of data ?? []) {
    if (item.fee_category === 'professional') {
      totals.professional_min += Number(item.price_min)
      totals.professional_max += Number(item.price_max)
    } else {
      totals.practice_center_min += Number(item.price_min)
      totals.practice_center_max += Number(item.price_max)
    }
  }

  return totals
}
