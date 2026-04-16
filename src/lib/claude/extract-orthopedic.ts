import Anthropic from '@anthropic-ai/sdk'
import { callClaudeTool } from '@/lib/claude/client'
import { orthopedicExtractionResultSchema, type OrthopedicExtractionResult } from '@/lib/validations/orthopedic-extraction'

const SYSTEM_PROMPT = `You are a medical data extraction assistant for a personal injury clinic.
You are extracting structured data from an orthopedic surgical evaluation report (and any accompanying radiographic report).

RULES:
1. Extract all sections: present complaints, history of injury, past medical/surgical history, medications, allergies, social/family history, physical examination, diagnostics, diagnoses, and recommendations.
2. For present complaints, extract each body region separately with description, radiation pattern, and whether the patient denies pre-existing issues.
3. For physical examination, extract each body region with ROM summary, tenderness, strength, neurovascular status, and any special tests performed.
4. For diagnostics, summarize referenced imaging studies (X-ray findings, MRI report references) with modality, body region, study date, and findings narrative.
5. Extract ICD-10 diagnosis codes exactly as written in the report, including the 7th character.
6. For recommendations, extract treatment descriptions with type classification, estimated costs when stated (e.g., "$8,000" → min: 8000, max: 8000), body region, and follow-up timeframe.
7. Classify recommendation types: "therapy" for physical therapy/rehab, "injection" for injections/blocks, "referral" for specialist referrals, "monitoring" for follow-up/re-evaluation, "surgery" for surgical procedures, "other" for anything else.
8. Extract patient demographics: age, sex, hand dominance, height, weight, employment.
9. Extract current medications with name and usage details (e.g., "3-4 times a week").
10. Return null for any field that cannot be determined from the document.
11. Set confidence to "low" for poor quality scans, partial documents, or ambiguous content.
12. Add extraction_notes for anything ambiguous or noteworthy.`

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: 'extract_orthopedic_data',
  description: 'Extract structured data from an orthopedic surgical evaluation report',
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
      provider_specialty: {
        type: 'string',
        description: 'Provider specialty (e.g., "Orthopedic Surgeon") or "null".',
      },
      patient_age: {
        type: ['number', 'null'],
        description: 'Patient age in years.',
      },
      patient_sex: {
        type: 'string',
        description: '"male" or "female" or "null".',
      },
      hand_dominance: {
        type: 'string',
        description: '"right" or "left" or "null".',
      },
      height: {
        type: 'string',
        description: 'Patient height as stated (e.g., "5\'1\\"") or "null".',
      },
      weight: {
        type: 'string',
        description: 'Patient weight as stated (e.g., "105 pounds") or "null".',
      },
      current_employment: {
        type: 'string',
        description: 'Current employment description or "null".',
      },
      history_of_injury: {
        type: 'string',
        description: 'Narrative history of injury (MVA details, mechanism) or "null".',
      },
      past_medical_history: {
        type: 'string',
        description: 'Past medical history narrative or "null".',
      },
      surgical_history: {
        type: 'string',
        description: 'Surgical history narrative or "null".',
      },
      previous_complaints: {
        type: 'string',
        description: 'Previous musculoskeletal complaints or "null".',
      },
      subsequent_complaints: {
        type: 'string',
        description: 'Post-accident injuries/complaints or "null".',
      },
      allergies: {
        type: 'string',
        description: 'Allergies (e.g., "NKDA") or "null".',
      },
      social_history: {
        type: 'string',
        description: 'Social history (smoking, alcohol, etc.) or "null".',
      },
      family_history: {
        type: 'string',
        description: 'Family history or "null".',
      },
      present_complaints: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            location: { type: 'string' },
            description: { type: 'string' },
            radiation: { type: 'string', description: 'Radiation pattern or "null"' },
            pre_existing: { type: 'boolean', description: 'false if patient denies pre-existing issues' },
          },
          required: ['location', 'description', 'radiation', 'pre_existing'],
        },
      },
      current_medications: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            details: { type: 'string', description: 'Usage details or "null"' },
          },
          required: ['name', 'details'],
        },
      },
      physical_exam: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            region: { type: 'string' },
            rom_summary: { type: 'string', description: 'Range of motion summary or "null"' },
            tenderness: { type: 'string', description: 'Tenderness findings or "null"' },
            strength: { type: 'string', description: 'Strength findings or "null"' },
            neurovascular: { type: 'string', description: 'Neurovascular status or "null"' },
            special_tests: { type: 'string', description: 'Special tests performed or "null"' },
          },
          required: ['region', 'rom_summary', 'tenderness', 'strength', 'neurovascular', 'special_tests'],
        },
      },
      diagnostics: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            modality: { type: 'string', description: '"X-ray", "MRI", "CT", etc.' },
            body_region: { type: 'string' },
            study_date: { type: 'string', description: 'ISO 8601 date or "null"' },
            findings: { type: 'string' },
            films_available: { type: 'boolean' },
          },
          required: ['modality', 'body_region', 'study_date', 'findings', 'films_available'],
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
      recommendations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            type: {
              type: 'string',
              enum: ['therapy', 'injection', 'referral', 'monitoring', 'surgery', 'other'],
              description: 'Recommendation type or "null"',
            },
            estimated_cost_min: { type: ['number', 'null'] },
            estimated_cost_max: { type: ['number', 'null'] },
            body_region: { type: 'string', description: 'Body region or "null"' },
            follow_up_timeframe: { type: 'string', description: 'Follow-up timeframe or "null"' },
          },
          required: ['description', 'type', 'estimated_cost_min', 'estimated_cost_max', 'body_region', 'follow_up_timeframe'],
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
      'report_date', 'date_of_injury', 'examining_provider', 'provider_specialty',
      'patient_age', 'patient_sex', 'hand_dominance', 'height', 'weight', 'current_employment',
      'history_of_injury', 'past_medical_history', 'surgical_history',
      'previous_complaints', 'subsequent_complaints', 'allergies', 'social_history', 'family_history',
      'present_complaints', 'current_medications', 'physical_exam', 'diagnostics',
      'diagnoses', 'recommendations', 'confidence', 'extraction_notes',
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

