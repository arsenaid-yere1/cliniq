import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

vi.mock('@/lib/claude/client', () => ({
  callClaudeTool: vi.fn(),
}))

import { extractPainManagementFromPdf } from '@/lib/claude/extract-pain-management'
import { callClaudeTool } from '@/lib/claude/client'

describe('extractPainManagementFromPdf', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls callClaudeTool with the pain-management tool schema and Sonnet 4.6', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await extractPainManagementFromPdf('base64-pdf')
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.model).toBe('claude-sonnet-4-6')
    expect(opts.toolName).toBe('extract_pain_management_data')
    expect(opts.maxTokens).toBe(16384)
    expect(opts.messages[0].content).toContainEqual(expect.objectContaining({
      type: 'document',
      source: expect.objectContaining({ data: 'base64-pdf' }),
    }))
  })

  it('propagates errors from the helper', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ error: 'boom' })
    const result = await extractPainManagementFromPdf('x')
    expect(result.error).toBe('boom')
  })

  it('system prompt instructs correlation tagging for diagnoses', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await extractPainManagementFromPdf('base64-pdf')
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    const system: string = opts.system
    expect(system).toContain('imaging_support')
    expect(system).toContain('exam_support')
    expect(system).toContain('source_quote')
    expect(system).toContain('upper-motor-neuron sign')
    expect(system).toContain('positive Spurling')
    expect(system).toContain('SLR reproducing leg radiation')
    expect(system).toContain('verbatim sentence')
  })

  it('tool schema exposes support tag enums on diagnoses', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await extractPainManagementFromPdf('base64-pdf')
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    const dxSchema = opts.tools[0].input_schema.properties.diagnoses.items
    expect(dxSchema.properties.imaging_support.enum).toEqual(['confirmed', 'referenced', 'none'])
    expect(dxSchema.properties.exam_support.enum).toEqual(['objective', 'subjective_only', 'none'])
    expect(dxSchema.properties.source_quote).toBeDefined()
    expect(dxSchema.required).toEqual(
      expect.arrayContaining(['icd10_code', 'description', 'imaging_support', 'exam_support', 'source_quote']),
    )
  })

  describe('parse() normalizer', () => {
    async function getParse(): Promise<(raw: Record<string, unknown>) => { success: boolean; data?: unknown; error?: unknown }> {
      ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
      await extractPainManagementFromPdf('base64-pdf')
      const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
      return opts.parse
    }

    function baseRaw(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        report_date: '2025-11-18',
        date_of_injury: '2025-09-08',
        examining_provider: 'Dr. Ghomri',
        chief_complaints: [],
        physical_exam: [],
        diagnoses: [],
        treatment_plan: [],
        diagnostic_studies_summary: 'null',
        confidence: 'high',
        extraction_notes: 'null',
        ...overrides,
      }
    }

    it('coerces null pain to false in ROM rows (shoulder R-column empty)', async () => {
      const parse = await getParse()
      const result = parse(baseRaw({
        physical_exam: [{
          region: 'Left shoulder',
          palpation_findings: 'null',
          neurological_summary: 'null',
          range_of_motion: [
            { movement: 'Flexion', normal: 180, actual: null, pain: null },
            { movement: 'Extension', normal: 50, actual: 50, pain: true },
          ],
          orthopedic_tests: [],
        }],
      }))
      expect(result.success).toBe(true)
      const data = result.data as { physical_exam: Array<{ range_of_motion: Array<{ pain: boolean; actual: number | null }> }> }
      expect(data.physical_exam[0].range_of_motion[0].pain).toBe(false)
      expect(data.physical_exam[0].range_of_motion[0].actual).toBeNull()
      expect(data.physical_exam[0].range_of_motion[1].pain).toBe(true)
    })

    it('coerces missing pain field to false', async () => {
      const parse = await getParse()
      const result = parse(baseRaw({
        physical_exam: [{
          region: 'Left shoulder',
          palpation_findings: 'null',
          neurological_summary: 'null',
          range_of_motion: [{ movement: 'Flexion', normal: 180, actual: 180 }],
          orthopedic_tests: [],
        }],
      }))
      expect(result.success).toBe(true)
      const data = result.data as { physical_exam: Array<{ range_of_motion: Array<{ pain: boolean }> }> }
      expect(data.physical_exam[0].range_of_motion[0].pain).toBe(false)
    })

    it('parses stringified numbers in ROM normal/actual', async () => {
      const parse = await getParse()
      const result = parse(baseRaw({
        physical_exam: [{
          region: 'Cervical spine',
          palpation_findings: 'null',
          neurological_summary: 'null',
          range_of_motion: [{ movement: 'Flexion', normal: '60', actual: '35', pain: true }],
          orthopedic_tests: [],
        }],
      }))
      expect(result.success).toBe(true)
      const data = result.data as { physical_exam: Array<{ range_of_motion: Array<{ normal: number; actual: number }> }> }
      expect(data.physical_exam[0].range_of_motion[0].normal).toBe(60)
      expect(data.physical_exam[0].range_of_motion[0].actual).toBe(35)
    })

    it('coerces empty-string ROM numbers to null', async () => {
      const parse = await getParse()
      const result = parse(baseRaw({
        physical_exam: [{
          region: 'Left shoulder',
          palpation_findings: 'null',
          neurological_summary: 'null',
          range_of_motion: [{ movement: 'Flexion', normal: 180, actual: '', pain: false }],
          orthopedic_tests: [],
        }],
      }))
      expect(result.success).toBe(true)
      const data = result.data as { physical_exam: Array<{ range_of_motion: Array<{ actual: number | null }> }> }
      expect(data.physical_exam[0].range_of_motion[0].actual).toBeNull()
    })

    it('drops orthopedic_tests entries with invalid result', async () => {
      const parse = await getParse()
      const result = parse(baseRaw({
        physical_exam: [{
          region: 'Cervical spine',
          palpation_findings: 'null',
          neurological_summary: 'null',
          range_of_motion: [],
          orthopedic_tests: [
            { name: 'Spurling', result: 'negative' },
            { name: 'Yergason', result: '' },
            { name: 'Neer', result: 'unknown' },
            { name: 'Cervical Extension Facet Loading', result: 'positive' },
          ],
        }],
      }))
      expect(result.success).toBe(true)
      const data = result.data as { physical_exam: Array<{ orthopedic_tests: Array<{ name: string; result: string }> }> }
      expect(data.physical_exam[0].orthopedic_tests).toEqual([
        { name: 'Spurling', result: 'negative' },
        { name: 'Cervical Extension Facet Loading', result: 'positive' },
      ])
    })
  })
})
