'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { clinicInfoSchema, type ClinicInfoFormValues } from '@/lib/validations/settings'

export async function getClinicSettings() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('clinic_settings')
    .select('*')
    .is('deleted_at', null)
    .maybeSingle()

  if (error) return { error: error.message }
  return { data }
}

export async function updateClinicSettings(formData: ClinicInfoFormValues) {
  const parsed = clinicInfoSchema.safeParse(formData)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Check if settings already exist
  const { data: existing } = await supabase
    .from('clinic_settings')
    .select('id')
    .is('deleted_at', null)
    .maybeSingle()

  let result
  if (existing) {
    result = await supabase
      .from('clinic_settings')
      .update({ ...parsed.data, updated_by_user_id: user?.id })
      .eq('id', existing.id)
      .select()
      .single()
  } else {
    result = await supabase
      .from('clinic_settings')
      .insert({
        ...parsed.data,
        created_by_user_id: user?.id,
        updated_by_user_id: user?.id,
      })
      .select()
      .single()
  }

  if (result.error) return { error: result.error.message }

  revalidatePath('/settings')
  return { data: result.data }
}
