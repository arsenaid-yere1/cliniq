import { describe, it, expect } from 'vitest'
import {
  INVOICE_STATUSES,
  TERMINAL_STATUSES,
  ALLOWED_TRANSITIONS,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_COLORS,
  isTerminalStatus,
  canTransitionTo,
  type InvoiceStatus,
} from '../invoice-status'

describe('INVOICE_STATUSES', () => {
  it('contains all expected statuses', () => {
    expect(INVOICE_STATUSES).toEqual([
      'draft',
      'issued',
      'paid',
      'void',
      'overdue',
      'uncollectible',
    ])
  })
})

describe('TERMINAL_STATUSES', () => {
  it('includes paid, void, and uncollectible', () => {
    expect(TERMINAL_STATUSES).toEqual(['paid', 'void', 'uncollectible'])
  })
})

describe('ALLOWED_TRANSITIONS', () => {
  it('has transition rules for every status', () => {
    for (const status of INVOICE_STATUSES) {
      expect(ALLOWED_TRANSITIONS[status]).toBeDefined()
      expect(Array.isArray(ALLOWED_TRANSITIONS[status])).toBe(true)
    }
  })

  it('only references valid statuses in transitions', () => {
    for (const status of INVOICE_STATUSES) {
      for (const target of ALLOWED_TRANSITIONS[status]) {
        expect(INVOICE_STATUSES).toContain(target)
      }
    }
  })

  it('draft can transition to issued or void', () => {
    expect(ALLOWED_TRANSITIONS.draft).toEqual(['issued', 'void'])
  })

  it('issued can transition to paid, overdue, or void', () => {
    expect(ALLOWED_TRANSITIONS.issued).toEqual(['paid', 'overdue', 'void'])
  })

  it('overdue can transition to paid or uncollectible', () => {
    expect(ALLOWED_TRANSITIONS.overdue).toEqual(['paid', 'uncollectible'])
  })

  it('terminal statuses have no transitions', () => {
    expect(ALLOWED_TRANSITIONS.paid).toEqual([])
    expect(ALLOWED_TRANSITIONS.void).toEqual([])
    expect(ALLOWED_TRANSITIONS.uncollectible).toEqual([])
  })

  it('does not allow self-transitions', () => {
    for (const status of INVOICE_STATUSES) {
      expect(ALLOWED_TRANSITIONS[status]).not.toContain(status)
    }
  })
})

describe('INVOICE_STATUS_LABELS', () => {
  it('has a label for every status', () => {
    for (const status of INVOICE_STATUSES) {
      expect(INVOICE_STATUS_LABELS[status]).toBeTruthy()
    }
  })
})

describe('INVOICE_STATUS_COLORS', () => {
  it('has a color for every status', () => {
    for (const status of INVOICE_STATUSES) {
      expect(INVOICE_STATUS_COLORS[status]).toBeTruthy()
    }
  })
})

describe('isTerminalStatus', () => {
  it('returns true for terminal statuses', () => {
    expect(isTerminalStatus('paid')).toBe(true)
    expect(isTerminalStatus('void')).toBe(true)
    expect(isTerminalStatus('uncollectible')).toBe(true)
  })

  it('returns false for non-terminal statuses', () => {
    expect(isTerminalStatus('draft')).toBe(false)
    expect(isTerminalStatus('issued')).toBe(false)
    expect(isTerminalStatus('overdue')).toBe(false)
  })
})

describe('canTransitionTo', () => {
  it('allows valid transitions', () => {
    expect(canTransitionTo('draft', 'issued')).toBe(true)
    expect(canTransitionTo('draft', 'void')).toBe(true)
    expect(canTransitionTo('issued', 'paid')).toBe(true)
    expect(canTransitionTo('overdue', 'uncollectible')).toBe(true)
  })

  it('rejects invalid transitions', () => {
    expect(canTransitionTo('draft', 'paid')).toBe(false)
    expect(canTransitionTo('draft', 'overdue')).toBe(false)
    expect(canTransitionTo('paid', 'draft')).toBe(false)
    expect(canTransitionTo('void', 'issued')).toBe(false)
  })

  it('rejects self-transitions', () => {
    for (const status of INVOICE_STATUSES) {
      expect(canTransitionTo(status, status)).toBe(false)
    }
  })
})
