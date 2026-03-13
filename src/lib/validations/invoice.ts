import { z } from 'zod'

export const invoiceLineItemSchema = z.object({
  id: z.string().uuid().optional(),
  procedure_id: z.string().uuid().optional().or(z.literal('')),
  service_date: z.string().min(1, 'Service date is required'),
  cpt_code: z.string().min(1, 'CPT code is required'),
  description: z.string().min(1, 'Description is required'),
  quantity: z.number().int().min(1, 'Quantity must be at least 1'),
  unit_price: z.number().min(0, 'Unit price must be non-negative'),
  total_price: z.number().min(0),
})

export const createInvoiceSchema = z.object({
  invoice_type: z.enum(['visit', 'facility']),
  invoice_date: z.string().min(1, 'Invoice date is required'),
  claim_type: z.string().default('Personal Injury'),
  indication: z.string().optional().or(z.literal('')),
  diagnoses_snapshot: z.array(z.object({
    icd10_code: z.string().nullable(),
    description: z.string(),
  })).default([]),
  payee_name: z.string().optional().or(z.literal('')),
  payee_address: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal('')),
  line_items: z.array(invoiceLineItemSchema).min(1, 'At least one line item is required'),
})

export const updateInvoiceSchema = createInvoiceSchema.partial().extend({
  line_items: z.array(invoiceLineItemSchema).min(1, 'At least one line item is required'),
})

export type InvoiceLineItemFormValues = z.infer<typeof invoiceLineItemSchema>
export type CreateInvoiceFormValues = z.infer<typeof createInvoiceSchema>
export type UpdateInvoiceFormValues = z.infer<typeof updateInvoiceSchema>
