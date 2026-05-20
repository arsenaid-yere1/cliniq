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
  const { data, error } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
    data: { full_name: parsed.data.full_name },
  })

  if (error) return { error: error.message }

  // handle_new_user trigger created public.users row with role='staff'.
  // Patch role + full_name if needed.
  if (data.user) {
    const patch: { role?: Role; full_name?: string } = {}
    if (parsed.data.role !== 'staff') patch.role = parsed.data.role
    patch.full_name = parsed.data.full_name
    const { error: updErr } = await admin.from('users').update(patch).eq('id', data.user.id)
    if (updErr) return { error: updErr.message }
  }

  revalidatePath('/settings')
  return { success: true }
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
