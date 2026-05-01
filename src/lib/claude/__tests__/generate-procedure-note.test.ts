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
import { nsaidHeldPreProcedureClause } from '@/lib/clinical/prp-protocol'

const emptyInput: ProcedureNoteInputData = {
  patientInfo: { first_name: 'A', last_name: 'B', date_of_birth: null, gender: null },
  age: null,
  caseDetails: { case_number: 'C1', accident_date: null, accident_type: null },
  procedureRecord: {
    procedure_date: '2026-04-16',
    procedure_name: 'PRP',
    procedure_number: 1,
    injection_site: null,
    sites: [],
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
    target_structure: null,
    complications: null,
    supplies_used: null,
    compression_bandage: null,
    activity_restriction_hrs: null,
    plan_deviation_reason: null,
  },
  vitalSigns: null,
  priorProcedures: [],
  intakePain: null,
  paintoneLabel: 'baseline',
  paintoneSignals: { vsBaseline: 'baseline', vsPrevious: null },
  seriesVolatility: 'insufficient_data',
  chiroProgress: null,
  caseSummary: null,
  pmExtraction: null,
  pmSupplementaryDiagnoses: [],
  initialVisitNote: null,
  planAlignment: { status: 'no_plan_on_file', planned: null, mismatches: [] },
  priorProcedureNotes: [],
  mriExtractions: [],
  clinicInfo: {
    clinic_name: null, address_line1: null, address_line2: null, city: null,
    state: null, zip_code: null, phone: null, fax: null,
  },
  providerInfo: { display_name: null, credentials: null, npi_number: null },
}

describe('generateProcedureNoteFromData', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls callClaudeTool with Opus 4.6 and the procedure note tool', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData(emptyInput)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.model).toBe('claude-opus-4-6')
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

describe('tone hint', () => {
  beforeEach(() => vi.clearAllMocks())

  it('includes toneHint in user message when provided', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData(emptyInput, 'use assertive language')
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.messages[0].content).toContain('ADDITIONAL TONE/DIRECTION GUIDANCE FROM THE PROVIDER:')
    expect(opts.messages[0].content).toContain('use assertive language')
  })

  it('omits toneHint when whitespace-only', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData(emptyInput, '   ')
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.messages[0].content).not.toContain('ADDITIONAL TONE/DIRECTION')
  })

  it('omits toneHint when null or undefined', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData(emptyInput, null)
    await generateProcedureNoteFromData(emptyInput)
    const callA = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    const callB = (callClaudeTool as unknown as Mock).mock.calls[1][0]
    expect(callA.messages[0].content).not.toContain('ADDITIONAL TONE/DIRECTION')
    expect(callB.messages[0].content).not.toContain('ADDITIONAL TONE/DIRECTION')
  })

  it('includes toneHint in section regeneration user message', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: { content: 'x' }, rawResponse: {} })
    await regenerateProcedureNoteSection(emptyInput, 'subjective', 'prior', 'keep tone guarded')
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.messages[0].content).toContain('keep tone guarded')
  })
})

