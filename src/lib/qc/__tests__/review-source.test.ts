import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { createMockSupabase, createMockQueryBuilder } from '@/test-utils/supabase-mock'
import { collectReviewSnapshot, collectStableReviewSnapshot, reviewSourceHash, reviewVersionHash, effectiveReviewFields, reviewDecision } from '../review-source'
import { reviewSections } from '../review-types'
vi.mock('@/lib/supabase/server', () => ({createClient:vi.fn()}))
const episode = {id:'episode',case_id:'case',status:'active',updated_at:'v1'}
function setup() {
  const tables: Record<string, unknown> = { care_episodes:episode,cases:{id:'case',case_number:'C1',case_status:'active',updated_at:'v1',accident_type:'auto',accident_date:'2026-01-01'} }
  const mock = createMockSupabase()
  const builders: Record<string, ReturnType<typeof createMockQueryBuilder>> = {}
  const errors: Record<string, unknown> = {}
  mock.from.mockImplementation((table: string) => {
    const builder = createMockQueryBuilder({data:tables[table] ?? [],error:errors[table] ?? null})
    builders[table] = builder
    return builder
  })
  return {tables,errors,builders,client:mock as unknown as SupabaseClient<Database>,mock}
}
function note(step: keyof typeof reviewSections, id = step as string) {
  return {id,case_id:'case',episode_id:'episode',encounter_id:`enc-${id}`,status:'draft',updated_at:'v1',visit_type:step === 'pain_evaluation' ? 'pain_evaluation_visit' : 'initial_visit',visit_date:'2026-01-02',...Object.fromEntries(reviewSections[step].map(s => [s,`${step}:${s}`]))}
}
describe('authoritative review snapshot', () => {
  it('projects every canonical section for all note types, preserving empty sections', async () => {
    const {tables,client} = setup()
    tables.initial_visit_notes = [note('initial_visit'),note('pain_evaluation')]
    tables.pain_follow_up_notes = [note('pain_follow_up')]
    tables.discharge_notes = [note('discharge')]
    tables.procedures = [{id:'proc',case_id:'case',episode_id:'episode',encounter_id:'enc-procedure',procedure_date:'2026-01-03'}]
    tables.procedure_notes = [{...note('procedure'),procedure_id:'proc'}]
    const snapshot = await collectReviewSnapshot(client,'case','episode')
    for (const item of snapshot.notes) expect(Object.keys(item.sections)).toEqual([...reviewSections[item.step]])
    expect(snapshot.notes).toHaveLength(5)
    expect(snapshot.coverage.limitations).toContain('Missing encounter context: pain_follow_up_notes:pain_follow_up')
  })
  it('hashes every saved section, excluding raw generation and version-only changes', async () => {
    const {tables,client} = setup()
    const row: Record<string, unknown> = {...note('pain_follow_up'),raw_ai_response:{subjective:'obsolete'}}
    tables.pain_follow_up_notes = [row]
    const baseline = await collectReviewSnapshot(client,'case','episode')
    for (const section of reviewSections.pain_follow_up) {
      const original = row[section]
      row[section] = 'manually changed'
      expect(reviewSourceHash(await collectReviewSnapshot(client,'case','episode'))).not.toBe(reviewSourceHash(baseline))
      row[section] = original
    }
    row.raw_ai_response = {subjective:'different audit'}
    row.updated_at = 'v2'
    const next = await collectReviewSnapshot(client,'case','episode')
    expect(reviewSourceHash(next)).toBe(reviewSourceHash(baseline))
    expect(reviewVersionHash(next)).not.toBe(reviewVersionHash(baseline))
  })
  it('stabilizes database order but preserves meaningful nested array order', async () => {
    const {tables,client} = setup()
    const a = {...note('pain_follow_up','a'),procedure_recommendations:['left','right']}
    const b = note('pain_follow_up','b')
    tables.pain_follow_up_notes = [b,a]
    const first = await collectReviewSnapshot(client,'case','episode')
    tables.pain_follow_up_notes = [a,b]
    expect(reviewSourceHash(await collectReviewSnapshot(client,'case','episode'))).toBe(reviewSourceHash(first))
    a.procedure_recommendations.reverse()
    expect(reviewSourceHash(await collectReviewSnapshot(client,'case','episode'))).not.toBe(reviewSourceHash(first))
  })
  it.each(['initial_visit_notes','procedure_notes','pain_follow_up_notes','discharge_notes','procedures','clinical_encounters','vital_signs','case_summaries','mri_extractions','ct_scan_extractions','x_ray_extractions','pain_management_extractions','cases'])('fails closed on %s query errors', async table => {
    const {client,errors} = setup()
    errors[table] = {message:'database unavailable'}
    await expect(collectReviewSnapshot(client,'case','episode')).rejects.toThrow(table)
  })
  it('rejects records from another episode', async () => {
    const {client,tables} = setup()
    tables.pain_follow_up_notes = [{...note('pain_follow_up'),episode_id:'other'}]
    await expect(collectReviewSnapshot(client,'case','episode')).rejects.toThrow('Wrong episode')
  })
  it('does not borrow vitals from another encounter or choose between duplicate readings', async () => {
    const {client,tables} = setup()
    tables.initial_visit_notes = [note('initial_visit')]
    tables.clinical_encounters = [{id:'enc-initial_visit',case_id:'case',episode_id:'episode',encounter_type:'initial_evaluation',encounter_date:'2026-01-02',provider_intake:{muscle_spasm:false}}]
    tables.vital_signs = [{id:'other',case_id:'case',encounter_id:'other',pain_score_max:8}]
    expect((await collectReviewSnapshot(client,'case','episode')).notes[0].context.vitals).toBeNull()
    tables.vital_signs = [{id:'one',case_id:'case',encounter_id:'enc-initial_visit',procedure_id:null,pain_score_max:4}]
    const one = await collectReviewSnapshot(client,'case','episode')
    expect(one.notes[0].context.vitals).toMatchObject({pain_score_max:4})
    expect(one.notes[0].context.encounter).toMatchObject({provider_intake:{muscle_spasm:false}})
    tables.vital_signs = [...tables.vital_signs as object[],{id:'two',case_id:'case',encounter_id:'enc-initial_visit',procedure_id:null,pain_score_max:6}]
    expect((await collectReviewSnapshot(client,'case','episode')).coverage.limitations).toContain('Ambiguous encounter vitals: initial_visit_notes:initial_visit')
  })
  it('rejects oversized sources without truncation', async () => {
    const {client,tables} = setup()
    tables.pain_follow_up_notes = [{...note('pain_follow_up'),subjective:'x'.repeat(250_000)}]
    await expect(collectReviewSnapshot(client,'case','episode')).rejects.toThrow('input limit')
  })
  it('detects changing versions during collection', async () => {
    const {client,mock,tables} = setup()
    let reads = 0
    const implementation = mock.from.getMockImplementation()!
    mock.from.mockImplementation((table: string) => {
      if (table === 'pain_follow_up_notes') tables[table] = [{...note('pain_follow_up'),updated_at:String(reads++)}]
      return implementation(table)
    })
    await expect(collectStableReviewSnapshot(client,'case','episode')).rejects.toThrow('changed')
  })
  it('includes extraction provenance and effective study date without assigning an episode', async () => {
    const {client,tables} = setup()
    tables.mri_extractions = [{id:'mri',case_id:'case',mri_date:'2026-01-04',body_region:'lumbar',findings:[],review_status:'edited',provider_overrides:{mri_date:null}}]
    const source = (await collectReviewSnapshot(client,'case','episode')).sources.find(s => s.type === 'mri_extractions')
    expect(source).toMatchObject({scope:'case',date:null,fields:{mri_date:null,available:true}})
  })
})
describe('evidence adapters', () => {
  it('preserves null and empty imaging overrides while PM retains nullish fallback', () => {
    const row = {findings:['original'],treatment_plan:[],provider_overrides:{findings:null,treatment_plan:null}}
    expect(effectiveReviewFields(row,'imaging')?.findings).toBeNull()
    expect(effectiveReviewFields(row,'pm')?.treatment_plan).toEqual([])
    expect(effectiveReviewFields({...row,provider_overrides:[]},'imaging')).toBeNull()
    expect(effectiveReviewFields({...row,provider_overrides:{findings:[]}},'imaging')?.findings).toEqual([])
  })
  it('rejects malformed nested overrides rather than treating them as evidence', () => {
    expect(effectiveReviewFields({findings:[],provider_overrides:{findings:[{description:3}]}},'imaging')).toBeNull()
    expect(effectiveReviewFields({treatment_plan:[],provider_overrides:{treatment_plan:'invented shape'}},'pm')).toBeNull()
  })
  it('does not default a missing decision to accepted and identifies stale plan/date', () => {
    expect(reviewDecision(null,'plan',null).state).toBe('absent')
    expect(reviewDecision({},'plan',null).state).toBe('malformed')
    const saved = {schema_version:1,decision:'declined',details:null,reviewed_plan:'Plan text',reviewed_plan_hash:createHash('md5').update('Plan text').digest('hex'),visit_date:'2026-01-02',confirmed_by:'11111111-1111-4111-8111-111111111111',confirmed_at:'2026-01-02'}
    expect(reviewDecision(saved,' Plan  text ','2026-01-02').state).toBe('current')
    expect(reviewDecision(saved,'Other plan','2026-01-02').state).toBe('stale')
    expect(reviewDecision(saved,'Plan text','2026-01-03').state).toBe('stale')
    expect(reviewDecision(saved,'Plan text','2026-01-02')).not.toHaveProperty('confirmed_by')
  })
})
