import Anthropic from '@anthropic-ai/sdk'
import { callClaudeTool } from '@/lib/claude/client'
import { painFollowUpNoteResultSchema, type PainFollowUpNoteResult } from '@/lib/validations/pain-follow-up-note'
import { validateTelehealthFollowUpOutput } from '@/lib/qc/telehealth-follow-up'
import { z } from 'zod'

export interface PainFollowUpSourceData {
  encounter: Record<string, unknown>
  patient: Record<string, unknown> | null
  provider: Record<string, unknown> | null
  latestCompletedEncounter: Record<string, unknown> | null
  priorEpisodeDischarge: Record<string, unknown> | null
  performedProcedures: Record<string, unknown>[]
}

export const PAIN_FOLLOW_UP_SYSTEM_PROMPT = `You generate a pain-management follow-up note for a remote encounter.
State the modality explicitly. Separate patient-reported history from provider-observed video findings.
Never invent palpation, strength grades, reflexes, measured range-of-motion degrees, procedure vitals, or other hands-on findings.
Prior values are historical comparisons only and must retain their date/source label.
Recommendations remain conditional and must also be emitted as structured procedure_recommendations with stable UUID recommendation_id values.
Do not state that a procedure has been ordered or scheduled.`

const TOOL: Anthropic.Tool = {
  name: 'generate_pain_follow_up',
  description: 'Generate a telehealth pain follow-up note',
  input_schema: {
    type: 'object',
    required: ['subjective','interval_history','review_of_systems','telehealth_observations','imaging_review','assessment','diagnoses','treatment_plan','patient_education','follow_up','clinician_disclaimer','procedure_recommendations'],
    properties: {
      subjective:{type:'string'}, interval_history:{type:'string'}, review_of_systems:{type:'string'},
      telehealth_observations:{type:'string'}, imaging_review:{type:'string'}, assessment:{type:'string'},
      diagnoses:{type:'string'}, treatment_plan:{type:'string'}, patient_education:{type:'string'},
      follow_up:{type:'string'}, clinician_disclaimer:{type:'string'},
      procedure_recommendations:{type:'array',items:{type:'object',required:['recommendation_id','procedure_type','sites','diagnoses','rationale'],properties:{
        recommendation_id:{type:'string'},procedure_type:{type:'string',enum:['prp','cortisone','hyaluronic','botox']},
        sites:{type:'array',items:{type:'string'}},diagnoses:{type:'array',items:{type:'object',required:['icd10_code','description'],properties:{icd10_code:{type:['string','null']},description:{type:'string'}}}},rationale:{type:'string'},suggested_timing:{type:['string','null']},
      }}},
    },
  },
}

export async function generatePainFollowUp(
  source: PainFollowUpSourceData,
  regeneration?: { section: string; message: string; rationale: string | null },
): Promise<{ data?: PainFollowUpNoteResult; rawResponse?: unknown; error?: string }> {
  const regenerationInstruction = regeneration
    ? `\nRegenerate the ${regeneration.section} section to address this quality finding: ${regeneration.message}${regeneration.rationale ? ` (${regeneration.rationale})` : ''}. Keep all source boundaries and telehealth safeguards.`
    : ''
  return callClaudeTool<PainFollowUpNoteResult>({
    model: 'claude-sonnet-4-6', maxTokens: 6000, system: PAIN_FOLLOW_UP_SYSTEM_PROMPT,
    tools: [TOOL], toolName: 'generate_pain_follow_up',
    messages: [{ role: 'user', content: `Create the follow-up from these labeled sources:\n${JSON.stringify(source, null, 2)}${regenerationInstruction}` }],
    parse: (raw) => {
      const parsed = painFollowUpNoteResultSchema.safeParse(raw)
      if (!parsed.success) return { success: false, error: parsed.error }
      const guarded = validateTelehealthFollowUpOutput(parsed.data)
      return guarded.error
        ? { success: false, error: new z.ZodError([{ code: 'custom', path: ['telehealth_observations'], message: guarded.error }]) }
        : { success: true, data: parsed.data }
    },
  })
}