describe('cross-section awareness', () => {
  beforeEach(() => vi.clearAllMocks())

  it('includes other-sections block when provided', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: { content: 'x' }, rawResponse: {} })
    await regenerateProcedureNoteSection(emptyInput, 'subjective', 'current', null, {
      assessment_and_plan: 'existing assessment text',
      prognosis: 'existing prognosis',
    })
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.messages[0].content).toContain('OTHER SECTIONS CURRENTLY PRESENT')
    expect(opts.messages[0].content).toContain('existing assessment text')
    expect(opts.messages[0].content).toContain('existing prognosis')
    expect(opts.system).toContain('Avoid duplicating content that already appears')
  })

  it('excludes the target section from the other-sections block', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: { content: 'x' }, rawResponse: {} })
    await regenerateProcedureNoteSection(emptyInput, 'subjective', 'current', null, {
      subjective: 'SHOULD NOT APPEAR',
      prognosis: 'existing prognosis',
    })
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.messages[0].content).not.toContain('SHOULD NOT APPEAR')
    expect(opts.messages[0].content).toContain('existing prognosis')
  })

  it('omits the other-sections block when all other sections are empty', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: { content: 'x' }, rawResponse: {} })
    await regenerateProcedureNoteSection(emptyInput, 'subjective', 'current', null, {
      assessment_and_plan: '',
      prognosis: '   ',
    })
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.messages[0].content).not.toContain('OTHER SECTIONS CURRENTLY PRESENT')
    expect(opts.system).not.toContain('Avoid duplicating content that already appears')
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

  it('includes four parallel reference examples for baseline / improved / stable / worsened', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('Reference (paintoneLabel="baseline")')
    expect(system).toContain('Reference (paintoneLabel="improved")')
    // Phase 10D split the combined "stable or worsened" reference into
    // separate examples so the "stable" branch models interval-improvement
    // wording rather than cloning the worsened exam.
    expect(system).toContain('Reference (paintoneLabel="stable")')
    expect(system).toContain('Reference (paintoneLabel="worsened")')
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
    '[confirm anesthetic agent]',
    '[confirm anesthetic dose in mL]',
    '[confirm guidance method]',
    '[confirm needle gauge]',
    '[confirm injection volume in mL]',
  ])('includes the "%s" placeholder token in the system prompt', async (token) => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain(token)
  })
  it('does NOT emit a "[confirm kit lot number]" placeholder (kit/lot must be omitted, not bracketed, when null)', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).not.toContain('[confirm kit lot number]')
  })
  it('instructs the model to omit kit/lot references entirely when kit_lot_number is null', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toMatch(/kit_lot_number null\s*→\s*omit any kit \/ lot number reference entirely/)
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

  // Phase 7 — SERIES-TOTAL RULE extended to subjective
  it('includes the SERIES-TOTAL RULE in subjective with forbidden "planned series" phrasings', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('SERIES-TOTAL RULE (MANDATORY) in subjective')
    expect(system).toContain('first PRP injection in the planned series')
    expect(system).toContain('planned three-injection series')
    // Must appear before the Reference (paintoneLabel="baseline") block so the
    // model reads the prohibition in the subjective instructions.
    const ruleIdx = system.indexOf('SERIES-TOTAL RULE (MANDATORY) in subjective')
    const refIdx = system.indexOf('Reference (paintoneLabel="baseline", first injection)')
    expect(ruleIdx).toBeGreaterThan(0)
    expect(refIdx).toBeGreaterThan(ruleIdx)
  })

  // Phase 8/9 — DIAGNOSTIC-SUPPORT RULE in assessment_and_plan
  it('includes the DIAGNOSTIC-SUPPORT RULE in assessment_and_plan with myelopathy and radiculopathy guards', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('DIAGNOSTIC-SUPPORT RULE (MANDATORY)')
    expect(system).toContain('myelopathy')
    expect(system).toContain('upper motor neuron signs')
    expect(system).toContain('radiculopathy')
    expect(system).toContain('dermatomal sensory deficit')
  })

  // Phase 9 — filter is absolute, not gated by procedureRecord.diagnoses
  it('DIAGNOSTIC-SUPPORT filter (A) absolutely omits V/W/X/Y external-cause codes — no escape hatch', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('ABSOLUTE OMISSION in procedure notes')
    expect(system).toContain('EVEN IF the code appears in procedureRecord.diagnoses or pmExtraction.diagnoses')
    // The old escape hatch phrasing must NOT be present — the Phase 9
    // tightening removes "unless they are present in procedureRecord.diagnoses"
    // from the V-code rule.
    expect(system).not.toMatch(/V-codes[\s\S]*?unless they are present in procedureRecord\.diagnoses/)
  })

  it('DIAGNOSTIC-SUPPORT filter (C) requires region-matched findings for each radiculopathy region', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('REGION-MATCHED objective findings')
    // Cervical radiculopathy branch names Spurling and upper-extremity roots
    expect(system).toMatch(/M50\.1X[\s\S]*?Spurling[\s\S]*?C5\/C6\/C7\/C8\/T1/)
    // Explicit rejection of SLR as cross-region validator
    expect(system).toContain('A positive straight-leg raise is a LUMBAR test and does NOT support a cervical radiculopathy code')
    // Lumbar radiculopathy branch requires radicular LEG symptoms, not axial low back pain
    expect(system).toMatch(/M51\.1X[\s\S]*?reproducing radicular leg symptoms/)
    expect(system).toContain('SLR reproducing "low back pain" alone does NOT qualify')
  })

  it('DIAGNOSTIC-SUPPORT rule contains the DOWNGRADE TABLE with concrete substitutions', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('DOWNGRADE TABLE (MANDATORY when filters B or C omit a code)')
    expect(system).toContain('M50.12X')
    expect(system).toContain('M50.20')
    expect(system).toContain('M51.17')
    expect(system).toContain('M51.37')
    expect(system).toContain('M51.16')
    expect(system).toContain('M51.36')
  })

  it('DIAGNOSTIC-SUPPORT rule contains a WORKED EXAMPLE that applies every filter', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('WORKED EXAMPLE')
    // Worked example explicitly names each filter letter
    expect(system).toMatch(/V43\.52XA[\s\S]*?Filter \(A\)[\s\S]*?OMIT/)
    expect(system).toMatch(/M50\.00[\s\S]*?Filter \(B\)[\s\S]*?OMIT/)
    expect(system).toMatch(/M50\.121[\s\S]*?Filter \(C\)[\s\S]*?OMIT/)
    // And shows the downgrade path explicitly
    expect(system).toContain('The V-code is GONE')
    expect(system).toContain('DOWNGRADED')
  })

  it('Filter (C) carries a PROSE-FALLBACK using "radicular symptoms" / "possible nerve root irritation"', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('PROSE-FALLBACK (MANDATORY when a radiculopathy code is filtered out and downgraded)')
    expect(system).toContain('"radicular symptoms"')
    expect(system).toContain('"possible nerve root irritation"')
    expect(system).toContain('NEVER as "radiculopathy" or "nerve root compression"')
  })

  it('assessment_summary section carries a RADICULAR-PROSE CONSTRAINT referencing downgraded codes', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('RADICULAR-PROSE CONSTRAINT (MANDATORY)')
    expect(system).toContain('downgraded to M50.20 / M51.36 / M51.37')
  })

  it('Filter (B) names M48.0X and M47.2X cord-compromise extensions', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('M48.0X')
    expect(system).toContain('neurogenic claudication')
    expect(system).toContain('M47.2X variants carrying a myelopathy qualifier')
  })

  it('Filter (E) drops G47.9 when subjective documents sleep has improved/resolved', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('"G47.9 Sleep disorder, unspecified"')
    expect(system).toContain('If subjective/ROS documents that sleep has improved or that sleep disturbance has resolved')
    expect(system).toContain('OMIT G47.9 from this visit\'s list')
  })

  it('Filter (E) drops G44.309 when ROS documents headache resolution', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('"G44.309 Post-traumatic headache"')
    expect(system).toContain('"headaches have lessened in frequency"')
    expect(system).toContain('"no headaches"')
  })

  it('Filter (E) drops M54.6 when no thoracic findings/complaint THIS visit', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('"M54.6 Pain in thoracic spine"')
    expect(system).toContain('requires thoracic pain in subjective/review_of_systems OR thoracic-region findings in objective_physical_exam THIS visit')
  })

  it('Filter (E) M79.1 redundancy guard requires diffuse muscle pain beyond axial spine tenderness', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('"M79.1 Myalgia"')
    expect(system).toContain('diffuse muscle pain beyond axial spine tenderness at THIS visit')
    expect(system).toContain('Focal paraspinal tenderness alone is already captured by M54.2/M54.5')
  })

  it('Filter (E) retains regional pain codes only when pain documented THIS visit', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('"M54.2 Cervicalgia" / "M54.5 Low back pain" / "M54.6 Pain in thoracic spine"')
    expect(system).toContain('retain only when the corresponding region still has documented pain or exam findings THIS visit')
  })

  it('Filter (E) does not fabricate resolution when residual/intermittent symptoms remain', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('Do not fabricate resolution')
    expect(system).toContain('even as "residual" or "intermittent"')
    expect(system).toContain('the code stays')
  })
})

