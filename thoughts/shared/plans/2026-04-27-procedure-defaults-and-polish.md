# Procedure Defaults Table + Form Polish + Non-Spine Multi-Site Rule Implementation Plan

## Overview

Bundle of six features tackling the remaining compliance gaps from research [thoughts/shared/research/2026-04-27-record-procedure-dialog-inputs-improvements.md](thoughts/shared/research/2026-04-27-record-procedure-dialog-inputs-improvements.md):

- **B1** — `procedure_defaults` table keyed by `(anatomy_key, procedure_type)`. Replaces global `STATIC_PROCEDURE_DEFAULTS` block. Drives anatomy-specific needle gauge / volume / agent / CPT codes.
- **C4** — `procedures.procedure_type` column (`'prp' | 'cortisone' | 'hyaluronic'`, default `'prp'`). Schema-only; no UI selector this PR. Unblocks B1 lookup key.
- **C1** — `needle_gauge` enum (closed list, dropdown).
- **C2** — `anesthetic_agent` enum (closed list, dropdown).
- **B2** — `target_structure` column on `procedures` (single per-procedure choice). Removes LLM inference for legally-sensitive intradiscal vs. periarticular language.
- **C3** — Consent gate: block submit when `consent_obtained=false` without `plan_deviation_reason`.
- **#6** — Non-spine `MULTI-SITE JUSTIFICATION RULE` in LLM prompt analogous to existing `MULTI-LEVEL JUSTIFICATION RULE`.

Single bundled PR (Q1=a). Six logical phases inside one plan, ordered so each later phase depends on earlier schema. **Depends on plan [2026-04-27-record-procedure-sites-array.md](thoughts/shared/plans/2026-04-27-record-procedure-sites-array.md) being merged first** (sites jsonb + dropped scalar `laterality`).

## Current State Analysis

