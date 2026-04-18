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
  age: null,
  caseDetails: { case_number: 'C1', accident_date: null, accident_type: null },
  procedureRecord: {
    procedure_date: '2026-04-16',
    procedure_name: 'PRP',
    procedure_number: 1,
    injection_site: null,
    laterality: null,
    diagnoses: [],
    consent_obtained: null,
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
  priorProcedures: [],
  paintoneLabel: 'baseline',
  chiroProgress: null,
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

describe('SYSTEM_PROMPT — objective_physical_exam branching', () => {
  beforeEach(() => vi.clearAllMocks())

  async function capturePrompt(input: ProcedureNoteInputData): Promise<string> {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData(input)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    return opts.system as string
  }

  it('includes the STARTING REFERENCE rule for pmExtraction.physical_exam', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('STARTING REFERENCE')
    expect(system).toContain('NOT as a source to paste verbatim')
  })

  it('includes the MANDATORY interval-change rule for repeat procedures', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('INTERVAL-CHANGE RULE')
    expect(system).toContain('Do NOT reproduce the baseline pmExtraction findings word-for-word')
    expect(system).toContain('stable')
    expect(system).toContain('unchanged since the prior injection')
  })

  it('includes all four paintoneLabel tone branches for the physical exam', async () => {
    const system = await capturePrompt(emptyInput)
    // Each branch must be described by name in the TONE BY paintoneLabel block.
    // Use [\s\S]*? (non-greedy, matches across newlines) instead of .*/s so the
    // source stays compatible with the project's ES2017 TypeScript target.
    expect(system).toMatch(/"baseline"[\s\S]*?first injection or no prior pain recorded/)
    expect(system).toMatch(/"improved"[\s\S]*?current pain ≥3 points lower than the first-injection baseline/)
    expect(system).toMatch(/"stable"[\s\S]*?current pain within \[baseline-2, baseline\+1\]/)
    expect(system).toMatch(/"worsened"[\s\S]*?current pain ≥2 points higher than the first-injection baseline/)
  })

  it('includes three parallel reference examples for baseline / improved / stable-or-worsened', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('Reference (paintoneLabel="baseline")')
    expect(system).toContain('Reference (paintoneLabel="improved")')
    expect(system).toContain('Reference (paintoneLabel="stable" or "worsened")')
  })

  it('includes the FORBIDDEN PHRASES list on the improved branch', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('FORBIDDEN PHRASES (MANDATORY) when paintoneLabel is "improved"')
    // Spot-check the most load-bearing bans (the ones the model was reaching
    // for in the 9→7 case that motivated this change).
    expect(system).toContain('continues to demonstrate')
    expect(system).toContain('without meaningful interval change')
    expect(system).toContain('persistent tenderness')
    expect(system).toContain('no meaningful interval improvement')
  })

  it('includes the chiroProgress secondary-signal rule with pain-data precedence', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('SECONDARY SIGNAL')
    expect(system).toContain('chiroProgress')
    expect(system).toContain('pain data takes precedence')
  })

  it('forbids fabricating specific measurements not in pmExtraction', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('DO NOT fabricate specific measurements')
  })

  it('does not add tone branching to objective_vitals (section 7)', async () => {
    const system = await capturePrompt(emptyInput)
    // Section 7's instruction should still be numeric-only: look for the exact
    // known phrasing and assert no paintoneLabel reference appears between
    // section 7's heading and section 8's heading.
    const s7Start = system.indexOf('7. objective_vitals')
    const s8Start = system.indexOf('8. objective_physical_exam')
    expect(s7Start).toBeGreaterThan(0)
    expect(s8Start).toBeGreaterThan(s7Start)
    const s7Block = system.slice(s7Start, s8Start)
    expect(s7Block).not.toContain('paintoneLabel')
    expect(s7Block).not.toContain('INTERVAL-CHANGE')
  })
})

describe('generateProcedureNoteFromData — paintoneLabel and chiroProgress threading', () => {
  beforeEach(() => vi.clearAllMocks())

  async function captureUserPayload(input: ProcedureNoteInputData): Promise<string> {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData(input)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    return opts.messages[0].content as string
  }

  it.each(['baseline', 'improved', 'stable', 'worsened'] as const)(
    'threads paintoneLabel="%s" into the user payload',
    async (label) => {
      const payload = await captureUserPayload({ ...emptyInput, paintoneLabel: label })
      expect(payload).toContain(`"paintoneLabel": "${label}"`)
    },
  )

  it.each(['improving', 'stable', 'plateauing', 'worsening'] as const)(
    'threads chiroProgress="%s" into the user payload',
    async (progress) => {
      const payload = await captureUserPayload({ ...emptyInput, chiroProgress: progress })
      expect(payload).toContain(`"chiroProgress": "${progress}"`)
    },
  )

  it('threads chiroProgress=null into the user payload as JSON null', async () => {
    const payload = await captureUserPayload({ ...emptyInput, chiroProgress: null })
    expect(payload).toContain('"chiroProgress": null')
  })
})
