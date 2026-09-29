// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
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