describe('SYSTEM_PROMPT — medico-legal editor pass (phase 10)', () => {
  beforeEach(() => vi.clearAllMocks())

  async function capturePrompt(input: ProcedureNoteInputData): Promise<string> {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData(input)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    return opts.system as string
  }

  // Phase 10A — procedure_followup response-calibrated branching
  it('procedure_followup includes RESPONSE-CALIBRATED FOLLOW-UP branching on all four paintoneLabel values', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('RESPONSE-CALIBRATED FOLLOW-UP (MANDATORY when at least one prior procedure exists)')
    // Each of the four branches must be named and have distinct guidance
    expect(system).toMatch(/"baseline"[\s\S]*?first-visit reference/)
    expect(system).toMatch(/"stable"[\s\S]*?Avoid repeating "1-2 additional PRP injections/)
    expect(system).toMatch(/"improved"[\s\S]*?AVOID pre-committing to further injections/)
    expect(system).toMatch(/"worsened"[\s\S]*?shorter follow-up interval/)
  })

  it('procedure_followup includes four paintoneLabel-specific reference examples', async () => {
    const system = await capturePrompt(emptyInput)
    // Each reference is scoped to the follow-up section — find the section
    // boundaries so we don't accidentally match a physical-exam reference.
    const fuStart = system.indexOf('16. procedure_followup')
    const fuEnd = system.indexOf('17. assessment_and_plan')
    expect(fuStart).toBeGreaterThan(0)
    expect(fuEnd).toBeGreaterThan(fuStart)
    const fu = system.slice(fuStart, fuEnd)
    expect(fu).toContain('Reference (paintoneLabel="baseline")')
    expect(fu).toContain('Reference (paintoneLabel="stable")')
    expect(fu).toContain('Reference (paintoneLabel="improved")')
    expect(fu).toContain('Reference (paintoneLabel="worsened")')
  })

  // Phase 10B — NO CLONE RULE
  it('global NO CLONE RULE applies to procedure-mechanics sections when priorProcedures has entries', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('NO CLONE RULE (MANDATORY when priorProcedures has 1 or more entries)')
    expect(system).toContain('procedure_preparation, procedure_prp_prep, procedure_anesthesia, procedure_injection, procedure_post_care')
    // Explicit carve-out so template-shaped sections are not forced to vary
    expect(system).toContain('allergies, social history, past medical history, current medications')
    // The rule includes a continuity example for identical protocols
    expect(system).toContain('followed the same protocol as the prior injection')
  })

  // Phase 10C — CURRENT-VISIT SUPPORT filter
  it('DIAGNOSTIC-SUPPORT rule has a Filter (E) current-visit-support clause with specific code guards', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('(E) Current-visit support')
    // Specific per-code guards
    expect(system).toMatch(/M54\.6[\s\S]*?thoracic pain[\s\S]*?OMIT/)
    expect(system).toMatch(/G47\.9[\s\S]*?sleep[\s\S]*?OMIT/)
    expect(system).toMatch(/G44\.309[\s\S]*?headache[\s\S]*?OMIT/)
    expect(system).toMatch(/M79\.1[\s\S]*?diffuse muscle pain beyond axial spine tenderness/)
    // Anti-fabrication clause: a symptom still mentioned means the code stays
    expect(system).toContain('Do not fabricate resolution')
  })

  // Phase 10D — physical-exam stable-branch interval-change floor
  it('objective_physical_exam stable branch enforces a MINIMUM INTERVAL-CHANGE FLOOR when priors exist', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('MINIMUM INTERVAL-CHANGE FLOOR (MANDATORY for "stable" when at least one prior procedure exists)')
    expect(system).toContain('at least one interval-comparison phrase')
    expect(system).toContain('mildly reduced from the prior injection visit')
  })

  it('objective_physical_exam stable reference example uses interval-improvement wording, not pure persistence', async () => {
    const system = await capturePrompt(emptyInput)
    const stableRefStart = system.indexOf('Reference (paintoneLabel="stable")')
    const worsenedRefStart = system.indexOf('Reference (paintoneLabel="worsened")')
    expect(stableRefStart).toBeGreaterThan(0)
    expect(worsenedRefStart).toBeGreaterThan(stableRefStart)
    const stableRef = system.slice(stableRefStart, worsenedRefStart)
    // The stable reference must contain at least one interval-improvement phrase.
    expect(stableRef).toMatch(/mildly reduced|modestly reduced|slightly improved|slightly less/)
    // And must NOT contain the pure-persistence tag that the worsened branch uses.
    expect(stableRef).not.toContain('without meaningful interval change. Palpation reveals persistent tenderness')
  })
})

