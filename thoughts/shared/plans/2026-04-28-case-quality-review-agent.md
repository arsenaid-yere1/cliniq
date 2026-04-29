---
date: 2026-04-28T22:43:32Z
researcher: arsenaid
git_commit: 4536cf24a722be287e0a2c6227020e050ed98327
branch: main
repository: cliniq
topic: "Case-level chain-aware QC reviewer agent (A2)"
tags: [plan, qc, claude-agent, case-quality-review, opus-4-7, provider-overrides]
status: ready
last_updated: 2026-04-29
last_updated_note: "Added provider-override layer: per-finding ack/dismiss/edit via sidecar finding_overrides jsonb, cleared on regen."
---

# Case Quality Review Agent Implementation Plan

## Overview

Add chain-aware case-level QC reviewer. Manual trigger only. Reads all PI-workflow notes for a case (initial visit, pain-evaluation visit, procedures, discharge) plus extractions and case summary, runs Claude Opus 4.7 (1M context) single-shot with extended thinking, writes structured `findings[]` to a new `case_quality_reviews` table. Surface on new `/patients/[caseId]/qc` subroute with realtime progress and severity-grouped findings list. Each finding deep-links to the relevant editor URL (no anchor scroll).

Mirrors the `case_summaries` pattern end-to-end: same DDL shape, same status enum, same throttled progress writer, same `callClaudeTool` infrastructure, same `<GeneratingProgress>` realtime widget.

## Current State Analysis

Confirmed via [thoughts/shared/research/2026-04-28-clinical-note-qc-pi-workflow.md](../research/2026-04-28-clinical-note-qc-pi-workflow.md):

- 5 generators in PI workflow: IV ([src/lib/claude/generate-initial-visit.ts](../../src/lib/claude/generate-initial-visit.ts)), imaging order ([src/lib/claude/generate-clinical-orders.ts](../../src/lib/claude/generate-clinical-orders.ts)), pain-eval IV (same generator, `visit_type='pain_evaluation_visit'`), procedure ([src/lib/claude/generate-procedure-note.ts](../../src/lib/claude/generate-procedure-note.ts)), discharge ([src/lib/claude/generate-discharge-note.ts](../../src/lib/claude/generate-discharge-note.ts)).
- Only existing post-gen verifier: [src/lib/claude/pain-trajectory-validator.ts](../../src/lib/claude/pain-trajectory-validator.ts), discharge-only, regex-based, warnings persisted in `raw_ai_response.trajectory_warnings`, no UI consumer.
- No cross-step verifier exists. No generator reads any other generator's `raw_ai_response`.
- `source_data_hash` is written on every note table but compared only by `checkSummaryStaleness` ([src/actions/case-summaries.ts:244-263](../../src/actions/case-summaries.ts)).
- `case_summaries` is the canonical pattern to mirror: [supabase/migrations/006_case_summaries.sql](../../supabase/migrations/006_case_summaries.sql), [src/actions/case-summaries.ts](../../src/actions/case-summaries.ts), [src/lib/claude/generate-summary.ts](../../src/lib/claude/generate-summary.ts), [src/lib/validations/case-summary.ts](../../src/lib/validations/case-summary.ts), [src/components/clinical/case-summary-card.tsx](../../src/components/clinical/case-summary-card.tsx).
- Case sidebar nav: [src/components/patients/case-sidebar.tsx:27-36](../../src/components/patients/case-sidebar.tsx). Add one entry for QC.
- `<GeneratingProgress>` realtime widget already wired for `case_summaries`; reusable with `realtimeTable="case_quality_reviews"`.
- Toast: sonner, uniform `toast.error(result.error)` / `toast.success(...)` pattern.
- Shared client: [src/lib/claude/client.ts:54](../../src/lib/claude/client.ts) `callClaudeTool` — supports `thinking` config, `toolChoice: 'auto'`, `onProgress` streaming. Used by all generators including `generate-summary.ts` with thinking enabled.

## Desired End State

- New table `case_quality_reviews` per case, partial-unique on `(case_id) WHERE deleted_at IS NULL`.
- New route `/patients/[caseId]/qc` with QC nav entry in sidebar.
- Manual trigger: "Run Review" button on QC page calls `runCaseQualityReview(caseId)`.
- Realtime progress via `<GeneratingProgress realtimeTable="case_quality_reviews" ...>`.
- Findings list grouped by severity (`critical` → `warning` → `info`); each finding has clickable card with: severity badge, step badge (IV / pain-eval / procedure / discharge), section name, message, "View in editor" link.
- Stale detection via `source_data_hash` recompute, identical to `checkSummaryStaleness` pattern.
- No regressions: existing finalize / save / regen flows untouched.

### Verification:
- `case_quality_reviews` row visible via `select * from case_quality_reviews where case_id = ...`.
- Manual flow: open `/patients/[caseId]/qc`, click "Run Review", see progress tick, see findings render with deep-link buttons.
- Stale flow: edit a finalized note, return to QC tab, see "Stale — re-run" button.
- No code path in `finalizeDischargeNote`, `finalizeProcedureNote`, or `finalizeInitialVisitNote` changed.

### Key Discoveries:
- Discharge action ([src/actions/discharge-notes.ts:553](../../src/actions/discharge-notes.ts)) gather function is the closest model for chain-aware data assembly — pulls procedures, IV, case summary, PT/PM/chiro/MRI extractions in one parallel batch.
- `generate-summary.ts` (lines 296–310) is only existing generator using `thinking: { type: 'enabled', budget_tokens: 8000 }` and `toolChoice: { type: 'auto' }` — model for QC reviewer prompt config.
- Throttled progress writer pattern at [src/actions/case-summaries.ts:159-171](../../src/actions/case-summaries.ts) is the canonical 500ms-coalesced `sections_done` updater.
- Finding deep-links target existing editor URLs (`/patients/{caseId}/initial-visit`, `/patients/{caseId}/procedures/{procedureId}/note`, `/patients/{caseId}/discharge`). No section anchors required.

## Provider Override Layer

Each finding can be acknowledged, dismissed, or edited by the provider. State persisted in a sidecar `finding_overrides jsonb` column on `case_quality_reviews`, keyed by stable finding hash so positional reordering between regens (if any) does not shuffle ack state.

- Per-finding status enum: `'pending' | 'acknowledged' | 'dismissed' | 'edited'`. Default `'pending'` (no entry in `finding_overrides`).
- `acknowledged` = "I see this, action taken or noted, leave it visible."
- `dismissed` = "Not actually an issue / false positive, hide from active list."
- `edited` = "Provider rewrote the message / rationale / suggested_tone_hint." Stores override text alongside.
- Override entry shape (one per finding hash):
  ```ts
  {
    status: 'acknowledged' | 'dismissed' | 'edited',
    dismissed_reason: string | null,
    edited_message: string | null,
    edited_rationale: string | null,
    edited_suggested_tone_hint: string | null,
    actor_user_id: string,  // who set this state
    set_at: string,          // ISO timestamp
  }
  ```
- Finding hash: SHA-256 of `${finding.severity}|${finding.step}|${finding.note_id ?? ''}|${finding.procedure_id ?? ''}|${finding.section_key ?? ''}|${finding.message}`. Stable across re-reads of the same row; collisions vanishingly unlikely within a single review.
- **Regen wipes overrides**: `runCaseQualityReview` soft-deletes the existing row and inserts a fresh one. Overrides do NOT carry forward — clean slate matching existing soft-delete-and-reinsert convention used by discharge.
- UI controls per finding card: Acknowledge button, Dismiss button (with optional reason input), Edit dialog (inline form). Dismissed findings collapse into a "Dismissed (N)" disclosure section at the bottom of each severity group.

## What We're NOT Doing

- No auto-trigger hooks in any `finalize*Note` action. Manual only.
- No anchor deep-links to editor sections. Finding card links to editor URL; section name shown as text.
- No toast on note finalize about QC.
- No PDF export of findings.
- No `review_status` / approve / reject workflow on the review row itself (severity is the signal; override state lives per-finding).
- No carry-forward of overrides across regens — Recheck wipes prior overrides.
- No `quality_signals` extension to other notes' `raw_ai_response`.
- No Claude Agent SDK / multi-turn tool loop. Single-shot `callClaudeTool` only.
- No notifications outside the QC tab.
- No changes to existing 5 generators or their prompts.
- No changes to existing `case-timeline.tsx` event types.
- No separate table for finding overrides (sidecar jsonb column only).

