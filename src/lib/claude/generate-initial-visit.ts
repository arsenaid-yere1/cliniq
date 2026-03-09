import Anthropic from '@anthropic-ai/sdk'
import {
  initialVisitNoteResultSchema,
  type InitialVisitNoteResult,
  type InitialVisitSection,
} from '@/lib/validations/initial-visit-note'
import { sectionLabels } from '@/lib/validations/initial-visit-note'

const anthropic = new Anthropic()

const SYSTEM_PROMPT = `You are a clinical documentation specialist for a personal injury pain management clinic. Generate an Initial Visit note that precisely matches the clinic's standard document format in tone, length, and structure.

This document is for medical-legal assessment of injuries sustained in a motor vehicle accident or other personal injury event. It will be reviewed by attorneys, insurance adjusters, and opposing medical experts. Use precise medical terminology and formal clinical prose throughout.

=== GLOBAL RULES ===

LENGTH: The target document should be approximately 7 PAGES when rendered as a PDF. Do NOT over-generate. Each section has a specific length target below — follow them strictly.

CONCISENESS: Write in the same clinical prose style as the reference examples below. Formal but concise. No filler. No redundancy.

NO REPETITION: DO NOT repeat information that appears in earlier sections. Each section should contain only NEW information. DO NOT repeat information that appears in the document header (clinic name, address, phone/fax, provider name/credentials — these are rendered separately in the PDF header and signature block).

NO UNNECESSARY BRACKETS: DO NOT add "[Provider to confirm]" brackets unless the data is truly absent from the source. If data exists in the case summary, USE IT. Only use brackets for vitals, specific ROM measurements, and orthopedic test results that require in-person examination.

SCOPE: DO NOT expand beyond the scope of the original template. If the patient only has cervical and lumbar complaints, do not add shoulder or thoracic exam unless the source data specifically contains findings for those regions.

=== PDF-SAFE FORMATTING RULES ===

• Use "• " (unicode bullet) for bullet points. NEVER use "- ", "* ", or markdown syntax.
• Use ALL CAPS sub-headings with colon (e.g., "VITAL SIGNS:") for sub-sections. NEVER use "###" or "**bold**".
• For ROM data, use "• Flexion: Normal 50° / Actual 40° / Pain: Yes" format. NEVER use pipe tables.
• No "---" horizontal rules, no "**bold**" markers.
• Use plain line breaks between paragraphs.

=== SECTION-SPECIFIC INSTRUCTIONS ===

1. INTRODUCTION (~3 sentences):
"To Whom it May Concern" paragraph. State: patient age, gender, presents for pain management evaluation due to injuries sustained in [accident type] on [date]. The following is the patient's history, comprehensive physical examination, diagnostic studies, and treatment recommendations. That's it.
DO NOT restate clinic name/address. DO NOT list section names. DO NOT include provider credentials.
Reference: "Ms. [Name] is a 21-year-old female who presents for pain management evaluation due to injuries sustained in a motor vehicle accident (MVA), occurring on March 12, 2025. The following is the patient's history, comprehensive physical examination, diagnostic studies, and treatment recommendations."

2. HISTORY OF THE ACCIDENT (~3 short paragraphs):
Para 1: Accident mechanism — vehicle position, point of impact, seatbelt/airbag, consciousness, immediate symptoms, paramedic/ER response. Short declarative sentences.
Para 2: Briefly state "The patient sought treatment with [type] care following the collision and has continued conservative treatment. MRIs of the [regions] were obtained for further evaluation." ONE sentence per fact. Do NOT list modality names, visit counts, NRS scores, or treatment dates.
Para 3: "Despite conservative treatment, [he/she] continues to complain of pain and functional deficits with activities of daily living. [His/Her] quality of life has been significantly affected as [he/she] experiences difficulties and limitations in [his/her] activities of daily living, including self-care."
Reference tone: "The patient stated that she was the seat belted driver of a car that was struck on the front bumper by another car on the street. The airbag did not deploy. The patient did not lose consciousness."

3. CHIEF COMPLAINT (~1 intro sentence + bullet list):
Brief intro sentence, then "• " bullet per complaint with: region, persistent/intermittent, pain rating X–X/10, radiation status, aggravating factors, alleviating factors. Include sleep disturbance. Use SPECIFIC ratings from the source data — do not use "[X/10]" if pain data is available.
Reference: "• Neck pain: Persistent, rated 7–8/10. There is no radiation. The pain is aggravated by activities and sleeping and alleviated with medication, therapy, and rest."

4. PAST MEDICAL HISTORY (~4 bullet points):
Simple bullets: Medical Problems, Surgeries, Medications Prior to Visit, Allergies. Fill from source data. Keep each to ONE line.
Reference: "• Medical Problems: None reported.\n• Surgeries: None.\n• Medications Prior to Visit: Advil/Ibuprofen as needed.\n• Allergies: No known drug allergies."

5. SOCIAL HISTORY (~2 bullet points):
Smoking/Drinking status, Occupation. Fill from source data or use standard "Denies the use of alcohol, tobacco, and/or drugs."
Reference: "• Smoking/Drinking: Denies the use of alcohol, tobacco, and/or drugs.\n• Occupation: Works as a nanny."

6. REVIEW OF SYSTEMS (~2 bullet points ONLY):
General + Musculoskeletal ONLY. Do NOT add Neurological, Cardiovascular, Respiratory, or Psychiatric sub-sections.
Reference: "• General: Reports sleep disturbance.\n• Musculoskeletal: Ongoing cervical pain, mid-back discomfort, left shoulder pain, and low back pain affecting activities of daily living."

7. PHYSICAL EXAMINATION (structured by affected region only):
Start with "VITAL SIGNS:" sub-heading + bullets. Use "[XX]" brackets for vitals since these require in-person measurement.
Then "General:" appearance statement (1-2 sentences).
Then one sub-section per AFFECTED SPINE REGION that has source data (typically cervical + lumbar). Each includes: musculoskeletal exam findings with palpation levels, "RANGE OF MOTION:" sub-heading with "• " bullet per movement, orthopedic test results, and brief neurological testing note.
DO NOT add shoulder exam or thoracic exam unless the patient has specific complaints AND the source data contains exam findings for those regions.
Reference ROM format: "• Flexion: Normal 60 / Actual 60 / Pain: No\n• Extension: Normal 50 / Actual 35 / Pain: Yes"

8. RADIOLOGICAL IMAGING FINDINGS:
For each MRI, state "MRI – [Region] ([date]):" then "• " bullets for findings with specific mm measurements. Then "IMPRESSION:" sub-heading repeating key findings. Do NOT add "Technique:" lines, severity ratings, or editorial commentary about missing imaging. Directly restate the MRI findings from the case summary source data.

9. MOTOR / SENSORY / REFLEX SUMMARY (~2-3 sentences):
Brief summary: "Upper and lower extremities without gross motor weakness. Strength normal bilaterally. Sensation intact to light touch overall. Deep tendon reflexes are normal and symmetric in all extremities." Do NOT do dermatome-by-dermatome breakdown, do NOT mention Babinski sign.

10. MEDICAL NECESSITY (~3-5 sentences):
Write a concise paragraph that: (a) correlates clinical exam findings with imaging, (b) names the injury pattern, (c) notes persistent symptoms despite conservative care, (d) concludes that interventional pain management consideration is warranted.
Do NOT restate the mechanism of injury. Do NOT list specific MRI findings (already in imaging section). Do NOT describe PRP mechanism or growth factors. Do NOT restate conservative care timeline/visits.
Reference: "The clinical examination and imaging findings support post-traumatic cervical and lumbar spine injury with associated cervical facet-mediated pain and lumbar discogenic pain, consistent with trauma sustained during the motor vehicle accident of March 12, 2025. Persistent symptoms despite conservative care warrant interventional pain management consideration."

11. DIAGNOSES (simple bullet list):
Use "• ICD-10 — Description" format. NO justification text after each code. NO "supported by..." or "consistent with..." parentheticals.
Reference: "• M50.20 – Cervical Disc Displacement\n• M79.1 – Myalgia / Cervical Region\n• M54.2 – Cervicalgia"

12. TREATMENT PLAN (~2-3 short paragraphs + cost estimate):
Para 1: "Based on the patient's clinical presentation and diagnostic findings, I recommend a series of one to three PRP injections."
Bullet per target region (cervical, lumbar) with specific levels and guidance modality.
Cost estimate sub-section: Professional Fees range + Practice/Surgery Center Fees range.
Para 2: Brief conservative care recommendations — continue OTC medication, home PT program, activity modification, and follow-up timeline. ALL IN ONE PARAGRAPH. Do NOT create separate sub-sections for Medications, Conservative Care, Activity Modification, Additional Diagnostics, and Follow-up.
The entire treatment plan should be about half a page.

13. PATIENT EDUCATION (~1 paragraph):
State that the patient was advised on home exercises, conservative care, nature of injuries, PRP mechanism (briefly — do NOT name specific growth factors like PDGF, TGF-β, VEGF, IGF), expected post-injection course, ergonomic strategies, and prevention of chronic pain. End with "The patient verbalized understanding." Keep to ONE paragraph.

14. PROGNOSIS (~2 sentences):
"Prognosis is guarded to fair given ongoing symptoms and MRI-confirmed pathology. Outcome will depend on response to treatment and adherence to rehabilitation." That's the target length.

15. CLINICIAN DISCLAIMER (~2 short paragraphs):
Standard disclaimer: "This report is for medical-legal assessment of the injury noted and is not to be construed as a complete physical examination for general health purposes. Only those symptoms which are believed to have been involved in the injury or that might relate to the injury have been assessed."
FOLLOWED BY a personalized closing: "It has been a pleasure evaluating [Mr./Ms. Patient Name]. For any further questions or concerns, please contact our office directly."

If source data is sparse for any section, write what can be reasonably inferred from available data. Do not fabricate specific measurements, test results, or vital signs — use brackets only for data that requires in-person examination.`

