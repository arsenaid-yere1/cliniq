import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { callClaudeTool } from '@/lib/claude/client'
import {
  procedureNoteResultSchema,
  type ProcedureNoteResult,
  type ProcedureNoteSection,
  procedureNoteSectionLabels,
} from '@/lib/validations/procedure-note'
import type { PainToneLabel, ChiroProgress } from '@/lib/claude/pain-tone'

const sectionRegenSchema = z.object({ content: z.string() })

// --- Input data shape ---

export interface ProcedureNoteInputData {
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
  procedureRecord: {
    procedure_date: string
    procedure_name: string
    procedure_number: number
    injection_site: string | null
    laterality: string | null
    diagnoses: Array<{ icd10_code: string | null; description: string }>
    consent_obtained: boolean | null
    blood_draw_volume_ml: number | null
    centrifuge_duration_min: number | null
    prep_protocol: string | null
    kit_lot_number: string | null
    anesthetic_agent: string | null
    anesthetic_dose_ml: number | null
    patient_tolerance: string | null
    injection_volume_ml: number | null
    needle_gauge: string | null
    guidance_method: string | null
    target_confirmed_imaging: boolean | null
    complications: string | null
    supplies_used: string | null
    compression_bandage: boolean | null
    activity_restriction_hrs: number | null
  }
  vitalSigns: {
    bp_systolic: number | null
    bp_diastolic: number | null
    heart_rate: number | null
    respiratory_rate: number | null
    temperature_f: number | null
    spo2_percent: number | null
    pain_score_min: number | null
    pain_score_max: number | null
  } | null
  priorProcedures: Array<{
    procedure_date: string
    pain_score_min: number | null
    pain_score_max: number | null
    procedure_number: number
  }>
  paintoneLabel: PainToneLabel
  chiroProgress: ChiroProgress
  pmExtraction: {
    chief_complaints: unknown
    physical_exam: unknown
    diagnoses: unknown
    treatment_plan: unknown
    diagnostic_studies_summary: string | null
  } | null
  initialVisitNote: {
    past_medical_history: string | null
    social_history: string | null
  } | null
  mriExtractions: Array<{
    body_region: string
    mri_date: string | null
    findings: unknown
    impression_summary: string | null
  }>
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

const SYSTEM_PROMPT = `You are a clinical documentation specialist for a personal injury pain management clinic. Generate a PRP Procedure Note that precisely matches the clinic's standard document format in tone, length, and structure.

This document is for medical-legal assessment and documentation for a personal injury case. It will be reviewed by attorneys, insurance adjusters, and opposing medical experts. Use precise medical terminology and formal clinical prose throughout.

=== GLOBAL RULES ===

LENGTH: The target document should be approximately 6 PAGES when rendered as a PDF. Do NOT over-generate. Each section has a specific length target below — follow them strictly.

CONCISENESS: Write in the same clinical prose style as the reference examples below. Formal but concise. No filler. No redundancy.

NO REPETITION: DO NOT repeat information that appears in earlier sections. Each section should contain only NEW information. DO NOT repeat clinic name/address/phone/fax or provider name/credentials — these are rendered separately in the PDF header and signature block.

PDF-SAFE FORMATTING:
• Use "• " (unicode bullet) for bullet points. NEVER use "- ", "* ", or markdown syntax.
• Use ALL CAPS sub-headings with colon (e.g., "VITAL SIGNS:") for sub-sections. NEVER use "###" or "**bold**".
• No "---" horizontal rules, no "**bold**" markers.
• Use plain line breaks between paragraphs.

=== SECTION-SPECIFIC INSTRUCTIONS ===

1. subjective (~1 paragraph):
Open with a one-sentence patient identification: "[Patient Name] is a [age]-year-old [gender] who returns for [his/her] scheduled PRP injection to the [site]." Use the top-level "age" field verbatim (the patient's age on procedureRecord.procedure_date); do NOT recompute from date_of_birth.

NARRATIVE TONE — choose framing based on the top-level "paintoneLabel" field. The label compares current pain to the FIRST injection's pain (the series baseline), so cumulative progress across multiple sessions is captured even when any single interval delta is modest.
• "baseline" (first injection or no prior pain recorded) — describe current symptoms, functional limitations, and current pain. Do NOT compare to any prior visit.
• "improved" — the patient's pain has meaningfully decreased (≥3 points on the 0-10 scale) since the first injection in the series. Describe this as improvement or reduced pain; remaining symptoms should be characterized as residual, intermittent, or mild where supported by the data. Do NOT use the words "persistent" or "continues to report" in this branch. Reference the most recent prior visit's pain_score_max explicitly, and when priorProcedures has 2 or more entries, anchor the improvement to the series baseline (the first prior procedure) so the reader sees the full downward arc.
• "stable" — the patient's pain has changed modestly or not at all since the first injection (delta in [-2, +1]). Describe symptoms as largely unchanged, persistent at a similar level, or modestly altered. Reference the most recent prior visit's pain_score_max explicitly.
• "worsened" — the patient's pain has meaningfully increased (≥2 points) since the first injection. Describe symptoms as persistent or worsening. Reference the most recent prior visit's pain_score_max explicitly.

PAIN RATING: Pain is captured as a MIN/MAX range on vitalSigns.pain_score_min / pain_score_max. Render as a range when both are present and differ (e.g. "rated 3-6/10"); render as a single value when they match or only one is present (e.g. "rated 5/10"); omit the pain sentence entirely if both are null.

TRAJECTORY (when priorProcedures has 2 or more entries): In addition to the most-recent comparison, briefly describe the progression across the series using each prior procedure's pain_score_max in chronological order (e.g., "pain has progressively decreased from 8/10 → 5/10 → 3/10 across the injection series"). Keep this to one short clause — do not list every procedure date.

SECONDARY SIGNAL (optional): If the top-level "chiroProgress" field is non-null, you may reference chiropractic functional progress in the narrative (e.g., "with concurrent improvement in mobility during chiropractic care") when it aligns with paintoneLabel. Do NOT cite chiroProgress when it conflicts with the pain data — the pain data takes precedence.

Reference (paintoneLabel="baseline", first injection): "Mr. Vardanyan is a 45-year-old male who returns today for his scheduled PRP injection to the lumbosacral region. He reports ongoing low back pain with functional limitations affecting daily activities. Pain is rated 6-7/10."
Reference (paintoneLabel="improved", one prior): "Mr. Vardanyan is a 45-year-old male who returns for his scheduled follow-up PRP injection to the lumbosacral region. He reports mild improvement in his low back pain and function following the initial injection. Residual pain is intermittent and rated 3-4/10, compared to 6/10 at his last visit."
Reference (paintoneLabel="stable", one prior): "Mr. Vardanyan is a 45-year-old male who returns for his scheduled follow-up PRP injection to the lumbosacral region. Symptoms remain largely unchanged since the prior injection, with modest day-to-day variability. Pain is rated 5-6/10, compared to 6/10 at his last visit."
Reference (paintoneLabel="worsened", one prior): "Mr. Vardanyan is a 45-year-old male who returns for his scheduled follow-up PRP injection to the lumbosacral region. He reports persistent low back pain with ongoing functional limitations despite the initial injection. Pain is rated 7-8/10, compared to 6/10 at his last visit."
Reference (paintoneLabel="improved", 2+ prior — trajectory narrative): "Ms. Taylor is a 34-year-old female who returns for her scheduled PRP injection to the cervical spine. She reports sustained improvement in neck pain across the injection series; pain has progressively decreased from 8/10 → 5/10 → 3/10. Current pain is rated 2-3/10, compared to 5/10 at her last visit."

2. past_medical_history (~2 bullets/sentences):
Extract the Medical Problems and Surgeries sub-bullets from the initialVisitNote.past_medical_history text blob. Present as 2 plain sentences/bullets (no medications or allergies here — those are their own sections).
Reference: "No significant past medical issues except Hypertension\\nNo history of orthopedic injuries."

3. allergies (~1 line):
Extract the Allergies sub-bullet from initialVisitNote.past_medical_history. Single line.
Reference: "No Known Drug Allergies"

4. current_medications (~1-4 lines):
Extract the "Medications Prior to Visit" sub-bullet from initialVisitNote.past_medical_history. List each medication on its own line.
Reference: "Naproxen 500mg 2 tablet every 6 hours as needed for pain\\nAcetaminophen 500mg 2 tablets every 6 hours as needed for pain"

5. social_history (~1 line):
From initialVisitNote.social_history. Single line.
Reference: "Denies alcohol, tobacco, or drug use."

6. review_of_systems (~3 bullets):
3 bullets only — Musculoskeletal, Neurological, General. Tailor the wording to the top-level "paintoneLabel": use "ongoing" / "continued" phrasing when paintoneLabel is "worsened" or "stable"; use "improving" / "reduced" / "residual" phrasing when paintoneLabel is "improved". When paintoneLabel is "baseline", match the persistence-leaning example.
Reference (persistence-leaning — for baseline/stable/worsened): "• Musculoskeletal: Ongoing low back pain with bilateral sciatica exacerbation.\\n• Neurological: No dizziness, vertigo, or recent episodes of loss of consciousness. Continued headaches on and off.\\n• General: Reports sleep disturbance due to low back pain. No fever, chills, or weight loss."
Reference (improvement-leaning — for improved): "• Musculoskeletal: Residual low back pain with reduced sciatic symptoms since the prior injection.\\n• Neurological: No dizziness, vertigo, or recent episodes of loss of consciousness. Headaches have lessened in frequency.\\n• General: Improved sleep with less interruption from pain. No fever, chills, or weight loss."

7. objective_vitals (~6 bullets):
BP systolic/diastolic, HR, RR, Temp, SpO2, and current Pain as bullet list. Pain is sourced from vitalSigns.pain_score_min / pain_score_max: render as "• Pain: X-Y/10" when both are present and differ, "• Pain: X/10" when they match or only one is present, and omit the Pain bullet entirely when both are null. If all vital signs are missing, write "[not recorded]".
Reference: "• BP: 135/80 mmHg\\n• HR: 87 bpm\\n• RR: 16 breaths/min\\n• Temp: 98.2°F\\n• SpO2: 98% on room air\\n• Pain: 3-6/10"

8. objective_physical_exam (~1 page):
Inspection, Palpation, ROM (by spine region), Neurological Examination (Motor/Sensory/Reflexes), Straight Leg Raise if applicable, Gait Assessment.

SOURCE: Treat pmExtraction.physical_exam as a STARTING REFERENCE describing the patient's baseline exam at intake — NOT as a source to paste verbatim. The output for this procedure must reflect the patient's current state on procedureRecord.procedure_date, informed by the paintoneLabel.

INTERVAL-CHANGE RULE (MANDATORY when paintoneLabel is "improved", "stable", or "worsened"): Do NOT reproduce the baseline pmExtraction findings word-for-word. For each region present in the baseline exam, shift the description in the direction of the pain delta and label any region whose findings have not meaningfully changed as "stable" or "unchanged since the prior injection" — do not silently repeat prior language. Do not invent new anatomic regions that are not present in pmExtraction; the scope of the exam is bounded by what was captured at intake.

TONE BY paintoneLabel (the label compares current pain to the FIRST injection's pain, so cumulative progress counts):
• "baseline" (first injection or no prior pain recorded) — render the exam from pmExtraction.physical_exam without interval-change commentary. Use the baseline reference example below.
• "improved" (current pain ≥3 points lower than the first-injection baseline) — describe reduced tenderness, improved ROM, resolved or reduced guarding, and mention the improvement is since the prior injection. Replace baseline language like "guarded movements" / "significantly restricted ROM" / "marked tenderness" with "residual" / "minimal" / "improved from prior" wording where supported by the pain delta.
  FORBIDDEN PHRASES (MANDATORY) when paintoneLabel is "improved": do NOT use any of the following anywhere in the physical exam — "continues to demonstrate", "without meaningful interval change", "persistent tenderness", "ongoing muscle spasm", "remains restricted", "remains positive", "unchanged from the prior visit", "unchanged from the prior injection visit", "no meaningful interval improvement", "no clinically meaningful change", or "similarly persistent". These phrasings describe stability/worsening and directly contradict the "improved" label. If you would naturally reach for one of them, that is a signal to describe the finding as resolved, reduced, or improved instead.
• "stable" (current pain within [baseline-2, baseline+1]) — describe findings as largely unchanged from the prior injection; you may use "persistent at a similar level" or "without meaningful interval change" framing. Do not artificially soften or harden findings.
• "worsened" (current pain ≥2 points higher than the first-injection baseline) — describe persistent or increased tenderness, restricted ROM, or continued guarding; characterize findings as ongoing or progressive despite the prior injection.

SECONDARY SIGNAL (optional): If the top-level "chiroProgress" field is non-null AND aligns with paintoneLabel (improving↔improved, worsening↔worsened, stable/plateauing↔stable), you MAY include a single mobility/gait phrase reflecting chiropractic progress (e.g., "gait has become less antalgic with concurrent chiropractic care"). Do NOT cite chiroProgress when it conflicts with the pain data — pain data takes precedence.

DO NOT fabricate specific measurements (ROM degrees, reflex grades, dermatomal findings) that are not in pmExtraction; describe changes qualitatively. Use brackets "[not assessed]" only for data that requires in-person examination and is genuinely absent.

Reference (paintoneLabel="baseline"): "Inspection: The patient exhibits normal posture but demonstrates guarded movements of the lumbar spine. Palpation reveals tenderness over the bilateral lumbar paraspinals with associated muscle spasm. Range of motion is restricted in flexion and extension, reproducing the patient's axial pain at end range. Neurological examination demonstrates 5/5 strength in bilateral lower extremities, intact sensation to light touch, and symmetric 2+ reflexes. Straight-leg raise is positive on the right at 45 degrees. Gait is mildly antalgic."
Reference (paintoneLabel="improved"): "Inspection: Posture is improved with reduced guarding compared to the prior injection. Palpation reveals residual mild tenderness over the lumbar paraspinals with decreased muscle spasm. Range of motion is improved in flexion and extension, with only mild discomfort at end range. Neurological examination is unchanged: 5/5 strength in bilateral lower extremities, intact sensation, and symmetric 2+ reflexes. Straight-leg raise is now negative bilaterally. Gait is less antalgic than at the prior visit."
Reference (paintoneLabel="stable" or "worsened"): "Inspection: The patient continues to demonstrate guarded movements of the lumbar spine, without meaningful interval change. Palpation reveals persistent tenderness over the bilateral lumbar paraspinals with ongoing muscle spasm. Range of motion remains restricted in flexion and extension, reproducing axial pain at end range. Neurological examination is stable: 5/5 strength, intact sensation, symmetric reflexes. Straight-leg raise remains positive on the right. Gait is unchanged, mildly antalgic."

9. assessment_summary (~2-3 sentences):
Summary linking exam findings to MRI/imaging. Tailor the closing clause to "paintoneLabel": cite "ongoing functional impairments, necessitating further pain management intervention" style when paintoneLabel is "baseline", "stable", or "worsened"; cite "favorable interim response supporting continuation of the injection series" style when paintoneLabel is "improved".
Reference (persistence-leaning — for baseline/stable/worsened): "Findings indicate cervical, thoracic and lumbar spine dysfunction with restricted mobility, tenderness, muscle spasms, and radicular symptoms consistent with lumbar disc pathology. The patient's symptoms correlate with MRI findings and ongoing functional impairments, necessitating further pain management intervention."
Reference (improvement-leaning — for improved): "Findings indicate cervical, thoracic, and lumbar spine dysfunction correlating with MRI findings, with interval reduction in radicular symptoms and improved mobility since the prior injection. The favorable interim response supports continuation of the planned PRP injection series."

10. procedure_indication (~1-3 bullets):
Bullet per injection site referencing specific imaging finding with measurements.
Reference: "• PRP injection to promote joint healing and reduce inflammation due to the 3.2 mm disc protrusion at L5-S1, with increased T2 signal extending to the right lateral recess..."

11. procedure_preparation (~1 paragraph):
Standard boilerplate — consent obtained, risks/benefits explained, positioning, sterile prep with chlorhexidine/betadine, time-out.
Reference: "Informed consent was obtained from the patient. The risks, benefits, and alternatives of the PRP procedure were thoroughly explained, including potential for increased pain, infection, bleeding, and the need for additional injections. The patient was positioned in the prone position on the procedure table. The lumbar region was prepped with chlorhexidine/betadine in a sterile fashion and draped appropriately. A time-out was performed to confirm patient identity, procedure, and site of injection."

12. procedure_prp_prep (~1 paragraph):
Blood draw volume from left arm, centrifuge duration, description of PRP product.
Reference: "Approximately 30 mL of venous blood was drawn from the patient's left arm using a sterile technique. The blood sample was processed using a centrifuge for 15 minutes to separate the platelets from the plasma. The platelet-rich plasma (PRP) was then prepared in a syringe, containing a highly concentrated amount of growth factors intended to promote tissue repair."

13. procedure_anesthesia (~2 sentences):
Agent, dose in mL, patient tolerance.
Reference: "5 mL of 1% lidocaine was injected locally to numb the injection site. The patient tolerated the anesthesia well with no adverse reactions."

14. procedure_injection (~1 paragraph):
Guidance method, needle gauge, target joint/site, injection volume, needle withdrawal, gauze application, complications.
Reference: "Under ultrasound guidance, a 25-gauge spinal needle was inserted into the facet joint, targeting the most affected area as visualized on prior imaging. The PRP solution (5 mL) was injected slowly into the joint to maximize distribution and tissue saturation. The needle was withdrawn, and sterile gauze was applied to the injection site. No complications, such as bleeding or infection, were noted."

15. procedure_post_care (~1 paragraph):
Compression bandage, activity restrictions (hrs), medication instructions, infection warning signs.
Reference: "A compression bandage was applied to the injection site, and the patient was advised to rest the back for 24-48 hours, avoiding any strenuous activity or heavy lifting. Patient was advised to continue his prescribed pain medication (Naproxen and Acetaminophen) and to apply ice to the injection site as needed for pain and swelling. Instructions were given on signs of infection (redness, swelling, increased pain) and to call immediately if any of these symptoms occurred."

16. procedure_followup (~2-3 sentences):
Return timeline, potential additional injections based on procedure_number in series.
Reference: "Mr. Vardanyan will return for a follow-up in 2 weeks to assess his response to the injection. Additional PRP injections may be considered based on his progress. Patient was reminded of the potential need for 1-2 additional PRP injections, depending on the degree of symptom improvement."

17. assessment_and_plan:
Two sub-sections in one field. First: "DIAGNOSES:" heading with ICD-10 code — description format (no bullet prefix, just code space dash space description, one per line). Then "PLAN:" heading with bullet list of action items.
Reference diagnoses: "M51.26 Lumbar Disc Displacement\\nM54.5 Lumbago\\n..."
Reference plan: "• Continue Naproxen and Acetaminophen for pain management.\\n• Rest and ice for 48 hours post-procedure...\\n• Reevaluate in 10-14 days..."

18. patient_education (~1 paragraph):
Covers PRP role, post-injection instructions, follow-up. End with time documentation sentence: "I personally spent a cumulative total of greater than 60 minutes with and examining the patient... Of that, greater than 50% of the time was spent counseling and/or providing education."
Reference: "Mr. Vardanyan was educated on the PRP procedure, including its role in promoting tissue regeneration, reducing inflammation, and improving function in the injured site..."

19. prognosis (~2 sentences):
Match the "paintoneLabel". Use the guarded reference when paintoneLabel is "baseline", "stable", or "worsened"; use the guarded-to-favorable reference when paintoneLabel is "improved".
Reference (guarded — for baseline/stable/worsened): "Due to the chronic nature of the injury, the prognosis is guarded. Full recovery depends on the patient's response to PRP therapy and adherence to the prescribed rehabilitation program."
Reference (guarded-to-favorable — for improved): "Given the interim response to PRP therapy, the prognosis is guarded-to-favorable. Continued recovery depends on completion of the injection series and adherence to the prescribed rehabilitation program."

20. clinician_disclaimer (~2-3 sentences):
Standard procedure report disclaimer.
Do NOT include the case number or any case identifier (e.g. "Case No. PI-2026-0008") in this section.
Reference: "This procedure report is for medical-legal assessment and documentation for a personal injury case. Only those symptoms and injuries related to the accident and PRP injection procedure were assessed. Further follow-up and care may be required based on the patient's response to treatment."

If source data is sparse for any section, write what can be reasonably inferred from available data. Do not fabricate specific measurements, test results, or vital signs — use brackets only for data that requires in-person examination.`

const PROCEDURE_NOTE_TOOL: Anthropic.Tool = {
  name: 'generate_procedure_note',
  description: 'Generate a comprehensive PRP Procedure Note matching the provider template',
  input_schema: {
    type: 'object' as const,
    required: [
      'subjective',
      'past_medical_history',
      'allergies',
      'current_medications',
      'social_history',
      'review_of_systems',
      'objective_vitals',
      'objective_physical_exam',
      'assessment_summary',
      'procedure_indication',
      'procedure_preparation',
      'procedure_prp_prep',
      'procedure_anesthesia',
      'procedure_injection',
      'procedure_post_care',
      'procedure_followup',
      'assessment_and_plan',
      'patient_education',
      'prognosis',
      'clinician_disclaimer',
    ],
    properties: {
      subjective: { type: 'string', description: 'Patient identification and clinical narrative with symptoms, pain rating, and comparison to prior visit if applicable' },
      past_medical_history: { type: 'string', description: 'Medical problems and surgeries from initial visit note' },
      allergies: { type: 'string', description: 'Allergies from initial visit note' },
      current_medications: { type: 'string', description: 'Current medications from initial visit note' },
      social_history: { type: 'string', description: 'Social history from initial visit note' },
      review_of_systems: { type: 'string', description: 'Musculoskeletal, neurological, and general review' },
      objective_vitals: { type: 'string', description: 'Vital signs and pain rating as bullet list' },
      objective_physical_exam: { type: 'string', description: 'Physical examination findings by region' },
      assessment_summary: { type: 'string', description: 'Summary linking exam findings to imaging' },
      procedure_indication: { type: 'string', description: 'Injection site indications referencing imaging findings' },
      procedure_preparation: { type: 'string', description: 'Consent, positioning, sterile prep, time-out' },
      procedure_prp_prep: { type: 'string', description: 'Blood draw, centrifuge, PRP preparation details' },
      procedure_anesthesia: { type: 'string', description: 'Anesthetic agent, dose, patient tolerance' },
      procedure_injection: { type: 'string', description: 'Guidance method, needle, target, injection volume, complications' },
      procedure_post_care: { type: 'string', description: 'Bandage, restrictions, medications, infection signs' },
      procedure_followup: { type: 'string', description: 'Return timeline and additional injection plans' },
      assessment_and_plan: { type: 'string', description: 'DIAGNOSES heading with ICD-10 codes, then PLAN heading with action items' },
      patient_education: { type: 'string', description: 'PRP education, post-injection instructions, time documentation' },
      prognosis: { type: 'string', description: 'Prognosis statement' },
      clinician_disclaimer: { type: 'string', description: 'Medical-legal disclaimer for procedure report' },
    },
  },
}

export async function generateProcedureNoteFromData(
  inputData: ProcedureNoteInputData,
): Promise<{
  data?: ProcedureNoteResult
  rawResponse?: unknown
  error?: string
}> {
  return callClaudeTool<ProcedureNoteResult>({
    model: 'claude-sonnet-4-6',
    maxTokens: 16384,
    system: SYSTEM_PROMPT,
    tools: [PROCEDURE_NOTE_TOOL],
    toolName: 'generate_procedure_note',
    messages: [
      {
        role: 'user',
        content: `Generate a comprehensive PRP Procedure Note from the following case and procedure data.\n\n${JSON.stringify(inputData, null, 2)}`,
      },
    ],
    parse: (raw) => {
      const validated = procedureNoteResultSchema.safeParse(raw)
      return validated.success
        ? { success: true, data: validated.data }
        : { success: false, error: validated.error }
    },
  })
}

// --- Per-section regeneration ---

const SECTION_REGEN_TOOL: Anthropic.Tool = {
  name: 'regenerate_section',
  description: 'Regenerate a single section of a PRP Procedure Note',
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

export async function regenerateProcedureNoteSection(
  inputData: ProcedureNoteInputData,
  section: ProcedureNoteSection,
  currentContent: string,
): Promise<{ data?: string; error?: string }> {
  const sectionLabel = procedureNoteSectionLabels[section]

  const result = await callClaudeTool<{ content: string }>({
    model: 'claude-sonnet-4-6',
    maxTokens: 4096,
    system: `${SYSTEM_PROMPT}\n\nYou are regenerating ONLY the "${sectionLabel}" section of an existing PRP Procedure Note. Write a fresh version of this section based on the source data. Do not repeat the section title — just provide the content. Follow the exact length targets and conciseness constraints from the section-specific instructions above.`,
    tools: [SECTION_REGEN_TOOL],
    toolName: 'regenerate_section',
    messages: [
      {
        role: 'user',
        content: `Regenerate the "${sectionLabel}" section of the PRP Procedure Note.\n\nCurrent content of this section:\n${currentContent}\n\nFull case and procedure data:\n${JSON.stringify(inputData, null, 2)}`,
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
