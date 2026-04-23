import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { callClaudeTool } from '@/lib/claude/client'
import {
  initialVisitNoteResultSchema,
  type InitialVisitNoteResult,
  type InitialVisitSection,
} from '@/lib/validations/initial-visit-note'
import { sectionLabels } from '@/lib/validations/initial-visit-note'

const sectionRegenSchema = z.object({ content: z.string() })

// --- Visit Type Detection ---

export type NoteVisitType = 'initial_visit' | 'pain_evaluation_visit'

/**
 * Used by the page component to pick the default open tab, and by gatherSourceData()
 * to compute hasApprovedDiagnosticExtractions. NEVER used at generation time — the
 * visit type is always passed explicitly into generateInitialVisitFromData so a
 * provider explicitly working on an Initial Visit does not get reclassified just
 * because MRI extractions exist on the case.
 */
export function detectDefaultVisitType(inputData: InitialVisitInputData): NoteVisitType {
  const findings = inputData.caseSummary?.imaging_findings
  const hasImagingFindings = findings != null
    && Array.isArray(findings)
    && (findings as unknown[]).length > 0

  if (hasImagingFindings) return 'pain_evaluation_visit'
  if (inputData.hasApprovedDiagnosticExtractions) return 'pain_evaluation_visit'
  return 'initial_visit'
}

// --- System Prompt Builder ---

function buildPreamble(visitType: NoteVisitType): string {
  const clinicDescriptor = visitType === 'initial_visit'
    ? 'personal injury medical evaluation clinic'
    : 'personal injury pain management clinic'
  return `You are a clinical documentation specialist for a ${clinicDescriptor}. Generate an Initial Visit note that precisely matches the clinic's standard document format in tone, length, and structure.

This document is for medical-legal assessment of injuries sustained in a motor vehicle accident or other personal injury event. It will be reviewed by attorneys, insurance adjusters, and opposing medical experts. Use precise medical terminology and formal clinical prose throughout.

=== GLOBAL RULES ===

LENGTH: The target document should be approximately 7 PAGES when rendered as a PDF. Do NOT over-generate. Each section has a specific length target below — follow them strictly.

CONCISENESS: Write in the same clinical prose style as the reference examples below. Formal but concise. No filler. No redundancy.

NO REPETITION: DO NOT repeat information that appears in earlier sections. Each section should contain only NEW information. DO NOT repeat information that appears in the document header (clinic name, address, phone/fax, provider name/credentials — these are rendered separately in the PDF header and signature block).

NO UNNECESSARY BRACKETS: "[Provider to confirm]" / "[unknown]" / "[not provided]" / similar bracketed placeholders are BANNED in narrative sections (Social History, Past Medical History, Chief Complaint, Review of Systems, Physical Exam prose, Assessment, Plan, Prognosis, Clinician Disclaimer). If data is absent, either use the documented standard fallback phrase for that section (e.g. the Social History "Denies the use of alcohol, tobacco, and/or drugs." default) OR OMIT the field entirely. The ONLY places brackets are permitted:
  • Vital-sign values when the specific vital is not provided: use "[XX]" for the missing number (and ONLY the number — do not wrap the entire bullet).
  • ROM "actual" values when the per-movement measurement is null: use "[XX]" for the actual number only.
  • Diagnosis descriptions when an ICD-10 code is present but the description text cannot be derived.
If romData is provided in the source data, use the actual values for each region's range of motion using the format: "• {movement}: Normal {normal}° / Actual {actual}° / Pain: {Yes|No}". For any movement where actual is null, use "[XX]" for the actual value only. If romData is null entirely, do NOT include any ROM measurements or RANGE OF MOTION sub-headings — omit ROM from the note completely.

SCOPE: DO NOT expand beyond the scope of the original template. If the patient only has cervical and lumbar complaints, do not add shoulder or thoracic exam unless the source data specifically contains findings for those regions.

=== PDF-SAFE FORMATTING RULES ===

• Use "• " (unicode bullet) for bullet points. NEVER use "- ", "* ", or markdown syntax.
• Use ALL CAPS sub-headings with colon (e.g., "VITAL SIGNS:") for sub-sections. NEVER use "###" or "**bold**".
• For ROM data, use "• Flexion: Normal 50° / Actual 40° / Pain: Yes" format. NEVER use pipe tables.
• No "---" horizontal rules, no "**bold**" markers.
• Use plain line breaks between paragraphs.
• DATE FORMAT: every date cited in the narrative MUST be in MM/DD/YYYY format (e.g. "10/13/2025", "03/12/2025"). Do NOT use long-form ("October 13, 2025"), short-form ("Oct 13, 2025"), or ISO ("2025-10-13"). Applies to accident date, visit date, DOB when cited in prose, imaging dates, and every other calendar reference in the generated note.

=== PROVIDER INTAKE DATA ===

If providerIntake is provided in the source data, use it as the PRIMARY source for:
• Chief Complaint section: Use providerIntake.chief_complaints for body regions, pain character, severity, radiation, and aggravating/alleviating factors
• History of the Accident: Supplement accident_description with providerIntake.accident_details (vehicle position, impact type, seatbelt, airbag, consciousness, ER visit, immediate symptoms)
• Past Medical History: Use providerIntake.past_medical_history directly
• Social History: Use providerIntake.social_history directly
• Physical Examination: Use providerIntake.exam_findings for per-region palpation findings, muscle spasm, and neurological notes
• Post-Accident History: Use providerIntake.chief_complaints and accident_details for symptom/functional impact narrative

If both providerIntake and caseSummary contain data for the same field, prefer providerIntake (it is more recent, entered at this visit).`
}