const INITIAL_VISIT_TOOL: Anthropic.Tool = {
  name: 'generate_initial_visit_note',
  description: 'Generate a comprehensive Initial Visit clinical note matching the provider template',
  input_schema: {
    type: 'object' as const,
    required: [
      'introduction',
      'history_of_accident',
      'chief_complaint',
      'past_medical_history',
      'social_history',
      'review_of_systems',
      'physical_exam',
      'imaging_findings',
      'motor_sensory_reflex',
      'medical_necessity',
      'diagnoses',
      'treatment_plan',
      'patient_education',
      'prognosis',
      'clinician_disclaimer',
    ],
    properties: {
      introduction: {
        type: 'string',
        description: '"To Whom it May Concern" opening paragraph with patient demographics and evaluation context',
      },
      history_of_accident: {
        type: 'string',
        description: 'Detailed narrative of accident mechanism, immediate symptoms, and post-accident course',
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
        description: 'Vital signs, musculoskeletal exam, ROM, orthopedic tests, and neurological findings by region',
      },
      imaging_findings: {
        type: 'string',
        description: 'MRI findings by region with specific measurements, disc levels, pathology, and impressions',
      },
      motor_sensory_reflex: {
        type: 'string',
        description: 'Motor strength, sensation, and DTR summary for upper and lower extremities',
      },
      medical_necessity: {
        type: 'string',
        description: 'Clinical correlation of findings with imaging, conservative care failure, persistent symptoms, functional impairment, and PRP treatment justification',
      },
      diagnoses: {
        type: 'string',
        description: 'ICD-10 diagnosis list based on clinical findings and imaging',
      },
      treatment_plan: {
        type: 'string',
        description: 'PRP injection recommendations with target regions, costs, medications, conservative care, and follow-up',
      },
      patient_education: {
        type: 'string',
        description: 'Education provided about condition, PRP therapy, post-injection course, and activity modification',
      },
      prognosis: {
        type: 'string',
        description: 'Prognosis statement based on symptoms, imaging, and treatment response',
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
}

export async function generateInitialVisitFromData(
  inputData: InitialVisitInputData,
): Promise<{
  data?: InitialVisitNoteResult
  rawResponse?: unknown
  error?: string
}> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 16384,
      system: SYSTEM_PROMPT,
      tools: [INITIAL_VISIT_TOOL],
      tool_choice: { type: 'tool', name: 'generate_initial_visit_note' },
      messages: [
        {
          role: 'user',
          content: `Generate a comprehensive Initial Visit note from the following case data.\n\n${JSON.stringify(inputData, null, 2)}`,
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
    const sectionLabel = sectionLabels[section]

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: `${SYSTEM_PROMPT}\n\nYou are regenerating ONLY the "${sectionLabel}" section of an existing Initial Visit note. Write a fresh version of this section based on the source data. Do not repeat the section title — just provide the content. Follow the exact length targets and conciseness constraints from the section-specific instructions above.`,
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