## Implementation Approach

Mirror `case_summaries` pattern at every layer. Single migration. Single generator file. Single action file. Single new page + one new component + one nav entry. The codebase has tight conventions; deviating is the higher risk.

## Phase 1: Database Migration + Zod Validations

### Overview
Create `case_quality_reviews` table. Define zod result + edit schemas (edit schema unused initially but mirrors case-summaries shape for future symmetry).

### Changes Required:

#### 1.1 Migration
**File**: `supabase/migrations/20260429_case_quality_reviews.sql`
**Changes**: New table, indexes, trigger, RLS policy.

```sql
-- Migration: case_quality_reviews
-- Chain-aware QC reviewer output. One active row per case (partial unique).
-- Mirrors case_summaries DDL pattern.

create table public.case_quality_reviews (
  id uuid primary key default uuid_generate_v4(),
  case_id uuid not null references public.cases(id),

  -- AI output payload
  findings jsonb not null default '[]',
  summary text,
  overall_assessment text check (overall_assessment in ('clean', 'minor_issues', 'major_issues', 'incomplete')),

  -- Provider override layer (sidecar). Keyed by finding hash → override entry.
  -- Wiped on regen (soft-delete + re-insert pattern).
  finding_overrides jsonb not null default '{}',

  -- Audit
  ai_model text,
  raw_ai_response jsonb,

  -- Generation tracking (mirrors case_summaries)
  generation_status text not null default 'pending'
    check (generation_status in ('pending', 'processing', 'completed', 'failed')),
  generation_error text,
  generation_attempts integer not null default 0,
  generated_at timestamptz,
  source_data_hash text,
  sections_done integer not null default 0,
  sections_total integer not null default 0,

  -- Standard audit timestamps
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references public.users(id),
  updated_by_user_id uuid references public.users(id),
  deleted_at timestamptz
);

create index idx_case_quality_reviews_case_id on public.case_quality_reviews(case_id);
create index idx_case_quality_reviews_generation_status on public.case_quality_reviews(generation_status);
create index idx_case_quality_reviews_findings on public.case_quality_reviews using gin(findings);
create index idx_case_quality_reviews_finding_overrides on public.case_quality_reviews using gin(finding_overrides);

create unique index idx_case_quality_reviews_case_active
  on public.case_quality_reviews(case_id)
  where deleted_at is null;

create trigger set_updated_at before update on public.case_quality_reviews
  for each row execute function update_updated_at();

alter table public.case_quality_reviews enable row level security;

create policy "Authenticated users full access" on public.case_quality_reviews
  for all using (auth.role() = 'authenticated');
```

#### 1.2 Zod Validations
**File**: `src/lib/validations/case-quality-review.ts` (new)
**Changes**: Schemas for finding, AI result, and DB row.

```ts
import { z } from 'zod'

export const qcSeverityValues = ['info', 'warning', 'critical'] as const
export type QcSeverity = (typeof qcSeverityValues)[number]

export const qcStepValues = [
  'initial_visit',
  'pain_evaluation',
  'procedure',
  'discharge',
  'case_summary',
  'cross_step',
] as const
export type QcStep = (typeof qcStepValues)[number]

export const qcOverallAssessmentValues = [
  'clean',
  'minor_issues',
  'major_issues',
  'incomplete',
] as const
export type QcOverallAssessment = (typeof qcOverallAssessmentValues)[number]

// Single finding from AI tool output
export const qualityFindingSchema = z.object({
  severity: z.enum(qcSeverityValues),
  step: z.enum(qcStepValues),
  note_id: z.string().uuid().nullable(),       // null when finding spans multiple notes
  procedure_id: z.string().uuid().nullable(),  // populated only for step='procedure'
  section_key: z.string().nullable(),          // section column name (e.g. 'subjective'); null when finding is whole-note
  message: z.string().min(1),
  rationale: z.string().nullable(),
  suggested_tone_hint: z.string().nullable(),
})
export type QualityFinding = z.infer<typeof qualityFindingSchema>

// Full AI tool output schema
export const qualityReviewResultSchema = z.object({
  findings: z.array(qualityFindingSchema),
  summary: z.string().nullable(),
  overall_assessment: z.enum(qcOverallAssessmentValues),
})
export type QualityReviewResult = z.infer<typeof qualityReviewResultSchema>

// Provider-override layer
export const findingOverrideStatusValues = [
  'acknowledged',
  'dismissed',
  'edited',
] as const
export type FindingOverrideStatus = (typeof findingOverrideStatusValues)[number]

export const findingOverrideEntrySchema = z.object({
  status: z.enum(findingOverrideStatusValues),
  dismissed_reason: z.string().nullable(),
  edited_message: z.string().nullable(),
  edited_rationale: z.string().nullable(),
  edited_suggested_tone_hint: z.string().nullable(),
  actor_user_id: z.string().uuid(),
  set_at: z.string(),
})
export type FindingOverrideEntry = z.infer<typeof findingOverrideEntrySchema>

// Map of finding-hash → override entry. Stored as jsonb on case_quality_reviews.finding_overrides.
export const findingOverridesMapSchema = z.record(z.string(), findingOverrideEntrySchema)
export type FindingOverridesMap = z.infer<typeof findingOverridesMapSchema>

// Edit-dialog form schema (subset of FindingOverrideEntry the provider can write).
export const findingEditFormSchema = z.object({
  edited_message: z.string().min(1, 'Required'),
  edited_rationale: z.string().nullable(),
  edited_suggested_tone_hint: z.string().nullable(),
})
export type FindingEditFormValues = z.infer<typeof findingEditFormSchema>

// Dismiss-dialog form schema.
export const findingDismissFormSchema = z.object({
  dismissed_reason: z.string().nullable(),
})
export type FindingDismissFormValues = z.infer<typeof findingDismissFormSchema>

// Stable hash for a finding — used as the key into FindingOverridesMap.
// Inputs are exactly the fields a regen would re-emit identically when the
// underlying drift has not changed; messages reordered or slightly reworded
// will hash differently, which is acceptable: the override layer is wiped
// on regen anyway.
import { createHash } from 'node:crypto'
export function computeFindingHash(finding: QualityFinding): string {
  const parts = [
    finding.severity,
    finding.step,
    finding.note_id ?? '',
    finding.procedure_id ?? '',
    finding.section_key ?? '',
    finding.message,
  ].join('|')
  return createHash('sha256').update(parts).digest('hex')
}
```

### Success Criteria:

#### Automated Verification:
- [x] Migration applies cleanly: `npx supabase db push --include-all`
- [x] Type check passes: `npx tsc --noEmit`
- [x] Lint passes: `npm run lint` (0 errors; pre-existing warnings only)
- [x] Unique partial index defined (`idx_case_quality_reviews_case_active`); enforces 23505 on duplicate active row.

#### Manual Verification:
- [ ] Migration appears in Supabase Studio table list with all listed columns/indexes/RLS policy.
- [ ] No phantom rows on remote (run `npx supabase db diff` clean after push).

**Implementation Note**: After Phase 1 verification passes, pause for user confirmation before Phase 2.

---

## Phase 2: Claude Generator

### Overview
New generator file producing structured QC findings. Reads everything in one input payload. Single tool call with `thinking: enabled`. Model `claude-opus-4-7[1m]`.

### Changes Required:

#### 2.1 Generator
**File**: `src/lib/claude/generate-quality-review.ts` (new)
**Changes**: Tool definition, system prompt, `generateQualityReviewFromData` export.