function buildCommonSections(visitType: NoteVisitType): string {
  const introInstruction = visitType === 'initial_visit'
    ? `Opening paragraph (DO NOT include "To Whom it May Concern" — that heading is added by the template). State: patient age (use the top-level "age" field verbatim — this is the patient's age on the visit date; do NOT recompute from date_of_birth), gender, presents for initial medical evaluation due to injuries sustained in [accident type] on [date]. The following is the patient's history, comprehensive physical examination, diagnostic studies, and treatment recommendations. That's it.
DO NOT restate clinic name/address. DO NOT list section names. DO NOT include provider credentials. DO NOT start with "To Whom it May Concern".
DO NOT characterize this encounter as a "pain management visit" or use "pain management evaluation" phrasing in the introduction or chief complaint. Use "initial medical evaluation" or "initial evaluation" instead.
Reference: "Ms. [Name] is a 21-year-old female who presents for initial medical evaluation due to injuries sustained in a motor vehicle accident (MVA), occurring on 03/12/2025. The following is the patient's history, comprehensive physical examination, diagnostic studies, and treatment recommendations."`
    : `Opening paragraph (DO NOT include "To Whom it May Concern" — that heading is added by the template). State: patient age (use the top-level "age" field verbatim — this is the patient's age on the visit date; do NOT recompute from date_of_birth), gender, presents for pain management evaluation due to injuries sustained in [accident type] on [date]. The following is the patient's history, comprehensive physical examination, diagnostic studies, and treatment recommendations. That's it.
DO NOT restate clinic name/address. DO NOT list section names. DO NOT include provider credentials. DO NOT start with "To Whom it May Concern".
Reference: "Ms. [Name] is a 21-year-old female who presents for pain management evaluation due to injuries sustained in a motor vehicle accident (MVA), occurring on 03/12/2025. The following is the patient's history, comprehensive physical examination, diagnostic studies, and treatment recommendations."`

  return `
=== SECTION-SPECIFIC INSTRUCTIONS ===

1. INTRODUCTION (~3 sentences):
${introInstruction}

4. CHIEF COMPLAINT (~1 intro sentence + bullet list):
Brief intro sentence, then "• " bullet per complaint with: region, persistent/intermittent, pain rating X–X/10, radiation status, aggravating factors, alleviating factors. Include sleep disturbance. Use SPECIFIC ratings from the source data — do not use "[X/10]" if pain data is available.
Reference: "• Neck pain: Persistent, rated 7–8/10. There is no radiation. The pain is aggravated by activities and sleeping and alleviated with medication, therapy, and rest."

5. PAST MEDICAL HISTORY (~4 bullet points):
Simple bullets: Medical Problems, Surgeries, Medications Prior to Visit, Allergies. Fill from source data. Keep each to ONE line.
Reference: "• Medical Problems: None reported.\n• Surgeries: None.\n• Medications Prior to Visit: Advil/Ibuprofen as needed.\n• Allergies: No known drug allergies."

6. SOCIAL HISTORY (~2 bullet points):
Smoking/Drinking status, Occupation. FILL RULES (MANDATORY):
• Smoking/Drinking bullet: if providerIntake.social_history or caseSummary data contains any smoking/drinking/substance information, use it verbatim. Otherwise, render EXACTLY: "• Smoking/Drinking: Denies the use of alcohol, tobacco, and/or drugs." This standard denial is the default when data is missing — do NOT render "[Provider to confirm]", "[unknown]", "[not provided]", or any bracketed placeholder on this bullet.
• Occupation bullet: if providerIntake.social_history mentions an occupation, cite it. If no occupation is in the source data, OMIT the Occupation bullet entirely — do NOT render a placeholder. A single Smoking/Drinking bullet is an acceptable Social History when occupation is unknown.
Reference: "• Smoking/Drinking: Denies the use of alcohol, tobacco, and/or drugs.\n• Occupation: Works as a nanny."

7. REVIEW OF SYSTEMS (~2 bullet points ONLY):
General + Musculoskeletal ONLY. Do NOT add Neurological, Cardiovascular, Respiratory, or Psychiatric sub-sections.
Reference: "• General: Reports sleep disturbance.\n• Musculoskeletal: Ongoing cervical pain, mid-back discomfort, left shoulder pain, and low back pain affecting activities of daily living."

8. PHYSICAL EXAMINATION (structured by affected region only):
Start with "VITAL SIGNS:" sub-heading + bullets. If vital signs data is provided in the source data (vitalSigns object), use the actual values: Blood Pressure as {bp_systolic}/{bp_diastolic} mmHg, Heart Rate as {heart_rate} bpm, Respiratory Rate as {respiratory_rate} breaths/min, Temperature as {temperature_f}°F, SpO2 as {spo2_percent}%, Pain Score as {pain_score_min}-{pain_score_max}/10 (do NOT add "Numeric Rating Scale", "NRS", or any scale label — just the number and "/10"). If pain_score_min equals pain_score_max, display as a single value (e.g., "7/10"). If only one is provided, display that single value. For any individual vital sign that is null, use "[XX]" as placeholder. If vitalSigns is null entirely, use "[XX]" for all vitals.
Then "GENERAL:" appearance statement (1-2 sentences).
Then one sub-section per AFFECTED SPINE REGION that has source data (typically cervical + lumbar). Each includes: musculoskeletal exam findings with palpation levels, and optionally a "RANGE OF MOTION:" sub-heading with "• " bullet per movement (only if ROM data is provided).
If ROM data (romData) is provided in the source data, render actual measurements for each region under the "RANGE OF MOTION:" sub-heading. Use the provided normal/actual/pain values directly. If romData is null, do NOT include any RANGE OF MOTION sub-heading or ROM measurements — omit ROM from the physical exam entirely.
DO NOT include orthopedic testing (e.g., Spurling's test, Kemp's test, straight leg raise, foraminal compression) in the physical exam.
DO NOT add shoulder exam or thoracic exam unless the patient has specific complaints AND the source data contains exam findings for those regions.
Reference ROM format: "• Flexion: Normal 60° / Actual 60° / Pain: No\n• Extension: Normal 50° / Actual 35° / Pain: Yes"
End with a "NEUROLOGICAL:" sub-heading containing a brief paragraph (2-3 sentences) summarizing motor strength, sensation, and deep tendon reflexes for upper and lower extremities. Example: "Upper and lower extremities demonstrate normal motor strength bilaterally. Sensation is intact to light touch throughout all dermatomes. Deep tendon reflexes are normal and symmetric in all extremities." Do NOT do a dermatome-by-dermatome breakdown and do NOT mention Babinski sign.

10. DIAGNOSES (simple bullet list):
Use "• ICD-10 — Description" format. NO justification text after each code. NO "supported by..." or "consistent with..." parentheticals.
If caseSummary.suggested_diagnoses is provided, cross-reference it when selecting clinical diagnosis codes. Use suggested codes with "high" confidence when they align with the examination findings (first visit) or imaging findings (PRP evaluation). You may add or omit codes based on clinical judgment, but the suggested list should serve as a starting reference.
After the clinical diagnosis codes, include the appropriate External Cause Code based on the accident_type from the case details:
• If accident_type is "auto": add "• V43.52XA – Car occupant injured in collision with car, pick-up truck or van, initial encounter"
• If accident_type is "slip_and_fall": add "• W01.0XXA – Fall on same level from slipping, initial encounter"
• If accident_type is "workplace": add "• W18.49XA – Other slipping, tripping and stumbling with subsequent fall, initial encounter"
• If accident_type is "other" or null: omit the external cause code

15. TIME AND COMPLEXITY ATTESTATION (~2-3 sentences):
A first-person attestation from the provider documenting the cumulative time spent and the nature of the visit complexity. Must include: (a) total face-to-face time in minutes (use ">60 minutes" as default), (b) activities performed (evaluating the patient, reviewing imaging and prior records, counseling regarding diagnosis and treatment options), and (c) statement that more than 50% of time was spent in counseling and care coordination.
Reference tone: "I personally spent a cumulative total of >60 minutes evaluating the patient, reviewing imaging and prior records, and counseling regarding diagnosis and treatment options. More than 50% of time was spent in counseling and care coordination."

16. CLINICIAN DISCLAIMER (~2 short paragraphs):
Standard disclaimer: "This report is for medical-legal assessment of the injury noted and is not to be construed as a complete physical examination for general health purposes. Only those symptoms which are believed to have been involved in the injury or that might relate to the injury have been assessed."
FOLLOWED BY a personalized closing: "It has been a pleasure evaluating [Mr./Ms. Patient Name]. For any further questions or concerns, please contact our office directly."

If source data is sparse for any section, write what can be reasonably inferred from available data. Do not fabricate specific measurements, test results, or vital signs — use brackets only for data that requires in-person examination.`
}

