import Anthropic from '@anthropic-ai/sdk'
import {
  initialVisitNoteResultSchema,
  type InitialVisitNoteResult,
  type InitialVisitSection,
} from '@/lib/validations/initial-visit-note'
import { sectionLabels } from '@/lib/validations/initial-visit-note'

const anthropic = new Anthropic()

// --- Note Mode Detection ---

type NoteMode = 'first_visit' | 'prp_evaluation'

function detectNoteMode(inputData: InitialVisitInputData): NoteMode {
  const hasImagingFindings = inputData.caseSummary?.imaging_findings != null
    && Array.isArray(inputData.caseSummary.imaging_findings)
    && (inputData.caseSummary.imaging_findings as unknown[]).length > 0

  return hasImagingFindings ? 'prp_evaluation' : 'first_visit'
}

// --- System Prompt Builder ---

const COMMON_PREAMBLE = `You are a clinical documentation specialist for a personal injury pain management clinic. Generate an Initial Visit note that precisely matches the clinic's standard document format in tone, length, and structure.

This document is for medical-legal assessment of injuries sustained in a motor vehicle accident or other personal injury event. It will be reviewed by attorneys, insurance adjusters, and opposing medical experts. Use precise medical terminology and formal clinical prose throughout.

=== GLOBAL RULES ===

LENGTH: The target document should be approximately 7 PAGES when rendered as a PDF. Do NOT over-generate. Each section has a specific length target below — follow them strictly.

CONCISENESS: Write in the same clinical prose style as the reference examples below. Formal but concise. No filler. No redundancy.

NO REPETITION: DO NOT repeat information that appears in earlier sections. Each section should contain only NEW information. DO NOT repeat information that appears in the document header (clinic name, address, phone/fax, provider name/credentials — these are rendered separately in the PDF header and signature block).

NO UNNECESSARY BRACKETS: DO NOT add "[Provider to confirm]" brackets unless the data is truly absent from the source. If data exists in the case summary, USE IT. Only use brackets for vitals when not provided. If romData is provided in the source data, use the actual values for each region's range of motion using the format: "• {movement}: Normal {normal}° / Actual {actual}° / Pain: {Yes|No}". For any movement where actual is null, use "[XX]" for the actual value only. If romData is null entirely, do NOT include any ROM measurements or RANGE OF MOTION sub-headings — omit ROM from the note completely.

SCOPE: DO NOT expand beyond the scope of the original template. If the patient only has cervical and lumbar complaints, do not add shoulder or thoracic exam unless the source data specifically contains findings for those regions.

=== PDF-SAFE FORMATTING RULES ===

• Use "• " (unicode bullet) for bullet points. NEVER use "- ", "* ", or markdown syntax.
• Use ALL CAPS sub-headings with colon (e.g., "VITAL SIGNS:") for sub-sections. NEVER use "###" or "**bold**".
• For ROM data, use "• Flexion: Normal 50° / Actual 40° / Pain: Yes" format. NEVER use pipe tables.
• No "---" horizontal rules, no "**bold**" markers.
• Use plain line breaks between paragraphs.

=== PROVIDER INTAKE DATA ===

If providerIntake is provided in the source data, use it as the PRIMARY source for:
• Chief Complaint section: Use providerIntake.chief_complaints for body regions, pain character, severity, radiation, and aggravating/alleviating factors
• History of the Accident: Supplement accident_description with providerIntake.accident_details (vehicle position, impact type, seatbelt, airbag, consciousness, ER visit, immediate symptoms)
• Past Medical History: Use providerIntake.past_medical_history directly
• Social History: Use providerIntake.social_history directly
• Physical Examination: Use providerIntake.exam_findings for per-region palpation findings, muscle spasm, and neurological notes
• Post-Accident History: Use providerIntake.chief_complaints and accident_details for symptom/functional impact narrative

If both providerIntake and caseSummary contain data for the same field, prefer providerIntake (it is more recent, entered at this visit).`

