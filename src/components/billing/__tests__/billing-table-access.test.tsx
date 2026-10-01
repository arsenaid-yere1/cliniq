// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
const { push, navigate, pdf, remove } = vi.hoisted(() => ({ push: vi.fn(), navigate: vi.fn(), pdf: vi.fn(), remove: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ href, ...props }: ComponentProps<'a'>) => <a {...props} href={href} onClick={event => { event.preventDefault(); navigate(href) }} /> }))
vi.mock('@/actions/billing', () => ({ generateInvoicePdf: pdf, deleteInvoice: remove }))
import { BillingTable } from '../billing-table'
const invoice = { id: 'invoice', invoice_date: '2026-09-01', invoice_type: 'visit' as const, total_amount: 100, paid_amount: 0, status: 'draft' }
beforeEach(() => { push.mockReset(); navigate.mockReset(); remove.mockReset(); pdf.mockResolvedValue({ error: 'Synthetic failure' }) })
afterEach(cleanup)
it('opens via a keyboard link while row and nested actions navigate independently', async () => {
  const user = userEvent.setup(); render(<BillingTable invoices={[invoice]} caseId="case" />)
  const link = screen.getByRole('link', { name: 'Open invoice: Medical Invoice, 09/01/2026' })
  expect(link.getAttribute('href')).toBe('/patients/case/billing/invoice')
  for (let i = 0; i < 10 && document.activeElement !== link; i++) await user.tab()
  expect(document.activeElement).toBe(link)
  await user.keyboard('{Enter}'); expect(navigate).toHaveBeenCalledOnce(); expect(push).not.toHaveBeenCalled()
  fireEvent.click(link.closest('tr')!, { ctrlKey: true }); expect(push).not.toHaveBeenCalled()
  fireEvent.click(link.closest('tr')!); expect(push).toHaveBeenCalledExactlyOnceWith('/patients/case/billing/invoice')
  push.mockClear()
  await user.click(screen.getByRole('button', { name: 'Download invoice PDF' }))
  await user.click(screen.getByRole('button', { name: 'Delete invoice' }))
  expect(screen.getByRole('alertdialog')).toBeTruthy()
  expect(remove).not.toHaveBeenCalled(); expect(push).not.toHaveBeenCalled()
})
it('keeps invoices without a case nonnavigable and finalized deletion disabled', () => {
  const view = render(<BillingTable invoices={[invoice]} />)
  expect(screen.queryByRole('link', { name: /Open invoice/ })).toBeNull()
  fireEvent.click(screen.getByText('Medical Invoice').closest('tr')!); expect(push).not.toHaveBeenCalled()
  view.rerender(<BillingTable invoices={[{ ...invoice, status: 'finalized' }]} caseId="case" />)
  expect((screen.getByRole('button', { name: 'Delete invoice' }) as HTMLButtonElement).disabled).toBe(true)
})