describe('SYSTEM_PROMPT — medico-legal editor pass (phase 11)', () => {
  beforeEach(() => vi.clearAllMocks())

  async function capturePrompt(input: ProcedureNoteInputData): Promise<string> {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData(input)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    return opts.system as string
  }

  // Phase 11A — interval-response narrative in subjective
  it('subjective includes INTERVAL-RESPONSE NARRATIVE directive with all six components when priors exist', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('INTERVAL-RESPONSE NARRATIVE (MANDATORY when priorProcedures has 1 or more entries and paintoneLabel is not "baseline")')
    // The six components (a)-(f) must all be named
    expect(system).toContain('(a) Pain-burden change')
    expect(system).toContain('(b) FUNCTIONAL-TOLERANCE')
    expect(system).toContain('(c) HEADACHE trajectory')
    expect(system).toContain('(d) SLEEP trajectory')
    expect(system).toContain('(e) POST-PROCEDURE soreness-resolution window')
    expect(system).toContain('(f) ADVERSE EVENTS')
    // Cumulative-trajectory closer for 2+ priors
    expect(system).toContain('cumulative trajectory of response to the PRP series remains favorable')
  })

  it('subjective INTERVAL-RESPONSE guards against fabricating specific activities not in the input', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('Do NOT invent specific activities that are not referenced anywhere in the input data')
  })

  // Phase 11B — pre-procedure safety checklist
  it('subjective includes PRE-PROCEDURE SAFETY CHECKLIST directive with standard boilerplate', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('PRE-PROCEDURE SAFETY CHECKLIST (MANDATORY)')
    expect(system).toContain(nsaidHeldPreProcedureClause())
    expect(system).toContain('denies fever, bleeding diathesis, recent anticoagulant use, or new neurological complaints')
    // Do NOT emit bracketed placeholders for these elements
    expect(system).toContain('Do NOT emit bracketed placeholders for these safety elements')
  })

  it('subjective reference examples all include the pre-procedure safety clearance sentence', async () => {
    const system = await capturePrompt(emptyInput)
    // Restrict the search to the subjective section so we don't pick up an
    // identical sentence somewhere else.
    const sStart = system.indexOf('1. subjective')
    const sEnd = system.indexOf('2. past_medical_history')
    expect(sStart).toBeGreaterThan(0)
    expect(sEnd).toBeGreaterThan(sStart)
    const sBlock = system.slice(sStart, sEnd)
    // Count occurrences of the safety-clearance sentence stem — once per
    // reference example (baseline, improved/1-prior, stable, worsened,
    // improved/2+-prior) = 5 occurrences.
    const clause = nsaidHeldPreProcedureClause()
    const escaped = clause.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const matches = sBlock.match(new RegExp(escaped, 'g')) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(5)
  })

  // Phase 11C — ADL-specific functional descriptors
  it('subjective interval-response lists concrete daily-activity anchors to use', async () => {
    const system = await capturePrompt(emptyInput)
    // The FUNCTIONAL-TOLERANCE clause names the kinds of activities the
    // narrative should anchor to, when the input data supports them.
    expect(system).toMatch(/school, work, sitting tolerance, driving, sports, sleep/)
  })

  // Phase 11D — post-procedure monitoring paragraph
  it('procedure_post_care includes IMMEDIATE POST-PROCEDURE MONITORING directive as a required first paragraph', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('IMMEDIATE POST-PROCEDURE MONITORING (MANDATORY — 2-3 sentences)')
    expect(system).toContain('monitored in the clinic for approximately 20 minutes')
    expect(system).toContain('brief neurological recheck of the upper and lower extremities was unchanged from baseline')
    expect(system).toContain('no active bleeding or hematoma at the injection sites')
  })

  it('procedure_post_care splits into two labeled paragraphs (monitoring + discharge instructions)', async () => {
    const system = await capturePrompt(emptyInput)
    const postStart = system.indexOf('15. procedure_post_care')
    const followupStart = system.indexOf('16. procedure_followup')
    expect(postStart).toBeGreaterThan(0)
    expect(followupStart).toBeGreaterThan(postStart)
    const postBlock = system.slice(postStart, followupStart)
    expect(postBlock).toContain('IMMEDIATE POST-PROCEDURE MONITORING')
    expect(postBlock).toContain('DISCHARGE INSTRUCTIONS')
    // Length target acknowledges the new two-paragraph shape
    expect(postBlock).toContain('(~1-2 paragraphs)')
  })
})

