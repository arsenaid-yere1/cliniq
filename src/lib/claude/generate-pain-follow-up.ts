import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'node:crypto'
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
The telehealth_observations section may contain only findings directly visible or audible by video, such as general appearance, alertness, speech, visible distress, and gross movement observed on camera.
Do not describe palpation, graded strength, reflexes, or measured range of motion as current findings in telehealth_observations or assessment, even when normal.
When a limitation must be documented, use explicit non-performance language such as: "Palpation was not performed because this was a telehealth encounter."
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
      telehealth_observations:{type:'string',description:'Only findings directly visible or audible during the video encounter. No current palpation, graded strength, reflex, measured range-of-motion, or clinician-obtained vital-sign findings.'},
      imaging_review:{type:'string'},
      assessment:{type:'string',description:'Clinical assessment based on reported history, video-observable findings, imaging, and clearly dated historical findings. No unsupported current hands-on examination findings.'},
      diagnoses:{type:'string'}, treatment_plan:{type:'string'}, patient_education:{type:'string'},
      follow_up:{type:'string'}, clinician_disclaimer:{type:'string'},
      procedure_recommendations:{type:'array',items:{type:'object',required:['recommendation_id','procedure_type','sites','diagnoses','rationale'],properties:{
        recommendation_id:{type:'string',format:'uuid'},procedure_type:{type:'string',enum:['prp','cortisone','hyaluronic','botox']},
        sites:{type:'array',minItems:1,items:{type:'string',minLength:1}},diagnoses:{type:'array',items:{type:'object',required:['icd10_code','description'],properties:{icd10_code:{type:['string','null']},description:{type:'string',minLength:1}}}},rationale:{type:'string',minLength:1},suggested_timing:{type:['string','null']},
      }}},
    },
  },
}

const uuidSchema = z.string().uuid()

function deterministicRecommendationId(value: Record<string, unknown>, index: number) {
  const { recommendation_id: _ignored, ...clinicalContent } = value
  void _ignored
  const hash = createHash('sha256')
    .update(JSON.stringify({ index, ...clinicalContent }))
    .digest('hex')
  const variant = ((Number.parseInt(hash[16], 16) & 0x3) | 0x8).toString(16)
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-${variant}${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

export function normalizePainFollowUpToolOutput(raw: Record<string, unknown>) {
  if (!Array.isArray(raw.procedure_recommendations)) return raw
  return {
    ...raw,
    procedure_recommendations: raw.procedure_recommendations.map((value, index) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value
      const recommendation = value as Record<string, unknown>
      if (uuidSchema.safeParse(recommendation.recommendation_id).success) return recommendation
      return {
        ...recommendation,
        recommendation_id: deterministicRecommendationId(recommendation, index),
      }
    }),
  }
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
      const parsed = painFollowUpNoteResultSchema.safeParse(normalizePainFollowUpToolOutput(raw))
      if (!parsed.success) return { success: false, error: parsed.error }
      const guarded = validateTelehealthFollowUpOutput(parsed.data)
      return guarded.error
        ? { success: false, error: new z.ZodError([{ code: 'custom', path: ['telehealth_observations'], message: guarded.error }]) }
        : { success: true, data: parsed.data }
    },
  })
}
