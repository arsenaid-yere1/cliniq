// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
vi.mock('@/actions/mri-extractions', () => ({ listMriExtractions: async () => ({ data: [] }) }))
vi.mock('@/actions/chiro-extractions', () => ({ listChiroExtractions: async () => ({ data: [] }) }))
vi.mock('@/actions/pain-management-extractions', () => ({ listPainManagementExtractions: async () => ({ data: [] }) }))
vi.mock('@/actions/pt-extractions', () => ({ listPtExtractions: async () => ({ data: [] }) }))
vi.mock('@/actions/orthopedic-extractions', () => ({ listOrthopedicExtractions: async () => ({ data: [] }) }))
vi.mock('@/actions/ct-scan-extractions', () => ({ listCtScanExtractions: async () => ({ data: [] }) }))
vi.mock('@/actions/x-ray-extractions', () => ({ listXRayExtractions: async () => ({ data: [] }) }))
vi.mock('@/components/clinical/mri-extraction-list', () => ({ MriExtractionList: () => <p>MRI contents</p> }))
vi.mock('@/components/clinical/chiro-extraction-list', () => ({ ChiroExtractionList: () => <p>Chiro contents</p> }))
vi.mock('@/components/clinical/pm-extraction-list', () => ({ PmExtractionList: () => <p>PM contents</p> }))
vi.mock('@/components/clinical/pt-extraction-list', () => ({ PtExtractionList: () => <p>PT contents</p> }))
vi.mock('@/components/clinical/ortho-extraction-list', () => ({ OrthoExtractionList: () => <p>Ortho contents</p> }))
vi.mock('@/components/clinical/ct-scan-extraction-list', () => ({ CtScanExtractionList: () => <p>CT contents</p> }))
vi.mock('@/components/clinical/x-ray-extraction-list', () => ({ XRayExtractionList: () => <p>X-ray contents</p> }))
import ClinicalDataPage from '../page'
afterEach(cleanup)
it.each([['pt','Physical Therapy'],['x-ray','X-Ray'],['untrusted','MRI Reports']])('selects the allowlisted tab %s', async (tab, name) => {
  render(await ClinicalDataPage({ params: Promise.resolve({ caseId: 'case' }), searchParams: Promise.resolve({ tab }) }))
  expect(screen.getByRole('tab', { name }).getAttribute('aria-selected')).toBe('true')
})
