import 'server-only'
import { randomUUID } from 'node:crypto'
import type { createClient } from '@/lib/supabase/server'
import type { InitialVisitSection } from '@/lib/validations/initial-visit-note'
import { VISIT_DECISION_VALIDATOR_VERSION } from '@/lib/claude/visit-decision-output'
import { serializeValidationFailure, type ValidationFailureHook } from '@/lib/claude/validation-diagnostics'

type Client = Awaited<ReturnType<typeof createClient>>
interface Context {
  caseId: string
  noteId: string
  sourceHash: string
  section?: InitialVisitSection
}

/** A separate run for every action invocation, including section regeneration.
 * The caller/client owns sanitized failure reporting; this adapter never logs PHI. */
export function createInitialVisitFailureCapture(supabase: Client, context: Context): ValidationFailureHook {
  const runId = randomUUID()
  return async (failure) => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        Promise.resolve(supabase.rpc('record_initial_visit_generation_failure', {
          p_case_id: context.caseId,
          p_note_id: context.noteId,
          p_run_id: runId,
          p_operation: context.section ? 'section' : 'full',
          p_section: context.section ?? null,
          p_source_hash: context.sourceHash,
          p_prompt_version: '2',
          p_validator_version: VISIT_DECISION_VALIDATOR_VERSION,
          p_payload: serializeValidationFailure(failure),
        }).abortSignal(controller.signal)).then(({ error }) => {
          if (error) throw new Error('Diagnostic storage unavailable')
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort()
            reject(new Error('Diagnostic storage timeout'))
          }, 3000)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
