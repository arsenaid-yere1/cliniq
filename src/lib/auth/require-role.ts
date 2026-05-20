import { createClient } from '@/lib/supabase/server'

export type Role = 'admin' | 'provider' | 'staff'

export interface CurrentUser {
  id: string
  email: string
  full_name: string
  role: Role
  is_active: boolean
}

export async function getCurrentUserWithRole(): Promise<CurrentUser | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('users')
    .select('id, email, full_name, role, is_active')
    .eq('id', user.id)
    .single()

  if (error || !data) return null
  return data as CurrentUser
}

export async function requireAdmin(): Promise<CurrentUser> {
  const me = await getCurrentUserWithRole()
  if (!me || me.role !== 'admin') {
    throw new Error('Forbidden')
  }
  return me
}
