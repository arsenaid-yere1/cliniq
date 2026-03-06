import Anthropic from '@anthropic-ai/sdk'
import { mriExtractionResultSchema, type MriExtractionResult } from '@/lib/validations/mri-extraction'

const anthropic = new Anthropic()

const SYSTEM_PROMPT = `You are a medical data extraction assistant for a personal injury clinic.
Extract structured information from MRI radiology reports using the provided tool.

Rules:
- Extract the body region scanned (e.g., "Lumbar Spine", "Cervical Spine")
- Extract the MRI study date if present
- Extract each disc level or anatomical finding individually -- do NOT combine
- For each finding, identify the spinal level (e.g., L4-L5) or anatomical location
- Include the radiologist's Impression section verbatim if present
- If a field cannot be determined, return null -- do NOT guess
- Set confidence to "low" if document quality is poor or report is incomplete
- Add extraction_notes for anything ambiguous or missing`

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: 'extract_mri_data',
  description: 'Extract structured data from an MRI radiology report',
  input_schema: {
    type: 'object',
    properties: {
      body_region: {
        type: 'string',
        description: "e.g. 'Lumbar Spine', 'Cervical Spine', 'Right Knee'",
      },
      mri_date: {
        type: 'string',
        description: 'ISO 8601 date (YYYY-MM-DD) or null if not found. Use the string "null" if not found.',
      },
      findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            level: { type: 'string', description: 'Spinal level (e.g., L4-L5) or anatomical location' },
            description: { type: 'string', description: 'Description of the finding' },
            severity: {
              type: 'string',
              enum: ['mild', 'moderate', 'severe', 'null'],
              description: 'Severity of the finding, or "null" if not determinable',
            },
          },
          required: ['level', 'description', 'severity'],
        },
      },
      impression_summary: {
        type: 'string',
        description: "Radiologist's impression/conclusion section verbatim, or \"null\" if not present",
      },
      confidence: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
      },
      extraction_notes: {
        type: 'string',
        description: 'Ambiguities, missing data, or quality issues. Use "null" if none.',
      },
    },
    required: ['body_region', 'mri_date', 'findings', 'impression_summary', 'confidence', 'extraction_notes'],
  },
}

function normalizeNullString(val: unknown): string | null {
  if (val === 'null' || val === null || val === undefined) return null
  return String(val)
}

export async function extractMriFromPdf(pdfBase64: string): Promise<{
  data?: MriExtractionResult
  rawResponse?: unknown
  error?: string
}> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: 'tool', name: 'extract_mri_data' },
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          },
          { type: 'text', text: 'Extract the structured data from this MRI report now.' },
        ],
      }],
    })

    const toolBlock = response.content.find((b) => b.type === 'tool_use')
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      return { error: 'No tool use response from Claude' }
    }

    const raw = toolBlock.input as Record<string, unknown>

    // Normalize "null" strings to actual nulls
    const normalized = {
      body_region: raw.body_region,
      mri_date: normalizeNullString(raw.mri_date),
      findings: Array.isArray(raw.findings)
        ? raw.findings.map((f: Record<string, unknown>) => ({
            ...f,
            severity: f.severity === 'null' ? null : f.severity,
          }))
        : [],
      impression_summary: normalizeNullString(raw.impression_summary),
      confidence: raw.confidence,
      extraction_notes: normalizeNullString(raw.extraction_notes),
    }

    const validated = mriExtractionResultSchema.safeParse(normalized)

    if (!validated.success) {
      return { error: 'Extraction output failed validation', rawResponse: raw }
    }

    return { data: validated.data, rawResponse: raw }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Claude API call failed' }
  }
}