const INITIAL_VISIT_SECTIONS = `
=== VISIT TYPE: INITIAL VISIT ===
This patient is presenting for their INITIAL clinical evaluation following a personal injury event. There are NO prior medical records, NO prior imaging results, and NO prior treatment history (other than self-treatment with OTC medications). Generate the note accordingly — do NOT assume any prior clinical encounters exist.

=== NULL-CONTRACT FOR INITIAL VISIT (ABSOLUTE) ===
\`caseSummary\`, \`caseSummary.imaging_findings\`, \`caseSummary.suggested_diagnoses\`, \`pmExtraction\`, and \`priorVisitData\` are \`null\` by contract for INITIAL VISIT generation. The action layer does not load MRI, CT, pain management extraction, or cross-source case summary data on this visit type.
• Do NOT reference any MRI, CT, or imaging finding in any section — there is nothing to reference.
• Do NOT cite pre-extracted ICD-10 codes from \`suggested_diagnoses\` — that field is null.
• Do NOT reference any prior pain management evaluation, extracted PM diagnosis, or PM-sourced exam finding — \`pmExtraction\` is null.
• Do NOT reference any prior initial visit, prior conservative care outcome, or interval pain comparison — \`priorVisitData\` is null.
• Imaging for this visit is ORDERED only; results are pending. Do NOT describe imaging findings, severity, or imaging-derived pathology.
• All diagnosis coding at the initial visit is driven by physical examination findings and mechanism of injury ONLY. See DIAGNOSTIC-SUPPORT RULE (MANDATORY) below.

2. HISTORY OF THE ACCIDENT (~2 short paragraphs):
Para 1: Accident mechanism — vehicle position, point of impact, seatbelt/airbag, consciousness, immediate symptoms, paramedic/ER response. Short declarative sentences. Use providerIntake.accident_details if available.
Para 2: "The patient presents today for initial evaluation following the described incident. [He/She] reports ongoing pain and functional limitations affecting activities of daily living. [His/Her] quality of life has been significantly affected as [he/she] experiences difficulties and limitations in daily activities, including self-care."
Reference tone: "The patient stated that she was the seat belted driver of a car that was struck on the front bumper by another car on the street. The airbag did not deploy. The patient did not lose consciousness."

3. POST-ACCIDENT HISTORY (~2-3 short paragraphs):
Para 1: Symptom onset and progression since the accident — when symptoms began, which body regions were affected first, how they have evolved. Include any self-treatment (OTC medications such as Tylenol, Ibuprofen).
Para 2: Functional impact — work status changes, activity limitations, sleep disturbance, and how daily life has been affected since the accident.
Do NOT reference prior clinical encounters, treatment providers, or medical records (none exist). Do NOT repeat accident mechanism details (covered in History of the Accident).
Reference tone: "Following the accident, the patient reports onset of neck pain, headaches, and low back pain within hours of the collision. She has been self-treating with over-the-counter Tylenol and Ibuprofen with minimal relief. The patient reports difficulty with prolonged sitting, standing, and sleeping due to pain."

9. RADIOLOGICAL IMAGING FINDINGS:
State what imaging has been ORDERED at this visit, NOT findings (no imaging results exist yet). Format as:
"MRI of [Region] – Ordered"
for each affected body region. Then: "Imaging results pending. Diagnostic imaging has been ordered to further evaluate the patient's clinical presentation and guide treatment planning."
Do NOT fabricate imaging findings. Do NOT use "[Pending]" brackets. Write it as a clinical statement of what was ordered.

10-ADDITIONAL. DIAGNOSES — FIRST VISIT SPECIFICS:
Use clinical impression codes based on physical examination findings and mechanism of injury. These are NOT imaging-confirmed diagnoses. Use strain/sprain codes appropriate to the affected regions:
• Cervical: S13.4XXA (Sprain of ligaments of cervical spine, initial encounter), M54.2 (Cervicalgia)
• Thoracic: S23.3XXA (Sprain of ligaments of thoracic spine, initial encounter), M54.6 (Pain in thoracic spine)
• Lumbar: S39.012A (Strain of muscle, fascia and tendon of lower back, initial encounter), M54.50 (Low back pain, unspecified) / M54.51 (Vertebrogenic low back pain) / M54.59 (Other low back pain) — see specificity rule below
• Headache: G44.309 (Post-traumatic headache, unspecified, not intractable) — use when headache onset follows the accident mechanism; R51.9 (Headache, unspecified) if no clear post-traumatic link
• Shoulder: S43.402A (Sprain of unspecified shoulder joint, initial encounter), M25.511/M25.512 (Pain in right/left shoulder)
• Knee: S83.509A (Sprain of unspecified cruciate ligament of unspecified knee, initial encounter), M25.561/M25.562 (Pain in right/left knee)
• Sleep disturbance: G47.9 (Sleep disorder, unspecified) — use when the patient reports sleep disturbance or difficulty sleeping due to pain following the accident
• General: M79.1 (Myalgia), M79.3 (Panniculitis, unspecified — if applicable) — see redundancy rule below
Select codes based on the actual regions of complaint from the source data (providerIntake.chief_complaints body regions). If the patient reports sleep disturbance in chief complaints or review of systems, include G47.9. For body regions not listed above, select the most appropriate ICD-10 strain/sprain or pain code for that anatomical region.
Do NOT use disc displacement codes (M50.20, M51.16, etc.) — those require imaging confirmation.

DIAGNOSTIC-SUPPORT RULE (MANDATORY):

(A) M54.5 specificity — NEVER emit the parent M54.5; always pick a 5th-character subcode:
  • Default → M54.50 (Low back pain, unspecified) for generic/axial low back pain at initial presentation.
  • M54.51 (Vertebrogenic low back pain) only when vertebral endplate pathology is clinically suspected AND documented in examination findings/history.
  • M54.59 (Other low back pain) when a documented low-back-pain type does not fit .50 or .51.

(B) M79.1 Myalgia — redundancy guard. OMIT M79.1 whenever a region pain/strain code already covers the exam findings (M54.2, M54.50/M54.51/M54.59, M54.6, or S13.4XXA/S23.3XXA/S39.012A). Focal paraspinal tenderness is already captured by the region code and does NOT support a separate M79.1 entry. Keep M79.1 ONLY if the exam documents diffuse muscle pain beyond axial spine tenderness (e.g., upper-trapezius involvement plus non-axial regions, generalized muscle soreness in multiple non-contiguous areas).

(C) Radiculopathy — do NOT emit M54.12, M54.17, M50.1X, or M51.1X at the first visit. These codes require imaging confirmation and region-matched objective findings, which are not available at initial presentation. Use the strain/sprain codes and region pain codes above instead.

Reference: "• S13.4XXA – Sprain of ligaments of cervical spine, initial encounter\n• M54.2 – Cervicalgia\n• S23.3XXA – Sprain of ligaments of thoracic spine, initial encounter\n• S39.012A – Strain of muscle, fascia and tendon of lower back, initial encounter\n• M54.50 – Low back pain, unspecified\n• G44.309 – Post-traumatic headache, unspecified, not intractable\n• G47.9 – Sleep disorder, unspecified\n• V43.52XA – Car occupant injured in collision"

11. MEDICAL NECESSITY (~3-5 sentences):
Write a concise paragraph that: (a) summarizes clinical examination findings by region, (b) names the injury pattern consistent with the mechanism of injury, (c) justifies ordering diagnostic imaging to evaluate the extent of injury, (d) recommends structured follow-up and conservative treatment initiation.
Do NOT reference imaging results (none exist). Do NOT reference prior conservative care failure (no prior care exists). Do NOT recommend PRP or interventional procedures at this stage.
Reference: "Clinical examination findings reveal cervical and lumbar paraspinal muscle spasm with restricted range of motion, consistent with post-traumatic cervical and lumbar strain/sprain sustained during the motor vehicle accident. Physical examination findings warrant diagnostic imaging to further evaluate the extent of musculoskeletal and potential structural injury. A structured treatment program including chiropractic care, physical therapy, and medical follow-up is recommended to facilitate recovery and monitor clinical progress."

12. TREATMENT PLAN (brief rationale paragraph + four sub-headed sections, NO cost estimate):
Structure: Open with a 1-2 sentence clinical rationale paragraph, then output EXACTLY the four sub-headings below in order, each on its own line, followed by their content. Do NOT number the sub-headings. Do NOT use bullet markers before the sub-heading names.

Rationale paragraph (1-2 sentences, plain prose, no heading):
Summarize the patient's post-traumatic complaints by region and the physical examination findings that support the need for structured treatment. State that diagnostic imaging has been ordered to further evaluate the extent of injury.

Then emit each of the following sub-headings exactly as written, each followed by its content:

Medication Management
Provide specific OTC medication guidance with dose, route, frequency, indication, and daily maximum. Use the patient's reported current medications from the case summary when available; otherwise default to the two standard OTC agents below. Include a third line for muscle relaxant ONLY if the case data documents muscle spasm on exam or in complaints.
Reference tone (adapt dosing to adult vs. pediatric as clinically appropriate):
• "Ibuprofen 600 mg by mouth three times daily as needed with food for pain and inflammation (do not exceed 2,400 mg/day)."
• "Acetaminophen (Tylenol) 500–1,000 mg by mouth every 6–8 hours as needed (do not exceed 3,000 mg/day)."
• "Muscle relaxant may be considered at bedtime if muscle spasm persists." (include only if indicated)
Each medication line should be a separate sentence/bullet on its own line. Do NOT recommend prescription opioids, gabapentinoids, or NSAIDs beyond ibuprofen at this stage.

Conservative Therapies
One short paragraph (2-3 sentences) covering: (a) chiropractic therapy with specific focus areas tailored to the affected regions (e.g., cervical and lumbar mobility, postural training, core stabilization, gradual functional re-conditioning); (b) home exercise program; heat/ice as tolerated; (c) ergonomic and work/school-related activity modifications.
Reference tone: "Initiate chiropractic therapy focusing on cervical and lumbar mobility, postural training, core stabilization, and gradual functional re-conditioning. Home exercise program; heat/ice as tolerated; ergonomic and school-related activity modifications."
Tailor the specific focus areas to the patient's affected regions from the case summary (cervical, thoracic, lumbar, etc.). If the patient is a student, use "school-related"; if working, use "work-related"; otherwise use "daily activity modifications".

Activity Modification
One short paragraph (1-2 sentences) listing things to avoid (e.g., heavy lifting, repetitive bending, prolonged static positions) and positive guidance (e.g., encourage frequent position changes during daily activities).
Reference tone: "Avoid heavy lifting, repetitive bending, and prolonged static positions. Encourage frequent position changes during school and daily activities."

Follow-Up
One short paragraph (1-2 sentences) stating: (a) re-evaluation following imaging to review results and reassess symptoms, and (b) consideration of referral to pain management if symptoms fail to improve with conservative care.
Reference tone: "Re-evaluation following imaging to review results and reassess symptoms. Consider referral to pain management if symptoms fail to improve."

Do NOT include PRP injection protocol. Do NOT include cost estimates. Do NOT collapse the sub-headings into a single paragraph. Do NOT emit additional sub-headings beyond these four.

13. PATIENT EDUCATION (~1 paragraph):
State that the patient was educated on: the biomechanics of their injury, the importance of diagnostic imaging for accurate diagnosis, red-flag symptoms to monitor (progressive neurological deficits, bowel/bladder changes, severe worsening), conservative care expectations, activity modification and ergonomic strategies, medication guidance, and the importance of compliance with the prescribed treatment program. End with "The patient verbalized understanding." Keep to ONE paragraph. Do NOT mention PRP or regenerative therapy education.

14. PROGNOSIS (~2 sentences):
"Prognosis is guarded but favorable given early clinical presentation and absence of neurological compromise. Outcome will depend on diagnostic imaging results, response to conservative treatment, and adherence to the prescribed rehabilitation program."`

