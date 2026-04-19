import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

vi.mock('@/lib/claude/client', () => ({
  callClaudeTool: vi.fn(),
}))

import {
  generateDischargeNoteFromData,
  regenerateDischargeNoteSection,
  type DischargeNoteInputData,
} from '@/lib/claude/generate-discharge-note'
import { callClaudeTool } from '@/lib/claude/client'

const emptyInput: DischargeNoteInputData = {
  patientInfo: { first_name: 'A', last_name: 'B', date_of_birth: null, gender: null },
  age: null,
  caseDetails: { case_number: 'C1', accident_date: null, accident_type: null },
  visitDate: '2026-04-16',
  procedures: [],
  latestVitals: null,
  dischargeVitals: null,
  baselinePain: null,
  initialVisitBaseline: null,
  overallPainTrend: 'baseline',
  caseSummary: null,
  initialVisitNote: null,
  ptExtraction: null,
  pmExtraction: null,
  mriExtractions: [],
  chiroExtraction: null,
  clinicInfo: {
    clinic_name: null, address_line1: null, address_line2: null, city: null,
    state: null, zip_code: null, phone: null, fax: null,
  },
  providerInfo: { display_name: null, credentials: null, npi_number: null },
}

describe('generateDischargeNoteFromData', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls callClaudeTool with Opus 4.7 and the discharge tool', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateDischargeNoteFromData(emptyInput)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.model).toBe('claude-opus-4-7')
    expect(opts.toolName).toBe('generate_discharge_note')
    expect(opts.maxTokens).toBe(16384)
  })
})

describe('regenerateDischargeNoteSection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('wires currentContent into the user message', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: { content: 'regen' }, rawResponse: {} })
    await regenerateDischargeNoteSection(emptyInput, 'subjective', 'OLD_CONTENT')
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.toolName).toBe('regenerate_section')
    expect(opts.messages[0].content).toContain('OLD_CONTENT')
  })

  it('returns the regenerated content', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: { content: 'fresh text' }, rawResponse: {} })
    const result = await regenerateDischargeNoteSection(emptyInput, 'subjective', 'old')
    expect(result.data).toBe('fresh text')
  })
})
