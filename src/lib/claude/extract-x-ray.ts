import Anthropic from '@anthropic-ai/sdk'
import { callClaudeTool } from '@/lib/claude/client'
import { xRayExtractionResponseSchema, type XRayExtractionResult } from '@/lib/validations/x-ray-extraction'

const SYSTEM_PROMPT = `You are a medical data extraction assistant for a personal injury clinic.
Extract structured information from X-ray (plain radiograph) reports using the provided tool.

Rules:
- A single PDF may contain X-ray reports for MULTIPLE body regions. Create a SEPARATE report object for each body region found in the document.
- Extract the body region (e.g., "Cervical Spine", "Lumbar Spine", "Left Shoulder", "Right Knee").
- Laterality: extract 'left', 'right', or 'bilateral' for paired anatomy (shoulder, knee, hip, wrist, ankle, elbow, foot, hand). Use "null" for midline studies (spine regions, chest, abdomen, pelvis).
- Extract the scan date (may differ per region or be shared).
- Extract the procedure description verbatim (e.g., "X-RAY CERVICAL SPINE, TWO VIEWS").
- Parse view_count as an integer (e.g., "TWO VIEWS" -> 2, "AP and lateral" -> 2, "AP/Y views" -> 2, "three views" -> 3). Use "null" if not stated.
- Preserve views_description verbatim from the report ("AP/Y", "TWO VIEWS", "AP and lateral").
- reading_type: 'formal_radiology' when reading provider has ABR or radiology credentials ("Diplomate American Board of Radiology", "Radiologist", "M.D., Radiology"), or report originates from a dedicated imaging facility. 'in_office_alignment' when the ordering physician reads their own films (look for disclaimers like "not a complete radiological evaluation" or "for purposes of overall alignment and anatomy"). Use "null" if ambiguous.
- ordering_provider: physician who referred the study (often labeled PHYSICIAN or ORDERING PROVIDER). reading_provider: physician who interpreted and signed the report. May be the same person on in-office reads.
- reason_for_study: extract from HISTORY, INDICATION, or similar section.
- findings: extract each anatomical finding individually - do NOT combine. Use the spinal level (e.g., "C5-C6") for spine or anatomical location (e.g., "glenohumeral joint", "acromion", "clavicle") otherwise.
- impression_summary: radiologist's Impression section verbatim if present (per body region).
- If a field cannot be determined, return "null" -- do NOT guess.
- Set confidence to "low" if document quality is poor, report is incomplete, or the read is informal (reading_type = in_office_alignment).
- Add extraction_notes for ambiguities, quality issues, or notable disclaimers (e.g., alignment-only reads).`

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: 'extract_x_ray_data',
  description: 'Extract structured data from one or more X-ray radiology reports in a PDF',
  input_schema: {
    type: 'object',
    properties: {
      reports: {
        type: 'array',
        description: 'One report per body region found in the document. Most PDFs have 1, but multi-region PDFs will have 2+.',
        items: {
          type: 'object',
          properties: {
            body_region: { type: 'string', description: "e.g. 'Cervical Spine', 'Lumbar Spine', 'Left Shoulder'" },
            laterality: { type: 'string', enum: ['left', 'right', 'bilateral', 'null'], description: "Side for paired anatomy or 'null' for midline studies" },
            scan_date: { type: 'string', description: 'ISO 8601 date (YYYY-MM-DD) or "null" if not found' },
            procedure_description: { type: 'string', description: 'Verbatim procedure description line or "null"' },
            view_count: { type: 'string', description: 'Integer view count as a string (e.g., "2"), or "null"' },
            views_description: { type: 'string', description: 'Verbatim views text ("AP/Y", "TWO VIEWS", "AP and lateral") or "null"' },
            reading_type: { type: 'string', enum: ['formal_radiology', 'in_office_alignment', 'null'] },
            ordering_provider: { type: 'string', description: 'Referring physician or "null"' },
            reading_provider: { type: 'string', description: 'Interpreting physician or "null"' },
            reason_for_study: { type: 'string', description: 'Clinical indication or HISTORY text, or "null"' },
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
            extraction_notes: { type: 'string', description: 'Ambiguities, quality issues, or notable disclaimers. "null" if none.' },
          },
          required: [
            'body_region', 'laterality', 'scan_date', 'procedure_description',
            'view_count', 'views_description', 'reading_type',
            'ordering_provider', 'reading_provider', 'reason_for_study',
            'findings', 'impression_summary', 'confidence', 'extraction_notes',
          ],
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

function normalizeNullEnum<T extends string>(val: unknown, allowed: readonly T[]): T | null {
  if (val === 'null' || val === null || val === undefined) return null
  return allowed.includes(val as T) ? (val as T) : null
}

export async function extractXRayFromPdf(pdfBase64: string): Promise<{
  data?: XRayExtractionResult[]
  rawResponse?: unknown
  error?: string
}> {
  return callClaudeTool<XRayExtractionResult[]>({
    model: 'claude-sonnet-4-6',
    maxTokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [EXTRACTION_TOOL],
    toolName: 'extract_x_ray_data',
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text', text: 'Extract the structured data from this X-ray report now. If the document contains multiple body regions, return a separate report for each.' },
      ],
    }],
    parse: (raw) => {
      const rawReports = Array.isArray(raw.reports) ? raw.reports : []
      const normalizedReports = rawReports.map((r: Record<string, unknown>) => {
        const rawViewCount = normalizeNullString(r.view_count)
        const coercedViewCount = rawViewCount === null ? null : Number(rawViewCount)
        return {
          body_region: r.body_region,
          laterality: normalizeNullEnum(r.laterality, ['left', 'right', 'bilateral'] as const),
          scan_date: normalizeNullString(r.scan_date),
          procedure_description: normalizeNullString(r.procedure_description),
          view_count: coercedViewCount !== null && Number.isFinite(coercedViewCount) && coercedViewCount > 0
            ? coercedViewCount
            : null,
          views_description: normalizeNullString(r.views_description),
          reading_type: normalizeNullEnum(r.reading_type, ['formal_radiology', 'in_office_alignment'] as const),
          ordering_provider: normalizeNullString(r.ordering_provider),
          reading_provider: normalizeNullString(r.reading_provider),
          reason_for_study: normalizeNullString(r.reason_for_study),
          findings: Array.isArray(r.findings)
            ? r.findings.map((f: Record<string, unknown>) => ({ ...f, severity: f.severity === 'null' ? null : f.severity }))
            : [],
          impression_summary: normalizeNullString(r.impression_summary),
          confidence: r.confidence,
          extraction_notes: normalizeNullString(r.extraction_notes),
        }
      })
      const validated = xRayExtractionResponseSchema.safeParse({ reports: normalizedReports })
      return validated.success
        ? { success: true, data: validated.data.reports }
        : { success: false, error: validated.error }
    },
  })
}
