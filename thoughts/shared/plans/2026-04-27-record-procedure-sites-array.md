# Record Procedure — Sites Array (A1+A2+A3) Implementation Plan

## Overview

Replace single free-text `injection_site` + scalar `laterality` + scalar `injection_volume_ml` with a structured `sites jsonb` array on `procedures`. Each site row carries `{label, laterality, volume_ml, target_confirmed_imaging}`. Drop top-level `laterality` column. Keep top-level `injection_site` text + `injection_volume_ml` numeric as **denormalized** columns (write-time computed from `sites[]`) so the ~13 downstream readers (PDF, billing, plan-alignment, discharge LLM, procedure-table, procedure-note-editor, generate-procedure-note input shape) keep working unchanged. Backfill existing rows in same migration.

Single bundled PR. Three logical features (A1 tag combobox, A2 per-site volume, A3 per-site laterality) ship together.

## Current State Analysis

[src/components/procedures/record-procedure-dialog.tsx:372-384](src/components/procedures/record-procedure-dialog.tsx#L372-L384) renders `injection_site` as free-text `<Input>` placeholder `"e.g. Knee, Shoulder"`. Multi-site = comma-joined string. Three downstream parsers reconstruct structure with divergent grammars:

- [src/lib/procedures/parse-body-region.ts:6](src/lib/procedures/parse-body-region.ts#L6) — single-region only
- [src/lib/procedures/compute-plan-alignment.ts:81](src/lib/procedures/compute-plan-alignment.ts#L81) — vertebral-level regex
- [src/actions/billing.ts:23-30](src/actions/billing.ts#L23-L30) — `,;/&+ and` splitter for invoice quantity

Volumes are scalar: one `injection_volume_ml`, one `target_confirmed_imaging`. Laterality is scalar enum `'left' | 'right' | 'bilateral'`. `getProcedureDefaults` at [src/actions/procedures.ts:445-473](src/actions/procedures.ts#L445-L473) collapses mixed left+right intake to `'bilateral'` (semantic fudge). LLM prompt at [src/lib/claude/generate-procedure-note.ts:506-522](src/lib/claude/generate-procedure-note.ts#L506-L522) (`PER-SITE VOLUME ALLOCATION RULE`) instructs Claude to narrate per-site without numeric mL because chart can't back the claim.

Reference research: [thoughts/shared/research/2026-04-27-record-procedure-dialog-inputs-improvements.md](thoughts/shared/research/2026-04-27-record-procedure-dialog-inputs-improvements.md).

## Desired End State

After this plan ships:

1. `procedures.sites jsonb` non-null array, each element `{label: string, laterality: 'left'|'right'|'bilateral'|null, volume_ml: number|null, target_confirmed_imaging: boolean|null}`. Length ≥ 1.
2. `procedures.injection_site text` retained as denormalized `sites.map(s => labelWithLaterality(s)).join(', ')` (write-time). All existing readers continue to read this column unchanged.
3. `procedures.injection_volume_ml numeric` retained as denormalized `sum(sites.volume_ml)` when all per-site values entered, else provider-entered total. All existing readers unchanged.
4. `procedures.laterality text` column **dropped**. Five readers migrated to compute from `sites[]` via shared helper.
5. Dialog at [record-procedure-dialog.tsx](src/components/procedures/record-procedure-dialog.tsx) renders:
   - **Sites** field: tag combobox (mirroring [diagnosis-combobox.tsx](src/components/procedures/diagnosis-combobox.tsx) pattern). Tags from `SITE_CATALOG` static constant + intake-derived suggestions. Each selected tag becomes a row in a sub-section with: site label badge, laterality select (`L/R/Bilat`), `volume_ml` input (optional), `target_confirmed_imaging` checkbox.
   - **Total Injection Volume**: derived display when all per-site values entered (read-only sum); editable when ≥1 site has null `volume_ml` (provider enters total).
   - Top-level `laterality` enum dropdown removed.
6. zod schema [prp-procedure.ts](src/lib/validations/prp-procedure.ts) replaces `injection_site` + `laterality` with `sites: z.array(siteSchema).min(1)`. Cross-field refine: when all `sites[].volume_ml` non-null, `sum === injection_volume_ml`.
7. Existing rows backfilled: parse current `injection_site` string into `sites[]` using `countInjectionSites` grammar; each generated site inherits the row's existing `laterality` and `target_confirmed_imaging`; first site gets `volume_ml = injection_volume_ml`, rest `null`.
8. LLM prompt updated to consume `sites[]` directly when present; `PER-SITE VOLUME ALLOCATION RULE` narrates concrete per-site mL when provider-entered, falls back to today's qualitative wording when sites have null `volume_ml`.

### Verify:
- `npx tsc --noEmit` clean
- `npm run lint` clean
- `npx vitest run` all green (including new tests for sites array, helper, backfill)
- `npx supabase db push` applies migration
- Manual: record new multi-site procedure with per-site volumes; PDF + invoice + procedure-note all reflect structured data

### Key Discoveries:
- `DiagnosisCombobox` pattern at [src/components/procedures/diagnosis-combobox.tsx:43-233](src/components/procedures/diagnosis-combobox.tsx#L43-L233) uses Badge + Input + dropdown filter — direct model for sites combobox
- 5 readers consume `procedures.laterality`: [render-procedure-note-pdf.ts:128](src/lib/pdf/render-procedure-note-pdf.ts#L128), [render-procedure-consent-pdf.ts:83](src/lib/pdf/render-procedure-consent-pdf.ts#L83), [procedure-table.tsx:98](src/components/procedures/procedure-table.tsx#L98), [generate-discharge-note.ts:36](src/lib/claude/generate-discharge-note.ts#L36), [compute-plan-alignment.ts:241-248](src/lib/procedures/compute-plan-alignment.ts#L241-L248). Plus generate-procedure-note input shape consumes scalar `laterality`.
- `procedures.diagnoses jsonb` already exists ([src/types/database.ts:2272](src/types/database.ts#L2272)) — proven pattern for jsonb on this table
- Migration history shows `site_count integer` was added (`20260419_procedures_site_count.sql`) then dropped (`20260420_drop_procedures_site_count.sql`) — site count had been considered as scalar but pulled. jsonb structured storage is correct level of granularity.
- Existing finalized procedure notes are stored as separate rendered text in `procedure_notes` table — they do NOT regenerate from current `procedures` row, so backfill of `procedures` is safe for historical notes.

## What We're NOT Doing

- **No B1 (per-anatomy `procedure_defaults` table).** Catalog is static `SITE_CATALOG` constant. Future B1 work swaps the import.
- **No B2 (`target_structure` field).** Out of scope.
- **No C1/C2 (needle_gauge / anesthetic enum).** Free text stays.
- **No C3 (consent gate).** Out of scope.
- **No C4 (`procedure_type` selector for non-PRP).** PRP-only dialog stays.
- **No billing logic change** beyond what's needed for column compatibility. `countInjectionSites` keeps working on the denormalized `injection_site` string. CPT composite at [billing.ts:262](src/actions/billing.ts#L262) unchanged.
- **No parser unification.** `parseBodyRegion`, `extractLevels`, `countInjectionSites` keep their grammars; A1 just feeds them well-formed input.
- **No PDF template visual redesign.** PDFs continue to render the denormalized `injection_site` string. Per-site detail rendering deferred.
- **No procedure-note re-generation of existing finalized notes.** Old finalized notes preserved as-is on disk.
- **No retroactive invoice migration.** Existing invoice rows untouched.

## Implementation Approach

Single phase, single bundled PR, single migration. Order of edits inside the PR:

1. Migration (schema + backfill in one file)
2. Generated types refresh
3. zod schema + new helper modules (`sites-helpers.ts` for `lateralityFromSites`, `labelWithLaterality`, `sitesFromLegacyString`)
4. Server action `createPrpProcedure` / `updatePrpProcedure` write paths (compute denormalized columns from `sites[]`)
5. Server action `getProcedureDefaults` (return `sites[]` instead of `injection_site` + `laterality`)
6. Form: replace site/laterality/volume FormFields with `SitesEditor` sub-component
7. 5 reader migrations to `lateralityFromSites` helper
8. LLM prompt update + input-shape pass-through
9. Tests at each layer

Testing strategy: backfill migration runs locally first via `npx supabase db reset`; assert pre/post row counts and a hand-picked sample row. Helpers + zod refines unit-tested. SitesEditor + form tested via existing `vitest` patterns. LLM prompt change tested via `capturePrompt` pattern at [src/lib/claude/__tests__/generate-procedure-note.test.ts:164-196](src/lib/claude/__tests__/generate-procedure-note.test.ts#L164-L196).

---

## Phase 1: Sites Array — Schema, Form, Readers, Prompt

### Overview
All A1+A2+A3 changes in one phase. Migration backfills existing rows. Top-level `laterality` column dropped. All readers migrated. New SitesEditor UI + zod schema + LLM prompt update.

### Changes Required:

#### 1. Migration — schema + backfill + drop laterality

**File**: `supabase/migrations/20260502_procedures_sites_array.sql` (new)

**Changes**:
- Add `sites jsonb not null default '[]'::jsonb` with check `jsonb_typeof(sites) = 'array'`
- Backfill from existing `injection_site` + `laterality` + `injection_volume_ml` + `target_confirmed_imaging`
- Add check `jsonb_array_length(sites) >= 1` (deferred until backfill complete)
- Drop `laterality` column

```sql
-- Add sites column (nullable during backfill)
alter table public.procedures
  add column sites jsonb not null default '[]'::jsonb;

-- Backfill: split existing injection_site by ,;/&+ or " and " grammar
-- (mirrors countInjectionSites in src/actions/billing.ts:23-30).
-- First site inherits row's injection_volume_ml + target_confirmed_imaging;
-- subsequent sites get volume_ml=null, target_confirmed_imaging=null.
-- All sites inherit row's laterality.
update public.procedures
set sites = (
  with parts as (
    select
      trim(part) as label,
      ord
    from regexp_split_to_table(
      coalesce(injection_site, ''),
      '\s*(?:,|;|/|&|\+|\s+and\s+)\s*'
    ) with ordinality as t(part, ord)
    where trim(part) <> ''
  ),
  enriched as (
    select
      jsonb_build_object(
        'label', label,
        'laterality', laterality,
        'volume_ml', case when ord = 1 then injection_volume_ml else null end,
        'target_confirmed_imaging', case when ord = 1 then target_confirmed_imaging else null end
      ) as site
    from parts
  )
  select coalesce(jsonb_agg(site), '[]'::jsonb) from enriched
)
where deleted_at is null;

-- Rows with empty injection_site (shouldn't exist due to NOT NULL form schema,
-- but defensive): give them a single placeholder site so length >= 1 holds
update public.procedures
set sites = jsonb_build_array(jsonb_build_object(
  'label', coalesce(injection_site, '[unspecified]'),
  'laterality', laterality,
  'volume_ml', injection_volume_ml,
  'target_confirmed_imaging', target_confirmed_imaging
))
where jsonb_array_length(sites) = 0
  and deleted_at is null;

-- Enforce non-empty array now that backfill is done
alter table public.procedures
  add constraint procedures_sites_nonempty
  check (jsonb_array_length(sites) >= 1);

-- Drop top-level laterality (readers migrated to lateralityFromSites helper
-- in same PR)
alter table public.procedures
  drop column laterality;
```

**Verification**: After applying, sample query
```sql
select id, injection_site, sites from procedures where deleted_at is null limit 5;
```
should show structured arrays matching the comma-joined `injection_site`.

#### 2. Regenerate database types

**File**: `src/types/database.ts` (regenerated)

**Command**: `npx supabase gen types typescript --local > src/types/database.ts`

After regen: `procedures.sites: Json` column added; `procedures.laterality` removed.

#### 3. New helper module

**File**: `src/lib/procedures/sites-helpers.ts` (new)

```ts
import { z } from 'zod'

export const procedureSiteSchema = z.object({
  label: z.string().min(1, 'Site label is required'),
  laterality: z.enum(['left', 'right', 'bilateral']).nullable(),
  volume_ml: z.number().positive().nullable(),
  target_confirmed_imaging: z.boolean().nullable(),
})

export type ProcedureSite = z.infer<typeof procedureSiteSchema>

// Compute a single laterality value from a sites[] array.
// - all sites same laterality → that value
// - mixed lateralities → 'mixed'
// - all null → null
export function lateralityFromSites(
  sites: ProcedureSite[],
): 'left' | 'right' | 'bilateral' | 'mixed' | null {
  const set = new Set(sites.map((s) => s.laterality))
  set.delete(null as unknown as 'left')
  if (set.size === 0) return null
  if (set.size === 1) return [...set][0] as 'left' | 'right' | 'bilateral'
  return 'mixed'
}

// "Right Knee", "Bilateral Knee", "Knee" (no laterality), etc.
// Used to compose denormalized procedures.injection_site string.
export function labelWithLaterality(s: ProcedureSite): string {
  if (!s.laterality) return s.label
  const lat =
    s.laterality === 'left' ? 'Left' :
    s.laterality === 'right' ? 'Right' : 'Bilateral'
  return `${lat} ${s.label}`
}

// Denormalize: comma-joined string for legacy injection_site column.
export function injectionSiteFromSites(sites: ProcedureSite[]): string {
  return sites.map(labelWithLaterality).join(', ')
}

// Denormalize: derive total volume. When every site has volume_ml, returns
// the sum. When any site is null, returns the explicit total (caller
// supplies it — e.g. provider-entered).
export function totalVolumeFromSites(
  sites: ProcedureSite[],
  fallbackTotal: number | null,
): number | null {
  if (sites.length === 0) return fallbackTotal
  if (sites.every((s) => s.volume_ml !== null)) {
    return sites.reduce((acc, s) => acc + (s.volume_ml ?? 0), 0)
  }
  return fallbackTotal
}

// Parse a legacy comma-joined injection_site string into structured sites.
// Used by getProcedureDefaults for back-compat consumption from intake;
// mirrors the SQL backfill grammar.
export function sitesFromLegacyString(
  injectionSite: string | null,
  laterality: 'left' | 'right' | 'bilateral' | null,
): ProcedureSite[] {
  if (!injectionSite) return []
  const parts = injectionSite
    .split(/,|;|\/|&|\+|\s+and\s+/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  return parts.map((label) => ({
    label,
    laterality,
    volume_ml: null,
    target_confirmed_imaging: null,
  }))
}
```

**File**: `src/lib/procedures/__tests__/sites-helpers.test.ts` (new)

```ts
import { describe, it, expect } from 'vitest'
import {
  lateralityFromSites,
  labelWithLaterality,
  injectionSiteFromSites,
  totalVolumeFromSites,
  sitesFromLegacyString,
} from '../sites-helpers'

describe('lateralityFromSites', () => {
  it('returns single value when all sites match', () => {
    expect(lateralityFromSites([
      { label: 'L4-L5', laterality: 'left', volume_ml: null, target_confirmed_imaging: null },
      { label: 'L5-S1', laterality: 'left', volume_ml: null, target_confirmed_imaging: null },
    ])).toBe('left')
  })
  it("returns 'mixed' for divergent lateralities", () => {
    expect(lateralityFromSites([
      { label: 'Knee', laterality: 'right', volume_ml: null, target_confirmed_imaging: null },
      { label: 'Shoulder', laterality: 'left', volume_ml: null, target_confirmed_imaging: null },
    ])).toBe('mixed')
  })
  it('returns null when all lateralities are null', () => {
    expect(lateralityFromSites([
      { label: 'Hip', laterality: null, volume_ml: null, target_confirmed_imaging: null },
    ])).toBeNull()
  })
})

describe('injectionSiteFromSites', () => {
  it('comma-joins with laterality prefixes', () => {
    expect(injectionSiteFromSites([
      { label: 'Knee', laterality: 'right', volume_ml: null, target_confirmed_imaging: null },
      { label: 'Shoulder', laterality: 'left', volume_ml: null, target_confirmed_imaging: null },
    ])).toBe('Right Knee, Left Shoulder')
  })
})

describe('totalVolumeFromSites', () => {
  it('sums per-site volumes when all entered', () => {
    expect(totalVolumeFromSites([
      { label: 'A', laterality: null, volume_ml: 3, target_confirmed_imaging: null },
      { label: 'B', laterality: null, volume_ml: 4, target_confirmed_imaging: null },
    ], null)).toBe(7)
  })
  it('returns fallback when any site has null volume', () => {
    expect(totalVolumeFromSites([
      { label: 'A', laterality: null, volume_ml: 3, target_confirmed_imaging: null },
      { label: 'B', laterality: null, volume_ml: null, target_confirmed_imaging: null },
    ], 6)).toBe(6)
  })
})

describe('sitesFromLegacyString', () => {
  it('splits comma-joined sites and inherits laterality', () => {
    const sites = sitesFromLegacyString('L4-L5, L5-S1', 'bilateral')
    expect(sites).toHaveLength(2)
    expect(sites[0]).toMatchObject({ label: 'L4-L5', laterality: 'bilateral', volume_ml: null })
  })
  it('handles slash separator', () => {
    expect(sitesFromLegacyString('L4-L5/L5-S1', null)).toHaveLength(2)
  })
})
```

#### 4. Static site catalog

**File**: `src/lib/procedures/site-catalog.ts` (new)

```ts
// Static catalog used by the SitesEditor combobox. Future work (B1) will
// replace this constant with a DB-backed fetch from procedure_defaults.
const JOINTS = ['Knee', 'Shoulder', 'Hip', 'Ankle', 'Elbow', 'Wrist', 'Sacroiliac Joint'] as const
const SPINE_REGIONS = ['Cervical Facet', 'Thoracic Facet', 'Lumbar Facet'] as const

function generateVertebralLevels(): string[] {
  const levels: string[] = []
  for (let i = 2; i <= 7; i++) levels.push(`C${i}-C${i + 1 > 7 ? 'T1' : i + 1}`)
  for (let i = 1; i <= 11; i++) levels.push(`T${i}-T${i + 1 > 12 ? 'L1' : i + 1}`)
  for (let i = 1; i <= 4; i++) levels.push(`L${i}-L${i + 1}`)
  levels.push('L5-S1')
  return levels
}

export const SITE_CATALOG: readonly string[] = [
  ...JOINTS,
  ...SPINE_REGIONS,
  ...generateVertebralLevels(),
] as const
```

#### 5. zod schema — replace injection_site/laterality/injection_volume_ml

**File**: `src/lib/validations/prp-procedure.ts`

**Changes**: Remove top-level `injection_site` and `laterality`. Replace `injection.injection_volume_ml` with required total + optional per-site sum cross-refine. Add `sites` array.

```ts
import { z } from 'zod'
import { procedureSiteSchema } from '@/lib/procedures/sites-helpers'

const diagnosisSchema = z.object({ /* unchanged */ })
const vitalSignsSchema = /* unchanged */

const prpPreparationSchema = /* unchanged */

const anesthesiaSchema = /* unchanged */

const injectionSchema = z.object({
  injection_volume_ml: z.number().positive('Total injection volume is required'),
  needle_gauge: z.string().optional(),
  guidance_method: z.enum(['ultrasound', 'fluoroscopy', 'landmark']),
  // Removed: target_confirmed_imaging (now per-site on procedureSiteSchema)
})

const postProcedureSchema = /* unchanged */

export const prpProcedureFormSchema = (opts?: { earliestDate?: string | null }) =>
  z.object({
    procedure_date: /* unchanged */,
    sites: z.array(procedureSiteSchema).min(1, 'At least one site is required'),
    diagnoses: z.array(diagnosisSchema).min(1, 'At least one diagnosis is required'),
    consent_obtained: z.boolean(),
    vital_signs: vitalSignsSchema,
    prp_preparation: prpPreparationSchema,
    anesthesia: anesthesiaSchema,
    injection: injectionSchema,
    post_procedure: postProcedureSchema,
    plan_deviation_reason: z.string().optional(),
  }).superRefine((data, ctx) => {
    // When every site has a volume_ml, sum must equal total
    const allHaveVolume = data.sites.every((s) => s.volume_ml !== null)
    if (allHaveVolume) {
      const sum = data.sites.reduce((a, s) => a + (s.volume_ml ?? 0), 0)
      // Allow 0.1 mL tolerance for float rounding
      if (Math.abs(sum - data.injection.injection_volume_ml) > 0.1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Per-site volumes sum to ${sum.toFixed(1)} mL; total is ${data.injection.injection_volume_ml.toFixed(1)} mL. Adjust per-site values or the total.`,
          path: ['injection', 'injection_volume_ml'],
        })
      }
    }
  })

export type PrpProcedureFormValues = z.infer<ReturnType<typeof prpProcedureFormSchema>>
// Removed: PrpDiagnosis stays; old laterality/site types removed
```

**File**: `src/lib/validations/__tests__/prp-procedure.test.ts`

**Changes**: Remove tests for `injection_site` / scalar `laterality`. Add tests for `sites` array, sum-vs-total refine, single-site happy path.

#### 6. `createPrpProcedure` / `updatePrpProcedure` write path

**File**: `src/actions/procedures.ts`

**Changes**: Insert payload writes `sites` jsonb + denormalized `injection_site`. No more `laterality` column. `injection_volume_ml` comes from form (provider-entered total); helper validates per-site sum.

```ts
import {
  injectionSiteFromSites,
  totalVolumeFromSites,
  sitesFromLegacyString,
} from '@/lib/procedures/sites-helpers'

// Inside createPrpProcedure (replaces lines 103-141):
const denormalizedInjectionSite = injectionSiteFromSites(values.sites)

const { data: procedure, error: procError } = await supabase
  .from('procedures')
  .insert({
    case_id: caseId,
    procedure_date: values.procedure_date,
    procedure_name: 'PRP Injection',
    injection_site: denormalizedInjectionSite,
    sites: values.sites,                      // NEW
    diagnoses: values.diagnoses,
    consent_obtained: values.consent_obtained,
    procedure_number: procedureNumber,
    blood_draw_volume_ml: values.prp_preparation.blood_draw_volume_ml,
    centrifuge_duration_min: values.prp_preparation.centrifuge_duration_min,
    prep_protocol: values.prp_preparation.prep_protocol || null,
    kit_lot_number: values.prp_preparation.kit_lot_number || null,
    anesthetic_agent: values.anesthesia.anesthetic_agent,
    anesthetic_dose_ml: values.anesthesia.anesthetic_dose_ml,
    patient_tolerance: values.anesthesia.patient_tolerance,
    injection_volume_ml: values.injection.injection_volume_ml,  // total
    needle_gauge: values.injection.needle_gauge || null,
    guidance_method: values.injection.guidance_method,
    // Removed: laterality, target_confirmed_imaging (both per-site now)
    complications: values.post_procedure.complications,
    supplies_used: values.post_procedure.supplies_used || null,
    compression_bandage: values.post_procedure.compression_bandage,
    activity_restriction_hrs: values.post_procedure.activity_restriction_hrs,
    plan_deviation_reason: values.plan_deviation_reason?.trim() || null,
    created_by_user_id: user.id,
    updated_by_user_id: user.id,
  })
  .select()
  .single()
```

`updatePrpProcedure` mirrors. Add `target_confirmed_imaging` column drop in migration too — it's now per-site.

**Migration addition** in `20260502_procedures_sites_array.sql`:
```sql
alter table public.procedures drop column target_confirmed_imaging;
```
(after backfill writes its value into `sites[0]`).

#### 7. `getProcedureDefaults` — return `sites[]` instead of scalar

**File**: `src/actions/procedures.ts:387-492`

**Changes**: `ProcedureDefaults` interface returns `sites: ProcedureSite[]` instead of `injection_site` + `laterality`. Build sites from intake chief complaints (one site per non-empty body_region). UI consumes directly.

```ts
import type { ProcedureSite } from '@/lib/procedures/sites-helpers'

export interface ProcedureDefaults {
  sites: ProcedureSite[]
  vital_signs: { /* unchanged */ }
  earliest_procedure_date: string | null
}

export async function getProcedureDefaults(caseId: string): Promise<{ data: ProcedureDefaults }> {
  // ...vitals + ivnRows fetch unchanged...

  const complaints = preferredIvn?.provider_intake?.chief_complaints?.complaints ?? []
  const sites: ProcedureSite[] = complaints
    .filter((c) => c.body_region && c.body_region.trim() !== '')
    .map((c) => parseBodyRegion(c.body_region))
    .filter((p) => p.injection_site !== '')
    .map((p) => ({
      label: p.injection_site,
      laterality: p.laterality,
      volume_ml: null,
      target_confirmed_imaging: null,
    }))
  // dedupe by (label, laterality)
  const seen = new Set<string>()
  const dedupedSites = sites.filter((s) => {
    const k = `${s.label}|${s.laterality ?? 'null'}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  return {
    data: {
      sites: dedupedSites,
      vital_signs: { /* unchanged */ },
      earliest_procedure_date,
    },
  }
}
```

#### 8. `ProcedureInitialData` interface + dialog edit-mode wiring

**File**: `src/components/procedures/record-procedure-dialog.tsx:83-116`

**Changes**: Remove `injection_site`, `laterality`, `injection_volume_ml`, `target_confirmed_imaging` from `ProcedureInitialData`. Add `sites: ProcedureSite[]`.

```ts
export interface ProcedureInitialData {
  id: string
  procedure_date: string
  sites: ProcedureSite[]                    // NEW
  diagnoses: unknown
  consent_obtained: boolean | null
  blood_draw_volume_ml: number | null
  centrifuge_duration_min: number | null
  prep_protocol: string | null
  kit_lot_number: string | null
  anesthetic_agent: string | null
  anesthetic_dose_ml: number | null
  patient_tolerance: string | null
  injection_volume_ml: number | null        // total stays
  needle_gauge: string | null
  guidance_method: string | null
  // Removed: injection_site, laterality, target_confirmed_imaging
  complications: string | null
  supplies_used: string | null
  compression_bandage: boolean | null
  activity_restriction_hrs: number | null
  plan_deviation_reason: string | null
  _vitals?: { /* unchanged */ } | null
}
```

The page that loads initialData ([src/app/(dashboard)/patients/[caseId]/procedures/[procedureId]/edit/page.tsx](src/app/(dashboard)/patients/[caseId]/procedures/[procedureId]/edit/page.tsx)) — locate, update select to include `sites` jsonb, drop scalar fields.

#### 9. SitesEditor sub-component (new)

**File**: `src/components/procedures/sites-editor.tsx` (new)

Mirrors `DiagnosisCombobox` pattern: tag input + suggestions dropdown, but each "selected" tag expands into a row with laterality select, volume input, imaging-confirmed checkbox.

```tsx
'use client'

import { useState, useRef } from 'react'
import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { SITE_CATALOG } from '@/lib/procedures/site-catalog'
import type { ProcedureSite } from '@/lib/procedures/sites-helpers'

interface SitesEditorProps {
  value: ProcedureSite[]
  onChange: (v: ProcedureSite[]) => void
  intakeSuggestions: string[]   // labels from getProcedureDefaults
}

export function SitesEditor({ value, onChange, intakeSuggestions }: SitesEditorProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedLabels = new Set(value.map((s) => s.label.toLowerCase()))
  // Suggestions = intake first, then catalog. Filter by query and dedupe against selected.
  const all = [...new Set([...intakeSuggestions, ...SITE_CATALOG])]
  const filtered = all.filter((label) => {
    if (selectedLabels.has(label.toLowerCase())) return false
    if (!query) return true
    return label.toLowerCase().includes(query.toLowerCase())
  })
  const showAddOption = query.trim() !== '' && !selectedLabels.has(query.trim().toLowerCase())

  function addSite(label: string) {
    onChange([
      ...value,
      { label, laterality: null, volume_ml: null, target_confirmed_imaging: null },
    ])
    setQuery('')
    inputRef.current?.focus()
  }

  function removeSite(idx: number) {
    onChange(value.filter((_, i) => i !== idx))
  }

  function updateSite(idx: number, patch: Partial<ProcedureSite>) {
    onChange(value.map((s, i) => i === idx ? { ...s, ...patch } : s))
  }

  return (
    <div className="space-y-3">
      {/* Combobox */}
      <div className="relative">
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (filtered.length === 1) addSite(filtered[0])
              else if (showAddOption) addSite(query.trim())
            }
          }}
          placeholder="Add a site (e.g. Knee, L4-L5, Shoulder)"
          autoComplete="off"
        />
        {open && (filtered.length > 0 || showAddOption) && (
          <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
            <ul className="max-h-48 overflow-auto py-1 text-sm">
              {filtered.slice(0, 50).map((label) => (
                <li key={label}>
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); addSite(label) }}
                    className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-accent"
                  >
                    {label}
                  </button>
                </li>
              ))}
              {showAddOption && (
                <li>
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); addSite(query.trim()) }}
                    className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-accent text-xs"
                  >
                    Add &ldquo;{query.trim()}&rdquo;
                  </button>
                </li>
              )}
            </ul>
          </div>
        )}
      </div>

      {/* Per-site rows */}
      {value.length > 0 && (
        <div className="space-y-2">
          {value.map((site, idx) => (
            <div key={`${site.label}-${idx}`} className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Badge variant="secondary">{site.label}</Badge>
                <button
                  type="button"
                  onClick={() => removeSite(idx)}
                  aria-label={`Remove ${site.label}`}
                  className="rounded-full hover:bg-muted p-1"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground">Laterality</label>
                  <Select
                    value={site.laterality ?? ''}
                    onValueChange={(v) => updateSite(idx, {
                      laterality: v === '' ? null : (v as 'left' | 'right' | 'bilateral'),
                    })}
                  >
                    <SelectTrigger className="w-full"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="left">Left</SelectItem>
                      <SelectItem value="right">Right</SelectItem>
                      <SelectItem value="bilateral">Bilateral</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Volume (mL)</label>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="optional"
                    value={site.volume_ml ?? ''}
                    onChange={(e) => updateSite(idx, {
                      volume_ml: e.target.value === '' ? null : Number(e.target.value),
                    })}
                  />
                </div>
                <div className="flex items-end gap-2 pb-1">
                  <Checkbox
                    checked={site.target_confirmed_imaging ?? false}
                    onCheckedChange={(checked) => updateSite(idx, {
                      target_confirmed_imaging: checked === true ? true : null,
                    })}
                    id={`tci-${idx}`}
                  />
                  <label htmlFor={`tci-${idx}`} className="text-xs cursor-pointer">
                    Target confirmed on imaging
                  </label>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

#### 10. Wire SitesEditor into dialog

**File**: `src/components/procedures/record-procedure-dialog.tsx`

**Changes**:
- Replace [lines 348-370](src/components/procedures/record-procedure-dialog.tsx#L348-L370) (laterality select) — DELETE entirely
- Replace [lines 372-384](src/components/procedures/record-procedure-dialog.tsx#L372-L384) (injection_site Input) with `<SitesEditor>` FormField
- Replace [lines 660-680](src/components/procedures/record-procedure-dialog.tsx#L660-L680) (target_confirmed_imaging checkbox) — DELETE (now per-site)
- Modify [lines 599-619](src/components/procedures/record-procedure-dialog.tsx#L599-L619) (`injection_volume_ml` input): when all sites have `volume_ml`, show as read-only computed total; else editable. Use `useWatch` from react-hook-form.

```tsx
// Encounter section (around lines 348-402)
<FormField
  control={form.control}
  name="sites"
  render={({ field }) => (
    <FormItem>
      <FormLabel>Sites *</FormLabel>
      <FormControl>
        <SitesEditor
          value={field.value}
          onChange={field.onChange}
          intakeSuggestions={(procedureDefaults?.sites ?? []).map((s) => s.label)}
        />
      </FormControl>
      <FormDescription>
        Add each treated site. Per-site laterality and volume optional.
      </FormDescription>
      <FormMessage />
    </FormItem>
  )}
/>
```

```tsx
// Injection section — total volume input
const watchedSites = useWatch({ control: form.control, name: 'sites' })
const allSitesHaveVolume = watchedSites?.length > 0 && watchedSites.every((s) => s.volume_ml !== null)
const computedTotal = allSitesHaveVolume
  ? watchedSites.reduce((a, s) => a + (s.volume_ml ?? 0), 0)
  : null

// Auto-sync computed total → form total when in computed mode
useEffect(() => {
  if (computedTotal !== null) {
    form.setValue('injection.injection_volume_ml', computedTotal, { shouldValidate: true })
  }
}, [computedTotal, form])

// In JSX:
<FormField
  control={form.control}
  name="injection.injection_volume_ml"
  render={({ field }) => (
    <FormItem>
      <FormLabel>
        Total Injection Volume (mL) {allSitesHaveVolume ? '(computed)' : '*'}
      </FormLabel>
      <FormControl>
        <Input
          type="number"
          step="0.1"
          placeholder="mL"
          readOnly={allSitesHaveVolume}
          value={field.value ?? ''}
          onChange={(e) =>
            field.onChange(e.target.value === '' ? null : Number(e.target.value))
          }
        />
      </FormControl>
      {allSitesHaveVolume && (
        <FormDescription>Sum of per-site volumes.</FormDescription>
      )}
      <FormMessage />
    </FormItem>
  )}
/>
```

`STATIC_PROCEDURE_DEFAULTS` updates at [lines 65-70](src/components/procedures/record-procedure-dialog.tsx#L65-L70): drop `target_confirmed_imaging` from injection block (now per-site, default `null`).

Form `defaultValues` at [lines 200-277](src/components/procedures/record-procedure-dialog.tsx#L200-L277):
- Replace `injection_site`, `laterality` defaults with `sites` default: prefer `initialData.sites` (edit mode), else `procedureDefaults?.sites ?? []`.
- Drop `injection.target_confirmed_imaging` default (now lives per-site inside `sites`).

#### 11. Reader migrations — 5 files use `lateralityFromSites`

##### 11a. `src/lib/pdf/render-procedure-note-pdf.ts`

**Changes**: Line 45 select adds `sites`, removes `laterality`. Line 128 derives display laterality.

```ts
.select('procedure_date, procedure_name, procedure_number, injection_site, sites, diagnoses')
// ...
const sites = (procedure?.sites ?? []) as ProcedureSite[]
const lateralityDisplay = lateralityFromSites(sites) ?? '—'
return {
  injectionSite: procedure?.injection_site || '—',
  laterality: lateralityDisplay,
  // ...
}
```

##### 11b. `src/lib/pdf/render-procedure-consent-pdf.ts:76,83`

Same pattern. Select `sites` instead of `laterality`. Compute via helper.

##### 11c. `src/components/procedures/procedure-table.tsx:50,98`

Row type drops `laterality: string | null`, adds `sites: ProcedureSite[]`. Column accessor changes from `laterality` to a computed cell renderer using `lateralityFromSites(row.sites)`.

##### 11d. `src/lib/claude/generate-discharge-note.ts:30-46`

Input shape replaces `laterality: string | null` with `sites: ProcedureSite[]` on each procedures element. Prompt sections that reference `laterality` (line ~369 narrative) read from `sites[].laterality` array. Add helper formatting `formatProcedureSiteSummary(sites)` returning e.g. `"Right Knee, Left Shoulder"`. Discharge action that builds the input ([src/actions/discharge-notes.ts](src/actions/discharge-notes.ts)) — locate select, swap `laterality` → `sites`.

##### 11e. `src/lib/procedures/compute-plan-alignment.ts:44-45,241-248`

`PerformedProcedure` interface drops `laterality`, adds `sites`. `computeMismatches` derives effective performed laterality with `lateralityFromSites(performed.sites)`. When result is `'mixed'`, plan-alignment treats as null (no laterality mismatch fires for multi-site mixed — `'mixed'` is meta-state, not a comparable laterality).

#### 12. Generate-procedure-note prompt + input shape

**File**: `src/lib/claude/generate-procedure-note.ts:33-52` (input shape) + the `PER-SITE VOLUME ALLOCATION RULE` block at lines 506-522

**Changes**:
- Input shape: `procedureRecord` gains `sites: ProcedureSite[]`, drops `laterality`. Existing `injection_site` (denormalized) + `injection_volume_ml` (total) stay so prompt rules that reference them still work.
- Prompt rule update — when `sites[]` has any per-site `volume_ml` non-null, emit a concrete per-site number for those sites instead of qualitative wording. Forbidden-phrases guard stays for null per-site.

Add to the `PER-SITE VOLUME ALLOCATION RULE` block:

```
PER-SITE VOLUME — STRUCTURED INPUT (when procedureRecord.sites is provided): When site.volume_ml is non-null, the procedure_injection paragraph MUST report that exact mL for that site by name (e.g., "3 mL was injected at L4-L5 and 3 mL at L5-S1"). When site.volume_ml is null, fall back to the qualitative wording above ("with allocation calibrated to the pathology burden at each level"). NEVER fabricate a per-site number when site.volume_ml is null. The total injection_volume_ml continues to drive the "(N mL total)" parenthetical.
```

Caller ([src/actions/procedure-notes.ts](src/actions/procedure-notes.ts)) — locate where `procedureRecord` payload is constructed, add `sites` field.

**File**: `src/lib/claude/__tests__/generate-procedure-note.test.ts:164-196`

Add test cases: `capturePrompt(input)` with `procedureRecord.sites = [{label:'L4-L5', volume_ml:3, ...}, {label:'L5-S1', volume_ml:3, ...}]` asserts prompt instructs concrete per-site narration. With `sites[].volume_ml = null` asserts qualitative fallback.

#### 13. `parseBodyRegion` test stays unchanged

[src/lib/procedures/parse-body-region.test.ts](src/lib/procedures/parse-body-region.test.ts) — no changes. Helper still single-region; A1 just maps it over the array.

### Success Criteria:

#### Automated Verification:
- [x] Migration applies cleanly: `npx supabase db reset` (local) or `npx supabase db push` (remote)
- [x] Type check passes: `npx tsc --noEmit`
- [x] Lint passes: `npm run lint`
- [x] All tests pass: `npx vitest run` (891/891 passing)
- [x] New tests for `sites-helpers.ts` pass
- [x] Updated `prp-procedure.test.ts` passes (33/33)
- [x] Updated `generate-procedure-note.test.ts` passes
- [x] `compute-plan-alignment.test.ts` still green
- [ ] Backfill verification SQL: `select count(*) from procedures where jsonb_array_length(sites) = 0 and deleted_at is null;` → 0
- [ ] Backfill consistency SQL: `select count(*) from procedures where deleted_at is null and injection_site != (select string_agg(s->>'label', ', ') from jsonb_array_elements(sites) s);` shows zero rows where backfill produced label-only sites (note: actual check should account for laterality prefix in denormalized string for newly-edited rows; pre-edit rows have plain labels matching the original `injection_site`)

#### Manual Verification:
- [ ] Open Record Procedure dialog (no initialData) — Sites combobox empty; intake-derived suggestions appear in dropdown
- [ ] Type "L4" → catalog suggestions include `L4-L5`; click adds row with laterality select + volume input + imaging checkbox
- [ ] Add second site `L5-S1`. Total volume input becomes editable (not all sites have volume_ml)
- [ ] Enter volume `3` for L4-L5 and `3` for L5-S1. Total field becomes read-only and reads `6` (computed)
- [ ] Edit one per-site volume to `3.5`. Total recomputes to `6.5`
- [ ] Clear one per-site volume. Total field becomes editable again, retains last value
- [ ] Submit. Procedure record persists. Procedure table shows `injection_site = "L4-L5, L5-S1"` and `laterality` column shows derived value (or `'mixed'` / `—`)
- [ ] Generate procedure note. `procedure_injection` paragraph names both sites; when both have per-site volumes, concrete mL appears per site; when null, qualitative wording reads as before
- [ ] Open existing pre-migration procedure in edit mode. Sites array populated from backfill (one row per comma-split site). First site has the original `injection_volume_ml`; others null. All inherit the original laterality
- [ ] Generate consent PDF for new multi-site procedure. PDF treatment area still reads `injection_site` denormalized string
- [ ] Generate invoice for multi-site procedure. `countInjectionSites(injection_site)` still returns correct count → CPT `0232T` quantity correct
- [ ] Generate discharge note. Multi-procedure narrative reads `sites[]` and reports per-procedure site lists. Laterality references use `lateralityFromSites` output
- [ ] Plan-alignment: case with planned `[L4-L5, L5-S1]` and performed sites `[{label:'L4-L5'}, {label:'L5-S1'}]` shows `status='aligned'` (no `target_levels` mismatch)
- [ ] Plan-alignment: case with planned laterality `right` and `sites = [{laterality:'left'}, {laterality:'right'}]` — `lateralityFromSites` returns `'mixed'`, no laterality mismatch fires (mixed is incomparable)
- [ ] Plan-alignment: case with planned laterality `right` and `sites = [{laterality:'left'}]` (single site, single laterality) — laterality mismatch fires correctly

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before merging.

---

## Testing Strategy

### Unit Tests:
- `sites-helpers.test.ts` — `lateralityFromSites` 4 cases (single, all-same, mixed, all-null), `injectionSiteFromSites` (with + without laterality), `totalVolumeFromSites` (full + partial), `sitesFromLegacyString` (comma + slash + empty)
- `prp-procedure.test.ts` updated — sum-vs-total refine fires within 0.1 mL tolerance, single-site happy path, missing sites array rejected
- `generate-procedure-note.test.ts` extended — `capturePrompt` asserts new "PER-SITE VOLUME — STRUCTURED INPUT" rule text and the structured-vs-qualitative branch
- `compute-plan-alignment.test.ts` extended — `lateralityFromSites` returning `'mixed'` does not fire laterality mismatch

### Integration Tests:
- Existing tests in `src/actions/__tests__/discharge-notes-regenerate.test.ts` — verify they still pass; update fixtures to use `sites` array

### Manual Testing Steps:

See Phase 1 manual verification list. Key scenarios:
1. New multi-site procedure with all per-site volumes entered
2. New multi-site procedure with mixed laterality (Right Knee + Left Shoulder)
3. Edit pre-migration procedure (backfilled sites)
4. New single-site procedure — A2/A3 features hidden but functional
5. Generate procedure note for each — verify LLM consumes `sites[]` correctly
6. Generate invoice — verify quantity unchanged
7. Generate consent PDF — verify treatment area still renders

## Performance Considerations

- jsonb column adds ~50 bytes per procedure row for typical 1-3 sites. Negligible at expected volume.
- LLM input payload grows by `sites[]` array (~200 tokens/site). Total prompt size already several thousand tokens; immaterial.
- No new DB queries — `sites` selected alongside existing columns in same query.
- Backfill SQL is single-statement `update`. For a clinic with <10K finalized procedures, runs in seconds.

## Migration Notes

- Migration is **not** reversible without data loss. The dropped `laterality` column is recoverable from `sites[*].laterality` via the same helper logic, but `target_confirmed_imaging` becomes per-site only — rolling back would lose any per-site detail that diverges from the first site.
- Run order: schema add → backfill update → constraints add → drop columns. All in same migration file; runs as one transaction.
- Existing finalized procedure notes (in `procedure_notes` table) are not regenerated. Old notes keep their original narrative even though the source `procedures` row now has structured `sites[]`. Re-generating an old note will produce new narrative reflecting structured sites — provider can choose to do so manually.
- Existing invoices untouched. Old invoice line items keep their `quantity` value (which was computed from comma-split `injection_site`). New procedure invoices compute the same way — `countInjectionSites` still operates on the denormalized string.

## References

- Research: [thoughts/shared/research/2026-04-27-record-procedure-dialog-inputs-improvements.md](thoughts/shared/research/2026-04-27-record-procedure-dialog-inputs-improvements.md)
- Prior multi-site survey: [thoughts/shared/research/2026-04-26-prp-volume-multi-site-documentation.md](thoughts/shared/research/2026-04-26-prp-volume-multi-site-documentation.md)
- Prompt-only narration plan that shipped 3e4b5df: [thoughts/shared/plans/2026-04-26-prp-per-site-volume-narration.md](thoughts/shared/plans/2026-04-26-prp-per-site-volume-narration.md)
- Pattern to follow (combobox): [src/components/procedures/diagnosis-combobox.tsx:43-233](src/components/procedures/diagnosis-combobox.tsx#L43-L233)
- Pattern to follow (zod jsonb): existing `procedures.diagnoses` jsonb at [src/types/database.ts:2272](src/types/database.ts#L2272)
- Test pattern (capturePrompt): [src/lib/claude/__tests__/generate-procedure-note.test.ts:164-196](src/lib/claude/__tests__/generate-procedure-note.test.ts#L164-L196)
- Migration history (site_count add+drop precedent): [supabase/migrations/20260419_procedures_site_count.sql](supabase/migrations/20260419_procedures_site_count.sql), [supabase/migrations/20260420_drop_procedures_site_count.sql](supabase/migrations/20260420_drop_procedures_site_count.sql)
