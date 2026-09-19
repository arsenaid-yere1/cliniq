import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReviewSnapshot } from '@/lib/qc/review-types'
const call = vi.hoisted(() => vi.fn())
vi.mock('../client',() => ({callClaudeTool:call}))
import { generateGroundedQualityReview } from '../generate-quality-review'
const noteId = '11111111-1111-4111-8111-111111111111'
const encounterId = '22222222-2222-4222-8222-222222222222'
const snapshot: ReviewSnapshot = {version:'qc-v3',case_id:'case',episode_id:'episode',episode_status:'active',coverage:{complete:true,limitations:[]},versions:[],notes:[{id:noteId,step:'pain_follow_up',episode_id:'episode',encounter_id:encounterId,procedure_id:null,status:'draft',date:'2026-01-01',sections:{assessment:'Left pain',subjective:'Right pain'},context:{},decision:{state:'absent',decision:null,details:null,reviewed_plan:null,visit_date:null}}],sources:[{id:`pain_follow_up_notes:${noteId}`,type:'pain_follow_up_notes',scope:'episode',date:null,fields:{assessment:'Left pain',subjective:'Right pain'}}]}
function finding() {return {rule_id:'anatomy_consistency',entity_key:'',severity:'warning',score:9,step:'pain_follow_up',note_id:noteId,encounter_id:encounterId,procedure_id:null,section_key:'assessment',message:'Side conflict',rationale:null,suggested_tone_hint:null,evidence:[{source_id:`pain_follow_up_notes:${noteId}`,field:'assessment',quote:'Left pain',missing:false},{source_id:`pain_follow_up_notes:${noteId}`,field:'subjective',quote:'Right pain',missing:false}]}}
beforeEach(() => {call.mockReset()})
describe('grounded model contract', () => {
  it('serializes saved context and validates references inside the retry parser',async () => {
    call.mockImplementation(async options => {
      expect(options.system).toContain('Follow-ups are optional')
      expect(options.messages[0].content).toContain('Left pain')
      expect(options.messages[0].content).not.toContain('versions')
      const result = options.parse({findings:[finding()],coverage_limited:false})
      expect(result.success).toBe(true)
      expect(result.data.findings[0].score).toBe(6)
      expect(options.parse({findings:[{...finding(),section_key:'invalid'}],coverage_limited:false}).success).toBe(false)
      return {data:result.data}
    })
    await generateGroundedQualityReview(snapshot)
  })
  it('does not silently accept invented evidence or incomplete output',async () => {
    call.mockImplementation(async options => {
      const f = finding();f.evidence[0].quote = 'Invented'
      expect(options.parse({findings:[f],coverage_limited:false}).success).toBe(false)
      expect(options.parse({findings:[]}).success).toBe(false)
      return {error:'Invalid output'}
    })
    expect((await generateGroundedQualityReview(snapshot)).error).toBe('Invalid output')
  })
  it('marks the finding cap as limited even if the model claims complete coverage',async () => {
    call.mockImplementation(async options => {
      const parsed = options.parse({findings:Array.from({length:25},finding),coverage_limited:false})
      expect(parsed.data.coverage_limited).toBe(true)
      return {data:parsed.data}
    })
    await generateGroundedQualityReview(snapshot)
  })
})
