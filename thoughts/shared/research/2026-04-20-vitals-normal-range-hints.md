---
date: 2026-04-20T23:02:18Z
researcher: arsenaid
git_commit: 830eb88f5d91c8dd9aeaadbf64465bd84f3a00bf
branch: main
repository: cliniq
topic: "Add Vitals hints to show normal ranges for each parameter"
tags: [research, codebase, vitals, forms, shadcn-ui, clinical]
status: verified
last_updated: 2026-04-20
last_updated_by: arsenaid
last_updated_note: "Implemented: label normalization (commit abf77ea) + FormDescription normal-range hints (commit edbe7e3). Verified in browser."
implementation_commits:
  - abf77ea  # refactor: Vitals labeling update
  - edbe7e3  # feat: Vitals normal-range hints under each field
---

# Research: Add Vitals hints to show normal ranges for each parameter

**Date**: 2026-04-20T23:02:18Z
**Researcher**: arsenaid
**Git Commit**: 830eb88f5d91c8dd9aeaadbf64465bd84f3a00bf
**Branch**: main
**Repository**: cliniq

## Research Question

Document where and how vitals parameters are currently entered and displayed across the codebase, in order to identify the surfaces and patterns that would host "normal range" hints next to each parameter. Describe the existing JSX structure, validation schemas, hint/tooltip patterns already in the codebase, and current placeholder/label text used on each vitals field — without recommending changes.

## Summary

Three separate UI surfaces render vitals input forms: [initial-visit-editor.tsx](src/components/clinical/initial-visit-editor.tsx) (`VitalSignsCard`), [discharge-note-editor.tsx](src/components/discharge/discharge-note-editor.tsx) (`DischargeVitalsCard`), and [record-procedure-dialog.tsx](src/components/procedures/record-procedure-dialog.tsx) (inline `Vital Signs (optional)` section). All three render the same 8 fields — `bp_systolic`, `bp_diastolic`, `heart_rate`, `respiratory_rate`, `temperature_f`, `spo2_percent`, `pain_score_min`, `pain_score_max` — with structurally identical `FormField > FormItem > FormLabel + FormControl > Input + FormMessage` skeletons.

Each surface is backed by its own Zod schema that shares identical permissive technical bounds (e.g. HR 1–300, Temp 90–110 °F). No clinical reference range text or hint copy appears in any label, placeholder, schema message, or helper element today. Placeholders convey only unit notation (`mmHg`, `bpm`, `breaths/min`, `°F`, `%`, `0-10`, `—`).

