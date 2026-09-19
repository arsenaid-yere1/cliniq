'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Json } from '@/types/database'
import { getActiveOrLatestEpisode } from '@/lib/clinical/episode-context'
import { assertCaseNotClosed } from './case-status'
import { qualityReviewV3Enabled } from '@/lib/qc/review-config'
import { loadPublishedReview, reviewOperation, startReviewHeartbeat, publishGroundedReview } from '@/lib/qc/review-service'
import { collectStableReviewSnapshot } from '@/lib/qc/review-source'
import { groundedFindingSchema } from '@/lib/qc/review-findings'
import { identifyFinding } from '@/lib/qc/review-identity'
import { validateReviewSnapshot, noteSourceId } from '@/lib/qc/review-validators'
import { isDeterministicReviewRule } from '@/lib/qc/review-rules'
import { reviewSections } from '@/lib/qc/review-types'
import { findingOverrideEntrySchema, findingEditFormSchema, findingDismissFormSchema, type FindingOverrideEntry, type FindingOverridesMap } from '@/lib/validations/case-quality-review'
import type { ReviewFixTarget } from '@/lib/qc/review-fix-target'
import type { InitialVisitSection } from '@/lib/validations/initial-visit-note'
import type { ProcedureNoteSection } from '@/lib/validations/procedure-note'
import type { DischargeNoteSection } from '@/lib/validations/discharge-note'
import type { PainFollowUpSection } from '@/lib/validations/pain-follow-up-note'

type Operation = 'acknowledge' | 'dismiss' | 'edit' | 'clear' | 'verify' | 'resolve' | 'fix'
type Outcome = {error?:string;data?:{success?:boolean;resolved?:boolean;reason?:string;outcome?:string}}

