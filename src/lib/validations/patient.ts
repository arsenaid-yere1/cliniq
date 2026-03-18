import { z } from 'zod'

export const patientIdentitySchema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  middle_name: z.string().optional(),
  date_of_birth: z.string().min(1, 'Date of birth is required'),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
})

export const patientDetailsSchema = z.object({
  phone_primary: z.string().optional(),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  address_line1: z.string().optional(),
  address_line2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip_code: z.string().optional(),
  accident_date: z.string().optional(),
  accident_type: z.enum(['auto', 'slip_and_fall', 'workplace', 'other']).optional(),
  accident_description: z.string().optional(),
  attorney_id: z.string().uuid().optional().or(z.literal('')),
  assigned_provider_id: z.string().uuid().optional().or(z.literal('')),
  lien_on_file: z.boolean(),
})

export const createPatientCaseSchema = patientIdentitySchema.merge(patientDetailsSchema)

// --- Edit schemas (split by table) ---

export const editPatientSchema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  middle_name: z.string().optional(),
  date_of_birth: z.string().min(1, 'Date of birth is required'),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
  phone_primary: z.string().optional(),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  address_line1: z.string().optional(),
  address_line2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip_code: z.string().optional(),
})

export const editCaseSchema = z.object({
  accident_date: z.string().optional(),
  accident_type: z.enum(['auto', 'slip_and_fall', 'workplace', 'other']).optional(),
  accident_description: z.string().optional(),
  attorney_id: z.string().uuid().optional().or(z.literal('')),
  assigned_provider_id: z.string().uuid().optional().or(z.literal('')),
  lien_on_file: z.boolean(),
})

export type PatientIdentityValues = z.infer<typeof patientIdentitySchema>
export type PatientDetailsValues = z.infer<typeof patientDetailsSchema>
export type CreatePatientCaseValues = z.infer<typeof createPatientCaseSchema>
export type EditPatientValues = z.infer<typeof editPatientSchema>
export type EditCaseValues = z.infer<typeof editCaseSchema>