```ts
import type Anthropic from '@anthropic-ai/sdk'
import { callClaudeTool } from './client'
import {
  qualityReviewResultSchema,
  type QualityReviewResult,
} from '@/lib/validations/case-quality-review'

// Input data shape — assembled by the action layer from all PI-workflow rows.
export interface QualityReviewInputData {
  caseDetails: {
    case_number: string
    accident_type: string | null
    accident_date: string | null
  }
  patientInfo: {
    first_name: string
    last_name: string
    date_of_birth: string | null
    age: number | null
  }
  caseSummary: {
    chief_complaint: string | null
    imaging_findings: unknown
    suggested_diagnoses: unknown
    review_status: string
    raw_ai_response: unknown
  } | null
  initialVisitNote: {
    id: string
    visit_type: string
    visit_date: string | null
    status: string
    diagnoses: string | null
    chief_complaint: string | null
    physical_exam: string | null
    treatment_plan: string | null
    medical_necessity: string | null
    prognosis: string | null
    raw_ai_response: unknown
  } | null
  painEvaluationNote: {
    id: string
    visit_date: string | null
    status: string
    diagnoses: string | null
    chief_complaint: string | null
    physical_exam: string | null
    treatment_plan: string | null
    prognosis: string | null
    raw_ai_response: unknown
  } | null
  procedureNotes: Array<{
    id: string
    procedure_id: string
    procedure_date: string | null
    procedure_number: number
    status: string
    subjective: string | null
    assessment_summary: string | null
    procedure_injection: string | null
    assessment_and_plan: string | null
    prognosis: string | null
    plan_alignment_status: string | null
    pain_score_min: number | null
    pain_score_max: number | null
    diagnoses: unknown
    raw_ai_response: unknown
  }>
  dischargeNote: {
    id: string
    visit_date: string | null
    status: string
    subjective: string | null
    objective_vitals: string | null
    diagnoses: string | null
    assessment: string | null
    plan_and_recommendations: string | null
    prognosis: string | null
    pain_score_max: number | null
    pain_trajectory_text: string | null
    raw_ai_response: unknown // contains trajectory_warnings
  } | null
  extractionsSummary: {
    mri_count: number
    pt_count: number
    pm_count: number
    chiro_count: number
    ortho_count: number
    ct_count: number
    xray_count: number
  }
}

export const QUALITY_REVIEW_SECTIONS_TOTAL = 3 // findings, summary, overall_assessment

const SYSTEM_PROMPT = `You are a clinical-documentation QC reviewer for a personal-injury PRP injection clinic.
Your job: read the entire PI-workflow note chain for one case (initial visit → pain evaluation → procedures → discharge) and surface inconsistencies, contradictions, missing context, or rule violations a reviewer should fix before the chart is final.

OUTPUT CONTRACT
- Call the generate_case_quality_review tool exactly once with three top-level fields: findings[], summary, overall_assessment.
- Each finding must cite a specific note (note_id) and ideally a specific section_key (e.g. 'subjective', 'diagnoses', 'plan_and_recommendations').
- procedure_id is required when step='procedure'.
- note_id is null only when the finding spans multiple notes (cross_step).
- Severity tiers: 'critical' = blocks defensible documentation; 'warning' = inconsistency or missing rationale; 'info' = stylistic / minor.
- suggested_tone_hint is a short string the provider can paste into the editor's tone hint to drive a regen.

WHAT TO CHECK
1. Diagnosis progression. ICD-10 codes should evolve coherently across IV → pain-eval → procedure → discharge. Flag radiculopathy emerging without imaging support, M54.5 used without 5th-character specificity, "A"-suffix codes persisting at discharge.
2. Pain trajectory consistency. Discharge subjective should narrate IV → procedure → discharge pain values monotonically against the deterministic arrow chain. Flag fabricated numbers, missing endpoint, paraphrased arrow chains. Read discharge.raw_ai_response.trajectory_warnings if present — it already lists trajectory drift; you must promote those into findings, not duplicate them.
3. Plan continuity. IV treatment_plan → procedure procedure_indication / assessment_and_plan → discharge plan_and_recommendations should reference the same modalities and progress.
4. Provider intake echo. If the IV provider_intake or PM provider_overrides set a chief complaint, downstream notes citing a different chief complaint = warning.
5. Procedure plan alignment. Any procedure with plan_alignment_status='unplanned' must show acknowledgement language in assessment_and_plan. Flag if missing.
6. Pain-evaluation NUMERIC-ANCHOR. If pain-evaluation note exists, it must reference a numeric pain anchor against the prior IV. Flag if anchor missing.
7. Cross-note copy/paste. Verbatim sentence reuse across procedure notes (NO CLONE rule violation).
8. Symptom resolution. Discharge diagnoses should not include codes whose symptoms the discharge subjective reports as resolved.
9. Missing-vitals branch. If any procedure has missing pain vitals, the discharge MISSING-VITALS BRANCH must apply — flag if narrative cites numeric delta against missing anchor.
10. Forbidden-phrase scan. "complete resolution", "full recovery", "regenerative capacity" in any prognosis section.

OVERALL ASSESSMENT
- 'clean' = zero critical or warning findings.
- 'minor_issues' = info or warning only.
- 'major_issues' = at least one critical.
- 'incomplete' = required notes are missing (no IV, no procedures, no discharge).

DO NOT
- Fabricate note_ids. Use only ids present in input.
- Recommend rewrites for content already covered by deterministic rules (pain tone matrix, plan alignment) — those are the generators' job. Your job is to flag drift between what the rules required and what the LLM produced.
- Output more than 25 findings total. Prioritize critical → warning → info.`

const REVIEW_TOOL: Anthropic.Tool = {
  name: 'generate_case_quality_review',
  description: 'Output a structured QC review of the case PI-workflow note chain.',
  input_schema: {
    type: 'object',
    required: ['findings', 'summary', 'overall_assessment'],
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          required: ['severity', 'step', 'note_id', 'procedure_id', 'section_key', 'message', 'rationale', 'suggested_tone_hint'],
          properties: {
            severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
            step: { type: 'string', enum: ['initial_visit', 'pain_evaluation', 'procedure', 'discharge', 'case_summary', 'cross_step'] },
            note_id: { type: ['string', 'null'] },
            procedure_id: { type: ['string', 'null'] },
            section_key: { type: ['string', 'null'] },
            message: { type: 'string' },
            rationale: { type: ['string', 'null'] },
            suggested_tone_hint: { type: ['string', 'null'] },
          },
        },
      },
      summary: { type: ['string', 'null'] },
      overall_assessment: { type: 'string', enum: ['clean', 'minor_issues', 'major_issues', 'incomplete'] },
    },
  },
}

export async function generateQualityReviewFromData(
  inputData: QualityReviewInputData,
  onProgress?: (completedKeys: string[]) => void | Promise<void>,
): Promise<{
  data?: QualityReviewResult
  rawResponse?: unknown
  error?: string
}> {
  const result = await callClaudeTool<QualityReviewResult>({
    model: 'claude-opus-4-7[1m]',
    system: SYSTEM_PROMPT,
    tools: [REVIEW_TOOL],
    toolName: 'generate_case_quality_review',
    toolChoice: { type: 'auto' },
    thinking: { type: 'enabled', budget_tokens: 8000 },
    maxTokens: 16000,
    messages: [
      {
        role: 'user',
        content: `Review the following case for quality and consistency.\n\n${JSON.stringify(inputData, null, 2)}`,
      },
    ],
    parse: (raw) => {
      const parsed = qualityReviewResultSchema.safeParse(raw)
      if (parsed.success) return { success: true, data: parsed.data }
      return { success: false, error: parsed.error }
    },
    onProgress,
  })

  if ('error' in result && result.error) {
    return { error: result.error, rawResponse: result.rawResponse }
  }
  if ('data' in result) {
    return { data: result.data, rawResponse: result.rawResponse }
  }
  return { error: 'Unknown failure' }
}
```

### Success Criteria:

#### Automated Verification:
- [x] Type check passes: `npx tsc --noEmit`
- [x] Tool schema accepts all 6 step values + 3 severity values (verified by zod schema construction).
- [x] Lint passes: `npm run lint`

#### Manual Verification:
- [ ] (Deferred to Phase 3 when wired up — generator alone has no UI to test.)

---

## Phase 3: Server Action

### Overview
Action file mirroring `case-summaries.ts` shape. Exports `runCaseQualityReview`, `getCaseQualityReview`, `recheckCaseQualityReview`, `checkQualityReviewStaleness`, plus override mutators: `acknowledgeFinding`, `dismissFinding`, `editFinding`, `clearFindingOverride`. Gathers all PI-workflow rows in parallel.

### Changes Required:

#### 3.1 Action File
**File**: `src/actions/case-quality-reviews.ts` (new)
**Changes**: Full action surface.

