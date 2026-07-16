# Therapeutic BOTOX Procedure Implementation Plan

## Overview

Add `'botox'` as a third procedure type (alongside `'prp'`, `'cortisone'`, `'hyaluronic'`) to record Therapeutic onabotulinumtoxinA (BOTOX) injections. The reference format is the Sandaljian clinical packet: a BOTOX procedure note with **Product & Preparation** and **Injection Map / Vial Reconciliation** sections, and billing that splits into a per-unit administration line (`PI-CASH`), a discarded-drug waste line (`PI-WASTE`), and a flat facility fee.

The existing procedure subsystem is a hard-coded PRP pipeline; `procedure_type` is the multi-type seam that already exists but is pinned to `'prp'` at every write.

## Current State Analysis

- **`procedure_type` seam exists, pinned to `'prp'`**: DB CHECK `in ('prp','cortisone','hyaluronic')` on both `procedures` and `procedure_defaults` ([20260503_procedure_defaults_and_type.sql:48-58](supabase/migrations/20260503_procedure_defaults_and_type.sql)); TS union in [procedure-defaults.ts:7](src/actions/procedure-defaults.ts#L7) and [billing.ts:289](src/actions/billing.ts#L289); hard-coded write at [procedures.ts:129,152](src/actions/procedures.ts#L129).
- **Note schema shared across 3 files in lockstep**: `procedureNoteSections` + `procedureNoteSectionLabels` ([procedure-note.ts:3-49](src/lib/validations/procedure-note.ts#L3-L49)), the AI tool schema `PROCEDURE_NOTE_TOOL` ([generate-procedure-note.ts:739-781](src/lib/claude/generate-procedure-note.ts#L739-L781)), and PDF `sectionEntries` ([procedure-note-template.tsx:51-72](src/lib/pdf/procedure-note-template.tsx#L51-L72)). Section 12 is `procedure_prp_prep`.
- **AI prompt is a single fixed PRP narrative** with no `procedure_type` branching ([generate-procedure-note.ts:221-732](src/lib/claude/generate-procedure-note.ts#L221-L732)).
- **Site shape** `procedureSiteSchema`: `label`, `laterality`, `volume_ml`, `target_confirmed_imaging` ([sites-helpers.ts:3-8](src/lib/procedures/sites-helpers.ts#L3-L8)). No `points`/`units`. Muscle vocabulary absent — `SITE_CATALOG` and `TARGET_STRUCTURE_OPTIONS` are joint/spine only.
- **Record dialog is PRP-hardcoded, no type selector** ([record-procedure-dialog.tsx:52,64,349,474](src/components/procedures/record-procedure-dialog.tsx#L52)); submits via `createPrpProcedure`/`updatePrpProcedure`.
- **procedureRecord assembly** maps DB cols 1:1 ([procedure-notes.ts:346-370](src/actions/procedure-notes.ts#L346-L370)).
- **PDF renderer** passes note sections through, hardcodes `'PRP Injection'` fallback ([render-procedure-note-pdf.ts:111,142](src/lib/pdf/render-procedure-note-pdf.ts#L111)).
- **Billing has no drug-unit / waste / per-unit concept**: quantity = injection-site count, price = catalog CPT sum ([billing.ts:275-345](src/actions/billing.ts#L275-L345)). `service_catalog` is `cpt_code → default_price`, no procedure_type link ([database.ts:2786-2839](src/types/database.ts#L2786-L2839)).
- **`invoice_line_items`** columns: `id, invoice_id, procedure_id, description, cpt_code, quantity, unit_price, total_price, display_order, service_date` ([database.ts:1392-1448](src/types/database.ts#L1392-L1448)) — can hold per-unit + waste lines with no schema change.

## Desired End State

A provider can record a BOTOX procedure: pick "BOTOX" as the type in the record dialog, enter product/vial/reconstitution data + per-muscle points/units, generate a BOTOX-worded note (with Product & Preparation and Injection Map sections), finalize to a PDF matching the packet, and generate an invoice with per-unit administration, waste, and facility lines that reconcile to the vial.

**Verification**: Record a BOTOX procedure matching the Sandaljian masseter/temporalis case (60 U administered, 40 U discarded, 100-U vial), generate + finalize the note, and confirm the PDF shows the injection map and the invoice shows `60 U × $15 = $900` admin + `40 U × $15 = $600` waste + `$200` facility.

### Key Discoveries
- `procedure_type` seam already threaded through defaults lookup ([procedure-defaults.ts:21-36](src/actions/procedure-defaults.ts#L21-L36)) — data-driven, needs only union + CHECK widening.
- Note section set is defined once and consumed in three places — a type-aware section set must update all three together.
- `procedureSiteSchema.volume_ml` is the only per-site dosing field; BOTOX adds `points` + `units` to the same schema (nullable, so PRP rows unaffected).
- Billing line-item schema already supports arbitrary quantity/unit_price lines — BOTOX just needs a new generation branch.

## What We're NOT Doing

- NOT renaming `createPrpProcedure`/`updatePrpProcedure` or the `procedures` PRP columns (leave them; BOTOX uses the new jsonb + shared columns).
- NOT authoring BOTOX consent legal text — clinic supplies verbatim; we use `TODO(clinic)` placeholders in the consent template.
- NOT adding cortisone/hyaluronic support (out of scope; only `'botox'`).
- NOT building a generic procedure-type plugin framework — BOTOX is branched explicitly.
- NOT changing PRP note/billing/PDF behavior — all BOTOX paths gate on `procedure_type === 'botox'`.
- NOT adding or renaming procedure-note section keys — the 20-key set stays fixed; slot 12 is relabeled per type only (keeps schemas/editor/QC-cast intact).
- NOT modifying the PRP write actions — BOTOX gets its own `createBotoxProcedure`/`updateBotoxProcedure` alongside them.
- NOT modeling insurance/CMS coding beyond the packet's PI-cash line structure.

## Implementation Approach

Bottom-up: schema → validation/types → server actions (record) → note generation → PDF → dialog UI → billing. Each phase gates BOTOX behavior on `procedure_type` so PRP is never touched. BOTOX dosing lives in a `botox_dosing` jsonb column; per-muscle points/units extend the `sites` jsonb.

**Section-key decision (non-breaking):** The 20-key `procedureNoteSections` set stays FIXED. All three schemas (`procedureNoteResultSchema`, `procedureNoteEditSchema`, and the Claude tool) require every key as a non-optional string ([procedure-note.ts:52-99](src/lib/validations/procedure-note.ts#L52-L99)) — adding a separate `procedure_botox_prep` key would force every PRP note to fill it and every BOTOX note to fill `procedure_prp_prep`, breaking both. Instead, slot 12 (`procedure_prp_prep`) becomes **type-aware by label + prompt content only, not by key**: for BOTOX that same key holds the Product & Preparation + Injection Map content and renders with the label "Procedure — Product & Preparation / Injection Map". This keeps the schema shape, the editor, the PDF field set, the QC Fix-action `ProcedureNoteSection` cast, and `regenerateProcedureNoteSectionAction`'s section iteration all working unchanged.

**Existing-functionality guarantee:** No code branches on `procedure_type` today — PRP-ness is baked in as hard-coded literals, so nothing throws on a BOTOX row; the risk is mislabeling, not crashing. Every BOTOX path added here gates on `procedure_type === 'botox'`, leaving the `'prp'` path byte-for-byte unchanged. New `createBotoxProcedure`/`updateBotoxProcedure` actions are added alongside (not replacing) the PRP ones, so the PRP write path is untouched.

**Quality review guarantee:** QC gathers only a hard-coded 6-field note subset (`subjective`, `assessment_summary`, `procedure_injection`, `assessment_and_plan`, `prognosis`, `plan_alignment_status`) — NOT driven by `procedureNoteSections`, and it never selects `procedure_prp_prep` ([case-quality-reviews.ts:84-91](src/actions/case-quality-reviews.ts#L84-L91)). So the label/prompt change to slot 12 has zero effect on QC gather or `computeSourceHash`. Because the section-key set stays fixed (above), the QC Fix-action cast (`finding.section_key as ProcedureNoteSection`) and `regenerateProcedureNoteSectionAction`'s `procedureNoteSections` iteration ([procedure-notes.ts:1114-1120](src/actions/procedure-notes.ts#L1114-L1120)) keep resolving. The QC prompt persona line "personal-injury PRP injection clinic" ([generate-quality-review.ts:109](src/lib/claude/generate-quality-review.ts#L109)) and the voice-charter PRP marketing-ban example ([voice-charter.ts:69](src/lib/qc/voice-charter.ts#L69)) are prose-only — they do not error on BOTOX; Phase 8 optionally softens them to be type-neutral.

---

## Phase 1: Schema — widen procedure_type, add botox_dosing, extend sites

### Overview
Migration widening the `procedure_type` CHECK constraints and adding the `botox_dosing` jsonb column. Per-muscle points/units are additive fields on the existing `sites` jsonb (no DB constraint change needed — jsonb).

### Changes Required:

#### 1. Migration
**File**: `supabase/migrations/YYYYMMDDHHMMSS_botox_procedure_type.sql` (full timestamp prefix — see [[feedback_supabase_dup_version_prefix]])
**Changes**: Widen both CHECK constraints to include `'botox'`; add `botox_dosing jsonb` nullable column.

```sql
-- Widen procedure_type on procedures
alter table public.procedures
  drop constraint if exists procedures_procedure_type_check;
alter table public.procedures
  add constraint procedures_procedure_type_check
  check (procedure_type in ('prp', 'cortisone', 'hyaluronic', 'botox'));

-- Widen procedure_type on procedure_defaults
alter table public.procedure_defaults
  drop constraint if exists procedure_defaults_procedure_type_check;
alter table public.procedure_defaults
  add constraint procedure_defaults_procedure_type_check
  check (procedure_type in ('prp', 'cortisone', 'hyaluronic', 'botox'));

-- BOTOX dosing block (product/vial/reconstitution/units). Nullable — PRP rows leave it null.
alter table public.procedures
  add column if not exists botox_dosing jsonb;
```

Note: verify exact existing constraint names first via `\d procedures` (the migration uses `if exists` to be safe). Apply with `npx supabase db push` ([[feedback_supabase_migrations]]).

#### 2. Regenerate DB types
**File**: `src/types/database.ts`
**Changes**: Regenerate so `procedures.Row` includes `botox_dosing: Json | null`. Command in success criteria.

### Success Criteria:

#### Automated Verification:
- [x] Migration applies cleanly: `npx supabase db push --include-all` (after drift repair of 20260423/20260425; migration synced local+remote)
- [x] Types updated: `botox_dosing: Json | null` hand-added to `procedures` Row/Insert/Update (Docker/MCP unavailable — regen via `npm run gen:types` later)
- [x] Type checking passes: `npx tsc --noEmit` (exit 0)
- [x] Existing procedure tests pass: `npm test -- procedure` (280 passed)

#### Manual Verification:
- [ ] `insert into procedures (..., procedure_type) values (..., 'botox')` succeeds via SQL
- [ ] Existing PRP procedures still load in the UI (no regression)

**Implementation Note**: Pause for manual confirmation before Phase 2.

---

## Phase 2: Validation schemas + shared types

### Overview
Add the `points`/`units` fields to the site schema, a BOTOX dosing zod schema, a `botoxProcedureFormSchema`, and widen the `procedure_type` TS union. Add muscle-target vocabulary.

### Changes Required:

#### 1. Extend site schema with points/units
**File**: `src/lib/procedures/sites-helpers.ts`
**Changes**: Add nullable `points` + `units` to `procedureSiteSchema` (nullable keeps PRP rows valid).

```ts
export const procedureSiteSchema = z.object({
  label: z.string().min(1, 'Site label is required'),
  laterality: z.enum(['left', 'right', 'bilateral']).nullable(),
  volume_ml: z.number().positive().nullable(),
  target_confirmed_imaging: z.boolean().nullable(),
  points: z.number().int().positive().nullable().optional(),   // BOTOX: injection points per muscle
  units: z.number().positive().nullable().optional(),          // BOTOX: units per muscle
})
```

Add a helper `totalUnitsFromSites(sites): number | null` mirroring `totalVolumeFromSites` (sums `units` when all present).

#### 2. Muscle-target vocabulary
**File**: `src/lib/procedures/enum-constants.ts`
**Changes**: Add a `BOTOX_MUSCLE_OPTIONS` list (masseter, temporalis, frontalis, etc. — seed from packet: masseter, temporalis; extend with common therapeutic targets). Used by the BOTOX dosing grid.

```ts
export const BOTOX_MUSCLE_OPTIONS = [
  { value: 'masseter', label: 'Masseter' },
  { value: 'temporalis', label: 'Temporalis' },
  // extend as clinic requires
] as const
export type BotoxMuscle = typeof BOTOX_MUSCLE_OPTIONS[number]['value']
```

#### 3. BOTOX form + dosing schema
**File**: `src/lib/validations/botox-procedure.ts` (new)
**Changes**: `botoxDosingSchema` (product, ndc, lot, expiration, reconstitution units + diluent volume, units_administered, units_discarded) + `botoxProcedureFormSchema` factory. Reuse `diagnosisSchema`/`vitalSignsSchema` shapes (export them from `prp-procedure.ts` or duplicate minimally). superRefine: vial reconciliation (`units_administered + units_discarded === reconstitution_units`) and per-site units sum === units_administered.

```ts
export const botoxDosingSchema = z.object({
  product_name: z.string().min(1),          // "BOTOX Cosmetic (onabotulinumtoxinA)"
  ndc: z.string().optional(),
  lot_number: z.string().optional(),
  expiration: z.string().optional(),        // "2028-03"
  reconstitution_units: z.number().positive(),      // 100
  reconstitution_diluent_ml: z.number().positive(), // 3.0
  units_administered: z.number().positive(),        // 60
  units_discarded: z.number().min(0),               // 40
})

export const botoxProcedureFormSchema = (opts?: { earliestDate?: string | null }) =>
  z.object({
    procedure_date: /* same date refine as PRP */,
    sites: z.array(procedureSiteSchema).min(1),   // each site carries points+units
    diagnoses: z.array(diagnosisSchema).min(1),
    consent_obtained: z.boolean(),
    vital_signs: vitalSignsSchema,                // optional in BOTOX; allow all-null
    botox_dosing: botoxDosingSchema,
    needle_gauge: z.string().optional(),          // "30-gauge"
    complications: z.string().optional(),
    plan_deviation_reason: z.string().optional(),
  }).superRefine((data, ctx) => {
    // vial reconciliation
    const d = data.botox_dosing
    if (Math.abs((d.units_administered + d.units_discarded) - d.reconstitution_units) > 0.001) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['botox_dosing', 'units_discarded'],
        message: `Administered (${d.units_administered}) + discarded (${d.units_discarded}) must equal vial total (${d.reconstitution_units}).` })
    }
    // per-site units sum
    if (data.sites.every(s => s.units != null)) {
      const sum = data.sites.reduce((a, s) => a + (s.units ?? 0), 0)
      if (Math.abs(sum - d.units_administered) > 0.001) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['botox_dosing', 'units_administered'],
          message: `Per-site units sum to ${sum}; administered is ${d.units_administered}.` })
      }
    }
  })

export type BotoxProcedureFormValues = z.infer<ReturnType<typeof botoxProcedureFormSchema>>
export type BotoxDosingValues = z.infer<typeof botoxDosingSchema>
```

#### 4. Widen procedure_type union
**Files**: `src/actions/procedure-defaults.ts:7`, `src/actions/billing.ts:289`
**Changes**: `'prp' | 'cortisone' | 'hyaluronic' | 'botox' | null`. Grep for any other occurrence of the literal union.

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npx tsc --noEmit` (exit 0)
- [x] New schema unit tests pass: `npm test -- botox-procedure` (15 tests incl. vial reconciliation + per-site units sum + consent gate)
- [x] Existing PRP schema tests pass: `npm test -- prp-procedure` (38 tests)
- [x] Lint passes: `npx eslint <phase-2 files>` (0 errors; 1 pre-existing warning in billing.ts untouched)
- [x] Full suite regression: `npm test` (1153 passed, 70 files)

#### Manual Verification:
- [x] N/A (pure schema — covered by automated tests)

---

## Phase 3: Record server actions (createBotoxProcedure / updateBotoxProcedure)

### Overview
Add `createBotoxProcedure` + `updateBotoxProcedure` to `src/actions/procedures.ts` writing `procedure_type: 'botox'`, `procedure_name` derived (e.g. "Therapeutic BOTOX Injection"), `botox_dosing` jsonb, and sites (with points/units). Mirror the PRP functions' auth/case-not-closed guards.

### Changes Required:

#### 1. New actions
**File**: `src/actions/procedures.ts`
**Changes**: Add `createBotoxProcedure(caseId, values: BotoxProcedureFormValues)` and `updateBotoxProcedure(id, caseId, values)`. Write: `procedure_type: 'botox'`, `procedure_name`, `sites` (serialized incl points/units), `diagnoses`, `consent_obtained`, `botox_dosing`, `needle_gauge`, `complications`, `injection_site` (denormalized via `injectionSiteFromSites`), `plan_deviation_reason`, audit cols. Do NOT write PRP-only columns.

```ts
export async function createBotoxProcedure(caseId: string, values: BotoxProcedureFormValues) {
  // auth + assertCaseNotClosed (mirror createPrpProcedure)
  // insert into procedures: procedure_type:'botox', procedure_name:'Therapeutic BOTOX Injection',
  //   sites, diagnoses, consent_obtained, botox_dosing: values.botox_dosing,
  //   needle_gauge, complications, injection_site: injectionSiteFromSites(values.sites), ...
}
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npx tsc --noEmit` (exit 0)
- [x] ~~Action unit test~~ DEVIATION: no Supabase-client mock harness exists for `procedures.ts` actions; building one is out of scope. Action correctness verified by typecheck + the Phase 6 manual flow. Full suite unaffected: `npm test` (1153 passed).
- [x] Lint passes: `npx eslint src/actions/procedures.ts` (0 errors)

#### Manual Verification:
- [ ] Via the dialog (Phase 6), a BOTOX row persists with correct `botox_dosing` and per-site units

---

## Phase 4: Note generation — type-aware section set + BOTOX prompt

### Overview
Make the note section set type-aware: replace `procedure_prp_prep` with `procedure_botox_prep` for BOTOX, add a BOTOX prompt variant, and thread `botox_dosing` into `procedureRecord`.

### Changes Required:

#### 1. Type-aware section labels (keys stay fixed)
**File**: `src/lib/validations/procedure-note.ts`
**Changes**: Do NOT add or rename any key — the 20-key set and all three schemas stay byte-for-byte identical (this is what keeps PRP, the editor, the PDF field set, and the QC Fix-action cast working). Add a pure helper `procedureNoteSectionLabelsFor(procedureType: string): Record<ProcedureNoteSection, string>` that returns `procedureNoteSectionLabels` as-is for PRP, and for `'botox'` overrides only slot 12: `procedure_prp_prep → 'Procedure — Product & Preparation / Injection Map'`. `procedureNoteSectionLabels` itself is unchanged (default/PRP labels), so any existing importer keeps its current behavior.

#### 2. procedureRecord threads botox_dosing
**File**: `src/actions/procedure-notes.ts` (~line 346)
**Changes**: Add `procedure_type: proc.procedure_type` and `botox_dosing: proc.botox_dosing` to `procedureRecord`. Sites already carry points/units via `parseSitesJsonb`.

#### 3. BOTOX prompt variant
**File**: `src/lib/claude/generate-procedure-note.ts`
**Changes**: Branch `SYSTEM_PROMPT` on `procedureRecord.procedure_type` (PRP path unchanged — the existing constant is the `'prp'`/default branch). BOTOX variant: off-label chemodenervation framing; the **same `procedure_prp_prep` key** (kept — see section-key decision) is instructed to hold product/NDC/lot/expiration/reconstitution + injection map + vial reconciliation; ~3-month neuromodulator followup; BOTOX patient-education (no "regenerative"/"tissue regeneration"); risks per packet (dysphagia, toxin spread, asymmetry, chewing weakness). Add `procedure_type` + `botox_dosing` to `ProcedureNoteInputData.procedureRecord`. Keep `PROCEDURE_NOTE_TOOL`'s key set and required-list identical (all 20 keys stay required); only the slot-12 property *description* text may be branched per type — the schema shape does not change, so `procedureNoteResultSchema` validation still passes for both types.

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npx tsc --noEmit` (exit 0)
- [x] Note-gen tests pass: `npm test -- generate-procedure-note` (146 tests, +5 BOTOX: override append, PRP unchanged, botox system-prompt passed, label helper)
- [x] Lint passes: `npx eslint <phase-4 files>` (0 errors)
- [x] Full suite: `npm test` (1153 passed)

#### Manual Verification:
- [ ] Generate a BOTOX note from a recorded BOTOX procedure; the Product & Preparation section shows product/vial/units and the Injection Map lists per-muscle points/units; no PRP/blood-draw/centrifuge language appears

**Implementation Note**: Pause for manual confirmation before Phase 5.

---

## Phase 5: PDF template + renderer

### Overview
Make the PDF section labels type-aware and render the BOTOX product/injection-map content. Fix the `'PRP Injection'` fallback to be type-aware.

### Changes Required:

#### 1. PDF template labels
**File**: `src/lib/pdf/procedure-note-template.tsx`
**Changes**: `sectionEntries` label for `procedure_prp_prep`/`procedure_botox_prep` chosen by a `procedureType` field added to `ProcedureNotePdfData`. Header "Injection #" line: for BOTOX (single administration, not a numbered series) render "Procedure" without the ordinal series framing.

#### 2. Renderer threads type
**File**: `src/lib/pdf/render-procedure-note-pdf.ts`
**Changes**: Select `procedures.procedure_type, botox_dosing` in the fetch (line 46); set `procedureType` on `pdfData`; fix the `'PRP Injection'` fallback (line 111) to derive from `procedure_type`.

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npx tsc --noEmit` (exit 0)
- [x] ~~PDF template test~~ DEVIATION: no note-template test harness exists (only consent-template tests exported constants). BOTOX slot-12 label string is covered by the `procedureNoteSectionLabelsFor` test (Phase 4); the render swap duplicates that string. Full render assertion needs a react-pdf harness = out of scope; covered by Phase 5 manual step.
- [x] Lint passes: `npx eslint <phase-5 files>` (0 errors; 2 pre-existing react-pdf alt-text warnings untouched)
- [x] Full suite: `npm test` (1157 passed)

#### Manual Verification:
- [ ] Finalize a BOTOX note → PDF shows Product & Preparation + Injection Map, correct header (no PRP wording), matches packet layout

---

## Phase 6: Record dialog — type selector + BOTOX form

### Overview
Add a `procedure_type` selector to the record dialog and a BOTOX form variant (dosing block + per-muscle points/units grid), submitting via the Phase 3 actions.

### Changes Required:

#### 1. Type selector + branched form
**File**: `src/components/procedures/record-procedure-dialog.tsx`
**Changes**: Add a type selector at the top (PRP default, BOTOX). When BOTOX: title "Record BOTOX Procedure", swap the "PRP Prep" section for a "Product & Dosing" section (product/NDC/lot/expiration/reconstitution units + diluent), swap anesthesia/injection sections for a per-muscle grid (muscle from `BOTOX_MUSCLE_OPTIONS`, side, points, units) plus units_administered/units_discarded with live vial-reconciliation feedback. Use `botoxProcedureFormSchema`; submit via `createBotoxProcedure`/`updateBotoxProcedure`.

#### 2. Consent template (placeholders)
**File**: `src/lib/pdf/procedure-consent-template.tsx`
**Changes**: Add a BOTOX consent variant selected by procedure type. Insert `{/* TODO(clinic): BOTOX consent legal text — title, description, risks (dysphagia, toxin spread, asymmetry, chewing weakness, smile changes), contraindications (neuromuscular disorders, aminoglycosides, pregnancy/lactation), off-label statement */}` placeholders. Do NOT invent legal copy.

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npx tsc --noEmit` (exit 0)
- [x] Production build passes: `npm run build` (all routes incl. /patients/[caseId]/procedures compiled)
- [x] Lint passes: `npx eslint <phase-6 files>` (0 errors; pre-existing react-pdf alt-text warnings only)
- [x] Full suite: `npm test` (1157 passed)

Implementation notes:
- Built as a **separate `RecordBotoxDialog`** + `BotoxMuscleEditor` (not a branched PRP dialog) so the PRP dialog is untouched. A dropdown ("Record Procedure" → PRP / BOTOX) picks the create dialog; edit routes by `editingProcedure.procedure_type`. `ProcedureInitialData` gained `procedure_type` + `botox_dosing`.
- Live vial-reconciliation banner (green/amber) shows admin+discarded vs vial total and per-muscle units sum vs administered.
- Consent template: added a `BotoxConsentPdf` variant selected by `procedureType`, with `TODO(clinic)` placeholders for all legal content (description, risks, contraindications, benefits/alternatives). No legal copy authored. Extracted shared `ConsentHeader`/`ConsentIdentity`/`SignatureBlock` — PRP body unchanged.
- PRP dialog trigger now suppressed when `open` is controlled (so the dropdown-controlled create path shows no stray button).

#### Manual Verification:
- [ ] Select BOTOX in the dialog → dosing + per-muscle grid appears; entering 20/20/10/10 units with 60 administered + 40 discarded on a 100-U vial passes validation; mismatches show the reconciliation error
- [ ] Full flow: record BOTOX → generate note → finalize → PDF, end to end

**Implementation Note**: Pause for manual confirmation before Phase 7.

---

## Phase 7: Billing — per-unit admin, waste, and facility lines

### Overview
Add a BOTOX line-generation branch to `getInvoiceFormData` producing three lines from `botox_dosing`: per-unit admin (`units_administered × unit_price`), waste (`units_discarded × unit_price`), and a flat facility fee.

### Changes Required:

#### 1. Service catalog entries
**File**: seed / `service_catalog` rows (via SQL or the catalog UI)
**Changes**: Add catalog entries for the BOTOX unit price ($/U) and the BOTOX facility flat fee, keyed by CPT/service code (e.g. a `PI-CASH`-style code and a facility code). Since `service_catalog` is `cpt_code → default_price`, pick stable codes and read them in billing.

#### 2. BOTOX billing branch
**File**: `src/actions/billing.ts` (procedure loop ~275-345)
**Changes**: When `proc.procedure_type === 'botox'`, instead of the PRP CPT-composite line, emit:
- Admin line: `quantity = botox_dosing.units_administered`, `unit_price = <botox $/U from catalog>`, `description = "BOTOX onabotulinumtoxinA administered — <muscles>"`, `procedure_id` set.
- Waste line: `quantity = botox_dosing.units_discarded`, same `unit_price`, `description = "Unavoidable discarded BOTOX drug allocation (JW)"`.
- Facility line (in `facilityLineItems`): flat BOTOX facility fee from catalog.
Fetch `botox_dosing` + `procedure_type` in the procedures query feeding this loop.

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npx tsc --noEmit` (exit 0)
- [x] Billing tests pass: `npm test -- botox-lines` (5 tests: admin $900 + waste $600, reconciliation 60+40=100, whole-vial, null dosing, facility $200)
- [x] Lint passes: `npx eslint src/actions/billing.ts src/lib/billing/botox-lines.ts` (0 errors; 1 pre-existing billing.ts warning untouched)
- [x] Full suite: `npm test` (1162 passed)

Implementation note: BOTOX line-computation extracted to a pure module `src/lib/billing/botox-lines.ts` (`computeBotoxDrugLineItems` / `computeBotoxFacilityLineItem`) — `billing.ts` is `'use server'` and can only export async functions, so the testable logic lives in the pure module and is imported. Billing codes `BOTOX-UNIT` ($/U) + `BOTOX-FACILITY` (flat) read from `service_catalog`, falling back to $15/U and $200 when absent. The `getInvoiceFormData` DB integration is covered by the manual step (no Supabase-mock harness exists for it, same as procedures.ts).

#### Manual Verification:
- [ ] Generate an invoice for the Sandaljian-style BOTOX procedure → lines show `60 U × $15 = $900` admin, `40 U × $15 = $600` waste, `$200` facility; total reconciles to the full 100-U vial
- [ ] PRP invoices unchanged (regression check)
- [ ] (Optional) seed `service_catalog` rows for `BOTOX-UNIT` and `BOTOX-FACILITY` to override the $15/$200 fallbacks

---

## Phase 8: Quality-review prose (optional polish, non-breaking)

### Overview
QC already functions on BOTOX cases (verified: no structural coupling). This phase only removes PRP-specific *wording* so reviews read accurately for BOTOX. Skippable without breaking anything.

### Changes Required:

#### 1. Type-neutral reviewer persona
**File**: `src/lib/claude/generate-quality-review.ts`
**Changes**: Line 109 persona "personal-injury PRP injection clinic" → "personal-injury pain-management injection clinic" (covers PRP + BOTOX). No logic change.

#### 2. Marketing-ban example wording
**File**: `src/lib/qc/voice-charter.ts`
**Changes**: Line 69 marketing-ban list names "PRP, regenerative therapy" as example domain — leave as-is or add "neuromodulator/BOTOX" to the example set. Cosmetic only.

#### 3. (Optional) QC visibility into procedure_type
**File**: `src/actions/case-quality-reviews.ts`
**Changes**: If desired, add `procedure_type` to the joined `procedures!inner(...)` select (line 87) and thread into the `procedureNotes` shape so the reviewer can reason type-aware. `computeSourceHash` picks this up automatically. Not required for correctness — QC works without it.

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npx tsc --noEmit` (exit 0)
- [x] Full suite: `npm test` (1162 passed)
- [x] Lint passes: `npx eslint src/lib/claude/generate-quality-review.ts` (0 errors)

Implementation note: applied only #1 (type-neutral QC reviewer persona). Left #2 (voice-charter marketing-ban example) as-is — it's an example list, editing the note-generators' shared charter would risk PRP note regen for no correctness gain. Skipped optional #3 (QC procedure_type visibility) — not required for correctness, adds surface.

#### Manual Verification:
- [ ] Run a quality review on a case containing a BOTOX procedure → completes without error, findings render, Fix action on a BOTOX procedure finding regenerates the correct section

---

## Regression Guarantees (existing functionality unaffected)

Explicit checks that PRP and shared features are not broken. These run as part of each phase's automated criteria but are called out here as the acceptance gate:

- [ ] **PRP record → note → PDF → invoice** unchanged: record a PRP procedure, generate + finalize note, generate invoice — identical output to pre-change (the `'prp'` branch is untouched; `createPrpProcedure`/`updatePrpProcedure` unmodified).
- [ ] **Note schema shape unchanged**: `procedureNoteSections` (20 keys), `procedureNoteResultSchema`, `procedureNoteEditSchema` are byte-for-byte identical → editor, PDF field set, and `procedure-note.test.ts` (asserts exactly 20 sections) pass unchanged.
- [ ] **Quality review on PRP cases** unchanged: gather allowlist, `computeSourceHash`, staleness detection, Fix-action regen all identical (no gathered field changed unless Phase 8 opt-in #3 is taken, which is additive).
- [ ] **QC Fix-action section routing** intact: `finding.section_key as ProcedureNoteSection` still resolves because the key set is fixed; `regenerateProcedureNoteSectionAction` sibling-section map unaffected.
- [ ] **Existing migrations/data**: BOTOX migration is additive (widen CHECK, add nullable column) — existing PRP rows have `botox_dosing = null` and validate/render exactly as before.
- [ ] **Timeline / procedure-table / case-summaries** render BOTOX rows without error (type-agnostic display) AND still render PRP rows identically.

## Testing Strategy

### Unit Tests:
- Vial reconciliation (administered + discarded === vial total) and per-site units-sum in `botoxProcedureFormSchema`.
- `createBotoxProcedure` persists `botox_dosing` + per-site units.
- BOTOX prompt excludes PRP prep language, includes product/units.
- Billing emits admin + waste + facility lines with correct quantities/prices.

### Integration Tests:
- End-to-end: record BOTOX → generate note → finalize PDF → generate invoice, asserting the packet's numbers.

### Manual Testing Steps:
1. Record a BOTOX procedure matching the Sandaljian masseter/temporalis case (R masseter 3pts/20U, L masseter 3pts/20U, R temporalis 2pts/10U, L temporalis 2pts/10U; 100-U vial, 3.0 mL diluent, 60 administered / 40 discarded).
2. Confirm vial reconciliation passes; break it (set discarded=30) and confirm the error.
3. Generate the note; confirm Product & Preparation + Injection Map sections and BOTOX wording.
4. Finalize; confirm PDF matches packet layout.
5. Generate invoice; confirm $900 admin + $600 waste + $200 facility.
6. Confirm a PRP procedure still records/generates/bills unchanged.
7. Run a quality review on a case with both a PRP and a BOTOX procedure; confirm it completes, findings render, and a Fix action on a BOTOX procedure finding regenerates the right section.
8. Confirm quality review on a PRP-only case is byte-identical to pre-change (same findings, same source hash).

## Performance Considerations
Negligible — one extra jsonb column and a few branched code paths. No new N+1 queries (botox_dosing fetched in existing single-row selects).

## Migration Notes
- Additive migration only (widen CHECK, add nullable column). No backfill; existing PRP rows have `botox_dosing = null`.
- Use a full timestamp migration prefix to avoid PK collision ([[feedback_supabase_dup_version_prefix]]); apply via `npx supabase db push` ([[feedback_supabase_migrations]]).
- Rollback: drop `botox_dosing`, revert CHECK to the three-value list (only if no BOTOX rows exist).

## References
- Research: `thoughts/shared/research/2026-07-16-therapeutic-botox-procedure.md`
- Reference packet: Sandaljian clinical packet (BOTOX note pages 9–12, billing pages 30–32)
- Tone/section pattern: `thoughts/shared/plans/2026-04-19-tone-direction-for-procedure-and-discharge-notes.md`
- Procedure-type seam origin: `thoughts/shared/plans/2026-04-27-procedure-defaults-and-polish.md`