const PAIN_EVALUATION_VISIT_SECTIONS = `
=== VISIT TYPE: PAIN EVALUATION VISIT ===
This patient has completed a course of conservative treatment and has imaging results available. Generate the note as a comprehensive pain management evaluation with PRP treatment recommendations.

=== PRIOR VISIT REFERENCE (READ-ONLY) ===

If priorVisitData is provided in the source data, it contains the finalized Initial Visit note from an earlier encounter on this same case. Treat it as READ-ONLY reference for interval comparison. DO NOT copy its physical exam findings, vitals, or ROM values into this note — those come from the CURRENT visit's providerIntake. Instead, use priorVisitData to:

1. History of the Accident (Para 3): Reference the prior visit's documented findings and conservative care outcome. For the initial evaluation date, use priorVisitData.visit_date if it is non-null; otherwise fall back to priorVisitData.finalized_at. Format the date as MM/DD/YYYY (e.g., "03/20/2026"). Example: "Since the initial evaluation on [priorVisitData.visit_date ?? priorVisitData.finalized_at], the patient has continued conservative care including [reference priorVisitData.treatment_plan]. Despite these measures, symptoms persist, prompting today's pain management evaluation."

2. Post-Accident History: Describe the continuum of care from initial presentation to today. Reference priorVisitData.treatment_plan for what was recommended and summarize adherence/outcome based on the CURRENT visit's providerIntake.

3. Physical Examination: Do NOT restate prior exam findings as current findings. Current findings come from the CURRENT visit's providerIntake.exam_findings. You MAY add one brief comparative sentence at the end of each region: "Compared to the initial evaluation, cervical ROM has [improved/worsened/remained unchanged]." Use priorVisitData.rom_data and priorVisitData.physical_exam for the comparison basis only.

4. Medical Necessity: Cite that conservative care was documented and attempted at the initial visit (reference priorVisitData.treatment_plan) and has failed to produce adequate relief, supporting the escalation to interventional treatment.

5. Prognosis: May reference the evolution from guarded-but-favorable (initial) to the current imaging-informed prognosis.

NUMERIC-ANCHOR (MANDATORY when priorVisitData.vitalSigns.pain_score_max is non-null): The prior visit's intake vitals are carried on priorVisitData.vitalSigns. Use them to anchor a numeric pain-trajectory sentence in the current visit's Chief Complaint / History paragraphs and in the Prognosis paragraph. Required framing:
• "Pain has [decreased / remained similar / increased] from X/10 at the initial evaluation to Y/10 today." Render ranges when priorVisitData.vitalSigns.pain_score_min/max differ (e.g. "from 7-8/10 at initial evaluation to 5-6/10 today"); single value when they match or only one is present.
• Current pain values come from the CURRENT visit's providerIntake — never from priorVisitData. priorVisitData.vitalSigns supplies the prior endpoint only.
• The delta direction must match what the numbers support. A ≥3 point drop is "pain has meaningfully decreased"; a ≤2 point drop is "pain is similar but modestly reduced"; a ≥2 point rise is "pain has increased". Thresholds match the procedure-note paintoneLabel semantics.
• When priorVisitData.vitalSigns is null or pain_score_max is null, do NOT invent a numeric prior pain value. Fall back to qualitative comparative language tied to priorVisitData.chief_complaint narrative.

If priorVisitData is null (no prior Initial Visit exists on this case), generate the Pain Evaluation Visit note without any interval-comparison language — it is a standalone evaluation.

2. HISTORY OF THE ACCIDENT (~2 short paragraphs):
Para 1: Accident mechanism — vehicle position, point of impact, seatbelt/airbag, consciousness, immediate symptoms, paramedic/ER response. Short declarative sentences.
Para 2: "Despite conservative treatment, [he/she] continues to complain of pain and functional deficits with activities of daily living. [His/Her] quality of life has been significantly affected as [he/she] experiences difficulties and limitations in [his/her] activities of daily living, including self-care."
Reference tone: "The patient stated that she was the seat belted driver of a car that was struck on the front bumper by another car on the street. The airbag did not deploy. The patient did not lose consciousness."

3. POST-ACCIDENT HISTORY (~2-3 short paragraphs):
Para 1: Timeline of care sought after the accident — ER/urgent care visits, initial treatment providers (chiropractic, physical therapy), and referral chain leading to this evaluation. Use specific dates and provider types from the case summary treatment timeline.
Para 2: How symptoms have evolved since the accident — which symptoms persisted, worsened, or improved over time. Include any medications prescribed post-accident.
Para 3: Functional impact — work status changes, activity limitations, and how daily life has been affected since the accident.
Use information from the case summary treatment timeline and symptom progression. Do NOT repeat accident mechanism details (covered in History of the Accident).
Reference tone: "Following the collision, the patient presented to the emergency department where radiographs were obtained and she was prescribed muscle relaxants and pain medication. She subsequently initiated chiropractic care approximately one week post-accident and has continued conservative treatment. MRIs of the cervical and lumbar spine were obtained for further evaluation."

9. RADIOLOGICAL IMAGING FINDINGS:
For each MRI, state "MRI – [Region] ([date]):" then "• " bullets for findings with specific mm measurements. Then "IMPRESSION:" sub-heading repeating key findings. Do NOT add "Technique:" lines, severity ratings, or editorial commentary about missing imaging. Directly restate the MRI findings from the case summary source data.

10-ADDITIONAL. DIAGNOSES — PRP EVALUATION SPECIFICS:
Use imaging-confirmed diagnosis codes based on MRI findings from caseSummary.imaging_findings. Cross-reference caseSummary.suggested_diagnoses for pre-extracted ICD-10 codes — use suggested codes with "high" confidence when they match the imaging findings.
Common codes by pathology:
• Cervical disc displacement: M50.20 (Other cervical disc displacement, unspecified mid-cervical region)
• Cervical disc degeneration: M50.320 (Other cervical disc degeneration, mid-cervical region)
• Lumbar disc degeneration: M51.16 (Intervertebral disc degeneration, lumbar region), M51.17 (Intervertebral disc degeneration, lumbosacral region)
• Lumbar disc displacement: M51.26 (Other intervertebral disc displacement, lumbar region), M51.27 (Other intervertebral disc displacement, lumbosacral region)
• Annular tear / other disc disorder: M51.86 (Other intervertebral disc disorders, lumbar region), M50.80 (Other cervical disc disorders)
• Radiculopathy: M54.12 (Radiculopathy, cervical region), M54.17 (Radiculopathy, lumbosacral region)
• Pain codes: M54.2 (Cervicalgia), M54.50 (Low back pain, unspecified) / M54.51 (Vertebrogenic low back pain) / M54.59 (Other low back pain), M54.6 (Pain in thoracic spine)
• Headache: G44.309 (Post-traumatic headache, unspecified, not intractable)
• Sleep disturbance: G47.9 (Sleep disorder, unspecified) — use when the patient reports sleep disturbance or difficulty sleeping due to pain
• Myalgia: M79.1 (Myalgia)

DIAGNOSTIC-SUPPORT RULE (MANDATORY): The diagnosis list is a FILTERED output, not a copy of suggested_diagnoses or pmExtraction.diagnoses. Apply these filters before emitting any code. Candidate code sources: caseSummary.suggested_diagnoses, pmExtraction.diagnoses. For each pmExtraction diagnosis, inspect its imaging_support, exam_support, and source_quote tags (populated at extraction time) — a pmExtraction code with imaging_support="none" AND exam_support!="objective" has NO correlative support and must be dropped or downgraded.

DOWNGRADE-TO HONOR RULE: if a caseSummary.suggested_diagnoses entry carries a non-null downgrade_to value, prefer that pre-computed target over re-deriving the substitution. downgrade_to is populated by the case summary generator per Rule 8b and reflects cross-source evidence. Filters (A)-(F) still apply to the downgraded code.

(A) Myelopathy codes (M50.00/.01/.02, M47.1X, M48.0X with neurogenic claudication qualifier, M47.2X with myelopathy qualifier, M54.18) — require documented upper-motor-neuron signs in THIS visit's providerIntake.exam_findings OR an explicit UMN finding in pmExtraction.physical_exam. Acceptable UMN signs: hyperreflexia, clonus, Hoffmann sign, Babinski sign, spastic gait, bowel/bladder dysfunction. Isolated paresthesia, intact sensation, symmetric 2+ reflexes, and 5/5 strength do NOT support myelopathy. If the filter fails, DOWNGRADE: replace M50.00/.01/.02 with M50.20 (Other cervical disc displacement) + keep M54.2 (Cervicalgia); replace M48.0X with the matching non-myelopathy stenosis or disc-degeneration code.

(B) Radiculopathy codes (M54.12, M54.17, M50.1X, M51.1X, M47.2X with radiculopathy qualifier) — require REGION-MATCHED objective findings documented in THIS visit's providerIntake.exam_findings OR a pmExtraction diagnosis with exam_support="objective" for the same region. MRI signal of nerve-root contact alone is NOT sufficient; subjective radiation alone is NOT sufficient.
  • M54.12 / M50.1X (cervical) — requires one of: positive Spurling maneuver, dermatomal sensory deficit in C5/C6/C7/C8/T1, myotomal weakness in an upper-extremity root distribution, OR diminished biceps/triceps/brachioradialis reflex. A positive SLR is a LUMBAR test and does NOT support a cervical radiculopathy code.
  • M54.17 / M51.1X (lumbar/lumbosacral) — requires one of: SLR positive AND reproducing radicular leg symptoms (pain radiating down the leg, paresthesia below the knee — SLR reproducing "low back pain" alone does NOT qualify), dermatomal sensory deficit in L4/L5/S1, myotomal weakness in a lower-extremity root distribution, OR diminished patellar/Achilles reflex.
  • If the radiculopathy filter fails, DOWNGRADE: replace M54.12/M50.1X with M50.20 + keep M54.2; replace M54.17/M51.17 with M51.37 + keep the lumbar pain code; replace M51.16 with M51.36 + keep the lumbar pain code. Do NOT leave disc pathology unrepresented.
  • PROSE-FALLBACK (MANDATORY when a radiculopathy code is filtered out and downgraded): in \`imaging_findings\`, \`physical_exam\`, \`medical_necessity\`, \`treatment_plan\`, and \`prognosis\` narrative prose, describe the clinical picture as "radicular symptoms" or "possible nerve root irritation" — NEVER as "radiculopathy" or "nerve root compression". This applies regardless of what the MRI shows: imaging-only nerve-root contact without objective exam correlation is "possible nerve root irritation", not "radiculopathy". Reserve "radiculopathy" prose exclusively for codes that PASSED Filter (B).
  • MYELOPATHY PROSE-FALLBACK (MANDATORY when Filter A failed and myelopathy code downgraded): NEVER write "myelopathy", "cord compression", "cord compromise", or "myelopathic" anywhere in the note. Describe the underlying pathology using the downgraded-code label (e.g., "cervical disc displacement", "disc pathology without myelopathic features"). Reserve "myelopathy" prose exclusively for codes that PASSED Filter (A).

(C) M79.1 Myalgia — redundancy guard. OMIT M79.1 whenever a region pain/strain code already covers the documented exam findings (e.g., M54.2, M54.50/M54.51/M54.59, M54.6, or S13.4XXA/S23.3XXA/S39.012A). Focal paraspinal tenderness is already captured by the region code and does NOT additionally support M79.1. Keep M79.1 ONLY if the exam documents diffuse muscle pain beyond axial spine tenderness (upper-trapezius involvement, generalized muscle soreness in multiple non-contiguous regions).

(D) M54.5 specificity — NEVER emit the parent M54.5; always pick a 5th-character subcode:
  • Default → M54.50 (Low back pain, unspecified) when the pain pattern is generic/axial low back pain.
  • Use M54.51 (Vertebrogenic low back pain) only when imaging documents vertebral endplate pathology (Modic changes) and the clinical pattern matches vertebrogenic pain.
  • Use M54.59 (Other low back pain) when a documented low-back-pain type does not fit .50 or .51.

(E) suggested_diagnoses confidence handling — prefer "high"-confidence entries that match imaging + exam. For "medium"-confidence entries, require the same imaging + objective-finding support the filters above demand. OMIT "low"-confidence entries unless independent imaging + exam evidence supports them.

(F) pmExtraction provenance — A pmExtraction diagnosis with imaging_support="confirmed" AND exam_support="objective" is strong evidence; emit as-is if it passes the filters above. A pmExtraction diagnosis with exam_support="subjective_only" or "none" for a myelopathy/radiculopathy code fails Filters A/B automatically and must be downgraded. Cite source_quote verbatim in the imaging_findings or medical_necessity narrative when it establishes correlation, to make the clinical basis transparent.

Select codes that correspond to actual MRI findings in the source data. Do NOT add codes for pathology not documented on imaging. If the patient reports sleep disturbance in chief complaints or review of systems, include G47.9.

11. MEDICAL NECESSITY (~3-5 sentences):
Write a concise paragraph that: (a) correlates clinical exam findings with imaging, (b) names the injury pattern, (c) notes persistent symptoms despite conservative care, (d) concludes that interventional pain management consideration is warranted.
Do NOT restate the mechanism of injury. Do NOT list specific MRI findings (already in imaging section). Do NOT describe PRP mechanism or growth factors. Do NOT restate conservative care timeline/visits.
Reference: "The clinical examination and imaging findings support post-traumatic cervical and lumbar spine injury with associated cervical facet-mediated pain and lumbar discogenic pain, consistent with trauma sustained during the motor vehicle accident of 03/12/2025. Persistent symptoms despite conservative care warrant interventional pain management consideration."

12. TREATMENT PLAN (~3-4 paragraphs + cost estimate):
Para 1 — Clinical rationale and medical necessity: Open by summarizing the patient's persistent post-traumatic pain by affected region (e.g., cervical, thoracic, lumbar) and citing the MRI-confirmed pathology that supports intervention (e.g., disc herniations, disc bulges, annular tears, cervical instability/ligamentous laxity). State that conservative treatment to date (chiropractic care, physical therapy, medication) has provided incomplete relief, establishing the clinical basis for escalation to regenerative injection therapy.
Para 2 — PRP injection protocol: Transition with language such as "Given the incomplete response to conservative measures, I am recommending a series of Platelet-Rich Plasma (PRP) injections." Then provide a bullet per target region (cervical, lumbar) specifying: the exact spinal levels to be treated (e.g., C4-5, C5-6, C6-7), the guidance modality (e.g., ultrasound-guided), and the injection approach (e.g., intradiscal, facet-mediated, epidural). After the bullets, state the planned number of injection sessions (typically one to three) and that the patient will be re-evaluated after each injection to assess therapeutic response before proceeding with additional treatments.
Cost estimate sub-section: If feeEstimate data is provided in the source data, use the exact values:
"COST ESTIMATE PER SITE:" sub-heading (values are per injection site), then:
"• Professional Fees: $\{professional_min\} – $\{professional_max\}"
"• Practice/Surgery Center Fees: $\{practice_center_min\} – $\{practice_center_max\}"
Format dollar amounts with commas (e.g., $2,500 – $5,000). If all fee values are 0, omit the cost estimate sub-section entirely. If feeEstimate is null, use "[To be determined]" as placeholder.
Para 3 — Supportive care and rehabilitation: In a single paragraph, outline the concurrent conservative management plan: (a) home exercise program emphasizing core stabilization, cervical/lumbar strengthening, and flexibility exercises for affected regions; (b) ergonomic modifications for work and daily activities to minimize biomechanical stress on injured structures; (c) continued physical therapy as tolerated to maintain functional gains.
Para 4 — Medication management, monitoring, and escalation: In a single paragraph, cover: (a) medication guidance — the patient is advised to avoid NSAIDs for a specified window before and after each PRP injection to avoid inhibiting the platelet-mediated healing response, with acetaminophen permitted for breakthrough pain as needed; (b) monitoring plan — the patient will be re-evaluated after each injection session to assess pain levels, functional improvement, and treatment response; (c) escalation language — if the patient does not demonstrate adequate clinical improvement after completing the PRP series, further diagnostic workup and/or referral for advanced interventional or surgical consultation will be considered. Do NOT create separate sub-sections — keep it ALL in one flowing paragraph.
The entire treatment plan should be approximately one full page.

13. PATIENT EDUCATION (~1 paragraph):
State that the patient was advised on home exercises, conservative care, nature of injuries, PRP mechanism (briefly — do NOT name specific growth factors like PDGF, TGF-β, VEGF, IGF), expected post-injection course, ergonomic strategies, and prevention of chronic pain. End with "The patient verbalized understanding." Keep to ONE paragraph.

14. PROGNOSIS (~2 sentences):
"Prognosis is guarded to fair given ongoing symptoms and MRI-confirmed pathology. Outcome will depend on response to treatment and adherence to rehabilitation." That's the target length.`

