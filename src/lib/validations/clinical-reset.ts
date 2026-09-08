import { z } from 'zod'

export const clinicalNoteKindSchema = z.enum(['initial_visit_notes', 'procedure_notes', 'discharge_notes', 'pain_follow_up_notes'])
export type ClinicalNoteKind = z.infer<typeof clinicalNoteKindSchema>
export const clinicalResetRequestSchema = z.object({
  case_id: z.string().uuid(),
  episode_id: z.string().uuid(),
  case_version: z.string().min(1),
  episode_version: z.string().min(1),
  reactivate: z.boolean(),
  reason: z.string().trim().max(1000),
  request_key: z.string().uuid(),
  notes: z.array(z.object({
    kind: clinicalNoteKindSchema,
    id: z.string().uuid(),
    updated_at: z.string().min(1),
    keep_content: z.boolean().optional(),
  }).strict()).max(100),
}).strict().superRefine((value, ctx) => {
  if (!value.reactivate && !value.notes.length) ctx.addIssue({ code: 'custom', message: 'Select a note to reset' })
  if (value.reactivate && value.reason.length < 10) ctx.addIssue({ code: 'custom', message: 'Enter a reason of at least 10 characters' })
  if (new Set(value.notes.map(n => `${n.kind}:${n.id}`)).size !== value.notes.length) ctx.addIssue({ code: 'custom', message: 'Duplicate note selection' })
})
export type ClinicalResetRequest = z.infer<typeof clinicalResetRequestSchema>

export interface ClinicalResetPreview {
  case_id: string
  case_status: string
  case_version: string
  episode_id: string
  episode_number: number
  episode_status: string
  episode_version: string
  is_admin: boolean
  latest_episode: boolean
  open_correction: boolean
  reopened: boolean
  notes: Array<{
    id: string
    kind: ClinicalNoteKind
    status: string
    updated_at: string
    visit_type: string | null
    date: string | null
    procedure_id: string | null
    encounter_id: string | null
    blockers: Array<{ kind: string; id: string; message: string }>
  }>
}

export function clinicalNoteLabel(note: ClinicalResetPreview['notes'][number]) {
  const name = note.kind === 'initial_visit_notes'
    ? (note.visit_type === 'pain_evaluation_visit' ? 'Pain evaluation' : 'Initial visit')
    : { procedure_notes: 'Procedure note', discharge_notes: 'Discharge summary', pain_follow_up_notes: 'Follow-up note' }[note.kind]
  return `${name}${note.date ? ` · ${note.date}` : ''}`
}
