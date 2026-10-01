// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
import { PatientListPageClient } from '../patient-list-page-client'
const active = { id: 'case-a', case_number: 'C-A', case_status: 'active', accident_date: null, created_at: '2026-09-01', discharge_visit_date: null, attorney_id: 'attorney', patient: { id: 'person', first_name: 'Alex', last_name: 'Example' }, attorney: { id: 'attorney', first_name: 'Morgan', last_name: 'Lawyer', firm_name: 'Long Firm Name' } }
const archived = { ...active, id: 'case-b', case_number: 'C-B', case_status: 'archived' }
beforeEach(() => { sessionStorage.clear(); Element.prototype.scrollIntoView = vi.fn(); Element.prototype.hasPointerCapture = vi.fn(() => false); Element.prototype.setPointerCapture = vi.fn(); Element.prototype.releasePointerCapture = vi.fn() })
afterEach(cleanup)
it('keeps first-use guidance only for an empty original dataset', () => {
  render(<PatientListPageClient cases={[]} />)
  expect(screen.getByText('No patient cases found. Create your first case.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull()
  expect(screen.getByLabelText('Search cases')).toBeTruthy()
  expect(screen.getByLabelText('Status')).toBeTruthy()
  expect(screen.getByLabelText('Attorney')).toBeTruthy()
})
it.each([
  { search: 'unmatched', status: 'all', attorney: 'all' },
  { search: '', status: 'closed', attorney: 'all' },
  { search: '', status: 'all', attorney: 'missing' },
  { search: 'unmatched', status: 'closed', attorney: 'missing' },
])('clears unmatched persisted filters: %j', async filters => {
  sessionStorage.setItem('patient-cases-filters', JSON.stringify(filters))
  render(<PatientListPageClient cases={[active, archived]} />)
  expect(screen.getByText('No cases match your filters.')).toBeTruthy()
  fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0])
  expect(screen.getByRole('link', { name: 'C-A' })).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'C-B' })).toBeNull()
  await waitFor(() => expect(JSON.parse(sessionStorage.getItem('patient-cases-filters')!)).toEqual({ search: '', status: 'all', attorney: 'all' }))
})
it('offers View archived for an archived-only dataset under default filters', () => {
  render(<PatientListPageClient cases={[archived]} />)
  expect(screen.getByText('No non-archived cases.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'View archived' }))
  expect(screen.getByRole('link', { name: 'C-B' })).toBeTruthy()
})
it('retains legacy all and explicit archived selection semantics', async () => {
  sessionStorage.setItem('patient-cases-filters', JSON.stringify({ status: 'all' }))
  const user = userEvent.setup(); render(<PatientListPageClient cases={[active, archived]} />)
  expect(screen.getByLabelText('Status').textContent).toContain('All non-archived statuses')
  await user.click(screen.getByLabelText('Status'))
  await user.click(screen.getByRole('option', { name: 'Archived' }))
  expect(screen.getByRole('link', { name: 'C-B' })).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'C-A' })).toBeNull()
})
