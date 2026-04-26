---
date: 2026-04-26T21:56:20+00:00
researcher: arsenaid
git_commit: 79a994fcdba7cbc0edf058a0b62ef5dc3b74c967
branch: main
repository: cliniq
topic: "PRP volume documentation when multiple sites are involved"
tags: [research, prp, procedures, volume, multi-site, billing, procedure-note]
status: complete
last_updated: 2026-04-26
last_updated_by: arsenaid
---

# Research: PRP Volume Documentation When Multiple Sites Are Involved

**Date**: 2026-04-26
**Researcher**: arsenaid
**Git Commit**: 79a994fcdba7cbc0edf058a0b62ef5dc3b74c967
**Branch**: main
**Repository**: cliniq

## Research Question
How does PRP volume documentation work today, and what is the current state of multi-site handling across schema, capture, generation, and billing?

> Note: Per the /research_codebase skill, this report documents the codebase as it exists. It maps where multi-site state is stored vs. unstructured, where each downstream consumer reads it, and which fields are scalar vs. site-derived. It does NOT recommend a redesign — those are surfaced as **Open Questions** at the bottom for a follow-up planning pass.

## Summary

PRP volume documentation in this codebase is a **single-procedure / single-volume-set model**: one `procedures` row carries one `injection_site` free-text string, one `laterality` enum, one `blood_draw_volume_ml`, one `injection_volume_ml`, and one `anesthetic_dose_ml`. Multi-site treatment is not a first-class concept — it is expressed by **comma-joining site names into the free-text `injection_site` column** (e.g. `"L4-L5, L5-S1"` or `"Cervical, Lumbar"`). All downstream consumers (LLM prompts for the procedure note, billing line-item count, plan-vs-performed alignment, PDF rendering) parse that one string.

Three separate parsers reconstruct multi-site structure from that one free-text field, each with its own grammar:

1. `parseBodyRegion` (intake → procedure default) — laterality prefix only, single region, no commas.
2. `extractLevels` in `compute-plan-alignment` — vertebral level regex (`L4-L5`, etc.).
3. `countInjectionSites` in `actions/billing.ts` — splits on `,;/&+` or "and" to count sites for invoice quantity.

The volume fields are scalars per procedure, never per-site; the LLM prompt instructs the model to render volumes as written and emit `[confirm injection volume in mL]` when null, but does not break volume down by site. The procedure note's `MULTI-LEVEL JUSTIFICATION RULE` and `PRIMARY PAIN GENERATOR RULE` are activated by detecting "2 or more spinal levels" inside `procedureRecord.injection_site`, which is the only multi-site signal the prompt receives.

## Detailed Findings

### Database Schema — One Row, Scalar Volumes

