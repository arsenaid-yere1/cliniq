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
  painTrendSignals: { vsBaseline: 'baseline', vsPrevious: null },
  seriesVolatility: 'insufficient_data',
  painTrajectoryText: null,
  dischargeVisitPainDisplay: null,
  dischargeVisitPainEstimated: false,
  baselinePainDisplay: null,
  dischargePainEstimateMin: null,
  dischargePainEstimateMax: null,
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

describe('tone hint', () => {
  beforeEach(() => vi.clearAllMocks())

  it('includes toneHint in user message when provided', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateDischargeNoteFromData(emptyInput, 'keep prognosis guarded')
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.messages[0].content).toContain('ADDITIONAL TONE/DIRECTION GUIDANCE FROM THE PROVIDER:')
    expect(opts.messages[0].content).toContain('keep prognosis guarded')
  })

  it('omits toneHint when whitespace-only', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateDischargeNoteFromData(emptyInput, '   ')
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.messages[0].content).not.toContain('ADDITIONAL TONE/DIRECTION')
  })

  it('omits toneHint when null or undefined', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateDischargeNoteFromData(emptyInput, null)
    await generateDischargeNoteFromData(emptyInput)
    const callA = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    const callB = (callClaudeTool as unknown as Mock).mock.calls[1][0]
    expect(callA.messages[0].content).not.toContain('ADDITIONAL TONE/DIRECTION')
    expect(callB.messages[0].content).not.toContain('ADDITIONAL TONE/DIRECTION')
  })

  it('includes toneHint in section regeneration user message', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: { content: 'x' }, rawResponse: {} })
    await regenerateDischargeNoteSection(emptyInput, 'subjective', 'prior', 'emphasize incomplete recovery')
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.messages[0].content).toContain('emphasize incomplete recovery')
  })
})

describe('cross-section awareness', () => {
  beforeEach(() => vi.clearAllMocks())

  it('includes other-sections block when provided', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: { content: 'x' }, rawResponse: {} })
    await regenerateDischargeNoteSection(emptyInput, 'subjective', 'current', null, {
      assessment: 'existing assessment text',
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
    await regenerateDischargeNoteSection(emptyInput, 'subjective', 'current', null, {
      subjective: 'SHOULD NOT APPEAR',
      prognosis: 'existing prognosis',
    })
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.messages[0].content).not.toContain('SHOULD NOT APPEAR')
    expect(opts.messages[0].content).toContain('existing prognosis')
  })

  it('omits the other-sections block when all other sections are empty', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: { content: 'x' }, rawResponse: {} })
    await regenerateDischargeNoteSection(emptyInput, 'subjective', 'current', null, {
      assessment: '',
      prognosis: '   ',
    })
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.messages[0].content).not.toContain('OTHER SECTIONS CURRENTLY PRESENT')
    expect(opts.system).not.toContain('Avoid duplicating content that already appears')
  })
})

describe('PAIN TONE MATRIX — final-interval signal', () => {
  beforeEach(() => vi.clearAllMocks())

  async function capturePrompt(input: DischargeNoteInputData): Promise<string> {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateDischargeNoteFromData(input)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    return opts.system as string
  }

  it('system prompt includes PAIN TONE MATRIX block referencing both signals', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('PAIN TONE MATRIX — FINAL-INTERVAL SIGNAL')
    expect(system).toContain('painTrendSignals.vsBaseline')
    expect(system).toContain('painTrendSignals.vsPrevious')
  })

  it('matrix covers the mixed improved-baseline + worsened-previous row', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('MIXED — MANDATORY acknowledgement')
    expect(system).toContain('modest uptick between the penultimate and final injections')
  })

  it('matrix forbids "further improvement" phrasing when vsPrevious is worsened', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('FORBIDDEN when vsPrevious is "worsened"')
    expect(system).toContain('Progressive reduction through the final injection')
  })

  it('matrix preserves -2 default rule even when vsPrevious signals regression', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('matrix does NOT override the -2 default rule')
  })

  it('painTrendSignals is threaded into user payload', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateDischargeNoteFromData({
      ...emptyInput,
      overallPainTrend: 'improved',
      painTrendSignals: { vsBaseline: 'improved', vsPrevious: 'worsened' },
    })
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    const payload = opts.messages[0].content as string
    expect(payload).toContain('"painTrendSignals"')
    expect(payload).toContain('"vsBaseline": "improved"')
    expect(payload).toContain('"vsPrevious": "worsened"')
    expect(payload).toContain('"overallPainTrend": "improved"')
  })

  it('painTrendSignals.vsPrevious is null when only one procedure exists', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateDischargeNoteFromData({
      ...emptyInput,
      painTrendSignals: { vsBaseline: 'baseline', vsPrevious: null },
    })
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    const payload = opts.messages[0].content as string
    expect(payload).toContain('"vsPrevious": null')
  })
})

