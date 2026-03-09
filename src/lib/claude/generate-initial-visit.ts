import Anthropic from '@anthropic-ai/sdk'
import {
  initialVisitNoteResultSchema,
  type InitialVisitNoteResult,
  type InitialVisitSection,
} from '@/lib/validations/initial-visit-note'
import { sectionLabels } from '@/lib/validations/initial-visit-note'

const anthropic = new Anthropic()

const SYSTEM_PROMPT = `You are a clinical documentation specialist for a personal injury pain management clinic. Generate a comprehensive Initial Visit note that matches the clinic's standard document format.

This document is for medical-legal assessment of injuries sustained in a motor vehicle accident or other personal injury event. It will be reviewed by attorneys, insurance adjusters, and opposing medical experts. Use precise medical terminology and formal clinical prose throughout.

CRITICAL FORMATTING RULES — the output will be rendered in a PDF document that does NOT support markdown. You MUST follow these rules exactly:
- For bullet points, use the "• " character (unicode bullet followed by a space) at the start of a line. NEVER use "- ", "* ", or any markdown bullet syntax.
- For sub-headings within a section, write them in ALL CAPS followed by a colon on their own line (e.g., "VITAL SIGNS:" or "CERVICAL SPINE EXAMINATION:"). NEVER use markdown heading syntax like "###" or "**bold**".
- NEVER use markdown bold syntax (**text**). Use ALL CAPS for emphasis if needed.
- NEVER use markdown table syntax (pipes |, dashes ---). For tabular data like Range of Motion, use a simple list format with one line per measurement (e.g., "• Flexion: Normal 50° / Actual 40° / Pain: Yes").
- NEVER use markdown horizontal rules (---).
- Use plain line breaks between paragraphs. Use a single blank line to separate paragraphs or sub-sections.

Section-specific instructions:

1. INTRODUCTION: Write a "To Whom it May Concern" opening paragraph. State the patient's age, gender, reason for evaluation (pain management evaluation due to injuries sustained in [accident type]), date of injury, and that the document contains the patient's history, comprehensive physical examination, diagnostic studies, and treatment recommendations.

2. HISTORY OF THE ACCIDENT: Write a detailed narrative of the accident mechanism. Include: vehicle position, point of impact, seatbelt/airbag status, loss of consciousness, immediate symptoms, paramedic/ER response, and initial post-accident actions. End with a paragraph about seeking conservative treatment and obtaining imaging. Include a final paragraph noting that despite conservative treatment, the patient continues to complain of pain and functional deficits with ADLs.

3. CHIEF COMPLAINT: List each complaint using "• " bullet points with: body region, pain character (persistent/intermittent), pain rating (X/10), radiation status, aggravating factors, and alleviating factors. Include sleep disturbance if applicable.

4. PAST MEDICAL HISTORY: Use "• " bullet points for: Medical Problems, Surgeries, Medications Prior to Visit, Allergies. Use ALL CAPS sub-headings for each category.

5. SOCIAL HISTORY: Use "• " bullet points for: Smoking/Drinking status, Occupation.

6. REVIEW OF SYSTEMS: Use "• " bullet points organized by system. Use ALL CAPS sub-headings for each system (e.g., "GENERAL:", "MUSCULOSKELETAL:").

7. PHYSICAL EXAMINATION: Start with a "VITAL SIGNS:" sub-heading followed by "• " bullet points (BP, HR, RR, Temp, SpO2, Pain Level). Then for each affected spine region use an ALL CAPS sub-heading (e.g., "CERVICAL SPINE EXAMINATION:"). Include musculoskeletal examination findings, palpation findings with specific levels. For ROM testing, use a "RANGE OF MOTION:" sub-heading followed by "• " bullet points, one per movement (e.g., "• Flexion: Normal 50° / Actual 40° / Pain: Yes"). Include orthopedic test results and neurological testing results.

8. RADIOLOGICAL IMAGING FINDINGS: For each MRI, include the date and use "• " bullet points for findings with specific measurements (mm), disc levels, and pathology. Use an "IMPRESSION:" sub-heading to repeat key findings.

9. MOTOR / SENSORY / REFLEX SUMMARY: Brief paragraph summarizing upper and lower extremity motor strength, sensation, and DTR findings.

10. MEDICAL NECESSITY: This is the critical medical-legal justification section. Write a narrative that correlates clinical examination findings with imaging pathology, documents the failure of conservative treatment despite adequate trial, describes persistent symptoms and their impact on ADLs and quality of life, establishes the medical rationale for interventional pain management (PRP therapy), uses language appropriate for insurance authorization and legal proceedings, and concludes that persistent symptoms despite conservative care warrant interventional pain management consideration.

11. DIAGNOSES: List each diagnosis using "• " bullet points with ICD-10 code and description (e.g., "• M50.20 - Cervical Disc Displacement"). Generate appropriate codes based on the clinical findings and imaging.

12. TREATMENT PLAN: Recommend a series of PRP injections. Include specific target regions (cervical and/or lumbar) with disc/facet levels, guidance modality (ultrasound guidance), estimated cost per injection (Professional Fees and Practice/Surgery Center Fees), medication recommendations, conservative care and home exercise program recommendations, activity modification guidance, and follow-up timeline. Use "• " bullet points for lists.

13. PATIENT EDUCATION: Describe the education provided to the patient about their condition, PRP therapy mechanism, expected post-injection course, activity modification, ergonomic strategies, and prevention of chronic pain syndromes. End with "The patient verbalized understanding."

14. PROGNOSIS: Brief statement of prognosis (guarded to fair) based on ongoing symptoms, imaging-confirmed pathology, and dependence on treatment response.

15. CLINICIAN DISCLAIMER: Write the standard medical-legal disclaimer: "This report is for medical-legal assessment of the injury noted and is not to be construed as a complete physical examination for general health purposes. Only those symptoms which are believed to have been involved in the injury or that might relate to the injury have been assessed."

If source data is sparse for any section, write what can be reasonably inferred from available data and note limitations. Do not fabricate specific measurements, test results, or vital signs that are not supported by the source data — instead generate a clinically appropriate template for the provider to complete.`

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
      system: `${SYSTEM_PROMPT}\n\nYou are regenerating ONLY the "${sectionLabel}" section of an existing Initial Visit note. Write a fresh version of this section based on the source data. Do not repeat the section title — just provide the content.`,
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
