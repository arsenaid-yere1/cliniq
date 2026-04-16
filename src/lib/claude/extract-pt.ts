import Anthropic from '@anthropic-ai/sdk'
import { callClaudeTool } from '@/lib/claude/client'
import { ptExtractionResultSchema, type PtExtractionResult } from '@/lib/validations/pt-extraction'

const SYSTEM_PROMPT = `You are a medical data extraction assistant for a personal injury clinic.
You are extracting structured data from a physical therapy initial evaluation report.

RULES:
1. Extract pain ratings exactly as stated. NPRS at rest, with activity, worst, and best.
2. For range of motion, extract AROM/PROM distinction, degrees, and whether pain occurs at end range. Use standard normal values.
3. For muscle strength, extract MMT grades (0/5 to 5/5) per muscle group with side (left/right/bilateral).
4. Extract palpation findings with tenderness grade (0-3+), spasm presence, and trigger point presence per location.
5. Special/orthopedic tests: extract each test name, result (positive/negative), side, and any notes.
6. For standardized outcome measures (NDI, ODI, PSFS, LEFS, DASH, QuickDASH), extract the instrument name, numeric score, max score, percentage if stated, and interpretation.
7. Extract ALL treatment goals as written — both short-term (2-4 week) and long-term (6-12 week). Include timeframe, baseline value, and target value when stated.
8. For plan of care, extract frequency (e.g., "3x/week"), duration (e.g., "6 weeks"), modalities with CPT codes when listed, HEP prescribed (yes/no), and re-evaluation schedule.
9. Extract ALL diagnosis codes exactly as written, including the ICD-10 7th character.
10. Neurological screening: extract DTR grades per level with side, sensation summary, and motor notes.
11. Functional tests: extract test name (e.g., "Timed Up and Go"), measured value (e.g., "12.5 seconds"), and interpretation when provided.
12. Return null for any field that cannot be determined from the document.
13. Set confidence to "low" for poor quality scans, partial documents, or ambiguous content.
14. Add extraction_notes for anything ambiguous or noteworthy.`

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: 'extract_pt_data',
  description: 'Extract structured data from a physical therapy initial evaluation report',
  input_schema: {
    type: 'object',
    properties: {
      evaluation_date: {
        type: 'string',
        description: 'ISO 8601 date (YYYY-MM-DD) or "null" if not found.',
      },
      date_of_injury: {
        type: 'string',
        description: 'ISO 8601 date (YYYY-MM-DD) or "null" if not found.',
      },
      evaluating_therapist: {
        type: 'string',
        description: 'Name of the evaluating therapist or "null" if not found.',
      },
      referring_provider: {
        type: 'string',
        description: 'Name of the referring provider or "null" if not found.',
      },
      chief_complaint: {
        type: 'string',
        description: 'Chief complaint or "null" if not found.',
      },
      mechanism_of_injury: {
        type: 'string',
        description: 'Mechanism of injury or "null" if not found.',
      },
      pain_ratings: {
        type: 'object',
        properties: {
          at_rest: { type: ['number', 'null'] },
          with_activity: { type: ['number', 'null'] },
          worst: { type: ['number', 'null'] },
          best: { type: ['number', 'null'] },
        },
        required: ['at_rest', 'with_activity', 'worst', 'best'],
      },
      functional_limitations: {
        type: 'string',
        description: 'Functional limitations or "null" if not found.',
      },
      prior_treatment: {
        type: 'string',
        description: 'Prior treatment history or "null" if not found.',
      },
      work_status: {
        type: 'string',
        description: 'Work status or "null" if not found.',
      },
      postural_assessment: {
        type: 'string',
        description: 'Postural assessment findings or "null" if not found.',
      },
      gait_analysis: {
        type: 'string',
        description: 'Gait analysis findings or "null" if not found.',
      },
      range_of_motion: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            region: { type: 'string' },
            movement: { type: 'string' },
            measurement_type: { type: 'string', enum: ['AROM', 'PROM'], description: 'AROM or PROM, or "null"' },
            normal: { type: ['number', 'null'] },
            actual: { type: ['number', 'null'] },
            pain_at_end_range: { type: 'boolean' },
          },
          required: ['region', 'movement', 'measurement_type', 'normal', 'actual', 'pain_at_end_range'],
        },
      },
      muscle_strength: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            muscle_group: { type: 'string' },
            side: { type: 'string', enum: ['left', 'right', 'bilateral'], description: 'Side or "null"' },
            grade: { type: 'string' },
          },
          required: ['muscle_group', 'side', 'grade'],
        },
      },
      palpation_findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            location: { type: 'string' },
            tenderness_grade: { type: 'string', description: 'Tenderness grade or "null"' },
            spasm: { type: 'boolean' },
            trigger_points: { type: 'boolean' },
          },
          required: ['location', 'tenderness_grade', 'spasm', 'trigger_points'],
        },
      },
      special_tests: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            result: { type: 'string', enum: ['positive', 'negative'] },
            side: { type: 'string', enum: ['left', 'right', 'bilateral'], description: 'Side or "null"' },
            notes: { type: 'string', description: 'Notes or "null"' },
          },
          required: ['name', 'result', 'side', 'notes'],
        },
      },
      neurological_screening: {
        type: 'object',
        properties: {
          reflexes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                location: { type: 'string' },
                grade: { type: 'string' },
                side: { type: 'string', enum: ['left', 'right', 'bilateral'], description: 'Side or "null"' },
              },
              required: ['location', 'grade', 'side'],
            },
          },
          sensation: { type: 'string', description: 'Sensation summary or "null"' },
          motor_notes: { type: 'string', description: 'Motor notes or "null"' },
        },
        required: ['reflexes', 'sensation', 'motor_notes'],
      },
      functional_tests: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            value: { type: 'string' },
            interpretation: { type: 'string', description: 'Interpretation or "null"' },
          },
          required: ['name', 'value', 'interpretation'],
        },
      },
      outcome_measures: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            instrument: { type: 'string' },
            score: { type: ['number', 'null'] },
            max_score: { type: ['number', 'null'] },
            percentage: { type: ['number', 'null'] },
            interpretation: { type: 'string', description: 'Interpretation or "null"' },
          },
          required: ['instrument', 'score', 'max_score', 'percentage', 'interpretation'],
        },
      },
      clinical_impression: {
        type: 'string',
        description: 'Clinical impression or "null" if not found.',
      },
      causation_statement: {
        type: 'string',
        description: 'Causation statement or "null" if not found.',
      },
      prognosis: {
        type: 'string',
        description: 'Prognosis or "null" if not found.',
      },
      short_term_goals: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            timeframe: { type: 'string', description: 'Timeframe or "null"' },
            baseline: { type: 'string', description: 'Baseline value or "null"' },
            target: { type: 'string', description: 'Target value or "null"' },
          },
          required: ['description', 'timeframe', 'baseline', 'target'],
        },
      },
      long_term_goals: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            timeframe: { type: 'string', description: 'Timeframe or "null"' },
            baseline: { type: 'string', description: 'Baseline value or "null"' },
            target: { type: 'string', description: 'Target value or "null"' },
          },
          required: ['description', 'timeframe', 'baseline', 'target'],
        },
      },
      plan_of_care: {
        type: 'object',
        properties: {
          frequency: { type: 'string', description: 'Frequency or "null"' },
          duration: { type: 'string', description: 'Duration or "null"' },
          modalities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                cpt_code: { type: 'string', description: 'CPT code or "null"' },
              },
              required: ['name', 'cpt_code'],
            },
          },
          home_exercise_program: { type: ['boolean', 'null'] },
          re_evaluation_schedule: { type: 'string', description: 'Re-evaluation schedule or "null"' },
        },
        required: ['frequency', 'duration', 'modalities', 'home_exercise_program', 're_evaluation_schedule'],
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
      'evaluation_date', 'date_of_injury', 'evaluating_therapist', 'referring_provider',
      'chief_complaint', 'mechanism_of_injury', 'pain_ratings', 'functional_limitations',
      'prior_treatment', 'work_status', 'postural_assessment', 'gait_analysis',
      'range_of_motion', 'muscle_strength', 'palpation_findings', 'special_tests',
      'neurological_screening', 'functional_tests', 'outcome_measures',
      'clinical_impression', 'causation_statement', 'prognosis',
      'short_term_goals', 'long_term_goals', 'plan_of_care', 'diagnoses',
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

