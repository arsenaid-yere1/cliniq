import { describe, expect, it } from 'vitest'
import { formatInvoiceQuantity } from './format-quantity'

describe('formatInvoiceQuantity', () => {
  it.each([
    [1, '0232T\n86999\n76942', 'PRP preparation and injection with US guided', 'visit', '1 site'],
    [2, '0232T\n86999\n76942', 'PRP preparation and injection — lumbar facet\nCervical, Lumbar', 'visit', '2 sites'],
    [2, 'custom', 'PRP Injection — Knee', 'visit', '2 sites'],
    [1, '0232T\n86999\n76942', 'Medical site utilization', 'facility', '1'],
    [2, '0232T', 'PRP Injection', 'facility', '2'],
    [1, '99204', 'Initial exam (45-60min)', 'visit', '1 visit'],
    [2, '99213', 'Follow-up / discharge visit', 'visit', '2 visits'],
    [50, 'BOTOX-UNIT', 'BOTOX onabotulinumtoxinA administered', 'visit', '50 units'],
    [1, 'BOTOX-UNIT', 'Unavoidable discarded BOTOX drug allocation (JW)', 'visit', '1 unit'],
    [1, '76140', 'MRI review', 'visit', '1'],
    [2, '0232T', 'Custom service', 'visit', '2'],
    [1, 'custom', 'Review of prior PRP injection', 'visit', '1'],
  ])('formats %s / %s / %s / %s as %s', (quantity, code, description, type, expected) => {
    expect(formatInvoiceQuantity(quantity, code, description, type)).toBe(expected)
  })
})
