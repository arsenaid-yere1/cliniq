# Pre-Generation Visit Date Implementation Plan

## Overview

Add a UI control that lets providers set the visit date **before** clicking Generate on the Initial Visit and Discharge note editors. Today's server date is used implicitly on first generation and preserved on regeneration, with the date only editable after the note has been produced. This plan moves that decision forward — so the date flows into LLM prompts, age calculations, and the persisted row from the first click.

## Current State Analysis

- **Initial Visit** (`src/actions/initial-visit-notes.ts:326`): `visit_date` defaults to today at first insert (line 427), preserved on regen (line 382). LLM receives only computed `age`, not the date string. `pickVisitAnchor` (`src/lib/age.ts:15`) cascades `intake.visit_date → intake.finalized_at → today`.
- **Discharge** (`src/actions/discharge-notes.ts:552`): same pattern — `existingNote?.visit_date ?? today` (line 602). LLM receives `inputData.visitDate` already.
- **Procedure**: date lives on `procedures` table, captured in `record-procedure-dialog.tsx`. Out of scope.
- **Existing post-gen date inputs** at `initial-visit-editor.tsx:1705-1716` and `discharge-note-editor.tsx:549-560` stay as-is — they edit the persisted draft row.
- **DB ordering triggers**: `enforce_initial_visit_date_order_trg` (IV pair ordering), `enforce_procedure_date_after_initial_visit_trg` (procedures floor). `mapVisitDateOrderError` already exists at `initial-visit-notes.ts:43` mapping SQLSTATE 23514 → user-facing message.
- **Discharge has no ordering trigger** on its `visit_date` — no client-side floor is mandatory, but surfacing `max(initial_visit_notes.visit_date)` as a UX floor is still valuable.

## Desired End State

A `<VisitDateCard>` appears in the pre-generation view of IV and discharge editors, sibling to `<ToneDirectionCard>`. Default value = existing `note.visit_date ?? today`. `min` attr enforces ordering (IV pair, discharge ≥ latest IV). On click Generate, the chosen date is threaded through `runGenerate → generate*Note → pickVisitAnchor → inputData → LLM prompt → persisted row`. Null/blank = today (old behavior). Regen with unchanged value = no change. DB trigger violations surface as toasts via existing `mapVisitDateOrderError`.

### Key Discoveries:

- `mapVisitDateOrderError` at [src/actions/initial-visit-notes.ts:43](src/actions/initial-visit-notes.ts#L43) — reuse, don't re-implement.
- `pickVisitAnchor` at [src/lib/age.ts:15-22](src/lib/age.ts#L15-L22) — two-arg; add optional override as first arg.
- `InitialVisitInputData.visitDate` does NOT exist today ([generate-initial-visit.ts](src/lib/claude/generate-initial-visit.ts) — only `age`). Adding it brings IV to parity with discharge.
- `ToneDirectionCard` pattern at [initial-visit-editor.tsx:449-453](src/components/clinical/initial-visit-editor.tsx#L449-L453) — model `<VisitDateCard>` on it: hoisted state + `onChange` + passed through `runGenerate`.
- Date convention: `yyyy-MM-dd` strings end-to-end, Zod `z.string()`, display via `new Date(str + 'T00:00:00')`.
- Bounded Zod factory pattern at [src/lib/validations/prp-procedure.ts:57-70](src/lib/validations/prp-procedure.ts#L57-L70).
- `record-procedure-dialog.tsx:332-346` precedent for `<Input type="date" min=…>`.

## What We're NOT Doing

- No changes to procedure-note flow — date stays on `procedures` row captured in the separate dialog.
- No DB schema changes — `visit_date` columns already exist.
- No new DB migrations / triggers.
- Post-generation date inputs in draft editor headers stay untouched.
- No Calendar popover — keep to plain `<Input type="date">` to match the discharge/IV post-gen inputs and `record-procedure-dialog` precedent. Popover pattern (wizard DOB) reserved for date-of-birth only.
- No change to `pickVisitAnchor` call sites other than IV generation.

## Implementation Approach

Backend-first, additive: every phase leaves the codebase in a working, tested state. Phase 1 accepts `visitDate` at action boundary but null = old behavior (no regression). Phase 4 is when user-visible change lands.

---

## Phase 1: Backend plumbing — action signatures + override precedence

### Overview

Extend `pickVisitAnchor` with an optional override; plumb a `visitDate` arg through `generateInitialVisitNote` and `generateDischargeNote`; add `visitDate` into `InitialVisitInputData` so the IV LLM prompt receives it.

### Changes Required:

#### 1. `src/lib/age.ts`

**Changes**: add optional `override` as first arg. Precedence: `override → visitDate → finalizedAt → today`.

```ts
export function pickVisitAnchor(
  override: string | null | undefined,
  visitDate: string | null | undefined,
  finalizedAt: string | null | undefined,
): string | null {
  if (override) return override.slice(0, 10)
  if (visitDate) return visitDate.slice(0, 10)
  if (finalizedAt) return finalizedAt.slice(0, 10)
  return new Date().toISOString().slice(0, 10)
}
```

Update call site at [src/actions/initial-visit-notes.ts:265](src/actions/initial-visit-notes.ts#L265) to pass the new override as first arg; existing args shift.

#### 2. `src/lib/claude/generate-initial-visit.ts`

**Changes**: add `visitDate: string | null` to `InitialVisitInputData`. No prompt-template changes needed — the full `inputData` JSON is already serialized into the user message ([line 589](src/lib/claude/generate-initial-visit.ts#L589)).

#### 3. `src/actions/initial-visit-notes.ts`

**Changes**:
- Accept `visitDate?: string | null` as 4th arg of `generateInitialVisitNote`.
- Normalize: treat empty string as null.
- Compute `effectiveVisitDate = normalizedVisitDate ?? existingNote?.visit_date ?? today`.
- Pass `effectiveVisitDate` as override to `pickVisitAnchor` in `gatherSourceData`. Since `gatherSourceData` is called without a `visitType`-scoped override today, add a 4th optional arg.
- Populate `inputData.visitDate = effectiveVisitDate` in the returned object.
- Write `visit_date: effectiveVisitDate` in both the existing-row update (line 382) and new-insert (line 427) branches.

```ts
export async function generateInitialVisitNote(
  caseId: string,
  visitType: NoteVisitType,
  toneHint?: string | null,
  visitDate?: string | null,
) {
  // ...
  const normalizedVisitDate = visitDate?.trim() ? visitDate.trim() : null
  const today = new Date().toISOString().slice(0, 10)
  const effectiveVisitDate = normalizedVisitDate ?? existingNote?.visit_date ?? today

  const { data: inputData, error: gatherError } =
    await gatherSourceData(supabase, caseId, visitType, preservedRom, effectiveVisitDate)
  // ...
  // existing-row UPDATE: visit_date: effectiveVisitDate
  // new-row INSERT:     visit_date: effectiveVisitDate
```

`gatherSourceData` signature grows:

```ts
async function gatherSourceData(
  supabase,
  caseId,
  visitType,
  romData,
  visitDateOverride?: string | null,
)
```

And at line 265–269:

```ts
const visitAnchor = pickVisitAnchor(
  visitDateOverride,
  (intakeRes.data?.visit_date as string | null | undefined) ?? null,
  (intakeRes.data?.finalized_at as string | null | undefined) ?? null,
)
const age = computeAgeAtDate(patient.date_of_birth, visitAnchor)
// ...
return {
  data: {
    // ...existing fields...
    visitDate: visitAnchor,  // new field on InitialVisitInputData
    // ...
  }
}
```

#### 4. `src/actions/discharge-notes.ts`

**Changes**:
- Accept `visitDate?: string | null` as 2nd arg of `generateDischargeNote`.
- Precedence unchanged semantics: `normalizedVisitDate ?? existingNote?.visit_date ?? today`.
- Replace [line 602](src/actions/discharge-notes.ts#L602):

```ts
const normalizedVisitDate = visitDate?.trim() ? visitDate.trim() : null
const today = new Date().toISOString().slice(0, 10)
const visitDate_ = normalizedVisitDate ?? existingNote?.visit_date ?? today
```

(Rename local var to avoid shadowing the parameter; or restructure.)

### Success Criteria:

#### Automated Verification:
- [ ] Type checking passes: `npx tsc --noEmit`
- [ ] Linting passes: `npm run lint`
- [ ] All existing tests pass: `npm test`
- [ ] `src/lib/age.ts` updated function signature matches callers

#### Manual Verification:
- [ ] Generating IV with no `visitDate` arg produces identical row to previous behavior (today as visit_date)
- [ ] Generating discharge with no `visitDate` arg produces identical row to previous behavior

**Implementation Note**: Phase 1 is invisible to users. Stop and verify automated checks before Phase 2.

---

## Phase 2: Server-side floor queries + page props

### Overview

Server-render each editor page with the relevant "earliest allowed" date so the client can enforce `min=` in `<Input type="date">`.

### Changes Required:

#### 1. `src/app/(dashboard)/patients/[caseId]/initial-visit/page.tsx`

**Changes**: compute `siblingDate` — the other `visit_type` row's `visit_date` — per visit-type tab, pass to editor. Shape:

```ts
const { data: siblingRows } = await supabase
  .from('initial_visit_notes')
  .select('visit_type, visit_date')
  .eq('case_id', caseId)
  .is('deleted_at', null)

const siblingDates = {
  initial_visit: siblingRows?.find(r => r.visit_type === 'pain_evaluation_visit')?.visit_date ?? null,
  pain_evaluation_visit: siblingRows?.find(r => r.visit_type === 'initial_visit')?.visit_date ?? null,
}
```

Pass as `siblingDates` prop to `<InitialVisitEditor>`.

#### 2. `src/app/(dashboard)/patients/[caseId]/discharge/page.tsx`

**Changes**: compute `earliestDischargeDate` = max live `initial_visit_notes.visit_date` for case.

```ts
const { data: ivDates } = await supabase
  .from('initial_visit_notes')
  .select('visit_date')
  .eq('case_id', caseId)
  .is('deleted_at', null)
  .not('visit_date', 'is', null)

const earliestDischargeDate = ivDates && ivDates.length
  ? ivDates.map(r => r.visit_date as string).sort().at(-1) ?? null
  : null
```

Pass as `earliestDate` prop to `<DischargeNoteEditor>`.

#### 3. Editor prop-drilling

- `InitialVisitEditor` / `InitialVisitEditorInner` accept `siblingDates: Record<NoteVisitType, string | null>`; inner component reads `siblingDates[visitType]` for its tab.
- `DischargeNoteEditor` accepts `earliestDate: string | null`.

### Success Criteria:

#### Automated Verification:
- [ ] Type checking passes: `npx tsc --noEmit`
- [ ] Pages render without runtime errors: `npm run build`

#### Manual Verification:
- [ ] Load IV page for a case with one existing IV note → sibling date prop computed correctly
- [ ] Load discharge page for a case with finalized IV → `earliestDate` matches DB value

---

## Phase 3: Validation schemas

### Overview

Expose Zod factory schemas for the pre-generation date, modeled on `prp-procedure.ts:57-70`. Not strictly required (the `min=` attribute + DB trigger handle most cases), but gives per-field error messages without a round-trip.

### Changes Required:

#### 1. `src/lib/validations/visit-date.ts` (new)

```ts
import { z } from 'zod'

export function visitDateSchema(opts?: {
  floorDate?: string | null
  ceilingDate?: string | null
  floorLabel?: string
  ceilingLabel?: string
}) {
  return z
    .string()
    .min(1, 'Visit date is required')
    .refine(
      (v) => !opts?.floorDate || v >= opts.floorDate,
      { message: `Visit date cannot precede the ${opts?.floorLabel ?? 'earliest allowed date'}.` },
    )
    .refine(
      (v) => !opts?.ceilingDate || v <= opts.ceilingDate,
      { message: `Visit date cannot exceed the ${opts?.ceilingLabel ?? 'latest allowed date'}.` },
    )
}
```

Use-sites (Phase 4) call this with per-editor opts.

### Success Criteria:

#### Automated Verification:
- [ ] Type checking passes: `npx tsc --noEmit`
- [ ] Unit tests for schema factory pass (Phase 5 writes these)

#### Manual Verification:
- [ ] N/A — Phase 4 surfaces to UI.

---

## Phase 4: UI — `<VisitDateCard>` + wire into editors

### Overview

New reusable card component with `<Input type="date">` and `min=` attr. Hoisted state in IV and discharge editors mirrors `toneHint` pattern.

### Changes Required:

#### 1. `src/components/clinical/visit-date-card.tsx` (new)

```tsx
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type VisitDateCardProps = {
  value: string
  onChange: (v: string) => void
  min?: string | null
  max?: string | null
  disabled?: boolean
  label?: string
  helperText?: string
}

export function VisitDateCard({
  value,
  onChange,
  min,
  max,
  disabled,
  label = 'Date of Visit',
  helperText = 'Defaults to today. The note is generated with this date as the visit anchor.',
}: VisitDateCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Label htmlFor="visit-date-pre-gen" className="sr-only">{label}</Label>
        <Input
          id="visit-date-pre-gen"
          type="date"
          className="w-[200px]"
          value={value}
          min={min ?? undefined}
          max={max ?? undefined}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">{helperText}</p>
      </CardContent>
    </Card>
  )
}
```

#### 2. `src/components/clinical/initial-visit-editor.tsx`

**Changes at [line 321](src/components/clinical/initial-visit-editor.tsx#L321)**: add date state:

```tsx
const today = new Date().toISOString().slice(0, 10)
const [visitDate, setVisitDate] = useState<string>(note?.visit_date ?? today)
```

**Changes at [line 328-340](src/components/clinical/initial-visit-editor.tsx#L328-L340)** — threading:

```tsx
const runGenerate = (toneHintArg: string | null, visitDateArg: string | null) => {
  setOptimisticStartedAt(new Date().toISOString())
  setOptimisticGenerating(true)
  startTransition(async () => {
    try {
      const result = await generateInitialVisitNote(caseId, visitType, toneHintArg, visitDateArg)
      if (result.error) toast.error(result.error)
      else toast.success('Note generated successfully')
    } finally {
      setOptimisticGenerating(false)
    }
  })
}
```

**Render at [line 449-453](src/components/clinical/initial-visit-editor.tsx#L449-L453)** — add card just before `<ToneDirectionCard>`:

```tsx
<VisitDateCard
  value={visitDate}
  onChange={setVisitDate}
  min={visitType === 'pain_evaluation_visit' ? siblingDates[visitType] ?? undefined : undefined}
  max={visitType === 'initial_visit' ? siblingDates[visitType] ?? undefined : undefined}
  disabled={isLocked || isPending}
/>
<ToneDirectionCard ... />
```

Update button onClick at [line 462](src/components/clinical/initial-visit-editor.tsx#L462): `onClick={() => runGenerate(toneHint || null, visitDate || null)}`.

Prop signature adds `siblingDates: Record<NoteVisitType, string | null>`.

#### 3. `src/components/discharge/discharge-note-editor.tsx`

**Changes at [line 205-207](src/components/discharge/discharge-note-editor.tsx#L205-L207)**:

```tsx
const today = new Date().toISOString().slice(0, 10)
const [visitDate, setVisitDate] = useState<string>(note?.visit_date ?? today)
```

**Changes at [line 211-223](src/components/discharge/discharge-note-editor.tsx#L211-L223)**:

```tsx
const runGenerate = (toneHintArg: string | null, visitDateArg: string | null) => {
  setOptimisticStartedAt(new Date().toISOString())
  setOptimisticGenerating(true)
  startTransition(async () => {
    try {
      const result = await generateDischargeNote(caseId, toneHintArg, visitDateArg)
      if (result.error) toast.error(result.error)
      else toast.success('Discharge summary generated successfully')
    } finally {
      setOptimisticGenerating(false)
    }
  })
}
```

**Render at [line 268](src/components/discharge/discharge-note-editor.tsx#L268)** — insert before `<ToneDirectionCard>`:

```tsx
<VisitDateCard
  value={visitDate}
  onChange={setVisitDate}
  min={earliestDate ?? undefined}
  disabled={isLocked || isPending}
/>
<ToneDirectionCard ... />
```

Update button onClick at [line 281](src/components/discharge/discharge-note-editor.tsx#L281): `onClick={() => runGenerate(toneHint || null, visitDate || null)}`.

Prop signature adds `earliestDate: string | null`.

### Success Criteria:

#### Automated Verification:
- [ ] Type checking passes: `npx tsc --noEmit`
- [ ] Linting passes: `npm run lint`
- [ ] Build succeeds: `npm run build`

#### Manual Verification:
- [ ] IV editor pre-gen view shows `<VisitDateCard>` with today's date selected by default
- [ ] Pain Evaluation Visit tab shows `min=` matching Initial Visit's date when one exists
- [ ] Initial Visit tab shows `max=` matching Pain Evaluation's date when one exists
- [ ] Changing the date then clicking Generate → new note's `visit_date` column matches the chosen date
- [ ] Generating without changing the date (today) → behaves like before the change
- [ ] Discharge editor shows `min=` matching latest IV date when IV exists
- [ ] Attempt to select a date that violates the DB trigger → generation fails, toast shows `mapVisitDateOrderError` message (IV tabs); discharge has no trigger but UI `min` still prevents the selection

**Implementation Note**: Pause after Phase 4 for manual smoke test before Phase 5.

---

## Phase 5: Tests

### Overview

Unit coverage for the three logic changes (override precedence in `pickVisitAnchor`, visitDate threading through the IV action, zod floor validation). UI smoke covered manually.

### Changes Required:

#### 1. `src/lib/__tests__/age.test.ts` — extend

Add cases:
- `pickVisitAnchor('2026-01-01', '2026-02-02', '2026-03-03')` → `'2026-01-01'`
- `pickVisitAnchor(null, '2026-02-02', '2026-03-03')` → `'2026-02-02'`
- `pickVisitAnchor(null, null, '2026-03-03')` → `'2026-03-03'`
- `pickVisitAnchor(null, null, null)` → today (string length 10)
- `pickVisitAnchor('', null, null)` → today (empty string treated as falsy)

#### 2. `src/lib/validations/__tests__/visit-date.test.ts` — new

Cases:
- Accepts valid date within bounds
- Rejects empty string
- Rejects date before `floorDate` with message mentioning `floorLabel`
- Rejects date after `ceilingDate` with message mentioning `ceilingLabel`
- No bounds = any non-empty date passes

### Success Criteria:

#### Automated Verification:
- [ ] All new tests pass: `npm test -- age.test.ts visit-date.test.ts`
- [ ] Full suite still passes: `npm test`
- [ ] Type checking passes: `npx tsc --noEmit`

#### Manual Verification:
- [ ] N/A — covered in Phase 4.

---

## Testing Strategy

### Unit Tests:
- `pickVisitAnchor` override precedence (Phase 5.1)
- `visitDateSchema` bound enforcement (Phase 5.2)

### Integration Tests:
- None added. Existing action tests continue to pass with the new optional args defaulting to old behavior.

### Manual Testing Steps:
1. Open IV editor on a clean case → default date = today, Generate → row `visit_date` = today.
2. Change date to yesterday → Generate → row `visit_date` = yesterday; LLM prompt JSON now includes `visitDate` field.
3. Generate Pain Evaluation with a date earlier than Initial Visit's → DB trigger rejects → toast shows user-facing message from `mapVisitDateOrderError`.
4. Pain Evaluation tab `min` = Initial Visit's date — browser date picker prevents selecting earlier dates before server round-trip.
5. Discharge editor: `min` = latest IV date. Generate with chosen date → row `visit_date` = chosen; age computed against chosen; `inputData.visitDate` in prompt matches.
6. Regenerate IV note without changing pre-gen date control → `visit_date` preserved (row's existing value wins over today since pre-gen default loads from `note.visit_date`).
7. Post-gen header date input ([initial-visit-editor.tsx:1705](src/components/clinical/initial-visit-editor.tsx#L1705)) still works — editing + Save Draft updates `visit_date` independently of pre-gen card.

## Performance Considerations

- Phase 2 adds one additional small query per page load (siblingDates / earliestDate). Both are small range scans on indexed columns. No measurable impact.
- LLM prompt for IV grows by one short string field. Negligible token cost.

## Migration Notes

None. Schema unchanged.

## References

- Research: `thoughts/shared/research/2026-04-24-visit-date-ui-before-notes-generation.md`
- Related: `thoughts/shared/research/2026-04-19-tone-direction-for-procedure-and-discharge-notes.md` — isomorphic wiring precedent
- `src/actions/initial-visit-notes.ts:326-523` — generateInitialVisitNote
- `src/actions/discharge-notes.ts:552-845` — generateDischargeNote
- `src/lib/age.ts:1-22` — age + anchor helpers
- `src/lib/validations/prp-procedure.ts:57-70` — bounded date schema precedent
- `src/components/procedures/record-procedure-dialog.tsx:332-346` — `min=` input precedent
- `supabase/migrations/20260414_initial_visit_date_order.sql` — IV pair ordering trigger
- `supabase/migrations/20260415_procedure_date_order.sql` — procedure floor trigger