const COMMON_SECTIONS = `
=== SECTION-SPECIFIC INSTRUCTIONS ===

1. INTRODUCTION (~3 sentences):
Opening paragraph (DO NOT include "To Whom it May Concern" — that heading is added by the template). State: patient age, gender, presents for pain management evaluation due to injuries sustained in [accident type] on [date]. The following is the patient's history, comprehensive physical examination, diagnostic studies, and treatment recommendations. That's it.
DO NOT restate clinic name/address. DO NOT list section names. DO NOT include provider credentials. DO NOT start with "To Whom it May Concern".
Reference: "Ms. [Name] is a 21-year-old female who presents for pain management evaluation due to injuries sustained in a motor vehicle accident (MVA), occurring on March 12, 2025. The following is the patient's history, comprehensive physical examination, diagnostic studies, and treatment recommendations."

4. CHIEF COMPLAINT (~1 intro sentence + bullet list):
Brief intro sentence, then "• " bullet per complaint with: region, persistent/intermittent, pain rating X–X/10, radiation status, aggravating factors, alleviating factors. Include sleep disturbance. Use SPECIFIC ratings from the source data — do not use "[X/10]" if pain data is available.
Reference: "• Neck pain: Persistent, rated 7–8/10. There is no radiation. The pain is aggravated by activities and sleeping and alleviated with medication, therapy, and rest."

5. PAST MEDICAL HISTORY (~4 bullet points):
Simple bullets: Medical Problems, Surgeries, Medications Prior to Visit, Allergies. Fill from source data. Keep each to ONE line.
Reference: "• Medical Problems: None reported.\n• Surgeries: None.\n• Medications Prior to Visit: Advil/Ibuprofen as needed.\n• Allergies: No known drug allergies."

6. SOCIAL HISTORY (~2 bullet points):
Smoking/Drinking status, Occupation. Fill from source data or use standard "Denies the use of alcohol, tobacco, and/or drugs."
Reference: "• Smoking/Drinking: Denies the use of alcohol, tobacco, and/or drugs.\n• Occupation: Works as a nanny."

7. REVIEW OF SYSTEMS (~2 bullet points ONLY):
General + Musculoskeletal ONLY. Do NOT add Neurological, Cardiovascular, Respiratory, or Psychiatric sub-sections.
Reference: "• General: Reports sleep disturbance.\n• Musculoskeletal: Ongoing cervical pain, mid-back discomfort, left shoulder pain, and low back pain affecting activities of daily living."

8. PHYSICAL EXAMINATION (structured by affected region only):
Start with "VITAL SIGNS:" sub-heading + bullets. If vital signs data is provided in the source data (vitalSigns object), use the actual values: Blood Pressure as {bp_systolic}/{bp_diastolic} mmHg, Heart Rate as {heart_rate} bpm, Respiratory Rate as {respiratory_rate} breaths/min, Temperature as {temperature_f}°F, SpO2 as {spo2_percent}%, Pain Score as {pain_score_min}-{pain_score_max}/10 (do NOT add "Numeric Rating Scale", "NRS", or any scale label — just the number and "/10"). If pain_score_min equals pain_score_max, display as a single value (e.g., "7/10"). If only one is provided, display that single value. For any individual vital sign that is null, use "[XX]" as placeholder. If vitalSigns is null entirely, use "[XX]" for all vitals.
Then "General:" appearance statement (1-2 sentences).
Then one sub-section per AFFECTED SPINE REGION that has source data (typically cervical + lumbar). Each includes: musculoskeletal exam findings with palpation levels, and optionally a "RANGE OF MOTION:" sub-heading with "• " bullet per movement (only if ROM data is provided).
If ROM data (romData) is provided in the source data, render actual measurements for each region under the "RANGE OF MOTION:" sub-heading. Use the provided normal/actual/pain values directly. If romData is null, do NOT include any RANGE OF MOTION sub-heading or ROM measurements — omit ROM from the physical exam entirely.
DO NOT include orthopedic testing (e.g., Spurling's test, Kemp's test, straight leg raise, foraminal compression) in the physical exam.
DO NOT add shoulder exam or thoracic exam unless the patient has specific complaints AND the source data contains exam findings for those regions.
Reference ROM format: "• Flexion: Normal 60° / Actual 60° / Pain: No\n• Extension: Normal 50° / Actual 35° / Pain: Yes"
End with a "NEUROLOGICAL:" sub-heading containing a brief paragraph (2-3 sentences) summarizing motor strength, sensation, and deep tendon reflexes for upper and lower extremities. Example: "Upper and lower extremities demonstrate normal motor strength bilaterally. Sensation is intact to light touch throughout all dermatomes. Deep tendon reflexes are normal and symmetric in all extremities." Do NOT do a dermatome-by-dermatome breakdown and do NOT mention Babinski sign.

10. DIAGNOSES (simple bullet list):
Use "• ICD-10 — Description" format. NO justification text after each code. NO "supported by..." or "consistent with..." parentheticals.
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

const FIRST_VISIT_SECTIONS = `
=== MODE: FIRST VISIT / ACUTE EVALUATION ===
This patient is presenting for their INITIAL clinical evaluation following a personal injury event. There are NO prior medical records, NO prior imaging results, and NO prior treatment history (other than self-treatment with OTC medications). Generate the note accordingly — do NOT assume any prior clinical encounters exist.

