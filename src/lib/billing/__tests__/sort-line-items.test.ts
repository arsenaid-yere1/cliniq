import { describe, expect, it } from 'vitest'
import { sortInvoiceLineItemsChronologically } from '../sort-line-items'

describe('sortInvoiceLineItemsChronologically', () => {
  it('orders mixed visit and procedure lines by service date', () => {
    const lines = [
      { id: 'evaluation', service_date: '2025-06-20' },
      { id: 'procedure-2', service_date: '2025-09-05' },
      { id: 'procedure-1', service_date: '2025-07-10' },
      { id: 'follow-up-1', service_date: '2025-08-10' },
    ]

    expect(sortInvoiceLineItemsChronologically(lines).map((line) => line.id)).toEqual([
      'evaluation',
      'procedure-1',
      'follow-up-1',
      'procedure-2',
    ])
  })

  it('preserves source order when service dates match', () => {
    const lines = [
      { id: 'first', service_date: '2025-08-10' },
      { id: 'second', service_date: '2025-08-10' },
    ]

    expect(sortInvoiceLineItemsChronologically(lines).map((line) => line.id))
      .toEqual(['first', 'second'])
  })

  it('does not mutate the source array', () => {
    const lines = [
      { id: 'later', service_date: '2025-09-05' },
      { id: 'earlier', service_date: '2025-07-10' },
    ]

    sortInvoiceLineItemsChronologically(lines)

    expect(lines.map((line) => line.id)).toEqual(['later', 'earlier'])
  })
})