export async function extractPtFromPdf(pdfBase64: string): Promise<{
  data?: PtExtractionResult
  rawResponse?: unknown
  error?: string
}> {
  return callClaudeTool<PtExtractionResult>({
    model: 'claude-sonnet-4-6',
    maxTokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [EXTRACTION_TOOL],
    toolName: 'extract_pt_data',
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text', text: 'Extract the structured data from this physical therapy initial evaluation report now.' },
      ],
    }],
    parse: (raw) => {
      const painRatingsRaw = (raw.pain_ratings ?? {}) as Record<string, unknown>
      const neuroRaw = (raw.neurological_screening ?? {}) as Record<string, unknown>
      const pocRaw = (raw.plan_of_care ?? {}) as Record<string, unknown>

      const normalized = {
        evaluation_date: normalizeNullString(raw.evaluation_date),
        date_of_injury: normalizeNullString(raw.date_of_injury),
        evaluating_therapist: normalizeNullString(raw.evaluating_therapist),
        referring_provider: normalizeNullString(raw.referring_provider),
        chief_complaint: normalizeNullString(raw.chief_complaint),
        mechanism_of_injury: normalizeNullString(raw.mechanism_of_injury),
        pain_ratings: {
          at_rest: painRatingsRaw.at_rest === 'null' ? null : (painRatingsRaw.at_rest ?? null),
          with_activity: painRatingsRaw.with_activity === 'null' ? null : (painRatingsRaw.with_activity ?? null),
          worst: painRatingsRaw.worst === 'null' ? null : (painRatingsRaw.worst ?? null),
          best: painRatingsRaw.best === 'null' ? null : (painRatingsRaw.best ?? null),
        },
        functional_limitations: normalizeNullString(raw.functional_limitations),
        prior_treatment: normalizeNullString(raw.prior_treatment),
        work_status: normalizeNullString(raw.work_status),
        postural_assessment: normalizeNullString(raw.postural_assessment),
        gait_analysis: normalizeNullString(raw.gait_analysis),
        range_of_motion: normalizeNullStringsInArray(raw.range_of_motion, ['measurement_type']),
        muscle_strength: normalizeNullStringsInArray(raw.muscle_strength, ['side']),
        palpation_findings: normalizeNullStringsInArray(raw.palpation_findings, ['tenderness_grade']),
        special_tests: normalizeNullStringsInArray(raw.special_tests, ['side', 'notes']),
        neurological_screening: {
          reflexes: normalizeNullStringsInArray(
            neuroRaw.reflexes,
            ['side'],
          ),
          sensation: normalizeNullString(neuroRaw.sensation),
          motor_notes: normalizeNullString(neuroRaw.motor_notes),
        },
        functional_tests: normalizeNullStringsInArray(raw.functional_tests, ['interpretation']),
        outcome_measures: normalizeNullStringsInArray(raw.outcome_measures, ['interpretation']),
        clinical_impression: normalizeNullString(raw.clinical_impression),
        causation_statement: normalizeNullString(raw.causation_statement),
        prognosis: normalizeNullString(raw.prognosis),
        short_term_goals: normalizeNullStringsInArray(raw.short_term_goals, ['timeframe', 'baseline', 'target']),
        long_term_goals: normalizeNullStringsInArray(raw.long_term_goals, ['timeframe', 'baseline', 'target']),
        plan_of_care: {
          frequency: normalizeNullString(pocRaw.frequency),
          duration: normalizeNullString(pocRaw.duration),
          modalities: normalizeNullStringsInArray(
            pocRaw.modalities,
            ['cpt_code'],
          ),
          home_exercise_program: pocRaw.home_exercise_program === 'null' ? null : (pocRaw.home_exercise_program ?? null),
          re_evaluation_schedule: normalizeNullString(pocRaw.re_evaluation_schedule),
        },
        diagnoses: normalizeNullStringsInArray(raw.diagnoses, ['icd10_code']),
        confidence: raw.confidence,
        extraction_notes: normalizeNullString(raw.extraction_notes),
      }

      const validated = ptExtractionResultSchema.safeParse(normalized)
      return validated.success
        ? { success: true, data: validated.data }
        : { success: false, error: validated.error }
    },
  })
}
