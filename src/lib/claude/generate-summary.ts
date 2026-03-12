import Anthropic from '@anthropic-ai/sdk'
import { caseSummaryResultSchema, type CaseSummaryResult } from '@/lib/validations/case-summary'

const anthropic = new Anthropic()

const SYSTEM_PROMPT = `You are a clinical data analyst specializing in personal injury cases. Your task is to synthesize clinical data from multiple sources into a comprehensive case summary.

Rules:
1. Synthesize information from all provided sources — do not simply copy/paste
2. For chief complaint, combine accident details with presenting symptoms into a clear narrative
3. For imaging findings, group by body region and highlight clinically significant findings
4. For prior treatment, summarize the treatment course including modalities, frequency, and any gaps
5. For symptoms timeline, create a chronological progression from onset to current status
6. For suggested diagnoses, provide ICD-10 codes when available and rate confidence based on supporting evidence strength
7. Use "null" for any field where data is insufficient to make a determination
8. Set confidence to "low" if source data is sparse or contradictory
9. Be precise with medical terminology — this summary may be used in legal proceedings
10. When pain management data is present, incorporate diagnoses, treatment plans (including injection/surgery recommendations), and physical exam findings into the appropriate summary sections
11. When physical therapy data is present, incorporate functional outcome measures (NDI, ODI, PSFS, LEFS), treatment goals with baselines and targets, and plan of care details. PT data establishes the functional recovery timeline — critical for damages calculations
12. Cross-reference diagnoses across all sources. If MRI, chiro, PM, and PT all reference the same condition, consolidate into a single diagnosis entry with higher confidence
13. Include PT outcome measure scores in the symptoms timeline pain_levels when they indicate functional status changes`

const SUMMARY_TOOL: Anthropic.Tool = {
  name: 'extract_case_summary',
  description: 'Extract a structured clinical case summary from the provided clinical data',
  input_schema: {
    type: 'object' as const,
    required: [
      'chief_complaint',
      'imaging_findings',
      'prior_treatment',
      'symptoms_timeline',
      'suggested_diagnoses',
      'confidence',
      'extraction_notes',
    ],
    properties: {
      chief_complaint: {
        type: 'string',
        description: 'Synthesized chief complaint narrative combining accident details and presenting symptoms. Use "null" if insufficient data.',
      },
      imaging_findings: {
        type: 'array',
        description: 'Imaging findings grouped by body region',
        items: {
          type: 'object',
          required: ['body_region', 'summary', 'key_findings', 'severity'],
          properties: {
            body_region: { type: 'string', description: 'Body region (e.g., "Cervical Spine", "Lumbar Spine")' },
            summary: { type: 'string', description: 'Brief summary of findings for this region' },
            key_findings: {
              type: 'array',
              items: { type: 'string' },
              description: 'Individual significant findings',
            },
            severity: {
              type: 'string',
              enum: ['mild', 'moderate', 'severe', 'null'],
              description: 'Overall severity for this region. Use "null" if unclear.',
            },
          },
        },
      },
      prior_treatment: {
        type: 'object',
        required: ['modalities', 'total_visits', 'treatment_period', 'gaps'],
        properties: {
          modalities: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of treatment modalities used',
          },
          total_visits: {
            type: ['integer', 'string'],
            description: 'Total number of treatment visits. Use "null" if unknown.',
          },
          treatment_period: {
            type: 'string',
            description: 'Human-readable treatment period (e.g., "Jan 2026 – Mar 2026"). Use "null" if unknown.',
          },
          gaps: {
            type: 'array',
            description: 'Treatment gaps > 14 days',
            items: {
              type: 'object',
              required: ['from', 'to', 'days'],
              properties: {
                from: { type: 'string' },
                to: { type: 'string' },
                days: { type: 'integer' },
              },
            },
          },
        },
      },
      symptoms_timeline: {
        type: 'object',
        required: ['onset', 'progression', 'current_status', 'pain_levels'],
        properties: {
          onset: {
            type: 'string',
            description: 'Initial symptom presentation. Use "null" if unknown.',
          },
          progression: {
            type: 'array',
            items: {
              type: 'object',
              required: ['date', 'description'],
              properties: {
                date: { type: 'string', description: 'Use "null" if no specific date' },
                description: { type: 'string' },
              },
            },
          },
          current_status: {
            type: 'string',
            description: 'Current symptom status. Use "null" if unknown.',
          },
          pain_levels: {
            type: 'array',
            items: {
              type: 'object',
              required: ['date', 'level', 'context'],
              properties: {
                date: { type: 'string', description: 'Use "null" if unknown' },
                level: { type: 'integer', description: 'Pain level 0-10' },
                context: { type: 'string', description: 'Context for this reading. Use "null" if none.' },
              },
            },
          },
        },
      },
      suggested_diagnoses: {
        type: 'array',
        description: 'Suggested diagnoses with ICD-10 codes and confidence levels',
        items: {
          type: 'object',
          required: ['diagnosis', 'icd10_code', 'confidence', 'supporting_evidence'],
          properties: {
            diagnosis: { type: 'string' },
            icd10_code: { type: 'string', description: 'ICD-10 code. Use "null" if not determinable.' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            supporting_evidence: { type: 'string', description: 'Brief explanation of supporting evidence. Use "null" if none.' },
          },
        },
      },
      confidence: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: 'Overall confidence in the summary based on data completeness and quality',
      },
      extraction_notes: {
        type: 'string',
        description: 'Any notes about data quality, missing information, or assumptions made. Use "null" if none.',
      },
    },
  },
}

