'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin, type Role } from '@/lib/auth/require-role'
import { inviteUserSchema, type InviteUserFormValues, ROLES } from '@/lib/validations/users'

export interface UserListItem {
  id: string
  email: string
  full_name: string
  role: Role
  is_active: boolean
  created_at: string
}

export async function listUsers(): Promise<{ data?: UserListItem[]; error?: string }> {
  try {
    await requireAdmin()
  } catch {
    return { error: 'Forbidden' }
  }
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('users')
    .select('id, email, full_name, role, is_active, created_at')
    .order('created_at', { ascending: false })

  if (error) return { error: error.message }
  return { data: (data ?? []) as UserListItem[] }
}

export async function inviteUser(formData: InviteUserFormValues) {
  try {
    await requireAdmin()
  } catch {
    return { error: 'Forbidden' }
  }

  const parsed = inviteUserSchema.safeParse(formData)
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors }
  }

  const admin = createAdminClient()

  // Create user without sending email. email_confirm=true marks as verified so
  // the recovery link can be redeemed immediately.
  const tempPassword = crypto.randomUUID() + crypto.randomUUID()
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: parsed.data.full_name },
  })
  if (createErr) return { error: createErr.message }
  if (!created.user) return { error: 'User creation returned no user' }

  // handle_new_user trigger inserted public.users row with role='staff'.
  // Patch role + full_name.
  const patch: { role?: Role; full_name?: string } = { full_name: parsed.data.full_name }
  if (parsed.data.role !== 'staff') patch.role = parsed.data.role
  const { error: updErr } = await admin.from('users').update(patch).eq('id', created.user.id)
  if (updErr) return { error: updErr.message }

  // Generate one-time recovery link the inviter can share manually.
  // redirectTo overrides Supabase SITE_URL so dev/prod hosts resolve correctly.
  // type=recovery is used since user already exists (createUser above) and
  // generateLink does not support 'invite' for already-confirmed users.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: parsed.data.email,
    options: appUrl
      ? { redirectTo: `${appUrl}/auth/callback?type=recovery` }
      : undefined,
  })
  if (linkErr) return { error: linkErr.message }

  const link = linkData.properties?.action_link
  if (!link) return { error: 'No action_link returned' }

  revalidatePath('/settings')
  return { success: true, link, email: parsed.data.email }
}

export async function updateUserRole(userId: string, role: Role) {
  let me
  try {
    me = await requireAdmin()
  } catch {
    return { error: 'Forbidden' }
  }
  if (userId === me.id) return { error: 'Cannot change your own role' }
  if (!ROLES.includes(role)) return { error: 'Invalid role' }

  const supabase = await createClient()
  const { error } = await supabase.from('users').update({ role }).eq('id', userId)
  if (error) return { error: error.message }

  revalidatePath('/settings')
  return { success: true }
}

export async function setUserActive(userId: string, isActive: boolean) {
  let me
  try {
    me = await requireAdmin()
  } catch {
    return { error: 'Forbidden' }
  }
  if (userId === me.id) return { error: 'Cannot deactivate yourself' }

  const admin = createAdminClient()

  // ban_duration on auth.users blocks login at the Supabase Auth layer.
  // 'none' lifts the ban; any duration string (e.g. '876000h' ~= 100yr) applies it.
  const { error: banErr } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: isActive ? 'none' : '876000h',
  })
  if (banErr) return { error: banErr.message }

  const { error } = await admin.from('users').update({ is_active: isActive }).eq('id', userId)
  if (error) return { error: error.message }

  revalidatePath('/settings')
  return { success: true }
}
