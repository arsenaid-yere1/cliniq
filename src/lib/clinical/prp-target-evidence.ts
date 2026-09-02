import { z } from 'zod'
import {
  extractLaterality, isSpineRegion, lateralityCompatible, normalizeAnatomicLocation,
  normalizeRegion, normalizeSpinalLevel, type ClinicalLaterality,
} from './anatomic-normalization'

const lateralitySchema = z.enum(['left', 'right', 'bilateral']).nullable()

export const anatomicEvidenceSchema = z.object({
  id: z.string().min(1),
  source_table: z.enum(['mri_extractions', 'ct_scan_extractions', 'x_ray_extractions']),
  source_id: z.string().min(1),
  modality: z.enum(['MRI', 'CT', 'X-ray']),
  study_date: z.string().nullable(),
  region: z.string().min(1),
  level_or_location: z.string().min(1),
  laterality: lateralitySchema,
  description: z.string().min(1),
})

export const clinicalEvidenceSchema = z.object({
  id: z.string().min(1),
  source: z.enum(['current_complaint', 'current_exam', 'pm_exam']),
  region: z.string().min(1),
  laterality: lateralitySchema,
  description: z.string().min(1),
})

export const targetIneligibilityReasonSchema = z.enum([
  'missing_current_complaint', 'missing_current_exam', 'laterality_mismatch',
])

export const prpTargetCandidateSchema = z.object({
  id: z.string().min(1), region: z.string().min(1), level_or_location: z.string().min(1),
  laterality: lateralitySchema, anatomic_evidence_ids: z.array(z.string().min(1)).min(1),
  complaint_evidence_ids: z.array(z.string().min(1)), exam_evidence_ids: z.array(z.string().min(1)),
  supplemental_evidence_ids: z.array(z.string().min(1)), eligible: z.boolean(),
  ineligibility_reasons: z.array(targetIneligibilityReasonSchema),
})

export const prpTargetRecommendationSchema = z.object({
  candidate_id: z.string().min(1), region: z.string().min(1), level_or_location: z.string().min(1),
  laterality: lateralitySchema, target_structure: z.string().min(1),
  guidance_method: z.enum(['ultrasound', 'fluoroscopy', 'landmark']), approach: z.string().min(1),
  clinical_rationale: z.string().min(1), anatomic_evidence_ids: z.array(z.string().min(1)).min(1),
  clinical_evidence_ids: z.array(z.string().min(1)).min(2),
  anatomic_evidence: z.array(anatomicEvidenceSchema).min(1),
  clinical_evidence: z.array(clinicalEvidenceSchema).min(2),
})

export const prpTargetEvidenceBundleSchema = z.object({
  anatomic_evidence: z.array(anatomicEvidenceSchema), clinical_evidence: z.array(clinicalEvidenceSchema),
  candidates: z.array(prpTargetCandidateSchema),
})

export type AnatomicEvidence = z.infer<typeof anatomicEvidenceSchema>
export type ClinicalEvidence = z.infer<typeof clinicalEvidenceSchema>
export type PrpTargetCandidate = z.infer<typeof prpTargetCandidateSchema>
export type PrpTargetRecommendation = z.infer<typeof prpTargetRecommendationSchema>
export type PrpTargetEvidenceBundle = z.infer<typeof prpTargetEvidenceBundleSchema>

export type ImagingEvidenceRow = {
  id: string; source_table: AnatomicEvidence['source_table']; modality: AnatomicEvidence['modality']
  body_region: string | null; laterality?: ClinicalLaterality; study_date: string | null
  findings: unknown; provider_overrides?: Record<string, unknown> | null
}

type ProviderIntake = {
  chief_complaints?: { complaints?: Array<{ body_region?: string | null }> }
  exam_findings?: { regions?: Array<{ region?: string | null; palpation_findings?: string | null
    muscle_spasm?: boolean | null; additional_findings?: string | null }> }
} | null