```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { createHash } from 'node:crypto'
import {
  generateQualityReviewFromData,
  QUALITY_REVIEW_SECTIONS_TOTAL,
  type QualityReviewInputData,
} from '@/lib/claude/generate-quality-review'
import { assertCaseNotClosed } from '@/actions/case-status'
import { computeAgeAtDate } from '@/lib/age'

function computeSourceHash(inputData: QualityReviewInputData): string {
  return createHash('sha256').update(JSON.stringify(inputData)).digest('hex')
}

async function gatherSourceData(
  supabase: Awaited<ReturnType<typeof createClient>>,
  caseId: string,
): Promise<{ data: QualityReviewInputData | null; error: string | null }> {
  const [
    caseRes,
    summaryRes,
    ivRes,        // both visit types — we resolve below
    procedureNotesRes,
    dischargeRes,
    mriCountRes,
    ptCountRes,
    pmCountRes,
    chiroCountRes,
    orthoCountRes,
    ctCountRes,
    xrayCountRes,
  ] = await Promise.all([
    supabase
      .from('cases')
      .select('case_number, accident_type, accident_date, patient:patients!inner(first_name, last_name, date_of_birth)')
      .eq('id', caseId)
      .is('deleted_at', null)
      .single(),
    supabase
      .from('case_summaries')
      .select('chief_complaint, imaging_findings, suggested_diagnoses, review_status, raw_ai_response')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('initial_visit_notes')
      .select('id, visit_type, visit_date, status, diagnoses, chief_complaint, physical_exam, treatment_plan, medical_necessity, prognosis, raw_ai_response')
      .eq('case_id', caseId)
      .is('deleted_at', null),
    supabase
      .from('procedure_notes')
      .select('id, procedure_id, status, subjective, assessment_summary, procedure_injection, assessment_and_plan, prognosis, plan_alignment_status, raw_ai_response, procedures!inner(id, procedure_date, procedure_number, diagnoses)')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .order('procedure_id', { ascending: true }),
    supabase
      .from('discharge_notes')
      .select('id, visit_date, status, subjective, objective_vitals, diagnoses, assessment, plan_and_recommendations, prognosis, pain_score_max, pain_trajectory_text, raw_ai_response')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase.from('mri_extractions').select('id', { count: 'exact', head: true }).eq('case_id', caseId).in('review_status', ['approved', 'edited']).is('deleted_at', null),
    supabase.from('pt_extractions').select('id', { count: 'exact', head: true }).eq('case_id', caseId).in('review_status', ['approved', 'edited']).is('deleted_at', null),
    supabase.from('pain_management_extractions').select('id', { count: 'exact', head: true }).eq('case_id', caseId).in('review_status', ['approved', 'edited']).is('deleted_at', null),
    supabase.from('chiro_extractions').select('id', { count: 'exact', head: true }).eq('case_id', caseId).in('review_status', ['approved', 'edited']).is('deleted_at', null),
    supabase.from('orthopedic_extractions').select('id', { count: 'exact', head: true }).eq('case_id', caseId).in('review_status', ['approved', 'edited']).is('deleted_at', null),
    supabase.from('ct_scan_extractions').select('id', { count: 'exact', head: true }).eq('case_id', caseId).in('review_status', ['approved', 'edited']).is('deleted_at', null),
    supabase.from('x_ray_extractions').select('id', { count: 'exact', head: true }).eq('case_id', caseId).in('review_status', ['approved', 'edited']).is('deleted_at', null),
  ])

  if (caseRes.error || !caseRes.data) {
    return { data: null, error: 'Failed to fetch case details' }
  }

  const patient = caseRes.data.patient as unknown as {
    first_name: string
    last_name: string
    date_of_birth: string | null
  }

  const ivRows = ivRes.data ?? []
  const initialVisit = ivRows.find((r) => r.visit_type === 'initial_visit') ?? null
  const painEval = ivRows.find((r) => r.visit_type === 'pain_evaluation_visit') ?? null

  // Procedure-vitals lookup so each procedure note carries its pain numbers.
  const procIds = (procedureNotesRes.data ?? []).map((n) => n.procedure_id)
  const { data: vitals } = procIds.length
    ? await supabase
        .from('vital_signs')
        .select('procedure_id, pain_score_min, pain_score_max')
        .in('procedure_id', procIds)
        .is('deleted_at', null)
    : { data: [] as Array<{ procedure_id: string; pain_score_min: number | null; pain_score_max: number | null }> }
  const vitalsByProc = new Map((vitals ?? []).map((v) => [v.procedure_id, v]))

  const procedureNotes = (procedureNotesRes.data ?? []).map((n) => {
    const proc = (n.procedures as unknown as {
      id: string
      procedure_date: string | null
      procedure_number: number | null
      diagnoses: unknown
    })
    const v = vitalsByProc.get(n.procedure_id)
    return {
      id: n.id,
      procedure_id: n.procedure_id,
      procedure_date: proc?.procedure_date ?? null,
      procedure_number: proc?.procedure_number ?? 1,
      status: n.status,
      subjective: n.subjective,
      assessment_summary: n.assessment_summary,
      procedure_injection: n.procedure_injection,
      assessment_and_plan: n.assessment_and_plan,
      prognosis: n.prognosis,
      plan_alignment_status: n.plan_alignment_status,
      pain_score_min: v?.pain_score_min ?? null,
      pain_score_max: v?.pain_score_max ?? null,
      diagnoses: proc?.diagnoses ?? null,
      raw_ai_response: n.raw_ai_response,
    }
  })

  const today = new Date().toISOString().slice(0, 10)
  const age = computeAgeAtDate(patient.date_of_birth, today)

  return {
    data: {
      caseDetails: {
        case_number: caseRes.data.case_number,
        accident_type: caseRes.data.accident_type,
        accident_date: caseRes.data.accident_date,
      },
      patientInfo: {
        first_name: patient.first_name,
        last_name: patient.last_name,
        date_of_birth: patient.date_of_birth,
        age,
      },
      caseSummary: summaryRes.data
        ? {
            chief_complaint: summaryRes.data.chief_complaint,
            imaging_findings: summaryRes.data.imaging_findings,
            suggested_diagnoses: summaryRes.data.suggested_diagnoses,
            review_status: summaryRes.data.review_status,
            raw_ai_response: summaryRes.data.raw_ai_response,
          }
        : null,
      initialVisitNote: initialVisit
        ? {
            id: initialVisit.id,
            visit_type: initialVisit.visit_type,
            visit_date: initialVisit.visit_date,
            status: initialVisit.status,
            diagnoses: initialVisit.diagnoses,
            chief_complaint: initialVisit.chief_complaint,
            physical_exam: initialVisit.physical_exam,
            treatment_plan: initialVisit.treatment_plan,
            medical_necessity: initialVisit.medical_necessity,
            prognosis: initialVisit.prognosis,
            raw_ai_response: initialVisit.raw_ai_response,
          }
        : null,
      painEvaluationNote: painEval
        ? {
            id: painEval.id,
            visit_date: painEval.visit_date,
            status: painEval.status,
            diagnoses: painEval.diagnoses,
            chief_complaint: painEval.chief_complaint,
            physical_exam: painEval.physical_exam,
            treatment_plan: painEval.treatment_plan,
            prognosis: painEval.prognosis,
            raw_ai_response: painEval.raw_ai_response,
          }
        : null,
      procedureNotes,
      dischargeNote: dischargeRes.data
        ? {
            id: dischargeRes.data.id,
            visit_date: dischargeRes.data.visit_date,
            status: dischargeRes.data.status,
            subjective: dischargeRes.data.subjective,
            objective_vitals: dischargeRes.data.objective_vitals,
            diagnoses: dischargeRes.data.diagnoses,
            assessment: dischargeRes.data.assessment,
            plan_and_recommendations: dischargeRes.data.plan_and_recommendations,
            prognosis: dischargeRes.data.prognosis,
            pain_score_max: dischargeRes.data.pain_score_max,
            pain_trajectory_text: dischargeRes.data.pain_trajectory_text,
            raw_ai_response: dischargeRes.data.raw_ai_response,
          }
        : null,
      extractionsSummary: {
        mri_count: mriCountRes.count ?? 0,
        pt_count: ptCountRes.count ?? 0,
        pm_count: pmCountRes.count ?? 0,
        chiro_count: chiroCountRes.count ?? 0,
        ortho_count: orthoCountRes.count ?? 0,
        ct_count: ctCountRes.count ?? 0,
        xray_count: xrayCountRes.count ?? 0,
      },
    },
    error: null,
  }
}

export async function runCaseQualityReview(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const { data: inputData, error: gatherError } = await gatherSourceData(supabase, caseId)
  if (gatherError || !inputData) return { error: gatherError || 'Failed to gather source data' }

  // Soft-delete existing active row.
  await supabase
    .from('case_quality_reviews')
    .update({ deleted_at: new Date().toISOString(), updated_by_user_id: user.id })
    .eq('case_id', caseId)
    .is('deleted_at', null)

  const sourceHash = computeSourceHash(inputData)
  const { data: record, error: insertError } = await supabase
    .from('case_quality_reviews')
    .insert({
      case_id: caseId,
      generation_status: 'processing',
      generation_attempts: 1,
      source_data_hash: sourceHash,
      sections_done: 0,
      sections_total: QUALITY_REVIEW_SECTIONS_TOTAL,
      created_by_user_id: user.id,
      updated_by_user_id: user.id,
    })
    .select('id')
    .single()

  if (insertError || !record) {
    if (insertError?.code === '23505') {
      return { error: 'QC review already in progress — please wait a moment and try again.' }
    }
    return { error: 'Failed to create review record' }
  }

  // Throttled progress writer (mirror case-summaries.ts).
  let lastProgressWriteAt = 0
  let lastWrittenCount = 0
  const writeProgress = async (count: number) => {
    if (count <= lastWrittenCount) return
    const now = Date.now()
    if (now - lastProgressWriteAt < 500) return
    lastProgressWriteAt = now
    lastWrittenCount = count
    await supabase
      .from('case_quality_reviews')
      .update({ sections_done: count })
      .eq('id', record.id)
  }

  const result = await generateQualityReviewFromData(
    inputData,
    (completedKeys) => writeProgress(completedKeys.length),
  )

  if (result.error || !result.data) {
    await supabase
      .from('case_quality_reviews')
      .update({
        generation_status: 'failed',
        generation_error: result.error || 'Unknown error',
        raw_ai_response: result.rawResponse || null,
        updated_by_user_id: user.id,
      })
      .eq('id', record.id)
    revalidatePath(`/patients/${caseId}/qc`)
    return { error: result.error || 'Review generation failed' }
  }

  await supabase
    .from('case_quality_reviews')
    .update({
      findings: result.data.findings,
      summary: result.data.summary,
      overall_assessment: result.data.overall_assessment,
      ai_model: 'claude-opus-4-7[1m]',
      raw_ai_response: result.rawResponse || null,
      generation_status: 'completed',
      generated_at: new Date().toISOString(),
      sections_done: QUALITY_REVIEW_SECTIONS_TOTAL,
      source_data_hash: sourceHash,
      updated_by_user_id: user.id,
    })
    .eq('id', record.id)

  revalidatePath(`/patients/${caseId}/qc`)
  return { data: { id: record.id } }
}

export async function getCaseQualityReview(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data, error } = await supabase
    .from('case_quality_reviews')
    .select('*')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) return { error: 'Failed to fetch review' }
  return { data: data || null }
}

// Manual re-run alias — same body as runCaseQualityReview, kept distinct so
// editor / UI can label "Recheck" vs "Run" without action duplication.
export async function recheckCaseQualityReview(caseId: string) {
  return runCaseQualityReview(caseId)
}

export async function checkQualityReviewStaleness(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: review } = await supabase
    .from('case_quality_reviews')
    .select('source_data_hash')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!review) return { data: { isStale: false } }

  const { data: inputData } = await gatherSourceData(supabase, caseId)
  if (!inputData) return { data: { isStale: false } }

  const currentHash = computeSourceHash(inputData)
  return { data: { isStale: currentHash !== review.source_data_hash } }
}

// --- Provider override mutators ---
// All four mutators read the active review row, merge a finding-hash entry
// into finding_overrides jsonb, write back, revalidate. No row-level locking
// needed because each mutation is a single atomic UPDATE keyed by review id;
// concurrent provider edits last-write-wins, acceptable for advisory layer.

async function loadActiveReviewForOverride(
  supabase: Awaited<ReturnType<typeof createClient>>,
  caseId: string,
): Promise<
  | { data: { id: string; finding_overrides: FindingOverridesMap }; error: null }
  | { data: null; error: string }
> {
  const { data, error } = await supabase
    .from('case_quality_reviews')
    .select('id, finding_overrides')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error || !data) return { data: null, error: 'No active review' }
  return {
    data: {
      id: data.id,
      finding_overrides: (data.finding_overrides as FindingOverridesMap) ?? {},
    },
    error: null,
  }
}

export async function acknowledgeFinding(caseId: string, findingHash: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const loaded = await loadActiveReviewForOverride(supabase, caseId)
  if (loaded.error) return { error: loaded.error }

  const updated: FindingOverridesMap = {
    ...loaded.data.finding_overrides,
    [findingHash]: {
      status: 'acknowledged',
      dismissed_reason: null,
      edited_message: null,
      edited_rationale: null,
      edited_suggested_tone_hint: null,
      actor_user_id: user.id,
      set_at: new Date().toISOString(),
    },
  }

  const { error } = await supabase
    .from('case_quality_reviews')
    .update({ finding_overrides: updated, updated_by_user_id: user.id })
    .eq('id', loaded.data.id)
  if (error) return { error: 'Failed to acknowledge finding' }

  revalidatePath(`/patients/${caseId}/qc`)
  return { data: { success: true } }
}

export async function dismissFinding(
  caseId: string,
  findingHash: string,
  values: FindingDismissFormValues,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const validated = findingDismissFormSchema.safeParse(values)
  if (!validated.success) return { error: 'Invalid dismiss form data' }

  const loaded = await loadActiveReviewForOverride(supabase, caseId)
  if (loaded.error) return { error: loaded.error }

  const updated: FindingOverridesMap = {
    ...loaded.data.finding_overrides,
    [findingHash]: {
      status: 'dismissed',
      dismissed_reason: validated.data.dismissed_reason,
      edited_message: null,
      edited_rationale: null,
      edited_suggested_tone_hint: null,
      actor_user_id: user.id,
      set_at: new Date().toISOString(),
    },
  }

  const { error } = await supabase
    .from('case_quality_reviews')
    .update({ finding_overrides: updated, updated_by_user_id: user.id })
    .eq('id', loaded.data.id)
  if (error) return { error: 'Failed to dismiss finding' }

  revalidatePath(`/patients/${caseId}/qc`)
  return { data: { success: true } }
}

export async function editFinding(
  caseId: string,
  findingHash: string,
  values: FindingEditFormValues,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const validated = findingEditFormSchema.safeParse(values)
  if (!validated.success) return { error: 'Invalid edit form data' }

  const loaded = await loadActiveReviewForOverride(supabase, caseId)
  if (loaded.error) return { error: loaded.error }

  const updated: FindingOverridesMap = {
    ...loaded.data.finding_overrides,
    [findingHash]: {
      status: 'edited',
      dismissed_reason: null,
      edited_message: validated.data.edited_message,
      edited_rationale: validated.data.edited_rationale,
      edited_suggested_tone_hint: validated.data.edited_suggested_tone_hint,
      actor_user_id: user.id,
      set_at: new Date().toISOString(),
    },
  }

  const { error } = await supabase
    .from('case_quality_reviews')
    .update({ finding_overrides: updated, updated_by_user_id: user.id })
    .eq('id', loaded.data.id)
  if (error) return { error: 'Failed to save finding edit' }

  revalidatePath(`/patients/${caseId}/qc`)
  return { data: { success: true } }
}

export async function clearFindingOverride(caseId: string, findingHash: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const loaded = await loadActiveReviewForOverride(supabase, caseId)
  if (loaded.error) return { error: loaded.error }

  const next = { ...loaded.data.finding_overrides }
  delete next[findingHash]

  const { error } = await supabase
    .from('case_quality_reviews')
    .update({ finding_overrides: next, updated_by_user_id: user.id })
    .eq('id', loaded.data.id)
  if (error) return { error: 'Failed to clear override' }

  revalidatePath(`/patients/${caseId}/qc`)
  return { data: { success: true } }
}
```