describe('SYSTEM_PROMPT — medico-legal editor pass (phase 12)', () => {
  beforeEach(() => vi.clearAllMocks())

  async function capturePrompt(input: ProcedureNoteInputData): Promise<string> {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData(input)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    return opts.system as string
  }

  // Phase 12A — prognosis improved-branch no longer pre-commits to series completion
  it('prognosis improved-branch uses "ongoing response" and explicitly bans "completion of the injection series"', async () => {
    const system = await capturePrompt(emptyInput)
    // New reference wording
    expect(system).toContain('Continued recovery depends on ongoing response to PRP therapy and adherence to the prescribed rehabilitation program')
    // Explicit ban on the series-completion phrasing
    expect(system).toContain('Do NOT write "completion of the injection series"')
    // And the explicit rationale ties back to SERIES-TOTAL RULE
    expect(system).toContain('chart does not store a planned series total')
  })

  it('prognosis improved-branch reference no longer contains the old "completion of the injection series" phrasing', async () => {
    const system = await capturePrompt(emptyInput)
    // Must not appear as the reference-example phrasing. It may still appear
    // inside the prohibition sentence ("Do NOT write 'completion of the injection series'"),
    // so we check for the specific prior reference sentence pattern.
    expect(system).not.toContain('Continued recovery depends on completion of the injection series and adherence')
  })

  // Phase 12B — M79.1 decisive filtering in the worked example
  it('DIAGNOSTIC-SUPPORT worked example explicitly omits M79.1 with Filter (E) and explains why', async () => {
    const system = await capturePrompt(emptyInput)
    // The worked example names M79.1 as a Filter-(E) OMIT
    expect(system).toMatch(/M79\.1[\s\S]*?Filter \(E\)[\s\S]*?OMIT/)
    // With the specific reasoning
    expect(system).toContain('already captured by M54.2 (Cervicalgia) and M54.5 (Low back pain)')
    expect(system).toContain('additive-billing')
    expect(system).toContain('Do NOT keep M79.1 just because it was on the intake diagnosis list')
  })

  it('DIAGNOSTIC-SUPPORT worked example removes M79.1 from the OUTPUT list', async () => {
    const system = await capturePrompt(emptyInput)
    // Scope the check to the OUTPUT diagnosis list of the worked example.
    // Find the "OUTPUT diagnosis list:" heading and the trailing summary sentence.
    const outStart = system.indexOf('OUTPUT diagnosis list')
    expect(outStart).toBeGreaterThan(0)
    const outEnd = system.indexOf('The V-code is GONE', outStart)
    expect(outEnd).toBeGreaterThan(outStart)
    const outBlock = system.slice(outStart, outEnd)
    expect(outBlock).not.toContain('M79.1 Myalgia')
    // Similarly, the unsupported thoracic code should be absent from the output
    expect(outBlock).not.toContain('M54.6 Pain in thoracic spine')
    // Sanity: the codes that survive the filter ARE present
    expect(outBlock).toContain('M54.2 Cervicalgia')
    expect(outBlock).toContain('M54.5 Low back pain')
  })

  it('DIAGNOSTIC-SUPPORT worked example filters M54.6 when no thoracic findings are documented this visit', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toMatch(/M54\.6[\s\S]*?Filter \(E\)[\s\S]*?OMIT this visit/)
    expect(system).toContain('Keep M54.6 only when thoracic pain is documented THIS visit')
  })

  it('DIAGNOSTIC-SUPPORT includes a counter-example for when M79.1 IS supported', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('COUNTER-EXAMPLE (when M79.1 IS supported)')
    expect(system).toContain('extending beyond the paraspinal regions')
    expect(system).toContain('The test for M79.1 is the presence of documented diffuse muscle pain, NOT the presence of M79.1 on the intake list')
  })

  it('DIAGNOSTIC-SUPPORT worked-example summary notes that the OUTPUT list is shorter than the INPUT list', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('The OUTPUT list is shorter than the INPUT list')
    expect(system).toContain('M79.1 and the unsupported thoracic code are DROPPED')
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

describe('priorProcedureNotes threading', () => {
  beforeEach(() => vi.clearAllMocks())

  it('threads empty priorProcedureNotes array into user payload', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData(emptyInput)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.messages[0].content).toContain('"priorProcedureNotes": []')
  })

  it('threads populated priorProcedureNotes entries with all five sections', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData({
      ...emptyInput,
      priorProcedureNotes: [
        {
          procedure_date: '2026-03-01',
          procedure_number: 1,
          sections: {
            subjective: 'Prior subjective text',
            assessment_summary: 'Prior assessment',
            procedure_injection: 'Prior injection narrative',
            assessment_and_plan: 'Prior plan',
            prognosis: 'Prior prognosis',
          },
        },
      ],
    })
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    const payload = opts.messages[0].content as string
    expect(payload).toContain('Prior subjective text')
    expect(payload).toContain('Prior assessment')
    expect(payload).toContain('Prior injection narrative')
    expect(payload).toContain('Prior plan')
    expect(payload).toContain('Prior prognosis')
    expect(payload).toContain('"procedure_number": 1')
  })

  it('system prompt contains PRIOR PROCEDURE NOTES CONTEXT block with continuity and scope rules', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData(emptyInput)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    const system = opts.system as string
    expect(system).toContain('PRIOR PROCEDURE NOTES CONTEXT')
    expect(system).toContain('MAINTAIN CLINICAL CONTINUITY')
    expect(system).toContain('NEVER COPY VERBATIM')
    expect(system).toContain('PRIOR NARRATIVE IS INTERPRETIVE CONTEXT ONLY')
    expect(system).toContain('EMPTY ARRAY = first in series')
    expect(system).toContain('DO NOT let prior narrative drive the procedure-mechanics sections')
  })

  it('prior-context rules yield to DIAGNOSTIC-SUPPORT RULE when codes fail current-visit filters', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData(emptyInput)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    const system = opts.system as string
    expect(system).toContain('DROP or DOWNGRADE the code per the rule — do not retain it just because the prior note had it')
  })
})

