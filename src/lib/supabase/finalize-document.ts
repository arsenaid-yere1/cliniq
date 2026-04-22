import type { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * Soft-delete the `documents` row referenced by `documentId` and remove the
 * underlying PDF from the `case-documents` storage bucket. Mirrors the
 * cleanup branch in each `finalize*Note` action so unfinalize can call the
 * same teardown logic without duplicating it.
 *
 * Safe to call with a null/undefined id — no-op.
 * Safe to call when the document row is already soft-deleted — the select
 * filter on `deleted_at IS NULL` makes this a no-op.
 */
export async function softDeleteFinalizedDocument(
  supabase: SupabaseServerClient,
  documentId: string | null | undefined,
  userId: string,
): Promise<void> {
  if (!documentId) return

  const { data: doc } = await supabase
    .from('documents')
    .select('id, file_path')
    .eq('id', documentId)
    .is('deleted_at', null)
    .single()

  if (!doc) return

  await supabase
    .from('documents')
    .update({ deleted_at: new Date().toISOString(), updated_by_user_id: userId })
    .eq('id', doc.id)

  if (doc.file_path) {
    await supabase.storage.from('case-documents').remove([doc.file_path])
  }
}
