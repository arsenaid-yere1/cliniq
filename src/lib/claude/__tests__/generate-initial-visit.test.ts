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
  pmExtraction: null,
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

  async function captureFirstVisitPrompt(input: InitialVisitInputData): Promise<string> {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateInitialVisitFromData(input, 'initial_visit')
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    return opts.system as string
  }

  it('first-visit prompt contains DIAGNOSTIC-SUPPORT RULE (M54.5 + M79.1 + no-radiculopathy)', async () => {
    const system = await captureFirstVisitPrompt(emptyInput)
    expect(system).toContain('DIAGNOSTIC-SUPPORT RULE (MANDATORY)')
    expect(system).toContain('M54.5 specificity — NEVER emit the parent M54.5')
    expect(system).toContain('Default → M54.50 (Low back pain, unspecified)')
    expect(system).toContain('M79.1 Myalgia — redundancy guard')
    expect(system).toContain('do NOT emit M54.12, M54.17, M50.1X, or M51.1X at the first visit')
  })

  it('first-visit lumbar catalog lists M54.50/M54.51/M54.59 not the parent M54.5', async () => {
    const system = await captureFirstVisitPrompt(emptyInput)
    expect(system).toContain('M54.50 (Low back pain, unspecified) / M54.51 (Vertebrogenic low back pain) / M54.59 (Other low back pain)')
  })

  it('first-visit reference example uses M54.50 and omits M79.1', async () => {
    const system = await captureFirstVisitPrompt(emptyInput)
    expect(system).toContain('M54.50 – Low back pain, unspecified')
    const referenceLine = system.split('\n').find((l) => l.startsWith('Reference:') && l.includes('S13.4XXA'))
    expect(referenceLine).toBeDefined()
    expect(referenceLine).not.toContain('M79.1')
  })

  it('pain-eval prompt contains DIAGNOSTIC-SUPPORT RULE with radiculopathy gate', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('DIAGNOSTIC-SUPPORT RULE (MANDATORY)')
    expect(system).toMatch(/Radiculopathy codes \(M54\.12, M54\.17, M50\.1X, M51\.1X/)
    expect(system).toContain('MRI signal of nerve-root contact alone is NOT sufficient')
    expect(system).toContain('subjective radiation alone is NOT sufficient')
    expect(system).toContain('positive Spurling maneuver')
    expect(system).toContain('SLR positive AND reproducing radicular leg symptoms')
    expect(system).toContain('A positive SLR is a LUMBAR test and does NOT support a cervical radiculopathy code')
  })

  it('pain-eval prompt includes myelopathy guard with UMN signs + M50.20 downgrade', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('Myelopathy codes (M50.00/.01/.02')
    expect(system).toContain('upper-motor-neuron signs')
    expect(system).toContain('hyperreflexia, clonus, Hoffmann sign, Babinski sign, spastic gait, bowel/bladder dysfunction')
    expect(system).toContain('replace M50.00/.01/.02 with M50.20')
  })

  it('pain-eval prompt references pmExtraction provenance tags', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('pmExtraction.diagnoses')
    expect(system).toContain('imaging_support')
    expect(system).toContain('exam_support')
    expect(system).toContain('source_quote')
  })

  it('pain-eval prompt instructs radicular-symptoms prose for downgraded radic codes', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('"radicular symptoms"')
    expect(system).toContain('"possible nerve root irritation"')
    expect(system).toContain('NEVER as "radiculopathy" or "nerve root compression"')
  })

  it('pain-eval prompt contains radiculopathy downgrade table', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('replace M54.12/M50.1X with M50.20 + keep M54.2')
    expect(system).toContain('replace M54.17/M51.17 with M51.37')
    expect(system).toContain('replace M51.16 with M51.36')
  })

  it('pain-eval prompt contains M79.1 redundancy guard', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('M79.1 Myalgia — redundancy guard')
    expect(system).toContain('OMIT M79.1 whenever a region pain/strain code already covers')
    expect(system).toContain('diffuse muscle pain beyond axial spine tenderness')
  })

  it('pain-eval prompt contains M54.5 specificity rule with subcodes', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('M54.5 specificity — NEVER emit the parent M54.5')
    expect(system).toContain('M54.50 (Low back pain, unspecified)')
    expect(system).toContain('M54.51 (Vertebrogenic low back pain)')
    expect(system).toContain('M54.59 (Other low back pain)')
  })

  it('pain-eval prompt contains suggested_diagnoses confidence handling', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('suggested_diagnoses confidence handling')
    expect(system).toContain('OMIT "low"-confidence entries unless independent imaging + exam evidence')
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
