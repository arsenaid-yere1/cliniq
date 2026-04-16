import Anthropic from '@anthropic-ai/sdk'
import { callClaudeTool } from '@/lib/claude/client'
import { painManagementExtractionResultSchema, type PainManagementExtractionResult } from '@/lib/validations/pain-management-extraction'

const SYSTEM_PROMPT = `You are a medical data extraction assistant for a personal injury clinic.
You are extracting structured data from a pain management evaluation report.

RULES:
1. Extract ALL chief complaints with exact pain ratings as stated (e.g., "4-6/10" → min: 4, max: 6).
2. For physical examination, extract each body region separately with palpation findings, range of motion measurements, orthopedic tests, and neurological summary.
3. Range of motion: extract the Normal, Actual, and Pain columns exactly as shown in the report tables.
4. Orthopedic tests: extract each test name and whether it was positive or negative.
5. Extract ALL diagnosis codes exactly as written, including the ICD-10 7th character.
6. For treatment plan items, extract estimated costs when stated (e.g., "$3,000-10,500" → min: 3000, max: 10500).
7. Classify treatment types: "injection" for blocks/epidurals/PRP, "therapy" for physical/chiro/IDD, "medication" for prescriptions/OTC, "continuation" for continuing existing treatment, "monitoring" for re-evaluate/follow-up, "surgery" for surgical options, "alternative" for alternative approaches.
8. For diagnostic studies, summarize referenced imaging findings — do not re-extract MRI data in detail (that's handled by MRI extraction).
9. Return null for any field that cannot be determined from the document.
10. Set confidence to "low" for poor quality scans, partial documents, or ambiguous content.
11. Add extraction_notes for anything ambiguous or noteworthy.`

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: 'extract_pain_management_data',
  description: 'Extract structured data from a pain management evaluation report',
  input_schema: {
    type: 'object',
    properties: {
      report_date: {
        type: 'string',
        description: 'ISO 8601 date (YYYY-MM-DD) or "null" if not found.',
      },
      date_of_injury: {
        type: 'string',
        description: 'ISO 8601 date (YYYY-MM-DD) or "null" if not found.',
      },
      examining_provider: {
        type: 'string',
        description: 'Name of the examining provider or "null" if not found.',
      },
      chief_complaints: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            location: { type: 'string' },
            pain_rating_min: { type: ['number', 'null'] },
            pain_rating_max: { type: ['number', 'null'] },
            radiation: { type: 'string', description: 'Radiation pattern or "null"' },
            aggravating_factors: { type: 'array', items: { type: 'string' } },
            alleviating_factors: { type: 'array', items: { type: 'string' } },
          },
          required: ['location', 'pain_rating_min', 'pain_rating_max', 'radiation', 'aggravating_factors', 'alleviating_factors'],
        },
      },
      physical_exam: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            region: { type: 'string' },
            palpation_findings: { type: 'string', description: 'Palpation findings or "null"' },
            range_of_motion: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  movement: { type: 'string' },
                  normal: { type: ['number', 'null'] },
                  actual: { type: ['number', 'null'] },
                  pain: { type: 'boolean' },
                },
                required: ['movement', 'normal', 'actual', 'pain'],
              },
            },
            orthopedic_tests: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  result: { type: 'string', enum: ['positive', 'negative'] },
                },
                required: ['name', 'result'],
              },
            },
            neurological_summary: { type: 'string', description: 'Neurological findings summary or "null"' },
          },
          required: ['region', 'palpation_findings', 'range_of_motion', 'orthopedic_tests', 'neurological_summary'],
        },
      },
      diagnoses: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            icd10_code: { type: 'string', description: 'ICD-10 code or "null"' },
            description: { type: 'string' },
          },
          required: ['icd10_code', 'description'],
        },
      },
      treatment_plan: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            type: {
              type: 'string',
              enum: ['continuation', 'injection', 'therapy', 'medication', 'surgery', 'monitoring', 'alternative', 'other'],
              description: 'Treatment type or "null"',
            },
            estimated_cost_min: { type: ['number', 'null'] },
            estimated_cost_max: { type: ['number', 'null'] },
            body_region: { type: 'string', description: 'Body region or "null"' },
          },
          required: ['description', 'type', 'estimated_cost_min', 'estimated_cost_max', 'body_region'],
        },
      },
      diagnostic_studies_summary: {
        type: 'string',
        description: 'Summary of referenced diagnostic studies/imaging or "null".',
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
    required: [
      'report_date', 'date_of_injury', 'examining_provider',
      'chief_complaints', 'physical_exam', 'diagnoses', 'treatment_plan',
      'diagnostic_studies_summary', 'confidence', 'extraction_notes',
    ],
  },
}

function normalizeNullString(val: unknown): string | null {
  if (val === 'null' || val === null || val === undefined) return null
  return String(val)
}

function normalizeNullStringsInArray<T extends Record<string, unknown>>(
  arr: unknown,
  nullableFields: string[],
): T[] {
  if (!Array.isArray(arr)) return []
  return arr.map((item: Record<string, unknown>) => {
    const normalized = { ...item }
    for (const field of nullableFields) {
      if (field in normalized) {
        normalized[field] = normalizeNullString(normalized[field])
      }
    }
    return normalized as T
  })
}

export async function extractPainManagementFromPdf(pdfBase64: string): Promise<{
  data?: PainManagementExtractionResult
  rawResponse?: unknown
  error?: string
}> {
  return callClaudeTool<PainManagementExtractionResult>({
    model: 'claude-sonnet-4-6',
    maxTokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [EXTRACTION_TOOL],
    toolName: 'extract_pain_management_data',
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text', text: 'Extract the structured data from this pain management evaluation report now.' },
      ],
    }],
    parse: (raw) => {
      const normalized = {
        report_date: normalizeNullString(raw.report_date),
        date_of_injury: normalizeNullString(raw.date_of_injury),
        examining_provider: normalizeNullString(raw.examining_provider),
        chief_complaints: normalizeNullStringsInArray(raw.chief_complaints, ['radiation']),
        physical_exam: (Array.isArray(raw.physical_exam) ? raw.physical_exam : []).map(
          (region: Record<string, unknown>) => ({
            ...region,
            palpation_findings: normalizeNullString(region.palpation_findings),
            neurological_summary: normalizeNullString(region.neurological_summary),
            range_of_motion: Array.isArray(region.range_of_motion) ? region.range_of_motion : [],
            orthopedic_tests: Array.isArray(region.orthopedic_tests) ? region.orthopedic_tests : [],
          }),
        ),
        diagnoses: normalizeNullStringsInArray(raw.diagnoses, ['icd10_code']),
        treatment_plan: normalizeNullStringsInArray(raw.treatment_plan, ['type', 'body_region']),
        diagnostic_studies_summary: normalizeNullString(raw.diagnostic_studies_summary),
        confidence: raw.confidence,
        extraction_notes: normalizeNullString(raw.extraction_notes),
      }

      const validated = painManagementExtractionResultSchema.safeParse(normalized)
      return validated.success
        ? { success: true, data: validated.data }
        : { success: false, error: validated.error }
    },
  })
}
