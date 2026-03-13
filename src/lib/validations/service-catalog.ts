import { z } from 'zod'

export const serviceCatalogItemSchema = z.object({
  id: z.string().uuid().optional(),
  cpt_code: z.string().min(1, 'CPT code is required'),
  description: z.string().min(1, 'Description is required'),
  default_price: z.coerce.number().min(0, 'Price must be non-negative'),
  sort_order: z.coerce.number().int().optional(),
})

export type ServiceCatalogItemFormValues = z.infer<typeof serviceCatalogItemSchema>
