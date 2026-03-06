'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { attorneySchema, type AttorneyFormValues } from '@/lib/validations/attorney'

export async function createAttorney(data: AttorneyFormValues) {
  const parsed = attorneySchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: attorney, error } = await supabase
    .from('attorneys')
    .insert({
      ...parsed.data,
      email: parsed.data.email || null,
      created_by_user_id: user?.id,
      updated_by_user_id: user?.id,
    })
    .select()
    .single()

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/attorneys')
  return { data: attorney }
}

export async function updateAttorney(id: string, data: AttorneyFormValues) {
  const parsed = attorneySchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: attorney, error } = await supabase
    .from('attorneys')
    .update({
      ...parsed.data,
      email: parsed.data.email || null,
      updated_by_user_id: user?.id,
    })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/attorneys')
  return { data: attorney }
}

export async function deleteAttorney(id: string) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('attorneys')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/attorneys')
  return { success: true }
}

export async function getAttorney(id: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('attorneys')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single()

  if (error) {
    return { error: error.message }
  }

  return { data }
}

export async function listAttorneys(search?: string) {
  const supabase = await createClient()

  let query = supabase
    .from('attorneys')
    .select('*')
    .is('deleted_at', null)
    .order('last_name', { ascending: true })

  if (search) {
    query = query.or(
      `first_name.ilike.%${search}%,last_name.ilike.%${search}%,firm_name.ilike.%${search}%`
    )
  }

  const { data, error } = await query

  if (error) {
    return { error: error.message, data: [] }
  }

  return { data: data ?? [] }
}
