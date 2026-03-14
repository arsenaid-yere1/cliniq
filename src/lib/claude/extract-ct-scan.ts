import Anthropic from '@anthropic-ai/sdk'
import { ctScanExtractionResponseSchema, type CtScanExtractionResult } from '@/lib/validations/ct-scan-extraction'

const anthropic = new Anthropic()

const SYSTEM_PROMPT = `You are a medical data extraction assistant for a personal injury clinic.
Extract structured information from CT scan (CAT scan) radiology reports using the provided tool.

Rules:
- A single PDF may contain CT scan reports for MULTIPLE body regions (e.g., cervical spine CT + head CT)
- Create a SEPARATE report object for each body region found in the document
- Extract the body region scanned (e.g., "Cervical Spine", "Head", "Lumbar Spine")
- Extract the CT scan study date if present (may differ per region or be shared)
- Extract the technique description (contrast, reconstruction type, slice thickness)
- Extract the reason for study / clinical indication
- Extract each disc level or anatomical finding individually -- do NOT combine
- For each finding, identify the spinal level (e.g., C5-C6) or anatomical location
- Include the radiologist's Impression section verbatim if present (per body region)
- If a field cannot be determined, return null -- do NOT guess
- Set confidence to "low" if document quality is poor or report is incomplete
- Add extraction_notes for anything ambiguous or missing`

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: 'extract_ct_scan_data',
  description: 'Extract structured data from one or more CT scan radiology reports in a PDF',
  input_schema: {
    type: 'object',
    properties: {
      reports: {
        type: 'array',
        description: 'One report per body region found in the document. Most PDFs have 1, but multi-region PDFs will have 2+.',
        items: {
          type: 'object',
          properties: {
            body_region: { type: 'string', description: "e.g. 'Cervical Spine', 'Head', 'Lumbar Spine'" },
            scan_date: { type: 'string', description: 'ISO 8601 date (YYYY-MM-DD) or "null" if not found' },
            technique: { type: 'string', description: 'CT scan technique description (contrast, reconstruction, slice thickness) or "null"' },
            reason_for_study: { type: 'string', description: 'Clinical indication / reason for study or "null"' },
            findings: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  level: { type: 'string', description: 'Spinal level or anatomical location' },
                  description: { type: 'string', description: 'Description of the finding' },
                  severity: { type: 'string', enum: ['mild', 'moderate', 'severe', 'null'], description: 'Severity or "null" if not determinable' },
                },
                required: ['level', 'description', 'severity'],
              },
            },
            impression_summary: { type: 'string', description: "Radiologist's impression for this body region, or \"null\"" },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            extraction_notes: { type: 'string', description: 'Ambiguities or quality issues for this region. "null" if none.' },
          },
          required: ['body_region', 'scan_date', 'technique', 'reason_for_study', 'findings', 'impression_summary', 'confidence', 'extraction_notes'],
        },
      },
    },
    required: ['reports'],
  },
}

function normalizeNullString(val: unknown): string | null {
  if (val === 'null' || val === null || val === undefined) return null
  return String(val)
}

export async function extractCtScanFromPdf(pdfBase64: string): Promise<{
  data?: CtScanExtractionResult[]
  rawResponse?: unknown
  error?: string
}> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: 'tool', name: 'extract_ct_scan_data' },
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
          { type: 'text', text: 'Extract the structured data from this CT scan report now. If the document contains multiple body regions, return a separate report for each.' },
        ],
      }],
    })

    const toolBlock = response.content.find((b) => b.type === 'tool_use')
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      return { error: 'No tool use response from Claude' }
    }

    const raw = toolBlock.input as Record<string, unknown>

    // Normalize "null" strings in each report
    const rawReports = Array.isArray(raw.reports) ? raw.reports : []
    const normalizedReports = rawReports.map((r: Record<string, unknown>) => ({
      body_region: r.body_region,
      scan_date: normalizeNullString(r.scan_date),
      technique: normalizeNullString(r.technique),
      reason_for_study: normalizeNullString(r.reason_for_study),
      findings: Array.isArray(r.findings)
        ? r.findings.map((f: Record<string, unknown>) => ({ ...f, severity: f.severity === 'null' ? null : f.severity }))
        : [],
      impression_summary: normalizeNullString(r.impression_summary),
      confidence: r.confidence,
      extraction_notes: normalizeNullString(r.extraction_notes),
    }))

    const validated = ctScanExtractionResponseSchema.safeParse({ reports: normalizedReports })

    if (!validated.success) {
      return { error: 'Extraction output failed validation', rawResponse: raw }
    }

    return { data: validated.data.reports, rawResponse: raw }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Claude API call failed' }
  }
}
