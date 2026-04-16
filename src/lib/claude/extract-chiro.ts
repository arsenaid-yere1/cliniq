import Anthropic from '@anthropic-ai/sdk'
import { callClaudeTool } from '@/lib/claude/client'
import { chiroExtractionResultSchema, type ChiroExtractionResult } from '@/lib/validations/chiro-extraction'

const SYSTEM_PROMPT = `You are a medical data extraction assistant for a personal injury clinic.
You are extracting structured data from a chiropractor / conservative care report.

RULES:
1. Identify the report type first (initial evaluation, SOAP note, re-evaluation, or discharge summary).
2. Extract ALL diagnosis codes exactly as written, including the ICD-10 7th character.
3. Extract ALL treatment modalities mentioned, with CPT codes if present.
4. For functional outcomes, extract exact numeric values (pain scores, disability percentages). Do not estimate or calculate values not explicitly stated.
5. For the plateau/MMI statement, extract the VERBATIM wording. Attorneys review exact language — do not paraphrase.
6. For treatment dates, list every individual visit date found in this report. Flag any gaps exceeding 14 days.
7. Return null for any field that cannot be determined from the document.
8. Set confidence to "low" for poor quality scans, partial documents, or ambiguous content.
9. Add extraction_notes for anything ambiguous or noteworthy.`

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: 'extract_chiro_data',
  description: 'Extract structured data from a chiropractor / conservative care report',
  input_schema: {
    type: 'object',
    properties: {
      report_type: {
        type: 'string',
        enum: ['initial_evaluation', 'soap_note', 're_evaluation', 'discharge_summary', 'other'],
      },
      report_date: {
        type: 'string',
        description: 'ISO 8601 date (YYYY-MM-DD) or "null" if not found.',
      },
      treatment_dates: {
        type: 'object',
        properties: {
          first_visit: { type: 'string', description: 'YYYY-MM-DD or "null"' },
          last_visit: { type: 'string', description: 'YYYY-MM-DD or "null"' },
          total_visits: { type: ['number', 'null'] },
          visit_dates: { type: 'array', items: { type: 'string' } },
          treatment_gaps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                from: { type: 'string' },
                to: { type: 'string' },
                days: { type: 'number' },
              },
              required: ['from', 'to', 'days'],
            },
          },
        },
        required: ['first_visit', 'last_visit', 'total_visits', 'visit_dates', 'treatment_gaps'],
      },
      diagnoses: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            icd10_code: { type: 'string', description: 'ICD-10 code or "null"' },
            description: { type: 'string' },
            region: {
              type: 'string',
              enum: ['cervical', 'thoracic', 'lumbar', 'sacral', 'upper_extremity', 'lower_extremity', 'other', 'null'],
            },
            is_primary: { type: 'boolean' },
          },
          required: ['icd10_code', 'description', 'region', 'is_primary'],
        },
      },
      treatment_modalities: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            modality: { type: 'string' },
            cpt_code: { type: 'string', description: 'CPT code or "null"' },
            regions_treated: { type: 'array', items: { type: 'string' } },
            frequency: { type: 'string', description: 'Frequency or "null"' },
          },
          required: ['modality', 'cpt_code', 'regions_treated', 'frequency'],
        },
      },
      functional_outcomes: {
        type: 'object',
        properties: {
          pain_levels: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                date: { type: 'string', description: 'YYYY-MM-DD or "null"' },
                scale: { type: 'string' },
                score: { type: 'number' },
                max_score: { type: 'number' },
                context: { type: 'string', description: 'Context or "null"' },
              },
              required: ['date', 'scale', 'score', 'max_score', 'context'],
            },
          },
          disability_scores: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                date: { type: 'string', description: 'YYYY-MM-DD or "null"' },
                instrument: { type: 'string' },
                score: { type: 'number' },
                max_score: { type: 'number' },
                percent_disability: { type: ['number', 'null'] },
                interpretation: { type: 'string', description: 'Interpretation or "null"' },
              },
              required: ['date', 'instrument', 'score', 'max_score', 'percent_disability', 'interpretation'],
            },
          },
          progress_status: {
            type: 'string',
            enum: ['improving', 'stable', 'plateauing', 'worsening', 'null'],
          },
        },
        required: ['pain_levels', 'disability_scores', 'progress_status'],
      },
      plateau_statement: {
        type: 'object',
        properties: {
          present: { type: 'boolean' },
          mmi_reached: { type: ['boolean', 'null'] },
          date: { type: 'string', description: 'YYYY-MM-DD or "null"' },
          verbatim_statement: { type: 'string', description: 'Exact quote or "null"' },
          residual_complaints: { type: 'array', items: { type: 'string' } },
          permanent_restrictions: { type: 'array', items: { type: 'string' } },
          impairment_rating_percent: { type: ['number', 'null'] },
          future_care_recommended: { type: ['boolean', 'null'] },
        },
        required: ['present', 'mmi_reached', 'date', 'verbatim_statement', 'residual_complaints', 'permanent_restrictions', 'impairment_rating_percent', 'future_care_recommended'],
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
      'report_type', 'report_date', 'treatment_dates', 'diagnoses',
      'treatment_modalities', 'functional_outcomes', 'plateau_statement',
      'confidence', 'extraction_notes',
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

export async function extractChiroFromPdf(pdfBase64: string): Promise<{
  data?: ChiroExtractionResult
  rawResponse?: unknown
  error?: string
}> {
  return callClaudeTool<ChiroExtractionResult>({
    model: 'claude-sonnet-4-6',
    maxTokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [EXTRACTION_TOOL],
    toolName: 'extract_chiro_data',
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text', text: 'Extract the structured data from this chiropractor report now.' },
      ],
    }],
    parse: (raw) => {
      const rawTreatmentDates = raw.treatment_dates as Record<string, unknown> | undefined
      const rawFunctionalOutcomes = raw.functional_outcomes as Record<string, unknown> | undefined
      const rawPlateauStatement = raw.plateau_statement as Record<string, unknown> | undefined

      const normalized = {
        report_type: raw.report_type,
        report_date: normalizeNullString(raw.report_date),
        treatment_dates: {
          first_visit: normalizeNullString(rawTreatmentDates?.first_visit),
          last_visit: normalizeNullString(rawTreatmentDates?.last_visit),
          total_visits: rawTreatmentDates?.total_visits ?? null,
          visit_dates: Array.isArray(rawTreatmentDates?.visit_dates) ? rawTreatmentDates.visit_dates : [],
          treatment_gaps: Array.isArray(rawTreatmentDates?.treatment_gaps) ? rawTreatmentDates.treatment_gaps : [],
        },
        diagnoses: normalizeNullStringsInArray(raw.diagnoses, ['icd10_code', 'region']),
        treatment_modalities: normalizeNullStringsInArray(raw.treatment_modalities, ['cpt_code', 'frequency']),
        functional_outcomes: {
          pain_levels: normalizeNullStringsInArray(
            rawFunctionalOutcomes?.pain_levels, ['date', 'context'],
          ),
          disability_scores: normalizeNullStringsInArray(
            rawFunctionalOutcomes?.disability_scores, ['date', 'interpretation'],
          ),
          progress_status: normalizeNullString(rawFunctionalOutcomes?.progress_status),
        },
        plateau_statement: {
          present: rawPlateauStatement?.present ?? false,
          mmi_reached: rawPlateauStatement?.mmi_reached ?? null,
          date: normalizeNullString(rawPlateauStatement?.date),
          verbatim_statement: normalizeNullString(rawPlateauStatement?.verbatim_statement),
          residual_complaints: Array.isArray(rawPlateauStatement?.residual_complaints) ? rawPlateauStatement.residual_complaints : [],
          permanent_restrictions: Array.isArray(rawPlateauStatement?.permanent_restrictions) ? rawPlateauStatement.permanent_restrictions : [],
          impairment_rating_percent: rawPlateauStatement?.impairment_rating_percent ?? null,
          future_care_recommended: rawPlateauStatement?.future_care_recommended ?? null,
        },
        confidence: raw.confidence,
        extraction_notes: normalizeNullString(raw.extraction_notes),
      }

      const validated = chiroExtractionResultSchema.safeParse(normalized)
      return validated.success
        ? { success: true, data: validated.data }
        : { success: false, error: validated.error }
    },
  })
}
