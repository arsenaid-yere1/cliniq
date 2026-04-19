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
    expect(opts.model).toBe('claude-opus-4-7')
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

describe('SYSTEM_PROMPT — medico-legal editor pass (phases 1-5)', () => {
  beforeEach(() => vi.clearAllMocks())

  async function capturePrompt(input: ProcedureNoteInputData): Promise<string> {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData(input)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    return opts.system as string
  }

  // Phase 1 — anti-marketing
  it('includes the anti-marketing FORBIDDEN PHRASES block in procedure_prp_prep', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('FORBIDDEN PHRASES (MANDATORY) in procedure_prp_prep')
    expect(system).toContain('highly concentrated growth factors')
    expect(system).toContain('tissue regeneration')
  })
  it('includes the anti-marketing FORBIDDEN PHRASES block in patient_education', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('FORBIDDEN PHRASES (MANDATORY) in patient_education')
    expect(system).toContain('regenerative medicine')
  })
  it('includes the anti-absolute-claim FORBIDDEN PHRASES block in prognosis', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('FORBIDDEN PHRASES (MANDATORY) in prognosis')
    expect(system).toContain('full recovery is expected')
    expect(system).toContain('guaranteed improvement')
  })
  it('no longer contains the "highly concentrated amount of growth factors" marketing phrase in the prp_prep reference', async () => {
    const system = await capturePrompt(emptyInput)
    // The phrase may appear in the FORBIDDEN list (as the banned phrase) but
    // must NOT appear in the reference example. Verify by checking the reference
    // example substring specifically.
    expect(system).not.toContain('containing a highly concentrated amount of growth factors')
  })

  // Phase 2 — series-total
  it('includes the SERIES-TOTAL RULE in procedure_followup', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('SERIES-TOTAL RULE (MANDATORY)')
    expect(system).toContain('Session 1 of 3')
    expect(system).toContain('Session 3 of 3')
    expect(system).toContain('additional PRP treatment may be considered')
  })
  it('includes the SERIES-TOTAL RULE in patient_education', async () => {
    const system = await capturePrompt(emptyInput)
    // The rule appears twice (once per section) — the patient_education copy
    // references "3-injection series" as a forbidden phrasing.
    expect(system).toContain('SERIES-TOTAL RULE (MANDATORY) in patient_education')
    expect(system).toContain('3-injection series')
  })

  // Phase 3 — bracketed placeholders
  it.each([
    '[confirm blood draw volume]',
    '[confirm centrifuge duration]',
    '[confirm exact PRP preparation system]',
    '[confirm kit lot number]',
    '[confirm anesthetic agent]',
    '[confirm anesthetic dose in mL]',
    '[confirm guidance method]',
    '[confirm needle gauge]',
    '[confirm site-specific injectate distribution]',
  ])('includes the "%s" placeholder token in the system prompt', async (token) => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain(token)
  })
  it('includes the DATA-NULL RULE header in procedure_prp_prep, procedure_anesthesia, and procedure_injection', async () => {
    const system = await capturePrompt(emptyInput)
    const occurrences = system.match(/DATA-NULL RULE \(MANDATORY\)/g) ?? []
    expect(occurrences.length).toBeGreaterThanOrEqual(3)
  })

  // Phase 4 — diagnostic coherence
  it('includes the TARGET-COHERENCE RULE in procedure_indication with all three guidance branches', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('TARGET-COHERENCE RULE (MANDATORY)')
    expect(system).toMatch(/guidance_method = "ultrasound"[\s\S]*?periarticular/)
    expect(system).toMatch(/guidance_method = "fluoroscopy"[\s\S]*?intradiscal/)
    expect(system).toMatch(/guidance_method = "landmark"[\s\S]*?surface-landmark/)
  })
  it('replaces the disc-directed reference example in procedure_indication', async () => {
    const system = await capturePrompt(emptyInput)
    // The old reference read "promote joint healing and reduce inflammation due to
    // the 3.2 mm disc protrusion at L5-S1" — we replaced it with a
    // periarticular/facet-capsular reference.
    expect(system).not.toContain('PRP injection to promote joint healing and reduce inflammation due to the 3.2 mm disc protrusion')
    expect(system).toContain('periarticular and facet-capsular structures at L5-S1')
  })

  // Phase 5 — minor-patient consent
  it('includes the MINOR-PATIENT CONSENT BRANCH with both age conditions', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('MINOR-PATIENT CONSENT BRANCH (MANDATORY)')
    expect(system).toContain('When age is null or age >= 18')
    expect(system).toContain('When age < 18')
    expect(system).toContain('parent/legal guardian')
    expect(system).toContain('verbal assent')
  })
  it('includes both adult and minor reference examples for procedure_preparation', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('Reference (adult, age >= 18 or null)')
    expect(system).toContain('Reference (minor, age < 18)')
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
