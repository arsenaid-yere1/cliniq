import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { createMockSupabase, createMockQueryBuilder, type MockSupabaseClient } from '@/test-utils/supabase-mock'
import { TEST_INVOICE_ID } from '@/test-utils/fixtures'

// ---- Mocks ----

let mockSupabase: MockSupabaseClient

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => mockSupabase),
}))

// ---- SUT ----

import {
  issueInvoice,
  markInvoicePaid,
  recordPayment,
  voidInvoice,
  markInvoiceOverdue,
  writeOffInvoice,
  getInvoiceStatusHistory,
} from '../invoice-status'

// ---- Helpers ----

const OPEN_CASE = { data: { case_status: 'active' }, error: null }

function mockFromPerTable(tables: Record<string, { data: unknown; error: unknown }>) {
  // Always include an open case by default so assertCaseNotClosed passes
  const merged: Record<string, { data: unknown; error: unknown }> = {
    cases: OPEN_CASE,
    ...tables,
  }
  mockSupabase.from.mockImplementation((table: string) => {
    const result = merged[table] ?? { data: null, error: null }
    return createMockQueryBuilder(result)
  })
}

// ---- Tests ----

describe('issueInvoice', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('returns error when invoice has no line items', async () => {
    mockFromPerTable({
      invoice_line_items: { data: [], error: null },
    })
    const result = await issueInvoice(TEST_INVOICE_ID)
    expect(result.error).toContain('no line items')
  })

  it('returns error when invoice is not found', async () => {
    mockFromPerTable({
      invoice_line_items: { data: [{ id: 'li-1' }], error: null },
      invoices: { data: null, error: { message: 'not found' } },
    })
    const result = await issueInvoice(TEST_INVOICE_ID)
    expect(result.error).toBeTruthy()
  })

  it('returns error for invalid transition (e.g. paid → issued)', async () => {
    mockFromPerTable({
      invoice_line_items: { data: [{ id: 'li-1' }], error: null },
      invoices: { data: { id: TEST_INVOICE_ID, status: 'paid', case_id: 'c-1' }, error: null },
      invoice_status_history: { data: null, error: null },
    })
    const result = await issueInvoice(TEST_INVOICE_ID)
    expect(result.error).toContain('Cannot change status')
  })

  it('succeeds for draft → issued with line items', async () => {
    mockFromPerTable({
      invoice_line_items: { data: [{ id: 'li-1' }], error: null },
      invoices: { data: { id: TEST_INVOICE_ID, status: 'draft', case_id: 'c-1' }, error: null },
      invoice_status_history: { data: null, error: null },
    })
    const result = await issueInvoice(TEST_INVOICE_ID)
    expect(result.error).toBeNull()
  })
})

