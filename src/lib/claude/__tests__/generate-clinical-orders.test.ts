import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

vi.mock('@/lib/claude/client', () => ({
  callClaudeTool: vi.fn(),
}))

import {
  generateImagingOrders,
  generateChiropracticOrder,
  type ClinicalOrderInputData,
} from '@/lib/claude/generate-clinical-orders'
import { callClaudeTool } from '@/lib/claude/client'

const emptyInput: ClinicalOrderInputData = {
  patientInfo: { first_name: 'A', last_name: 'B', date_of_birth: null, gender: null },
  diagnoses: '',
  chiefComplaint: null,
  treatmentPlan: null,
  providerInfo: { display_name: null, credentials: null, npi_number: null },
  clinicInfo: {
    clinic_name: null, address_line1: null, city: null, state: null, zip_code: null,
    phone: null, fax: null,
  },
  dateOfVisit: '2026-04-16',
}

describe('generateImagingOrders', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls callClaudeTool with Sonnet 4.6 and the imaging tool', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateImagingOrders(emptyInput)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.model).toBe('claude-sonnet-4-6')
    expect(opts.toolName).toBe('generate_imaging_orders')
    expect(opts.maxTokens).toBe(4096)
  })
})

describe('generateChiropracticOrder', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls callClaudeTool with Sonnet 4.6 and the chiro tool', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateChiropracticOrder(emptyInput)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.model).toBe('claude-sonnet-4-6')
    expect(opts.toolName).toBe('generate_chiropractic_order')
    expect(opts.maxTokens).toBe(4096)
  })
})
