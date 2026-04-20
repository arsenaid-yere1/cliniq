import type { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * Tables that carry the `status = 'generating' | 'draft' | 'finalized' | 'failed'`
 * column + `updated_at` and accept an atomic `status` transition as a lightweight
 * row-level lock.
 */
export type GenerationLockTable =
  | 'initial_visit_notes'
  | 'procedure_notes'
  | 'discharge_notes'
  | 'case_summaries'

/**
 * Window after which a row stuck in `'generating'` is assumed abandoned and
 * may be taken over by a new generation attempt. Claude calls cap at roughly
 * 60s per API attempt × 3 retries, plus Anthropic tool-use latency. 5 minutes
 * is well above realistic completion time and well below "provider is still
 * actively waiting on the spinner".
 */
const STALE_GENERATION_MINUTES = 5

/**
 * Atomically acquires the `'generating'` lock on an AI-generated note row.
 * Returns `{ acquired: true }` when this caller won the race to transition
 * the row into `'generating'` state. Returns `{ acquired: false, reason }`
 * when another generation is already in flight AND the row is NOT stale.
 *
 * The lock mechanic is a conditional Postgres UPDATE: `status ∈ {draft, failed}`
 * OR (`status = 'generating' AND updated_at < now() - 5 minutes`). Rows in
 * `'finalized'` state cannot be locked — finalized notes are immutable until
 * unfinalized via a separate action.
 *
 * Not a transactional lock — there is a narrow race window between acquisition
 * and the subsequent narrative-clearing update. The Anthropic call itself is
 * idempotent at the row level: two winners would both overwrite the same row,
 * which is the same outcome as today without the lock. The primary goal is to
 * prevent double-billing on parallel invocations.
 */
export async function acquireGenerationLock(
  supabase: SupabaseServerClient,
  table: GenerationLockTable,
  recordId: string,
  updatedBy: string,
): Promise<{ acquired: true } | { acquired: false; reason: string }> {
  const staleBoundary = new Date(Date.now() - STALE_GENERATION_MINUTES * 60_000).toISOString()

  // First attempt: transition a draft or failed row into 'generating'.
  const draftOrFailed = await supabase
    .from(table)
    .update({ status: 'generating', updated_by_user_id: updatedBy })
    .eq('id', recordId)
    .in('status', ['draft', 'failed'])
    .select('id')
    .maybeSingle()

  if (draftOrFailed.data) return { acquired: true }
  if (draftOrFailed.error) {
    console.warn('[generation-lock] draft/failed acquisition errored', {
      table,
      recordId,
      error: draftOrFailed.error.message,
    })
    return { acquired: false, reason: 'Database error acquiring generation lock.' }
  }

  // Second attempt: take over a stale `'generating'` row (assumed abandoned).
  const staleRecovery = await supabase
    .from(table)
    .update({ status: 'generating', updated_by_user_id: updatedBy })
    .eq('id', recordId)
    .eq('status', 'generating')
    .lt('updated_at', staleBoundary)
    .select('id')
    .maybeSingle()

  if (staleRecovery.data) {
    console.warn('[generation-lock] recovered stale generation', { table, recordId })
    return { acquired: true }
  }
  if (staleRecovery.error) {
    return { acquired: false, reason: 'Database error acquiring generation lock.' }
  }

  console.warn('[generation-lock] rejected — another generation in flight', { table, recordId })
  return {
    acquired: false,
    reason: 'Generation already in progress — please wait a moment and try again.',
  }
}
