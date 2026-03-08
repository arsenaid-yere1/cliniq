import { z } from 'zod'

export const clinicInfoSchema = z.object({
  clinic_name: z.string().min(1, 'Clinic name is required'),
  address_line1: z.string().optional(),
  address_line2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip_code: z.string().optional(),
  phone: z.string().optional(),
  fax: z.string().optional(),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  website: z.string().url('Invalid URL').optional().or(z.literal('')),
})

export type ClinicInfoFormValues = z.infer<typeof clinicInfoSchema>
