import Anthropic from '@anthropic-ai/sdk'
import { callClaudeTool } from '@/lib/claude/client'
import { mriExtractionResponseSchema, type MriExtractionResult } from '@/lib/validations/mri-extraction'

const SYSTEM_PROMPT = `You are a medical data extraction assistant for a personal injury clinic.
Extract structured information from MRI radiology reports using the provided tool.

Rules:
- A single PDF may contain MRI reports for MULTIPLE body regions (e.g., cervical + lumbar spine)
- Create a SEPARATE report object for each body region found in the document
- Extract the body region scanned (e.g., "Lumbar Spine", "Cervical Spine")
- Extract the MRI study date if present (may differ per region or be shared)
- Extract each disc level or anatomical finding individually -- do NOT combine
- For each finding, identify the spinal level (e.g., L4-L5) or anatomical location
- Include the radiologist's Impression section verbatim if present (per body region)
- If a field cannot be determined, return null -- do NOT guess
- Set confidence to "low" if document quality is poor or report is incomplete
- Add extraction_notes for anything ambiguous or missing`

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: 'extract_mri_data',
  description: 'Extract structured data from one or more MRI radiology reports in a PDF',
  input_schema: {
    type: 'object',
    properties: {
      reports: {
        type: 'array',
        description: 'One report per body region found in the document. Most PDFs have 1, but multi-region PDFs will have 2+.',
        items: {
          type: 'object',
          properties: {
            body_region: {
              type: 'string',
              description: "e.g. 'Lumbar Spine', 'Cervical Spine', 'Right Knee'",
            },
            mri_date: {
              type: 'string',
              description: 'ISO 8601 date (YYYY-MM-DD) or "null" if not found',
            },
            findings: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  level: { type: 'string', description: 'Spinal level or anatomical location' },
                  description: { type: 'string', description: 'Description of the finding' },
                  severity: {
                    type: 'string',
                    enum: ['mild', 'moderate', 'severe', 'null'],
                    description: 'Severity or "null" if not determinable',
                  },
                },
                required: ['level', 'description', 'severity'],
              },
            },
            impression_summary: {
              type: 'string',
              description: "Radiologist's impression for this body region, or \"null\"",
            },
            confidence: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
            },
            extraction_notes: {
              type: 'string',
              description: 'Ambiguities or quality issues for this region. "null" if none.',
            },
          },
          required: ['body_region', 'mri_date', 'findings', 'impression_summary', 'confidence', 'extraction_notes'],
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

export async function extractMriFromPdf(pdfBase64: string): Promise<{
  data?: MriExtractionResult[]
  rawResponse?: unknown
  error?: string
}> {
  return callClaudeTool<MriExtractionResult[]>({
    model: 'claude-sonnet-4-6',
    maxTokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [EXTRACTION_TOOL],
    toolName: 'extract_mri_data',
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text', text: 'Extract the structured data from this MRI report now. If the document contains multiple body regions, return a separate report for each.' },
      ],
    }],
    parse: (raw) => {
      const rawReports = Array.isArray(raw.reports) ? raw.reports : []
      const normalizedReports = rawReports.map((r: Record<string, unknown>) => ({
        body_region: r.body_region,
        mri_date: normalizeNullString(r.mri_date),
        findings: Array.isArray(r.findings)
          ? r.findings.map((f: Record<string, unknown>) => ({
              ...f,
              severity: f.severity === 'null' ? null : f.severity,
            }))
          : [],
        impression_summary: normalizeNullString(r.impression_summary),
        confidence: r.confidence,
        extraction_notes: normalizeNullString(r.extraction_notes),
      }))
      const validated = mriExtractionResponseSchema.safeParse({ reports: normalizedReports })
      return validated.success
        ? { success: true, data: validated.data.reports }
        : { success: false, error: validated.error }
    },
  })
}
