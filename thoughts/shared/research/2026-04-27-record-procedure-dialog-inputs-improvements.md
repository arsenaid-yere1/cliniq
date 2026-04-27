---
date: 2026-04-27T11:49:21-07:00
researcher: arsenaid
git_commit: d3d1bcc7bdfcb21240378f0777f161b9d0fb655a
branch: main
repository: cliniq
topic: "Record Procedure dialog inputs — current state + improvement suggestions for site defaults & PRP per-level volume"
tags: [research, procedures, prp, record-procedure-dialog, site-defaults, multi-site, compliance, billing]
status: complete
last_updated: 2026-04-27
last_updated_by: arsenaid
---

# Research: Record Procedure Dialog Inputs — Current State + Improvement Suggestions

**Date**: 2026-04-27T11:49:21-07:00
**Researcher**: arsenaid
**Git Commit**: d3d1bcc7bdfcb21240378f0777f161b9d0fb655a
**Branch**: main
**Repository**: cliniq

## Research Question
Suggest improvements to Record Procedure dialog inputs. Site defaults and PRP volume-per-level inputs can affect document compliance.

> Note: Per `/research_codebase` skill, sections 1–4 below document what exists. The user's args explicitly request improvement suggestions, so section 5 (Suggestions) provides them grounded in the current code. No code changes have been made.

## Summary

Record Procedure dialog at [src/components/procedures/record-procedure-dialog.tsx](src/components/procedures/record-procedure-dialog.tsx) is a single-row, scalar-volume form. It captures one free-text `injection_site`, one `laterality` enum, one `blood_draw_volume_ml`, one `injection_volume_ml`, one `anesthetic_dose_ml`. Multi-site treatment is encoded by **comma-joining** site names into one text field. Three independent parsers reconstruct multi-site structure downstream:

