import type Anthropic from '@anthropic-ai/sdk'
import { callClaudeTool } from './client'
import {
  qualityReviewResultSchema,
  type QualityReviewResult,
} from '@/lib/validations/case-quality-review'

// Input data shape — assembled by the action layer from all PI-workflow rows.
export interface QualityReviewInputData {
  caseDetails: {
    case_number: string
    accident_type: string | null
    accident_date: string | null
  }
  patientInfo: {
    first_name: string
    last_name: string
    date_of_birth: string | null
    age: number | null
  }
  caseSummary: {
    chief_complaint: string | null
    imaging_findings: unknown
    suggested_diagnoses: unknown
    review_status: string
    raw_ai_response: unknown
  } | null
  initialVisitNote: {
    id: string
    visit_type: string
    visit_date: string | null
    status: string
    diagnoses: string | null
    chief_complaint: string | null
    physical_exam: string | null
    treatment_plan: string | null
    medical_necessity: string | null
    prognosis: string | null
    raw_ai_response: unknown
  } | null
  painEvaluationNote: {
    id: string
    visit_date: string | null
    status: string
    diagnoses: string | null
    chief_complaint: string | null
    physical_exam: string | null
    treatment_plan: string | null
    prognosis: string | null
    raw_ai_response: unknown
  } | null
  procedureNotes: Array<{
    id: string
    procedure_id: string
    procedure_date: string | null
    procedure_number: number
    status: string
    subjective: string | null
    assessment_summary: string | null
    procedure_injection: string | null
    assessment_and_plan: string | null
    prognosis: string | null
    plan_alignment_status: string | null
    pain_score_min: number | null
    pain_score_max: number | null
    diagnoses: unknown
    raw_ai_response: unknown
  }>
  dischargeNote: {
    id: string
    visit_date: string | null
    status: string
    subjective: string | null
    objective_vitals: string | null
    diagnoses: string | null
    assessment: string | null
    plan_and_recommendations: string | null
    prognosis: string | null
    pain_score_max: number | null
    pain_trajectory_text: string | null
    raw_ai_response: unknown
  } | null
  extractionsSummary: {
    mri_count: number
    pt_count: number
    pm_count: number
    chiro_count: number
    ortho_count: number
    ct_count: number
    xray_count: number
  }
}

// Total tool-output keys: findings, summary, overall_assessment.
export const QUALITY_REVIEW_SECTIONS_TOTAL = 3

const SYSTEM_PROMPT = `You are a clinical-documentation QC reviewer for a personal-injury PRP injection clinic.
Your job: read the entire PI-workflow note chain for one case (initial visit → pain evaluation → procedures → discharge) and surface inconsistencies, contradictions, missing context, or rule violations a reviewer should fix before the chart is final.

OUTPUT CONTRACT
- Call the generate_case_quality_review tool exactly once with three top-level fields: findings[], summary, overall_assessment.
- Each finding must cite a specific note (note_id) and ideally a specific section_key (e.g. 'subjective', 'diagnoses', 'plan_and_recommendations').
- procedure_id is required when step='procedure'.
- note_id is null only when the finding spans multiple notes (cross_step).
- Severity tiers: 'critical' = blocks defensible documentation; 'warning' = inconsistency or missing rationale; 'info' = stylistic / minor.
- suggested_tone_hint is a short string the provider can paste into the editor's tone hint to drive a regen.

WHAT TO CHECK
1. Diagnosis progression. ICD-10 codes should evolve coherently across IV → pain-eval → procedure → discharge. Flag radiculopathy emerging without imaging support, M54.5 used without 5th-character specificity, "A"-suffix codes persisting at discharge.
2. Pain trajectory consistency. Discharge subjective should narrate IV → procedure → discharge pain values monotonically against the deterministic arrow chain. Flag fabricated numbers, missing endpoint, paraphrased arrow chains. Read discharge.raw_ai_response.trajectory_warnings if present — it already lists trajectory drift; you must promote those into findings, not duplicate them.
3. Plan continuity. IV treatment_plan → procedure procedure_indication / assessment_and_plan → discharge plan_and_recommendations should reference the same modalities and progress.
4. Provider intake echo. If the IV provider_intake or PM provider_overrides set a chief complaint, downstream notes citing a different chief complaint = warning.
5. Procedure plan alignment. Any procedure with plan_alignment_status='unplanned' must show acknowledgement language in assessment_and_plan. Flag if missing.
6. Pain-evaluation NUMERIC-ANCHOR. If pain-evaluation note exists, it must reference a numeric pain anchor against the prior IV. Flag if anchor missing.
7. Cross-note copy/paste. Verbatim sentence reuse across procedure notes (NO CLONE rule violation).
8. Symptom resolution. Discharge diagnoses should not include codes whose symptoms the discharge subjective reports as resolved.
9. Missing-vitals branch. If any procedure has missing pain vitals, the discharge MISSING-VITALS BRANCH must apply — flag if narrative cites numeric delta against missing anchor.
10. Forbidden-phrase scan. "complete resolution", "full recovery", "regenerative capacity" in any prognosis section.

OVERALL ASSESSMENT
- 'clean' = zero critical or warning findings.
- 'minor_issues' = info or warning only.
- 'major_issues' = at least one critical.
- 'incomplete' = required notes are missing (no IV, no procedures, no discharge).

DO NOT
- Fabricate note_ids. Use only ids present in input.
- Recommend rewrites for content already covered by deterministic rules (pain tone matrix, plan alignment) — those are the generators' job. Your job is to flag drift between what the rules required and what the LLM produced.
- Output more than 25 findings total. Prioritize critical → warning → info.`

