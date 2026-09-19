import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import { qualityReviewV3Enabled } from './review-config'

export type ReviewFixTarget = {runId:string;noteId:string;episodeId:string;encounterId:string;updatedAt:string;checkLease?:() => Promise<void>}
export async function commitReviewFix(client: SupabaseClient<Database>,table: string,target: ReviewFixTarget,patch: Record<string,unknown>): Promise<{data:Record<string,unknown>|null;error:{message:string}|null}> {
  if (!qualityReviewV3Enabled()) return {data:null,error:{message:'Quality Review fixes are disabled'}}
  await target.checkLease?.()
  const result = await client.rpc('quality_review_save_fix',{p_run_id:target.runId,p_table:table,p_note_id:target.noteId,p_expected_updated_at:target.updatedAt,p_patch:patch as Json})
  if (result.error) return {data:null,error:result.error}
  if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) return {data:null,error:{message:'Fix save returned no note'}}
  return {data:result.data,error:null}
}