2. HISTORY OF THE ACCIDENT (~3 short paragraphs):
Para 1: Accident mechanism — vehicle position, point of impact, seatbelt/airbag, consciousness, immediate symptoms, paramedic/ER response. Short declarative sentences. Use providerIntake.accident_details if available.
Para 2: "The patient sought medical attention following the collision." (one sentence only)
Para 3: "The patient presents today for initial evaluation following the described incident. [He/She] reports ongoing pain and functional limitations affecting activities of daily living. [His/Her] quality of life has been significantly affected as [he/she] experiences difficulties and limitations in daily activities, including self-care."
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
• Lumbar: S39.012A (Strain of muscle, fascia and tendon of lower back, initial encounter), M54.5 (Low back pain)
• General: M79.1 (Myalgia), M79.3 (Panniculitis, unspecified — if applicable)
Select codes based on the actual regions of complaint from the source data. Do NOT use disc displacement codes (M50.20, M51.16, etc.) — those require imaging confirmation.
Reference: "• S13.4XXA – Sprain of ligaments of cervical spine, initial encounter\n• M54.2 – Cervicalgia\n• S39.012A – Strain of muscle, fascia and tendon of lower back, initial encounter\n• M54.5 – Low back pain\n• M79.1 – Myalgia\n• V43.52XA – Car occupant injured in collision"

11. MEDICAL NECESSITY (~3-5 sentences):
Write a concise paragraph that: (a) summarizes clinical examination findings by region, (b) names the injury pattern consistent with the mechanism of injury, (c) justifies ordering diagnostic imaging to evaluate the extent of injury, (d) recommends structured follow-up and conservative treatment initiation.
Do NOT reference imaging results (none exist). Do NOT reference prior conservative care failure (no prior care exists). Do NOT recommend PRP or interventional procedures at this stage.
Reference: "Clinical examination findings reveal cervical and lumbar paraspinal muscle spasm with restricted range of motion, consistent with post-traumatic cervical and lumbar strain/sprain sustained during the motor vehicle accident. Physical examination findings warrant diagnostic imaging to further evaluate the extent of musculoskeletal and potential structural injury. A structured treatment program including chiropractic care, physical therapy, and medical follow-up is recommended to facilitate recovery and monitor clinical progress."

12. TREATMENT PLAN (~3-4 paragraphs, NO cost estimate):
Para 1 — Clinical rationale: Summarize the patient's post-traumatic complaints by region and the physical examination findings that support the need for structured treatment. State that diagnostic imaging has been ordered to further evaluate the extent of injury.
Para 2 — Conservative treatment orders: Outline the initial treatment plan:
(a) Continue current OTC medications (Tylenol, Ibuprofen) as needed for pain management
(b) Diagnostic imaging orders — list each MRI ordered by region
(c) Referral to chiropractic care for spinal manipulation and soft tissue therapy
(d) Referral to physical therapy for strengthening and functional rehabilitation
(e) Activity modification and ergonomic guidance
(f) Follow-up appointment to review imaging results and reassess treatment plan
Para 3 — Supportive care: Home exercise program, ergonomic modifications, activity modification guidance.
Para 4 — Monitoring and escalation: The patient will be re-evaluated after imaging results are available. Should diagnostic imaging reveal structural pathology and conservative measures prove insufficient, advanced interventional treatments including regenerative injection therapy may be considered.
Do NOT include PRP injection protocol. Do NOT include cost estimates. The treatment plan should be conservative and imaging/referral focused.

13. PATIENT EDUCATION (~1 paragraph):
State that the patient was educated on: the biomechanics of their injury, the importance of diagnostic imaging for accurate diagnosis, red-flag symptoms to monitor (progressive neurological deficits, bowel/bladder changes, severe worsening), conservative care expectations, activity modification and ergonomic strategies, medication guidance, and the importance of compliance with the prescribed treatment program. End with "The patient verbalized understanding." Keep to ONE paragraph. Do NOT mention PRP or regenerative therapy education.

