# Age-at-Visit-Date Implementation Plan

## Overview

Change patient age shown in clinical documents from **current age (today)** to **age on the visit date**. Applies to the Initial Visit PDF, the Initial Visit editor preview, and the three Claude-generated narratives (Initial Visit, Procedure, Discharge) whose prompts currently tell the model to state a patient's age without specifying an anchor date.

## Current State Analysis

Two sites compute `age` today, both against `new Date()`:

1. **Initial Visit PDF** — [src/lib/pdf/render-initial-visit-pdf.ts:130](src/lib/pdf/render-initial-visit-pdf.ts#L130):
   ```
   age: patientDob ? differenceInYears(new Date(), patientDob) : 0,
   ```
   Rendered in the PDF header as `"Age:"` via [src/lib/pdf/initial-visit-template.tsx:15,203-206](src/lib/pdf/initial-visit-template.tsx#L15-L206).

2. **Initial Visit editor preview** — [src/components/clinical/initial-visit-editor.tsx:1844-1846](src/components/clinical/initial-visit-editor.tsx#L1844-L1846):
   ```
   const age = caseData?.patient.date_of_birth
     ? differenceInYears(new Date(), new Date(caseData.patient.date_of_birth))
     : null
   ```
   Rendered in the preview pane as `<p><strong>Age:</strong> {age}</p>` at line 1964.

Three Claude prompts instruct the model to state `"[age]-year-old"` without giving an anchor, with DOB + `accident_date` passed in the JSON payload:
- [src/lib/claude/generate-initial-visit.ts:77,79](src/lib/claude/generate-initial-visit.ts#L77)
- [src/lib/claude/generate-procedure-note.ts:120](src/lib/claude/generate-procedure-note.ts#L120)
- [src/lib/claude/generate-discharge-note.ts:127](src/lib/claude/generate-discharge-note.ts#L127)

The existing date-of-service fallback chain for the Initial Visit PDF is `visit_date → finalized_at → today` ([render-initial-visit-pdf.ts:8-16](src/lib/pdf/render-initial-visit-pdf.ts#L8-L16)). The procedure PDF's date is `procedure_date → today` ([render-procedure-note-pdf.ts:121-123](src/lib/pdf/render-procedure-note-pdf.ts#L121-L123)). The discharge PDF uses the same `visit_date → finalized_at → today` chain as Initial Visit ([render-discharge-note-pdf.ts:118-121](src/lib/pdf/render-discharge-note-pdf.ts#L118-L121)).

Visit-date / procedure-date already flows to the Claude input payloads:
- Initial Visit action passes `note.visit_date` via the note row being edited — **not** in the `InitialVisitInputData` interface today.
- Procedure Note: `procedureRecord.procedure_date: string` is already in [generate-procedure-note.ts:28](src/lib/claude/generate-procedure-note.ts#L28).
- Discharge Note: `visitDate: string` is already in [generate-discharge-note.ts:27](src/lib/claude/generate-discharge-note.ts#L27).

Research: [thoughts/shared/research/2026-04-18-age-relative-to-accident-date.md](thoughts/shared/research/2026-04-18-age-relative-to-accident-date.md).

## Desired End State

Every place "age" appears in or is passed to a finalized/generated clinical document reflects the patient's age on the **visit date** (or procedure date for the PRP procedure note), with the same fallback chain that document already uses for `dateOfService` / `dateOfVisit`.

Verification: for a patient with DOB `2000-06-15` and a visit note with `visit_date = 2025-05-01`, the Initial Visit PDF and editor preview render `"Age: 24"` (not the age as of today), and all three Claude prompt payloads include a precomputed `age` number equal to 24.

### Key Discoveries:
- `visit_date` is a `date` (no time) on `*_notes` tables; constructing `new Date(visit_date + 'T00:00:00')` avoids UTC off-by-one-day drift (pattern used at [render-procedure-note-pdf.ts:122](src/lib/pdf/render-procedure-note-pdf.ts#L122)).
- `differenceInYears` correctly returns a whole-number age when both args are `Date` objects.
- The editor preview and the PDF renderer both read the same `note.visit_date` → they must share an age helper to stay in sync.
- Claude payload is `JSON.stringify(inputData, null, 2)` with no custom serialization — adding a top-level field to the input interface is sufficient for the model to see it.

## What We're NOT Doing

- **No change to `orthopedic_extractions.patient_age`.** That column is extracted verbatim from external ortho reports; it is a separate surface and leaving it as-is is explicit scope.
- **No new "age" row on the Procedure Note or Discharge PDF templates.** Those templates today render DOB + Date of Injury without a discrete "Age:" row; the Claude-generated subjective narrative is the only place age appears. Adding an age row to those templates is a layout change outside this fix.
- **No database migration, no stored `age_at_visit` column.** Age remains derived at render time.
- **No UI for overriding age.** If the data is wrong, fix DOB or visit_date.
- **No change to `accident_date` handling.** `dateOfInjury` stays rendered; the Claude prompts continue to receive `accident_date` as context.

## Implementation Approach

1. Introduce a single shared helper `computeAgeAtDate(dobString, anchorString)` returning `number | null` (null when either is missing or when result < 0 due to data-entry error).
2. Apply the helper in the two existing computation sites, switching the anchor from `new Date()` to the document's visit/service date (using the existing fallback chain).
3. Extend the three Claude input interfaces with an optional `age: number | null` field populated by the action using the same helper, and update the system prompts to say `"age at the time of this visit"` so the model uses the provided number instead of inferring from DOB.

Keep the public label `"Age:"` unchanged (visit-date-anchored age is the clinical default).

---

## Phase 1: Shared age helper

### Overview
One helper, one place. Avoids three slightly-different copies of `differenceInYears` drifting.

### Changes Required:

#### 1. New helper file
**File**: `src/lib/utils/age.ts` (new)
**Changes**: Export `computeAgeAtDate`. Returns `null` when DOB or anchor is missing, or when anchor precedes DOB (data-entry error → treat as invalid per Q3).

```ts
import { differenceInYears } from 'date-fns'

export function computeAgeAtDate(
  dob: string | null | undefined,
  anchor: string | null | undefined,
): number | null {
  if (!dob || !anchor) return null
  const dobDate = new Date(`${dob}T00:00:00`)
  const anchorDate = new Date(`${anchor}T00:00:00`)
  if (Number.isNaN(dobDate.getTime()) || Number.isNaN(anchorDate.getTime())) return null
  const years = differenceInYears(anchorDate, dobDate)
  return years < 0 ? null : years
}

/**
 * Pick the anchor date for clinical-note age calculations, matching the
 * same precedence the PDF renderers use for `dateOfService`.
 */
export function pickVisitAnchor(
  visitDate: string | null | undefined,
  finalizedAt: string | null | undefined,
): string | null {
  if (visitDate) return visitDate
  if (finalizedAt) return finalizedAt.slice(0, 10) // YYYY-MM-DD from ISO timestamp
  return new Date().toISOString().slice(0, 10)
}
```

### Success Criteria:

#### Automated Verification:
- [x] Type check passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] New unit tests pass: `npm test -- age` (see Testing Strategy)

#### Manual Verification:
- None — pure helper, exercised by later phases.

---

## Phase 2: Initial Visit PDF + editor preview use visit-date age

### Overview
Replace the two `differenceInYears(new Date(), ...)` call sites with the shared helper anchored on the note's visit date.

### Changes Required:

#### 1. PDF renderer
**File**: [src/lib/pdf/render-initial-visit-pdf.ts](src/lib/pdf/render-initial-visit-pdf.ts)
**Changes**: Remove `differenceInYears` import. Import `computeAgeAtDate` + `pickVisitAnchor`. Replace line 130.

```ts
// top of file
import { format } from 'date-fns'
import { computeAgeAtDate, pickVisitAnchor } from '@/lib/utils/age'

// in pdfData assembly, replace current line 130:
const visitAnchor = pickVisitAnchor(
  input.note.visit_date as string | null | undefined,
  input.note.finalized_at as string | null | undefined,
)
const ageValue = computeAgeAtDate(patient?.date_of_birth, visitAnchor)

// ...
age: ageValue ?? 0,  // keep numeric contract of InitialVisitPdfData.age
```

Note: the PDF template's `age: number` field ([initial-visit-template.tsx:15](src/lib/pdf/initial-visit-template.tsx#L15)) stays `number`. Falling back to `0` preserves the existing "no DOB → 0" behavior; the template's `{data.age}` output remains the same when data is present. (If `0` is ever a real patient age we will not confuse it with missing data, because DOB is `not null` on the `patients` table — [001_initial_schema.sql:48](supabase/migrations/001_initial_schema.sql#L48).)

#### 2. Editor preview
**File**: [src/components/clinical/initial-visit-editor.tsx](src/components/clinical/initial-visit-editor.tsx)
**Changes**: Replace `differenceInYears` import with helper import at line 7. Replace lines 1844-1846.

```tsx
import { format } from 'date-fns'
import { computeAgeAtDate, pickVisitAnchor } from '@/lib/utils/age'

// replace current age block:
const visitAnchor = pickVisitAnchor(note.visit_date, note.finalized_at)
const age = computeAgeAtDate(caseData?.patient.date_of_birth, visitAnchor)
```

`age` remains `number | null`, so the existing render guard `{age !== null && <p>...Age: {age}</p>}` at line 1964 continues to work unchanged.

### Success Criteria:

#### Automated Verification:
- [x] Type check passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] Full test suite passes: `npm test`

#### Manual Verification:
- [x] Open an existing finalized Initial Visit note where the visit happened in a prior year; preview shows age equal to (visit_date - DOB) in whole years, **not** today's age.
- [x] Generate the PDF for the same note; `Age:` row matches the preview.
- [x] Open a draft note with no `visit_date` set yet; preview age falls back to `finalized_at` if present, otherwise today (consistent with `dateOfService`).
- [x] Edge case: if DOB is after visit_date (data-entry error), the preview omits the Age row and the PDF shows `Age: 0` (matching the existing missing-DOB behavior).

**Implementation Note**: Pause here for manual confirmation before Phase 3.

---

## Phase 3: Pass precomputed `age` into the three Claude payloads

### Overview
The Claude generators currently tell the model to write `"[age]-year-old"` with only DOB to work from. Add a precomputed `age` at the top level of each input payload and update the prompts to use that field and anchor it to the visit/procedure date.

### Changes Required:

#### 1. Initial Visit generator
**File**: [src/lib/claude/generate-initial-visit.ts](src/lib/claude/generate-initial-visit.ts)
**Changes**:
- Extend `InitialVisitInputData` with `age: number | null` at the top level (sibling to `patientInfo`).
- Update system-prompt phrasing at lines 77 and 79 to make the anchor explicit.

```ts
// interface addition
export interface InitialVisitInputData {
  patientInfo: { /* ... */ }
  age: number | null          // age on the visit date; null if unknown
  caseDetails: { /* ... */ }
  // ...
}

// prompt edit (line 77):
Opening paragraph ...: State: patient age (use the top-level "age" field — this is the patient's age on the visit date; do NOT recompute from date_of_birth), gender, presents for ...

// reference example (line 79) already correct ("21-year-old female") — no change needed
```

**File**: [src/actions/initial-visit-notes.ts](src/actions/initial-visit-notes.ts)
**Changes**: Populate the new field when assembling `InitialVisitInputData`. The action reads `note.visit_date` and `note.finalized_at` earlier in the function; compute age there.

```ts
import { computeAgeAtDate, pickVisitAnchor } from '@/lib/utils/age'

// in gatherSourceData, when constructing the return payload ~line 184:
const visitAnchor = pickVisitAnchor(noteRow?.visit_date, noteRow?.finalized_at)
const age = computeAgeAtDate(patient.date_of_birth, visitAnchor)

return {
  data: {
    patientInfo: { ... },
    age,
    caseDetails: { ... },
    // ...
  },
}
```

Resolve `noteRow` from the fetched note context that this action already has; if the note row is not in scope, read `note.visit_date`/`note.finalized_at` from the caller's note argument. (Verify exact variable name at implementation time — the action's full scope isn't quoted in this plan.)

#### 2. Procedure Note generator
**File**: [src/lib/claude/generate-procedure-note.ts](src/lib/claude/generate-procedure-note.ts)
**Changes**:
- Add `age: number | null` at the top level of `ProcedureNoteInputData`.
- Update system-prompt at line 120 to point at the field and anchor it to procedure date.

```ts
export interface ProcedureNoteInputData {
  patientInfo: { /* ... */ }
  age: number | null          // age on the procedure date
  caseDetails: { /* ... */ }
  procedureRecord: { procedure_date: string; /* ... */ }
  // ...
}

// prompt edit (line 120):
Open with a one-sentence patient identification: "[Patient Name] is a [age]-year-old [gender] who returns for [his/her] scheduled PRP injection to the [site]." Use the top-level "age" field (the patient's age on procedureRecord.procedure_date); do NOT recompute from date_of_birth.
```

**File**: [src/actions/procedure-notes.ts](src/actions/procedure-notes.ts)
**Changes**: Compute `age` from `patient.date_of_birth` + `proc.procedure_date` before the return block at line 132.

```ts
import { computeAgeAtDate } from '@/lib/utils/age'

const age = computeAgeAtDate(patient.date_of_birth, proc.procedure_date)

return {
  data: {
    patientInfo: { ... },
    age,
    caseDetails: { ... },
    procedureRecord: { ... },
    // ...
  },
}
```

#### 3. Discharge Note generator
**File**: [src/lib/claude/generate-discharge-note.ts](src/lib/claude/generate-discharge-note.ts)
**Changes**:
- Add `age: number | null` at the top level of `DischargeNoteInputData`.
- Update the system-prompt opening at line 127 to anchor on `visitDate`.

```ts
export interface DischargeNoteInputData {
  patientInfo: { /* ... */ }
  age: number | null          // age on visitDate
  caseDetails: { /* ... */ }
  visitDate: string
  // ...
}

// prompt edit (line 127, Para 1):
Opening sentence identifying patient, age (use the top-level "age" field — patient's age on visitDate; do NOT recompute from date_of_birth), presents for follow-up after completing PRP treatment to [sites] on [last procedure date]. ...
```

**File**: [src/actions/discharge-notes.ts](src/actions/discharge-notes.ts)
**Changes**: Compute `age` using `visitDate` (already a function argument) before the return block at line 163.

```ts
import { computeAgeAtDate } from '@/lib/utils/age'

const age = computeAgeAtDate(patient.date_of_birth, visitDate)

return {
  data: {
    patientInfo: { ... },
    age,
    caseDetails: { ... },
    visitDate,
    // ...
  },
}
```

#### 4. Test fixtures
**Files**:
- [src/lib/claude/__tests__/generate-initial-visit.test.ts](src/lib/claude/__tests__/generate-initial-visit.test.ts)
- [src/lib/claude/__tests__/generate-procedure-note.test.ts](src/lib/claude/__tests__/generate-procedure-note.test.ts)
- [src/lib/claude/__tests__/generate-discharge-note.test.ts](src/lib/claude/__tests__/generate-discharge-note.test.ts)

**Changes**: Add `age: null` to each `empty input` fixture so they satisfy the updated interface.

### Success Criteria:

#### Automated Verification:
- [x] Type check passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] All Claude generator tests pass: `npm test -- claude`
- [x] Full test suite: `npm test`

#### Manual Verification:
- [x] Regenerate an Initial Visit note via the "Generate" button for a case whose `visit_date` is in a prior year; the introduction paragraph opens with the age that corresponds to `visit_date - DOB`, not today's age.
- [x] Regenerate a PRP Procedure Note for the same patient on a different procedure date; the subjective paragraph uses the age as of `procedure_date`.
- [x] Regenerate a Discharge Note; the first paragraph uses the age as of the discharge `visitDate`.
- [x] Regenerate a single section (per-section regeneration path) — the age is still anchored to the visit/procedure date because the same `inputData` is stringified.

**Implementation Note**: Pause here for manual confirmation.

---

## Testing Strategy

### Unit Tests:
Add `src/lib/utils/__tests__/age.test.ts` covering `computeAgeAtDate`:
- Standard case: DOB `2000-06-15`, anchor `2025-05-01` → `24` (birthday hasn't happened yet in 2025).
- Birthday exactly on anchor: DOB `2000-06-15`, anchor `2025-06-15` → `25`.
- Birthday one day before anchor: DOB `2000-06-16`, anchor `2025-06-15` → `24`.
- Null DOB → `null`.
- Null anchor → `null`.
- Anchor before DOB (data error) → `null`.
- Invalid date strings → `null`.

And `pickVisitAnchor`:
- `visit_date` present → returns `visit_date` verbatim.
- Only `finalized_at` (ISO timestamp) → returns `YYYY-MM-DD` prefix.
- Neither → returns today's `YYYY-MM-DD`.

### Integration Tests:
Not adding new integration tests — the existing Claude generator test fixtures only need the `age: null` additions to typecheck.

### Manual Testing Steps:
1. Pick an existing case with a finalized Initial Visit from a prior calendar year.
2. Open the editor preview; verify `Age:` shows (visit_date - DOB) in whole years, not current age.
3. Download the PDF; verify the `Age:` row matches.
4. Edit `visit_date` to tomorrow's birthday; save; verify age increments in the preview on next render.
5. For a draft note with `visit_date` unset, verify the age falls back to `finalized_at`, then to today.
6. Trigger re-generation on Initial Visit, Procedure Note, and Discharge narratives; read the opening sentence of each and confirm the stated age matches the anchor date, not today.

## Performance Considerations

None — one `differenceInYears` call per document render and one per Claude invocation.

## Migration Notes

No data migration. Existing finalized notes carry whatever age Claude wrote into the prose at the time; they are not retroactively edited. Only the next render/regeneration uses the new logic.

### Remediation for previously-finalized PDFs

Finalized Initial Visit PDFs are rendered once and stored in Supabase Storage (linked via `initial_visit_notes.document_id` — see [finalize path](src/actions/initial-visit-notes.ts#L511-L557)). Viewing a finalized note serves the stored file — it does **not** re-render. Any note finalized before this plan shipped has the old `today`-anchored age frozen into:

1. The header **"Age:"** row of the stored PDF, and
2. The `introduction` prose in the DB (and therefore the stored PDF), which Claude wrote against the old prompt.

**To correct a specific finalized note**: unfinalize the note (returns to draft, preserves section content), then finalize again. This re-runs [renderInitialVisitPdf](src/lib/pdf/render-initial-visit-pdf.ts) with the corrected header age and uploads a fresh PDF. The `introduction` prose is **not** regenerated by finalize — if the stated age in the prose is also wrong, the user must additionally regenerate the Introduction section (or regenerate the whole note) before finalizing.

No automated backfill script is provided: remediation is per-case and under user control. If a large-scale re-finalize becomes necessary later, that would be a separate change.

## References

- Research: [thoughts/shared/research/2026-04-18-age-relative-to-accident-date.md](thoughts/shared/research/2026-04-18-age-relative-to-accident-date.md)
- Current age call sites: [src/lib/pdf/render-initial-visit-pdf.ts:130](src/lib/pdf/render-initial-visit-pdf.ts#L130), [src/components/clinical/initial-visit-editor.tsx:1844-1846](src/components/clinical/initial-visit-editor.tsx#L1844-L1846)
- Claude prompts referencing age: [generate-initial-visit.ts:77](src/lib/claude/generate-initial-visit.ts#L77), [generate-procedure-note.ts:120](src/lib/claude/generate-procedure-note.ts#L120), [generate-discharge-note.ts:127](src/lib/claude/generate-discharge-note.ts#L127)
- PDF date-of-service fallback pattern (to be mirrored by `pickVisitAnchor`): [render-initial-visit-pdf.ts:8-16](src/lib/pdf/render-initial-visit-pdf.ts#L8-L16)
