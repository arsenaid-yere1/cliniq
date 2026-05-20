import { z } from 'zod'

export const ROLES = ['admin', 'provider', 'staff'] as const

export const inviteUserSchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(1),
  role: z.enum(ROLES),
})

export type InviteUserFormValues = z.infer<typeof inviteUserSchema>

export const updateUserRoleSchema = z.object({
  role: z.enum(ROLES),
})
