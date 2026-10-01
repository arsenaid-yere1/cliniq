// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
import { PeopleListPageClient } from '../people-list-page-client'
const patient = { id: 'p', first_name: 'Alex', last_name: 'Example', date_of_birth: '1980-01-01', phone_primary: '555-1234', case_count: 1, active_case_count: 1, pending_imaging_case_count: 0, balance_total: 0, last_activity: null, last_accident_date: null }
afterEach(cleanup)
it('distinguishes first use from search-empty and restores name/phone matches', () => {
  const view = render(<PeopleListPageClient patients={[]} />)
  expect(screen.getByText('No patients yet. Create one to get started.')).toBeTruthy()
  view.rerender(<PeopleListPageClient patients={[patient]} />)
  const search = screen.getByLabelText('Search patients')
  for (const value of ['alex', '555-1234']) {
    fireEvent.change(search, { target: { value } })
    expect(screen.getByRole('link', { name: 'Example, Alex' })).toBeTruthy()
  }
  fireEvent.change(search, { target: { value: 'missing' } })
  expect(screen.getByText('No patients match your search.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
  expect((search as HTMLInputElement).value).toBe('')
  expect(screen.getByRole('link', { name: 'Example, Alex' })).toBeTruthy()
})
