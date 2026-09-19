import { describe, it, expect, vi } from 'vitest'
import { createMockSupabase } from '@/test-utils/supabase-mock'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
vi.mock('../review-config',() => ({qualityReviewV3Enabled:() => true}))
import { commitReviewFix } from '../review-fix-target'
const target={runId:'run',noteId:'note',episodeId:'episode',encounterId:'encounter',updatedAt:'version'}
describe('fix commit boundary',() => {
  it('does not attempt a note write after heartbeat renewal failed',async () => {
    const mock=createMockSupabase()
    await expect(commitReviewFix(mock as unknown as SupabaseClient<Database>,'pain_follow_up_notes',{...target,checkLease:async () => {throw new Error('Renewal failed')}},{subjective:'New'})).rejects.toThrow('Renewal failed')
    expect(mock.rpc).not.toHaveBeenCalled()
  })
  it('submits the exact note version and run token to the atomic guard',async () => {
    const mock=createMockSupabase();mock.rpc.mockResolvedValue({data:{id:'note'},error:null})
    expect((await commitReviewFix(mock as unknown as SupabaseClient<Database>,'pain_follow_up_notes',target,{subjective:'New'})).data?.id).toBe('note')
    expect(mock.rpc).toHaveBeenCalledWith('quality_review_save_fix',{p_run_id:'run',p_note_id:'note',p_table:'pain_follow_up_notes',p_expected_updated_at:'version',p_patch:{subjective:'New'}})
  })
  it('does not report success when the guard rejected the save',async () => {
    const mock=createMockSupabase();mock.rpc.mockResolvedValue({data:null,error:{message:'Expired'}})
    expect((await commitReviewFix(mock as unknown as SupabaseClient<Database>,'pain_follow_up_notes',target,{subjective:'New'})).error?.message).toBe('Expired')
  })
})