describe('PAIN TONE MATRIX — two-signal interpretation', () => {
  beforeEach(() => vi.clearAllMocks())

  async function capturePrompt(input: ProcedureNoteInputData): Promise<string> {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData(input)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    return opts.system as string
  }

  it('system prompt includes PAIN TONE MATRIX block', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('PAIN TONE MATRIX — TWO-SIGNAL INTERPRETATION')
    expect(system).toContain('paintoneSignals.vsBaseline')
    expect(system).toContain('paintoneSignals.vsPrevious')
  })

  it('matrix covers the critical improved-baseline + worsened-previous row', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toMatch(/improved[\s\S]*?worsened[\s\S]*?MIXED — MANDATORY acknowledgement/)
    expect(system).toContain('interval worsening of pain since the prior injection')
  })

  it('matrix forbids unambiguous-improvement phrasing when vsPrevious is worsened', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('FORBIDDEN when vsPrevious is "worsened"')
    expect(system).toContain('continued improvement since the prior injection')
  })

  it('matrix states vsPrevious is null on first procedure', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toMatch(/any[\s\S]*?null[\s\S]*?First procedure in the series/)
  })

  it('paintoneSignals is threaded into user payload', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData({
      ...emptyInput,
      paintoneLabel: 'improved',
      paintoneSignals: { vsBaseline: 'improved', vsPrevious: 'worsened' },
    })
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    const payload = opts.messages[0].content as string
    expect(payload).toContain('"paintoneSignals"')
    expect(payload).toContain('"vsBaseline": "improved"')
    expect(payload).toContain('"vsPrevious": "worsened"')
    // paintoneLabel alias still present for backward compatibility with existing prompt rules
    expect(payload).toContain('"paintoneLabel": "improved"')
  })

  it('paintoneSignals.vsPrevious is null on first procedure', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData({
      ...emptyInput,
      paintoneLabel: 'baseline',
      paintoneSignals: { vsBaseline: 'baseline', vsPrevious: null },
    })
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    const payload = opts.messages[0].content as string
    expect(payload).toContain('"vsPrevious": null')
  })
})

describe('MISSING-VITALS BRANCH', () => {
  beforeEach(() => vi.clearAllMocks())

  async function capturePrompt(input: ProcedureNoteInputData): Promise<string> {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData(input)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    return opts.system as string
  }

  it('system prompt contains MISSING-VITALS BRANCH block', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('MISSING-VITALS BRANCH (MANDATORY)')
    expect(system).toContain('A prior procedure is on the chart but its pain measurement is unavailable')
    expect(system).toContain('"paintoneLabel" == "missing_vitals"')
  })

  it('system prompt instructs not to fabricate numeric delta and not to describe as first-in-series', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('Do NOT cite a numeric pain delta against the affected anchor')
    expect(system).toContain('Do NOT describe the visit as "first in the series"')
    expect(system).toContain('pain measurement at the prior injection was not recorded')
  })

  it('system prompt states missing-vitals branch overrides the four-way paintoneLabel branching', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('overrides the four-way paintoneLabel branching')
    // Asymmetric missing-vitals combinations handled explicitly.
    expect(system).toContain('vsBaseline is "missing_vitals" but vsPrevious is a concrete label')
  })

  it('threads missing_vitals label through user payload', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData({
      ...emptyInput,
      paintoneLabel: 'missing_vitals',
      paintoneSignals: { vsBaseline: 'missing_vitals', vsPrevious: 'missing_vitals' },
    })
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    const payload = opts.messages[0].content as string
    expect(payload).toContain('"paintoneLabel": "missing_vitals"')
    expect(payload).toContain('"vsBaseline": "missing_vitals"')
    expect(payload).toContain('"vsPrevious": "missing_vitals"')
  })
})

describe('INTAKE ANCHOR (procedure #1 pre-treatment baseline)', () => {
  beforeEach(() => vi.clearAllMocks())

  async function capturePrompt(input: ProcedureNoteInputData): Promise<string> {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData(input)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    return opts.system as string
  }

  it('system prompt contains INTAKE ANCHOR block conditioned on priorProcedures empty and intakePain non-null', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('INTAKE ANCHOR (MANDATORY when priorProcedures is empty AND intakePain.pain_score_max is non-null)')
    expect(system).toContain('Pre-treatment pain at the initial evaluation was X/10')
  })

  it('INTAKE ANCHOR forbids describing patient as having prior injections', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('the patient has had zero prior PRP')
    expect(system).toContain('presents for his first PRP injection')
  })

  it('INTAKE ANCHOR defers to baseline branch when intakePain is null', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('When intakePain.pain_score_max is null AND priorProcedures is empty, the "baseline" branch applies as before')
  })

  it('threads intakePain into user payload when present', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData({
      ...emptyInput,
      intakePain: { recorded_at: '2026-03-01T10:00:00Z', pain_score_min: 7, pain_score_max: 8 },
    })
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    const payload = opts.messages[0].content as string
    expect(payload).toContain('"intakePain"')
    expect(payload).toContain('"pain_score_max": 8')
    expect(payload).toContain('"pain_score_min": 7')
  })

  it('threads intakePain as null when absent', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData(emptyInput)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    const payload = opts.messages[0].content as string
    expect(payload).toContain('"intakePain": null')
  })
})

