import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { callClaudeTool } from '@/lib/claude/client'
import { normalizeVisitDiagnoses } from '@/lib/clinical/visit-diagnoses'
import { visitDiagnosisListSchema, type VisitDiagnosis } from '@/lib/validations/clinical-encounter'
import type { CurrentVisitDiagnosisSource } from '@/lib/clinical/current-visit-diagnosis-source'

export const CURRENT_VISIT_DIAGNOSIS_SYSTEM_PROMPT = `You propose provisional ICD-10-CM diagnoses for clinician review.

The input contains only evidence documented for one current visit. Use only that evidence.
- Never infer or import a diagnosis from a case summary, prior visit, other provider, historical diagnosis list, prior procedure, or prior imaging.
- Do not invent findings, laterality, anatomical specificity, neurologic deficits, imaging confirmation, or encounter details.
- Prefer conservative symptom or sign codes when the current evidence does not support a more specific disorder.
- Pain severity alone is not enough to propose a diagnosis.
- Return an empty diagnoses array when the current evidence is insufficient.
- Descriptions must accurately match their ICD-10-CM codes.
- These are provisional suggestions only. A clinician will edit and confirm the final encounter list.`

const TOOL: Anthropic.Tool = {
  name: 'suggest_current_visit_diagnoses',
  description: 'Return provisional ICD-10-CM diagnoses supported by the current visit only',
  input_schema: {
    type: 'object',
    required: ['diagnoses'],
    properties: {
      diagnoses: {
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          required: ['icd10_code', 'description'],
          properties: {
            icd10_code: { type: 'string', minLength: 3, maxLength: 20 },
            description: { type: 'string', minLength: 1, maxLength: 500 },
          },
        },
      },
    },
  },
}

const resultSchema = z.object({ diagnoses: visitDiagnosisListSchema.max(20) }).strict()

export async function suggestVisitDiagnoses(
  source: CurrentVisitDiagnosisSource,
): Promise<{ data?: VisitDiagnosis[]; rawResponse?: unknown; error?: string }> {
  return callClaudeTool<VisitDiagnosis[]>({
    model: 'claude-sonnet-4-6',
    maxTokens: 1600,
    timeoutMs: 20_000,
    apiRetryAttempts: 0,
    zodRetryAttempts: 0,
    system: CURRENT_VISIT_DIAGNOSIS_SYSTEM_PROMPT,
    tools: [TOOL],
    toolName: 'suggest_current_visit_diagnoses',
    messages: [{
      role: 'user',
      content: `Suggest diagnoses supported by this current visit record:\n${JSON.stringify(source, null, 2)}`,
    }],
    parse: (raw) => {
      const parsed = resultSchema.safeParse(raw)
      if (!parsed.success) return { success: false, error: parsed.error }
      try {
        return { success: true, data: normalizeVisitDiagnoses(parsed.data.diagnoses) }
      } catch (error) {
        return {
          success: false,
          error: new z.ZodError([{
            code: 'custom',
            path: ['diagnoses'],
            message: error instanceof Error ? error.message : 'Invalid diagnosis output',
          }]),
        }
      }
    },
  })
}
