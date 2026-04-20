import { z } from 'zod'

export const serviceCatalogItemSchema = z.object({
  id: z.string().uuid().optional(),
  cpt_code: z
    .string()
    .min(1, 'CPT code is required')
    .transform((s) => s.trim().toUpperCase())
    .refine((s) => /^[A-Z0-9]+$/.test(s), {
      message: 'CPT code must contain only letters and digits (no spaces, punctuation, or bundles). Enter each code as a separate row.',
    }),
  description: z.string().min(1, 'Description is required'),
  default_price: z.coerce.number().min(0, 'Price must be non-negative'),
  sort_order: z.coerce.number().int().optional(),
})

export type ServiceCatalogItemFormValues = z.infer<typeof serviceCatalogItemSchema>
