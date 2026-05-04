# Procedure Site Defaults from IV/PE Treatment Plan — Implementation Plan

## Overview

Switch the source of `sites: ProcedureSite[]` in `getProcedureDefaults` ([src/actions/procedures.ts:445-585](src/actions/procedures.ts#L445-L585)) from the intake `chief_complaints[].body_region` array to the **IV/PE treatment_plan**:

- **PM extraction** `pain_management_extractions.treatment_plan` (jsonb structured array; only items where `type === 'injection'` or whose description implies an injection — same predicate `compute-plan-alignment.ts` uses today).
- **Initial Visit Note** `initial_visit_notes.treatment_plan` (text; sentences mentioning PRP/injection/epidural/etc.).

Both sources combined; PM-first; deduped by `(label, laterality)`. When the plan yields zero injection candidates the existing intake-body-region path runs as a fallback so behavior never regresses for cases without a treatment plan.

The two parsers needed already exist as private functions in [src/lib/procedures/compute-plan-alignment.ts:179-234](src/lib/procedures/compute-plan-alignment.ts#L179-L234). Reuse them by exporting; add a new adapter that maps `PlannedProcedure[]` → `ProcedureSite[]` (level expansion, region-only fallback, title-case labels).

## Current State Analysis

**Existing site-default derivation** ([src/actions/procedures.ts:506-528](src/actions/procedures.ts#L506-L528)):

```ts
const complaints = preferredIvn?.provider_intake?.chief_complaints?.complaints ?? []
const parsed = complaints
  .filter((c) => c.body_region && c.body_region.trim() !== '')
  .map((c) => parseBodyRegion(c.body_region))
  .filter((p) => p.injection_site !== '')

const seen = new Set<string>()
const sites: ProcedureSite[] = []
for (const p of parsed) {
  const key = `${p.injection_site}|${p.laterality ?? 'null'}`
  if (seen.has(key)) continue
  seen.add(key)
  sites.push({
    label: p.injection_site,
    laterality: p.laterality,
    volume_ml: null,
    target_confirmed_imaging: null,
  })
}
```

This path emits one site per intake chief complaint, regardless of whether the case's treatment plan calls for injecting that region. Cases where intake has many body regions (e.g. neck + low back + knee) but the plan calls for only lumbar PRP get noisy defaults.

**Existing plan parsers, behavior preserved verbatim** ([src/lib/procedures/compute-plan-alignment.ts:170-234](src/lib/procedures/compute-plan-alignment.ts#L170-L234)):

- `parsePmTreatmentPlan(raw: unknown): PlannedProcedure[]` — filters to `type === 'injection'` OR description matches `/\bprp\b|\binject|epidural|facet block|nerve block|transforaminal|intradiscal/i`. Returns `body_region`, `laterality`, `guidance_hint`, `target_levels`, `raw_description`.
- `parseInitialVisitTreatmentPlan(text: string | null | undefined): PlannedProcedure[]` — splits on sentence boundaries; same injection regex; same field extraction.

Currently both are file-private. Their consumer `computePlanAlignment` ([compute-plan-alignment.ts:335-397](src/lib/procedures/compute-plan-alignment.ts#L335-L397)) is called from [src/actions/procedure-notes.ts:435-450](src/actions/procedure-notes.ts#L435-L450), which already prefers `provider_overrides.treatment_plan` over raw `pmRes.data.treatment_plan`.

**Existing `ProcedureSite` shape** ([src/lib/procedures/sites-helpers.ts:3-10](src/lib/procedures/sites-helpers.ts#L3-L10)):

```ts
export const procedureSiteSchema = z.object({
  label: z.string().min(1, 'Site label is required'),
  laterality: z.enum(['left', 'right', 'bilateral']).nullable(),
  volume_ml: z.number().positive().nullable(),
  target_confirmed_imaging: z.boolean().nullable(),
})
```

Existing test fixture confirms vertebral level codes are valid `label` values: `{ label: 'C5-C6', laterality: 'bilateral', ... }` ([compute-plan-alignment.test.ts:247-248](src/lib/procedures/compute-plan-alignment.test.ts#L247-L248)).

**No tests exist for `getProcedureDefaults`.** Verified via `grep -rn "getProcedureDefaults"` — only consumer is the procedures page ([src/app/(dashboard)/patients/[caseId]/procedures/page.tsx:16](src/app/(dashboard)/patients/[caseId]/procedures/page.tsx#L16)).

## Desired End State

When `getProcedureDefaults(caseId)` runs:

1. Fetches PM extraction (preferring `provider_overrides.treatment_plan` when present, falling back to `pmRes.data.treatment_plan`) + IV note `treatment_plan` text in the existing parallel `Promise.all` block (no extra round trip — the existing PM query just selects `treatment_plan` + `provider_overrides` instead of only `diagnoses, provider_overrides`; the existing IV query selects `treatment_plan` alongside `provider_intake`).
2. Derives `PlannedProcedure[]` from both sources via the (newly exported) parsers.
3. Maps the union → `ProcedureSite[]` via a new adapter:
   - For each plan candidate, if `target_levels` is non-empty → emit one `ProcedureSite` per level (label = level code, e.g. `"L4-L5"`).
   - Otherwise, if `body_region` is non-null → emit one `ProcedureSite` with `label = titleCaseRegion(body_region)` (e.g. `"Lumbar"`, `"Knee"`).
   - Otherwise, skip (no usable site info).
   - `laterality` carried from candidate. `volume_ml` + `target_confirmed_imaging` start `null`.
   - PM candidates processed first; dedupe by `(label, laterality)` so IV duplicates of PM entries are dropped.
4. If the resulting array is empty (no plan, or plan has no injection items), fall back to the existing intake-body-region derivation (current behavior preserved).
5. Anatomy-key resolution and `procedure_defaults` lookup downstream of `sites` ([procedures.ts:535-557](src/actions/procedures.ts#L535-L557)) is unchanged — `singleAnatomyFromSites(sites)` still receives a `ProcedureSite[]`.

`computePlanAlignment` runtime behavior is unchanged. The two parsers move from `function` to `export function` (or move into a sibling module that `compute-plan-alignment.ts` re-imports) — no logic changes.

### Key Discoveries:
- `parsePmTreatmentPlan` + `parseInitialVisitTreatmentPlan` already exist with the exact filter/extraction semantics needed ([compute-plan-alignment.ts:179-234](src/lib/procedures/compute-plan-alignment.ts#L179-L234)).
- `procedure-notes.ts:445-447` already prefers `provider_overrides.treatment_plan` — match this precedence in defaults so the same plan is read both places.
- PM extraction `treatment_plan` schema is `{description, type, estimated_cost_min, estimated_cost_max, body_region}[]` per [extract-pain-management.ts:124-141](src/lib/claude/extract-pain-management.ts#L124-L141). The `parsePmTreatmentPlan` predicate already handles both the `type === 'injection'` case and the looser description-regex case.
- `procedureSiteSchema.label` accepts arbitrary non-empty strings, so vertebral level codes (`"L4-L5"`, `"C5-C6"`) and region words (`"Lumbar"`, `"Knee"`) are both valid labels — see existing fixture [compute-plan-alignment.test.ts:247-248](src/lib/procedures/compute-plan-alignment.test.ts#L247-L248).
- `parseBodyRegion` ([src/lib/procedures/parse-body-region.ts:36-38](src/lib/procedures/parse-body-region.ts#L36-L38)) defines `titleCaseRegion` privately; the adapter needs the same logic — easiest to inline a copy or export the helper.

## What We're NOT Doing

- No DB migration. No schema change.
- No form UI change. `record-procedure-dialog.tsx` and `SitesEditor` untouched.
- No change to `compute-plan-alignment.ts` runtime behavior. The only edit there is converting two `function` declarations to `export function` (or relocating them) — no logic change. Existing tests must still pass byte-for-byte assertions.
- No change to `procedure-notes.ts` — it keeps its own `computePlanAlignment` call as-is.
- No change to procedure-note prompt wording (covered by sibling plan `thoughts/shared/plans/2026-04-26-prp-per-site-volume-narration.md`).
- No change to anatomy/diagnosis fallback for `procedure_defaults` table lookup — still runs when `sites[]` doesn't resolve to a single anatomy.
- No change to `getCaseDiagnoses` — separate code path with its own PM-vs-IVN merge logic.

## Implementation Approach

Three sequential edits with a verification phase:
1. **Phase 1** — Surgical refactor: export the two existing parsers from `compute-plan-alignment.ts` so `procedures.ts` can call them. No new module needed; keep parsers next to `computePlanAlignment` since they share `normalizeRegion` / `extractLevels` / `extractLaterality` / `extractGuidanceHint`.
2. **Phase 2** — Add adapter + tests in a new file `src/lib/procedures/sites-from-plan.ts`. Pure function, fully unit-tested.
3. **Phase 3** — Wire `getProcedureDefaults` to fetch + adapt + fall back. Add a smoke test for the wiring.
4. **Phase 4** — Manual end-to-end verification through the procedures page UI.

---

## Phase 1: Export `parsePmTreatmentPlan` and `parseInitialVisitTreatmentPlan`

### Overview
Surface the two existing parsers without behavior change so `getProcedureDefaults` can import them.

### Changes Required:

#### 1. Mark parsers as exported
**File**: `src/lib/procedures/compute-plan-alignment.ts`
**Changes**: Convert the two `function` declarations at lines 179 and 212 to `export function`. Also export the helper type `PmPlanItem` that `parsePmTreatmentPlan` accepts, since downstream callers will pass typed payloads.

```ts
// Was: function parsePmTreatmentPlan(raw: unknown): PlannedProcedure[]
export function parsePmTreatmentPlan(raw: unknown): PlannedProcedure[]

// Was: function parseInitialVisitTreatmentPlan(text: string | null | undefined): PlannedProcedure[]
export function parseInitialVisitTreatmentPlan(
  text: string | null | undefined,
): PlannedProcedure[]
```

`PlannedProcedure` is already exported (line 16). No other changes — neither function body is modified.

### Success Criteria:

#### Automated Verification:
- [x] Type check passes: `npx tsc --noEmit`
- [ ] Lint passes: `npm run lint`
- [x] Existing alignment tests still pass byte-for-byte: `npx vitest run src/lib/procedures/compute-plan-alignment.test.ts`
- [ ] No new test failures elsewhere: `npx vitest run`

#### Manual Verification:
- [x] None — pure visibility change.

---

## Phase 2: Add `sitesFromPlan` adapter + unit tests

### Overview
Add a pure function that maps `PlannedProcedure[]` (PM + IV combined) into `ProcedureSite[]` with level expansion, region-only fallback, title-case labels, and `(label, laterality)` dedupe. Unit-test exhaustively.

### Changes Required:

#### 1. Adapter module
**File**: `src/lib/procedures/sites-from-plan.ts` (new)
**Changes**: New file exposing `sitesFromPlan(pmCandidates, ivCandidates) → ProcedureSite[]`.

```ts
import type { PlannedProcedure } from './compute-plan-alignment'
import type { ProcedureSite } from './sites-helpers'

function titleCase(s: string): string {
  return s.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

// Convert one PlannedProcedure into 0..N ProcedureSite rows.
// - target_levels non-empty → one site per level (label = level code, e.g. "L4-L5")
// - target_levels empty + body_region non-null → one site (label = titleCase(body_region))
// - target_levels empty + body_region null → no sites (skip; insufficient info)
function sitesFromCandidate(c: PlannedProcedure): ProcedureSite[] {
  if (c.target_levels.length > 0) {
    return c.target_levels.map((level) => ({
      label: level,
      laterality: c.laterality,
      volume_ml: null,
      target_confirmed_imaging: null,
    }))
  }
  if (c.body_region) {
    return [{
      label: titleCase(c.body_region),
      laterality: c.laterality,
      volume_ml: null,
      target_confirmed_imaging: null,
    }]
  }
  return []
}

// PM-first union, then dedupe by (label, laterality). Case-insensitive label match.
export function sitesFromPlan(
  pmCandidates: PlannedProcedure[],
  ivCandidates: PlannedProcedure[],
): ProcedureSite[] {
  const combined = [...pmCandidates, ...ivCandidates].flatMap(sitesFromCandidate)
  const seen = new Set<string>()
  const out: ProcedureSite[] = []
  for (const s of combined) {
    const key = `${s.label.toLowerCase()}|${s.laterality ?? 'null'}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}
```

#### 2. Unit tests
**File**: `src/lib/procedures/sites-from-plan.test.ts` (new)
**Changes**: Cover level expansion, region fallback, dedupe, ordering, laterality preservation, empty inputs.

```ts
import { describe, it, expect } from 'vitest'
import { sitesFromPlan } from './sites-from-plan'
import type { PlannedProcedure } from './compute-plan-alignment'

const pm = (overrides: Partial<PlannedProcedure> = {}): PlannedProcedure => ({
  source: 'pm_extraction',
  body_region: null,
  laterality: null,
  guidance_hint: null,
  target_levels: [],
  raw_description: '',
  ...overrides,
})
const iv = (overrides: Partial<PlannedProcedure> = {}): PlannedProcedure => ({
  ...pm(overrides),
  source: 'initial_visit_note',
})

describe('sitesFromPlan', () => {
  it('returns [] when both inputs are empty', () => {
    expect(sitesFromPlan([], [])).toEqual([])
  })

  it('expands target_levels into one site per level', () => {
    const result = sitesFromPlan(
      [pm({ body_region: 'lumbar', target_levels: ['L4-L5', 'L5-S1'], laterality: 'bilateral' })],
      [],
    )
    expect(result).toEqual([
      { label: 'L4-L5', laterality: 'bilateral', volume_ml: null, target_confirmed_imaging: null },
      { label: 'L5-S1', laterality: 'bilateral', volume_ml: null, target_confirmed_imaging: null },
    ])
  })

  it('falls back to title-cased body_region when target_levels is empty', () => {
    const result = sitesFromPlan(
      [pm({ body_region: 'knee', laterality: 'right' })],
      [],
    )
    expect(result).toEqual([
      { label: 'Knee', laterality: 'right', volume_ml: null, target_confirmed_imaging: null },
    ])
  })

  it('skips candidates with no levels and no body_region', () => {
    const result = sitesFromPlan(
      [pm({ body_region: null, target_levels: [] })],
      [],
    )
    expect(result).toEqual([])
  })

  it('preserves PM-first order across union', () => {
    const result = sitesFromPlan(
      [pm({ body_region: 'lumbar', target_levels: ['L4-L5'] })],
      [iv({ body_region: 'cervical', target_levels: ['C5-C6'] })],
    )
    expect(result.map((s) => s.label)).toEqual(['L4-L5', 'C5-C6'])
  })

  it('dedupes by (label, laterality) case-insensitively, preserving first occurrence', () => {
    const result = sitesFromPlan(
      [pm({ body_region: 'lumbar', target_levels: ['L4-L5'], laterality: 'left' })],
      [
        iv({ body_region: 'lumbar', target_levels: ['l4-l5'], laterality: 'left' }), // dup, dropped
        iv({ body_region: 'lumbar', target_levels: ['L4-L5'], laterality: 'right' }), // diff lat, kept
      ],
    )
    expect(result).toEqual([
      { label: 'L4-L5', laterality: 'left', volume_ml: null, target_confirmed_imaging: null },
      { label: 'L4-L5', laterality: 'right', volume_ml: null, target_confirmed_imaging: null },
    ])
  })

  it('treats null laterality as a distinct dedupe key from explicit values', () => {
    const result = sitesFromPlan(
      [
        pm({ body_region: 'knee' }), // null laterality
        pm({ body_region: 'knee', laterality: 'right' }),
      ],
      [],
    )
    expect(result).toHaveLength(2)
  })

  it('handles a multi-region plan: cervical levels + lumbar levels in one PM item set', () => {
    const result = sitesFromPlan(
      [
        pm({ body_region: 'cervical', target_levels: ['C5-C6'], laterality: 'bilateral' }),
        pm({ body_region: 'lumbar', target_levels: ['L5-S1'], laterality: 'bilateral' }),
      ],
      [],
    )
    expect(result.map((s) => s.label)).toEqual(['C5-C6', 'L5-S1'])
  })

  it('combines PM injection candidate with IV non-overlapping site', () => {
    const result = sitesFromPlan(
      [pm({ body_region: 'lumbar', target_levels: ['L4-L5'] })],
      [iv({ body_region: 'shoulder', laterality: 'right' })],
    )
    expect(result).toEqual([
      { label: 'L4-L5', laterality: null, volume_ml: null, target_confirmed_imaging: null },
      { label: 'Shoulder', laterality: 'right', volume_ml: null, target_confirmed_imaging: null },
    ])
  })

  it('title-cases multi-word body_region', () => {
    const result = sitesFromPlan(
      [pm({ body_region: 'sacroiliac joint' })],
      [],
    )
    expect(result[0].label).toBe('Sacroiliac Joint')
  })
})
```

### Success Criteria:

#### Automated Verification:
- [x] Type check passes: `npx tsc --noEmit`
- [ ] Lint passes: `npm run lint`
- [x] New unit tests pass: `npx vitest run src/lib/procedures/sites-from-plan.test.ts`
- [x] Existing alignment tests untouched: `npx vitest run src/lib/procedures/compute-plan-alignment.test.ts`

#### Manual Verification:
- [x] None — pure adapter, fully covered by unit tests.

---

## Phase 3: Wire `getProcedureDefaults` to read treatment_plan

### Overview
Replace the `parseBodyRegion`-over-`chief_complaints` site derivation with `sitesFromPlan(parsePmTreatmentPlan(...), parseInitialVisitTreatmentPlan(...))`. Fall back to the legacy intake derivation when the plan yields zero sites. Extend the existing `Promise.all` queries so `treatment_plan` is selected without adding round trips.

### Changes Required:

#### 1. Extend the parallel queries
**File**: `src/actions/procedures.ts`
**Changes**: At [procedures.ts:458-481](src/actions/procedures.ts#L458-L481), broaden the IV select to include `treatment_plan`, and broaden the PM select (`pmDxRes`) to include `treatment_plan`. The existing `pmDxRes` query already has `is('deleted_at', null)` and the right `review_status` filter — reuse it; do not add another query.

```ts
// existing IV query — add treatment_plan
supabase
  .from('initial_visit_notes')
  .select('provider_intake, visit_type, visit_date, treatment_plan, status')
  .eq('case_id', caseId)
  .is('deleted_at', null),
// ...
// existing PM query — add treatment_plan
supabase
  .from('pain_management_extractions')
  .select('diagnoses, provider_overrides, treatment_plan')
  .eq('case_id', caseId)
  .in('review_status', ['approved', 'edited'])
  .is('deleted_at', null)
  .order('created_at', { ascending: false })
  .limit(1)
  .maybeSingle(),
```

The IV query is the one that drives both `preferredIvn` (for chief_complaints fallback) and the `treatment_plan` source — same row preference applies (`pain_evaluation_visit` then `initial_visit`). Adding `status` to the select is needed because the plan-source preference also wants to skip pure draft IV notes? **No** — for consistency with current behavior (which uses any non-deleted IV row regardless of status), we accept draft `treatment_plan` text too; the `status` field is included so the type narrows cleanly but is not filtered on.

#### 2. Update the IvnIntakeRow type and add treatment_plan extraction
**File**: `src/actions/procedures.ts`
**Changes**: Extend the local `IvnIntakeRow` type to carry `treatment_plan`. Reuse the existing `preferredIvn` row pick (no new preference logic).

```ts
type IvnIntakeRow = {
  visit_type: string
  visit_date: string | null
  provider_intake: { chief_complaints?: { complaints?: Array<{ body_region: string }> } } | null
  treatment_plan: string | null
  status: string
}
```

Note: the existing `preferredIvn` selector at [procedures.ts:501-504](src/actions/procedures.ts#L501-L504) requires `provider_intake` to be non-null. For the treatment_plan source we want a separate selector that only requires `treatment_plan` — an IV note can have a populated treatment_plan even without a provider_intake. Add:

```ts
const preferredIvnPlan =
  ivnRows.find((r) => r.visit_type === 'pain_evaluation_visit' && r.treatment_plan)
  ?? ivnRows.find((r) => r.visit_type === 'initial_visit' && r.treatment_plan)
  ?? null
const ivTreatmentPlanText = preferredIvnPlan?.treatment_plan ?? null
```

#### 3. Build sites from plan, fall back to intake
**File**: `src/actions/procedures.ts`
**Changes**: Replace lines 506-528 with plan-derived sites + intake fallback.

```ts
// Resolve PM treatment_plan: prefer provider_overrides.treatment_plan when
// present (matches procedure-notes.ts), else raw column.
const pmOverrides = pmDxRes.data?.provider_overrides as
  { treatment_plan?: unknown; diagnoses?: unknown }
  | null
const pmTreatmentPlanRaw =
  (pmOverrides?.treatment_plan ?? pmDxRes.data?.treatment_plan) as unknown

// Derive sites[] from the IV/PE treatment_plan. PM-first, then IV; deduped by
// (label, laterality). When the plan yields zero injection candidates, fall
// back to the legacy intake-body-region path so cases without a finalized
// plan still get useful defaults.
const pmCandidates = parsePmTreatmentPlan(pmTreatmentPlanRaw)
const ivCandidates = parseInitialVisitTreatmentPlan(ivTreatmentPlanText)
let sites: ProcedureSite[] = sitesFromPlan(pmCandidates, ivCandidates)

if (sites.length === 0) {
  // Fallback: legacy intake chief_complaints body_region derivation.
  const complaints = preferredIvn?.provider_intake?.chief_complaints?.complaints ?? []
  const parsed = complaints
    .filter((c) => c.body_region && c.body_region.trim() !== '')
    .map((c) => parseBodyRegion(c.body_region))
    .filter((p) => p.injection_site !== '')

  const seen = new Set<string>()
  for (const p of parsed) {
    const key = `${p.injection_site}|${p.laterality ?? 'null'}`
    if (seen.has(key)) continue
    seen.add(key)
    sites.push({
      label: p.injection_site,
      laterality: p.laterality,
      volume_ml: null,
      target_confirmed_imaging: null,
    })
  }
}
```

Update the surrounding comment (currently at line 506-509) to reflect the new ordering: "Derive sites[] from PM/IV treatment_plan; fall back to intake chief complaints when no plan is on file."

#### 4. Imports
**File**: `src/actions/procedures.ts`
**Changes**: Add the two new named imports.

```ts
import {
  parsePmTreatmentPlan,
  parseInitialVisitTreatmentPlan,
} from '@/lib/procedures/compute-plan-alignment'
import { sitesFromPlan } from '@/lib/procedures/sites-from-plan'
```

`parseBodyRegion` import stays — still used in the fallback branch.

#### 5. Update `ProcedureDefaults` interface comment
**File**: `src/actions/procedures.ts`
**Changes**: At [procedures.ts:416-417](src/actions/procedures.ts#L416-L417), update the doc comment above `ProcedureDefaults` to reflect the new source.

```ts
// Defaults for pre-populating new procedure dialog. sites[] comes from the
// IV/PE treatment_plan (PM extraction jsonb + IV note narrative) when
// available, falling back to intake chief_complaints when no plan is on
// file. Other fields come from per-anatomy procedure_defaults table lookup.
```

### Success Criteria:

#### Automated Verification:
- [x] Type check passes: `npx tsc --noEmit`
- [x] Lint passes: `npm run lint`
- [x] Adapter tests still pass: `npx vitest run src/lib/procedures/sites-from-plan.test.ts`
- [x] Alignment tests still pass: `npx vitest run src/lib/procedures/compute-plan-alignment.test.ts`
- [x] Full suite: `npx vitest run`
- [x] App builds: `npm run build`

#### Manual Verification:
- [ ] Open the procedures page for a case with an approved PM extraction whose `treatment_plan` contains a single PRP injection item (e.g. `body_region: 'lumbar'`, no levels). Click "Record PRP Procedure". Verify the sites editor pre-fills with one row labeled `"Lumbar"`. Intake `chief_complaints` for that case should NOT influence the defaults.
- [ ] Open the procedures page for a case with an IV note whose `treatment_plan` text reads "Plan to proceed with PRP injection at L4-L5 and L5-S1 under ultrasound guidance." Verify the sites editor pre-fills with two rows: `"L4-L5"` and `"L5-S1"`.
- [ ] Open the procedures page for a case with BOTH a PM extraction calling for lumbar PRP at L4-L5 AND an IV note calling for the same level. Verify only one site row is pre-filled (PM wins, IV duplicate dropped).
- [ ] Open the procedures page for a case with PM extraction whose `treatment_plan` lists only physical therapy + medications (no injection items) AND no IV `treatment_plan`. Verify the sites editor falls back to intake body regions exactly as before.
- [ ] Open the procedures page for a case with a PM extraction whose `provider_overrides.treatment_plan` has been edited to add an injection item that the raw `treatment_plan` does not contain. Verify the override is used (the new injection item appears in defaults).
- [ ] Verify the per-anatomy `procedure_defaults` lookup (needle gauge, injection volume, etc.) still resolves correctly when the plan-derived sites all share a single anatomy (e.g. all lumbar level codes → `singleAnatomyFromSites` returns `lumbar` → defaults loaded).
- [ ] Verify a multi-anatomy case (cervical + lumbar plan) leaves the per-anatomy defaults at `null` (matching current multi-anatomy behavior).
- [ ] Confirm the procedure note generation flow (separate page) is unaffected — open an existing procedure, regenerate the note, verify `planAlignment` runs as before with no changes to the narrative.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to Phase 4.

---

## Phase 4: End-to-end smoke + regression check

### Overview
Cross-feature regression sweep. No code edits expected; only verification that no related surface broke.

### Changes Required:
None expected. If any check fails, file findings and return to Phase 3.

### Success Criteria:

#### Automated Verification:
- [x] Full suite: `npx vitest run`
- [x] Type check: `npx tsc --noEmit`
- [x] Lint: `npm run lint`
- [x] Build: `npm run build`

#### Manual Verification:
- [ ] Record a new procedure end-to-end on a plan-driven case; confirm the saved `procedures.sites` jsonb column matches what the dialog displayed (no shape regression in the form submission path — `createPrpProcedure` at [procedures.ts:117-125](src/actions/procedures.ts#L117-L125) reads `values.sites` directly).
- [ ] Generate the procedure note for that procedure; confirm `planAlignment` classifies as `aligned` when defaults were taken from the plan and the provider did not modify them in the dialog.
- [ ] Open a case with no IV note and no PM extraction; confirm the sites editor opens empty (no fallback data available) and submission still works once the provider adds sites manually.
- [ ] Open the existing per-site volume narration sibling plan flow (sibling plan: `thoughts/shared/plans/2026-04-26-prp-per-site-volume-narration.md`) — if that plan has shipped, confirm a multi-site procedure created via plan-derived defaults still narrates correctly under the prompt rule.

---

## Testing Strategy

### Unit Tests:
- New `src/lib/procedures/sites-from-plan.test.ts` (Phase 2) — covers level expansion, region fallback, dedupe (case-insensitive), PM-first ordering, multi-region union, null-laterality keying, multi-word title-casing.
- Existing `src/lib/procedures/compute-plan-alignment.test.ts` must continue to pass byte-for-byte after Phase 1's `export` change.

### Integration Tests:
- None required. `getProcedureDefaults` has no existing test file and adding one would require Supabase client mocking that the codebase does not use elsewhere for action functions. Manual verification covers the wiring.

### Manual Testing Steps:
See Phase 3 manual checklist above. Key matrix:

| Case shape | Expected sites source |
|---|---|
| PM injection plan with `body_region` only | Plan (one site per body_region) |
| PM injection plan with `target_levels` | Plan (one site per level) |
| IV note `treatment_plan` text mentions PRP at levels | Plan (level-extracted from prose) |
| Both PM + IV mention same level | Plan, deduped (PM wins) |
| Both PM + IV mention different regions | Plan, both kept |
| PM has only therapy/medication items, IV plan is empty | Intake fallback |
| No PM extraction, no IV note | Empty sites |
| PM `provider_overrides.treatment_plan` differs from raw | Overrides used |

## Performance Considerations

Negligible. The PM and IV queries already run; we only widen their `select` lists by 1-2 columns. No extra round trips. Adapter is O(N) over candidates (typically <10 items per case). No new Claude calls, no new DB writes.

## Migration Notes

None. Behavior change is per-call only; no persisted data shape changes. Existing procedures already saved with intake-derived sites are unaffected (this code only runs when populating a new dialog). If a provider opens "Record Procedure" on an existing case after this ships, they will see plan-derived defaults instead of intake-derived defaults — the previously-recorded procedures stay as they were saved.

## References

- Research: `thoughts/shared/research/2026-04-26-prp-volume-multi-site-documentation.md` (note: research is stale — codebase already moved to `sites: ProcedureSite[]` array model; current `injection_site` text column is now derived via `injectionSiteFromSites(sites)` at [src/lib/procedures/sites-helpers.ts:39](src/lib/procedures/sites-helpers.ts#L39)).
- Sibling plan (do not modify): `thoughts/shared/plans/2026-04-26-prp-per-site-volume-narration.md` — per-site volume narration in the procedure note prompt.
- Existing parsers to reuse: [src/lib/procedures/compute-plan-alignment.ts:179-234](src/lib/procedures/compute-plan-alignment.ts#L179-L234).
- Existing PM-overrides precedence pattern to mirror: [src/actions/procedure-notes.ts:445-447](src/actions/procedure-notes.ts#L445-L447).
- Code site to edit: [src/actions/procedures.ts:445-585](src/actions/procedures.ts#L445-L585).
- `ProcedureSite` schema: [src/lib/procedures/sites-helpers.ts:3-10](src/lib/procedures/sites-helpers.ts#L3-L10).
- PM `treatment_plan` jsonb shape: [src/lib/claude/extract-pain-management.ts:124-141](src/lib/claude/extract-pain-management.ts#L124-L141).