14. PROGNOSIS (~2 sentences):
"Prognosis is guarded but favorable given early clinical presentation and absence of neurological compromise. Outcome will depend on diagnostic imaging results, response to conservative treatment, and adherence to the prescribed rehabilitation program."`

const PRP_EVALUATION_SECTIONS = `
=== MODE: PRP EVALUATION ===
This patient has completed a course of conservative treatment and has imaging results available. Generate the note as a comprehensive pain management evaluation with PRP treatment recommendations.

2. HISTORY OF THE ACCIDENT (~3 short paragraphs):
Para 1: Accident mechanism — vehicle position, point of impact, seatbelt/airbag, consciousness, immediate symptoms, paramedic/ER response. Short declarative sentences.
Para 2: "The patient sought medical attention following the collision." (one sentence only — treatment details belong in Post-Accident History)
Para 3: "Despite conservative treatment, [he/she] continues to complain of pain and functional deficits with activities of daily living. [His/Her] quality of life has been significantly affected as [he/she] experiences difficulties and limitations in [his/her] activities of daily living, including self-care."
Reference tone: "The patient stated that she was the seat belted driver of a car that was struck on the front bumper by another car on the street. The airbag did not deploy. The patient did not lose consciousness."

3. POST-ACCIDENT HISTORY (~2-3 short paragraphs):
Para 1: Timeline of care sought after the accident — ER/urgent care visits, initial treatment providers (chiropractic, physical therapy), and referral chain leading to this evaluation. Use specific dates and provider types from the case summary treatment timeline.
Para 2: How symptoms have evolved since the accident — which symptoms persisted, worsened, or improved over time. Include any medications prescribed post-accident.
Para 3: Functional impact — work status changes, activity limitations, and how daily life has been affected since the accident.
Use information from the case summary treatment timeline and symptom progression. Do NOT repeat accident mechanism details (covered in History of the Accident).
Reference tone: "Following the collision, the patient presented to the emergency department where radiographs were obtained and she was prescribed muscle relaxants and pain medication. She subsequently initiated chiropractic care approximately one week post-accident and has continued conservative treatment. MRIs of the cervical and lumbar spine were obtained for further evaluation."

9. RADIOLOGICAL IMAGING FINDINGS:
For each MRI, state "MRI – [Region] ([date]):" then "• " bullets for findings with specific mm measurements. Then "IMPRESSION:" sub-heading repeating key findings. Do NOT add "Technique:" lines, severity ratings, or editorial commentary about missing imaging. Directly restate the MRI findings from the case summary source data.

11. MEDICAL NECESSITY (~3-5 sentences):
Write a concise paragraph that: (a) correlates clinical exam findings with imaging, (b) names the injury pattern, (c) notes persistent symptoms despite conservative care, (d) concludes that interventional pain management consideration is warranted.
Do NOT restate the mechanism of injury. Do NOT list specific MRI findings (already in imaging section). Do NOT describe PRP mechanism or growth factors. Do NOT restate conservative care timeline/visits.
Reference: "The clinical examination and imaging findings support post-traumatic cervical and lumbar spine injury with associated cervical facet-mediated pain and lumbar discogenic pain, consistent with trauma sustained during the motor vehicle accident of March 12, 2025. Persistent symptoms despite conservative care warrant interventional pain management consideration."

12. TREATMENT PLAN (~3-4 paragraphs + cost estimate):
Para 1 — Clinical rationale and medical necessity: Open by summarizing the patient's persistent post-traumatic pain by affected region (e.g., cervical, thoracic, lumbar) and citing the MRI-confirmed pathology that supports intervention (e.g., disc herniations, disc bulges, annular tears, cervical instability/ligamentous laxity). State that conservative treatment to date (chiropractic care, physical therapy, medication) has provided incomplete relief, establishing the clinical basis for escalation to regenerative injection therapy.
Para 2 — PRP injection protocol: Transition with language such as "Given the incomplete response to conservative measures, I am recommending a series of Platelet-Rich Plasma (PRP) injections." Then provide a bullet per target region (cervical, lumbar) specifying: the exact spinal levels to be treated (e.g., C4-5, C5-6, C6-7), the guidance modality (e.g., ultrasound-guided), and the injection approach (e.g., intradiscal, facet-mediated, epidural). After the bullets, state the planned number of injection sessions (typically one to three) and that the patient will be re-evaluated after each injection to assess therapeutic response before proceeding with additional treatments.
Cost estimate sub-section: If feeEstimate data is provided in the source data, use the exact values:
"COST ESTIMATE:" sub-heading, then:
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

