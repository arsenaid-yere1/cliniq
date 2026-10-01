// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
const { lien, consent } = vi.hoisted(() => ({ lien: vi.fn(), consent: vi.fn() }))
vi.mock('@/actions/lien', () => ({ generateLienAgreement: lien }))
vi.mock('@/actions/procedure-consents', () => ({ generateProcedureConsent: consent }))
vi.mock('@/components/clinical/clinical-reset-dialog', () => ({ ClinicalResetDialog: () => <button>Reset clinical data</button> }))
vi.mock('../status-change-dropdown', () => ({ StatusChangeDropdown: () => <button>Change status</button> }))
vi.mock('../case-overview-edit-dialog', () => ({ CaseOverviewEditDialog: () => null }))
import { CaseOverview } from '../case-overview'
const base = { id: 'case', case_number: 'C-1', case_status: 'active', attorney_id: null, patient: { id: 'patient', first_name: 'Synthetic', last_name: 'Example', date_of_birth: '1980-01-01' } } as ComponentProps<typeof CaseOverview>['caseData']
afterEach(cleanup)
it.each(['active', 'closed'])('keeps truthful record navigation available for %s cases', status => {
  render(<CaseOverview caseData={{ ...base, case_status: status }} />)
  for (const [label, path] of [['Visits', 'visits'], ['Documents', 'documents'], ['Clinical Data', 'clinical'], ['Procedures', 'procedures'], ['Billing', 'billing']]) {
    expect(within(screen.getByRole('region', { name: 'Clinical work and records' })).getByRole('link', { name: `Open ${label}` }).getAttribute('href')).toBe(`/patients/case/${path}`)
  }
  expect(screen.getByRole('link', { name: 'New Case for This Patient' }).getAttribute('href')).toBe('/patients/new?patientId=patient')
  expect(lien).not.toHaveBeenCalled(); expect(consent).not.toHaveBeenCalled()
  expect(screen.getByText('Assign an attorney before generating a lien agreement.')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Generate Lien Agreement' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Generate Procedure Consent Form' }) as HTMLButtonElement).disabled).toBe(status === 'closed')
  expect((screen.getByRole('button', { name: 'Edit' }) as HTMLButtonElement).disabled).toBe(status === 'closed')
  expect(screen.queryByRole('button', { name: 'Reset clinical data' })).toBeNull()
})
it('retains admin-only reset and status controls in case administration', () => {
  render(<CaseOverview caseData={base} isAdmin />)
  const region = within(screen.getByRole('region', { name: 'Case administration' }))
  expect(region.getByRole('button', { name: 'Reset clinical data' })).toBeTruthy(); expect(region.getByRole('button', { name: 'Change status' })).toBeTruthy()
})
