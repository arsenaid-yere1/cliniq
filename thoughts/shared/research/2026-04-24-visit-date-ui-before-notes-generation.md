---
date: 2026-04-24T14:57:53-0700
researcher: arsenaid
git_commit: 9dff3cb6a883c81634c035136b33121ddf8d2132
branch: main
repository: cliniq
topic: "Add feature to provide visit date in UI before notes generation"
tags: [research, codebase, notes-generation, initial-visit, discharge, procedure, visit-date]
status: complete
last_updated: 2026-04-24
last_updated_by: arsenaid
---

# Research: Add feature to provide visit date in UI before notes generation

**Date**: 2026-04-24T14:57:53-0700
**Researcher**: arsenaid
**Git Commit**: 9dff3cb6a883c81634c035136b33121ddf8d2132
**Branch**: main
**Repository**: cliniq

## Research Question

What does the existing flow look like for generating clinical notes (initial visit, procedure, discharge) with respect to the visit/encounter date — where the date comes from today, where it is stored, whether it is passed to the LLM, and where the user currently edits it — so that a UI control to set the visit date *before* generation can be added coherently with the current codebase.

## Summary

The repo has three clinical-note generation flows — **initial visit**, **procedure**, **discharge** — all sharing the same structure: a server-rendered page → client editor component with a pre-generation view and a "Generate" button → `'use server'` action that gathers Supabase data and calls a `src/lib/claude/generate-*.ts` helper → result persisted back to the DB.

Date handling differs per note type:

- **Initial visit** and **discharge** both own a `visit_date date` column that defaults to today's server date at first generation, is preserved on regeneration, and is editable *after* generation in the draft editor header via `<Input type="date">`. The UI **does not** collect a date before generation today.
- **Procedure** notes have no date column of their own. The governing date (`procedure_date`) lives on the `procedures` row and is captured during the separate "Record procedure" dialog (`record-procedure-dialog.tsx`) using `<Input type="date" min=…>`. It is not editable from the procedure note editor.
- Initial visit passes only the computed `age` to the LLM (not `visit_date`). Discharge passes `visitDate` verbatim inside `inputData.visitDate`. Procedure passes `procedureRecord.procedure_date`.

All date fields are stored as `yyyy-MM-dd` strings, not `Date` objects; validations use `z.string()`. The codebase has two date-input patterns in production: plain `<Input type="date">` (with optional `min=`) and the dual text-input + Calendar-Popover pattern in the new-patient wizard (`wizard-step-identity.tsx`).

The `initial_visit_notes` and `procedures` tables have **BEFORE triggers** that enforce temporal ordering between initial-visit and pain-evaluation visit dates, and between procedure dates and the latest initial-visit date (`supabase/migrations/20260414_initial_visit_date_order.sql`, `supabase/migrations/20260415_procedure_date_order.sql`). Any pre-generation date input must respect those constraints or the insert will fail.

## Detailed Findings

### Database schema — existing date columns