export async function extractOrthopedicFromPdf(pdfBase64: string): Promise<{
  data?: OrthopedicExtractionResult
  rawResponse?: unknown
  error?: string
}> {
  return callClaudeTool<OrthopedicExtractionResult>({
    model: 'claude-sonnet-4-6',
    maxTokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [EXTRACTION_TOOL],
    toolName: 'extract_orthopedic_data',
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text', text: 'Extract the structured data from this orthopedic surgical evaluation report now.' },
      ],
    }],
    parse: (raw) => {
      const normalized = {
        report_date: normalizeNullString(raw.report_date),
        date_of_injury: normalizeNullString(raw.date_of_injury),
        examining_provider: normalizeNullString(raw.examining_provider),
        provider_specialty: normalizeNullString(raw.provider_specialty),
        patient_age: raw.patient_age === 'null' || raw.patient_age === null ? null : raw.patient_age,
        patient_sex: normalizeNullString(raw.patient_sex),
        hand_dominance: normalizeNullString(raw.hand_dominance),
        height: normalizeNullString(raw.height),
        weight: normalizeNullString(raw.weight),
        current_employment: normalizeNullString(raw.current_employment),
        history_of_injury: normalizeNullString(raw.history_of_injury),
        past_medical_history: normalizeNullString(raw.past_medical_history),
        surgical_history: normalizeNullString(raw.surgical_history),
        previous_complaints: normalizeNullString(raw.previous_complaints),
        subsequent_complaints: normalizeNullString(raw.subsequent_complaints),
        allergies: normalizeNullString(raw.allergies),
        social_history: normalizeNullString(raw.social_history),
        family_history: normalizeNullString(raw.family_history),
        present_complaints: normalizeNullStringsInArray(raw.present_complaints, ['radiation']),
        current_medications: normalizeNullStringsInArray(raw.current_medications, ['details']),
        physical_exam: normalizeNullStringsInArray(raw.physical_exam, [
          'rom_summary', 'tenderness', 'strength', 'neurovascular', 'special_tests',
        ]),
        diagnostics: normalizeNullStringsInArray(raw.diagnostics, ['study_date']),
        diagnoses: normalizeNullStringsInArray(raw.diagnoses, ['icd10_code']),
        recommendations: normalizeNullStringsInArray(raw.recommendations, [
          'type', 'body_region', 'follow_up_timeframe',
        ]),
        confidence: raw.confidence,
        extraction_notes: normalizeNullString(raw.extraction_notes),
      }

      const validated = orthopedicExtractionResultSchema.safeParse(normalized)
      return validated.success
        ? { success: true, data: validated.data }
        : { success: false, error: validated.error }
    },
  })
}