describe('SERIES VOLATILITY (procedure)', () => {
  beforeEach(() => vi.clearAllMocks())

  async function capturePrompt(input: ProcedureNoteInputData): Promise<string> {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData(input)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    return opts.system as string
  }

  it('system prompt contains SERIES VOLATILITY block gated on priorProcedures ≥ 2', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('=== SERIES VOLATILITY (MANDATORY when priorProcedures has 2 or more entries) ===')
    expect(system).toContain('"monotone_improved"')
    expect(system).toContain('"mixed_with_regression"')
    expect(system).toContain('"insufficient_data"')
  })

  it('forbids linear arrow chains and monotone framing on mixed_with_regression', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('Do NOT render a linear arrow chain')
    expect(system).toContain('progressive decline in pain')
    expect(system).toContain('steady improvement')
    expect(system).toContain('fluctuated across the injection series')
  })

  it('allows arrow-chain TRAJECTORY only when monotone_improved + paintoneLabel improved', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('When seriesVolatility == "monotone_improved" AND paintoneLabel == "improved", the standard TRAJECTORY arrow-chain is permitted')
  })

  it('falls back to existing branching on insufficient_data', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('When seriesVolatility == "insufficient_data"')
    expect(system).toContain('Fall back to the existing paintoneLabel / paintoneSignals branching')
  })

  it('threads seriesVolatility into user payload', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData({ ...emptyInput, seriesVolatility: 'mixed_with_regression' })
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    const payload = opts.messages[0].content as string
    expect(payload).toContain('"seriesVolatility": "mixed_with_regression"')
  })

  it('threads seriesVolatility = insufficient_data by default', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData(emptyInput)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    const payload = opts.messages[0].content as string
    expect(payload).toContain('"seriesVolatility": "insufficient_data"')
  })
})

describe('SYSTEM_PROMPT — alternatives-discussed rule', () => {
  beforeEach(() => vi.clearAllMocks())

  async function capturePrompt(input: ProcedureNoteInputData): Promise<string> {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData(input)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    return opts.system as string
  }

  it('includes ALTERNATIVES-DISCUSSED RULE in procedure_preparation', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('ALTERNATIVES-DISCUSSED RULE')
  })

  it('names epidural steroid and facet-based interventions as alternatives', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('epidural steroid injections and facet-based interventions')
  })

  it('cites PRP as elected regenerative treatment option', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('elected PRP as a regenerative treatment option')
  })

  it('describes minor-branch guardian-elected phrasing', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain("parent/legal guardian elected PRP on the patient's behalf")
  })

  it('includes alternatives sentence in both adult and minor references', async () => {
    const system = await capturePrompt(emptyInput)
    const adultRef = system.match(/Reference \(adult, age >= 18 or null\):[\s\S]*?"(.*?)"/)
    const minorRef = system.match(/Reference \(minor, age < 18\):[\s\S]*?"(.*?)"/)
    expect(adultRef?.[1]).toContain('epidural steroid injections and facet-based interventions')
    expect(minorRef?.[1]).toContain('epidural steroid injections and facet-based interventions')
  })
})

describe('SYSTEM_PROMPT — multi-level justification rule', () => {
  beforeEach(() => vi.clearAllMocks())

  async function capturePrompt(input: ProcedureNoteInputData): Promise<string> {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData(input)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    return opts.system as string
  }

  it('includes MULTI-LEVEL JUSTIFICATION RULE in procedure_indication', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('MULTI-LEVEL JUSTIFICATION RULE')
  })

  it('requires concordance boilerplate for multi-level treatment', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('Multi-level treatment was selected due to concordant multilevel MRI findings and diffuse symptom distribution')
  })

  it('exempts single-level procedures from the justification sentence', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('Single-level procedures')
    expect(system).toContain('do NOT require this sentence')
  })

  it('provides a multi-level reference example with 2 bullets and justification sentence', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('Reference (multi-level, 2 bullets)')
    expect(system).toContain('L4-L5')
    expect(system).toContain('L5-S1')
  })
})

describe('SYSTEM_PROMPT — primary pain generator rule', () => {
  beforeEach(() => vi.clearAllMocks())

  async function capturePrompt(input: ProcedureNoteInputData): Promise<string> {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData(input)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    return opts.system as string
  }

  it('includes PRIMARY PAIN GENERATOR RULE in procedure_indication', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('PRIMARY PAIN GENERATOR RULE')
  })

  it('requires the primary-generator identification sentence', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('Primary pain generator suspected at')
    expect(system).toContain('with adjacent levels contributing')
  })

  it('provides a diffuse fallback when evidence is ambiguous', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('Pain generator distribution is diffuse across the treated levels without a clear primary level')
  })

  it('forbids fabricating a primary level when evidence is insufficient', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('Do NOT fabricate a primary level when evidence is insufficient')
  })

  it('adds PRIMARY-LEVEL CONSISTENCY clause to assessment_summary', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('PRIMARY-LEVEL CONSISTENCY')
    expect(system).toContain('Reference the same primary level in assessment_summary')
  })
})

