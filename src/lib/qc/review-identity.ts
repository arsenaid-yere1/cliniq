import 'server-only'
import { createHash } from 'node:crypto'
import { canonicalReviewJson } from './review-source'
import type { ReviewSnapshot } from './review-types'
import { sourceField, type GroundedFinding, type FindingTransition } from './review-findings'
import type { FindingOverridesMap } from '@/lib/validations/case-quality-review'

export function identifyFinding(finding: GroundedFinding,snapshot: ReviewSnapshot,provenance: 'ai' | 'deterministic'): GroundedFinding {
  const identity = ['v3',finding.rule_id,finding.step,finding.note_id,finding.procedure_id,finding.encounter_id,finding.section_key,finding.entity_key]
  const relevant = finding.evidence.map(e => {
    const source = snapshot.sources.find(s => s.id === e.source_id)
    return [e.source_id,e.field,source ? sourceField(source.fields,e.field).value : null]
  }).sort((a,b) => canonicalReviewJson(a).localeCompare(canonicalReviewJson(b)))
  return {...finding,evidence:finding.evidence.map(e => ({...e,source_date:snapshot.sources.find(s => s.id === e.source_id)?.date ?? null})),provenance,key:createHash('sha256').update(canonicalReviewJson(identity)).digest('hex'),source_fingerprint:createHash('sha256').update(canonicalReviewJson(relevant)).digest('hex')}
}
export function aggregateFindings(findings: GroundedFinding[],snapshot: ReviewSnapshot): GroundedFinding[] {
  const groups = new Map<string,GroundedFinding>()
  const rank = {info:0,warning:1,critical:2}
  for (const original of findings) {
    const finding = identifyFinding(original,snapshot,original.provenance ?? 'ai')
    const prior = groups.get(finding.key!)
    if (!prior) groups.set(finding.key!,finding)
    else {
      const strongest = rank[finding.severity] > rank[prior.severity] ? finding : prior
      const evidence = [...new Map([...prior.evidence,...finding.evidence].map(e => [canonicalReviewJson(e),e])).values()]
      groups.set(finding.key!,identifyFinding({...strongest,evidence,score:Math.max(prior.score,finding.score)},snapshot,strongest.provenance!))
    }
  }
  return [...groups.values()]
}
export function reconcileReviewFindings(previous: GroundedFinding[],current: GroundedFinding[],overrides: FindingOverridesMap,at: string): {overrides:FindingOverridesMap;transitions:FindingTransition[]} {
  const next: FindingOverridesMap = {}
  const transitions: FindingTransition[] = []
  for (const old of previous) {
    if (!old.key) continue // Ambiguous legacy AI hashes are not migrated.
    const now = current.find(f => f.key === old.key)
    const entry = overrides[old.key]
    if (!now) transitions.push({key:old.key,finding:old,outcome:'not_detected',at,previous_disposition:entry ?? null})
    else if (entry?.status === 'resolved') transitions.push({key:old.key,finding:now,outcome:'recurring',at,previous_disposition:entry ?? null})
    else if (entry && entry.status !== 'fix_in_progress' && old.source_fingerprint === now.source_fingerprint && old.severity === now.severity) next[old.key] = entry
  }
  return {overrides:next,transitions}
}