/** Every mutation binds to the review shown to the clinician, not whichever row is latest later. */
export async function actOnQualityFinding(caseId: string,reviewId: string,key: string,operation: Operation,values?: unknown): Promise<Outcome> {
  if (!qualityReviewV3Enabled()) return {error:'Quality Review updates are currently disabled'}
  const client = await createClient()
  const {data:{user}} = await client.auth.getUser()
  if (!user) return {error:'Not authenticated'}
  const closed = await assertCaseNotClosed(client,caseId)
  if (closed.error) return {error:closed.error}
  try {
    const episode = await getActiveOrLatestEpisode(caseId,client)
    if (!episode) return {error:'Care episode not found'}
    const review = await loadPublishedReview(client,caseId,episode.id)
    if (!review || review.id !== reviewId || review.review_version !== 'qc-v3') return {error:'Review changed; reload before editing'}
    const finding = (Array.isArray(review.findings) ? review.findings : []).flatMap(raw => {
      const parsed = groundedFindingSchema.safeParse(raw)
      return parsed.success ? [parsed.data] : []
    }).find(f => f.key === key)
    if (!finding) return {error:'Finding not found in current review'}
    const prior = ((review.finding_overrides ?? {}) as FindingOverridesMap)[key] ?? null
    async function save(entry: FindingOverrideEntry | null,expected: FindingOverrideEntry | null = prior) {
      const result = await client.rpc('quality_review_disposition',{p_review_id:reviewId,p_finding_key:key,p_expected_entry:expected as Json,p_entry:entry as Json})
      if (result.error) throw new Error(result.error.message)
      const row = result.data as {finding_overrides?:FindingOverridesMap} | null
      revalidatePath(`/patients/${caseId}/qc`)
      return row?.finding_overrides?.[key] ?? null
    }
    const base = findingOverrideEntrySchema.parse({status:'acknowledged',actor_user_id:user.id,set_at:new Date().toISOString(),dismissed_reason:null,edited_message:null,edited_rationale:null,edited_suggested_tone_hint:null})
    if (operation === 'clear') { await save(null);return {data:{success:true}} }
    if (operation === 'acknowledge') {await save(base);return {data:{success:true}}}
    if (operation === 'dismiss') {
      const parsed = findingDismissFormSchema.safeParse(values)
      if (!parsed.success) return {error:'Invalid dismissal'}
      await save({...base,...parsed.data,status:'dismissed'});return {data:{success:true}}
    }
    if (operation === 'edit') {
      const parsed = findingEditFormSchema.safeParse(values)
      if (!parsed.success) return {error:'Invalid finding edit'}
      await save({...base,...parsed.data,status:'edited'});return {data:{success:true}}
    }
    if (operation === 'resolve') {
      await save({...base,...prior,status:'resolved',resolved_at:new Date().toISOString(),resolution_source:'manual_resolve'});return {data:{success:true}}
    }
    const snapshot = await collectStableReviewSnapshot(client,caseId,episode.id)
    const note = snapshot.notes.find(n => n.id === finding.note_id && n.step === finding.step && n.procedure_id === finding.procedure_id && n.encounter_id === finding.encounter_id)
    if (!note || !['draft','finalized'].includes(note.status)) return {error:'The finding target is missing or unfinished; recheck the review'}
    if (operation === 'verify') {
      if (finding.rule_id.startsWith('trajectory_') && !snapshot.sources.some(s => s.id === `qc_trajectory:${note.id}`)) return {data:{resolved:false,reason:'Current numeric trajectory evidence is unavailable'}}
      if (finding.provenance !== 'deterministic' || !isDeterministicReviewRule(finding.rule_id)) return {error:'This finding needs Recheck or clinician review; deterministic Verify is unavailable'}
      if (finding.rule_id !== 'required_section' && finding.section_key && !note.sections[finding.section_key]?.trim()) return {data:{resolved:false,reason:'Current section evidence is unavailable'}}
      const encounter = note.context.encounter as {modality?:string} | undefined
      if ((finding.rule_id.startsWith('telehealth_') && encounter?.modality !== 'telehealth') || (finding.rule_id === 'stale_decision' && (note.status !== 'draft' || ['absent','malformed'].includes(note.decision.state)))) return {data:{resolved:false,reason:'The context needed for this check is unavailable'}}
      const diagnosisEvidence = note.sections.diagnoses || note.context.diagnoses
      if (['m545_parent','external_cause_missing','external_cause_excluded','encounter_suffix'].includes(finding.rule_id) && (!diagnosisEvidence || (Array.isArray(diagnosisEvidence) && diagnosisEvidence.length === 0))) return {data:{resolved:false,reason:'Current diagnosis evidence is unavailable'}}
      const stillPresent = validateReviewSnapshot(snapshot).some(f => identifyFinding(f,snapshot,'deterministic').key === key)
      if (stillPresent) return {data:{resolved:false,reason:'This specific finding is still present in the saved note'}}
      await save({...base,...prior,status:'resolved',resolved_at:new Date().toISOString(),resolution_source:'manual_verify'})
      return {data:{resolved:true}}
    }
    if (operation !== 'fix') return {error:'Unsupported finding operation'}
    const section = finding.section_key
    if (!section || !(reviewSections[note.step] as readonly string[]).includes(section) || note.status !== 'draft' || !note.encounter_id || episode.status !== 'active') return {error:'This finding has no editable draft section'}
    // The database lease decides whether a previous fix is active; an expired token must not block recovery.
    const table = noteSourceId(note).split(':')[0]
    const version = snapshot.versions.find(v => v.source_id === noteSourceId(note))?.updated_at
    if (!version) return {error:'Note version unavailable; reload before fixing'}
    const run = await reviewOperation(client,'begin',caseId,episode.id,{kind:'fix',fix_target:{table,note_id:note.id,section,updated_at:version}})
    if (typeof run.id !== 'string') throw new Error('Fix attempt ID missing')
    const target: ReviewFixTarget = {runId:run.id,noteId:note.id,episodeId:episode.id,encounterId:note.encounter_id,updatedAt:version}
    const heartbeat = startReviewHeartbeat(client,caseId,episode.id,run.id)
    target.checkLease = heartbeat.check
    let savedOverride: FindingOverrideEntry | null = null
    let applied = false
    try {
      savedOverride = await save({...base,...prior,status:'fix_in_progress',fix_attempted_at:new Date().toISOString(),fix_section_regenerated:section,fix_recheck_result:null,fix_run_id:run.id})
      const instruction = {message:finding.message,rationale:finding.rationale}
      let result: {error?:string;data?:unknown}
      if (note.step === 'initial_visit' || note.step === 'pain_evaluation') {
        const {regenerateNoteSection} = await import('./initial-visit-notes')
        result = await regenerateNoteSection(caseId,note.step === 'initial_visit' ? 'initial_visit' : 'pain_evaluation_visit',section as InitialVisitSection,instruction,version,target)
      } else if (note.step === 'procedure') {
        const {regenerateProcedureNoteSectionAction} = await import('./procedure-notes')
        result = await regenerateProcedureNoteSectionAction(note.procedure_id!,caseId,section as ProcedureNoteSection,instruction,target)
      } else if (note.step === 'discharge') {
        const {regenerateDischargeNoteSectionAction} = await import('./discharge-notes')
        result = await regenerateDischargeNoteSectionAction(caseId,section as DischargeNoteSection,instruction,version,target)
      } else {
        const {regeneratePainFollowUpSectionAction} = await import('./pain-follow-up-notes')
        result = await regeneratePainFollowUpSectionAction(caseId,note.encounter_id,section as PainFollowUpSection,instruction,version,target)
      }
      if (result.error) throw new Error(result.error)
      applied = true
      await heartbeat.check()
      const after = await collectStableReviewSnapshot(client,caseId,episode.id)
      const published = await publishGroundedReview(client,caseId,episode.id,run.id,after,heartbeat.progress,heartbeat.check)
      revalidatePath(`/patients/${caseId}/qc`)
      return {data:{success:true,outcome:published.findings.some(f => f.key === key) ? 'applied_but_still_present' : 'applied_and_not_detected'}}
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Fix failed'
      let cleanupError = ''
      if (savedOverride) {
        try { await save(prior?.status === 'fix_in_progress' ? null : prior,savedOverride) } catch {cleanupError = ' The finding disposition changed; reload to see its current state.'}
      }
      try { await reviewOperation(client,'fail',caseId,episode.id,{run_id:run.id,error_category:applied ? 'fix_recheck_failed' : 'fix_failed',error_message:message}) }
      catch {cleanupError += ' The attempt status could not be saved.'}
      return {error:applied ? `The note was updated, but recheck failed: ${message}.${cleanupError}` : `${message}${cleanupError}`,data:{outcome:applied ? 'applied_recheck_failed' : 'failed'}}
    } finally {await heartbeat.stop();revalidatePath(`/patients/${caseId}/qc`)}
  } catch (caught) {return {error:caught instanceof Error ? caught.message : 'Quality Review action failed'}}
}

