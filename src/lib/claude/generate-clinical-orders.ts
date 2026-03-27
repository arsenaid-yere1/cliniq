import Anthropic from '@anthropic-ai/sdk'
import {
  imagingOrderResultSchema,
  chiropracticOrderResultSchema,
  type ImagingOrderResult,
  type ChiropracticOrderResult,
} from '@/lib/validations/clinical-orders'

const anthropic = new Anthropic()

// --- Shared input shape ---

export interface ClinicalOrderInputData {
  patientInfo: {
    first_name: string
    last_name: string
    date_of_birth: string | null
    gender: string | null
  }
  diagnoses: string // The diagnoses section text from the finalized note
  chiefComplaint: string | null // The chief complaint section text
  treatmentPlan: string | null // The treatment plan section text
  providerInfo: {
    display_name: string | null
    credentials: string | null
    npi_number: string | null
  }
  clinicInfo: {
    clinic_name: string | null
    address_line1: string | null
    city: string | null
    state: string | null
    zip_code: string | null
    phone: string | null
    fax: string | null
  }
  dateOfVisit: string
}

// --- Imaging Orders ---

const IMAGING_ORDER_TOOL: Anthropic.Tool = {
  name: 'generate_imaging_orders',
  description: 'Generate structured imaging orders based on an Initial Visit note',
  input_schema: {
    type: 'object' as const,
    required: ['patient_name', 'date_of_order', 'ordering_provider', 'ordering_provider_npi', 'orders'],
    properties: {
      patient_name: { type: 'string', description: 'Full patient name' },
      date_of_order: { type: 'string', description: 'Date of the order (MM/DD/YYYY)' },
      ordering_provider: { type: 'string', description: 'Provider name with credentials' },
      ordering_provider_npi: { type: ['string', 'null'], description: 'Provider NPI number' },
      orders: {
        type: 'array',
        description: 'Individual imaging orders',
        items: {
          type: 'object',
          required: ['body_region', 'modality', 'icd10_codes', 'clinical_indication'],
          properties: {
            body_region: { type: 'string', description: 'Body region to image (e.g., "Cervical Spine")' },
            modality: { type: 'string', description: 'Imaging modality (e.g., "MRI", "X-Ray", "CT")' },
            icd10_codes: { type: 'array', items: { type: 'string' }, description: 'Relevant ICD-10 codes from the diagnoses' },
            clinical_indication: { type: 'string', description: 'Clinical reason for the imaging order' },
          },
        },
      },
    },
  },
}

export async function generateImagingOrders(
  inputData: ClinicalOrderInputData,
): Promise<{ data?: ImagingOrderResult; rawResponse?: unknown; error?: string }> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: `You are a clinical documentation specialist generating imaging orders based on an Initial Visit note from a personal injury pain management clinic.

Generate imaging orders for each affected body region identified in the diagnoses and treatment plan. Each order should include:
- The body region (e.g., "Cervical Spine", "Lumbar Spine")
- The imaging modality (typically "MRI" for personal injury cases)
- The relevant ICD-10 codes from the diagnoses that justify the imaging
- A brief clinical indication explaining why the imaging is needed

Only generate orders for regions that are explicitly mentioned in the diagnoses or treatment plan. Do NOT add imaging for regions not referenced in the clinical data.`,
      tools: [IMAGING_ORDER_TOOL],
      tool_choice: { type: 'tool', name: 'generate_imaging_orders' },
      messages: [
        {
          role: 'user',
          content: `Generate imaging orders based on this Initial Visit note data:\n\n${JSON.stringify(inputData, null, 2)}`,
        },
      ],
    })

    const toolBlock = response.content.find((b) => b.type === 'tool_use')
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      return { error: 'No tool use response from Claude' }
    }

    const raw = toolBlock.input as Record<string, unknown>
    const validated = imagingOrderResultSchema.safeParse(raw)
    if (!validated.success) {
      return { error: 'Order output failed validation', rawResponse: raw }
    }

    return { data: validated.data, rawResponse: raw }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Claude API call failed' }
  }
}

// --- Chiropractic Therapy Order ---

const CHIRO_ORDER_TOOL: Anthropic.Tool = {
  name: 'generate_chiropractic_order',
  description: 'Generate a structured chiropractic therapy order based on an Initial Visit note',
  input_schema: {
    type: 'object' as const,
    required: ['patient_name', 'date_of_order', 'referring_provider', 'referring_provider_npi', 'diagnoses', 'treatment_plan'],
    properties: {
      patient_name: { type: 'string', description: 'Full patient name' },
      date_of_order: { type: 'string', description: 'Date of the order (MM/DD/YYYY)' },
      referring_provider: { type: 'string', description: 'Referring provider name with credentials' },
      referring_provider_npi: { type: ['string', 'null'], description: 'Provider NPI number' },
      diagnoses: {
        type: 'array',
        description: 'ICD-10 diagnoses relevant to chiropractic care',
        items: {
          type: 'object',
          required: ['code', 'description'],
          properties: {
            code: { type: 'string', description: 'ICD-10 code' },
            description: { type: 'string', description: 'Diagnosis description' },
          },
        },
      },
      treatment_plan: {
        type: 'object',
        required: ['frequency', 'duration', 'modalities', 'goals'],
        properties: {
          frequency: { type: 'string', description: 'Treatment frequency (e.g., "3 times per week")' },
          duration: { type: 'string', description: 'Treatment duration (e.g., "8-12 weeks")' },
          modalities: { type: 'array', items: { type: 'string' }, description: 'Treatment modalities' },
          goals: { type: 'array', items: { type: 'string' }, description: 'Treatment goals' },
        },
      },
      special_instructions: { type: ['string', 'null'], description: 'Special instructions for the chiropractor' },
      precautions: { type: ['string', 'null'], description: 'Precautions or contraindications' },
    },
  },
}

export async function generateChiropracticOrder(
  inputData: ClinicalOrderInputData,
): Promise<{ data?: ChiropracticOrderResult; rawResponse?: unknown; error?: string }> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: `You are a clinical documentation specialist generating a chiropractic therapy referral order based on an Initial Visit note from a personal injury pain management clinic.

Generate a chiropractic therapy order that includes:
- Relevant ICD-10 diagnoses from the note (musculoskeletal codes only — exclude external cause codes like V43.52XA)
- A treatment plan with: frequency (typically 2-3 times per week initially), duration (typically 8-12 weeks), treatment modalities (spinal manipulation, soft tissue mobilization, therapeutic exercises, electrical stimulation, etc.), and measurable treatment goals
- Special instructions if applicable (e.g., "Avoid high-velocity thrust to cervical spine until imaging reviewed")
- Precautions based on the clinical presentation

Base all recommendations on the clinical data provided. Do NOT recommend treatments for regions not mentioned in the diagnoses.`,
      tools: [CHIRO_ORDER_TOOL],
      tool_choice: { type: 'tool', name: 'generate_chiropractic_order' },
      messages: [
        {
          role: 'user',
          content: `Generate a chiropractic therapy order based on this Initial Visit note data:\n\n${JSON.stringify(inputData, null, 2)}`,
        },
      ],
    })

    const toolBlock = response.content.find((b) => b.type === 'tool_use')
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      return { error: 'No tool use response from Claude' }
    }

    const raw = toolBlock.input as Record<string, unknown>
    const validated = chiropracticOrderResultSchema.safeParse(raw)
    if (!validated.success) {
      return { error: 'Order output failed validation', rawResponse: raw }
    }

    return { data: validated.data, rawResponse: raw }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Claude API call failed' }
  }
}