- `initial_visit_notes.visit_date date` — added in [supabase/migrations/20260411_initial_visit_visit_date.sql](supabase/migrations/20260411_initial_visit_visit_date.sql)
- `discharge_notes.visit_date date` — added in [supabase/migrations/20260412_discharge_notes_visit_date.sql](supabase/migrations/20260412_discharge_notes_visit_date.sql) (original schema also has nullable `visit_date` in [supabase/migrations/016_discharge_notes.sql:6](supabase/migrations/016_discharge_notes.sql#L6))
- `procedures.procedure_date date not null` — [supabase/migrations/002_case_dashboard_tables.sql:30](supabase/migrations/002_case_dashboard_tables.sql#L30), indexed at line 99
- `cases.accident_date date` — [supabase/migrations/001_initial_schema.sql:78](supabase/migrations/001_initial_schema.sql#L78)

Types mirror these in [src/types/database.ts](src/types/database.ts):
- `initial_visit_notes.visit_date: string | null` at lines 879, 925, 971
- `discharge_notes.visit_date: string | null` at lines 1203, 1244, 1285
- `procedures.procedure_date: string` at lines 2293, 2326, 2359
- `cases.accident_date: string | null` at lines 319, 341, 363

### Database triggers — date ordering constraints

- **Initial visit pair ordering** — [supabase/migrations/20260414_initial_visit_date_order.sql](supabase/migrations/20260414_initial_visit_date_order.sql): trigger `enforce_initial_visit_date_order_trg` on `initial_visit_notes`. Requires `initial_visit.visit_date <= pain_evaluation_visit.visit_date` on the same case; null on either side skips check. Fires `before insert or update of visit_date, visit_type, deleted_at`.
- **Procedure date ≥ latest initial-visit date** — [supabase/migrations/20260415_procedure_date_order.sql](supabase/migrations/20260415_procedure_date_order.sql): trigger `enforce_procedure_date_after_initial_visit_trg` on `procedures`. `procedure_date >= max(initial_visit_notes.visit_date)` for live rows on the case.

### 1. Initial Visit Note flow

**Page**: [src/app/(dashboard)/patients/[caseId]/initial-visit/page.tsx](src/app/(dashboard)/patients/[caseId]/initial-visit/page.tsx#L132-L150) — server-renders `<InitialVisitEditor>` with `notesByVisitType`, `intakesByVisitType`, `romByVisitType`, `canGenerate`.

**Editor**: [src/components/clinical/initial-visit-editor.tsx](src/components/clinical/initial-visit-editor.tsx) — tabs for `initial_visit` and `pain_evaluation_visit` (lines 216–219), each instance is `InitialVisitEditorInner` (line 303).

**Pre-generation view** (line 390 guard): renders intake tabs, `<ToneDirectionCard>`, and the Generate button at [src/components/clinical/initial-visit-editor.tsx:461-468](src/components/clinical/initial-visit-editor.tsx#L461-L468). `runGenerate` at lines 328–340 calls `generateInitialVisitNote(caseId, visitType, toneHintArg)` — **no date in payload**.

**Action**: [src/actions/initial-visit-notes.ts:326](src/actions/initial-visit-notes.ts#L326) `generateInitialVisitNote`.
- `today = new Date().toISOString().slice(0, 10)` at line 352.
- Regeneration preserves existing date: `visit_date: existingNote.visit_date ?? today` (line 384).
- First-time insert: `visit_date: today` (line 428).
- `pickVisitAnchor` ([src/lib/age.ts:15-22](src/lib/age.ts#L15-L22)) picks `intakeRes.data?.visit_date` → `intakeRes.data?.finalized_at` → today to compute `age` via `computeAgeAtDate` (line 269).

**LLM input**: only the integer `age` enters `inputData`. The `visit_date` string itself is **not** sent to Claude. Prompt at [src/lib/claude/generate-initial-visit.ts:589](src/lib/claude/generate-initial-visit.ts#L589) is `JSON.stringify(inputData, null, 2)`.

**Post-generation date editing**: `DraftEditor` ([src/components/clinical/initial-visit-editor.tsx:1617](src/components/clinical/initial-visit-editor.tsx#L1617)) renders `<Input type="date" id="visit-date-input">` in the header (lines 1705–1716). `defaultValues.visit_date = note.visit_date ?? new Date().toISOString().slice(0,10)` (line 1645). Saved via "Save Draft" → `saveInitialVisitNote` ([src/actions/initial-visit-notes.ts:566](src/actions/initial-visit-notes.ts#L566), spread into update at line 583).

### 2. Procedure Note flow

**Page**: [src/app/(dashboard)/patients/[caseId]/procedures/[procedureId]/note/page.tsx](src/app/(dashboard)/patients/[caseId]/procedures/[procedureId]/note/page.tsx#L109-L133) — builds `procedureInfo` (lines 109–116) including `procedure_date: procedure.procedure_date`, then renders `<ProcedureNoteEditor>`.

**Editor**: [src/components/procedures/procedure-note-editor.tsx](src/components/procedures/procedure-note-editor.tsx). Pre-generation view at lines 256–282: `<ToneDirectionCard>` + Generate button. `runGenerate` at lines 205–217 calls `generateProcedureNote(procedureId, caseId, toneHintArg)` — **no date in payload**.

**Action**: [src/actions/procedure-notes.ts:517](src/actions/procedure-notes.ts#L517) `generateProcedureNote`. Gather reads `procedure_date` from `procedures` (`gatherProcedureNoteSourceData` at line 51). Age computed: `computeAgeAtDate(patient.date_of_birth, proc.procedure_date)` (line 218). `inputData.procedureRecord.procedure_date` at line 305.

**No `visit_date`/`procedure_date` column on `procedure_notes`** — note insert at line 624 does not include a date field. Date lives on the `procedures` row only.

**LLM input**: full `inputData` JSON including `procedureRecord.procedure_date` at [src/lib/claude/generate-procedure-note.ts:723](src/lib/claude/generate-procedure-note.ts#L723).

**Pre-generation date capture today**: procedure date is collected in the separate **Record Procedure** dialog at [src/components/procedures/record-procedure-dialog.tsx:332-346](src/components/procedures/record-procedure-dialog.tsx#L332-L346) using `<Input type="date" min={procedureDefaults?.earliest_procedure_date ?? undefined}>`. `defaultValues.procedure_date` is today (line 205). Zod schema factory at [src/lib/validations/prp-procedure.ts:57-70](src/lib/validations/prp-procedure.ts#L57-L70).

**Post-generation editing**: `procedureInfo.procedure_date` displayed read-only at [src/components/procedures/procedure-note-editor.tsx:725-727](src/components/procedures/procedure-note-editor.tsx#L725-L727). No date field on the note editor itself.

### 3. Discharge Note flow

**Page**: [src/app/(dashboard)/patients/[caseId]/discharge/page.tsx](src/app/(dashboard)/patients/[caseId]/discharge/page.tsx#L142-L156) — fetches note, prereq check, `defaultVitals`, computes `isStale`, renders `<DischargeNoteEditor>`.

**Editor**: [src/components/discharge/discharge-note-editor.tsx](src/components/discharge/discharge-note-editor.tsx). Pre-generation view at lines 261–289: `<DischargeVitalsCard>` (line 266) + `<ToneDirectionCard>` + Generate button (lines 281–287). `runGenerate` at lines 211–223 calls `generateDischargeNote(caseId, toneHintArg)` — **no date in payload**.

**Action**: [src/actions/discharge-notes.ts:552](src/actions/discharge-notes.ts#L552) `generateDischargeNote`.
- Lines 601–602:
  ```ts
  const today = new Date().toISOString().slice(0, 10)
  const visitDate = existingNote?.visit_date ?? today
  ```
- Discharge uses **soft-delete + re-insert** pattern on every regen (lines 642–676). New row writes `visit_date: visitDate` at line 660.
- Age: `computeAgeAtDate(patient.date_of_birth, visitDate)` at line 409.

**LLM input**: `inputData.visitDate` present in [src/lib/claude/generate-discharge-note.ts:30](src/lib/claude/generate-discharge-note.ts#L30); serialized into user message at line 499.

**Post-generation editing**: `<Input type="date" id="discharge-visit-date-input">` at [src/components/discharge/discharge-note-editor.tsx:549-560](src/components/discharge/discharge-note-editor.tsx#L549-L560). `defaultValues.visit_date = note.visit_date ?? today` (line 436). Save via `saveDischargeNote` ([src/actions/discharge-notes.ts:870](src/actions/discharge-notes.ts#L870)). After save, `refreshTimeline()` recomputes pain trajectory using the new `visit_date` (lines 500–501).

### Date-input UI patterns in codebase

Three production patterns, all storing `yyyy-MM-dd` strings:

**Pattern A — plain `<Input type="date">`**
- [src/components/patients/wizard-step-details.tsx:137-146](src/components/patients/wizard-step-details.tsx#L137-L146) (`accident_date`, optional)
- [src/components/patients/case-overview-edit-dialog.tsx:193-200](src/components/patients/case-overview-edit-dialog.tsx#L193-L200) (`date_of_birth`, compact with `text-xs` label)
- [src/components/patients/case-overview-edit-dialog.tsx:313-319](src/components/patients/case-overview-edit-dialog.tsx#L313-L319) (`accident_date`, compact)
- [src/components/clinical/initial-visit-editor.tsx:1705-1716](src/components/clinical/initial-visit-editor.tsx#L1705-L1716) and [src/components/discharge/discharge-note-editor.tsx:549-560](src/components/discharge/discharge-note-editor.tsx#L549-L560) — post-generation `visit_date` inputs using `register(...,{ setValueAs: v => v === '' ? null : v })`

**Pattern B — plain `<Input type="date" min=…>`**
- [src/components/procedures/record-procedure-dialog.tsx:332-346](src/components/procedures/record-procedure-dialog.tsx#L332-L346). `min` set from `procedureDefaults.earliest_procedure_date` (server-computed). Default value: `format(new Date(), 'yyyy-MM-dd')`.

**Pattern C — dual text-input + Calendar Popover**
- [src/components/patients/wizard-step-identity.tsx:131-181](src/components/patients/wizard-step-identity.tsx#L131-L181) for `date_of_birth`. Uses shadcn `Calendar` (`mode="single"`, `captionLayout="dropdown"`, `fromYear={1920}`, `toYear={currentYear}`). `Calendar` + `Popover` wrappers at [src/components/ui/calendar.tsx](src/components/ui/calendar.tsx) and [src/components/ui/popover.tsx](src/components/ui/popover.tsx). Notable detail: `new Date(field.value + 'T00:00:00')` appended to avoid timezone offset when bridging between `yyyy-MM-dd` strings and `Date`.

**Zod schema conventions** (all strings, not `Date`):
- Required: `z.string().min(1, '… is required')` (e.g. [src/lib/validations/patient.ts:7](src/lib/validations/patient.ts#L7))
- Optional: `z.string().optional()` ([src/lib/validations/patient.ts:19](src/lib/validations/patient.ts#L19))
- Bounded: factory with `.refine((v) => !opts?.earliestDate || v >= opts.earliestDate, ...)` ([src/lib/validations/prp-procedure.ts:57-70](src/lib/validations/prp-procedure.ts#L57-L70))

**Display convention**: `format(new Date(dateString + 'T00:00:00'), 'MM/dd/yyyy')` — examples at [src/components/patients/case-overview.tsx:237](src/components/patients/case-overview.tsx#L237), [src/components/patients/case-overview.tsx:277](src/components/patients/case-overview.tsx#L277), [src/components/procedures/procedure-table.tsx:86](src/components/procedures/procedure-table.tsx#L86).

### Tone & Direction card — precedent for a pre-generation input

`<ToneDirectionCard>` is already rendered in all three pre-generation views (initial visit, procedure, discharge) and its value is threaded into `runGenerate(toneHint)` → action → LLM. See cross-cutting pattern memo referenced in MEMORY: "Tone & Direction integration pattern — Procedure, discharge, initial visit share isomorphic tone_hint wiring". The same slot is where a `<VisitDateCard>` or inline date control would naturally live.

## Code References

- `src/app/(dashboard)/patients/[caseId]/initial-visit/page.tsx:132-150` — server page renders initial-visit editor
- `src/app/(dashboard)/patients/[caseId]/discharge/page.tsx:142-156` — server page renders discharge editor
- `src/app/(dashboard)/patients/[caseId]/procedures/[procedureId]/note/page.tsx:109-133` — server page renders procedure-note editor
- `src/components/clinical/initial-visit-editor.tsx:328-340` — `runGenerate` (initial visit); `:461-468` Generate button; `:1705-1716` post-gen date input
- `src/components/procedures/procedure-note-editor.tsx:205-217` — `runGenerate` (procedure); `:256-282` Generate button; `:725-727` read-only date display
- `src/components/discharge/discharge-note-editor.tsx:211-223` — `runGenerate` (discharge); `:261-289` Generate button + vitals/tone cards; `:549-560` post-gen date input
- `src/components/procedures/record-procedure-dialog.tsx:332-346` — pre-existing pattern for `min`-bounded date input
- `src/actions/initial-visit-notes.ts:326` `generateInitialVisitNote`; `:352` today; `:384,428` visit_date assignment; `:566` saveInitialVisitNote
- `src/actions/procedure-notes.ts:517` `generateProcedureNote`; `:218` age from procedure_date; `:305` procedure_date in inputData
- `src/actions/discharge-notes.ts:552` `generateDischargeNote`; `:601-602` visitDate derivation; `:660` insert; `:870` saveDischargeNote
- `src/lib/claude/generate-initial-visit.ts:589` — prompt body (no visit_date)
- `src/lib/claude/generate-procedure-note.ts:723` — prompt body (includes procedure_date)
- `src/lib/claude/generate-discharge-note.ts:499` — prompt body (includes visitDate)
- `src/lib/age.ts:1-22` — `computeAgeAtDate`, `pickVisitAnchor`
- `src/lib/validations/prp-procedure.ts:57-70` — bounded-date Zod factory
- `src/lib/validations/patient.ts:7,19` — string-based date schemas
- `supabase/migrations/20260411_initial_visit_visit_date.sql` — add `initial_visit_notes.visit_date`
- `supabase/migrations/20260412_discharge_notes_visit_date.sql` — add `discharge_notes.visit_date`
- `supabase/migrations/20260414_initial_visit_date_order.sql` — IV pair ordering trigger
- `supabase/migrations/20260415_procedure_date_order.sql` — procedure-date floor trigger
- `supabase/migrations/002_case_dashboard_tables.sql:30,99` — `procedures.procedure_date` + index
- `src/types/database.ts:879,925,971,1203,1244,1285,2293,2326,2359` — generated TS types for date columns

## Architecture Documentation

**Date storage convention**: all clinical dates stored as `yyyy-MM-dd` strings in DB and form state. Never `Date` objects. Zod validators use `z.string()`. Display layer constructs `Date` only for formatting via `new Date(str + 'T00:00:00')` to dodge UTC-offset shifting.

**Generation-action signature convention**: `generate*Note(caseIdOrProcedureId, [visitType], toneHint)` — the only user-controllable generation-time input today is `toneHint`. Any pre-generation fields that should influence the LLM or the persisted row are plumbed through this signature and the gather-data function.

**Pre-generation view slot**: each editor's `!note || status==='draft' && !hasGeneratedContent` branch renders tone + (discharge only) vitals cards before the Generate button. This is the natural location for a pre-generation date control.

**Date preservation-on-regen**: both initial-visit and discharge preserve an existing row's `visit_date` on regeneration (`existingNote.visit_date ?? today`). Discharge additionally uses soft-delete + re-insert; initial-visit updates in place.

**LLM date exposure**: inconsistent today — procedure and discharge include the date in the JSON prompt body; initial-visit passes only `age`.

**DB triggers block out-of-order dates**: two `BEFORE` triggers will raise exceptions if `initial_visit.visit_date > pain_evaluation_visit.visit_date` on the same case, or if a `procedure_date < max(initial_visit.visit_date)`. Any UI that collects a date before generation must surface those errors (they already land as Postgres errors on insert/update).

## Related Research

- `thoughts/shared/research/2026-04-19-tone-direction-for-procedure-and-discharge-notes.md` — isomorphic wiring pattern for the tone hint across the same three flows
- `thoughts/shared/research/2026-04-22-initial-visit-tone-direction-sections-edit.md` — tone & direction in initial visit editor
- `thoughts/shared/research/2026-04-23-sse-streaming-note-generation.md` — streaming generation transport
- `thoughts/shared/research/2026-04-20-ui-streaming-page-refresh.md` — page refresh after generation

## Open Questions

- Should a pre-generation visit-date control apply to procedure notes too, or only to initial-visit and discharge (where a DB column exists)? Procedure-note date is currently owned by the `procedures` row and captured in `record-procedure-dialog.tsx` at record time — there is no `visit_date` column on `procedure_notes`.
- For initial visit, `visit_date` is not currently serialized into the LLM prompt (only `age` is). Unknown whether a pre-generation control should additionally surface the date string into `InitialVisitInputData`.
- How to reconcile a user-supplied pre-generation date with the existing `pickVisitAnchor` cascade (`intake.visit_date → intake.finalized_at → today`) for age computation.
- Behavior on regeneration: if the user provides a date pre-generation, should it override the existing row's `visit_date` or be ignored in favor of preservation semantics?
- Surfacing DB-trigger violations (temporal ordering) as inline form errors vs. post-submit toast.
