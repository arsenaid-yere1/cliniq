'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { clinicInfoSchema, type ClinicInfoFormValues, providerInfoSchema, type ProviderInfoFormValues } from '@/lib/validations/settings'

const CLINIC_ASSETS_BUCKET = 'clinic-assets'
const LOGO_MAX_SIZE = 2 * 1024 * 1024 // 2 MB
const LOGO_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/svg+xml']

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

export async function getProviderProfile() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from('provider_profiles')
    .select('*')
    .eq('user_id', user!.id)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) return { error: error.message }
  return { data }
}

export async function updateProviderProfile(formData: ProviderInfoFormValues) {
  const parsed = providerInfoSchema.safeParse(formData)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: existing } = await supabase
    .from('provider_profiles')
    .select('id')
    .eq('user_id', user!.id)
    .is('deleted_at', null)
    .maybeSingle()

  let result
  if (existing) {
    result = await supabase
      .from('provider_profiles')
      .update({ ...parsed.data, updated_by_user_id: user?.id })
      .eq('id', existing.id)
      .select()
      .single()
  } else {
    result = await supabase
      .from('provider_profiles')
      .insert({
        ...parsed.data,
        user_id: user!.id,
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

export async function uploadClinicLogo(formData: FormData) {
  const file = formData.get('file') as File | null
  if (!file) return { error: 'No file provided' }

  if (!LOGO_ALLOWED_TYPES.includes(file.type)) {
    return { error: 'Invalid file type. Please upload a JPEG, PNG, or SVG image.' }
  }

  if (file.size > LOGO_MAX_SIZE) {
    return { error: 'File too large. Maximum size is 2 MB.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: existing } = await supabase
    .from('clinic_settings')
    .select('id, logo_storage_path')
    .is('deleted_at', null)
    .maybeSingle()

  if (existing?.logo_storage_path) {
    await supabase.storage
      .from(CLINIC_ASSETS_BUCKET)
      .remove([existing.logo_storage_path])
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
  const storagePath = `logos/${Date.now()}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from(CLINIC_ASSETS_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    })

  if (uploadError) return { error: uploadError.message }

  let logoResult
  if (existing) {
    logoResult = await supabase
      .from('clinic_settings')
      .update({
        logo_storage_path: storagePath,
        updated_by_user_id: user?.id,
      })
      .eq('id', existing.id)
      .select()
      .single()
  } else {
    logoResult = await supabase
      .from('clinic_settings')
      .insert({
        clinic_name: '',
        logo_storage_path: storagePath,
        created_by_user_id: user?.id,
        updated_by_user_id: user?.id,
      })
      .select()
      .single()
  }

  if (logoResult.error) return { error: logoResult.error.message }

  revalidatePath('/settings')
  return { data: logoResult.data }
}

export async function removeClinicLogo() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: existing } = await supabase
    .from('clinic_settings')
    .select('id, logo_storage_path')
    .is('deleted_at', null)
    .maybeSingle()

  if (!existing?.logo_storage_path) {
    return { error: 'No logo to remove' }
  }

  const { error: deleteError } = await supabase.storage
    .from(CLINIC_ASSETS_BUCKET)
    .remove([existing.logo_storage_path])

  if (deleteError) return { error: deleteError.message }

  const { error: updateError } = await supabase
    .from('clinic_settings')
    .update({
      logo_storage_path: null,
      updated_by_user_id: user?.id,
    })
    .eq('id', existing.id)

  if (updateError) return { error: updateError.message }

  revalidatePath('/settings')
  return { success: true }
}

export async function getClinicLogoUrl() {
  const supabase = await createClient()

  const { data: settings } = await supabase
    .from('clinic_settings')
    .select('logo_storage_path')
    .is('deleted_at', null)
    .maybeSingle()

  if (!settings?.logo_storage_path) return { url: null }

  const { data, error } = await supabase.storage
    .from(CLINIC_ASSETS_BUCKET)
    .createSignedUrl(settings.logo_storage_path, 3600)

  if (error) return { error: error.message }
  return { url: data.signedUrl }
}