**Note on regen wipe**: `runCaseQualityReview` already soft-deletes the existing row before insert (existing code, unchanged). Because `finding_overrides` lives ON the row, soft-delete-then-fresh-insert means the new row starts with `'{}'` — no carry-forward. This is the intentional (c1) behavior: regen is a clean slate.

### Success Criteria:

#### Automated Verification:
- [x] Type check passes: `npx tsc --noEmit`
- [x] Lint passes: `npm run lint` (0 errors)
- [x] All actions exported are async functions returning `{ data?, error? }` shape.
- [x] No new external dependencies required (uses existing `node:crypto`, `next/cache`).
- [x] Each override mutator validates input through its zod schema before write.
- [x] `clearFindingOverride` removes the key cleanly via `delete next[findingHash]`.

#### Manual Verification:
- [ ] In Supabase SQL editor, after calling `runCaseQualityReview` from a Server Component test, a row exists with `generation_status='completed'`, a non-empty `findings` array, and `finding_overrides = '{}'`.
- [ ] After calling `acknowledgeFinding(caseId, hash)`, the row's `finding_overrides` jsonb contains an entry under `hash` with `status='acknowledged'` and the current `actor_user_id`.
- [ ] After calling `runCaseQualityReview` again (Recheck), `finding_overrides` is back to `{}` (regen wiped overrides).
- [ ] Soft-delete + re-insert: running twice in succession leaves exactly one active row (the second).
- [ ] Concurrent run rejected with 23505 → user-facing "already in progress" message.
- [ ] Locked case blocks all override mutators (case_status='closed' returns the standard `assertCaseNotClosed` error).

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: UI Surface

