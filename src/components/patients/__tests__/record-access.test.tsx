// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
const { push, navigate } = vi.hoisted(() => ({ push: vi.fn(), navigate: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('next/link', () => ({ default: ({ href, ...props }: ComponentProps<'a'>) => <a {...props} href={href} onClick={event => { event.preventDefault(); navigate(href) }} /> }))
vi.mock('@/actions/patients', () => ({ deletePatient: vi.fn() }))
vi.mock('../patient-edit-dialog', () => ({ PatientEditDialog: () => null }))
import { PatientListTable } from '../patient-list-table'
import { PeopleListPageClient } from '../people-list-page-client'
import { PatientDetail } from '../patient-detail'
const caseRow = { id: 'case', case_number: 'C-100', case_status: 'active', accident_date: null, created_at: '2026-09-01', discharge_visit_date: null, patient: null, accident_type: null, total_billed: 0, total_paid: 0, balance_due: 0 }
const patient = { id: 'person', first_name: 'Alex', last_name: 'Example', middle_name: null, date_of_birth: '1980-01-01', gender: null, phone_primary: '555-1234', email: null, address_line1: null, address_line2: null, city: null, state: null, zip_code: null, case_count: 1, active_case_count: 1, pending_imaging_case_count: 0, balance_total: 0, last_activity: null, last_accident_date: null }
const fixtures = [
  { name: 'case list', label: 'C-100', href: '/patients/case', view: () => <PatientListTable cases={[caseRow]} totalCaseCount={1} globalFilter="" onGlobalFilterChange={vi.fn()} onClearFilters={vi.fn()} /> },
  { name: 'people list', label: 'Example, Alex', href: '/people/person', view: () => <PeopleListPageClient patients={[patient]} /> },
  { name: 'patient cases', label: 'C-100', href: '/patients/case', view: () => <PatientDetail patient={patient} cases={[caseRow]} /> },
]
beforeEach(() => { push.mockReset(); navigate.mockReset() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })
it.each(fixtures)('$name has a keyboard reachable native link without double navigation', async ({ view, label, href }) => {
  const user = userEvent.setup(); render(view())
  const link = screen.getByRole('link', { name: label })
  expect(link.getAttribute('href')).toBe(href)
  for (let i = 0; i < 12 && document.activeElement !== link; i++) await user.tab()
  expect(document.activeElement).toBe(link)
  await user.keyboard('{Enter}')
  expect(navigate).toHaveBeenCalledExactlyOnceWith(href)
  expect(push).not.toHaveBeenCalled()
  expect(link.closest('tr')?.getAttribute('role')).toBeNull()
  fireEvent.click(link.closest('tr')!)
  expect(push).toHaveBeenCalledExactlyOnceWith(href)
})
it.each(fixtures)('$name ignores modified clicks, selected text and interactive descendants', ({ view, label }) => {
  render(view()); const row = screen.getByRole('link', { name: label }).closest('tr')!
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) fireEvent.click(row, { [modifier]: true })
  fireEvent.click(row, { button: 1 })
  const selection = vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'Selected text' } as Selection)
  fireEvent.click(row); selection.mockRestore()
  const button = document.createElement('button'); row.querySelector('td')!.append(button); fireEvent.click(button)
  expect(push).not.toHaveBeenCalled()
})