**Static defaults.** [src/components/procedures/record-procedure-dialog.tsx:52-77](src/components/procedures/record-procedure-dialog.tsx#L52-L77) hard-codes one global block — `25-gauge spinal`, `5 mL injection`, `2 mL anesthetic`, `Lidocaine 1%`, `30 mL blood draw`. Reasonable for lumbar facet PRP under ultrasound, off for knee/shoulder/cortisone procedures. Provider overrides every time.

**Procedure type.** No `procedures.procedure_type` column. Form title `'Record PRP Procedure'`. Procedure note generation hard-coded for PRP — uses `procedure_prp_prep` LLM section regardless. Any cortisone procedure would mis-trigger the PRP-specific section.

**Free-text gauge + agent.** [record-procedure-dialog.tsx:621-633](src/components/procedures/record-procedure-dialog.tsx#L621-L633) needle gauge as plain `<Input>`. [record-procedure-dialog.tsx:530-543](src/components/procedures/record-procedure-dialog.tsx#L530-L543) anesthetic agent as plain `<Input>`. Free-text invites typos that propagate to PDF + LLM narrative.

**LLM target inference.** [src/lib/claude/generate-procedure-note.ts:446-448](src/lib/claude/generate-procedure-note.ts#L446-L448) `TARGET-COHERENCE RULE` requires Claude to choose between periarticular/facet-capsular vs. intradiscal/epidural/transforaminal language based on `guidance_method` + `injection_site` text. Provider has no committed value; LLM infers.

**Consent gate.** [record-procedure-dialog.tsx:404-424](src/components/procedures/record-procedure-dialog.tsx#L404-L424) shows `consent_obtained` checkbox (defaults `true`). Form does not gate submit when unchecked.

**Multi-site rule spine-only.** `MULTI-LEVEL JUSTIFICATION RULE` at [generate-procedure-note.ts:453-458](src/lib/claude/generate-procedure-note.ts#L453-L458) fires only when `injection_site` names 2+ spinal levels. Non-spine multi-site (e.g. Knee + Shoulder) gets no analogous justification template.

**Billing CPT hard-coded.** [src/actions/billing.ts:259-275](src/actions/billing.ts#L259-L275) builds `description = 'PRP preparation and injection with US guided'` and `cpt_code = '0232T\n86999\n76942'` regardless of anatomy or `guidance_method`. Composite CPT string is not anatomy-aware — knee PRP and lumbar facet PRP both bill the same composite.

## Desired End State

After this plan ships:

1. `procedure_defaults` table with rows keyed by `(anatomy_key, procedure_type)`. Seeds: `('lumbar_facet', 'prp')`, `('cervical_facet', 'prp')`, `('thoracic_facet', 'prp')`, `('knee', 'prp')`, `('shoulder', 'prp')`, `('hip', 'prp')`, `('sacroiliac', 'prp')`, `('ankle', 'prp')`. Each row carries: `needle_gauge`, `injection_volume_ml`, `anesthetic_agent`, `anesthetic_dose_ml`, `guidance_method`, `activity_restriction_hrs`, `default_cpt_codes text[]`, `target_structure`, `notes`.
2. `procedures.procedure_type text not null default 'prp'` column with enum check `('prp', 'cortisone', 'hyaluronic')`. Existing rows backfilled to `'prp'`. No UI selector this PR — value committed at insert time as `'prp'`.
3. `procedures.target_structure text` (nullable). Enum check `('periarticular', 'facet_capsular', 'intradiscal', 'epidural', 'transforaminal', 'sacroiliac_adjacent', 'intra_articular')`. New form Select in Injection section.
4. Dialog `STATIC_PROCEDURE_DEFAULTS` removed. Form pre-fill consults `procedure_defaults` lookup keyed by `single_anatomy(sites[])` + `procedure_type='prp'`. Multi-anatomy procedure → leave fields blank (provider commits per-site via existing A2 sites array).
5. `needle_gauge` and `anesthetic_agent` rendered as `<Select>` dropdowns from static constants `NEEDLE_GAUGE_OPTIONS` + `ANESTHETIC_AGENT_OPTIONS`. Free-text "Other..." escape hatch retained for both.
6. Form `superRefine` blocks submit when `consent_obtained === false` AND `plan_deviation_reason` is empty.
7. Billing line-item construction at [billing.ts:256-285](src/actions/billing.ts#L256-L285) reads `procedure_defaults.default_cpt_codes` for the procedure's `(single_anatomy(sites), procedure_type)` lookup. Falls back to today's hard-coded composite when no row matches. Old invoice rows untouched.
8. LLM prompt at [generate-procedure-note.ts:453-458](src/lib/claude/generate-procedure-note.ts#L453-L458) gains `MULTI-SITE JUSTIFICATION RULE` (non-spine analog). LLM consumes `procedureRecord.target_structure` directly when set; falls back to inference when null.
9. All 5 readers that consume `procedures.target_confirmed_imaging` / `laterality` / etc. still pass after the prerequisite plan merges.

### Verify:
- `npx tsc --noEmit` clean
- `npm run lint` clean
- `npx vitest run` all green
- `npx supabase db push` applies migration
- Manual: record knee PRP — defaults pre-fill 22G + 4 mL (knee row), not 25G + 5 mL (lumbar facet row)
- Manual: invoice for knee procedure shows knee-appropriate CPT (`27370` joint injection or whatever knee row holds), not the lumbar composite
- Manual: cortisone procedure CAN be inserted at DB level (column accepts the enum value), but no UI selector exists yet — confirmed via SQL insert

### Key Discoveries:
- Existing service catalog table already exists with CPT codes — see [src/actions/billing.ts:240-275](src/actions/billing.ts#L240-L275) `priceMap` + `catalogItems`. New `default_cpt_codes` array references existing catalog by string match.
- Migration `20260424_normalize_service_catalog_cpt_codes.sql` precedent for CPT code normalization.
- LLM prompt `TARGET-COHERENCE RULE` already branches on `guidance_method`. Adding `target_structure` consumption is one extra branch, not a rewrite.
- `MULTI-LEVEL JUSTIFICATION RULE` is ~3 sentences in prompt. Sister rule for non-spine = ~3 more sentences.

## What We're NOT Doing

- **No UI selector for `procedure_type`.** Schema-only this PR. Cortisone/hyaluronic dialog variants are future work.
- **No tenant-scoping of `procedure_defaults`.** Global rows only (Q2=a). Multi-clinic protocol overrides deferred.
- **No retroactive invoice migration.** Old invoice rows keep their literal CPT composite; only newly-built invoices read from `procedure_defaults.default_cpt_codes`.
- **No retroactive procedure-note regeneration.** Existing finalized notes preserved.
- **No needle_gauge / anesthetic_agent migration of existing free-text values.** Existing rows keep their string. New form normalizes via dropdown.
- **No rewrite of `STATIC_PROCEDURE_DEFAULTS` cascade.** Removed, replaced by lookup. Hard-coded fallback retained inline as "no row matched" fallback so dialog still works when DB empty.
- **No removal of `target_confirmed_imaging` from per-site sites[] array** — that ships in the prerequisite plan.
- **No change to discharge note prompt.** B2 + #6 affect procedure note only.

## Implementation Approach

Single bundled PR, six phases. Each phase touches one logical area. Tests added per phase.

Order:
1. Migration (B1 table + C4 column + B2 column, all-in-one migration file)
2. Type regen + seed data
3. `procedure_defaults` lookup helper + zod refine for consent gate (C3)
4. Form changes (C1+C2 enum dropdowns, B2 Select, dialog defaults via lookup)
5. Billing CPT lookup wiring (B1 forward-only)
6. LLM prompt update (B2 consumption + #6 non-spine rule)

---

## Phase 1: Migration — `procedure_defaults` table + `procedure_type` + `target_structure`

### Overview
Single migration creates the defaults table, adds `procedures.procedure_type`, adds `procedures.target_structure`, seeds 8 anatomy rows.

### Changes Required:

#### 1. Migration file

**File**: `supabase/migrations/20260503_procedure_defaults_and_type.sql` (new)

```sql
-- B1: procedure_defaults table
create table public.procedure_defaults (
  id uuid primary key default gen_random_uuid(),
  anatomy_key text not null,
  procedure_type text not null check (procedure_type in ('prp', 'cortisone', 'hyaluronic')),
  needle_gauge text,
  injection_volume_ml numeric(6,1),
  anesthetic_agent text,
  anesthetic_dose_ml numeric(6,1),
  guidance_method text check (guidance_method in ('ultrasound', 'fluoroscopy', 'landmark')),
  activity_restriction_hrs integer,
  default_cpt_codes text[] not null default '{}',
  target_structure text check (target_structure in (
    'periarticular', 'facet_capsular', 'intradiscal', 'epidural',
    'transforaminal', 'sacroiliac_adjacent', 'intra_articular'
  )),
  blood_draw_volume_ml numeric(6,1),
  centrifuge_duration_min integer,
  prep_protocol text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (anatomy_key, procedure_type)
);

create index idx_procedure_defaults_lookup on public.procedure_defaults (anatomy_key, procedure_type) where active;

-- RLS: read-only to authenticated users; admin-only mutations (deferred)
alter table public.procedure_defaults enable row level security;
create policy "procedure_defaults readable by authenticated"
  on public.procedure_defaults for select
  to authenticated
  using (true);

-- C4: procedure_type column on procedures
alter table public.procedures
  add column procedure_type text not null default 'prp'
  check (procedure_type in ('prp', 'cortisone', 'hyaluronic'));

-- B2: target_structure column on procedures
alter table public.procedures
  add column target_structure text
  check (target_structure in (
    'periarticular', 'facet_capsular', 'intradiscal', 'epidural',
    'transforaminal', 'sacroiliac_adjacent', 'intra_articular'
  ));

-- Seed: 8 PRP anatomy rows mirroring current STATIC_PROCEDURE_DEFAULTS,
-- adapted per anatomy. Lumbar facet inherits the existing global defaults
-- (25G spinal, 5 mL, ultrasound). Knee/shoulder/hip use larger gauges and
-- volumes typical for joint injections. CPT composites differ by anatomy.
insert into public.procedure_defaults
  (anatomy_key, procedure_type, needle_gauge, injection_volume_ml,
   anesthetic_agent, anesthetic_dose_ml, guidance_method,
   activity_restriction_hrs, default_cpt_codes, target_structure,
   blood_draw_volume_ml, centrifuge_duration_min, prep_protocol, notes)
values
  ('lumbar_facet', 'prp', '25-gauge spinal', 5, 'Lidocaine 1%', 2,
   'ultrasound', 48, ARRAY['0232T', '86999', '76942'], 'facet_capsular',
   30, 5, 'ACP Double Syringe System', 'Default for lumbar PRP'),
  ('cervical_facet', 'prp', '25-gauge spinal', 3, 'Lidocaine 1%', 1.5,
   'ultrasound', 48, ARRAY['0232T', '86999', '76942'], 'facet_capsular',
   30, 5, 'ACP Double Syringe System', null),
  ('thoracic_facet', 'prp', '25-gauge spinal', 3, 'Lidocaine 1%', 1.5,
   'ultrasound', 48, ARRAY['0232T', '86999', '76942'], 'facet_capsular',
   30, 5, 'ACP Double Syringe System', null),
  ('knee', 'prp', '22-gauge', 5, 'Lidocaine 1%', 2,
   'ultrasound', 48, ARRAY['0232T', '86999', '76942'], 'intra_articular',
   30, 5, 'ACP Double Syringe System', null),
  ('shoulder', 'prp', '25-gauge', 4, 'Lidocaine 1%', 1.5,
   'ultrasound', 48, ARRAY['0232T', '86999', '76942'], 'intra_articular',
   30, 5, 'ACP Double Syringe System', null),
  ('hip', 'prp', '22-gauge spinal', 5, 'Lidocaine 1%', 2,
   'ultrasound', 48, ARRAY['0232T', '86999', '76942'], 'intra_articular',
   30, 5, 'ACP Double Syringe System', null),
  ('sacroiliac', 'prp', '22-gauge spinal', 4, 'Lidocaine 1%', 2,
   'ultrasound', 48, ARRAY['0232T', '86999', '76942'], 'sacroiliac_adjacent',
   30, 5, 'ACP Double Syringe System', null),
  ('ankle', 'prp', '25-gauge', 3, 'Lidocaine 1%', 1.5,
   'ultrasound', 48, ARRAY['0232T', '86999', '76942'], 'intra_articular',
   30, 5, 'ACP Double Syringe System', null);
```

### Success Criteria:

#### Automated Verification:
- [ ] Migration applies cleanly: `npx supabase db reset` (local) then `npx supabase db push` (remote)
- [ ] Seed verification: `select count(*) from procedure_defaults where active = true and procedure_type = 'prp';` → 8
- [ ] All existing procedures got `procedure_type = 'prp'`: `select count(*) from procedures where procedure_type != 'prp';` → 0
- [ ] `target_structure` column added: `select count(*) from procedures where target_structure is not null;` → 0 (nothing populated yet, expected)

---

## Phase 2: Generated types + lookup helper

### Overview
Regenerate database types. Add server-side lookup helper + anatomy classifier.

### Changes Required:

#### 1. Regenerate database types

**File**: `src/types/database.ts` (regenerated)

**Command**: `npx supabase gen types typescript --local > src/types/database.ts`

Expected additions: `procedure_defaults` table type; `procedures.procedure_type`, `procedures.target_structure`.

#### 2. Anatomy classifier

**File**: `src/lib/procedures/anatomy-classifier.ts` (new)

Maps a single site label to an `anatomy_key` for `procedure_defaults` lookup.

```ts
// Single-anatomy classifier. Maps a sites[] array label to one of the seeded
// anatomy_key values. When sites[] has multiple anatomies (e.g. knee + shoulder),
// returns null — caller should leave defaults blank.
const ANATOMY_PATTERNS: Array<[anatomy: string, regex: RegExp]> = [
  ['lumbar_facet',   /\b(L\d+[-/]?L?\d+|L\d+[-/]?S\d+|lumbar)\b/i],
  ['cervical_facet', /\b(C\d+[-/]?C?\d+|C\d+[-/]?T\d+|cervical)\b/i],
  ['thoracic_facet', /\b(T\d+[-/]?T?\d+|T\d+[-/]?L\d+|thoracic)\b/i],
  ['sacroiliac',     /\b(sacroiliac|si\s*joint|si)\b/i],
  ['knee',           /\bknee/i],
  ['shoulder',       /\bshoulder/i],
  ['hip',            /\bhip/i],
  ['ankle',          /\bankle/i],
]

export function classifyAnatomy(label: string): string | null {
  for (const [anatomy, pattern] of ANATOMY_PATTERNS) {
    if (pattern.test(label)) return anatomy
  }
  return null
}

// Single-anatomy classifier across an entire sites[] array. Returns the
// anatomy_key when ALL sites map to the same anatomy; null when sites is
// empty, when any site fails to classify, or when sites span multiple
// anatomies.
export function singleAnatomyFromSites(
  sites: Array<{ label: string }>,
): string | null {
  if (sites.length === 0) return null
  const first = classifyAnatomy(sites[0].label)
  if (!first) return null
  for (let i = 1; i < sites.length; i++) {
    if (classifyAnatomy(sites[i].label) !== first) return null
  }
  return first
}
```

**File**: `src/lib/procedures/__tests__/anatomy-classifier.test.ts` (new)

```ts
import { describe, it, expect } from 'vitest'
import { classifyAnatomy, singleAnatomyFromSites } from '../anatomy-classifier'

describe('classifyAnatomy', () => {
  it('classifies lumbar levels', () => {
    expect(classifyAnatomy('L4-L5')).toBe('lumbar_facet')
    expect(classifyAnatomy('L5-S1')).toBe('lumbar_facet')
    expect(classifyAnatomy('Lumbar facet')).toBe('lumbar_facet')
  })
  it('classifies cervical', () => {
    expect(classifyAnatomy('C5-C6')).toBe('cervical_facet')
  })
  it('classifies joints', () => {
    expect(classifyAnatomy('Knee')).toBe('knee')
    expect(classifyAnatomy('Right shoulder')).toBe('shoulder')
  })
  it('returns null for unrecognized', () => {
    expect(classifyAnatomy('something else')).toBeNull()
  })
})

describe('singleAnatomyFromSites', () => {
  it('returns single anatomy when all sites match', () => {
    expect(singleAnatomyFromSites([{ label: 'L4-L5' }, { label: 'L5-S1' }])).toBe('lumbar_facet')
  })
  it('returns null when sites span anatomies', () => {
    expect(singleAnatomyFromSites([{ label: 'Knee' }, { label: 'Shoulder' }])).toBeNull()
  })
  it('returns null on empty array', () => {
    expect(singleAnatomyFromSites([])).toBeNull()
  })
})
```

#### 3. Server-side lookup

**File**: `src/actions/procedure-defaults.ts` (new)

```ts
'use server'

import { createClient } from '@/lib/supabase/server'

export interface ProcedureDefaultsRow {
  anatomy_key: string
  procedure_type: 'prp' | 'cortisone' | 'hyaluronic'
  needle_gauge: string | null
  injection_volume_ml: number | null
  anesthetic_agent: string | null
  anesthetic_dose_ml: number | null
  guidance_method: 'ultrasound' | 'fluoroscopy' | 'landmark' | null
  activity_restriction_hrs: number | null
  default_cpt_codes: string[]
  target_structure: string | null
  blood_draw_volume_ml: number | null
  centrifuge_duration_min: number | null
  prep_protocol: string | null
}

export async function getProcedureDefaultsByAnatomy(
  anatomyKey: string,
  procedureType: 'prp' | 'cortisone' | 'hyaluronic' = 'prp',
): Promise<ProcedureDefaultsRow | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('procedure_defaults')
    .select('*')
    .eq('anatomy_key', anatomyKey)
    .eq('procedure_type', procedureType)
    .eq('active', true)
    .maybeSingle()
  return (data as ProcedureDefaultsRow | null) ?? null
}
```

### Success Criteria:

#### Automated Verification:
- [ ] Type check: `npx tsc --noEmit`
- [ ] Lint: `npm run lint`
- [ ] Anatomy classifier tests pass: `npx vitest run src/lib/procedures/__tests__/anatomy-classifier.test.ts`

---

## Phase 3: Form — enum dropdowns (C1+C2), `target_structure` Select (B2), consent gate (C3)

### Overview
Replace free-text needle gauge and anesthetic agent with dropdowns. Add `target_structure` Select. Add zod superRefine consent gate.

### Changes Required:

#### 1. Static enum constants

**File**: `src/lib/procedures/enum-constants.ts` (new)

```ts
export const NEEDLE_GAUGE_OPTIONS = [
  '22-gauge',
  '22-gauge spinal',
  '25-gauge',
  '25-gauge spinal',
  '27-gauge',
  '27-gauge spinal',
  '30-gauge',
] as const

export const ANESTHETIC_AGENT_OPTIONS = [
  'Lidocaine 1%',
  'Lidocaine 2%',
  'Bupivacaine 0.25%',
  'Bupivacaine 0.5%',
  'None',
] as const

export const TARGET_STRUCTURE_OPTIONS = [
  { value: 'periarticular',          label: 'Periarticular' },
  { value: 'facet_capsular',         label: 'Facet capsular' },
  { value: 'intradiscal',            label: 'Intradiscal' },
  { value: 'epidural',               label: 'Epidural' },
  { value: 'transforaminal',         label: 'Transforaminal' },
  { value: 'sacroiliac_adjacent',    label: 'Sacroiliac-adjacent' },
  { value: 'intra_articular',        label: 'Intra-articular' },
] as const

export type NeedleGauge = typeof NEEDLE_GAUGE_OPTIONS[number]
export type AnestheticAgent = typeof ANESTHETIC_AGENT_OPTIONS[number]
export type TargetStructure = typeof TARGET_STRUCTURE_OPTIONS[number]['value']
```

#### 2. zod schema additions

**File**: `src/lib/validations/prp-procedure.ts`

**Changes**: Add `target_structure` to `injectionSchema` (optional). Top-level `superRefine` for consent gate (C3).

```ts
import { TARGET_STRUCTURE_OPTIONS } from '@/lib/procedures/enum-constants'

const targetStructureValues = TARGET_STRUCTURE_OPTIONS.map(o => o.value) as [string, ...string[]]

const injectionSchema = z.object({
  injection_volume_ml: z.number().positive('Total injection volume is required'),
  needle_gauge: z.string().optional(),                              // unchanged
  guidance_method: z.enum(['ultrasound', 'fluoroscopy', 'landmark']),
  target_structure: z.enum(targetStructureValues).nullable(),        // NEW
})

// In prpProcedureFormSchema, extend superRefine:
.superRefine((data, ctx) => {
  // Existing per-site sum check from prerequisite plan
  // ... (sum check from prior plan)

  // NEW: C3 consent gate
  if (data.consent_obtained === false) {
    const reason = (data.plan_deviation_reason ?? '').trim()
    if (reason.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Plan deviation reason required when consent is not obtained.',
        path: ['plan_deviation_reason'],
      })
    }
  }
})
```

**File**: `src/lib/validations/__tests__/prp-procedure.test.ts`

Add tests:
- `consent_obtained=false` + empty `plan_deviation_reason` → fail
- `consent_obtained=false` + non-empty reason → pass
- `target_structure` null permitted; invalid string rejected

#### 3. Dialog form fields

**File**: `src/components/procedures/record-procedure-dialog.tsx`

**Changes**:

**a. needle_gauge field — replace `<Input>` with `<Select>`**

Current [lines 621-633](src/components/procedures/record-procedure-dialog.tsx#L621-L633):
```tsx
<Input placeholder="e.g. 25-gauge spinal" {...field} />
```

Replace with:
```tsx
<Select onValueChange={field.onChange} value={field.value ?? ''}>
  <FormControl>
    <SelectTrigger className="w-full">
      <SelectValue placeholder="Select gauge..." />
    </SelectTrigger>
  </FormControl>
  <SelectContent>
    {NEEDLE_GAUGE_OPTIONS.map((g) => (
      <SelectItem key={g} value={g}>{g}</SelectItem>
    ))}
  </SelectContent>
</Select>
```

**b. anesthetic_agent field — same pattern at [lines 530-543](src/components/procedures/record-procedure-dialog.tsx#L530-L543)** using `ANESTHETIC_AGENT_OPTIONS`.

**c. target_structure field — new Select in Injection section**

Add after `guidance_method` (around [line 660](src/components/procedures/record-procedure-dialog.tsx#L660)):

```tsx
<FormField
  control={form.control}
  name="injection.target_structure"
  render={({ field }) => (
    <FormItem>
      <FormLabel>Target Structure</FormLabel>
      <Select
        onValueChange={(v) => field.onChange(v === '' ? null : v)}
        value={field.value ?? ''}
      >
        <FormControl>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="—" />
          </SelectTrigger>
        </FormControl>
        <SelectContent>
          {TARGET_STRUCTURE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FormDescription>
        Optional. When set, supersedes LLM inference of target language in
        the procedure note. Required for legally-sensitive distinctions
        (e.g. intradiscal vs. periarticular).
      </FormDescription>
      <FormMessage />
    </FormItem>
  )}
/>
```

**d. defaultValues wiring for `target_structure`** at [lines 256-265](src/components/procedures/record-procedure-dialog.tsx#L256-L265):
```ts
injection: {
  // ... existing
  target_structure: initialData?.target_structure
    ?? (isEditing ? null : (defaults?.target_structure ?? null)),
}
```

#### 4. Lookup-driven defaults wiring

**File**: `src/components/procedures/record-procedure-dialog.tsx:200-277`

**Changes**: Replace hard-coded `STATIC_PROCEDURE_DEFAULTS` consumption with a lookup-derived defaults object passed in via `procedureDefaults` prop. Keep `STATIC_PROCEDURE_DEFAULTS` as inline fallback when no DB row matches.

`getProcedureDefaults` server action ([src/actions/procedures.ts:403-492](src/actions/procedures.ts#L403-L492)) extends to:
1. Compute `singleAnatomyFromSites(sites)` from intake-derived sites (added by prerequisite plan).
2. When non-null, fetch `getProcedureDefaultsByAnatomy(anatomyKey, 'prp')`.
3. Merge fetched row into `ProcedureDefaults` interface.

Extend `ProcedureDefaults` interface at [src/actions/procedures.ts:387-401](src/actions/procedures.ts#L387-L401):
```ts
export interface ProcedureDefaults {
  sites: ProcedureSite[]   // from prerequisite plan
  vital_signs: { ... }
  earliest_procedure_date: string | null
  // NEW: from procedure_defaults lookup
  needle_gauge: string | null
  injection_volume_ml: number | null
  anesthetic_agent: string | null
  anesthetic_dose_ml: number | null
  guidance_method: 'ultrasound' | 'fluoroscopy' | 'landmark' | null
  activity_restriction_hrs: number | null
  blood_draw_volume_ml: number | null
  centrifuge_duration_min: number | null
  prep_protocol: string | null
  target_structure: string | null
  default_cpt_codes: string[]
}
```

`STATIC_PROCEDURE_DEFAULTS` constant at [record-procedure-dialog.tsx:52-77](src/components/procedures/record-procedure-dialog.tsx#L52-L77) trimmed to a "no-anatomy / multi-anatomy" fallback only — drives form-level defaults when `defaults?.needle_gauge` is null.

Form `useForm` defaults updated to read `defaults?.<field> ?? STATIC_PROCEDURE_DEFAULTS.<section>.<field>` for each:
- `prp_preparation.blood_draw_volume_ml`
- `prp_preparation.centrifuge_duration_min`
- `prp_preparation.prep_protocol`
- `anesthesia.anesthetic_agent`
- `anesthesia.anesthetic_dose_ml`
- `injection.injection_volume_ml`
- `injection.needle_gauge`
- `injection.guidance_method`
- `injection.target_structure`
- `post_procedure.activity_restriction_hrs`

### Success Criteria:

#### Automated Verification:
- [ ] Type check: `npx tsc --noEmit`
- [ ] Lint: `npm run lint`
- [ ] Updated `prp-procedure.test.ts` passes (consent gate + target_structure tests)
- [ ] All vitest: `npx vitest run`

#### Manual Verification:
- [ ] Open Record Procedure dialog with intake site = "Right Knee" → needle_gauge dropdown defaults to "22-gauge", injection_volume to 5
- [ ] Open dialog with intake site = "L4-L5" → defaults to "25-gauge spinal", 5 mL, target_structure="Facet capsular"
- [ ] Open dialog with intake sites = ["Knee", "Shoulder"] (multi-anatomy) → all defaults blank, provider commits per-site
- [ ] Uncheck consent_obtained, leave plan_deviation_reason empty, submit → form blocks with "Plan deviation reason required when consent is not obtained."
- [ ] Uncheck consent, fill plan_deviation_reason, submit → succeeds
- [ ] Pick target_structure="Intradiscal", generate procedure note → narrative reads "intradiscal" verbatim, doesn't infer

---

## Phase 4: Server action insert payload

### Overview
`createPrpProcedure` writes new columns. `getProcedureById` selects them.

### Changes Required:

#### 1. createPrpProcedure / updatePrpProcedure

**File**: `src/actions/procedures.ts:103-141`

**Changes**: Insert payload writes `procedure_type` (always `'prp'` for now), `target_structure`. `target_confirmed_imaging` removed (handled per-site in prerequisite plan).

```ts
.insert({
  // ... existing fields
  procedure_type: 'prp',                                  // NEW
  target_structure: values.injection.target_structure,    // NEW
  // ... rest unchanged
})
```

`updatePrpProcedure` mirrors.

#### 2. ProcedureInitialData interface

**File**: `src/components/procedures/record-procedure-dialog.tsx:83-116`

Add `target_structure: string | null`. Caller page (`procedures/[procedureId]/edit/page.tsx`) — extend select to include `target_structure`.

### Success Criteria:

#### Automated Verification:
- [ ] Type check: `npx tsc --noEmit`
- [ ] Lint: `npm run lint`
- [ ] Existing procedure CRUD tests pass: `npx vitest run src/actions/__tests__/`

---

## Phase 5: Billing CPT lookup

### Overview
Replace hard-coded `'0232T\n86999\n76942'` with `procedure_defaults.default_cpt_codes` lookup. Forward-only.

### Changes Required:

#### 1. billing.ts PRP line-item construction

**File**: `src/actions/billing.ts:256-285`

**Changes**: Look up `default_cpt_codes` per procedure's `(anatomy_key, procedure_type)`. Falls back to today's hard-coded composite when no match.

```ts
import { singleAnatomyFromSites } from '@/lib/procedures/anatomy-classifier'
import { getProcedureDefaultsByAnatomy } from '@/actions/procedure-defaults'

// Inside the procedures loop at line 257:
for (const proc of procedures) {
  const typedProc = proc as {
    id: string
    procedure_date: string
    procedure_name: string
    procedure_type: 'prp' | 'cortisone' | 'hyaluronic'      // NEW
    injection_site?: string | null
    sites?: Array<{ label: string }> | null                  // NEW from prerequisite plan
  }

  const anatomyKey = typedProc.sites
    ? singleAnatomyFromSites(typedProc.sites)
    : null
  const procDefaults = anatomyKey
    ? await getProcedureDefaultsByAnatomy(anatomyKey, typedProc.procedure_type ?? 'prp')
    : null

  const cptCodes = procDefaults?.default_cpt_codes && procDefaults.default_cpt_codes.length > 0
    ? procDefaults.default_cpt_codes
    : ['0232T', '86999', '76942']  // fallback

  const sitesText: string[] = []
  if (typedProc.injection_site) sitesText.push(typedProc.injection_site)
  const description = (anatomyKey
    ? `PRP preparation and injection — ${anatomyKey.replace('_', ' ')}`
    : 'PRP preparation and injection with US guided'
  ) + (sitesText.length > 0 ? `\n${sitesText.join(' ')}` : '')

  const unitPrice = cptCodes.reduce((sum, code) => sum + (priceMap[code] ?? 0), 0)
  const quantity = countInjectionSites(typedProc.injection_site)

  prePopulatedLineItems.push({
    procedure_id: typedProc.id,
    service_date: typedProc.procedure_date,
    cpt_code: cptCodes.join('\n'),
    description,
    quantity,
    unit_price: unitPrice,
    total_price: unitPrice * quantity,
  })
}
```

The `procedures` query that feeds this loop ([src/actions/billing.ts](src/actions/billing.ts) — locate select clause) extends to include `procedure_type` and `sites`.

### Success Criteria:

#### Automated Verification:
- [ ] Type check: `npx tsc --noEmit`
- [ ] Lint: `npm run lint`
- [ ] All vitest green

#### Manual Verification:
- [ ] Generate invoice for new lumbar PRP → CPT shows `0232T / 86999 / 76942`, description "PRP preparation and injection — lumbar facet"
- [ ] Generate invoice for new knee PRP → CPT codes match knee row (initially same composite per seed; if knee row holds e.g. `27370` it shows that), description "PRP preparation and injection — knee"
- [ ] Generate invoice for multi-anatomy procedure (Knee + Shoulder) → falls back to hard-coded composite
- [ ] Old invoices untouched — open a previously-generated invoice; line items unchanged

---

## Phase 6: LLM prompt — `target_structure` consumption + non-spine `MULTI-SITE JUSTIFICATION RULE` (#6)

### Overview
LLM prompt at [src/lib/claude/generate-procedure-note.ts](src/lib/claude/generate-procedure-note.ts) consumes `procedureRecord.target_structure` directly. Non-spine multi-site gets a sister rule to `MULTI-LEVEL JUSTIFICATION RULE`.

### Changes Required:

#### 1. Input shape

**File**: `src/lib/claude/generate-procedure-note.ts:33-52`

Add `target_structure: string | null` to `procedureRecord`.

#### 2. TARGET-COHERENCE RULE — add `target_structure` branch

**File**: `src/lib/claude/generate-procedure-note.ts:446-448`

Insert at top of the rule, before existing `guidance_method` branches:

```
PROVIDER-COMMITTED TARGET STRUCTURE (when procedureRecord.target_structure is non-null): The injection-target language MUST use the provider-committed structure verbatim. Map values to narrative terms:
• 'periarticular' → "periarticular"
• 'facet_capsular' → "facet-capsular"
• 'intradiscal' → "intradiscal"
• 'epidural' → "epidural"
• 'transforaminal' → "transforaminal"
• 'sacroiliac_adjacent' → "sacroiliac-adjacent"
• 'intra_articular' → "intra-articular"
The guidance_method-driven branches below apply ONLY when target_structure is null. When target_structure is non-null, do NOT second-guess it via guidance_method — the provider has explicitly committed the technique language.
```

#### 3. MULTI-SITE JUSTIFICATION RULE (#6)

**File**: `src/lib/claude/generate-procedure-note.ts:453-458`

Insert after the existing `MULTI-LEVEL JUSTIFICATION RULE` block:

```
MULTI-SITE JUSTIFICATION RULE (MANDATORY when procedure_indication emits 2 or more bullets across DIFFERENT NON-SPINE sites — e.g. knee + shoulder, hip + sacroiliac): Immediately after the bullet list, append one sentence justifying the multi-site intervention. Defensible boilerplate: "Multi-site treatment was selected based on concordant pathology at each treated site and the patient's symptom distribution across regions." When mriExtractions or imaging documents pathology at only one of the treated sites, adapt: "Multi-site treatment was selected based on the patient's symptom distribution; imaging concordance is documented at [SITE]." Do NOT claim multi-site imaging concordance when the chart does not support it. This rule does NOT apply to spine multi-level procedures (those use MULTI-LEVEL JUSTIFICATION RULE above) or to single-site procedures.
```

#### 4. Tests

**File**: `src/lib/claude/__tests__/generate-procedure-note.test.ts:164-196`

Add new test cases following existing `capturePrompt` pattern:
- `target_structure='intradiscal'` → prompt asserts "intradiscal" usage; guidance-method branches do not override
- `target_structure=null` → existing branches active
- Multi-site non-spine input → prompt contains `MULTI-SITE JUSTIFICATION RULE` text

### Success Criteria:

#### Automated Verification:
- [ ] Type check: `npx tsc --noEmit`
- [ ] Lint: `npm run lint`
- [ ] Updated `generate-procedure-note.test.ts` passes
- [ ] All vitest green

#### Manual Verification:
- [ ] Generate procedure note with `target_structure='periarticular'` → narrative uses "periarticular" verbatim, no "intradiscal" inference
- [ ] Generate procedure note with `target_structure=null` and `guidance_method='fluoroscopy'` + spinal site → existing inference path produces "intradiscal" / "epidural" / "transforaminal" as appropriate
- [ ] Generate procedure note for `sites = [Knee, Shoulder]` → procedure_indication includes MULTI-SITE JUSTIFICATION sentence after the bullets
- [ ] Generate procedure note for `sites = [L4-L5, L5-S1]` → procedure_indication includes MULTI-LEVEL JUSTIFICATION sentence (existing rule, unchanged)
- [ ] Generate procedure note for single-site procedure → no justification sentence (neither rule applies)

**Implementation Note**: After completing all six phases and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before merging.

---

## Testing Strategy

### Unit Tests:
- `anatomy-classifier.test.ts` — single + multi-anatomy classification
- `prp-procedure.test.ts` extended — consent gate + target_structure validation
- `generate-procedure-note.test.ts` extended — target_structure prompt branch + MULTI-SITE JUSTIFICATION RULE presence

### Integration Tests:
- Existing procedure CRUD tests pass with new columns
- Billing tests confirm CPT lookup falls back to hard-coded composite when no anatomy match

### Manual Testing Steps:

See per-phase manual verification lists. Key end-to-end scenarios:
1. Knee PRP with prefilled defaults — verify all dropdowns auto-pick anatomy-appropriate values
2. Lumbar facet PRP — same behavior, different defaults
3. Multi-anatomy procedure — fallback path
4. Consent gate fires when needed
5. Target structure committed by provider supersedes LLM inference
6. Non-spine multi-site procedure note has justification sentence
7. Invoice CPT description reflects anatomy

## Performance Considerations

- New `procedure_defaults` table read once per `getProcedureDefaults` call (form open) and once per procedure during invoice build. Indexed on `(anatomy_key, procedure_type)` partial WHERE active. Negligible overhead.
- Static enum constants are compile-time; no runtime cost.
- Prompt size grows ~150 tokens (target_structure + MULTI-SITE rules). Existing prompt already several thousand tokens; immaterial.

## Migration Notes

- Migration adds nullable `target_structure` and defaulted `procedure_type`. All existing rows backfill to `procedure_type='prp'` automatically via column default. No data migration script needed.
- Old invoices keep their literal `cpt_code: '0232T\n86999\n76942'` — billing change is forward-only at line-item construction time.
- Old free-text `needle_gauge` and `anesthetic_agent` values preserved on existing rows. Editing an old procedure may show "Other..." or unrecognized values in the new dropdown — UX falls back to displaying the raw value as-selected.
- Rollback: dropping `procedure_defaults` table and the two columns is safe since they have defaults and nullable values; no data loss.

## References

- Source research: [thoughts/shared/research/2026-04-27-record-procedure-dialog-inputs-improvements.md](thoughts/shared/research/2026-04-27-record-procedure-dialog-inputs-improvements.md)
- **Prerequisite plan (must merge first)**: [thoughts/shared/plans/2026-04-27-record-procedure-sites-array.md](thoughts/shared/plans/2026-04-27-record-procedure-sites-array.md)
- Existing site-tagging precedent: [src/components/procedures/diagnosis-combobox.tsx](src/components/procedures/diagnosis-combobox.tsx)
- Existing zod superRefine pattern: [src/lib/validations/prp-procedure.ts:57-85](src/lib/validations/prp-procedure.ts#L57-L85)
- Existing CPT composite hard-code: [src/actions/billing.ts:259-275](src/actions/billing.ts#L259-L275)
- Existing `MULTI-LEVEL JUSTIFICATION RULE`: [src/lib/claude/generate-procedure-note.ts:453-458](src/lib/claude/generate-procedure-note.ts#L453-L458)
- Existing `TARGET-COHERENCE RULE`: [src/lib/claude/generate-procedure-note.ts:446-448](src/lib/claude/generate-procedure-note.ts#L446-L448)
- Existing test pattern (capturePrompt): [src/lib/claude/__tests__/generate-procedure-note.test.ts:164-196](src/lib/claude/__tests__/generate-procedure-note.test.ts#L164-L196)
