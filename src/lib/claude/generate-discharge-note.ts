import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { callClaudeTool } from '@/lib/claude/client'
import {
  dischargeNoteResultSchema,
  type DischargeNoteResult,
  type DischargeNoteSection,
  dischargeNoteSectionLabels,
} from '@/lib/validations/discharge-note'

const sectionRegenSchema = z.object({ content: z.string() })

// --- Input data shape ---

export interface DischargeNoteInputData {
  patientInfo: {
    first_name: string
    last_name: string
    date_of_birth: string | null
    gender: string | null
  }
  age: number | null
  caseDetails: {
    case_number: string
    accident_date: string | null
    accident_type: string | null
  }
  visitDate: string
  procedures: Array<{
    procedure_date: string
    procedure_name: string
    procedure_number: number
    injection_site: string | null
    laterality: string | null
    pain_score_min: number | null
    pain_score_max: number | null
    diagnoses: Array<{ icd10_code: string | null; description: string }>
  }>
  latestVitals: {
    bp_systolic: number | null
    bp_diastolic: number | null
    heart_rate: number | null
    respiratory_rate: number | null
    temperature_f: number | null
    spo2_percent: number | null
    pain_score_min: number | null
    pain_score_max: number | null
  } | null
  // Provider-entered vitals captured AT the discharge follow-up visit.
  // When non-null, override the default `-2 from latestVitals.pain_score_max`
  // rule and use these values verbatim for the objective_vitals bullets and
  // as the pain-trajectory endpoint.
  dischargeVitals: {
    bp_systolic: number | null
    bp_diastolic: number | null
    heart_rate: number | null
    respiratory_rate: number | null
    temperature_f: number | null
    spo2_percent: number | null
    pain_score_min: number | null
    pain_score_max: number | null
  } | null
  baselinePain: {
    procedure_date: string
    pain_score_min: number | null
    pain_score_max: number | null
  } | null
  initialVisitBaseline: {
    chief_complaint: string | null
    physical_exam: string | null
  } | null
  overallPainTrend: 'baseline' | 'improved' | 'stable' | 'worsened'
  caseSummary: {
    chief_complaint: string | null
    imaging_findings: string | null
    prior_treatment: string | null
    symptoms_timeline: string | null
    suggested_diagnoses: unknown
  } | null
  initialVisitNote: {
    chief_complaint: string | null
    physical_exam: string | null
    assessment_and_plan: string | null
  } | null
  ptExtraction: {
    outcome_measures: unknown
    short_term_goals: string | null
    long_term_goals: string | null
    clinical_impression: string | null
    prognosis: string | null
    diagnoses: unknown
  } | null
  pmExtraction: {
    chief_complaints: unknown
    physical_exam: unknown
    diagnoses: unknown
    treatment_plan: unknown
  } | null
  mriExtractions: Array<{
    body_region: string
    mri_date: string | null
    findings: unknown
    impression_summary: string | null
  }>
  chiroExtraction: {
    diagnoses: unknown
    treatment_modalities: unknown
    functional_outcomes: unknown
    plateau_statement: string | null
  } | null
  clinicInfo: {
    clinic_name: string | null
    address_line1: string | null
    address_line2: string | null
    city: string | null
    state: string | null
    zip_code: string | null
    phone: string | null
    fax: string | null
  }
  providerInfo: {
    display_name: string | null
    credentials: string | null
    npi_number: string | null
  }
}