type PmExam = { region?: string | null; palpation_findings?: string | null
  neurological_summary?: string | null; orthopedic_tests?: Array<{ name?: string; result?: string }> }

function effective<T>(row: ImagingEvidenceRow, key: string, fallback: T): T {
  const value = row.provider_overrides?.[key]
  return (value === undefined ? fallback : value) as T
}

function evidenceId(source: string, kind: string, index: number): string {
  return `${source}:${kind}:${index}`
}

function matches(evidence: ClinicalEvidence, region: string, laterality: ClinicalLaterality): boolean {
  return evidence.region === region && lateralityCompatible(laterality, evidence.laterality)
}

export function buildPrpTargetEvidence(input: {
  imagingRows: ImagingEvidenceRow[]; providerIntake: unknown; pmPhysicalExam?: unknown
}): PrpTargetEvidenceBundle {
  const providerIntake = (input.providerIntake ?? null) as ProviderIntake
  const anatomic: AnatomicEvidence[] = []
  for (const row of input.imagingRows) {
    const bodyRegion = effective(row, 'body_region', row.body_region)
    const region = normalizeRegion(bodyRegion)
    if (!region) continue
    const rowLaterality = effective(row, 'laterality', row.laterality ?? null)
    const dateKey = row.modality === 'MRI' ? 'mri_date' : 'scan_date'
    const studyDate = effective(row, dateKey, row.study_date)
    const findings = effective<unknown>(row, 'findings', row.findings)
    if (!Array.isArray(findings)) continue
    findings.forEach((raw, index) => {
      if (!raw || typeof raw !== 'object') return
      const finding = raw as { level?: unknown; description?: unknown }
      const originalLocation = typeof finding.level === 'string' ? finding.level.trim() : ''
      const description = typeof finding.description === 'string' ? finding.description.trim() : ''
      const location = isSpineRegion(region)
        ? normalizeSpinalLevel(originalLocation) : normalizeAnatomicLocation(originalLocation)
      if (!location || !description) return
      anatomic.push({
        id: evidenceId(row.id, 'anatomic', index), source_table: row.source_table,
        source_id: row.id, modality: row.modality, study_date: studyDate, region,
        level_or_location: location,
        laterality: rowLaterality ?? extractLaterality(`${bodyRegion ?? ''} ${originalLocation}`),
        description,
      })
    })
  }

  const clinical: ClinicalEvidence[] = []
  for (const [index, complaint] of (providerIntake?.chief_complaints?.complaints ?? []).entries()) {
    const original = complaint.body_region?.trim() ?? ''
    const region = normalizeRegion(original)
    if (region && original) clinical.push({ id: evidenceId('current', 'complaint', index),
      source: 'current_complaint', region, laterality: extractLaterality(original), description: original })
  }
  for (const [index, exam] of (providerIntake?.exam_findings?.regions ?? []).entries()) {
    const original = exam.region?.trim() ?? ''
    const region = normalizeRegion(original)
    const details = [exam.palpation_findings?.trim(), exam.muscle_spasm ? 'Muscle spasm present' : null,
      exam.additional_findings?.trim()].filter((v): v is string => Boolean(v))
    if (region && original && details.length) clinical.push({ id: evidenceId('current', 'exam', index),
      source: 'current_exam', region, laterality: extractLaterality(`${original} ${details.join(' ')}`),
      description: `${original}: ${details.join('; ')}` })
  }
  if (Array.isArray(input.pmPhysicalExam)) {
    for (const [index, exam] of (input.pmPhysicalExam as PmExam[]).entries()) {
      const original = exam.region?.trim() ?? ''
      const region = normalizeRegion(original)
      const tests = (exam.orthopedic_tests ?? []).map((t) => `${t.name ?? 'Test'}: ${t.result ?? 'documented'}`)
      const details = [exam.palpation_findings?.trim(), exam.neurological_summary?.trim(), ...tests]
        .filter((v): v is string => Boolean(v))
      if (region && original && details.length) clinical.push({ id: evidenceId('pm', 'exam', index),
        source: 'pm_exam', region, laterality: extractLaterality(`${original} ${details.join(' ')}`),
        description: `${original}: ${details.join('; ')}` })
    }
  }

  const groups = new Map<string, AnatomicEvidence[]>()
  for (const item of anatomic) {
    const key = `${item.region}|${item.level_or_location}|${item.laterality ?? 'unspecified'}`
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  const candidates: PrpTargetCandidate[] = [...groups.entries()].map(([id, anatomy]) => {
    const target = anatomy[0]
    const complaints = clinical.filter((e) => e.source === 'current_complaint' && matches(e, target.region, target.laterality))
    const exams = clinical.filter((e) => e.source === 'current_exam' && matches(e, target.region, target.laterality))
    const supplemental = clinical.filter((e) => e.source === 'pm_exam' && matches(e, target.region, target.laterality))
    const reasons: Array<z.infer<typeof targetIneligibilityReasonSchema>> = []
    if (!complaints.length) reasons.push('missing_current_complaint')
    if (!exams.length) reasons.push('missing_current_exam')
    const sameRegion = clinical.filter((e) => e.region === target.region)
    if (sameRegion.length && !complaints.length && !exams.length && !supplemental.length) reasons.push('laterality_mismatch')
    return { id, region: target.region, level_or_location: target.level_or_location,
      laterality: target.laterality, anatomic_evidence_ids: anatomy.map((e) => e.id),
      complaint_evidence_ids: complaints.map((e) => e.id), exam_evidence_ids: exams.map((e) => e.id),
      supplemental_evidence_ids: supplemental.map((e) => e.id), eligible: !reasons.length,
      ineligibility_reasons: reasons }
  })
  return prpTargetEvidenceBundleSchema.parse({ anatomic_evidence: anatomic, clinical_evidence: clinical, candidates })
}

type ModelSelection = Pick<PrpTargetRecommendation,
  'candidate_id' | 'target_structure' | 'guidance_method' | 'approach' | 'clinical_rationale'>

export function validatePrpTargetSelections(
  selections: ModelSelection[], bundle: PrpTargetEvidenceBundle,
): { data?: PrpTargetRecommendation[]; error?: string } {
  const candidates = new Map(bundle.candidates.map((c) => [c.id, c]))
  const seen = new Set<string>()
  const output: PrpTargetRecommendation[] = []
  for (const selection of selections) {
    if (seen.has(selection.candidate_id)) return { error: `Duplicate PRP target: ${selection.candidate_id}` }
    seen.add(selection.candidate_id)
    const candidate = candidates.get(selection.candidate_id)
    if (!candidate) return { error: `Unknown PRP target: ${selection.candidate_id}` }
    if (!candidate.eligible) return { error: `Ineligible PRP target: ${selection.candidate_id}` }
    if (selection.guidance_method !== 'ultrasound') {
      return { error: `PRP target must use ultrasound guidance: ${selection.candidate_id}` }
    }
    const parsed = prpTargetRecommendationSchema.safeParse({ ...selection, region: candidate.region,
      level_or_location: candidate.level_or_location, laterality: candidate.laterality,
      anatomic_evidence_ids: candidate.anatomic_evidence_ids,
      clinical_evidence_ids: [...candidate.complaint_evidence_ids, ...candidate.exam_evidence_ids,
        ...candidate.supplemental_evidence_ids],
      anatomic_evidence: candidate.anatomic_evidence_ids.map((id) => bundle.anatomic_evidence.find((e) => e.id === id)),
      clinical_evidence: [...candidate.complaint_evidence_ids, ...candidate.exam_evidence_ids,
        ...candidate.supplemental_evidence_ids].map((id) => bundle.clinical_evidence.find((e) => e.id === id)),
    })
    if (!parsed.success) return { error: `Invalid PRP target details: ${selection.candidate_id}` }
    output.push(parsed.data)
  }
  return { data: output }
}
