import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { createMockSupabase, mockTableResults } from '@/test-utils/supabase-mock'
import type { ReviewSnapshot } from '../review-types'
const mocks = vi.hoisted(() => ({generate:vi.fn(),collect:vi.fn(),stable:vi.fn()}))
vi.mock('@/lib/claude/generate-quality-review',() => ({generateGroundedQualityReview:mocks.generate}))
vi.mock('../review-source',async importOriginal => ({...await importOriginal<typeof import('../review-source')>(),collectReviewSnapshot:mocks.collect,collectStableReviewSnapshot:mocks.stable}))
vi.mock('@/lib/supabase/server',() => ({createClient:vi.fn()}))
import { identifyFinding } from '../review-identity'
import { runGroundedReview, startReviewHeartbeat } from '../review-service'
const snapshot: ReviewSnapshot = {version:'qc-v3',case_id:'case',episode_id:'episode',episode_status:'active',notes:[],sources:[],versions:[],coverage:{complete:false,limitations:['Missing origin note']}}
let mock: ReturnType<typeof createMockSupabase>
let client: SupabaseClient<Database>
beforeEach(() => {
  vi.clearAllMocks()
  mock = createMockSupabase()
  client = mock as unknown as SupabaseClient<Database>
  mockTableResults(mock,{case_quality_reviews:{data:{id:'previous',updated_at:'version',findings:[],finding_overrides:{}},error:null}})
  mocks.generate.mockResolvedValue({data:{findings:[],coverage_limited:false}})
  mocks.collect.mockResolvedValue(snapshot)
  mocks.stable.mockResolvedValue(snapshot)
  mock.rpc.mockImplementation(async (_name,args) => ({data:{id:args.p_action === 'begin' ? 'run' : 'published'},error:null}))
})
afterEach(() => vi.useRealTimers())
describe('transactional review orchestration', () => {
  it('publishes only after successful generation and current-source validation',async () => {
    expect(await runGroundedReview(client,'case','episode')).toEqual({data:{id:'published'}})
    expect(mock.rpc.mock.calls.map(([,args]) => args.p_action)).toEqual(['begin','publish'])
    expect(mock.rpc.mock.calls[1][1].p_payload).toMatchObject({expected_review_id:'previous',expected_updated_at:'version',overall_assessment:'incomplete'})
  })
  it('reopens a finding that returns after an intervening nondetection',async () => {
    const finding = identifyFinding({rule_id:'symptom_consistency',entity_key:'',severity:'warning',score:5,step:'cross_step',note_id:null,procedure_id:null,encounter_id:null,section_key:null,message:'Returned issue',rationale:null,suggested_tone_hint:null,evidence:[{source_id:'a',field:'first',quote:'Left',missing:false},{source_id:'a',field:'second',quote:'Right',missing:false}]},snapshot,'ai')
    mocks.generate.mockResolvedValue({data:{findings:[finding],coverage_limited:false}})
    mockTableResults(mock,{case_quality_reviews:{data:{id:'previous',updated_at:'version',findings:[],finding_overrides:{}},error:null},case_quality_review_runs:{data:[{finding_transitions:[{key:finding.key,outcome:'not_detected'}]}],error:null}})
    expect((await runGroundedReview(client,'case','episode')).data?.id).toBe('published')
    expect(mock.rpc.mock.calls.find(([,args]) => args.p_action === 'publish')?.[1].p_payload.transitions).toEqual([expect.objectContaining({key:finding.key,outcome:'recurring'})])
  })
  it('records a model failure without replacing the previous review',async () => {
    mocks.generate.mockResolvedValue({error:'Synthetic model failure'})
    expect((await runGroundedReview(client,'case','episode')).error).toContain('Synthetic model failure')
    expect(mock.rpc.mock.calls.map(([,args]) => args.p_action)).toEqual(['begin','fail'])
  })
  it('does not invoke the model when collection fails',async () => {
    mocks.stable.mockRejectedValue(new Error('Unable to load source'))
    expect((await runGroundedReview(client,'case','episode')).error).toContain('Unable to load source')
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it('rejects results when source versions changed',async () => {
    mocks.collect.mockResolvedValue({...snapshot,versions:[{source_id:'note',updated_at:'changed'}]})
    expect((await runGroundedReview(client,'case','episode')).error).toContain('sources changed')
    expect(mock.rpc.mock.calls.at(-1)?.[1].p_payload.status).toBe('superseded')
  })
  it('reconciles a publication conflict without repeating the model call',async () => {
    let published = 0
    mock.rpc.mockImplementation(async (_name,args) => ({data:args.p_action === 'publish' && published++ === 0 ? {conflict:true} : {id:'result'},error:null}))
    expect((await runGroundedReview(client,'case','episode')).data?.id).toBe('result')
    expect(mocks.generate).toHaveBeenCalledTimes(1)
    expect(mocks.collect).toHaveBeenCalledTimes(2)
  })
  it('stops after three disposition conflicts',async () => {
    mock.rpc.mockImplementation(async (_name,args) => ({data:args.p_action === 'publish' ? {conflict:true} : {id:'run'},error:null}))
    expect((await runGroundedReview(client,'case','episode')).error).toContain('kept changing')
    expect(mocks.generate).toHaveBeenCalledTimes(1)
    expect(mocks.collect).toHaveBeenCalledTimes(3)
  })
  it('reports publication and failure-recording failures truthfully',async () => {
    mock.rpc.mockImplementation(async (_name,args) => args.p_action === 'begin' ? {data:{id:'run'},error:null} : {data:null,error:{message:'Database unavailable'}})
    expect((await runGroundedReview(client,'case','episode')).error).toContain('attempt status could not be saved')
  })
  it('does not publish after a heartbeat failure during generation',async () => {
    vi.useFakeTimers()
    mock.rpc.mockImplementation(async (_name,args) => args.p_action === 'heartbeat' ? {data:null,error:{message:'Heartbeat unavailable'}} : {data:{id:'run'},error:null})
    mocks.generate.mockImplementation(async () => {await vi.advanceTimersByTimeAsync(15_000);return {data:{findings:[],coverage_limited:false}}})
    expect((await runGroundedReview(client,'case','episode')).error).toContain('Heartbeat unavailable')
    expect(mock.rpc.mock.calls.some(([,args]) => args.p_action === 'publish')).toBe(false)
  })
  it('renews independently of model progress and exposes renewal failure',async () => {
    vi.useFakeTimers()
    const heartbeat = startReviewHeartbeat(client,'case','episode','run')
    await vi.advanceTimersByTimeAsync(15_000)
    expect(mock.rpc).toHaveBeenCalledWith('quality_review_run',expect.objectContaining({p_action:'heartbeat'}))
    mock.rpc.mockResolvedValue({data:null,error:{message:'Expired'}})
    await vi.advanceTimersByTimeAsync(15_000)
    await expect(heartbeat.check()).rejects.toThrow('Expired')
    await heartbeat.stop()
    const calls = mock.rpc.mock.calls.length
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mock.rpc).toHaveBeenCalledTimes(calls)
  })
})
