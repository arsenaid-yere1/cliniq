import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

vi.mock('@/lib/claude/client', () => ({
  callClaudeTool: vi.fn(),
}))

import {
  generateProcedureNoteFromData,
  regenerateProcedureNoteSection,
  type ProcedureNoteInputData,
} from '@/lib/claude/generate-procedure-note'
import { callClaudeTool } from '@/lib/claude/client'

const emptyInput: ProcedureNoteInputData = {
  patientInfo: { first_name: 'A', last_name: 'B', date_of_birth: null, gender: null },
  caseDetails: { case_number: 'C1', accident_date: null, accident_type: null },
  procedureRecord: {
    procedure_date: '2026-04-16',
    procedure_name: 'PRP',
    procedure_number: 1,
    injection_site: null,
    laterality: null,
    diagnoses: [],
    consent_obtained: null,
    pain_rating: null,
    blood_draw_volume_ml: null,
    centrifuge_duration_min: null,
    prep_protocol: null,
    kit_lot_number: null,
    anesthetic_agent: null,
    anesthetic_dose_ml: null,
    patient_tolerance: null,
    injection_volume_ml: null,
    needle_gauge: null,
    guidance_method: null,
    target_confirmed_imaging: null,
    complications: null,
    supplies_used: null,
    compression_bandage: null,
    activity_restriction_hrs: null,
  },
  vitalSigns: null,
  priorProcedure: null,
  pmExtraction: null,
  initialVisitNote: null,
  mriExtractions: [],
  clinicInfo: {
    clinic_name: null, address_line1: null, address_line2: null, city: null,
    state: null, zip_code: null, phone: null, fax: null,
  },
  providerInfo: { display_name: null, credentials: null, npi_number: null },
}

describe('generateProcedureNoteFromData', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls callClaudeTool with Sonnet 4.6 and the procedure note tool', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData(emptyInput)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.model).toBe('claude-sonnet-4-6')
    expect(opts.toolName).toBe('generate_procedure_note')
    expect(opts.maxTokens).toBe(16384)
  })
})

describe('regenerateProcedureNoteSection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('wires currentContent and returns regenerated content', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: { content: 'fresh' }, rawResponse: {} })
    const result = await regenerateProcedureNoteSection(emptyInput, 'subjective', 'OLD')
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.messages[0].content).toContain('OLD')
    expect(result.data).toBe('fresh')
  })
})
