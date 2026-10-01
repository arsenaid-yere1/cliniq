// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
let pathname = ''
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))
import { CaseSidebar } from '../case-sidebar'
afterEach(cleanup)
it.each(['/visits', '/visits/encounter', '/initial-visit', '/discharge'])('selects the single Visits entry on %s', route => {
  pathname = `/patients/case${route}`
  render(<CaseSidebar caseData={{ id: 'case', case_number: 'C-1', case_status: 'active', accident_date: null, patient: null }} />)
  expect(screen.getByRole('link', { name: 'Visits' }).getAttribute('aria-current')).toBe('page')
  expect(screen.queryByRole('link', { name: 'Initial Visit' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Discharge' })).toBeNull()
})

it('announces confirmed clipboard success and retains a named copy control', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  render(<CaseSidebar caseData={{ id: 'case', case_number: 'C-1', case_status: 'active', accident_date: null, patient: null }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Copy case number' }))
  expect(await screen.findByRole('button', { name: 'Copied case number' })).toBeTruthy()
  expect(screen.getByRole('status').textContent).toBe('Case number copied')
  expect(writeText).toHaveBeenCalledWith('C-1')
})
it('shows a useful clipboard error without announcing success', async () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) } })
  render(<CaseSidebar caseData={{ id: 'case', case_number: 'C-1', case_status: 'active', accident_date: null, patient: null }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Copy case number' }))
  expect(await screen.findByText('Unable to copy. Select the case number and copy it manually.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Copied case number' })).toBeNull()
})