A `FormDescription` shadcn/ui primitive is defined and exported from [form.tsx:125](src/components/ui/form.tsx#L125) with `aria-describedby` already wired to `FormControl`, but is **never rendered anywhere in the app**. Tooltip and Popover primitives exist but are used only on action buttons (tables, nav, icon buttons) and combobox/date-picker triggers — not on form inputs. The common hint-insertion point across all three surfaces is between `</FormControl>` and `<FormMessage />` inside each `FormItem`.

## Detailed Findings

### 1. Vitals Input Surfaces

#### Surface A — `VitalSignsCard` in Initial Visit Editor

File: [initial-visit-editor.tsx:1145](src/components/clinical/initial-visit-editor.tsx#L1145)
Used at lines [426](src/components/clinical/initial-visit-editor.tsx#L426) and [1842](src/components/clinical/initial-visit-editor.tsx#L1842).
Form instance `vitalsForm` at [line 1155](src/components/clinical/initial-visit-editor.tsx#L1155), resolver backed by `initialVisitVitalsSchema`.
Outer layout: single `<div className="grid grid-cols-3 gap-4">` at [line 1187](src/components/clinical/initial-visit-editor.tsx#L1187) — flat 3-column grid across all 8 fields.

Save handler reads `vitalsForm.getValues()` at [line 1171](src/components/clinical/initial-visit-editor.tsx#L1171) — no `handleSubmit`/Zod validation pass on save. Save button at [lines 1341–1350](src/components/clinical/initial-visit-editor.tsx#L1341-L1350), disabled when `isLocked || isSaving`.

Field-by-field:

| Field name | FormLabel text | Placeholder | HTML min | HTML max | Line range |
|---|---|---|---|---|---|
| `bp_systolic` | `BP Systolic` | `mmHg` | — | — | 1188–1205 |
| `bp_diastolic` | `BP Diastolic` | `mmHg` | — | — | 1206–1223 |
| `heart_rate` | `Heart Rate` | `bpm` | — | — | 1224–1241 |
| `respiratory_rate` | `Respiratory Rate` | `breaths/min` | — | — | 1242–1259 |
| `temperature_f` | `Temperature` | `°F` | — | — | 1260–1278 (`step="0.1"` at 1269) |
| `spo2_percent` | `SpO2` | `%` | `0` | `100` | 1279–1298 |
| `pain_score_min` | `Pain Score Min` | `0-10` | `0` | `10` | 1299–1318 |
| `pain_score_max` | `Pain Score Max` | `0-10` | `0` | `10` | 1319–1338 |

#### Surface B — `DischargeVitalsCard` in Discharge Note Editor

File: [discharge-note-editor.tsx:808](src/components/discharge/discharge-note-editor.tsx#L808)
Used at [line 249](src/components/discharge/discharge-note-editor.tsx#L249).
Form instance `vitalsForm` at [line 822](src/components/discharge/discharge-note-editor.tsx#L822), resolver backed by `dischargeNoteVitalsSchema`.
Outer layout: single `<div className="grid grid-cols-3 gap-4">` at [line 855](src/components/discharge/discharge-note-editor.tsx#L855) — flat 3-column grid.
Seed precedence documented inline: `note row > defaultVitals (last procedure) > null` at [lines 820–822](src/components/discharge/discharge-note-editor.tsx#L820-L822).

Save handler at `saveDischargeVitals(caseId, values)` via [line 839](src/components/discharge/discharge-note-editor.tsx#L839), calling `getValues()` — no Zod pass. Save button at [line 1009](src/components/discharge/discharge-note-editor.tsx#L1009).

Field ordering differs from Surface A — pain fields render first. Label text also differs (pain uses `(0–10)`; temperature uses `Temperature (°F)`; SpO2 uses `SpO₂ (%)` with Unicode subscript-2; pain placeholder is `—` em-dash).

| Field name | FormLabel text | Placeholder | HTML min | HTML max | Line range |
|---|---|---|---|---|---|
| `pain_score_min` | `Pain Min (0–10)` | `—` | `0` | `10` | 856–875 |
| `pain_score_max` | `Pain Max (0–10)` | `—` | `0` | `10` | 876–895 |
| `bp_systolic` | `BP Systolic` | `mmHg` | — | — | 896–913 |
| `bp_diastolic` | `BP Diastolic` | `mmHg` | — | — | 914–931 |
| `heart_rate` | `Heart Rate` | `bpm` | — | — | 932–949 |
| `respiratory_rate` | `Respiratory Rate` | `breaths/min` | — | — | 950–967 |
| `temperature_f` | `Temperature (°F)` | `°F` | — | — | 968–986 (`step="0.1"` at 977) |
| `spo2_percent` | `SpO₂ (%)` | `%` | `0` | `100` | 987–1006 |

#### Surface C — Inline section in Record Procedure Dialog

File: [record-procedure-dialog.tsx:771–955](src/components/procedures/record-procedure-dialog.tsx#L771-L955) (no sub-component).
Section header: `<h3>Vital Signs (optional)</h3>` at [line 773](src/components/procedures/record-procedure-dialog.tsx#L773), class `text-sm font-semibold text-muted-foreground uppercase tracking-wide`.
Outer layout: four separate `<div className="grid grid-cols-2 gap-4">` grids, each holding 2 fields, stacked vertically in a `<div className="space-y-4">` at [line 772](src/components/procedures/record-procedure-dialog.tsx#L772). Only surface using 2-column grids.

Field name prefix: `vital_signs.` (nested object path). Zod validation via `form.handleSubmit` runs at dialog submit (line 961) — only surface where the cross-field `.refine()` from `vitalSignsSchema` can surface an error on `pain_score_max`.

| Field name | FormLabel text | Placeholder | HTML min | HTML max | Grid div | Line range |
|---|---|---|---|---|---|---|
| `vital_signs.pain_score_min` | `Pain Min (0–10)` | `—` | `0` | `10` | 1 of 4 | 778–799 |
| `vital_signs.pain_score_max` | `Pain Max (0–10)` | `—` | `0` | `10` | 1 of 4 | 800–821 |
| `vital_signs.bp_systolic` | `BP Systolic` | `mmHg` | — | — | 2 of 4 | 825–844 |
| `vital_signs.bp_diastolic` | `BP Diastolic` | `mmHg` | — | — | 2 of 4 | 845–865 |
| `vital_signs.heart_rate` | `Heart Rate` | `bpm` | — | — | 3 of 4 | 868–887 |
| `vital_signs.respiratory_rate` | `Respiratory Rate` | `breaths/min` | — | — | 3 of 4 | 888–907 |
| `vital_signs.temperature_f` | `Temperature (°F)` | `°F` | — | — | 4 of 4 | 911–931 (`step="0.1"` at 920) |
| `vital_signs.spo2_percent` | `SpO2 (%)` | `%` | `0` | `100` | 4 of 4 | 932–953 |

### 2. Common JSX Skeleton (all three surfaces)

Every vitals field follows this shape. Only `name`, `FormLabel` text, `placeholder`, and optional `min`/`max`/`step` props vary:

```tsx
<FormField
  control={[form].control}
  name="[field_name]"
  render={({ field }) => (
    <FormItem>
      <FormLabel>[Label text]</FormLabel>
      <FormControl>
        <Input
          type="number"
          [step="0.1"]          /* temperature_f only */
          [min={n}]             /* spo2, pain fields only */
          [max={n}]             /* spo2, pain fields only */
          placeholder="[unit]"
          value={field.value ?? ''}
          onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      </FormControl>
      {/* <-- structural slot between FormControl and FormMessage */}
      <FormMessage />
    </FormItem>
  )}
/>
```

### 3. Validation Schemas

All three schemas share identical Zod field definitions:

| Field | Zod type | `.min()` | `.max()` | `.int()` |
|---|---|---|---|---|
| `bp_systolic` | number | 1 | 300 | yes |
| `bp_diastolic` | number | 1 | 200 | yes |
| `heart_rate` | number | 1 | 300 | yes |
| `respiratory_rate` | number | 1 | 60 | yes |
| `temperature_f` | number | 90 | 110 | no (decimal) |
| `spo2_percent` | number | 0 | 100 | yes |
| `pain_score_min` | number | 0 | 10 | yes |
| `pain_score_max` | number | 0 | 10 | yes |

Schema locations:
- `initialVisitVitalsSchema` — [initial-visit-note.ts:99-110](src/lib/validations/initial-visit-note.ts#L99-L110), type `InitialVisitVitalsValues` exported at line 110.
- `dischargeNoteVitalsSchema` — [discharge-note.ts:80-91](src/lib/validations/discharge-note.ts#L80-L91), type `DischargeNoteVitalsValues` exported at line 91. Preceding comment at [lines 75–79](src/lib/validations/discharge-note.ts#L75-L79) notes that these values are "used verbatim by the generator for the objective_vitals bullets."
- `vitalSignsSchema` — [prp-procedure.ts:8-28](src/lib/validations/prp-procedure.ts#L8-L28), type `PrpVitalSigns` exported at line 85, nested under `prpProcedureSchema.vital_signs` at line 75.

The `prp-procedure.ts` schema adds a cross-field `.refine()` at [lines 19–28](src/lib/validations/prp-procedure.ts#L19-L28) with message `'Pain minimum cannot exceed pain maximum'` on `path: ['pain_score_max']`. The other two schemas do not have this refine.

No clinical reference range text or hint copy appears in any schema message. Zod bounds are permissive technical bounds (e.g. HR 1–300 extends above any survivable rate; Temp 90–110 °F spans severe hypothermia to lethal hyperthermia). HTML `min`/`max` attributes on the `<Input>` elements are present only on `spo2_percent` and both pain score fields; absent on BP, HR, RR, Temp inputs.

### 4. Existing Hint / Helper / Tooltip Patterns in Codebase

#### `FormDescription` — defined, exported, unused

[form.tsx:125-136](src/components/ui/form.tsx#L125-L136) defines:

```tsx
function FormDescription({ className, ...props }: React.ComponentProps<"p">) {
  const { formDescriptionId } = useFormField()
  return (
    <p
      data-slot="form-description"
      id={formDescriptionId}
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}
```

`FormControl` at the same file wires `aria-describedby={formDescriptionId}` already, so `FormDescription` is ARIA-ready. **No file outside `form.tsx` imports or renders `<FormDescription>`.**

#### `FormMessage` — used everywhere for validation errors

Defined [form.tsx:138](src/components/ui/form.tsx#L138). Used on every vitals field (all three surfaces) as the trailing element inside `FormItem`.

#### Range in `FormLabel` text — inline parenthetical

Used today for pain fields in [record-procedure-dialog.tsx:783, 802](src/components/procedures/record-procedure-dialog.tsx#L783) and [discharge-note-editor.tsx:862, 882](src/components/discharge/discharge-note-editor.tsx#L862) as `Pain Min (0–10)` / `Pain Max (0–10)`. Also in [pt-extraction-form.tsx:203](src/components/clinical/pt-extraction-form.tsx#L203): `Pain Ratings (NPRS /10)`.

#### Unit-as-placeholder — current vitals pattern

`"mmHg"`, `"bpm"`, `"breaths/min"`, `"°F"`, `"%"`, `"0-10"`, `"—"` — all three vitals surfaces.

#### Example-value placeholder — `"e.g. ..."` elsewhere

Used throughout other forms but NOT vitals:
- [pt-extraction-form.tsx:277, 424, 651, 697, 733](src/components/clinical/pt-extraction-form.tsx#L277)
- [mri-extraction-form.tsx:114, 202, 897](src/components/clinical/mri-extraction-form.tsx#L114)
- [ortho-extraction-form.tsx:187, 266, 283](src/components/clinical/ortho-extraction-form.tsx#L187)
- [record-procedure-dialog.tsx:354, 474, 513, 603](src/components/procedures/record-procedure-dialog.tsx#L354)
- [provider-form-dialog.tsx:139, 153](src/components/settings/provider-form-dialog.tsx#L139)
- [pricing-catalog-form.tsx:209](src/components/settings/pricing-catalog-form.tsx#L209)

#### Section-header label — muted-foreground `<h3>`

Class `text-sm font-semibold text-muted-foreground uppercase tracking-wide`, found across record-procedure-dialog at lines [300, 418, 500, 569, 663, 773](src/components/procedures/record-procedure-dialog.tsx#L300). Also `text-sm font-medium text-muted-foreground` on [case-overview-edit-dialog.tsx:151, 308](src/components/patients/case-overview-edit-dialog.tsx#L151).

#### `Tooltip` / `TooltipContent` — action buttons only

Used on icon-only buttons in [case-sidebar.tsx:95-103](src/components/patients/case-sidebar.tsx#L95-L103) (`Coming Soon` on disabled nav) and [procedure-table.tsx:214-256](src/components/procedures/procedure-table.tsx#L214-L256) (procedure-note / delete buttons). Not used on any form input.

#### `Popover` / `PopoverContent`

Used for date-picker calendar at [wizard-step-identity.tsx:132-159](src/components/patients/wizard-step-identity.tsx#L132-L159) and CPT code combobox at [cpt-code-combobox.tsx:43-98](src/components/billing/cpt-code-combobox.tsx#L43-L98). `PopoverDescription` is defined at [popover.tsx:68](src/components/ui/popover.tsx#L68) but never rendered in the app.

#### Empty-state helper text

`<p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">No …. Click &quot;Add …&quot; to add one.</p>` — [pt-extraction-form.tsx:631](src/components/clinical/pt-extraction-form.tsx#L631), [mri-extraction-form.tsx:175](src/components/clinical/mri-extraction-form.tsx#L175).

#### Optionality signalled in label text

`(optional)` appended to `FormLabel` text: [wizard-step-identity.tsx:106](src/components/patients/wizard-step-identity.tsx#L106), [wizard-step-details.tsx:34-183](src/components/patients/wizard-step-details.tsx#L34-L183).

### 5. Data Model & Persistence

#### Database tables

- `public.vital_signs` table created in [013_prp_procedure_encounter.sql:16-49](supabase/migrations/013_prp_procedure_encounter.sql#L16-L49). Columns: `bp_systolic`, `bp_diastolic`, `heart_rate`, `respiratory_rate`, `temperature_f`, `spo2_percent` + FK to `case_id`, `procedure_id`. Indexes on `case_id` and `procedure_id` (lines 40–41). RLS at line 48.
- Pain columns added by [028_vital_signs_pain_score.sql](supabase/migrations/028_vital_signs_pain_score.sql): `pain_score_min`, `pain_score_max` with CHECK 0–10.
- Discharge vitals stored directly on `discharge_notes` via [20260421_discharge_notes_vitals.sql:8-15](supabase/migrations/20260421_discharge_notes_vitals.sql#L8-L15): same 8 columns.
- `objective_vitals text` (AI-generated narrative, not structured input) on `discharge_notes` [016_discharge_notes.sql:10](supabase/migrations/016_discharge_notes.sql#L10) and `procedure_notes` [015_procedure_notes.sql:14](supabase/migrations/015_procedure_notes.sql#L14).

#### Database types

- `vital_signs` Row/Insert/Update at [database.ts:832-943](src/types/database.ts#L832-L943).
- `vital_signs` JSONB shape on `prp_procedures` at [database.ts:2684-2765](src/types/database.ts#L2684-L2765).
- `objective_vitals: string | null` on `discharge_notes` ([database.ts:2072](src/types/database.ts#L2072)) and `procedure_notes` ([database.ts:2112](src/types/database.ts#L2112)).

### 6. Server Actions / API

- `getInitialVisitVitals(caseId)` — [initial-visit-notes.ts:776](src/actions/initial-visit-notes.ts#L776). Reads `vital_signs` row with `procedure_id IS NULL`.
- `saveInitialVisitVitals(caseId, vitals)` — [initial-visit-notes.ts:804](src/actions/initial-visit-notes.ts#L804). Upserts `vital_signs`; validates via `initialVisitVitalsSchema`.
- `getDischargeVitals(caseId)` — [discharge-notes.ts:888](src/actions/discharge-notes.ts#L888).
- `saveDischargeVitals(caseId, vitals)` — [discharge-notes.ts:907](src/actions/discharge-notes.ts#L907). Validates via `dischargeNoteVitalsSchema`.
- Discharge finalization requires `pain_score_max` — [discharge-notes.ts:664](src/actions/discharge-notes.ts#L664).
- Procedure vitals insert/upsert — [procedures.ts:142-157](src/actions/procedures.ts#L142-L157), [procedures.ts:310-344](src/actions/procedures.ts#L310-L344).
- Procedure-note pain-tone classification uses pain scores — [procedure-notes.ts:228-275](src/actions/procedure-notes.ts#L228-L275).

### 7. AI Generation Consumers

- [generate-procedure-note.ts:53](src/lib/claude/generate-procedure-note.ts#L53) — `vitalSigns` input type; pain rules at line 272; `objective_vitals` section rules at line 327.
- [generate-initial-visit.ts:459](src/lib/claude/generate-initial-visit.ts#L459) — `vitalSigns` input type; NUMERIC-ANCHOR pain trajectory rules at lines 247–251.
- `generate-discharge-note.ts` — consumes `latestVitals` and `dischargeVitals` for `objective_vitals` generation.

### 8. Tests covering vitals

- [initial-visit-note.test.ts:63-130](src/lib/validations/__tests__/initial-visit-note.test.ts#L63-L130) — valid/null/boundary/out-of-range cases for `initialVisitVitalsSchema`.
- [prp-procedure.test.ts:108-161](src/lib/validations/__tests__/prp-procedure.test.ts#L108-L161) — all-null, out-of-range, and `pain_score_min > pain_score_max` rejection for `vitalSignsSchema`.
- [generate-initial-visit.test.ts:77-86, 158-182](src/lib/claude/__tests__/generate-initial-visit.test.ts#L77-L86) — NUMERIC-ANCHOR prompt tests.

## Code References

- `src/components/clinical/initial-visit-editor.tsx:1145-1355` — `VitalSignsCard` sub-component rendering the initial-visit vitals form.
- `src/components/discharge/discharge-note-editor.tsx:808-1018` — `DischargeVitalsCard` sub-component.
- `src/components/procedures/record-procedure-dialog.tsx:771-955` — inline `Vital Signs (optional)` section.
- `src/components/ui/form.tsx:125-136` — `FormDescription` primitive, defined and unused.
- `src/components/ui/form.tsx:138` — `FormMessage` primitive.
- `src/lib/validations/initial-visit-note.ts:99-110` — `initialVisitVitalsSchema`.
- `src/lib/validations/discharge-note.ts:80-91` — `dischargeNoteVitalsSchema`.
- `src/lib/validations/prp-procedure.ts:8-28` — `vitalSignsSchema` with `.refine()` cross-field rule.
- `src/types/database.ts:832-943` — `vital_signs` table types.

## Architecture Documentation

### Shared patterns across the three vitals surfaces

- All three use the standard shadcn/ui form pattern via `FormField`, `FormItem`, `FormLabel`, `FormControl`, `Input`, `FormMessage` from [form.tsx](src/components/ui/form.tsx).
- All three render numeric `<Input>` controls with `value={field.value ?? ''}` and an `onChange` that converts empty strings to `null` and strings to `Number(...)`.
- Temperature is the only field carrying `step="0.1"` to permit one decimal.
- `spo2_percent`, `pain_score_min`, `pain_score_max` are the only fields with HTML `min`/`max` range attributes; BP, HR, RR, Temp do not carry them.
- Surfaces A and B use `grid grid-cols-3 gap-4`; Surface C uses four stacked `grid grid-cols-2 gap-4` groupings.
- Surfaces A and B save via `form.getValues()` (no Zod pass at save). Surface C uses `form.handleSubmit` and enforces `vitalSignsSchema.refine()`.
- The consistent structural slot for a hint is between `</FormControl>` and `<FormMessage />` inside each `FormItem`.

### Hint-style primitives available but not applied to vitals

- `FormDescription` — exported from [form.tsx](src/components/ui/form.tsx) and ARIA-ready via `aria-describedby` on `FormControl`; not rendered anywhere.
- `Tooltip` / `TooltipContent` — reserved today for icon-only action buttons (tables, sidebars).
- `Popover` / `PopoverContent` — reserved today for date-picker and CPT combobox widgets.
- `PopoverDescription` — exported, never rendered.

### Current vitals-specific hint surface area

- Unit appears in `placeholder` only (e.g. `mmHg`, `bpm`).
- Pain label carries scale parenthetical (`(0–10)`) only in Surfaces B and C; Surface A uses `Pain Score Min` / `Pain Score Max` without parenthetical.
- No clinical reference range or "normal" copy appears anywhere in any vitals field, label, description, schema message, or HTML attribute.

## Related Research

None found in `thoughts/shared/research/` prior to this document.

## Open Questions

- The three surfaces label some fields inconsistently (`Pain Score Min` vs `Pain Min (0–10)`; `Temperature` vs `Temperature (°F)`; `SpO2` vs `SpO₂ (%)`). Whether any planned hint/reference-range approach should normalise these labels is not captured in the codebase.
- Pediatric vs adult reference ranges differ widely (HR, RR especially). No patient-age-aware gating exists in any of the three surfaces today.
- No CLAUDE.md or design-doc under `thoughts/` defines a canonical "normal range" source for the 8 fields; any values would need to come from a clinical source not present in the repo at this commit.
