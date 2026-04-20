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
  age: null,
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

  it('calls callClaudeTool with Opus 4.7 and the initial visit tool', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateInitialVisitFromData(emptyInput, 'initial_visit')
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.model).toBe('claude-opus-4-7')
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

describe('NUMERIC-ANCHOR for pain evaluation visit', () => {
  beforeEach(() => vi.clearAllMocks())

  async function capturePrompt(input: InitialVisitInputData): Promise<string> {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateInitialVisitFromData(input, 'pain_evaluation_visit')
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    return opts.system as string
  }

  it('system prompt contains NUMERIC-ANCHOR clause referencing priorVisitData.vitalSigns', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('NUMERIC-ANCHOR (MANDATORY when priorVisitData.vitalSigns.pain_score_max is non-null)')
    expect(system).toContain('Pain has [decreased / remained similar / increased]')
    expect(system).toContain('priorVisitData.vitalSigns supplies the prior endpoint only')
  })

  it('NUMERIC-ANCHOR falls back to qualitative when vitalSigns is null', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('When priorVisitData.vitalSigns is null or pain_score_max is null, do NOT invent a numeric prior pain value')
    expect(system).toContain('qualitative comparative language tied to priorVisitData.chief_complaint narrative')
  })

  it('threads priorVisitData.vitalSigns into user payload when present', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateInitialVisitFromData(
      {
        ...emptyInput,
        priorVisitData: {
          chief_complaint: 'neck pain',
          physical_exam: null,
          imaging_findings: null,
          medical_necessity: null,
          diagnoses: null,
          treatment_plan: null,
          prognosis: null,
          provider_intake: null,
          rom_data: null,
          visit_date: '2026-03-01',
          finalized_at: '2026-03-01T12:00:00Z',
          vitalSigns: { recorded_at: '2026-03-01T10:00:00Z', pain_score_min: 7, pain_score_max: 8 },
        },
      },
      'pain_evaluation_visit',
    )
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    const payload = opts.messages[0].content as string
    expect(payload).toContain('"vitalSigns"')
    expect(payload).toContain('"pain_score_max": 8')
    expect(payload).toContain('"pain_score_min": 7')
  })
})