const SYSTEM_PROMPT = `You are a clinical documentation specialist for a personal injury pain management clinic. Generate a Final PRP Follow-Up and Discharge Visit note that precisely matches the clinic's standard document format in tone, length, and structure.

This document is for medical-legal documentation and continuity of care related exclusively to injuries sustained in a motor vehicle accident or other personal injury event. It will be reviewed by attorneys, insurance adjusters, and opposing medical experts. Use precise medical terminology and formal clinical prose throughout.

=== GLOBAL RULES ===

LENGTH: The target document should be approximately 4 PAGES when rendered as a PDF. Do NOT over-generate. Each section has a specific length target below — follow them strictly.

CONCISENESS: Write in the same clinical prose style as the reference examples below. Formal but concise. No filler. No redundancy.

NO REPETITION: DO NOT repeat information that appears in earlier sections. Each section should contain only NEW information. DO NOT repeat clinic name/address/phone/fax or provider name/credentials — these are rendered separately in the PDF header and signature block.

PDF-SAFE FORMATTING:
• Use "• " (unicode bullet) for bullet points. NEVER use "- ", "* ", or markdown syntax.
• Use ALL CAPS sub-headings with colon (e.g., "VITAL SIGNS:") for sub-sections. NEVER use "###" or "**bold**".
• No "---" horizontal rules, no "**bold**" markers.
• Use plain line breaks between paragraphs.

=== CONTEXT ===

This is a DISCHARGE note — the patient has COMPLETED their PRP treatment series and is being evaluated for discharge from active interventional pain management care. The tone should reflect completion, improvement, and forward-looking recommendations. Summarize the entire treatment course and outcomes.

=== PAIN TRAJECTORY (MANDATORY) ===

A discharge note MUST demonstrate that pain decreased over the treatment course AND continued to improve between the final injection and today's discharge follow-up visit. You are provided:
• "baselinePain" — the pain range recorded at the FIRST procedure (pre-treatment anchor).
• "initialVisitBaseline.chief_complaint" — intake narrative, often referencing the original pain rating before any PRP.
• "procedures[]" — every procedure in chronological order, each with its own pain_score_min/max. The LAST element is the final injection (NOT the discharge visit).
• "latestVitals.pain_score_min/max" — vitals from the LAST procedure (final injection), not from today's discharge visit. These are your reference ceiling for the discharge reading.
• "dischargeVitals" — provider-entered vitals recorded AT the discharge follow-up visit. When non-null, these REPLACE all default vitals rendering and override the pain-delta defaults below.
• "overallPainTrend" — the computed label comparing last procedure pain to first procedure pain.

PROVIDER-ENTERED DISCHARGE VITALS (highest priority):
• If \`dischargeVitals\` is non-null, render \`objective_vitals\` bullets DIRECTLY from \`dischargeVitals\` (skip the -2 default). Omit any bullet whose field is null. The Pain bullet uses \`dischargeVitals.pain_score_min/max\` verbatim.
• If \`dischargeVitals\` is non-null, the numeric endpoint cited in \`subjective\`, \`assessment\`, and \`prognosis\` MUST be \`dischargeVitals.pain_score_max\` (or the range when min/max differ). Do NOT apply the -2 rule.
• If \`dischargeVitals\` is null, fall back to the -2 default rules below.

RULES (apply when \`dischargeVitals\` is null):
• The discharge follow-up visit is a separate encounter occurring AFTER the final injection. Patients reliably report continued improvement between the final PRP injection and this follow-up. You MUST render a discharge-visit pain reading that is **2 points BELOW** \`latestVitals.pain_score_max\` by default, floored at 0. A 1-point drop is ONLY permitted when a 2-point drop would go below 0 (i.e., when \`latestVitals.pain_score_max\` is 1, the discharge reading is 0; when it is 2, the discharge reading is 0; when min/max differ, apply -2 to both endpoints and floor). Examples: last procedure pain 3-4/10 → discharge visit 1-2/10. Last procedure pain 3/10 → discharge visit 1/10. Last procedure pain 2/10 → discharge visit 0/10. Last procedure pain 0-1/10 → discharge visit 0/10. This is the ONE exception to the "don't invent numbers" rule — it reflects expected post-injection healing and is scoped strictly to the discharge-visit pain endpoint.
• In \`subjective\`, you MUST explicitly narrate the downward trajectory ending at today's discharge reading (not at the last procedure). Format: "pain has decreased from X/10 at the initial evaluation to Z/10 at today's discharge visit", where Z is 2 points below the last procedure's pain_score_max (floored at 0; 1-point drop only when a 2-point drop would floor below 0). When more than 2 procedures exist, render the full series and terminate at the discharge reading (e.g., "8/10 → 6/10 → 4/10 → 3/10 across the injection series, and has further improved to 1/10 at today's discharge evaluation").
• Render pain ranges when min/max differ (e.g., "6-7/10"); single value when they match or only one is present.
• In \`objective_vitals\`, the Pain bullet reflects the discharge-visit reading (2 points below \`latestVitals.pain_score_max\` by default, floored at 0), NOT \`latestVitals\` directly.
• In \`assessment\`, reinforce the measurable pain reduction citing baseline → discharge-visit numeric delta (e.g., "a reduction from 7/10 at baseline to 1/10 at today's discharge evaluation").
• In \`prognosis\`, tie the favorable outlook to the demonstrated numeric improvement, ending at the discharge-visit reading.
• If "overallPainTrend" is "stable" or "worsened", DO NOT fabricate improvement — the post-procedure -2 delta rule does NOT apply. Describe the actual course honestly. This should be rare for a discharge note; if source data shows no improvement, write the narrative truthfully rather than forcing an optimistic framing.
• If "overallPainTrend" is "baseline" (only one procedure, or pain data missing), fall back to narrative comparison using "initialVisitBaseline.chief_complaint" if it contains a pre-treatment pain descriptor; otherwise describe current status without fabricating a delta.
• Outside of the scoped post-procedure improvement described above, never invent pain numbers that are not in the source data.

=== SECTION-SPECIFIC INSTRUCTIONS ===

1. subjective (~3 paragraphs):
Post-PRP follow-up narrative. Describe the patient's self-reported improvement since completing PRP treatment. MUST include the explicit pain trajectory per the PAIN TRAJECTORY rules above, ending at the discharge-visit reading (2 points below last procedure's pain_score_max, floored at 0).
Para 1: Opening sentence identifying patient, age (use the top-level "age" field verbatim — the patient's age on visitDate; do NOT recompute from date_of_birth), presents for follow-up after completing PRP treatment to [sites] on [last procedure date]. Report sustained and progressive improvement in pain severity, functional capacity, and quality of life.
Para 2: Region-by-region symptom status — current pain rating at discharge, quality of remaining pain (mild stiffness vs sharp), improvement in mobility, resolution of radicular symptoms. REQUIRED: cite the pain trajectory using concrete numbers from baselinePain → each procedure → discharge-visit reading (e.g., "pain has decreased from 7-8/10 at the initial evaluation to 1-2/10 at today's discharge visit" — where last procedure pain was 3-4/10, apply the default -2 drop to get 1-2/10). When procedures[] has 3+ entries, render the full series terminating at the discharge reading (e.g., "8/10 → 6/10 → 4/10 → 3/10 across the injection series, and has further improved to 1/10 at today's discharge evaluation").
Para 3: Additional improvements — sleep quality, ADL function, denial of red-flag symptoms (bowel/bladder dysfunction, saddle anesthesia, gait instability, progressive weakness, new neurologic complaints, adverse effects from PRP). End with patient's overall assessment that PRP provided meaningful relief.
Reference: "Ms. Taylor Cook is a 21-year-old female who presents for a comprehensive follow-up evaluation after completing Platelet-Rich Plasma (PRP) treatment to the cervical and lumbar spine on October 13, 2025. She reports sustained and progressive improvement, with pain decreasing from 7/10 at her initial evaluation to 1/10 at today's discharge visit, reflecting continued healing since her final injection..."

2. objective_vitals (~6 bullets):
BP, HR, RR, Temp, SpO2, Pain.
PRIORITY 1 — If \`dischargeVitals\` is non-null: render EVERY bullet from \`dischargeVitals\` verbatim (omit each bullet whose field is null). Do NOT mix with \`latestVitals\`; do NOT apply the -2 rule.
PRIORITY 2 — If \`dischargeVitals\` is null: use \`latestVitals\` (the most recent procedure's vitals) for BP/HR/RR/Temp/SpO2; the Pain bullet is the discharge-visit estimate (2 points below \`latestVitals.pain_score_max\`, floored at 0). Render as "• Pain: X-Y/10" when rendering a range (e.g., last procedure 3-4/10 → "• Pain: 1-2/10"), "• Pain: X/10" when single value (e.g., last procedure 3/10 → "• Pain: 1/10"; last procedure 2/10 → "• Pain: 0/10"), and omit the Pain bullet entirely when both pain scores are null. If \`overallPainTrend\` is "stable" or "worsened", render \`latestVitals\` pain directly without the -2 delta. Use brackets for any other missing vital.
Reference: "• BP: 122/78 mmHg\\n• HR: 74 bpm\\n• RR: 15 breaths/min\\n• Temp: 98.1°F\\n• SpO₂: 98% on room air\\n• Pain: 1/10"

3. objective_general (~2-3 sentences):
General appearance. Alert, oriented, cooperative, no acute distress. Note improved posture and ease of movement compared to prior visits.
Reference: "The patient is alert, oriented to person, place, time, and situation, cooperative, and in no acute distress. She appears comfortable throughout the examination and demonstrates improved posture and ease of movement compared to prior visits."

4. objective_cervical (~3-4 sentences):
Cervical spine examination findings at discharge. Inspection, palpation (minimal residual findings), ROM (near full), negative provocative tests. Emphasize improvement from baseline.
Reference: "Inspection reveals no deformity, swelling, or muscle asymmetry. Palpation reveals minimal residual myofascial tightness over the cervical paraspinal musculature without focal tenderness or trigger points. Range of motion is near full in all planes, with only mild end-range stiffness and no reproduction of radicular symptoms. Spurling's maneuver is negative bilaterally."

5. objective_lumbar (~3-4 sentences):
Lumbar spine examination findings at discharge. Same structure as cervical — inspection, palpation, ROM, SLR. Emphasize improvement.
Reference: "Inspection shows normal spinal alignment. Palpation reveals minimal paraspinal tenderness at the lower lumbar levels without spasm. Forward flexion, extension, and rotation are performed with good tolerance and only mild tightness at end range. Straight-leg raise testing is negative bilaterally."

6. objective_neurological (~3-4 sentences):
Motor strength, sensation, reflexes, gait. All should be normal/intact at discharge.
Reference: "Motor strength is 5/5 throughout the upper and lower extremities. Sensation is intact to light touch and pinprick in all dermatomes. Deep tendon reflexes are 2+ and symmetric. Gait is steady and non-antalgic."

7. diagnoses (ICD-10 list):
List all diagnoses with ICD-10 codes. One per line, format: "• CODE – Description". Pull from procedure diagnoses, case summary, and PM extraction. Include all relevant codes from the treatment course.
Reference: "• G44.309 – Post-traumatic headaches\\n• M62.83 – Muscle spasm\\n• M54.22 – Cervicalgia\\n• S13.4XXA – Cervical sprain..."

8. assessment (~1 paragraph):
Clinical improvement summary. State sustained improvement following PRP treatment. Link pain reduction, functional restoration, and resolution of radicular features to favorable response to biologic regenerative therapy. REQUIRED: cite the numeric pain delta from baselinePain to the DISCHARGE-VISIT reading (2 points below \`latestVitals.pain_score_max\` by default, floored at 0), e.g., "a reduction from 7/10 at baseline to 1/10 at today's discharge evaluation". Note no treatment-related complications. Support stabilization and healing.
Reference: "The patient demonstrates sustained clinical improvement following completion of a PRP treatment to the cervical and lumbar spine, with pain scores decreasing from 7/10 at the initial evaluation to 1/10 at today's discharge evaluation. The degree of pain reduction, functional restoration, and resolution of radicular features is consistent with a favorable response to biologic regenerative therapy. There is no evidence of treatment-related complications. Current findings support stabilization and healing of the involved spinal structures."

9. plan_and_recommendations (~2-3 paragraphs):
Para 1: PRP therapy is complete, no additional injections indicated. Patient appropriate for discharge from active interventional pain management care.
Para 2: Advise structured home exercise/stretching program (cervical mobility, lumbar stabilization, core strengthening, postural alignment). Ergonomic awareness. OTC medications as needed.
Para 3: Return instructions — if symptoms recur, worsen, or new neurologic deficits develop, return for reevaluation. If conservative measures fail, further imaging, interventional options, or specialist referral may be considered.
Reference: "The PRP injection therapy is complete, and no additional PRP injections are indicated at this time..."

10. patient_education (~1 paragraph):
Detailed education on long-term recovery expectations, importance of continued rehab, activity modification, proper body mechanics. Red-flag symptoms counseling (worsening pain, numbness, weakness, gait changes, bowel/bladder dysfunction). Patient participation and understanding statement.
Reference: "The patient received detailed education regarding long-term recovery expectations following PRP therapy..."

11. prognosis (~2-3 sentences):
Favorable prognosis. Meaningful and sustained improvement in pain control, mobility, and functional capacity. Tie the outlook to the demonstrated numeric pain reduction across the treatment course, ending at the discharge-visit reading (2 points below \`latestVitals.pain_score_max\` by default, floored at 0). With continued adherence to conservative management, further improvement and long-term symptom control anticipated.
Reference: "The prognosis is favorable. The patient has demonstrated meaningful and sustained improvement in pain control — pain scores decreased from 7/10 at baseline to 1/10 at today's discharge evaluation — alongside restored mobility and functional capacity following PRP therapy. With continued adherence to conservative management strategies and ergonomic practices, further improvement and long-term symptom control are anticipated."

12. clinician_disclaimer (~2-3 sentences):
Medical-legal disclaimer. Report prepared for documentation and continuity of care related exclusively to injuries sustained in the accident on [date]. Does not constitute comprehensive general medical exam. Only relevant symptoms addressed. Closing pleasantry and contact instruction.
Reference: "This report is prepared for medical-legal documentation and continuity of care related exclusively to injuries sustained in the motor vehicle accident dated March 12, 2025..."

If source data is sparse for any section, write what can be reasonably inferred from available data. Do not fabricate specific measurements, test results, or vital signs — use brackets only for data that requires in-person examination.`