### Overview
New `/patients/[caseId]/qc` route. New `<QcReviewPanel>` client component with per-finding override controls. New nav entry. Edit + Dismiss dialogs for finding overrides.

### Changes Required:

#### 4.1 Sidebar Nav Entry
**File**: `src/components/patients/case-sidebar.tsx`
**Changes**: Add one entry to `navItems` between Discharge and Billing.

```tsx
// After the existing { label: 'Discharge', href: '/discharge', enabled: true }
{ label: 'QC Review', href: '/qc', enabled: true },
```

#### 4.2 Route Page
**File**: `src/app/(dashboard)/patients/[caseId]/qc/page.tsx` (new)
**Changes**: Server component fetching review + staleness, rendering panel.

```tsx
import { getCaseQualityReview, checkQualityReviewStaleness } from '@/actions/case-quality-reviews'
import { QcReviewPanel } from '@/components/clinical/qc-review-panel'

export default async function CaseQcPage({
  params,
}: {
  params: Promise<{ caseId: string }>
}) {
  const { caseId } = await params

  const [reviewResult, stalenessResult] = await Promise.all([
    getCaseQualityReview(caseId),
    checkQualityReviewStaleness(caseId),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Quality Review</h1>
        <p className="text-sm text-muted-foreground">
          AI review of the full case workflow. Manual trigger only.
        </p>
      </div>
      <QcReviewPanel
        caseId={caseId}
        review={reviewResult.data ?? null}
        isStale={stalenessResult.data?.isStale ?? false}
      />
    </div>
  )
}
```

#### 4.3 Client Panel Component
**File**: `src/components/clinical/qc-review-panel.tsx` (new)
**Changes**: Client component handling all states + finding rendering + per-finding override controls.

```tsx
'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { GeneratingProgress } from '@/components/clinical/generating-progress'
import {
  runCaseQualityReview,
  recheckCaseQualityReview,
  acknowledgeFinding,
  dismissFinding,
  editFinding,
  clearFindingOverride,
} from '@/actions/case-quality-reviews'
import {
  qcSeverityValues,
  computeFindingHash,
  type QualityFinding,
  type QcSeverity,
  type QcStep,
  type FindingOverridesMap,
  type FindingOverrideEntry,
} from '@/lib/validations/case-quality-review'
import { useCaseStatus, LOCKED_STATUSES } from '@/components/providers/case-status-provider'
import { AlertCircle, AlertTriangle, Info, RefreshCw, Check, X, Pencil, Undo2 } from 'lucide-react'
import { FindingEditDialog } from './finding-edit-dialog'
import { FindingDismissDialog } from './finding-dismiss-dialog'

interface ReviewRow {
  id: string
  generation_status: 'pending' | 'processing' | 'completed' | 'failed'
  generation_error: string | null
  findings: QualityFinding[] | null
  finding_overrides: FindingOverridesMap | null
  summary: string | null
  overall_assessment: string | null
  sections_done: number
  sections_total: number
  generated_at: string | null
}

const severityConfig: Record<QcSeverity, { icon: typeof Info; color: string; label: string }> = {
  critical: { icon: AlertCircle, color: 'destructive', label: 'Critical' },
  warning: { icon: AlertTriangle, color: 'warning', label: 'Warning' },
  info: { icon: Info, color: 'secondary', label: 'Info' },
}

const stepLabels: Record<QcStep, string> = {
  initial_visit: 'Initial Visit',
  pain_evaluation: 'Pain Evaluation',
  procedure: 'Procedure',
  discharge: 'Discharge',
  case_summary: 'Case Summary',
  cross_step: 'Cross-Step',
}

function findingDeepLink(caseId: string, finding: QualityFinding): string {
  switch (finding.step) {
    case 'initial_visit':
    case 'pain_evaluation':
      return `/patients/${caseId}/initial-visit`
    case 'procedure':
      return finding.procedure_id
        ? `/patients/${caseId}/procedures/${finding.procedure_id}/note`
        : `/patients/${caseId}/procedures`
    case 'discharge':
      return `/patients/${caseId}/discharge`
    case 'case_summary':
      return `/patients/${caseId}`
    case 'cross_step':
    default:
      return `/patients/${caseId}`
  }
}

export function QcReviewPanel({
  caseId,
  review,
  isStale,
}: {
  caseId: string
  review: ReviewRow | null
  isStale: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const { case_status } = useCaseStatus()
  const isLocked = LOCKED_STATUSES.includes(case_status)

  const handleRun = () => {
    startTransition(async () => {
      const result = await runCaseQualityReview(caseId)
      if (result.error) toast.error(result.error)
      else toast.success('QC review started')
    })
  }

  const handleRecheck = () => {
    startTransition(async () => {
      const result = await recheckCaseQualityReview(caseId)
      if (result.error) toast.error(result.error)
      else toast.success('QC review re-running')
    })
  }

  // Empty state
  if (!review) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Run quality review</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Reviews the full case workflow chain. Reads finalized notes plus extractions.
          </p>
          <Button onClick={handleRun} disabled={isPending || isLocked}>
            Run Review
          </Button>
        </CardContent>
      </Card>
    )
  }

  // Processing — realtime tick
  if (review.generation_status === 'processing') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Reviewing case…</CardTitle>
        </CardHeader>
        <CardContent>
          <GeneratingProgress
            realtimeTable="case_quality_reviews"
            noteId={review.id}
            initialProgress={{ done: review.sections_done, total: review.sections_total }}
          />
          <Skeleton className="mt-4 h-32" />
        </CardContent>
      </Card>
    )
  }

  // Failed
  if (review.generation_status === 'failed') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-destructive">Review failed</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-destructive">{review.generation_error || 'Unknown error'}</p>
          <Button onClick={handleRun} disabled={isPending || isLocked}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  // Completed
  const findings = review.findings ?? []
  const overrides: FindingOverridesMap = review.finding_overrides ?? {}

  // Hydrate each finding with its hash + current override entry (if any).
  const hydrated = findings.map((f) => {
    const hash = computeFindingHash(f)
    const override = overrides[hash] ?? null
    return { finding: f, hash, override }
  })

  // Active findings = no override OR override.status in {acknowledged, edited}
  // Dismissed = override.status === 'dismissed' — collapsed at the bottom of each severity group.
  const isDismissed = (o: FindingOverrideEntry | null) => o?.status === 'dismissed'

  const grouped: Record<QcSeverity, typeof hydrated> = {
    critical: hydrated.filter((h) => h.finding.severity === 'critical'),
    warning: hydrated.filter((h) => h.finding.severity === 'warning'),
    info: hydrated.filter((h) => h.finding.severity === 'info'),
  }

  const counts = {
    critical: grouped.critical.filter((h) => !isDismissed(h.override)).length,
    warning: grouped.warning.filter((h) => !isDismissed(h.override)).length,
    info: grouped.info.filter((h) => !isDismissed(h.override)).length,
  }
  const dismissedCount = hydrated.filter((h) => isDismissed(h.override)).length

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>
              Review {review.overall_assessment === 'clean' ? 'clean' : 'complete'}
            </CardTitle>
            {review.summary && (
              <p className="mt-1 text-sm text-muted-foreground">{review.summary}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isStale && <Badge variant="outline">Stale</Badge>}
            <Button onClick={handleRecheck} disabled={isPending || isLocked} variant="outline">
              <RefreshCw className="mr-2 h-4 w-4" />
              Recheck
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 text-sm">
            <span>Critical: <strong>{counts.critical}</strong></span>
            <span>Warning: <strong>{counts.warning}</strong></span>
            <span>Info: <strong>{counts.info}</strong></span>
            {dismissedCount > 0 && (
              <span className="text-muted-foreground">
                Dismissed: <strong>{dismissedCount}</strong>
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Recheck wipes all overrides — fresh review starts clean.
          </p>
        </CardContent>
      </Card>

      {qcSeverityValues
        .slice()
        .reverse() // critical → warning → info
        .map((sev) => {
          const items = grouped[sev]
          if (items.length === 0) return null
          const active = items.filter((h) => !isDismissed(h.override))
          const dismissed = items.filter((h) => isDismissed(h.override))
          return (
            <Card key={sev}>
              <CardHeader>
                <CardTitle className="text-base">
                  {severityConfig[sev].label} ({active.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {active.map((h) => (
                  <FindingCard
                    key={h.hash}
                    caseId={caseId}
                    hash={h.hash}
                    finding={h.finding}
                    override={h.override}
                    isLocked={isLocked}
                  />
                ))}

                {dismissed.length > 0 && (
                  <details className="mt-2 rounded-md border border-dashed p-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      Dismissed ({dismissed.length})
                    </summary>
                    <div className="mt-2 space-y-2">
                      {dismissed.map((h) => (
                        <FindingCard
                          key={h.hash}
                          caseId={caseId}
                          hash={h.hash}
                          finding={h.finding}
                          override={h.override}
                          isLocked={isLocked}
                        />
                      ))}
                    </div>
                  </details>
                )}
              </CardContent>
            </Card>
          )
        })}

      {findings.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No findings — chain is clean.
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// --- Finding card with override controls ---

function FindingCard({
  caseId,
  hash,
  finding,
  override,
  isLocked,
}: {
  caseId: string
  hash: string
  finding: QualityFinding
  override: FindingOverrideEntry | null
  isLocked: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const [editOpen, setEditOpen] = useState(false)
  const [dismissOpen, setDismissOpen] = useState(false)

  const Icon = severityConfig[finding.severity].icon
  const status = override?.status ?? 'pending'
  const displayMessage = override?.edited_message ?? finding.message
  const displayRationale = override?.edited_rationale ?? finding.rationale
  const displayToneHint =
    override?.edited_suggested_tone_hint ?? finding.suggested_tone_hint

  const handleAck = () =>
    startTransition(async () => {
      const r = await acknowledgeFinding(caseId, hash)
      if (r.error) toast.error(r.error)
      else toast.success('Finding acknowledged')
    })
  const handleClear = () =>
    startTransition(async () => {
      const r = await clearFindingOverride(caseId, hash)
      if (r.error) toast.error(r.error)
      else toast.success('Override cleared')
    })

  const containerClass =
    status === 'dismissed'
      ? 'flex items-start gap-3 rounded-md border p-3 opacity-60'
      : 'flex items-start gap-3 rounded-md border p-3'

  return (
    <>
      <div className={containerClass}>
        <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <div className="flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline">{stepLabels[finding.step]}</Badge>
            {finding.section_key && <Badge variant="secondary">{finding.section_key}</Badge>}
            {status !== 'pending' && (
              <Badge
                variant={status === 'dismissed' ? 'outline' : 'default'}
                className="capitalize"
              >
                {status}
              </Badge>
            )}
          </div>
          <p className="text-sm font-medium">{displayMessage}</p>
          {displayRationale && (
            <p className="text-xs text-muted-foreground">{displayRationale}</p>
          )}
          {displayToneHint && (
            <p className="text-xs italic text-muted-foreground">
              Suggested tone: {displayToneHint}
            </p>
          )}
          {override?.status === 'dismissed' && override.dismissed_reason && (
            <p className="text-xs text-muted-foreground">
              Dismissed: {override.dismissed_reason}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Link
              href={findingDeepLink(caseId, finding)}
              className="text-xs text-primary underline"
            >
              View in editor →
            </Link>
            {!isLocked && status === 'pending' && (
              <>
                <Button size="sm" variant="outline" onClick={handleAck} disabled={isPending}>
                  <Check className="mr-1 h-3 w-3" />
                  Acknowledge
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditOpen(true)} disabled={isPending}>
                  <Pencil className="mr-1 h-3 w-3" />
                  Edit
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDismissOpen(true)} disabled={isPending}>
                  <X className="mr-1 h-3 w-3" />
                  Dismiss
                </Button>
              </>
            )}
            {!isLocked && status !== 'pending' && (
              <Button size="sm" variant="ghost" onClick={handleClear} disabled={isPending}>
                <Undo2 className="mr-1 h-3 w-3" />
                Undo
              </Button>
            )}
          </div>
        </div>
      </div>

      {editOpen && (
        <FindingEditDialog
          caseId={caseId}
          hash={hash}
          initialValues={{
            edited_message: displayMessage,
            edited_rationale: displayRationale,
            edited_suggested_tone_hint: displayToneHint,
          }}
          onClose={() => setEditOpen(false)}
        />
      )}
      {dismissOpen && (
        <FindingDismissDialog
          caseId={caseId}
          hash={hash}
          onClose={() => setDismissOpen(false)}
        />
      )}
    </>
  )
}
```