describe('BASELINE DATA-GAP OVERRIDE', () => {
  beforeEach(() => vi.clearAllMocks())

  async function capturePrompt(input: DischargeNoteInputData): Promise<string> {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateDischargeNoteFromData(input)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    return opts.system as string
  }

  it('system prompt contains BASELINE DATA-GAP OVERRIDE block', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('BASELINE DATA-GAP OVERRIDE (MANDATORY)')
  })

  it('override forbids fabricating baseline numbers and cites qualitative anchors', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('baseline→discharge numeric delta CANNOT be cited')
    expect(system).toContain('Do NOT fabricate a baseline number')
    expect(system).toContain('initialVisitBaseline.chief_complaint')
    expect(system).toContain('caseSummary')
    expect(system).toContain('ptExtraction.outcome_measures')
  })

  it('override preserves -2 default rule independent of missing baseline', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('-2 default rule for discharge-visit pain')
    expect(system).toContain('UNCHANGED by this override')
  })

  it('override covers vsPrevious missing-vitals separately', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('painTrendSignals.vsPrevious == "missing_vitals"')
    expect(system).toContain('penultimate-to-final interval CANNOT be characterized')
  })

  it('threads missing_vitals label through user payload', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateDischargeNoteFromData({
      ...emptyInput,
      painTrendSignals: { vsBaseline: 'missing_vitals', vsPrevious: 'missing_vitals' },
    })
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    const payload = opts.messages[0].content as string
    expect(payload).toContain('"vsBaseline": "missing_vitals"')
    expect(payload).toContain('"vsPrevious": "missing_vitals"')
  })
})

describe('DIAGNOSTIC-SUPPORT RULE (discharge diagnoses)', () => {
  beforeEach(() => vi.clearAllMocks())

  async function capturePrompt(input: DischargeNoteInputData): Promise<string> {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateDischargeNoteFromData(input)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    return opts.system as string
  }

  it('discharge prompt contains DIAGNOSTIC-SUPPORT RULE with all filters (A–G)', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('DIAGNOSTIC-SUPPORT RULE (MANDATORY)')
    expect(system).toContain('External-cause codes — ABSOLUTE OMISSION')
    expect(system).toMatch(/Myelopathy (and cord-compromise )?codes/)
    expect(system).toContain('Radiculopathy codes (M54.12, M54.17, M50.1X, M51.1X) — require REGION-MATCHED objective findings')
    expect(system).toContain('"Initial encounter" sprain codes')
    expect(system).toContain('M79.1 Myalgia — redundancy guard')
    expect(system).toContain('M54.5 specificity — NEVER emit the parent M54.5 at discharge')
    expect(system).toContain('Symptom-resolution at discharge')
  })

  it('discharge myelopathy filter covers M48.0X neurogenic-claudication stenosis', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('M48.0X')
    expect(system).toContain('neurogenic-claudication')
    expect(system).toContain('replace M48.0X with the matching non-myelopathy disc-degeneration code')
  })

  it('discharge radiculopathy filter excludes MRI-only / subjective-only support', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('Imaging signal alone does NOT qualify')
    expect(system).toContain('subjective radiation alone does NOT qualify')
  })

  it('discharge radiculopathy downgrade table present', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('M54.12/M50.1X → M50.20 + keep M54.2')
    expect(system).toContain('M54.17/M51.17 → M51.37')
    expect(system).toContain('M51.16 → M51.36')
  })

  it('discharge A-suffix rule prefers D/S over A', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('Do NOT emit "A"-suffix codes at discharge')
  })

  it('discharge reference line uses M50.20 + M54.50, not M54.5', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('M54.50 – Low back pain, unspecified')
    expect(system).toContain('M50.20 – Other cervical disc displacement')
  })
})

describe('FINAL-INTERVAL REGRESSION OVERRIDE + SERIES VOLATILITY', () => {
  beforeEach(() => vi.clearAllMocks())

  async function capturePrompt(input: DischargeNoteInputData): Promise<string> {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateDischargeNoteFromData(input)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    return opts.system as string
  }

  it('PAIN TRAJECTORY contains FINAL-INTERVAL REGRESSION OVERRIDE with -2 suppression', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('FINAL-INTERVAL REGRESSION OVERRIDE (MANDATORY)')
    expect(system).toContain('painTrendSignals.vsPrevious = "worsened" AND dischargeVitals is null')
    expect(system).toContain('-2 default rule is SUPPRESSED')
    expect(system).toContain('held at the final-injection level')
  })

  it('FINAL-INTERVAL REGRESSION OVERRIDE defers to dischargeVitals when provider-entered', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('This override does NOT apply when dischargeVitals is non-null')
  })

  it('system prompt contains SERIES VOLATILITY block with all five labels', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('=== SERIES VOLATILITY (MANDATORY) ===')
    expect(system).toContain('"monotone_improved"')
    expect(system).toContain('"monotone_stable"')
    expect(system).toContain('"monotone_worsened"')
    expect(system).toContain('"mixed_with_regression"')
    expect(system).toContain('"insufficient_data"')
  })

  it('SERIES VOLATILITY forbids monotone framing when mixed_with_regression', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('Do NOT assert monotone improvement')
    expect(system).toContain('sustained progressive improvement')
    expect(system).toContain('interval fluctuation between the Nth and Mth procedures')
  })

  it('SERIES VOLATILITY preserves existing -2 and data-gap overrides', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('does NOT override the -2 default rule, the FINAL-INTERVAL REGRESSION OVERRIDE, or the BASELINE DATA-GAP OVERRIDE')
  })

  it('threads seriesVolatility into user payload', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateDischargeNoteFromData({ ...emptyInput, seriesVolatility: 'mixed_with_regression' })
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    const payload = opts.messages[0].content as string
    expect(payload).toContain('"seriesVolatility": "mixed_with_regression"')
  })

  it('threads seriesVolatility = insufficient_data by default', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateDischargeNoteFromData(emptyInput)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    const payload = opts.messages[0].content as string
    expect(payload).toContain('"seriesVolatility": "insufficient_data"')
  })
})