describe('markInvoicePaid', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('returns error when not authenticated', async () => {
    ;(mockSupabase.auth.getUser as Mock).mockResolvedValue({
      data: { user: null },
      error: null,
    })
    const result = await markInvoicePaid(TEST_INVOICE_ID, { amount: 100 })
    expect(result.error).toBe('Not authenticated')
  })

  it('succeeds for issued → paid when amount equals balance due', async () => {
    mockFromPerTable({
      invoices: {
        data: { id: TEST_INVOICE_ID, status: 'issued', case_id: 'c-1', total_amount: 1000, paid_amount: 0 },
        error: null,
      },
      payments: { data: null, error: null },
      invoice_status_history: { data: null, error: null },
    })
    const result = await markInvoicePaid(TEST_INVOICE_ID, { amount: 1000 })
    expect(result.error).toBeNull()
  })

  it('rejects paid → paid (terminal status)', async () => {
    mockFromPerTable({
      invoices: {
        data: { id: TEST_INVOICE_ID, status: 'paid', case_id: 'c-1', total_amount: 1000, paid_amount: 1000 },
        error: null,
      },
    })
    const result = await markInvoicePaid(TEST_INVOICE_ID, { amount: 10 })
    expect(result.error).toContain('Cannot mark invoice paid')
  })

  it('rejects amount <= 0', async () => {
    mockFromPerTable({
      invoices: {
        data: { id: TEST_INVOICE_ID, status: 'issued', case_id: 'c-1', total_amount: 1000, paid_amount: 0 },
        error: null,
      },
    })
    const result = await markInvoicePaid(TEST_INVOICE_ID, { amount: 0 })
    expect(result.error).toContain('greater than 0')
  })

  it('rejects amount > balance due (overpayment)', async () => {
    mockFromPerTable({
      invoices: {
        data: { id: TEST_INVOICE_ID, status: 'issued', case_id: 'c-1', total_amount: 1000, paid_amount: 0 },
        error: null,
      },
    })
    const result = await markInvoicePaid(TEST_INVOICE_ID, { amount: 1500 })
    expect(result.error).toContain('exceeds balance due')
  })

  it('requires settlement reason when amount < balance due', async () => {
    mockFromPerTable({
      invoices: {
        data: { id: TEST_INVOICE_ID, status: 'issued', case_id: 'c-1', total_amount: 1000, paid_amount: 0 },
        error: null,
      },
    })
    const result = await markInvoicePaid(TEST_INVOICE_ID, { amount: 600 })
    expect(result.error).toContain('Settlement reason is required')
  })

  it('succeeds when amount < balance due with settlement reason', async () => {
    mockFromPerTable({
      invoices: {
        data: { id: TEST_INVOICE_ID, status: 'issued', case_id: 'c-1', total_amount: 1000, paid_amount: 0 },
        error: null,
      },
      payments: { data: null, error: null },
      invoice_status_history: { data: null, error: null },
    })
    const result = await markInvoicePaid(TEST_INVOICE_ID, {
      amount: 600,
      settlementReason: 'PI settlement final',
    })
    expect(result.error).toBeNull()
  })

  it('blocks when case is closed', async () => {
    mockFromPerTable({
      cases: { data: { case_status: 'closed' }, error: null },
      invoices: {
        data: { id: TEST_INVOICE_ID, status: 'issued', case_id: 'c-1', total_amount: 1000, paid_amount: 0 },
        error: null,
      },
    })
    const result = await markInvoicePaid(TEST_INVOICE_ID, { amount: 1000 })
    expect(result.error).toContain('locked')
  })
})

describe('recordPayment', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('accepts partial payment on issued invoice without status change', async () => {
    mockFromPerTable({
      invoices: {
        data: { id: TEST_INVOICE_ID, status: 'issued', case_id: 'c-1', total_amount: 1000, paid_amount: 0 },
        error: null,
      },
      payments: { data: null, error: null },
    })
    const result = await recordPayment(TEST_INVOICE_ID, { amount: 400 })
    expect(result.error).toBeNull()
  })

  it('accepts partial payment on overdue invoice', async () => {
    mockFromPerTable({
      invoices: {
        data: { id: TEST_INVOICE_ID, status: 'overdue', case_id: 'c-1', total_amount: 1000, paid_amount: 100 },
        error: null,
      },
      payments: { data: null, error: null },
    })
    const result = await recordPayment(TEST_INVOICE_ID, { amount: 300 })
    expect(result.error).toBeNull()
  })

  it('rejects partial payment on draft invoice', async () => {
    mockFromPerTable({
      invoices: {
        data: { id: TEST_INVOICE_ID, status: 'draft', case_id: 'c-1', total_amount: 1000, paid_amount: 0 },
        error: null,
      },
    })
    const result = await recordPayment(TEST_INVOICE_ID, { amount: 100 })
    expect(result.error).toContain('Cannot record payment')
  })

  it('rejects partial payment on paid invoice', async () => {
    mockFromPerTable({
      invoices: {
        data: { id: TEST_INVOICE_ID, status: 'paid', case_id: 'c-1', total_amount: 1000, paid_amount: 1000 },
        error: null,
      },
    })
    const result = await recordPayment(TEST_INVOICE_ID, { amount: 100 })
    expect(result.error).toContain('Cannot record payment')
  })

  it('rejects overpayment', async () => {
    mockFromPerTable({
      invoices: {
        data: { id: TEST_INVOICE_ID, status: 'issued', case_id: 'c-1', total_amount: 1000, paid_amount: 800 },
        error: null,
      },
    })
    const result = await recordPayment(TEST_INVOICE_ID, { amount: 500 })
    expect(result.error).toContain('exceeds balance due')
  })

  it('rejects amount <= 0', async () => {
    mockFromPerTable({
      invoices: {
        data: { id: TEST_INVOICE_ID, status: 'issued', case_id: 'c-1', total_amount: 1000, paid_amount: 0 },
        error: null,
      },
    })
    const result = await recordPayment(TEST_INVOICE_ID, { amount: 0 })
    expect(result.error).toContain('greater than 0')
  })
})