#### 4.4 Edit Dialog
**File**: `src/components/clinical/finding-edit-dialog.tsx` (new)
**Changes**: react-hook-form + zodResolver(`findingEditFormSchema`); on submit calls `editFinding(caseId, hash, values)`.

```tsx
'use client'

import { useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { editFinding } from '@/actions/case-quality-reviews'
import { findingEditFormSchema, type FindingEditFormValues } from '@/lib/validations/case-quality-review'

export function FindingEditDialog({
  caseId,
  hash,
  initialValues,
  onClose,
}: {
  caseId: string
  hash: string
  initialValues: FindingEditFormValues
  onClose: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const form = useForm<FindingEditFormValues>({
    resolver: zodResolver(findingEditFormSchema),
    defaultValues: {
      edited_message: initialValues.edited_message ?? '',
      edited_rationale: initialValues.edited_rationale ?? null,
      edited_suggested_tone_hint: initialValues.edited_suggested_tone_hint ?? null,
    },
  })

  const onSubmit = (values: FindingEditFormValues) =>
    startTransition(async () => {
      const r = await editFinding(caseId, hash, values)
      if (r.error) toast.error(r.error)
      else {
        toast.success('Finding edited')
        onClose()
      }
    })

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit finding</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
          <div>
            <Label>Message</Label>
            <Input {...form.register('edited_message')} />
          </div>
          <div>
            <Label>Rationale</Label>
            <Textarea {...form.register('edited_rationale')} />
          </div>
          <div>
            <Label>Suggested tone hint</Label>
            <Textarea {...form.register('edited_suggested_tone_hint')} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

#### 4.5 Dismiss Dialog
**File**: `src/components/clinical/finding-dismiss-dialog.tsx` (new)
**Changes**: Optional reason input; on submit calls `dismissFinding(caseId, hash, values)`.

```tsx
'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { dismissFinding } from '@/actions/case-quality-reviews'

