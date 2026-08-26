import { z } from 'zod'

export const DEFAULT_CLINIC_TIMEZONE = 'America/Los_Angeles'

export function isValidIanaTimezone(value: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

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
  timezone: z.string()
    .trim()
    .min(1, 'Clinic timezone is required')
    .refine(isValidIanaTimezone, 'Use a valid IANA timezone')
    .optional(),
})

export type ClinicInfoFormValues = z.infer<typeof clinicInfoSchema>

export const providerInfoSchema = z.object({
  display_name: z.string().min(1, 'Provider name is required'),
  credentials: z.string().optional(),
  license_number: z.string().optional(),
  npi_number: z.string().optional(),
  supervising_provider_id: z.string().uuid().optional().or(z.literal('')),
})

export type ProviderInfoFormValues = z.infer<typeof providerInfoSchema>
