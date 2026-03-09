import Anthropic from '@anthropic-ai/sdk'
import {
  initialVisitNoteResultSchema,
  type InitialVisitNoteResult,
  type InitialVisitSection,
} from '@/lib/validations/initial-visit-note'
import { sectionLabels } from '@/lib/validations/initial-visit-note'

const anthropic = new Anthropic()

const SYSTEM_PROMPT = `You are a clinical documentation specialist for a personal injury chiropractic clinic. Your task is to generate a comprehensive Initial Visit note from the provided case data.

Rules:
1. Write in formal clinical Initial Visit note format appropriate for personal injury documentation
2. Use precise medical terminology suitable for legal proceedings
3. Generate narrative prose for each section — not bullet points or structured data
4. For Patient Information: include demographics, accident details, and date of injury
5. For Chief Complaint: write a concise narrative of the patient's primary complaints and mechanism of injury
6. For History of Present Illness: write a detailed chronological narrative of the injury, symptoms, and their progression
7. For Imaging Review: summarize all imaging findings by body region, citing specific pathology
8. For Prior Treatment Summary: describe the treatment course including modalities, frequency, response, and any gaps
9. For Physical Examination: generate a body-region-specific exam template based on the imaging findings and complaints, with common objective findings to be completed by the provider
10. For Assessment: synthesize findings into clinical impressions with diagnoses
11. For Treatment Plan: generate a preliminary treatment plan based on diagnoses, including recommended modalities, frequency, duration, and goals
12. Reference the date of injury and case details throughout the note where clinically appropriate
13. If data is sparse for a section, write what can be reasonably inferred and note limitations`

const INITIAL_VISIT_TOOL: Anthropic.Tool = {
  name: 'generate_initial_visit_note',
  description: 'Generate a comprehensive Initial Visit clinical note from case data',
  input_schema: {
    type: 'object' as const,
    required: [
      'patient_info',
      'chief_complaint',
      'history_of_present_illness',
      'imaging_review',
      'prior_treatment_summary',
      'physical_exam',
      'assessment',
      'treatment_plan',
    ],
    properties: {
      patient_info: {
        type: 'string',
        description: 'Patient demographics, accident details, and date of injury narrative',
      },
      chief_complaint: {
        type: 'string',
        description: 'Concise narrative of primary complaints and mechanism of injury',
      },
      history_of_present_illness: {
        type: 'string',
        description: 'Detailed chronological narrative of injury, symptoms, and progression',
      },
      imaging_review: {
        type: 'string',
        description: 'Summary of all imaging findings by body region',
      },
      prior_treatment_summary: {
        type: 'string',
        description: 'Description of treatment course including modalities, frequency, and response',
      },
      physical_exam: {
        type: 'string',
        description: 'Body-region-specific examination template with common objective findings',
      },
      assessment: {
        type: 'string',
        description: 'Clinical impressions and diagnoses synthesized from all findings',
      },
      treatment_plan: {
        type: 'string',
        description: 'Preliminary treatment plan with recommended modalities, frequency, duration, and goals',
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
      max_tokens: 8192,
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