export function FindingDismissDialog({
  caseId,
  hash,
  onClose,
}: {
  caseId: string
  hash: string
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [isPending, startTransition] = useTransition()

  const onConfirm = () =>
    startTransition(async () => {
      const r = await dismissFinding(caseId, hash, {
        dismissed_reason: reason.trim() || null,
      })
      if (r.error) toast.error(r.error)
      else {
        toast.success('Finding dismissed')
        onClose()
      }
    })

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dismiss finding</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Reason (optional)</Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this not actually an issue?"
          />
          <p className="text-xs text-muted-foreground">
            Dismissed findings are hidden from the active list but stay
            recoverable until the next Recheck.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isPending}>
            Dismiss
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

### Success Criteria:

#### Automated Verification:
- [x] Type check passes: `npx tsc --noEmit`
- [x] Lint passes: `npm run lint` (0 errors)
- [x] Build succeeds: `npm run build` (`/patients/[caseId]/qc` route registered)

#### Manual Verification:
- [ ] Sidebar shows new "QC Review" entry between Discharge and Billing.
- [ ] `/patients/[caseId]/qc` loads with empty state and "Run Review" button.
- [ ] Click "Run Review" → spinner button → progress bar appears with realtime ticks.
- [ ] After ~30-60s the panel switches to "completed" state with grouped findings.
- [ ] Each finding card shows severity icon, step badge, section badge, message, rationale, suggested tone hint, and a "View in editor →" link.
- [ ] Clicking the link navigates to the correct editor URL (procedure note URL contains procedure_id when applicable).
- [ ] Editing any finalized note then returning to QC tab shows "Stale" badge.
- [ ] Locked-case statuses disable Run, Recheck, Acknowledge, Edit, Dismiss, Undo buttons.
- [ ] Concurrent click guard: clicking Run twice quickly shows "QC review already in progress" toast on the second click.
- [ ] **Acknowledge**: click Acknowledge on a finding → card shows "Acknowledged" badge, action buttons swap for an "Undo" button.
- [ ] **Edit**: click Edit on a finding → dialog opens prefilled with current message/rationale/tone hint. Modify, Save → card shows edited text + "Edited" badge.
- [ ] **Dismiss**: click Dismiss on a finding → dialog opens with optional reason field. Confirm → card moves into the collapsed "Dismissed (N)" disclosure at the bottom of its severity group with reduced opacity. Header counts ignore dismissed entries.
- [ ] **Undo**: click Undo on an acked/edited/dismissed card → card returns to pending state with action buttons.
- [ ] **Recheck wipes overrides**: ack/dismiss/edit several findings → click Recheck → after generation completes, all findings render as pending (no badges, action buttons restored).

**Implementation Note**: Pause for manual confirmation before Phase 5.

---

## Phase 5: Tests

### Overview
Unit tests for action gather logic + zod normalization. Smoke test for full run/get/recheck cycle.

### Changes Required:

#### 5.1 Action Tests
**File**: `src/actions/__tests__/case-quality-reviews.test.ts` (new)
**Changes**: Mock Supabase + Claude generator, assert correct insert/update payloads.

Cases:
- `runCaseQualityReview` — empty case (no IV, no procedures, no discharge): insert succeeds, generator called with `extractionsSummary` zeros, success path writes findings, `finding_overrides` defaults to `'{}'`.
- `runCaseQualityReview` — full chain: gather pulls all rows, generator called once, success update includes `ai_model: 'claude-opus-4-7[1m]'`.
- `runCaseQualityReview` — generator failure: failure update writes `generation_status: 'failed'`, `generation_error` set, `raw_ai_response` set.
- `runCaseQualityReview` — concurrent insert: 23505 surfaces user-facing message.
- `runCaseQualityReview` — regen wipes overrides: seed an existing row with `finding_overrides = { hash1: {...} }`, run again, assert the new row's `finding_overrides` is `'{}'`.
- `checkQualityReviewStaleness` — no row → `{ isStale: false }`.
- `checkQualityReviewStaleness` — hash matches → `{ isStale: false }`.
- `checkQualityReviewStaleness` — hash differs → `{ isStale: true }`.
- `acknowledgeFinding` — merges entry under hash with `status='acknowledged'`, `actor_user_id`, `set_at`.
- `acknowledgeFinding` — locked case rejected via `assertCaseNotClosed`.
- `acknowledgeFinding` — no active review row → returns `{ error: 'No active review' }`.
- `dismissFinding` — entry includes `dismissed_reason` from form.
- `dismissFinding` — invalid form payload → `{ error: 'Invalid dismiss form data' }` (zod rejection).
- `editFinding` — entry includes `edited_message`, `edited_rationale`, `edited_suggested_tone_hint`; `status='edited'`.
- `editFinding` — empty `edited_message` rejected by zod (`min(1, 'Required')`).
- `clearFindingOverride` — removes the hash key cleanly; other entries preserved.
- Override mutators — concurrent calls last-write-wins (no row-lock; document this in test as acceptable behavior).

#### 5.2 Validation Tests
**File**: `src/lib/validations/__tests__/case-quality-review.test.ts` (new)
**Changes**: Zod parse tests.

Cases:
- `qualityReviewResultSchema.safeParse` accepts valid AI output with all 3 severity values + all 6 step values.
- Invalid severity rejected.
- Invalid step rejected.
- `note_id` non-uuid rejected.
- Empty `findings[]` accepted (clean review).
- `findingOverrideEntrySchema` accepts all 3 status values; rejects `'pending'` (sentinel = absence of entry).
- `findingOverridesMapSchema` accepts empty `{}`, accepts multiple entries, rejects entries missing required fields.
- `findingEditFormSchema` rejects empty `edited_message`.
- `findingDismissFormSchema` accepts null reason and accepts populated reason.
- `computeFindingHash` — identical input ⇒ identical hash; one-character message change ⇒ different hash; null vs empty-string `note_id` produce same hash (both serialize to `''`); deterministic across calls.

### Success Criteria:

#### Automated Verification:
- [x] All new tests pass: 33 new tests, 0 failures.
- [x] No regressions in existing test suite: full suite 945/945 passing.
- [ ] Coverage report includes new files (if coverage configured).

#### Manual Verification:
- [ ] (None — tests are the verification.)

---

## Testing Strategy

### Unit Tests:
- Action gather function pulls correct columns, applies correct filters (`review_status IN ('approved','edited')`, `is('deleted_at', null)`).
- Hash function deterministic for identical input.
- Zod schemas accept all valid finding shapes, reject invalid enums and bad UUIDs.

### Integration Tests:
- Run a full review against a fixture case in the local Supabase, assert row written, findings count > 0 (allow flaky model output but assert structure).

### Manual Testing Steps:
1. Open `/patients/[caseId]/qc` for a case with a finalized IV + 2 procedures + finalized discharge.
2. Click "Run Review". Confirm progress bar appears and ticks.
3. Wait for completion. Verify severity groups render in `critical → warning → info` order.
4. Click "View in editor →" on a procedure finding; confirm navigation to `/patients/[caseId]/procedures/[procedureId]/note`.
5. Acknowledge one finding. Confirm "Acknowledged" badge + Undo button.
6. Edit one finding. Confirm dialog prefills, Save persists, card shows edited text + "Edited" badge.
7. Dismiss one finding with a reason. Confirm card moves into the collapsed "Dismissed (N)" disclosure.
8. Undo all three overrides. Confirm cards return to pending state.
9. Edit the discharge note (change a section), save draft, return to QC tab; confirm "Stale" badge appears.
10. Click "Recheck"; confirm new review row replaces the old (only one active in DB) and `finding_overrides` is empty (`{}` in psql or zero badges in UI).
11. Lock the case (set `case_status='closed'`). Confirm Run, Recheck, Acknowledge, Edit, Dismiss, Undo buttons all disabled.

## Performance Considerations

- Single Opus 4.7 1M-context call per run. Input ~50k tokens for typical case (full PI chain). Output ~4-8k. Thinking ~8k. Estimated cost ~$1 / case at current Anthropic pricing. Single cost event, manual trigger, no auto-amplification.
- 12 parallel Supabase queries in gather function. All against indexed columns (`case_id`). Expected wall time <500ms.
- `findings` jsonb gin index for future filter / search queries; not used by initial UI.
- Throttled progress writer = 1 DB UPDATE per 500ms; same as `case_summaries` in production.

## Migration Notes

- No existing `case_quality_reviews` table; no data migration needed.
- New table is additive. No changes to existing notes / extractions / case_summaries tables.
- Rollback: drop migration file, run `drop table case_quality_reviews cascade`. Sidebar entry + route are dead code only — safe to leave or remove.

## References

- Research: [thoughts/shared/research/2026-04-28-clinical-note-qc-pi-workflow.md](../research/2026-04-28-clinical-note-qc-pi-workflow.md)
- Mirror pattern: [src/actions/case-summaries.ts](../../src/actions/case-summaries.ts), [src/lib/claude/generate-summary.ts](../../src/lib/claude/generate-summary.ts), [supabase/migrations/006_case_summaries.sql](../../supabase/migrations/006_case_summaries.sql), [src/components/clinical/case-summary-card.tsx](../../src/components/clinical/case-summary-card.tsx)
- Realtime widget: `<GeneratingProgress>` in [src/components/clinical/generating-progress.tsx](../../src/components/clinical/generating-progress.tsx)
- Sidebar nav: [src/components/patients/case-sidebar.tsx:27-36](../../src/components/patients/case-sidebar.tsx)
- Hook point (NOT used per Q3 decision): [src/actions/discharge-notes.ts:993](../../src/actions/discharge-notes.ts)
