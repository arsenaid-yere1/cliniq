import { describe, it, expect } from 'vitest'
import {
  invoiceLineItemSchema,
  createInvoiceSchema,
  updateInvoiceSchema,
} from '../invoice'

const validLineItem = {
  service_date: '2026-03-01',
  cpt_code: '99213',
  description: 'Office visit',
  quantity: 1,
  unit_price: 150,
  total_price: 150,
}

describe('invoiceLineItemSchema', () => {
  it('accepts valid line item', () => {
    const result = invoiceLineItemSchema.safeParse(validLineItem)
    expect(result.success).toBe(true)
  })

  it('coerces string numbers', () => {
    const result = invoiceLineItemSchema.safeParse({
      ...validLineItem,
      quantity: '2',
      unit_price: '75.50',
      total_price: '151.00',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.quantity).toBe(2)
      expect(result.data.unit_price).toBe(75.5)
    }
  })

  it('rejects quantity less than 1', () => {
    const result = invoiceLineItemSchema.safeParse({
      ...validLineItem,
      quantity: 0,
    })
    expect(result.success).toBe(false)
  })

  it('rejects negative unit_price', () => {
    const result = invoiceLineItemSchema.safeParse({
      ...validLineItem,
      unit_price: -10,
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty cpt_code', () => {
    const result = invoiceLineItemSchema.safeParse({
      ...validLineItem,
      cpt_code: '',
    })
    expect(result.success).toBe(false)
  })

  it('accepts empty string for procedure_id', () => {
    const result = invoiceLineItemSchema.safeParse({
      ...validLineItem,
      procedure_id: '',
    })
    expect(result.success).toBe(true)
  })

  it('accepts valid UUID for procedure_id', () => {
    const result = invoiceLineItemSchema.safeParse({
      ...validLineItem,
      procedure_id: '550e8400-e29b-41d4-a716-446655440000',
    })
    expect(result.success).toBe(true)
  })
})

describe('createInvoiceSchema', () => {
  const validInvoice = {
    invoice_type: 'visit' as const,
    invoice_date: '2026-03-01',
    line_items: [validLineItem],
  }

  it('accepts valid invoice', () => {
    const result = createInvoiceSchema.safeParse(validInvoice)
    expect(result.success).toBe(true)
  })

  it('defaults claim_type to Personal Injury', () => {
    const result = createInvoiceSchema.safeParse(validInvoice)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.claim_type).toBe('Personal Injury')
    }
  })

  it('defaults diagnoses_snapshot to empty array', () => {
    const result = createInvoiceSchema.safeParse(validInvoice)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.diagnoses_snapshot).toEqual([])
    }
  })

  it('rejects empty line_items array', () => {
    const result = createInvoiceSchema.safeParse({
      ...validInvoice,
      line_items: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid invoice_type', () => {
    const result = createInvoiceSchema.safeParse({
      ...validInvoice,
      invoice_type: 'invalid',
    })
    expect(result.success).toBe(false)
  })

  it('accepts empty string for optional fields', () => {
    const result = createInvoiceSchema.safeParse({
      ...validInvoice,
      indication: '',
      payee_name: '',
      payee_address: '',
      notes: '',
    })
    expect(result.success).toBe(true)
  })
})

describe('updateInvoiceSchema', () => {
  it('allows partial updates but still requires line_items', () => {
    const result = updateInvoiceSchema.safeParse({
      line_items: [validLineItem],
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty line_items on update', () => {
    const result = updateInvoiceSchema.safeParse({
      line_items: [],
    })
    expect(result.success).toBe(false)
  })
})