// Input data shape passed to the generator
export interface SummaryInputData {
  caseDetails: {
    accident_type: string | null
    accident_date: string | null
    accident_description: string | null
  }
  mriExtractions: Array<{
    body_region: string | null
    mri_date: string | null
    findings: unknown
    impression_summary: string | null
    provider_overrides: unknown
  }>
  chiroExtractions: Array<{
    report_type: string | null
    report_date: string | null
    treatment_dates: unknown
    diagnoses: unknown
    treatment_modalities: unknown
    functional_outcomes: unknown
    provider_overrides: unknown
  }>
  pmExtractions: Array<{
    report_date: string | null
    examining_provider: string | null
    chief_complaints: unknown
    physical_exam: unknown
    diagnoses: unknown
    treatment_plan: unknown
    diagnostic_studies_summary: string | null
    provider_overrides: unknown
  }>
  ptExtractions: Array<{
    evaluation_date: string | null
    evaluating_therapist: string | null
    pain_ratings: unknown
    range_of_motion: unknown
    muscle_strength: unknown
    special_tests: unknown
    outcome_measures: unknown
    short_term_goals: unknown
    long_term_goals: unknown
    plan_of_care: unknown
    diagnoses: unknown
    clinical_impression: string | null
    causation_statement: string | null
    prognosis: string | null
    provider_overrides: unknown
  }>
}

function normalizeNullString(val: unknown): string | null {
  if (val === 'null' || val === null || val === undefined) return null
  return String(val)
}

function normalizeNullStringsInArray<T extends Record<string, unknown>>(
  items: T[],
  nullableFields: (keyof T)[],
): T[] {
  return items.map((item) => {
    const normalized = { ...item }
    for (const field of nullableFields) {
      normalized[field] = normalizeNullString(item[field]) as T[keyof T]
    }
    return normalized
  })
}

export async function generateCaseSummaryFromData(
  inputData: SummaryInputData,
): Promise<{
  data?: CaseSummaryResult
  rawResponse?: unknown
  error?: string
}> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 16384,
      thinking: {
        type: 'enabled',
        budget_tokens: 10000,
      },
      system: SYSTEM_PROMPT,
      tools: [SUMMARY_TOOL],
      tool_choice: { type: 'tool', name: 'extract_case_summary' },
      messages: [
        {
          role: 'user',
          content: `Synthesize the following clinical data into a comprehensive case summary.\n\n${JSON.stringify(inputData, null, 2)}`,
        },
      ],
    })

    const toolBlock = response.content.find((b) => b.type === 'tool_use')
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      return { error: 'No tool use response from Claude' }
    }

    const raw = toolBlock.input as Record<string, unknown>

    // Normalize null strings (same pattern as extract-mri.ts / extract-chiro.ts)
    const rawPriorTreatment = (raw.prior_treatment as Record<string, unknown>) || {}
    const rawSymptomsTimeline = (raw.symptoms_timeline as Record<string, unknown>) || {}

    // Coerce total_visits: Claude may return a string like "42" due to type: ['integer', 'string']
    const rawTotalVisits = rawPriorTreatment?.total_visits
    const normalizedTotalVisits = normalizeNullString(rawTotalVisits)
    const coercedTotalVisits = normalizedTotalVisits === null
      ? null
      : Number(normalizedTotalVisits)

    // Safely coerce any value to an array (Claude may return null for array fields)
    const toArray = (val: unknown): Array<Record<string, unknown>> =>
      Array.isArray(val) ? val : []

    const normalized = {
      chief_complaint: normalizeNullString(raw.chief_complaint),
      extraction_notes: normalizeNullString(raw.extraction_notes),
      confidence: raw.confidence ?? 'low',
      imaging_findings: normalizeNullStringsInArray(
        toArray(raw.imaging_findings),
        ['severity'],
      ),
      prior_treatment: {
        modalities: (Array.isArray(rawPriorTreatment?.modalities) ? rawPriorTreatment.modalities : []).map((m: unknown) => String(m)),
        total_visits: Number.isNaN(coercedTotalVisits) ? null : coercedTotalVisits,
        treatment_period: normalizeNullString(rawPriorTreatment?.treatment_period),
        gaps: toArray(rawPriorTreatment?.gaps),
      },
      symptoms_timeline: {
        onset: normalizeNullString(rawSymptomsTimeline?.onset),
        current_status: normalizeNullString(rawSymptomsTimeline?.current_status),
        progression: normalizeNullStringsInArray(
          toArray(rawSymptomsTimeline?.progression),
          ['date'],
        ),
        pain_levels: normalizeNullStringsInArray(
          toArray(rawSymptomsTimeline?.pain_levels),
          ['date', 'context'],
        ),
      },
      suggested_diagnoses: normalizeNullStringsInArray(
        toArray(raw.suggested_diagnoses),
        ['icd10_code', 'supporting_evidence'],
      ),
    }

    const validated = caseSummaryResultSchema.safeParse(normalized)
    if (!validated.success) {
      console.error('[generate-summary] Zod validation errors:', JSON.stringify(validated.error.issues, null, 2))
      return { error: 'Summary output failed validation', rawResponse: raw }
    }

    return { data: validated.data, rawResponse: raw }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Claude API call failed' }
  }
}
