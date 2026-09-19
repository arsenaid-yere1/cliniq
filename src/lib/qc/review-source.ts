import 'server-only'
import { painManagementExtractionResultSchema } from '@/lib/validations/pain-management-extraction'
import { mriExtractionResultSchema } from '@/lib/validations/mri-extraction'
import { ctScanExtractionResultSchema } from '@/lib/validations/ct-scan-extraction'
import { xRayExtractionResultSchema } from '@/lib/validations/x-ray-extraction'
import type { ZodType } from 'zod'
import { buildReviewTrajectory } from './review-trajectory'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { getEpisodeById } from '@/lib/clinical/episode-context'
import { parseVisitDecision, normalizeVisitPlan } from '@/lib/validations/visit-treatment-decision'
import { REVIEW_VERSION, reviewSections, type ReviewDecision, type ReviewNote, type ReviewNoteStep, type ReviewSnapshot, type ReviewSource, type ReviewValue } from './review-types'

type Row = Record<string, ReviewValue | undefined>
const MAX_INPUT_BYTES = 240_000
const PAGE_SIZE = 500
const procedureColumns = ['id','case_id','episode_id','updated_at','procedure_date','procedure_number','procedure_type','diagnoses','injection_site','sites','guidance_method'] as const satisfies readonly (keyof Database['public']['Tables']['procedures']['Row'])[]
const identity = 'id,case_id,episode_id,encounter_id,status,updated_at'
const selections = {
  initial_visit_notes: `${identity},visit_type,visit_date,provider_intake,rom_data,visit_treatment_decision,prp_target_recommendations,${reviewSections.initial_visit.join(',')}`,
  procedure_notes: `id,case_id,procedure_id,status,updated_at,${reviewSections.procedure.join(',')}`,
  discharge_notes: `${identity},visit_date,visit_treatment_decision,pain_score_min,pain_score_max,discharge_pain_estimated,discharge_pain_estimate_min,discharge_pain_estimate_max,${reviewSections.discharge.join(',')}`,
  pain_follow_up_notes: `${identity},visit_treatment_decision,procedure_recommendations,${reviewSections.pain_follow_up.join(',')}`,
} as const
const extractionSelections = {
  mri_extractions: 'id,case_id,updated_at,review_status,mri_date,body_region,findings,impression_summary,provider_overrides',
  ct_scan_extractions: 'id,case_id,updated_at,review_status,scan_date,body_region,findings,impression_summary,provider_overrides',
  x_ray_extractions: 'id,case_id,updated_at,review_status,scan_date,body_region,laterality,findings,impression_summary,provider_overrides',
  pain_management_extractions: 'id,case_id,updated_at,review_status,report_date,chief_complaints,physical_exam,diagnoses,treatment_plan,diagnostic_studies_summary,provider_overrides',
} as const
function string(value: unknown): string | null { return typeof value === 'string' ? value : null }
function object(value: unknown): value is Row { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function rows(value: unknown): Row[] {
  if (!Array.isArray(value) || !value.every(object)) throw new Error('Malformed review source response')
  return value
}
function required(value: unknown, name: string): string {
  const result = string(value)
  if (!result) throw new Error(`Missing ${name} in review source`)
  return result
}
function fields(row: Row, keys: readonly string[]): Record<string, ReviewValue> {
  return Object.fromEntries(keys.map(key => [key, row[key] ?? null]))
}
export function canonicalReviewJson(value: unknown): string {
  function canonical(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(canonical)
    if (item !== null && typeof item === 'object') return Object.fromEntries(Object.entries(item).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k,canonical(v)]))
    return item
  }
  return JSON.stringify(canonical(value))
}
export function reviewSourceHash(snapshot: ReviewSnapshot): string {
  const clinical = { ...snapshot, versions: undefined }
  return createHash('sha256').update(canonicalReviewJson(clinical)).digest('hex')
}
export function reviewVersionHash(snapshot: ReviewSnapshot): string {
  return createHash('sha256').update(canonicalReviewJson(snapshot)).digest('hex')
}
export function reviewDecision(value: unknown, plan: string | null, date: string | null): ReviewDecision {
  const parsed = parseVisitDecision(value)
  if (!parsed) return { state: value == null ? 'absent' : 'malformed', decision: null, details: null, reviewed_plan: null, visit_date: null }
  const hash = createHash('md5').update(normalizeVisitPlan(plan ?? '')).digest('hex')
  return { state: parsed.reviewed_plan_hash === hash && parsed.visit_date === date ? 'current' : 'stale', decision: parsed.decision, details: parsed.details, reviewed_plan: parsed.reviewed_plan, visit_date: parsed.visit_date }
}
export function effectiveReviewFields(row: Row, kind: 'imaging' | 'pm'): Record<string, ReviewValue> | null {
  const overrides = row.provider_overrides
  if (overrides != null && !object(overrides)) return null
  const keys = kind === 'pm' ? ['report_date','chief_complaints','physical_exam','diagnoses','treatment_plan','diagnostic_studies_summary'] : ['mri_date','scan_date','body_region','laterality','findings','impression_summary']
  const effective = Object.fromEntries(keys.filter(key => key in row).map(key => {
    const override = object(overrides) ? overrides[key] : undefined
    return [key, kind === 'pm' ? override ?? row[key] ?? null : override !== undefined ? override : row[key] ?? null]
  }))
  const schema = kind === 'pm' ? painManagementExtractionResultSchema : 'laterality' in row ? xRayExtractionResultSchema : 'scan_date' in row ? ctScanExtractionResultSchema : mriExtractionResultSchema
  const shape = schema.shape as Record<string,ZodType>
  for (const [key,value] of Object.entries(effective)) {
    if (value != null && shape[key] && !shape[key].safeParse(value).success) return null
  }
  return effective
}

