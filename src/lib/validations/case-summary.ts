import { z } from 'zod'

// --- Sub-schemas for JSONB fields ---

const imagingFindingSchema = z.object({
  body_region: z.string(),
  summary: z.string(),
  key_findings: z.array(z.string()),
  severity: z.enum(['mild', 'moderate', 'severe']).nullable(),
})

const priorTreatmentSchema = z.object({
  modalities: z.array(z.string()),
  total_visits: z.number().nullable(),
  treatment_period: z.string().nullable(),
  gaps: z.array(z.object({
    from: z.string(),
    to: z.string(),
    days: z.number(),
  })),
})

const symptomsTimelineSchema = z.object({
  onset: z.string().nullable(),
  progression: z.array(z.object({
    date: z.string().nullable(),
    description: z.string(),
  })),
  current_status: z.string().nullable(),
  pain_levels: z.array(z.object({
    date: z.string().nullable(),
    level: z.number(),
    context: z.string().nullable(),
  })),
})

const suggestedDiagnosisSchema = z.object({
  diagnosis: z.string(),
  icd10_code: z.string().nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
  supporting_evidence: z.string().nullable(),
  // Pre-computed downgrade target for myelopathy/radiculopathy codes that
  // fail the OBJECTIVE-SUPPORT RUBRIC. Populated by the case summary AI at
  // Rule 8b so downstream note generators do not re-derive the substitution.
  // Null when the code passes or no downgrade applies.
  downgrade_to: z.string().nullable().optional(),
})

// --- AI result schema (validates Claude's tool output) ---

export const caseSummaryResultSchema = z.object({
  chief_complaint: z.string().nullable(),
  imaging_findings: z.array(imagingFindingSchema),
  prior_treatment: priorTreatmentSchema,
  symptoms_timeline: symptomsTimelineSchema,
  suggested_diagnoses: z.array(suggestedDiagnosisSchema),
  confidence: z.enum(['high', 'medium', 'low']),
  extraction_notes: z.string().nullable(),
})

export type CaseSummaryResult = z.infer<typeof caseSummaryResultSchema>

// --- Provider edit form schema ---

export const caseSummaryEditSchema = z.object({
  chief_complaint: z.string().nullable(),
  imaging_findings: z.array(imagingFindingSchema.extend({
    body_region: z.string().min(1, 'Body region is required'),
    summary: z.string().min(1, 'Summary is required'),
  })),
  prior_treatment: priorTreatmentSchema,
  symptoms_timeline: symptomsTimelineSchema,
  suggested_diagnoses: z.array(suggestedDiagnosisSchema.extend({
    diagnosis: z.string().min(1, 'Diagnosis is required'),
  })),
})

export type CaseSummaryEditValues = z.infer<typeof caseSummaryEditSchema>

// --- Re-export sub-schema types for UI ---

export type ImagingFinding = z.infer<typeof imagingFindingSchema>
export type PriorTreatment = z.infer<typeof priorTreatmentSchema>
export type SymptomsTimeline = z.infer<typeof symptomsTimelineSchema>
export type SuggestedDiagnosis = z.infer<typeof suggestedDiagnosisSchema>