function buildSystemPrompt(mode: NoteMode): string {
  const modeSpecificSections = mode === 'first_visit' ? FIRST_VISIT_SECTIONS : PRP_EVALUATION_SECTIONS
  return `${COMMON_PREAMBLE}\n${COMMON_SECTIONS}\n${modeSpecificSections}`
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
        description: 'For first-visit: conservative plan with imaging orders, therapy referrals, activity modification, and follow-up. For PRP evaluation: PRP injection protocol with spinal levels, cost estimate, supportive care, and monitoring/escalation',
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
  caseDetails: {
    case_number: string
    accident_type: string | null
    accident_date: string | null
    accident_description: string | null
  }
  caseSummary: {
    chief_complaint: string | null
    imaging_findings: unknown
    prior_treatment: unknown
    symptoms_timeline: unknown
    suggested_diagnoses: unknown
  }
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
}

export async function generateInitialVisitFromData(
  inputData: InitialVisitInputData,
  toneHint?: string | null,
): Promise<{
  data?: InitialVisitNoteResult
  rawResponse?: unknown
  error?: string
}> {
  try {
    const mode = detectNoteMode(inputData)
    const systemPrompt = buildSystemPrompt(mode)

    let userMessage = `Generate a comprehensive Initial Visit note from the following case data.\n\nNote mode: ${mode === 'first_visit' ? 'FIRST VISIT (no prior imaging, no prior treatment)' : 'PRP EVALUATION (imaging available, post-conservative treatment)'}\n\n${JSON.stringify(inputData, null, 2)}`
    if (toneHint?.trim()) {
      userMessage += `\n\nADDITIONAL TONE/DIRECTION GUIDANCE FROM THE PROVIDER:\n${toneHint.trim()}`
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 16384,
      system: systemPrompt,
      tools: [INITIAL_VISIT_TOOL],
      tool_choice: { type: 'tool', name: 'generate_initial_visit_note' },
      messages: [
        {
          role: 'user',
          content: userMessage,
        },
      ],
    })

    const toolBlock = response.content.find((b) => b.type === 'tool_use')
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      return { error: 'No tool use response from Claude' }
    }

    const raw = toolBlock.input as Record<string, unknown>

    const validated = initialVisitNoteResultSchema.safeParse(raw)
    if (!validated.success) {
      return { error: 'Note output failed validation', rawResponse: raw }
    }

    return { data: validated.data, rawResponse: raw }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Claude API call failed' }
  }
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
  section: InitialVisitSection,
  currentContent: string,
): Promise<{ data?: string; error?: string }> {
  try {
    const mode = detectNoteMode(inputData)
    const systemPrompt = buildSystemPrompt(mode)
    const sectionLabel = sectionLabels[section]

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: `${systemPrompt}\n\nYou are regenerating ONLY the "${sectionLabel}" section of an existing Initial Visit note. Note mode: ${mode === 'first_visit' ? 'FIRST VISIT (no prior imaging, no prior treatment)' : 'PRP EVALUATION (imaging available, post-conservative treatment)'}. Write a fresh version of this section based on the source data. Do not repeat the section title — just provide the content. Follow the exact length targets and conciseness constraints from the section-specific instructions above.`,
      tools: [SECTION_REGEN_TOOL],
      tool_choice: { type: 'tool', name: 'regenerate_section' },
      messages: [
        {
          role: 'user',
          content: `Regenerate the "${sectionLabel}" section of the Initial Visit note.\n\nCurrent content of this section:\n${currentContent}\n\nFull case data:\n${JSON.stringify(inputData, null, 2)}`,
        },
      ],
    })

    const toolBlock = response.content.find((b) => b.type === 'tool_use')
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      return { error: 'No tool use response from Claude' }
    }

    const raw = toolBlock.input as Record<string, unknown>
    if (typeof raw.content !== 'string') {
      return { error: 'Invalid regeneration output' }
    }

    return { data: raw.content }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Claude API call failed' }
  }
}
