import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockSupabase } from '@/test-utils/supabase-mock'
import type { ReviewSnapshot, ReviewNoteStep } from '@/lib/qc/review-types'
import { identifyFinding } from '@/lib/qc/review-identity'
import type { GroundedFinding } from '@/lib/qc/review-findings'
const mocks = vi.hoisted(() => ({client:vi.fn(),enabled:vi.fn(),published:vi.fn(),snapshot:vi.fn(),operation:vi.fn(),publish:vi.fn(),regen:vi.fn()}))
vi.mock('@/lib/supabase/server',() => ({createClient:mocks.client}))
vi.mock('next/cache',() => ({revalidatePath:vi.fn()}))
vi.mock('@/actions/case-status',() => ({assertCaseNotClosed:vi.fn(async () => ({}))}))
vi.mock('@/lib/qc/review-config',() => ({qualityReviewV3Enabled:mocks.enabled}))
vi.mock('@/lib/qc/review-service',() => ({loadPublishedReview:mocks.published,reviewOperation:mocks.operation,publishGroundedReview:mocks.publish,startReviewHeartbeat:() => ({progress:vi.fn(),check:vi.fn(),stop:vi.fn()})}))
vi.mock('@/lib/qc/review-source',async original => ({...await original<typeof import('@/lib/qc/review-source')>(),collectStableReviewSnapshot:mocks.snapshot}))
vi.mock('@/lib/clinical/episode-context',() => ({getActiveOrLatestEpisode:vi.fn(async () => ({id:'episode',status:'active'}))}))
vi.mock('@/actions/initial-visit-notes',() => ({regenerateNoteSection:mocks.regen}))
vi.mock('@/actions/procedure-notes',() => ({regenerateProcedureNoteSectionAction:mocks.regen}))
vi.mock('@/actions/discharge-notes',() => ({regenerateDischargeNoteSectionAction:mocks.regen}))
vi.mock('@/actions/pain-follow-up-notes',() => ({regeneratePainFollowUpSectionAction:mocks.regen}))
import { actOnQualityFinding } from '../case-quality-review-findings'
const noteId='11111111-1111-4111-8111-111111111111',encounterId='22222222-2222-4222-8222-222222222222',runId='33333333-3333-4333-8333-333333333333'
let client: ReturnType<typeof createMockSupabase>
let snapshot: ReviewSnapshot
let finding: GroundedFinding
let row: {id:string;review_version:string;findings:GroundedFinding[];finding_overrides:Record<string,unknown>}
function setup(step: ReviewNoteStep = 'pain_follow_up') {
  const table={initial_visit:'initial_visit_notes',pain_evaluation:'initial_visit_notes',procedure:'procedure_notes',discharge:'discharge_notes',pain_follow_up:'pain_follow_up_notes'}[step]
  snapshot={version:'qc-v3',case_id:'case',episode_id:'episode',episode_status:'active',notes:[{id:noteId,step,episode_id:'episode',encounter_id:encounterId,procedure_id:step==='procedure'?runId:null,status:'draft',date:'2026-01-01',sections:{diagnoses:'M54.50',subjective:'Current prose'},context:{encounter:{modality:'telehealth',status:'in_progress'}},decision:{state:'absent',decision:null,details:null,reviewed_plan:null,visit_date:null}}],sources:[{id:`${table}:${noteId}`,type:table,scope:'episode',date:null,fields:{diagnoses:'M54.50',subjective:'Current prose'}}],versions:[{source_id:`${table}:${noteId}`,updated_at:'2026-01-01T00:00:00Z'}],coverage:{complete:true,limitations:[]}}
  finding=identifyFinding({rule_id:'m545_parent',entity_key:'M54.5',severity:'warning',score:5,step,note_id:noteId,procedure_id:step==='procedure'?runId:null,encounter_id:encounterId,section_key:step==='procedure'?'subjective':'diagnoses',message:'Parent code',rationale:null,suggested_tone_hint:null,evidence:[{source_id:`${table}:${noteId}`,field:'diagnoses',quote:'M54.50',missing:false}]},snapshot,'deterministic')
  row={id:'review',review_version:'qc-v3',findings:[finding],finding_overrides:{}}
  mocks.published.mockImplementation(async () => row)
  mocks.snapshot.mockImplementation(async () => snapshot)
}
beforeEach(() => {
  vi.clearAllMocks()
  client=createMockSupabase();client.auth.getUser.mockResolvedValue({data:{user:{id:runId}},error:null})
  mocks.client.mockResolvedValue(client);mocks.enabled.mockReturnValue(true)
  mocks.operation.mockResolvedValue({id:runId});mocks.publish.mockResolvedValue({id:'next',findings:[]});mocks.regen.mockResolvedValue({data:{success:true}})
  client.rpc.mockImplementation(async (_name,args) => ({data:{finding_overrides:{[args.p_finding_key]:args.p_entry}},error:null}))
  setup()
})
describe('specific Quality Review actions', () => {
  it('rejects stale review identity before mutating',async () => {
    expect((await actOnQualityFinding('case','old',finding.key!,'resolve')).error).toContain('Review changed')
    expect(client.rpc).not.toHaveBeenCalled()
  })
  it('verifies the specific current rule without changing source notes',async () => {
    expect((await actOnQualityFinding('case','review',finding.key!,'verify')).data?.resolved).toBe(true)
    expect(client.rpc).toHaveBeenCalledWith('quality_review_disposition',expect.objectContaining({p_entry:expect.objectContaining({resolution_source:'manual_verify'})}))
    expect(mocks.regen).not.toHaveBeenCalled()
  })
  it('does not resolve a still-present parent code',async () => {
    snapshot.notes[0].sections.diagnoses='M54.5'
    expect((await actOnQualityFinding('case','review',finding.key!,'verify')).data?.resolved).toBe(false)
    expect(client.rpc).not.toHaveBeenCalled()
  })
  it('does not verify arbitrary AI findings from a clean plan signal',async () => {
    setup('procedure');finding.provenance='ai';finding.rule_id='anatomy_consistency'
    snapshot.notes[0].context.plan_alignment_status='aligned'
    expect((await actOnQualityFinding('case','review',finding.key!,'verify')).error).toContain('deterministic Verify is unavailable')
    expect(client.rpc).not.toHaveBeenCalled()
  })
  it('does not verify missing or unfinished targets',async () => {
    snapshot.notes=[]
    expect((await actOnQualityFinding('case','review',finding.key!,'verify')).error).toContain('missing or unfinished')
    expect(client.rpc).not.toHaveBeenCalled()
  })
  it('records clinician resolution separately from verification',async () => {
    await actOnQualityFinding('case','review',finding.key!,'resolve')
    expect(client.rpc.mock.calls[0][1].p_entry.resolution_source).toBe('manual_resolve')
  })
  it.each(['initial_visit','pain_evaluation','procedure','discharge','pain_follow_up'] as ReviewNoteStep[])('fixes %s with an exact fenced target and rechecks',async step => {
    setup(step)
    const result=await actOnQualityFinding('case','review',finding.key!,'fix')
    expect(result.data?.outcome).toBe('applied_and_not_detected')
    expect(mocks.regen.mock.calls[0].at(-1)).toMatchObject({noteId,episodeId:'episode',encounterId,runId,updatedAt:'2026-01-01T00:00:00Z'})
    expect(mocks.publish).toHaveBeenCalledTimes(1)
  })
  it('reports a surviving issue instead of claiming resolution',async () => {
    mocks.publish.mockResolvedValue({id:'new',findings:[finding]})
    expect((await actOnQualityFinding('case','review',finding.key!,'fix')).data?.outcome).toBe('applied_but_still_present')
  })
  it('distinguishes a saved note from a failed recheck and restores prior disposition',async () => {
    mocks.publish.mockRejectedValue(new Error('Synthetic save failure'))
    const result=await actOnQualityFinding('case','review',finding.key!,'fix')
    expect(result.data?.outcome).toBe('applied_recheck_failed')
    expect(result.error).toContain('note was updated')
    expect(client.rpc.mock.calls.at(-1)?.[1].p_entry).toBeNull()
    expect(client.rpc.mock.calls.at(-1)?.[1].p_expected_entry.fix_run_id).toBe(runId)
  })
  it('preserves newer clinician edits if cleanup conflicts',async () => {
    mocks.regen.mockResolvedValue({error:'Regeneration failed'})
    client.rpc.mockResolvedValueOnce({data:{finding_overrides:{[finding.key!]:{status:'fix_in_progress',fix_run_id:runId}}},error:null}).mockResolvedValueOnce({data:null,error:{message:'Disposition changed'}})
    expect((await actOnQualityFinding('case','review',finding.key!,'fix')).error).toContain('disposition changed')
  })
  it('recovers an abandoned fix through the database lease',async () => {
    row.finding_overrides[finding.key!] = {status:'fix_in_progress',fix_run_id:'old'}
    expect((await actOnQualityFinding('case','review',finding.key!,'fix')).data?.outcome).toBe('applied_and_not_detected')
    expect(mocks.operation).toHaveBeenCalledWith(client,'begin','case','episode',expect.objectContaining({kind:'fix'}))
  })
  it('rejects signed notes and unknown sections before regeneration',async () => {
    snapshot.notes[0].status='finalized'
    expect((await actOnQualityFinding('case','review',finding.key!,'fix')).error).toContain('editable draft')
    snapshot.notes[0].status='draft';finding.section_key='invented'
    expect((await actOnQualityFinding('case','review',finding.key!,'fix')).error).toContain('editable draft')
    expect(mocks.regen).not.toHaveBeenCalled()
  })
})