function buildSystemPrompt(visitType: NoteVisitType): string {
  const visitSpecificSections = visitType === 'initial_visit' ? INITIAL_VISIT_SECTIONS : PAIN_EVALUATION_VISIT_SECTIONS
  return `${buildPreamble(visitType)}\n${buildCommonSections(visitType)}\n${visitSpecificSections}`
}

const INITIAL_VISIT_TOOL: Anthropic.Tool = {
  name: 'generate_initial_visit_note',
  description: 'Generate a comprehensive Initial Visit clinical note matching the provider template',
  input_schema: {
    type: 'object' as const,
    required: [
      'introduction',
      'history_of_accident',
      'post_accident_history',
      'chief_complaint',
      'past_medical_history',
      'social_history',
      'review_of_systems',
      'physical_exam',
      'imaging_findings',
      'diagnoses',
      'medical_necessity',
      'treatment_plan',
      'patient_education',
      'prognosis',
      'time_complexity_attestation',
      'clinician_disclaimer',
    ],
    properties: {
      introduction: {
        type: 'string',
        description: 'Opening paragraph with patient demographics and evaluation context. Do NOT include "To Whom it May Concern" — the heading is added by the template.',
      },
      history_of_accident: {
        type: 'string',
        description: 'Detailed narrative of accident mechanism, immediate symptoms, and post-accident course',
      },
      post_accident_history: {
        type: 'string',
        description: 'Post-accident treatment timeline, symptom evolution, and functional impact since the accident',
      },
      chief_complaint: {
        type: 'string',
        description: 'Current complaints with body region, pain character, ratings, radiation, and aggravating/alleviating factors',
      },
      past_medical_history: {
        type: 'string',
        description: 'Medical problems, surgeries, medications, and allergies',
      },
      social_history: {
        type: 'string',
        description: 'Smoking/drinking status and occupation',
      },
      review_of_systems: {
        type: 'string',
        description: 'General and musculoskeletal review of systems',
      },
      physical_exam: {
        type: 'string',
        description: 'Vital signs, musculoskeletal exam, ROM (if provided), and neurological findings by region',
      },
      imaging_findings: {
        type: 'string',
        description: 'MRI findings by region with specific measurements and impressions, OR "MRI of [Region] – Ordered / Imaging results pending" for first-visit cases where imaging has been ordered but not yet performed',
      },
      diagnoses: {
        type: 'string',
        description: 'ICD-10 diagnosis list. For first-visit cases: clinical impression codes (strain/sprain) based on exam and mechanism. For PRP evaluation cases: imaging-confirmed diagnosis codes',
      },
      medical_necessity: {
        type: 'string',
        description: 'For first-visit: clinical exam findings warrant diagnostic imaging and structured follow-up. For PRP evaluation: correlation of findings with imaging, conservative care failure, and PRP justification',
      },
      treatment_plan: {
        type: 'string',
        description: 'For first-visit: brief clinical rationale paragraph followed by four sub-headings — Medication Management (specific OTC dosing with daily maxes), Conservative Therapies (chiropractic focus areas, home exercise, ergonomics), Activity Modification (avoidance + positive guidance), Follow-Up (re-evaluation after imaging, pain management referral trigger). For PRP evaluation: PRP injection protocol with spinal levels, cost estimate, supportive care, and monitoring/escalation',
      },
      patient_education: {
        type: 'string',
        description: 'For first-visit: injury biomechanics, imaging importance, red-flag symptoms, conservative care guidance. For PRP evaluation: PRP mechanism, post-injection course, activity modification',
      },
      prognosis: {
        type: 'string',
        description: 'For first-visit: guarded but favorable given early presentation. For PRP evaluation: guarded to fair given symptoms and MRI-confirmed pathology',
      },
      time_complexity_attestation: {
        type: 'string',
        description: 'Provider attestation of cumulative time spent and complexity of medical decision-making',
      },
      clinician_disclaimer: {
        type: 'string',
        description: 'Standard medical-legal disclaimer about scope of assessment',
      },
    },
  },
}

