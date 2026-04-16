import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

vi.mock('@/lib/claude/client', () => ({
  callClaudeTool: vi.fn(),
}))

import {
  generateInitialVisitFromData,
  regenerateSection,
  type InitialVisitInputData,
} from '@/lib/claude/generate-initial-visit'
import { callClaudeTool } from '@/lib/claude/client'

const emptyInput: InitialVisitInputData = {
  patientInfo: { first_name: 'A', last_name: 'B', date_of_birth: null, gender: null },
  caseDetails: { case_number: 'C1', accident_type: null, accident_date: null, accident_description: null },
  caseSummary: {
    chief_complaint: null, imaging_findings: null, prior_treatment: null,
    symptoms_timeline: null, suggested_diagnoses: null,
  },
  clinicInfo: {
    clinic_name: null, address_line1: null, address_line2: null, city: null,
    state: null, zip_code: null, phone: null, fax: null,
  },
  providerInfo: { display_name: null, credentials: null, npi_number: null },
  vitalSigns: null,
  romData: null,
  feeEstimate: null,
  providerIntake: null,
  priorVisitData: null,
  hasApprovedDiagnosticExtractions: false,
}

describe('generateInitialVisitFromData', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls callClaudeTool with Sonnet 4.6 and the initial visit tool', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateInitialVisitFromData(emptyInput, 'initial_visit')
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.model).toBe('claude-sonnet-4-6')
    expect(opts.toolName).toBe('generate_initial_visit_note')
    expect(opts.maxTokens).toBe(16384)
  })

  it('includes toneHint in user message when provided', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateInitialVisitFromData(emptyInput, 'initial_visit', 'be concise')
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.messages[0].content).toContain('be concise')
  })
})

describe('regenerateSection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('wires currentContent and returns regenerated content', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: { content: 'fresh' }, rawResponse: {} })
    const result = await regenerateSection(emptyInput, 'initial_visit', 'introduction', 'OLD')
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.messages[0].content).toContain('OLD')
    expect(result.data).toBe('fresh')
  })
})
