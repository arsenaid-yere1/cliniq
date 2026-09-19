// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, act } from '@testing-library/react'
import type { ComponentProps } from 'react'
const mocks = vi.hoisted(() => ({refresh:vi.fn(),action:vi.fn()}))
vi.mock('next/navigation',() => ({useRouter:() => ({refresh:mocks.refresh})}))
vi.mock('@/components/patients/case-status-context',() => ({useCaseStatus:() => 'active'}))
vi.mock('@/actions/case-quality-review-findings',() => ({actOnQualityFinding:mocks.action,getQualityReviewRuns:vi.fn()}))
vi.mock('@/actions/case-quality-reviews',() => ({runCaseQualityReview:mocks.action,recheckCaseQualityReview:mocks.action,acknowledgeFinding:vi.fn(),clearFindingOverride:vi.fn(),verifyFinding:vi.fn(),markFindingResolved:vi.fn(),fixFinding:vi.fn()}))
vi.mock('../generating-progress',() => ({GeneratingProgress:() => <div>Generating</div>}))
import { QcReviewPanel } from '../qc-review-panel'
type Props = ComponentProps<typeof QcReviewPanel>
const finding = {key:'finding',rule_id:'m545_parent',provenance:'deterministic' as const,severity:'critical' as const,score:8,step:'pain_follow_up' as const,note_id:'note',encounter_id:'encounter',procedure_id:null,section_key:'diagnoses',message:'Original diagnosis needs attention',rationale:null,suggested_tone_hint:null,evidence:[{source_id:'pain_follow_up_notes:note',field:'diagnoses',quote:'<script>synthetic</script>',missing:false}]}
function review(): NonNullable<Props['review']> {return {id:'review',review_version:'qc-v3',generation_status:'completed',generation_error:null,findings:[finding],finding_overrides:{},summary:'Old clean summary',overall_assessment:'clean',sections_done:1,sections_total:1,generated_at:null,review_coverage:{complete:true,limitations:[]}}}
const attempt = {id:'run',status:'processing',started_at:'2026-01-01T00:00:00Z',finished_at:null,error_message:null,sections_done:0,finding_transitions:[],lease_expires_at:'2026-01-02T00:00:00Z'}
afterEach(() => {cleanup();vi.useRealTimers();vi.clearAllMocks()})
describe('Quality Review clinical states',() => {
  it('keeps the last successful review visible during a recheck',() => {
    render(<QcReviewPanel caseId="case" modern review={review()} isStale={false} attempts={[attempt]} />)
    expect(screen.getByText(/last completed review remains/)).toBeTruthy()
    expect(screen.getByText(finding.message)).toBeTruthy()
    expect(screen.getByRole('button',{name:'Recheck'}).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByText('Old clean summary')).toBeNull()
  })
  it('shows first-run failure and permits retry',() => {
    render(<QcReviewPanel caseId="case" modern review={null} isStale={false} attempts={[{...attempt,status:'failed',error_message:'Synthetic model failure'}]} />)
    expect(screen.getByText('Synthetic model failure')).toBeTruthy()
    expect(screen.getByRole('button',{name:'Run Review'}).hasAttribute('disabled')).toBe(false)
  })
  it('shows incomplete and unknown freshness separately',() => {
    const row=review();row.review_coverage={complete:false,limitations:['Missing origin evidence']}
    render(<QcReviewPanel caseId="case" modern review={row} isStale={false} freshnessUnknown />)
    expect(screen.getByText('Review incomplete')).toBeTruthy()
    expect(screen.getByText(/Freshness could not be checked/)).toBeTruthy()
    expect(screen.getByText('Missing origin evidence')).toBeTruthy()
  })
  it('escapes evidence and links to the exact follow-up encounter',() => {
    const {container}=render(<QcReviewPanel caseId="case" modern review={review()} isStale={false} />)
    expect(screen.getByText('<script>synthetic</script>')).toBeTruthy()
    expect(container.querySelector('script')).toBeNull()
    expect(screen.getByRole('link',{name:/View in editor/}).getAttribute('href')).toBe('/patients/case/visits/encounter')
    expect(screen.getByRole('button',{name:'Verify'})).toBeTruthy()
  })
  it('hides AI verification and disables signed-note fixing',() => {
    const row=review();row.findings=[{...finding,provenance:'ai',rule_id:'anatomy_consistency',fix_blocked_reason:'Signed note'}]
    render(<QcReviewPanel caseId="case" modern review={row} isStale={false} />)
    expect(screen.queryByRole('button',{name:'Verify'})).toBeNull()
    expect(screen.getByRole('button',{name:'Fix with AI'}).hasAttribute('disabled')).toBe(true)
  })
  it('uses the visits list for legacy findings without an encounter',() => {
    const row=review();row.review_version=null;row.findings=[{...finding,encounter_id:null}]
    render(<QcReviewPanel caseId="case" review={row} isStale={false} />)
    expect(screen.getByRole('link',{name:/View in editor/}).getAttribute('href')).toBe('/patients/case/visits')
  })
  it('allows recovery after an expired fix',() => {
    const row=review();row.finding_overrides={finding:{status:'fix_in_progress',fix_run_id:'run',resolved_at:null,resolution_source:null,fix_attempted_at:null,fix_section_regenerated:null,fix_recheck_result:null,actor_user_id:'actor',set_at:'2026-01-01',dismissed_reason:null,edited_message:null,edited_rationale:null,edited_suggested_tone_hint:null}}
    render(<QcReviewPanel caseId="case" modern review={row} isStale={false} attempts={[{...attempt,status:'expired'}]} />)
    expect(screen.getByRole('button',{name:'Fix with AI'}).hasAttribute('disabled')).toBe(false)
  })
  it('keeps a published review readable while rollout is paused',() => {
    render(<QcReviewPanel caseId="case" modern={false} review={review()} isStale={false} />)
    expect(screen.getByText(/updates are paused/)).toBeTruthy()
    expect(screen.getByText(finding.message)).toBeTruthy()
    expect(screen.getByRole('button',{name:'Recheck'}).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByRole('button',{name:'Acknowledge'})).toBeNull()
  })
  it('stops attempt polling when unmounted',async () => {
    vi.useFakeTimers()
    const {unmount}=render(<QcReviewPanel caseId="case" modern review={review()} isStale={false} attempts={[attempt]} />)
    await act(async () => {await vi.advanceTimersByTimeAsync(3000)})
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    unmount()
    await vi.advanceTimersByTimeAsync(6000)
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })
})