describe('voidInvoice', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('requires a reason', async () => {
    const result = await voidInvoice(TEST_INVOICE_ID, '')
    expect(result.error).toContain('reason is required')
  })

  it('requires a non-whitespace reason', async () => {
    const result = await voidInvoice(TEST_INVOICE_ID, '   ')
    expect(result.error).toContain('reason is required')
  })

  it('succeeds for draft → void with reason', async () => {
    mockFromPerTable({
      invoices: { data: { id: TEST_INVOICE_ID, status: 'draft', case_id: 'c-1' }, error: null },
      invoice_status_history: { data: null, error: null },
    })
    const result = await voidInvoice(TEST_INVOICE_ID, 'Duplicate invoice')
    expect(result.error).toBeNull()
  })

  it('rejects void from terminal status', async () => {
    mockFromPerTable({
      invoices: { data: { id: TEST_INVOICE_ID, status: 'paid', case_id: 'c-1' }, error: null },
    })
    const result = await voidInvoice(TEST_INVOICE_ID, 'some reason')
    expect(result.error).toContain('Cannot change status')
  })
})

describe('markInvoiceOverdue', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('succeeds for issued → overdue', async () => {
    mockFromPerTable({
      invoices: { data: { id: TEST_INVOICE_ID, status: 'issued', case_id: 'c-1' }, error: null },
      invoice_status_history: { data: null, error: null },
    })
    const result = await markInvoiceOverdue(TEST_INVOICE_ID)
    expect(result.error).toBeNull()
  })

  it('rejects overdue from draft', async () => {
    mockFromPerTable({
      invoices: { data: { id: TEST_INVOICE_ID, status: 'draft', case_id: 'c-1' }, error: null },
    })
    const result = await markInvoiceOverdue(TEST_INVOICE_ID)
    expect(result.error).toContain('Cannot change status')
  })
})

describe('writeOffInvoice', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('requires a reason', async () => {
    const result = await writeOffInvoice(TEST_INVOICE_ID, '')
    expect(result.error).toContain('reason is required')
  })

  it('succeeds for overdue → uncollectible', async () => {
    mockFromPerTable({
      invoices: { data: { id: TEST_INVOICE_ID, status: 'overdue', case_id: 'c-1' }, error: null },
      invoice_status_history: { data: null, error: null },
    })
    const result = await writeOffInvoice(TEST_INVOICE_ID, 'Debtor unreachable')
    expect(result.error).toBeNull()
  })

  it('rejects write-off from draft', async () => {
    mockFromPerTable({
      invoices: { data: { id: TEST_INVOICE_ID, status: 'draft', case_id: 'c-1' }, error: null },
    })
    const result = await writeOffInvoice(TEST_INVOICE_ID, 'some reason')
    expect(result.error).toContain('Cannot change status')
  })
})

describe('getInvoiceStatusHistory', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('returns history records', async () => {
    const history = [
      { id: '1', previous_status: 'draft', new_status: 'issued', changed_at: '2026-01-01', changed_by_user_id: 'u1', reason: null, metadata: null },
    ]
    mockFromPerTable({
      invoice_status_history: { data: history, error: null },
    })

    const result = await getInvoiceStatusHistory(TEST_INVOICE_ID)
    expect(result.error).toBeNull()
    expect(result.data).toEqual(history)
  })

  it('returns error on query failure', async () => {
    mockFromPerTable({
      invoice_status_history: { data: null, error: { message: 'DB error' } },
    })

    const result = await getInvoiceStatusHistory(TEST_INVOICE_ID)
    expect(result.error).toBe('DB error')
    expect(result.data).toBeNull()
  })
})