const REVIEW_TOOL: Anthropic.Tool = {
  name: 'generate_case_quality_review',
  description: 'Output a structured QC review of the case PI-workflow note chain.',
  input_schema: {
    type: 'object',
    required: ['findings', 'summary', 'overall_assessment'],
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          required: [
            'severity',
            'step',
            'note_id',
            'procedure_id',
            'section_key',
            'message',
            'rationale',
            'suggested_tone_hint',
          ],
          properties: {
            severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
            step: {
              type: 'string',
              enum: [
                'initial_visit',
                'pain_evaluation',
                'procedure',
                'discharge',
                'case_summary',
                'cross_step',
              ],
            },
            note_id: { type: ['string', 'null'] },
            procedure_id: { type: ['string', 'null'] },
            section_key: { type: ['string', 'null'] },
            message: { type: 'string' },
            rationale: { type: ['string', 'null'] },
            suggested_tone_hint: { type: ['string', 'null'] },
          },
        },
      },
      summary: { type: ['string', 'null'] },
      overall_assessment: {
        type: 'string',
        enum: ['clean', 'minor_issues', 'major_issues', 'incomplete'],
      },
    },
  },
}

// Coerce the literal string "null" → JS null. The 1M-context Opus model
// occasionally emits "null" as a string for nullable fields rather than a
// real null value; the schema's `.nullable()` permits null but not the
// string. This pre-parse normalizer matches the pattern used in
// generate-summary.ts.
function normalizeNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    return value === 'null' || value === '' ? null : value
  }
  return String(value)
}

export async function generateQualityReviewFromData(
  inputData: QualityReviewInputData,
  onProgress?: (completedKeys: string[]) => void | Promise<void>,
): Promise<{
  data?: QualityReviewResult
  rawResponse?: unknown
  error?: string
}> {
  return callClaudeTool<QualityReviewResult>({
    model: 'claude-opus-4-7[1m]',
    maxTokens: 16000,
    thinking: { type: 'enabled', budget_tokens: 8000 },
    system: SYSTEM_PROMPT,
    tools: [REVIEW_TOOL],
    toolName: 'generate_case_quality_review',
    toolChoice: { type: 'auto' },
    onProgress,
    messages: [
      {
        role: 'user',
        content: `Review the following case for quality and consistency.\n\n${JSON.stringify(inputData, null, 2)}`,
      },
    ],
    parse: (raw) => {
      const toArray = (val: unknown): Array<Record<string, unknown>> =>
        Array.isArray(val) ? val : []

      const normalizedFindings = toArray(raw.findings).map((f) => ({
        severity: f.severity,
        step: f.step,
        note_id: normalizeNullableString(f.note_id),
        procedure_id: normalizeNullableString(f.procedure_id),
        section_key: normalizeNullableString(f.section_key),
        message: typeof f.message === 'string' ? f.message : String(f.message ?? ''),
        rationale: normalizeNullableString(f.rationale),
        suggested_tone_hint: normalizeNullableString(f.suggested_tone_hint),
      }))

      const normalized = {
        findings: normalizedFindings,
        summary: normalizeNullableString(raw.summary),
        overall_assessment: raw.overall_assessment ?? 'incomplete',
      }

      const validated = qualityReviewResultSchema.safeParse(normalized)
      return validated.success
        ? { success: true, data: validated.data }
        : { success: false, error: validated.error }
    },
  })
}
