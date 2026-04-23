import Anthropic from '@anthropic-ai/sdk'
import { callClaudeTool } from '@/lib/claude/client'
import { caseSummaryResultSchema, type CaseSummaryResult } from '@/lib/validations/case-summary'

const SYSTEM_PROMPT = `You are a clinical data analyst specializing in personal injury cases. Your task is to synthesize clinical data from multiple sources into a comprehensive case summary.

Rules:
1. Synthesize information from all provided sources — do not simply copy/paste
2. For chief complaint, combine accident details with presenting symptoms into a clear narrative
3. For imaging findings, group by body region and highlight clinically significant findings
4. For prior treatment, summarize the treatment course including modalities, frequency, and any gaps
5. For symptoms timeline, create a chronological progression from onset to current status
6. For suggested diagnoses, provide ICD-10 codes when available and rate confidence based on supporting evidence strength. Populate supporting_evidence with the specific source citation(s) that back the code (e.g., "MRI lumbar 03/12/2026 — L5-S1 disc protrusion contacting right S1 nerve root; PT note 04/02/2026 — positive right SLR at 45°"). Vague or empty supporting_evidence is not acceptable for any code tagged "high" or "medium".
7. Use "null" for any field where data is insufficient to make a determination
8. Set confidence to "low" if source data is sparse or contradictory. Additionally, apply the objective-support rubric in rule 8a below when assigning confidence to radiculopathy, myelopathy, and myalgia codes.

8a. OBJECTIVE-SUPPORT RUBRIC for ICD-10 confidence:
  • Radiculopathy codes (M54.12, M54.17, M50.1X, M51.1X): "high" requires BOTH (i) imaging showing nerve-root compromise in the matching region AND (ii) at least one region-matched objective finding in source docs — positive Spurling (cervical) or SLR reproducing radicular LEG symptoms (lumbar), dermatomal sensory deficit in the matching roots, myotomal weakness in the matching root distribution, or a diminished reflex in the matching root. "medium" requires imaging evidence plus subjective radiation in the matching dermatome WITHOUT documented objective finding. "low" when only subjective radiation is present (no imaging correlate or no objective finding in the same region).
  • Myelopathy codes (M50.00/.01/.02, M47.1X, M54.18): "high" requires imaging of cord compression AND at least one upper-motor-neuron sign in source docs (hyperreflexia, clonus, Hoffmann, Babinski, spastic gait, or bowel/bladder dysfunction). "medium" when imaging shows cord contact but no UMN sign is documented. "low" when neither is documented.
  • M79.1 Myalgia: "high" requires documented diffuse muscle pain beyond axial spine tenderness in source docs (e.g., upper-trapezius involvement plus non-axial regions, generalized muscle soreness in multiple non-contiguous areas). "low" when findings are limited to focal paraspinal tenderness already captured by a region pain code (M54.2, M54.50/.51/.59, M54.6) — M79.1 is redundant and should be tagged "low".
  • M54.5 lumbar pain: NEVER emit the parent M54.5 in suggested_diagnoses — always pick a 5th-character subcode (M54.50 default, M54.51 if vertebrogenic pattern is documented on imaging, M54.59 if another documented low-back-pain type applies).

Do not drop diagnoses based on this rubric — tag them with the correct confidence and populate supporting_evidence accordingly. Downstream note generators rely on confidence + evidence to decide whether to emit each code.

8b. DOWNGRADE PRECOMPUTE for myelopathy/radiculopathy: when a myelopathy or radiculopathy code would be tagged "low" or "medium" (i.e., it lacks the objective support Filter B/C requires at note-generation), populate downgrade_to with the substitution target so downstream note generators do not re-derive the substitution. Rules:
  • M50.00 / M50.01 / M50.02 / M47.1X / M54.18 without UMN signs → downgrade_to="M50.20"
  • M50.12X / M54.12 (cervical radiculopathy) without region-matched cervical objective finding → downgrade_to="M50.20"
  • M51.17 / M54.17 (lumbosacral radiculopathy) without region-matched lumbar radicular finding → downgrade_to="M51.37"
  • M51.16 (lumbar disc with radiculopathy) without region-matched lumbar radicular finding → downgrade_to="M51.36"
  • M48.0X with neurogenic-claudication qualifier but no UMN/neurogenic-claudication evidence → downgrade_to="M51.37" (lumbar) or "M50.20" (cervical), matching the affected level
  • All other cases (code passes, or no applicable downgrade) → downgrade_to=null
9. Be precise with medical terminology — this summary may be used in legal proceedings
10. When pain management data is present, incorporate diagnoses, treatment plans (including injection/surgery recommendations), and physical exam findings into the appropriate summary sections
11. When physical therapy data is present, incorporate functional outcome measures (NDI, ODI, PSFS, LEFS), treatment goals with baselines and targets, and plan of care details. PT data establishes the functional recovery timeline — critical for damages calculations
12. Cross-reference diagnoses across all sources. If MRI, chiro, PM, PT, and orthopedic all reference the same condition, consolidate into a single diagnosis entry with higher confidence
13. Include PT outcome measure scores in the symptoms timeline pain_levels when they indicate functional status changes
14. When orthopedic data is present, incorporate the surgeon's physical exam findings, ICD-10 diagnoses, treatment recommendations with cost estimates, and any referenced imaging (X-ray, MRI) into the appropriate summary sections. Orthopedic recommendations with cost estimates are especially valuable for damages calculations
15. Orthopedic reports often contain detailed history of injury narratives — use these to enrich the chief complaint when available
16. When CT scan data is present, incorporate CT findings into imaging_findings alongside MRI data. CT scans provide bone and structural detail complementary to MRI soft tissue findings. Cross-reference CT and MRI findings for the same body region to build a complete picture
17. When X-ray data is present, incorporate X-ray findings into imaging_findings alongside MRI and CT. Weight by reading_type: "formal_radiology" reads (ABR-certified radiologist or dedicated imaging facility) carry full evidentiary weight and should cite the reading_provider name; "in_office_alignment" reads (ordering physician reading own films, typically with alignment-only disclaimers) carry lower weight — cite them but note the reading context in supporting_evidence. Plain X-ray does NOT satisfy the imaging-showing-nerve-root-compromise requirement in rule 8a — do NOT upgrade radiculopathy codes to "high" based on X-ray findings alone; MRI or CT evidence is required. X-ray findings such as "loss of disk height C5-C6" support disc-degeneration codes (M50.3X cervical, M51.3X lumbar) and cervicalgia/lumbago codes at medium-to-high confidence when symptom-correlated. Negative X-rays ("no fracture, normal alignment") still carry value — document them as ruling out acute structural injury, which supports soft-tissue/radiculopathy diagnosis pathways`

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
          required: ['diagnosis', 'icd10_code', 'confidence', 'supporting_evidence', 'downgrade_to'],
          properties: {
            diagnosis: { type: 'string' },
            icd10_code: { type: 'string', description: 'ICD-10 code. Use "null" if not determinable.' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            supporting_evidence: { type: 'string', description: 'Brief explanation of supporting evidence. Use "null" if none.' },
            downgrade_to: {
              type: 'string',
              description: 'Pre-computed downgrade target ICD-10 code per Rule 8b (e.g., "M50.20" for a myelopathy code lacking UMN support). Use "null" when the code passes the rubric or no downgrade applies.',
            },
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
  orthoExtractions: Array<{
    report_date: string | null
    date_of_injury: string | null
    examining_provider: string | null
    provider_specialty: string | null
    history_of_injury: string | null
    present_complaints: unknown
    physical_exam: unknown
    diagnostics: unknown
    diagnoses: unknown
    recommendations: unknown
    provider_overrides: unknown
  }>
  ctScanExtractions: Array<{
    body_region: string | null
    scan_date: string | null
    technique: string | null
    reason_for_study: string | null
    findings: unknown
    impression_summary: string | null
    provider_overrides: unknown
  }>
  xRayExtractions: Array<{
    body_region: string | null
    laterality: string | null
    scan_date: string | null
    procedure_description: string | null
    view_count: number | null
    views_description: string | null
    reading_type: string | null
    ordering_provider: string | null
    reading_provider: string | null
    reason_for_study: string | null
    findings: unknown
    impression_summary: string | null
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
  return callClaudeTool<CaseSummaryResult>({
    model: 'claude-opus-4-6',
    maxTokens: 24000,
    thinking: { type: 'enabled', budget_tokens: 8000 },
    system: SYSTEM_PROMPT,
    tools: [SUMMARY_TOOL],
    toolName: 'extract_case_summary',
    toolChoice: { type: 'auto' },
    messages: [
      {
        role: 'user',
        content: `Synthesize the following clinical data into a comprehensive case summary.\n\n${JSON.stringify(inputData, null, 2)}`,
      },
    ],
    parse: (raw) => {
      const rawPriorTreatment = (raw.prior_treatment as Record<string, unknown>) || {}
      const rawSymptomsTimeline = (raw.symptoms_timeline as Record<string, unknown>) || {}

      const rawTotalVisits = rawPriorTreatment?.total_visits
      const normalizedTotalVisits = normalizeNullString(rawTotalVisits)
      const coercedTotalVisits = normalizedTotalVisits === null
        ? null
        : Number(normalizedTotalVisits)

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
          ['icd10_code', 'supporting_evidence', 'downgrade_to'],
        ),
      }

      const validated = caseSummaryResultSchema.safeParse(normalized)
      return validated.success
        ? { success: true, data: validated.data }
        : { success: false, error: validated.error }
    },
  })
}