describe('SYSTEM_PROMPT — coding framework rule', () => {
  beforeEach(() => vi.clearAllMocks())

  async function capturePrompt(input: ProcedureNoteInputData): Promise<string> {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData(input)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    return opts.system as string
  }

  it('includes CODING FRAMEWORK RULE at the top of DIAGNOSTIC-SUPPORT RULE', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('CODING FRAMEWORK RULE')
  })

  it('defines both traumatic and degenerative frameworks', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('(a) TRAUMATIC framework')
    expect(system).toContain('(b) DEGENERATIVE-WITH-SUPERIMPOSED-TRAUMA framework')
  })

  it('names traumatic-framework anchor codes M50.20 / M51.26 / M51.27', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toMatch(/\(a\) TRAUMATIC framework[\s\S]*?M50\.20[\s\S]*?M51\.26[\s\S]*?M51\.27/)
  })

  it('names degenerative-framework anchor codes M50.23 / M51.36 / M51.37', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toMatch(/\(b\) DEGENERATIVE-WITH-SUPERIMPOSED-TRAUMA framework[\s\S]*?M50\.23[\s\S]*?M51\.36[\s\S]*?M51\.37/)
  })

  it('pins disc-pathology prose to the framework (no mixing)', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('Do NOT mix frameworks within a single note')
    expect(system).toContain('traumatic disc displacement')
    expect(system).toContain('degenerative disc disease with superimposed traumatic exacerbation')
  })

  it('rewrites DOWNGRADE TABLE with both framework branches', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('Under framework (a) TRAUMATIC')
    expect(system).toContain('Under framework (b) DEGENERATIVE-WITH-SUPERIMPOSED-TRAUMA')
  })

  it('worked-example output uses framework (a) traumatic anchors M51.26 / M51.27', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('OUTPUT diagnosis list (framework (a) TRAUMATIC')
    expect(system).toContain('M51.26 Other intervertebral disc displacement, lumbar region')
    expect(system).toContain('M51.27 Other intervertebral disc displacement, lumbosacral region')
  })

  it('includes framework (b) counter-example', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('COUNTER-EXAMPLE (framework (b) selection)')
  })
})

describe('SYSTEM_PROMPT — per-site volume allocation', () => {
  beforeEach(() => vi.clearAllMocks())

  async function capturePrompt(input: ProcedureNoteInputData): Promise<string> {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData(input)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    return opts.system as string
  }

  it('emits PER-SITE VOLUME ALLOCATION RULE with FORBIDDEN PHRASES guard against per-site mL fabrication', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('PER-SITE VOLUME ALLOCATION RULE')
    expect(system).toContain('MUST NOT assert a specific per-site mL number')
    expect(system).toContain('FORBIDDEN PHRASES')
    expect(system).toContain('approximately X mL per site')
  })

  it('emits only [confirm total volume in mL] for the null-volume branch — no orphan per-site bracket', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('[confirm total volume in mL]')
    expect(system).toContain('Do NOT emit a separate per-site mL bracket')
    // Per-site bracket appears only inside FORBIDDEN PHRASES guard text, not as
    // an emitted placeholder. Reference paragraphs must not include it.
    expect(system).not.toMatch(/distributed across L4-L5 and L5-S1; \[confirm total volume in mL\] and \[confirm per-site mL allocation\]/)
  })

  it('includes a spine multi-site reference paragraph that names sites without per-site mL', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('distributed across L4-L5 and L5-S1, with allocation calibrated to the pathology burden at each level')
    expect(system).not.toMatch(/approximately 3 mL .* L4-L5/)
  })

  it('includes a non-spine multi-site reference paragraph', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('right knee and the right shoulder')
    expect(system).toContain('at each site')
  })

  it('forbids needle-redirection / multi-needle technique claims in multi-site narration', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('NEEDLE-INSERTION LANGUAGE')
    expect(system).toContain('Do NOT claim a specific number of needles')
  })

  it('preserves the existing single-site reference paragraph unchanged', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('The PRP solution (5 mL) was injected slowly into the joint to maximize distribution and tissue saturation.')
  })

  it('emits PER-SITE VOLUME — STRUCTURED INPUT branch enabling concrete per-site mL when provider entered values', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('PER-SITE VOLUME — STRUCTURED INPUT')
    expect(system).toContain('exact provider-entered mL by name')
  })

  it('STRUCTURED INPUT rule preserves null-volume fallback to qualitative wording', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('When at least one site.volume_ml is null')
    expect(system).toContain('do NOT fabricate a per-site number')
    expect(system).toContain('do NOT split the total mathematically')
  })

  it('emits PROVIDER-COMMITTED TARGET STRUCTURE rule mapping target_structure values to narrative terms', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('PROVIDER-COMMITTED TARGET STRUCTURE')
    expect(system).toContain("'periarticular' → \"periarticular\"")
    expect(system).toContain("'intradiscal' → \"intradiscal\"")
    expect(system).toContain("'sacroiliac_adjacent' → \"sacroiliac-adjacent\"")
    expect(system).toContain('do NOT second-guess it via guidance_method')
  })

  it('makes TARGET-COHERENCE RULE conditional on target_structure being null', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('TARGET-COHERENCE RULE (MANDATORY when procedureRecord.target_structure is null)')
  })

  it('emits MULTI-SITE JUSTIFICATION RULE for non-spine multi-site procedures', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('MULTI-SITE JUSTIFICATION RULE')
    expect(system).toContain('DIFFERENT NON-SPINE sites')
    expect(system).toContain('Multi-site treatment was selected based on concordant pathology at each treated site')
    expect(system).toContain('does NOT apply to spine multi-level procedures')
  })
})