const DISCHARGE_NOTE_TOOL: Anthropic.Tool = {
  name: 'generate_discharge_note',
  description: 'Generate a comprehensive Final PRP Follow-Up and Discharge Visit note matching the provider template',
  input_schema: {
    type: 'object' as const,
    required: [
      'subjective',
      'objective_vitals',
      'objective_general',
      'objective_cervical',
      'objective_lumbar',
      'objective_neurological',
      'diagnoses',
      'assessment',
      'plan_and_recommendations',
      'patient_education',
      'prognosis',
      'clinician_disclaimer',
    ],
    properties: {
      subjective: { type: 'string', description: 'Post-PRP follow-up narrative with improvement report' },
      objective_vitals: { type: 'string', description: 'Vital signs and pain rating as bullet list' },
      objective_general: { type: 'string', description: 'General appearance findings' },
      objective_cervical: { type: 'string', description: 'Cervical spine examination findings at discharge' },
      objective_lumbar: { type: 'string', description: 'Lumbar spine examination findings at discharge' },
      objective_neurological: { type: 'string', description: 'Neurological examination findings' },
      diagnoses: { type: 'string', description: 'ICD-10 codes with descriptions, one per line' },
      assessment: { type: 'string', description: 'Clinical improvement summary' },
      plan_and_recommendations: { type: 'string', description: 'Discharge recommendations and return instructions' },
      patient_education: { type: 'string', description: 'Long-term recovery education and red-flag counseling' },
      prognosis: { type: 'string', description: 'Prognosis statement' },
      clinician_disclaimer: { type: 'string', description: 'Medical-legal disclaimer for discharge report' },
    },
  },
}

