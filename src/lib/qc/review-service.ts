import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import { generateGroundedQualityReview } from '@/lib/claude/generate-quality-review'
import { collectStableReviewSnapshot, collectReviewSnapshot, reviewSourceHash, reviewVersionHash } from './review-source'
import { validateReviewSnapshot } from './review-validators'
import { groundedFindingSchema, validateGroundedFinding, deriveReviewAssessment, type FindingTransition, type GroundedFinding } from './review-findings'
import { aggregateFindings, reconcileReviewFindings } from './review-identity'
import type { FindingOverridesMap } from '@/lib/validations/case-quality-review'
import type { ReviewSnapshot } from './review-types'

type Client = SupabaseClient<Database>
export async function reviewOperation(client: Client,action: string,caseId: string,episodeId: string,payload: Record<string,unknown>) {
  const started = Date.now()
  const result = await client.rpc('quality_review_run',{p_action:action,p_case_id:caseId,p_episode_id:episodeId,p_payload:payload as Json})
  if (result.error) throw new Error(result.error.message)
  if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) throw new Error('Invalid review operation response')
  const data = result.data as Record<string,Json>
  if (action !== 'heartbeat') console.info('[quality-review]',{operation:action,run_id:payload.run_id ?? data.id,duration_ms:Date.now()-started,version:'qc-v3',conflict:data.conflict === true})
  return data
}
export async function loadPublishedReview(client: Client,caseId: string,episodeId: string) {
  const result = await client.from('case_quality_reviews').select('*').eq('case_id',caseId).eq('episode_id',episodeId).is('deleted_at',null).maybeSingle()
  if (result.error) throw new Error('Unable to load the published Quality Review')
  return result.data
}
/** Recover nondetection history without inferring matches between legacy findings. */
async function recurringAfterNondetection(client: Client,caseId: string,episodeId: string,current: GroundedFinding[],previous: GroundedFinding[],at: string): Promise<FindingTransition[]> {
  const pending = new Set(current.filter(f => f.key && !previous.some(old => old.key === f.key)).map(f => f.key!))
  const transitions: FindingTransition[] = []
  for (let offset=0;pending.size;offset+=100) {
    const result = await client.from('case_quality_review_runs').select('finding_transitions').eq('case_id',caseId).eq('episode_id',episodeId).eq('status','completed').order('started_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+99)
    if (result.error) throw new Error('Unable to load finding history for reconciliation')
    const rows = result.data ?? []
    for (const row of rows) for (const raw of Array.isArray(row.finding_transitions) ? row.finding_transitions : []) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.key !== 'string' || !pending.has(raw.key)) continue
      pending.delete(raw.key)
      if (raw.outcome === 'not_detected') transitions.push({key:raw.key,finding:current.find(f => f.key === raw.key)!,outcome:'recurring',at})
    }
    if (rows.length < 100) break
  }
  return transitions
}
export function startReviewHeartbeat(client: Client,caseId: string,episodeId: string,runId: string) {
  let stopped = false
  let error: Error | null = null
  let pending = Promise.resolve()
  let progress = 0
  const beat = () => {
    if (stopped || error) return
    pending = pending.then(async () => {
      if (stopped || error) return
      try { await reviewOperation(client,'heartbeat',caseId,episodeId,{run_id:runId,sections_done:progress}) }
      catch (caught) { error = caught instanceof Error ? caught : new Error('Review heartbeat failed') }
    })
  }
  const timer = setInterval(beat,15_000)
  return {progress:(count: number) => {progress = Math.max(progress,count)},check:async () => {await pending;if (error) throw error},stop:async () => {stopped = true;clearInterval(timer);await pending}}
}
export async function publishGroundedReview(client: Client,caseId: string,episodeId: string,runId: string,snapshot: ReviewSnapshot,onProgress?: (count:number) => void,checkLease: () => void | Promise<void> = () => {}) {
  const generated = await generateGroundedQualityReview(snapshot,keys => onProgress?.(keys.length))
  await checkLease()
  if (generated.error || !generated.data) throw new Error(generated.error ?? 'Review generation failed')
  const deterministic = validateReviewSnapshot(snapshot)
  for (const finding of deterministic) {
    const error = validateGroundedFinding(finding,snapshot,'deterministic')
    if (error) throw new Error(`Deterministic finding validation failed: ${error}`)
  }
  const findings = aggregateFindings([...deterministic,...generated.data.findings.map(f => ({...f,provenance:'ai' as const}))],snapshot)
  const coverage = {...snapshot.coverage,complete:snapshot.coverage.complete && !generated.data.coverage_limited,limitations:[...snapshot.coverage.limitations,...(generated.data.coverage_limited ? ['AI review coverage or finding limit reached'] : [])]}
  for (let retry = 0; retry < 3; retry++) {
    const current = await collectReviewSnapshot(client,caseId,episodeId)
    if (reviewVersionHash(current) !== reviewVersionHash(snapshot)) throw new Error('Clinical sources changed during review; run Recheck')
    const previous = await loadPublishedReview(client,caseId,episodeId)
    const previousFindings = (Array.isArray(previous?.findings) ? previous.findings : []).flatMap(f => {
      const parsed = groundedFindingSchema.safeParse(f)
      return parsed.success ? [parsed.data] : []
    })
    const reconciled = reconcileReviewFindings(previousFindings,findings,(previous?.finding_overrides ?? {}) as FindingOverridesMap,new Date().toISOString())
    reconciled.transitions.push(...await recurringAfterNondetection(client,caseId,episodeId,findings,previousFindings,new Date().toISOString()))
    const assessment = deriveReviewAssessment(findings,reconciled.overrides,coverage.complete,f => (f as {key:string}).key)
    await checkLease()
    const published = await reviewOperation(client,'publish',caseId,episodeId,{run_id:runId,expected_review_id:previous?.id ?? null,expected_updated_at:previous?.updated_at ?? null,findings,finding_overrides:reconciled.overrides,...assessment,coverage,source_hash:reviewSourceHash(snapshot),source_versions:snapshot.versions,transitions:reconciled.transitions})
    if (published.conflict === true) continue
    if (typeof published.id !== 'string') throw new Error('Publication did not return a review ID')
    return {id:published.id,findings}
  }
  throw new Error('Review dispositions kept changing; please retry')
}
export async function runGroundedReview(client: Client,caseId: string,episodeId: string): Promise<{data?:{id:string};error?:string}> {
  let runId: string | null = null
  let heartbeat: ReturnType<typeof startReviewHeartbeat> | null = null
  try {
    const run = await reviewOperation(client,'begin',caseId,episodeId,{kind:'review'})
    if (typeof run.id !== 'string') throw new Error('Review attempt ID missing')
    runId = run.id
    heartbeat = startReviewHeartbeat(client,caseId,episodeId,runId)
    const snapshot = await collectStableReviewSnapshot(client,caseId,episodeId)
    await heartbeat.check()
    const result = await publishGroundedReview(client,caseId,episodeId,runId,snapshot,heartbeat.progress,heartbeat.check)
    return {data:{id:result.id}}
  } catch (caught) {
    const error = caught instanceof Error ? caught.message : 'Quality Review failed'
    if (runId) {
      try { await reviewOperation(client,'fail',caseId,episodeId,{run_id:runId,status:error.includes('sources changed') ? 'superseded' : 'failed',error_category:'review_failed',error_message:error}) }
      catch { return {error:`${error}. The attempt status could not be saved; the previous successful review is retained.`} }
    }
    return {error}
  } finally { await heartbeat?.stop() }
}