export async function getQualityReviewRuns(caseId: string,before?: {startedAt:string;id:string}) {
  const client = await createClient()
  const {data:{user}} = await client.auth.getUser()
  if (!user) return {error:'Not authenticated',data:[]}
  if (!qualityReviewV3Enabled()) return {data:[]}
  try {
    const episode = await getActiveOrLatestEpisode(caseId,client)
    if (!episode) return {data:[]}
    let query = client.from('case_quality_review_runs').select('id,status,started_at,finished_at,error_message,sections_done,finding_transitions,lease_expires_at').eq('case_id',caseId).eq('episode_id',episode.id).order('started_at',{ascending:false}).order('id',{ascending:false}).limit(20)
    if (before) {
      if (!/^[0-9a-f-]{36}$/i.test(before.id) || !Number.isFinite(Date.parse(before.startedAt))) return {error:'Invalid history cursor',data:[]}
      const timestamp = new Date(before.startedAt).toISOString()
      query = query.or(`started_at.lt.${timestamp},and(started_at.eq.${timestamp},id.lt.${before.id})`)
    }
    const result = await query
    if (result.error) return {error:'Unable to load review attempt history',data:[]}
    return {data:result.data.map(run => run.status === 'processing' && Date.parse(run.lease_expires_at) <= Date.now() ? {...run,status:'expired',error_message:'Review attempt expired; run Recheck'} : run)}
  } catch {return {error:'Unable to load review attempt history',data:[]}}
}