export async function generateDischargeNoteFromData(
  inputData: DischargeNoteInputData,
): Promise<{
  data?: DischargeNoteResult
  rawResponse?: unknown
  error?: string
}> {
  return callClaudeTool<DischargeNoteResult>({
    model: 'claude-opus-4-7',
    maxTokens: 16384,
    system: SYSTEM_PROMPT,
    tools: [DISCHARGE_NOTE_TOOL],
    toolName: 'generate_discharge_note',
    messages: [
      {
        role: 'user',
        content: `Generate a Final PRP Follow-Up and Discharge Visit note from the following aggregated case data.\n\n${JSON.stringify(inputData, null, 2)}`,
      },
    ],
    parse: (raw) => {
      const validated = dischargeNoteResultSchema.safeParse(raw)
      return validated.success
        ? { success: true, data: validated.data }
        : { success: false, error: validated.error }
    },
  })
}

// --- Per-section regeneration ---

const SECTION_REGEN_TOOL: Anthropic.Tool = {
  name: 'regenerate_section',
  description: 'Regenerate a single section of a Discharge Note',
  input_schema: {
    type: 'object' as const,
    required: ['content'],
    properties: {
      content: {
        type: 'string',
        description: 'The regenerated section content',
      },
    },
  },
}

export async function regenerateDischargeNoteSection(
  inputData: DischargeNoteInputData,
  section: DischargeNoteSection,
  currentContent: string,
): Promise<{ data?: string; error?: string }> {
  const sectionLabel = dischargeNoteSectionLabels[section]

  const result = await callClaudeTool<{ content: string }>({
    model: 'claude-opus-4-7',
    maxTokens: 4096,
    system: `${SYSTEM_PROMPT}\n\nYou are regenerating ONLY the "${sectionLabel}" section of an existing Discharge Note. Write a fresh version of this section based on the source data. Do not repeat the section title — just provide the content. Follow the exact length targets and conciseness constraints from the section-specific instructions above.`,
    tools: [SECTION_REGEN_TOOL],
    toolName: 'regenerate_section',
    messages: [
      {
        role: 'user',
        content: `Regenerate the "${sectionLabel}" section of the Discharge Note.\n\nCurrent content of this section:\n${currentContent}\n\nFull aggregated case data:\n${JSON.stringify(inputData, null, 2)}`,
      },
    ],
    parse: (raw) => {
      const validated = sectionRegenSchema.safeParse(raw)
      return validated.success
        ? { success: true, data: validated.data }
        : { success: false, error: validated.error }
    },
  })

  if (result.error) return { error: result.error }
  return { data: result.data!.content }
}