1. `parseBodyRegion` ([src/lib/procedures/parse-body-region.ts:6](src/lib/procedures/parse-body-region.ts#L6)) — single-region only, used in `getProcedureDefaults` to comma-join multiple intake regions.
2. `extractLevels` in [src/lib/procedures/compute-plan-alignment.ts:81](src/lib/procedures/compute-plan-alignment.ts#L81) — vertebral-level regex.
3. `countInjectionSites` in [src/actions/billing.ts:23](src/actions/billing.ts#L23) — splits on `,;/&+ and` to count CPT line-item units.

The "PER-SITE VOLUME ALLOCATION RULE" added 2026-04-26 (commit 3e4b5df) lives only in the LLM prompt at [src/lib/claude/generate-procedure-note.ts:506-522](src/lib/claude/generate-procedure-note.ts#L506-L522) — it tells Claude to name each site and acknowledge calibrated allocation **without** committing to a per-site mL number, because the chart records only a scalar total. The plan ([thoughts/shared/plans/2026-04-26-prp-per-site-volume-narration.md](thoughts/shared/plans/2026-04-26-prp-per-site-volume-narration.md)) explicitly chose **prompt-only, no schema/form change** to close the multi-site narration gap without forcing per-site mL entry on providers.

Static (hard-coded) defaults exist for blood draw volume, anesthetic agent/dose, injection volume, needle gauge, guidance method, activity restriction. Intake-derived defaults exist for `injection_site` + `laterality` + vital signs. There is no per-anatomy or per-procedure-type defaults table.

## Detailed Findings

### 1. Dialog Structure & Sections

[src/components/procedures/record-procedure-dialog.tsx](src/components/procedures/record-procedure-dialog.tsx) (1042 lines) defines six sections via `SECTIONS` ([record-procedure-dialog.tsx:43-50](src/components/procedures/record-procedure-dialog.tsx#L43-L50)):

- Encounter (procedure_date, laterality, injection_site, diagnoses, consent_obtained)
- PRP Prep (blood_draw_volume_ml, centrifuge_duration_min, prep_protocol, kit_lot_number)
- Anesthesia (anesthetic_agent, anesthetic_dose_ml, patient_tolerance)
- Injection (injection_volume_ml, needle_gauge, guidance_method, target_confirmed_imaging)
- Post-Procedure (complications, supplies_used, activity_restriction_hrs, compression_bandage)
- Vitals (pre-procedure, optional)

Plus a "Plan Deviation (optional)" textarea outside the section nav at [record-procedure-dialog.tsx:797-825](src/components/procedures/record-procedure-dialog.tsx#L797-L825).

### 2. Defaults — Static + Intake-Derived

**Static block** ([record-procedure-dialog.tsx:52-77](src/components/procedures/record-procedure-dialog.tsx#L52-L77)):

```ts
const STATIC_PROCEDURE_DEFAULTS = {
  consent_obtained: true,
  prp_preparation: { blood_draw_volume_ml: 30, centrifuge_duration_min: 5, prep_protocol: 'ACP Double Syringe System', kit_lot_number: '' },
  anesthesia:      { anesthetic_agent: 'Lidocaine 1%', anesthetic_dose_ml: 2, patient_tolerance: 'tolerated_well' },
  injection:       { injection_volume_ml: 5, needle_gauge: '25-gauge spinal', guidance_method: 'ultrasound', target_confirmed_imaging: true },
  post_procedure:  { complications: 'none', supplies_used: '', compression_bandage: true, activity_restriction_hrs: 48 },
}
```

These apply only when `!isEditing` ([record-procedure-dialog.tsx:228-274](src/components/procedures/record-procedure-dialog.tsx#L228-L274)).

**Intake-derived `ProcedureDefaults`** ([src/actions/procedures.ts:387-401](src/actions/procedures.ts#L387-L401)):

```ts
export interface ProcedureDefaults {
  injection_site: string | null
  laterality: 'left' | 'right' | 'bilateral' | null
  vital_signs: { bp_systolic, bp_diastolic, heart_rate, respiratory_rate, temperature_f, spo2_percent, pain_score_min, pain_score_max }
  earliest_procedure_date: string | null
}
```

`getProcedureDefaults` ([src/actions/procedures.ts:403-492](src/actions/procedures.ts#L403-L492)) reads the most recent `vital_signs` row + `initial_visit_notes`, prefers `pain_evaluation_visit` over `initial_visit`, runs each chief-complaint `body_region` through `parseBodyRegion`, dedupes, and **comma-joins** sites ([src/actions/procedures.ts:459-460](src/actions/procedures.ts#L459-L460)). Mixed laterality collapses to `'bilateral'` ([src/actions/procedures.ts:466-471](src/actions/procedures.ts#L466-L471)).

Static defaults cover **what to do**; intake defaults cover **where + on whom**. There is no per-anatomy table mapping (e.g.) "Knee → 27G needle, 4 mL" or per-procedure-type defaults (PRP-knee vs. PRP-spine vs. cortisone-shoulder).

### 3. Scalar Volume Schema — One Row, One Volume Set

zod schema [src/lib/validations/prp-procedure.ts:30-85](src/lib/validations/prp-procedure.ts#L30-L85):

```ts
const prpPreparationSchema = z.object({
  blood_draw_volume_ml: z.number().positive(),
  centrifuge_duration_min: z.number().int().positive().nullable(),
  ...
})
const injectionSchema = z.object({
  injection_volume_ml: z.number().positive(),
  needle_gauge: z.string().optional(),
  guidance_method: z.enum(['ultrasound', 'fluoroscopy', 'landmark']),
  target_confirmed_imaging: z.boolean().nullable(),
})
```

Top-level: `injection_site: z.string().min(1)`, `laterality: z.enum(['left','right','bilateral'])` — both single-valued. No array.

Insert at [src/actions/procedures.ts:103-141](src/actions/procedures.ts#L103-L141) writes scalar columns to one `procedures` row. No per-site sub-table.

### 4. Multi-Site Today — String + Three Parsers

`injection_site` placeholder at [record-procedure-dialog.tsx:379](src/components/procedures/record-procedure-dialog.tsx#L379) is `"e.g. Knee, Shoulder"` — comma syntax is invited.

| Consumer | Location | Splitter | Output |
|----------|----------|----------|--------|
| Pre-fill from intake | [actions/procedures.ts:459](src/actions/procedures.ts#L459) | dedupe + `join(', ')` | comma string |
| Plan-alignment levels | [compute-plan-alignment.ts:81](src/lib/procedures/compute-plan-alignment.ts#L81) | regex `[CTL]\d+[-/]…` | level codes |
| Plan-alignment region | [compute-plan-alignment.ts:53-98](src/lib/procedures/compute-plan-alignment.ts#L53-L98) | first-keyword-contains | one canonical region |
| Billing line-item qty | [billing.ts:23-30](src/actions/billing.ts#L23-L30) | `/,\|;\|/\|&\|\+\|\s+and\s+/i` | integer count |
| LLM multi-level rule | prompt at [generate-procedure-note.ts:453](src/lib/claude/generate-procedure-note.ts#L453) | model-side count | activates rule |

### 5. PRP Per-Site Volume Narration — Prompt Rule, No Form Field

Commit `3e4b5df` (2026-04-26) added `PER-SITE VOLUME ALLOCATION RULE` to the system prompt at [src/lib/claude/generate-procedure-note.ts:506-522](src/lib/claude/generate-procedure-note.ts#L506-L522):

- Triggers when `injection_site` parses to ≥2 distinct sites OR ≥2 vertebral level patterns.
- LLM must **name each site** and assert allocation was **calibrated to per-site pathology**.
- LLM **must not** emit a numeric per-site mL ("approximately X mL per site" listed under FORBIDDEN PHRASES).
- Total volume reported once via existing `injection_volume_ml`; null total → emits `[confirm total volume in mL]` only (the orphan `[confirm per-site mL allocation]` placeholder was dropped in commit `4a6582c`).
- Reference paragraphs cover spine multi-site (`L4-L5 and L5-S1`), spine null-volume, and non-spine multi-site (`right knee and the right shoulder`).

The plan doc [thoughts/shared/plans/2026-04-26-prp-per-site-volume-narration.md](thoughts/shared/plans/2026-04-26-prp-per-site-volume-narration.md) explicitly states **what was NOT done**: no DB column, no jsonb, no form change, no billing change, no parser unification. Defensibility rationale at lines 24-25: computing `total / N` and emitting "approximately X mL per site" would commit the note to a per-site number the provider never recorded — deposition risk plus violation of existing DATA-NULL RULE.

### 6. Billing Coupling

[src/actions/billing.ts:256-285](src/actions/billing.ts#L256-L285) constructs invoice line item using `countInjectionSites(injection_site)` as `quantity`, with a hard-coded composite CPT string `"0232T\n86999\n76942"` ("PRP preparation and injection with US guided"). The dialog's `guidance_method` choice **does not feed** the billing description — the invoice always says "US guided" regardless of whether `guidance_method = 'fluoroscopy'` or `'landmark'` was picked in the dialog.

### 7. Known Open Questions From Prior Research

[thoughts/shared/research/2026-04-26-prp-volume-multi-site-documentation.md:266-277](thoughts/shared/research/2026-04-26-prp-volume-multi-site-documentation.md) flagged but did not resolve:

1. Per-site volume allocation not stored — the chart cannot prove discrete per-site delivery for billed multi-unit invoices.
2. `blood_draw_volume_ml` invariant across site count.
3. `laterality` cannot represent "Right knee + Left shoulder" — collapses to `'bilateral'`.
4. Three independent parser grammars diverge on edge cases.
5. `target_levels` mismatch fires when provider types `"Lumbar facet joints"` instead of `L4-L5, L5-S1` even when the planned levels were performed.
6. `MULTI-LEVEL JUSTIFICATION RULE` is spine-only; non-spine multi-site has no analogous rule.
7. Per-site `target_confirmed_imaging` / `needle_gauge` / `guidance_method` not capturable.

## Code References

- `src/components/procedures/record-procedure-dialog.tsx:43-50` — section list
- `src/components/procedures/record-procedure-dialog.tsx:52-77` — `STATIC_PROCEDURE_DEFAULTS`
- `src/components/procedures/record-procedure-dialog.tsx:200-277` — `useForm` defaults wiring (intake → static fallback → null)
- `src/components/procedures/record-procedure-dialog.tsx:372-384` — `injection_site` free-text input ("e.g. Knee, Shoulder")
- `src/components/procedures/record-procedure-dialog.tsx:441-519` — PRP-prep + anesthesia inputs
- `src/components/procedures/record-procedure-dialog.tsx:592-682` — Injection section (volume, gauge, guidance)
- `src/components/procedures/record-procedure-dialog.tsx:797-825` — Plan-deviation textarea
- `src/lib/validations/prp-procedure.ts:30-85` — zod schema, scalar volumes
- `src/actions/procedures.ts:61-171` — `createPrpProcedure` (scalar insert)
- `src/actions/procedures.ts:387-492` — `ProcedureDefaults` interface + intake-derived defaults
- `src/lib/procedures/parse-body-region.ts:6-38` — single-region parser
- `src/lib/procedures/compute-plan-alignment.ts:81-115` — vertebral-level regex extractor
- `src/actions/billing.ts:23-30` — `countInjectionSites` (third parser)
- `src/actions/billing.ts:256-285` — invoice line-item with hard-coded "US guided" description
- `src/lib/claude/generate-procedure-note.ts:453-458` — `MULTI-LEVEL JUSTIFICATION RULE`
- `src/lib/claude/generate-procedure-note.ts:506-522` — `PER-SITE VOLUME ALLOCATION RULE`
- `src/lib/claude/generate-procedure-note.ts:472-511` — DATA-NULL rules + reference paragraphs

## Architecture Documentation

**Single-row scalar model.** One `procedures` row per encounter; volumes are scalar totals; `injection_site` is free text. Multi-site is implicit — encoded by punctuation in one column and reconstructed by three independent parsers downstream.

**Defaults are two-layered.** Static module-level constants for procedure mechanics; intake-derived defaults for site/laterality/vitals. No per-anatomy or per-procedure-type defaults table.

**Compliance compromise.** Multi-site narration was added at the prompt layer (LLM names each site, asserts calibrated allocation) without changing the chart schema, because committing to per-site mL the provider never recorded would be deposition-risk fabrication. The trade-off: chart still cannot prove per-site delivery for billing-quantity defense.

## Suggestions (Per User's Args)

The following improvements address compliance gaps the user's prompt called out: **site defaults** and **PRP volume per level**. Prioritized by compliance leverage; each labeled by scope (S1=prompt-only, S2=form-only, S3=schema+form+prompt).

### Tier A — Compliance-Critical, Form-Only (S2)

#### A1. Convert `injection_site` from free text → tag/chip multi-select

**Problem:** Three downstream parsers (`parseBodyRegion`, `extractLevels`, `countInjectionSites`) each apply different splitting grammars to the same string. Edge case from research doc: `"L4-L5/L5-S1"` — billing counts 2, level extractor returns 2, region normalizer picks one. Provider entry `"Lumbar facet joints"` (no level digits) → `target_levels` mismatch fires falsely, forcing the LLM to emit a plan-deviation rationale that does not exist.

**Change:** Replace [record-procedure-dialog.tsx:372-384](src/components/procedures/record-procedure-dialog.tsx#L372-L384) `<Input>` with a tag combobox that emits `string[]`. Persist as comma-joined string (back-compat) or as `text[]` column with a small migration. Tags suggested from intake `body_region` set + a static catalog of common joints/levels.

**Compliance leverage:**
- Eliminates parser ambiguity — site count is exact, level extraction is exact.
- `target_levels` mismatch only fires on real differences.
- Removes 4 of 7 open questions from the prior research doc.

**Why not done in 2026-04-26 plan:** That plan was scoped prompt-only to ship narration fast. This is the natural follow-up.

#### A2. Per-site volume input — repeating row UI, optional but encouraged

**Problem:** The prompt rule asserts "allocation was calibrated to per-site pathology" but the chart cannot back that claim. For multi-unit billing (`countInjectionSites ≥ 2` ⇒ `quantity = 2+` on CPT `0232T`), a deposition question of "show me documentation of the volume injected at each site" has no answer in the chart.

**Change:** When ≥2 sites are selected (after A1), expand a repeating row beneath the `injection_volume_ml` field — one row per site, each with `volume_ml` (number, optional) and `target_confirmed_imaging` (checkbox). Schema additions:

```ts
// prp-procedure.ts
const siteVolumeSchema = z.object({
  site_label: z.string().min(1),
  volume_ml: z.number().positive().nullable(),
  target_confirmed_imaging: z.boolean().nullable(),
})
const injectionSchema = z.object({
  injection_volume_ml: z.number().positive(),
  needle_gauge: z.string().optional(),
  guidance_method: z.enum(['ultrasound', 'fluoroscopy', 'landmark']),
  target_confirmed_imaging: z.boolean().nullable(),
  site_volumes: z.array(siteVolumeSchema).optional(),  // NEW
})
```

Cross-field refine: when `site_volumes` is non-empty AND all rows have `volume_ml`, assert `sum(site_volumes.volume_ml) === injection_volume_ml` (or warn if mismatch). When `site_volumes` is empty, prompt rule continues as today (qualitative narration).

**Storage:** New `procedure_site_volumes` table OR a jsonb column on `procedures`. jsonb is faster to ship; table is normalized for billing audits.

**Prompt update:** Replace `PER-SITE VOLUME ALLOCATION RULE` reference paragraphs at [generate-procedure-note.ts:519-522](src/lib/claude/generate-procedure-note.ts#L519-L522) to consume the new array when present, emitting concrete per-site mL only when **provider-entered** values exist; fall back to today's qualitative wording when absent.

**Compliance leverage:**
- Closes the "billed N units, charted 1 volume" gap.
- LCD/CPT defensibility: when audited for `0232T` per-unit, the chart now matches the invoice quantity.
- Per-site `target_confirmed_imaging` answers prior open question #7.
- Provider can opt out (leave per-site blank) and the existing prompt path runs unchanged — non-breaking.

#### A3. Multi-laterality fix — change `laterality` from scalar enum → per-site

**Problem:** Open question #3. `getProcedureDefaults` collapses mixed left+right body regions to `'bilateral'`, which is semantically "same body part on both sides", not "right knee + left shoulder".

**Change:** Move `laterality` onto each `site_volumes[]` row from A2. Top-level `laterality` becomes derived (computed: all-same → that value; mixed → `null` with UI hint "see per-site"). PDF + procedure-table display updates to render per-site laterality when present.

**Compliance leverage:** Charting accuracy for asymmetric multi-region procedures. Eliminates the `parseBodyRegion` mixed-laterality fudge at [src/actions/procedures.ts:466-471](src/actions/procedures.ts#L466-L471).

### Tier B — Site Defaults (Lookup Table)

#### B1. Per-anatomy defaults table

**Problem:** Static defaults at [record-procedure-dialog.tsx:52-77](src/components/procedures/record-procedure-dialog.tsx#L52-L77) are a single global block — `25-gauge spinal`, `5 mL injection`, `2 mL anesthetic`. Reasonable for lumbar facet PRP under ultrasound, off for knee (typically 22G, 4–6 mL) or shoulder (22–25G, 2–4 mL). Provider has to override every time.

**Change:** Add `procedure_defaults` table:

```sql
create table procedure_defaults (
  id uuid primary key,
  anatomy_key text not null,           -- 'lumbar_facet', 'cervical_facet', 'knee', 'shoulder', 'hip', 'sacroiliac'
  procedure_type text not null,         -- 'prp' for now; 'cortisone' / 'hyaluronic' future
  needle_gauge text,
  injection_volume_ml numeric(6,1),
  anesthetic_agent text,
  anesthetic_dose_ml numeric(6,1),
  guidance_method text check (guidance_method in ('ultrasound', 'fluoroscopy', 'landmark')),
  activity_restriction_hrs int,
  -- compliance fields
  default_cpt_codes text[],             -- references billing.ts hard-coded composite
  notes text,
  active boolean default true,
  unique (anatomy_key, procedure_type)
);
```

Keyed by anatomy that maps cleanly from `parseBodyRegion` output (`Knee`, `Lumbar Facet`, `Cervical Facet`, etc.). Seed with the current static block split per anatomy.

Wire into [record-procedure-dialog.tsx:200-277](src/components/procedures/record-procedure-dialog.tsx#L200-L277) `useForm` defaults: when site (after A1) is single-anatomy → look up that anatomy's defaults; multi-anatomy → leave blank (provider commits per-site values via A2).

**Compliance leverage:**
- Documentation consistency: same anatomy + same procedure type → same defensible volumes/gauges across providers.
- Billing alignment: `default_cpt_codes` per anatomy can replace the hard-coded `'0232T\n86999\n76942'` at [billing.ts:262](src/actions/billing.ts#L262), so non-spine PRP invoices stop saying "US guided" when fluoroscopy was used.
- Easier site-specific charting QA.

#### B2. Per-anatomy "approach" / "target structure" defaults

The procedure note's `TARGET-COHERENCE RULE` at [generate-procedure-note.ts:446-448](src/lib/claude/generate-procedure-note.ts#L446-L448) requires the LLM to choose between "periarticular/facet-capsular/paraspinal/SI-adjacent" (ultrasound/landmark) vs. "intradiscal/epidural/transforaminal" (fluoroscopy + level-named site). Today the LLM infers this from `guidance_method` + raw site text — provider has no way to commit a specific target language.

**Change:** Add `target_structure` enum field on `procedure_defaults` (B1) **and** as an optional select in the dialog's Injection section. Seeds: `'periarticular'`, `'facet_capsular'`, `'intradiscal'`, `'epidural'`, `'transforaminal'`, `'sacroiliac_adjacent'`, `'intra_articular'`. When set, prompt consumes it directly instead of inferring.

**Compliance leverage:** Removes LLM inference risk on one of the more legally sensitive narrative claims (intradiscal vs. periarticular has different consent + different LCD coverage).

### Tier C — Cheap Form Polish (S2, Low Risk)

#### C1. `needle_gauge` enum, not free text

[record-procedure-dialog.tsx:621-633](src/components/procedures/record-procedure-dialog.tsx#L621-L633) uses `<Input placeholder="e.g. 25-gauge spinal" />`. Compliance + audit benefit from a closed list (`22G`, `22G spinal`, `25G`, `25G spinal`, `27G`, `30G`). Free text invites typos that downstream PDF/note rendering must trust.

#### C2. `anesthetic_agent` enum

[record-procedure-dialog.tsx:530-543](src/components/procedures/record-procedure-dialog.tsx#L530-L543) free text. Closed list (`Lidocaine 1%`, `Lidocaine 2%`, `Bupivacaine 0.25%`, `Bupivacaine 0.5%`, `None`) prevents drug-name typos in narrative output, where they are hardest to QA.

#### C3. Cross-field validation: `consent_obtained = false` warning

If consent is unchecked, dialog should require `plan_deviation_reason` or block submit with toast. Today consent default is `true` ([record-procedure-dialog.tsx:53](src/components/procedures/record-procedure-dialog.tsx#L53)), so an unchecked submit is unusual — but the form does not gate it.

#### C4. Per-procedure-type variant of dialog

`STATIC_PROCEDURE_DEFAULTS` is hard-coded for PRP. The form title is `'Record PRP Procedure'`. A `procedure_type` field on `procedures` (with default `'prp'`) plus a `<Select>` at the top of the dialog that swaps the defaults block (PRP vs. cortisone vs. hyaluronic) is needed before any non-PRP procedures get charted. Currently any cortisone injection would mis-trigger the `procedure_prp_prep` LLM section.

### Tier D — Defer (Low Compliance Leverage Right Now)

- D1. Unify the three multi-site parsers. Cosmetic — the parsers agree on common inputs and A1 (tag combobox) sidesteps the issue at source.
- D2. Add `MULTI-SITE JUSTIFICATION RULE` for non-spine in the LLM prompt (open question #6). Lower priority than per-site mL capture.

## Compliance Mapping (Why These Suggestions, Specifically)

| Risk | Today | Suggestion |
|------|-------|------------|
| Multi-unit billing without per-site charting | Invoice `quantity = countInjectionSites(injection_site)`, chart has 1 scalar volume | A2 |
| `target_levels` false-positive mismatches in plan alignment | Free-text site `"Lumbar facet"` ⇒ 0 levels extracted ⇒ planned `[L4-L5, L5-S1]` reports mismatch | A1 |
| Asymmetric multi-region misrepresented | Mixed laterality collapses to `'bilateral'` | A3 |
| Wrong invoice description | Hard-coded "US guided" regardless of `guidance_method` | B1 (`default_cpt_codes` per anatomy) |
| Anatomy-inappropriate defaults | One global defaults block | B1 |
| Intradiscal vs. periarticular language inferred by LLM | Prompt rule `TARGET-COHERENCE` reasons from `guidance_method` + site text | B2 |
| Drug-name / gauge typos in chart narrative | Free text | C1, C2 |
| Cortisone procedures will mis-trigger PRP-only sections | One dialog, PRP-only defaults, PRP-only LLM sections | C4 |

## Suggested Sequencing

1. **A1 (tag combobox)** + **C1, C2 (enums)** — non-breaking form upgrades, immediately reduce parser ambiguity and typo risk.
2. **B1 (per-anatomy defaults table)** — unblocks B2 + makes A1's tag list authoritative.
3. **A2 (per-site volumes)** — biggest compliance lift; depends on A1 to know the sites.
4. **B2 (target_structure)** — small, follows B1.
5. **A3 (per-site laterality)** — depends on A2's array shape.
6. **C4 (procedure_type)** — required before any non-PRP procedure feature.
7. **C3 (consent gate)** — drop-in.

## Related Research

- [thoughts/shared/research/2026-04-26-prp-volume-multi-site-documentation.md](thoughts/shared/research/2026-04-26-prp-volume-multi-site-documentation.md) — full multi-site state survey + open questions list
- [thoughts/shared/plans/2026-04-26-prp-per-site-volume-narration.md](thoughts/shared/plans/2026-04-26-prp-per-site-volume-narration.md) — prompt-only plan that shipped 3e4b5df
- [thoughts/shared/research/2026-03-11-epic-4-prp-procedure-alignment.md](thoughts/shared/research/2026-03-11-epic-4-prp-procedure-alignment.md) — Epic 4 schema baseline
- [thoughts/shared/research/2026-04-18-prp-procedure-physical-exam-improvement-tone.md](thoughts/shared/research/2026-04-18-prp-procedure-physical-exam-improvement-tone.md) — tone integration

## Open Questions

- Storage decision for per-site volumes (A2): jsonb on `procedures` vs. new `procedure_site_volumes` table. Audit/billing teams may prefer normalized.
- Whether `procedure_defaults` (B1) should be tenant-scoped (per-clinic overrides) or static seed data. Multi-clinic tenants will have different protocols.
- Whether the `injection_site` text column should be retained as a derived display string after A1 ships, or fully replaced by the tag array. Affects PDF templates at [src/lib/pdf/render-procedure-note-pdf.ts:108-127](src/lib/pdf/render-procedure-note-pdf.ts#L108-L127) and [src/components/procedures/procedure-note-editor.tsx:728-729](src/components/procedures/procedure-note-editor.tsx#L728-L729).
- Whether changing `'0232T\n86999\n76942'` hard-coded composite at [billing.ts:262](src/actions/billing.ts#L262) requires a migration of historical invoices or only forward-looking.
