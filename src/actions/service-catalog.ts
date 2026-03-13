'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  serviceCatalogItemSchema,
  type ServiceCatalogItemFormValues,
} from '@/lib/validations/service-catalog'

export async function listServiceCatalog() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('service_catalog')
    .select('*')
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })

  if (error) return { error: error.message, data: [] }
  return { data: data ?? [] }
}

export async function createServiceCatalogItem(values: ServiceCatalogItemFormValues) {
  const parsed = serviceCatalogItemSchema.safeParse(values)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Get next sort_order
  const { data: maxRow } = await supabase
    .from('service_catalog')
    .select('sort_order')
    .is('deleted_at', null)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextSortOrder = (maxRow?.sort_order ?? 0) + 1

  const { data, error } = await supabase
    .from('service_catalog')
    .insert({
      cpt_code: parsed.data.cpt_code,
      description: parsed.data.description,
      default_price: parsed.data.default_price,
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

export async function updateServiceCatalogItem(id: string, values: ServiceCatalogItemFormValues) {
  const parsed = serviceCatalogItemSchema.safeParse(values)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from('service_catalog')
    .update({
      cpt_code: parsed.data.cpt_code,
      description: parsed.data.description,
      default_price: parsed.data.default_price,
      updated_by_user_id: user?.id,
    })
    .eq('id', id)
    .select()
    .single()

  if (error) return { error: error.message }
  revalidatePath('/settings')
  return { data }
}

export async function deleteServiceCatalogItem(id: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('service_catalog')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/settings')
  return { success: true }
}

// Used by getInvoiceFormData to look up default prices by CPT code
export async function getServiceCatalogPriceMap(): Promise<Record<string, number>> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('service_catalog')
    .select('cpt_code, default_price')
    .is('deleted_at', null)

  const priceMap: Record<string, number> = {}
  for (const item of data ?? []) {
    priceMap[item.cpt_code] = Number(item.default_price)
  }
  return priceMap
}