/** Read-only snapshot. All collections are paged; errors never masquerade as absent rows. */
export async function collectReviewSnapshot(client: SupabaseClient<Database>, caseId: string, episodeId: string): Promise<ReviewSnapshot> {
  const episode = await getEpisodeById(caseId, episodeId, client)
  const limitations: string[] = []
  const versions: ReviewSnapshot['versions'] = []
  const sources: ReviewSource[] = []
  function remember(table: string, row: Row) {
    const id = required(row.id, `${table}.id`)
    if (row.case_id !== caseId) throw new Error(`Wrong case in ${table} source`)
    versions.push({ source_id: `${table}:${id}`, updated_at: string(row.updated_at) })
    return `${table}:${id}`
  }
  async function load(table: keyof Database['public']['Tables'], columns: string, scoped = false, approved = false): Promise<Row[]> {
    const result: Row[] = []
    for (let start = 0; ; start += PAGE_SIZE) {
      const projection = table === 'procedure_notes' ? `${columns},procedures!inner(episode_id,deleted_at)` : columns
      let query = client.from(table).select(projection).eq('case_id',caseId).is('deleted_at',null).order('id').range(start,start + PAGE_SIZE - 1)
      if (table === 'procedure_notes') query = query.eq('procedures.episode_id',episodeId).is('procedures.deleted_at',null)
      if (scoped) query = query.eq('episode_id',episodeId)
      if (approved) query = query.in('review_status',['approved','edited'])
      const response = await query
      if (response.error) throw new Error(`Unable to load Quality Review source: ${table}`)
      const page = rows(response.data)
      for (const row of page) {
        if (row.case_id !== caseId || (scoped && row.episode_id !== episodeId)) throw new Error(`Wrong episode or case in ${table} source`)
      }
      result.push(...page)
      if (Buffer.byteLength(JSON.stringify(result)) > MAX_INPUT_BYTES) throw new Error('Review input limit exceeded; no sources were truncated')
      if (page.length < PAGE_SIZE) return result
    }
  }
  const tasks = {
    initial_visit_notes: () => load('initial_visit_notes',selections.initial_visit_notes,true),
    procedure_notes: () => load('procedure_notes',selections.procedure_notes),
    pain_follow_up_notes: () => load('pain_follow_up_notes',selections.pain_follow_up_notes,true),
    discharge_notes: () => load('discharge_notes',selections.discharge_notes,true),
    clinical_encounters: () => load('clinical_encounters','id,case_id,episode_id,updated_at,encounter_type,encounter_date,status,modality,reason_for_visit,provider_intake,patient_reported_pain_min,patient_reported_pain_max,patient_reported_measurements,telehealth_consent_obtained',true),
    procedures: () => load('procedures',procedureColumns.join(','),true),
    vital_signs: () => load('vital_signs','id,case_id,encounter_id,procedure_id,updated_at,recorded_at,pain_score_min,pain_score_max,bp_systolic,bp_diastolic,heart_rate,respiratory_rate,temperature_f,spo2_percent'),
    case_summaries: () => load('case_summaries','id,case_id,updated_at,created_at,chief_complaint,imaging_findings,suggested_diagnoses,review_status',false,true),
    ...Object.fromEntries(Object.entries(extractionSelections).map(([table, columns]) => [table,() => load(table as keyof typeof extractionSelections,columns,false,true)])),
  }
  const entries = Object.entries(tasks)
  const results = await Promise.allSettled(entries.map(([,task]) => task()))
  const collected: Record<string, Row[]> = {}
  for (let index = 0; index < results.length; index++) {
    const result = results[index]
    if (result.status === 'rejected') throw result.reason
    collected[entries[index][0]] = result.value
  }
  const caseResult = await client.from('cases').select('id,case_number,case_status,accident_type,accident_date,updated_at').eq('id',caseId).is('deleted_at',null).single()
  if (caseResult.error || !caseResult.data) throw new Error('Unable to load Quality Review source: cases')
  const caseRow = caseResult.data
  sources.push({ id: `cases:${caseId}`,type:'cases',scope:'case',date:caseRow.accident_date,fields: { case_number:caseRow.case_number,case_status:caseRow.case_status,accident_type:caseRow.accident_type,accident_date:caseRow.accident_date } })
  versions.push({ source_id:`cases:${caseId}`,updated_at:caseRow.updated_at },{ source_id:`care_episodes:${episodeId}`,updated_at:episode.updated_at })
  const encounters = new Map(collected.clinical_encounters.map(row => [required(row.id,'encounter.id'),row]))
  const procedures = new Map(collected.procedures.map(row => [required(row.id,'procedure.id'),row]))
  const addSource = (table: string, row: Row, scope: 'case' | 'episode', date: string | null, value: Record<string, ReviewValue>) => {
    sources.push({ id:remember(table,row),type:table,scope,date,fields:value })
  }
  for (const row of collected.clinical_encounters) addSource('clinical_encounters',row,'episode',string(row.encounter_date),fields(row,['encounter_date','status','encounter_type','modality','reason_for_visit','provider_intake','patient_reported_pain_min','patient_reported_pain_max','patient_reported_measurements','telehealth_consent_obtained']))
  for (const row of collected.procedures) addSource('procedures',row,'episode',string(row.procedure_date),fields(row,['procedure_date','procedure_number','procedure_type','diagnoses','injection_site','sites','guidance_method']))
  for (const [table, records] of Object.entries(collected)) {
    if (table in extractionSelections) for (const row of records) {
      const effective = effectiveReviewFields(row,table === 'pain_management_extractions' ? 'pm' : 'imaging')
      if (!effective) limitations.push(`Malformed overrides: ${table}:${row.id}`)
      addSource(table,row,'case',effective ? string(effective.mri_date ?? effective.scan_date ?? effective.report_date) : null,{ review_status:row.review_status ?? null, available:effective !== null,...effective })
    }
  }
  const summary = collected.case_summaries.sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)) || String(a.id).localeCompare(String(b.id)))[0]
  if (summary) addSource('case_summaries',summary,'case',null,fields(summary,['chief_complaint','imaging_findings','suggested_diagnoses','review_status']))
  else limitations.push('No reviewed case summary available')
  const notes: ReviewNote[] = []
  for (const table of Object.keys(selections)) {
    for (const row of collected[table]) {
      const proc = table === 'procedure_notes' ? procedures.get(String(row.procedure_id)) : null
      if (table === 'procedure_notes' && !proc) continue // Other episodes' procedure notes are not part of this snapshot.
      const step: ReviewNoteStep = table === 'initial_visit_notes' ? row.visit_type === 'initial_visit' ? 'initial_visit' : 'pain_evaluation' : table === 'procedure_notes' ? 'procedure' : table === 'discharge_notes' ? 'discharge' : 'pain_follow_up'
      if (table === 'initial_visit_notes' && !['initial_visit','pain_evaluation_visit'].includes(String(row.visit_type))) continue
      // Procedures belong to the episode directly. source_encounter_id is the
      // ordering visit, not an encounter for the performed procedure.
      const encounterId = proc ? null : string(row.encounter_id)
      const encounter = encounterId ? encounters.get(encounterId) : null
      const expectedEncounterType = {initial_visit:'initial_evaluation',pain_evaluation:'pain_evaluation',procedure:'procedure',discharge:'discharge',pain_follow_up:'pain_follow_up'}[step]
      if (encounter && encounter.encounter_type !== expectedEncounterType) throw new Error(`Wrong encounter type for ${table}:${row.id}`)
      if (!encounter && !proc) limitations.push(`Missing encounter context: ${table}:${row.id}`)
      const date = string(row.visit_date ?? proc?.procedure_date ?? encounter?.encounter_date)
      const sections = Object.fromEntries(reviewSections[step].map(key => [key,string(row[key])]))
      const context = fields(row,['provider_intake','rom_data','prp_target_recommendations','procedure_recommendations'])
      if (proc) Object.assign(context,fields(proc,['procedure_number','diagnoses','injection_site','sites','guidance_method']))
      if (encounter) context.encounter = fields(encounter,['encounter_date','status','modality','provider_intake','patient_reported_pain_min','patient_reported_pain_max','patient_reported_measurements','telehealth_consent_obtained','reason_for_visit'])
      const matches = proc
        ? collected.vital_signs.filter(v => v.procedure_id === proc.id)
        : encounter ? collected.vital_signs.filter(v => v.encounter_id === encounterId && v.procedure_id == null) : []
      if (matches.length === 1) {
        context.vitals = fields(matches[0],['recorded_at','pain_score_min','pain_score_max','bp_systolic','bp_diastolic','heart_rate','respiratory_rate','temperature_f','spo2_percent'])
        if (!sources.some(s => s.id === `vital_signs:${matches[0].id}`)) addSource('vital_signs',matches[0],'episode',string(matches[0].recorded_at),context.vitals as Record<string,ReviewValue>)
      } else {
        context.vitals = null
        limitations.push(`${matches.length ? 'Ambiguous' : 'Missing'} encounter vitals: ${table}:${row.id}`)
        for (const match of matches) remember('vital_signs',match)
      }
      if (step === 'discharge') context.discharge_measurements = fields(row,['pain_score_min','pain_score_max','discharge_pain_estimated','discharge_pain_estimate_min','discharge_pain_estimate_max'])
      const decision = reviewDecision(row.visit_treatment_decision,sections.treatment_plan ?? sections.plan_and_recommendations,date)
      const note: ReviewNote = { id:required(row.id,'note.id'),step,episode_id:episodeId,encounter_id:encounterId,procedure_id:string(proc?.id),status:required(row.status,'note.status'),date,sections,context,decision }
      notes.push(note)
      addSource(table,row,'episode',date,{...sections,...context,decision:{...decision},status:note.status})
      if (!['draft','finalized'].includes(note.status)) limitations.push(`Unfinished note: ${table}:${note.id}`)
      if (decision.state === 'malformed') limitations.push(`Malformed saved decision: ${table}:${note.id}`)
    }
  }
  for (const note of notes.filter(n => n.step === 'procedure')) {
    const candidates = [
      ...notes.filter(n => ['initial_visit','pain_evaluation','pain_follow_up'].includes(n.step) && n.sections.treatment_plan).map(n => ({ id:`${n.step === 'pain_follow_up' ? 'pain_follow_up_notes' : 'initial_visit_notes'}:${n.id}`,date:n.date })),
      ...sources.filter(s => s.type === 'pain_management_extractions' && s.fields.available === true && s.fields.treatment_plan).map(s => ({ id:s.id,date:s.date })),
    ]
    const applicable = candidates.filter(c => c.date && note.date && c.date <= note.date).sort((a,b) => b.date!.localeCompare(a.date!))
    const latest = applicable.filter(c => c.date === applicable[0]?.date)
    note.context.applicable_plan = { state:latest.length === 1 ? 'available' : latest.length > 1 ? 'ambiguous' : 'unavailable', source_ids:latest.map(c => c.id).sort(), unknown_date_source_ids:candidates.filter(c => !c.date).map(c => c.id).sort() }
    const source = sources.find(s => s.id === `procedure_notes:${note.id}`)
    if (source) source.fields.applicable_plan = note.context.applicable_plan
    if (latest.length !== 1) limitations.push(`Uncertain applicable plan: procedure_notes:${note.id}`)
  }
  for (const procedure of procedures.values()) if (!notes.some(n => n.procedure_id === procedure.id)) limitations.push(`Missing procedure note: procedures:${procedure.id}`)
  if (!notes.some(n => n.step === 'initial_visit' || n.step === 'pain_evaluation')) limitations.push('Missing origin note')
  if (!notes.some(n => n.step === 'procedure')) limitations.push('Missing procedure note')
  if (!notes.some(n => n.step === 'discharge')) limitations.push(episode.status === 'active' ? 'Episode in progress: discharge note not yet available' : 'Missing discharge note')
  notes.sort((a,b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.id.localeCompare(b.id))
  sources.sort((a,b) => a.id.localeCompare(b.id))
  versions.sort((a,b) => a.source_id.localeCompare(b.source_id))
  const snapshot: ReviewSnapshot = { version:REVIEW_VERSION,case_id:caseId,episode_id:episodeId,episode_status:episode.status,notes,sources,coverage:{complete:limitations.length === 0,limitations:limitations.sort()},versions }
  const discharge = notes.find(n => n.step === 'discharge')
  if (discharge) {
    const trajectory = buildReviewTrajectory(snapshot)
    if (trajectory) {
      sources.push({id:`qc_trajectory:${discharge.id}`,type:'derived_trajectory',scope:'episode',date:discharge.date,fields:JSON.parse(JSON.stringify(trajectory))})
      sources.sort((a,b) => a.id.localeCompare(b.id))
    } else {
      snapshot.coverage.complete = false
      snapshot.coverage.limitations.push('Numeric trajectory unavailable: missing dated procedure evidence')
      snapshot.coverage.limitations.sort()
    }
  }
  if (Buffer.byteLength(canonicalReviewJson(snapshot)) > MAX_INPUT_BYTES) throw new Error('Review input limit exceeded; no sources were truncated')
  return structuredClone(snapshot)
}

export async function collectStableReviewSnapshot(client: SupabaseClient<Database>, caseId: string, episodeId: string): Promise<ReviewSnapshot> {
  let previous = await collectReviewSnapshot(client,caseId,episodeId)
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await collectReviewSnapshot(client,caseId,episodeId)
    if (reviewVersionHash(current) === reviewVersionHash(previous)) return current
    previous = current
  }
  throw new Error('Clinical sources changed while preparing the review. Please retry.')
}