// Input data shape passed to the generator
export interface InitialVisitInputData {
  patientInfo: {
    first_name: string
    last_name: string
    date_of_birth: string | null
    gender: string | null
  }
  age: number | null
  caseDetails: {
    case_number: string
    accident_type: string | null
    accident_date: string | null
    accident_description: string | null
  }
  /**
   * Cross-source clinical synthesis (MRI, CT, PM, PT, ortho, chiro). Populated
   * only for pain_evaluation_visit generation. Null for initial_visit — the
   * first visit is scoped to provider intake + physical exam + mechanism of
   * injury, with no imaging correlation or PM-sourced diagnosis suggestions.
   */
  caseSummary: {
    chief_complaint: string | null
    imaging_findings: unknown
    prior_treatment: unknown
    symptoms_timeline: unknown
    suggested_diagnoses: unknown
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
  romData: Array<{
    region: string
    movements: Array<{
      movement: string
      normal: number | null
      actual: number | null
      pain: boolean
    }>
  }> | null
  feeEstimate: {
    professional_min: number
    professional_max: number
    practice_center_min: number
    practice_center_max: number
  } | null
  providerIntake: {
    chief_complaints: unknown
    accident_details: unknown
    past_medical_history: unknown
    social_history: unknown
    exam_findings: unknown
  } | null
  /**
   * Read-only reference data from a prior finalized Initial Visit on the same case.
   * Populated only when generating a Pain Evaluation Visit. Null otherwise.
   */
  priorVisitData: {
    chief_complaint: string | null
    physical_exam: string | null
    imaging_findings: string | null
    medical_necessity: string | null
    diagnoses: string | null
    treatment_plan: string | null
    prognosis: string | null
    provider_intake: unknown | null
    rom_data: unknown | null
    visit_date: string | null
    finalized_at: string | null
    // Pain vitals captured at or before the prior initial visit's finalization.
    // Used to anchor numeric pain trajectory sentences in the Pain Evaluation
    // Visit narrative (e.g. "pain has decreased from 8/10 at initial
    // evaluation to 6/10 today"). Null when no intake vitals row predates the
    // prior visit's finalized_at.
    vitalSigns: {
      recorded_at: string | null
      pain_score_min: number | null
      pain_score_max: number | null
    } | null
  } | null
  /**
   * Whether the case has any approved/edited MRI or CT extractions. Used by
   * detectDefaultVisitType() as a fallback signal that diagnostic imaging exists
   * even when no case summary has been generated yet.
   */
  hasApprovedDiagnosticExtractions: boolean
  /**
   * Most recent approved/edited Pain Management extraction. Provides direct
   * access to PM-sourced diagnoses with their imaging/exam support tags so the
   * Pain Evaluation Visit prompt can apply the DIAGNOSTIC-SUPPORT RULE against
   * fresh provenance data without relying on a stale case summary regeneration.
   */
  pmExtraction: {
    diagnoses: unknown
    physical_exam: unknown
    diagnostic_studies_summary: string | null
  } | null
}

/**
 * Total number of top-level keys in the INITIAL_VISIT_TOOL input_schema. Used
 * by callers to seed sections_total on the initial_visit_notes row when
 * starting a generation; also the divisor the UI renders progress against.
 */
export const INITIAL_VISIT_SECTIONS_TOTAL = 16

export async function generateInitialVisitFromData(
  inputData: InitialVisitInputData,
  visitType: NoteVisitType,
  toneHint?: string | null,
  onProgress?: (completedKeys: string[]) => void | Promise<void>,
): Promise<{
  data?: InitialVisitNoteResult
  rawResponse?: unknown
  error?: string
}> {
  const systemPrompt = buildSystemPrompt(visitType)

  const visitLabel = visitType === 'initial_visit'
    ? 'INITIAL VISIT (no prior imaging, no prior treatment)'
    : 'PAIN EVALUATION VISIT (imaging available, post-conservative treatment)'
  let userMessage = `Generate a comprehensive Initial Visit note from the following case data.\n\nVisit type: ${visitLabel}\n\n${JSON.stringify(inputData, null, 2)}`
  if (toneHint?.trim()) {
    userMessage += `\n\nADDITIONAL TONE/DIRECTION GUIDANCE FROM THE PROVIDER:\n${toneHint.trim()}`
  }

  return callClaudeTool<InitialVisitNoteResult>({
    model: 'claude-opus-4-6',
    maxTokens: 16384,
    system: systemPrompt,
    tools: [INITIAL_VISIT_TOOL],
    toolName: 'generate_initial_visit_note',
    messages: [{ role: 'user', content: userMessage }],
    parse: (raw) => {
      const validated = initialVisitNoteResultSchema.safeParse(raw)
      return validated.success
        ? { success: true, data: validated.data }
        : { success: false, error: validated.error }
    },
    onProgress,
  })
}

// --- Per-section regeneration ---

const SECTION_REGEN_TOOL: Anthropic.Tool = {
  name: 'regenerate_section',
  description: 'Regenerate a single section of an Initial Visit note',
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

export async function regenerateSection(
  inputData: InitialVisitInputData,
  visitType: NoteVisitType,
  section: InitialVisitSection,
  currentContent: string,
  toneHint?: string | null,
  otherSections?: Partial<Record<InitialVisitSection, string>>,
): Promise<{ data?: string; error?: string }> {
  const systemPrompt = buildSystemPrompt(visitType)
  const sectionLabel = sectionLabels[section]
  const visitLabel = visitType === 'initial_visit'
    ? 'INITIAL VISIT (no prior imaging, no prior treatment)'
    : 'PAIN EVALUATION VISIT (imaging available, post-conservative treatment)'

  let otherSectionsBlock = ''
  let systemSuffix = `You are regenerating ONLY the "${sectionLabel}" section of an existing Initial Visit note. Visit type: ${visitLabel}. Write a fresh version of this section based on the source data. Do not repeat the section title — just provide the content. Follow the exact length targets and conciseness constraints from the section-specific instructions above.`
  if (otherSections) {
    const entries = Object.entries(otherSections)
      .filter(([k, v]) => k !== section && typeof v === 'string' && v.trim().length > 0)
      .map(([k, v]) => `--- ${sectionLabels[k as InitialVisitSection]} ---\n${v}`)
    if (entries.length > 0) {
      otherSectionsBlock = `\n\nOTHER SECTIONS CURRENTLY PRESENT IN THIS NOTE (for context — keep this regenerated section consistent with them, do NOT duplicate their content):\n${entries.join('\n\n')}`
      systemSuffix += ' Avoid duplicating content that already appears in the OTHER SECTIONS listed in the user message — each section must contribute NEW information. Ensure prose-vs-diagnosis-code consistency: if the finalized diagnoses section emits a downgraded code (e.g., M50.20 instead of M50.1X), narrative prose in the regenerated section must use the downgrade-aligned phrasing ("radicular symptoms" / "possible nerve root irritation") per the PROSE-FALLBACK rules above.'
    }
  }

  let userMessage = `Regenerate the "${sectionLabel}" section of the Initial Visit note.\n\nCurrent content of this section:\n${currentContent}${otherSectionsBlock}\n\nFull case data:\n${JSON.stringify(inputData, null, 2)}`
  if (toneHint?.trim()) {
    userMessage += `\n\nADDITIONAL TONE/DIRECTION GUIDANCE FROM THE PROVIDER:\n${toneHint.trim()}`
  }

  const result = await callClaudeTool<{ content: string }>({
    model: 'claude-opus-4-6',
    maxTokens: 4096,
    system: `${systemPrompt}\n\n${systemSuffix}`,
    tools: [SECTION_REGEN_TOOL],
    toolName: 'regenerate_section',
    messages: [{ role: 'user', content: userMessage }],
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