Migration [supabase/migrations/013_prp_procedure_encounter.sql:1-11](supabase/migrations/013_prp_procedure_encounter.sql#L1-L11) adds the site/laterality columns:

```sql
alter table public.procedures
  add column injection_site       text,
  add column laterality           text check (laterality in ('left', 'right', 'bilateral')),
  ...
```

Migration [supabase/migrations/014_prp_procedure_details.sql:1-30](supabase/migrations/014_prp_procedure_details.sql#L1-L30) adds the four scalar volume/dose columns:

```sql
add column blood_draw_volume_ml      numeric(6,1),  -- one number per procedure
add column anesthetic_dose_ml        numeric(6,1),
add column injection_volume_ml       numeric(6,1),
add column needle_gauge              text,
add column guidance_method           text check (guidance_method in ('ultrasound', 'fluoroscopy', 'landmark')),
```

Generated DB types confirm `procedures.injection_site: string | null`, `laterality: string | null`, `injection_volume_ml: number | null` — no array, no per-site sub-table ([src/types/database.ts:2272-2298](src/types/database.ts#L2272-L2298)).

There is no separate `procedure_sites` table, no `injection_volumes` join table, and no jsonb column structuring multi-site detail. `diagnoses` is jsonb, but it is a list of ICD-10 codes, not sites.

### Validation Schema — Scalar, No Per-Site Structure

[src/lib/validations/prp-procedure.ts:30-48](src/lib/validations/prp-procedure.ts#L30-L48) defines the zod schema as:

```ts
const prpPreparationSchema = z.object({
  blood_draw_volume_ml: z.number().positive('Blood draw volume is required'),
  centrifuge_duration_min: z.number().int().positive().nullable(),
  prep_protocol: z.string().optional(),
  kit_lot_number: z.string().optional(),
})

const injectionSchema = z.object({
  injection_volume_ml: z.number().positive('Injection volume is required'),
  needle_gauge: z.string().optional(),
  guidance_method: z.enum(['ultrasound', 'fluoroscopy', 'landmark']),
  target_confirmed_imaging: z.boolean().nullable(),
})
```

The top-level form schema ([src/lib/validations/prp-procedure.ts:57-85](src/lib/validations/prp-procedure.ts#L57-L85)) holds `injection_site: z.string().min(1)` and `laterality: z.enum(['left','right','bilateral'])` — both single-valued. There is no array of sites.

### Form UI — Free-Text Site, Single Volume Inputs

[src/components/procedures/record-procedure-dialog.tsx:372-384](src/components/procedures/record-procedure-dialog.tsx#L372-L384) renders the injection-site input as plain text:

```tsx
<FormField name="injection_site" render={({ field }) => (
  <FormItem>
    <FormLabel>Injection Site</FormLabel>
    <FormControl>
      <Input placeholder="e.g. Knee, Shoulder" {...field} />
    </FormControl>
  </FormItem>
)} />
```

The placeholder explicitly invites comma syntax (`"Knee, Shoulder"`). [record-procedure-dialog.tsx:441-519](src/components/procedures/record-procedure-dialog.tsx#L441-L519) renders one numeric input each for blood draw volume, anesthetic dose, and injection volume — none repeated per site. Static defaults are blood-draw 30 mL, injection 5 mL ([record-procedure-dialog.tsx:54-66](src/components/procedures/record-procedure-dialog.tsx#L54-L66)).

### Default Population from Intake — Comma-Joins Multiple Body Regions

[src/actions/procedures.ts:445-473](src/actions/procedures.ts#L445-L473) is the default-derivation path that pulls intake chief complaints and produces the pre-filled `injection_site` for a new procedure dialog:

```ts
const parsed = complaints
  .filter((c) => c.body_region && c.body_region.trim() !== '')
  .map((c) => parseBodyRegion(c.body_region))
  .filter((p) => p.injection_site !== '')

if (parsed.length > 0) {
  const sites = Array.from(new Set(parsed.map((p) => p.injection_site)))
  injection_site = sites.join(', ')   // ← multi-site collapsed into one string

  const lats = parsed.map((p) => p.laterality)
  if (lats.some((l) => l === null)) laterality = null
  else if (new Set(lats).size === 1) laterality = lats[0]
  else laterality = 'bilateral'         // ← mixed left+right collapses to "bilateral"
}
```

Multi-site at the moment of pre-fill is preserved as a comma-joined string with deduplication; multi-laterality collapses to `'bilateral'` (or null when ambiguous).

### `parseBodyRegion` Helper — Single-Region Only

[src/lib/procedures/parse-body-region.ts:1-39](src/lib/procedures/parse-body-region.ts#L1-L39) handles one body region per call. It strips a laterality prefix, title-cases, and returns `{ injection_site, laterality }`. It does not split on commas. The "multi-site" comma-joining in `getProcedureDefaults` happens **outside** this helper, by mapping over many complaints.

### Plan Alignment — Reconstructs Levels Via Regex

[src/lib/procedures/compute-plan-alignment.ts:81-115](src/lib/procedures/compute-plan-alignment.ts#L81-L115) defines:

```ts
const VERTEBRAL_LEVEL_RE = /\b([CTL])\s*(\d{1,2})\s*[-–/]\s*(?:([CTLS])?\s*)?(\d{1,2})\b/gi
const SIMPLE_LEVEL_RE    = /\b([CTL])\s*(\d{1,2})\b/gi

function extractLevels(text: string): string[] {
  const levels = new Set<string>()
  const multi = text.matchAll(VERTEBRAL_LEVEL_RE)
  for (const m of multi) levels.add(`${m[1]}${m[2]}-${m[3] ?? m[1]}${m[4]}`)
  if (levels.size === 0) {
    for (const m of text.matchAll(SIMPLE_LEVEL_RE)) levels.add(`${m[1]}${m[2]}`)
  }
  return [...levels]
}
```

This is the second multi-site parser — it pulls vertebral levels out of the same `injection_site` free-text string, plus out of treatment-plan prose. In `computeMismatches` ([compute-plan-alignment.ts:262-282](src/lib/procedures/compute-plan-alignment.ts#L262-L282)) it computes set-difference between planned vs. performed levels and reports a `target_levels` mismatch.

`normalizeRegion` ([compute-plan-alignment.ts:53-98](src/lib/procedures/compute-plan-alignment.ts#L53-L98)) handles single-region synonyms only. When `injection_site` is `"Cervical, Lumbar"`, the normalizer's keyword-contains loop returns whichever of `cervical`/`lumbar` matches first in the dictionary iteration order, so a multi-region performed string is reduced to a single canonical region for body-region equality checks.

### Billing — Counts Sites by String-Splitting

[src/actions/billing.ts:23-30](src/actions/billing.ts#L23-L30) is the third multi-site parser:

```ts
function countInjectionSites(injectionSite: string | null | undefined): number {
  if (!injectionSite) return 1
  const parts = injectionSite
    .split(/,|;|\/|&|\+|\s+and\s+/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  return Math.max(1, parts.length)
}
```

Used at [billing.ts:256-285](src/actions/billing.ts#L256-L285) to derive line-item quantity for CPT `0232T 86999 76942`:

```ts
const quantity = countInjectionSites(typedProc.injection_site)
prePopulatedLineItems.push({
  cpt_code: '0232T\n86999\n76942',
  description: 'PRP preparation and injection with US guided' + ...,
  quantity,
  unit_price: unitPrice,
  total_price: unitPrice * quantity,
})
```

So invoice line-item quantity for a multi-site procedure is computed by tokenizing the same free-text `injection_site` string. The split grammar (`,;/&+ and`) is a superset of the one defined by `parseBodyRegion` and a different shape from `extractLevels`.

### Procedure Note Generation — Multi-Level Detected by Counting Levels in Free Text

[src/lib/claude/generate-procedure-note.ts:33-52](src/lib/claude/generate-procedure-note.ts#L33-L52) feeds the LLM a single `procedureRecord` object: scalar `injection_site`, scalar `laterality`, scalar `blood_draw_volume_ml`, scalar `injection_volume_ml`, etc. There is no per-site array.

The system prompt encodes multi-site behavior as text rules over that single string. From [generate-procedure-note.ts:453-458](src/lib/claude/generate-procedure-note.ts#L453-L458):

> **MULTI-LEVEL JUSTIFICATION RULE (MANDATORY when procedure_indication emits 2 or more level-bullets, OR when procedureRecord.injection_site names 2 or more spinal levels)**: Immediately after the bullet list, append one sentence justifying the multi-level intervention using concordance between imaging and symptom distribution. … Single-level procedures (one bullet, one level in injection_site) do NOT require this sentence — omit it.

> **PRIMARY PAIN GENERATOR RULE** … Required sentence: "Primary pain generator suspected at [LEVEL], with adjacent levels contributing." When evidence is ambiguous … use: "Pain generator distribution is diffuse across the treated levels without a clear primary level."

Volume rules ([generate-procedure-note.ts:472-511](src/lib/claude/generate-procedure-note.ts#L472-L511)) are scalar:
- `procedureRecord.blood_draw_volume_ml null` → emit `[confirm blood draw volume]`
- `procedureRecord.injection_volume_ml null` → emit `[confirm injection volume in mL]`
- "Approximately 30 mL of venous blood was drawn from the patient's left arm…" — no per-site breakdown.

The reference paragraph ([generate-procedure-note.ts:511](src/lib/claude/generate-procedure-note.ts#L511)) reads: *"Under ultrasound guidance, a 25-gauge spinal needle was inserted into the facet joint, … The PRP solution (5 mL) was injected slowly into the joint…"* — single-needle, single-volume narrative. When the prompt activates `MULTI-LEVEL JUSTIFICATION` for two or more vertebral levels, it adds a justification sentence but the volume sentence above remains scalar; the prompt does not instruct the model to allocate the `injection_volume_ml` across the named sites.

The `target_levels` mismatch from `planAlignment` is surfaced via the PLAN-COHERENCE RULE ([generate-procedure-note.ts:305-313](src/lib/claude/generate-procedure-note.ts#L305-L313)).

### Display Surfaces

- Procedure table column accessor `injection_site` ([src/components/procedures/procedure-table.tsx:93-98](src/components/procedures/procedure-table.tsx#L93-L98)) — renders the raw string.
- Procedure note editor display name ([src/components/procedures/procedure-note-editor.tsx:728-729](src/components/procedures/procedure-note-editor.tsx#L728-L729)): `${procedure_name} – ${injection_site}` — concatenates the comma-joined string into the title.
- PDF render ([src/lib/pdf/render-procedure-note-pdf.ts:108-127](src/lib/pdf/render-procedure-note-pdf.ts#L108-L127)) selects `injection_site, laterality, diagnoses` and emits `injectionSite: procedure?.injection_site || '—'` into the rendered PDF.
- Procedure consent PDF ([src/lib/pdf/render-procedure-consent-pdf.ts:76-82](src/lib/pdf/render-procedure-consent-pdf.ts#L76-L82)) maps `injection_site` → `treatmentArea`.

### Discharge Note — Reads Same Single Field

[src/lib/claude/generate-discharge-note.ts:35-369](src/lib/claude/generate-discharge-note.ts#L35-L369) consumes `procedures[].injection_site: string | null`. The opening paragraph rule (line 369) interpolates `[sites]` from the same comma-joined free-text input:

> "presents for follow-up after completing PRP treatment to [sites] on [last procedure date]"

## Code References

- `supabase/migrations/013_prp_procedure_encounter.sql:1-11` — adds `injection_site text`, `laterality` enum, `procedure_number`
- `supabase/migrations/014_prp_procedure_details.sql:1-30` — adds scalar `blood_draw_volume_ml`, `anesthetic_dose_ml`, `injection_volume_ml`, `guidance_method`
- `src/types/database.ts:2272-2298` — generated row type for `procedures` table
- `src/lib/validations/prp-procedure.ts:30-85` — zod schema, single-valued `injection_site`, scalar volumes
- `src/components/procedures/record-procedure-dialog.tsx:372-519` — single text field for site, single numeric inputs for volumes
- `src/actions/procedures.ts:103-141` — `createPrpProcedure` insert payload (scalar columns)
- `src/actions/procedures.ts:445-473` — `getProcedureDefaults` derives `injection_site` by comma-joining intake body regions
- `src/lib/procedures/parse-body-region.ts:1-39` — single-region parser (no comma support)
- `src/lib/procedures/compute-plan-alignment.ts:81-330` — second parser; vertebral-level regex; mismatch computation
- `src/actions/billing.ts:23-30` — third parser; splits `injection_site` to count sites for invoice quantity
- `src/actions/billing.ts:256-285` — invoice line-item construction reading `injection_site` directly into description
- `src/lib/claude/generate-procedure-note.ts:33-52` — LLM input shape (scalar volumes, scalar site)
- `src/lib/claude/generate-procedure-note.ts:453-458` — MULTI-LEVEL JUSTIFICATION + PRIMARY PAIN GENERATOR rules triggered by counting levels in `injection_site`
- `src/lib/claude/generate-procedure-note.ts:472-511` — DATA-NULL rules and reference text for `procedure_prp_prep` and `procedure_injection` (scalar volumes)
- `src/lib/claude/generate-discharge-note.ts:35-369` — discharge narrative reads same `injection_site` string
- `src/lib/pdf/render-procedure-note-pdf.ts:108-127` — PDF rendering uses raw `injection_site`
- `src/components/procedures/procedure-note-editor.tsx:728-729` — UI display name interpolates raw `injection_site`

## Architecture Documentation

**Single-row, single-volume model.** One `procedures` row per encounter holds:
- one `injection_site: text` (free-text, comma-joinable by convention)
- one `laterality: 'left' | 'right' | 'bilateral'`
- one `blood_draw_volume_ml: numeric(6,1)` covering whatever was drawn for the entire session
- one `injection_volume_ml: numeric(6,1)` covering the total volume injected across all sites
- one `anesthetic_dose_ml: numeric(6,1)` covering total local anesthetic
- one `guidance_method` enum, one `needle_gauge`, one `target_confirmed_imaging` boolean

**Multi-site is implicit and string-based.** Whenever multi-site behavior is needed, the codebase reconstructs structure by parsing the `injection_site` string. Three independent parsers exist, each with its own grammar:

| Consumer | Location | Splitter | Returns |
|----------|----------|----------|---------|
| Default pre-fill from intake | `actions/procedures.ts:454` | (does not split — joins) | comma-joined string |
| Plan alignment vertebral levels | `compute-plan-alignment.ts:81` | regex `[CTL]\d+[-/]…` | array of level codes |
| Plan alignment region | `compute-plan-alignment.ts:84-98` | first-keyword-contains | one canonical region |
| Billing line-item quantity | `actions/billing.ts:23` | `,;/&+` and " and " | integer count |
| Procedure-note LLM rules | system prompt at `generate-procedure-note.ts:453` | "2 or more spinal levels" — model-driven | activates rule branches |

**Volume scalars never decompose.** No code path stores or reads volume-per-site. The LLM prompt's `procedure_injection` reference paragraph narrates one needle insertion at one volume; when `procedureRecord.injection_site` names two levels the prompt adds a justification sentence after the bullet list but the injection volume sentence remains the same scalar number.

**Three grammars, one source string.** The site-tokenization grammars across `parseBodyRegion`, `extractLevels`, `normalizeRegion`, and `countInjectionSites` are not unified — they were each authored for their consumer's local need.

## Related Research

- `thoughts/shared/research/2026-03-11-epic-4-prp-procedure-alignment.md` — Epic 4 alignment research; original baseline for the schema fields.
- `thoughts/shared/research/2026-04-21-procedure-technique-treatment-plan-consistency.md` — plan-vs-performed coherence (the `planAlignment` consumer).

## Open Questions

(Items below are not present in the current codebase. They are surfaces a follow-up plan would need to decide on. This research does not recommend solutions.)

1. **Per-site volume allocation** — the model captures total `injection_volume_ml` once. Multi-site invoices multiply unit price by site count, but the chart does not record how many mL went into each site. A defensibility question at deposition: does the chart support that the billed quantity reflects discrete deliveries vs. one shared volume.
2. **`blood_draw_volume_ml` invariance across site count** — only one draw is captured per procedure, regardless of how many sites are injected. The procedure note narrates this as one draw.
3. **Single `laterality` for multi-site** — when intake contains mixed left+right body regions, `getProcedureDefaults` collapses to `'bilateral'`. A multi-site procedure that is e.g. "Right knee + Left shoulder" cannot be represented faithfully today (the laterality column will be `'bilateral'`, which is semantically about the same body region on both sides).
4. **Three independent parser grammars** — the splitters in `parseBodyRegion`, `extractLevels`, `normalizeRegion`, and `countInjectionSites` evolved separately. They agree on simple inputs but diverge on edge cases (e.g. `"L4-L5/L5-S1"` — billing counts 2, level extractor returns 2 levels, region normalizer picks the first keyword match).
5. **`target_levels` mismatch sensitivity** — `compute-plan-alignment.ts` regex emits canonical level codes from `injection_site`. A free-text entry like `"Lumbar facet joints"` (no level digits) yields zero extracted levels, so a planned `[L4-L5, L5-S1]` will report a `target_levels` mismatch even when the procedure was performed at exactly those levels but the provider did not type the level codes into the site field.
6. **Procedure-note `MULTI-LEVEL JUSTIFICATION RULE`** — the rule fires on "2 or more spinal levels" in `injection_site`, which is a model-detected condition. Non-spine multi-site (e.g. `"Knee, Shoulder"`) does not trigger the rule and is not given a corresponding multi-region justification template.
7. **No per-site `target_confirmed_imaging` / `needle_gauge` / `guidance_method`** — these are scalar per procedure. A session that uses ultrasound at one site and landmark at another has no way to capture that mix.
