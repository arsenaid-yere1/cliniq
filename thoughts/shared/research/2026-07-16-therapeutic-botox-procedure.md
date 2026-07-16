---
date: 2026-07-16T15:10:18Z
researcher: arsenaid
git_commit: 44c265de991d5586ace2fb715e006155da0d5739
branch: main
repository: cliniq
topic: "Recording Therapeutic BOTOX procedures (against Sandaljian reference packet)"
tags: [research, codebase, procedures, procedure-type, botox, note-generation, billing]
status: complete
last_updated: 2026-07-16
last_updated_by: arsenaid
last_updated_note: "Rewrote against real BOTOX procedure note + billing from Sandaljian clinical packet"
---

# Research: Recording Therapeutic BOTOX Procedures

**Date**: 2026-07-16T15:10:18Z
**Researcher**: arsenaid
**Git Commit**: 44c265de991d5586ace2fb715e006155da0d5739
**Branch**: main
**Repository**: cliniq

## Research Question
Add a feature to record Therapeutic BOTOX (onabotulinumtoxinA) procedures, matching the note + billing format in the Sandaljian clinical packet.

## Reference document (source of truth)
The Sandaljian packet contains a real BOTOX procedure note (DOS 05/29/2026, pages 9–12) and two invoices (pages 30–32). This is the clinic-authored target format. Key facts extracted:

**BOTOX note structure (pages 9–12):**
Header: Patient, DOB, DOS, DOI, Reason for Visit, Visit Type ("Therapeutic Botox Procedure"), Procedure ("Bilateral masseter and temporalis onabotulinumtoxinA injections"). Then sections:
1. Subjective
2. Relevant Medical History
3. Social History
4. Review of Systems
5. Focused Pre-Procedure Examination (TMJ/masticatory muscles)
6. Indication
7. Assessment and Medical Necessity
8. Consent (off-label discussion; risks: pain, bruising, bleeding, infection, asymmetry, chewing weakness, smile changes, dysphagia, toxin spread)
9. **Product and Preparation** (Product/NDC/Lot/Expiration/Reconstitution/Needle table)
10. **Injection Map and Vial Reconciliation** (Site/Side/Points/Units/Volume table + total administered + discarded)
11. Procedure – Skin Preparation
12. Procedure – Injection
13. Immediate Post-Procedure Monitoring
14. Follow-Up
15. Diagnoses (M26.623, M79.11)
16. Prognosis
17. Clinician Disclaimer

**BOTOX dosing data (pages 10–11):**
- Product: BOTOX Cosmetic (onabotulinumtoxinA), 100-unit single-dose vial
- NDC 0023-9232-01, Lot D0801C2, Expiration 2028-03
- Reconstitution: 100 U in 3.0 mL preservative-free 0.9% NaCl (≈33.33 U/mL, 3.33 U/0.1 mL)
- Needle: 30-gauge, 1/2-inch
- Injection map: Masseter R 3pts/20U/0.60mL, Masseter L 3pts/20U/0.60mL, Temporalis R 2pts/10U/0.30mL, Temporalis L 2pts/10U/0.30mL
- Total administered: 10 points, 60 U, 1.80 mL. Discarded: 40 U, 1.20 mL. Reconciles to full 100-U vial.

**BOTOX billing (pages 30–31):**
- `PI-CASH` — administered drug + admin service: **60 U × $15/U = $900** (Dx M26.623, M79.11)
- `PI-WASTE` — discarded drug: **40 U × $15/U = $600** (JW-modifier-style waste line)
- Facility invoice (page 32): `FACILITY` Botox procedure-room/site utilization: **$200 flat**

## Summary

The existing procedure subsystem is a hard-coded **PRP** pipeline. BOTOX differs on four axes that the current schema/code does NOT model:

1. **Dosing model** — BOTOX = drug units per muscle (product/NDC/lot/expiration/reconstitution/units/discarded). PRP = blood-draw + centrifuge. No overlap. Needs new columns.
2. **Note sections** — the packet's BOTOX note has *Product and Preparation* + *Injection Map and Vial Reconciliation* sections that replace PRP's `procedure_prp_prep`. The AI prompt is a single fixed PRP narrative with no branching.
3. **Billing** — BOTOX bills **per-unit** with a separate **waste** line and a **flat facility fee**. Current billing has NO drug-unit, waste, or per-unit concept — `quantity` means injection-site count, price = catalog CPT sum.
4. **Sites/targets** — BOTOX targets named muscles (masseter, temporalis) with per-site *points* and *units*. Current `sites` jsonb models label/laterality/volume_ml; `TARGET_STRUCTURE_OPTIONS` is joint/spine only.

The `procedure_type` column already exists as the multi-type seam, currently pinned to `'prp'`.

## Detailed Findings

### The `procedure_type` seam (already exists, pinned to 'prp')
- DB: `procedures.procedure_type text not null default 'prp' check in ('prp','cortisone','hyaluronic')` — [20260503_procedure_defaults_and_type.sql:48-58](supabase/migrations/20260503_procedure_defaults_and_type.sql). Same constraint on `procedure_defaults`.
- TS union: [procedure-defaults.ts:7](src/actions/procedure-defaults.ts#L7), [billing.ts:289](src/actions/billing.ts#L289).
- Write hard-codes `'prp'` + `procedure_name: 'PRP Injection'`: [procedures.ts:129,152](src/actions/procedures.ts#L129).
- Only read-back: [billing.ts:295](src/actions/billing.ts#L295).
- **Adding `'botox'`**: widen both DB CHECK constraints + the TS union.

### Current `procedures` table (final column list)
From migration trace + [src/types/database.ts:2396-2430](src/types/database.ts#L2396-L2430):

Generic: `id`, `case_id`, `procedure_date`, `procedure_name`, `procedure_number`, `injection_site`, `sites jsonb` (non-empty), `diagnoses jsonb`, `consent_obtained`, `pain_rating`, `procedure_type`, `target_structure`, `plan_deviation_reason`, audit cols.
Injection (reusable): `anesthetic_agent`, `anesthetic_dose_ml`, `patient_tolerance`, `injection_volume_ml`, `needle_gauge`, `guidance_method`, `complications`, `supplies_used`, `compression_bandage`, `activity_restriction_hrs`.
**PRP-only (not for BOTOX):** `blood_draw_volume_ml`, `centrifuge_duration_min`, `prep_protocol`, `kit_lot_number`.

**Missing for BOTOX** (from packet pages 10–11): product name, NDC, lot, expiration, reconstitution (units + diluent volume), units administered, units discarded, per-site points + units. `needle_gauge` reusable (30-gauge). `injection_volume_ml` reusable but BOTOX is unit-controlled ("the unit dose is controlling", page 11).

### Note sections (current 20-section PRP schema)
Canonical list: [src/lib/validations/procedure-note.ts:3-49](src/lib/validations/procedure-note.ts#L3-L49) (`procedureNoteSections`, `procedureNoteSectionLabels`). Same 20 keys in:
- AI tool schema `PROCEDURE_NOTE_TOOL.required` — [generate-procedure-note.ts:739-781](src/lib/claude/generate-procedure-note.ts#L739-L781)
- PDF `sectionEntries` — [procedure-note-template.tsx:51-72](src/lib/pdf/procedure-note-template.tsx#L51-L72)
- Edit/result zod schemas — same file, `procedureNoteResultSchema` / `procedureNoteEditSchema`.

**Section mapping: current PRP → packet BOTOX note**

| PRP section | BOTOX packet equivalent | Change |
|---|---|---|
| subjective | Subjective | reusable |
| past_medical_history | Relevant Medical History | reusable |
| allergies | (in Relevant Med Hx) | reusable |
| current_medications | — | reusable/optional |
| social_history | Social History | reusable |
| review_of_systems | Review of Systems | reusable |
| objective_vitals | (packet has no vitals in BOTOX note) | optional |
| objective_physical_exam | Focused Pre-Procedure Examination | reusable, muscle-focused |
| assessment_summary | Assessment and Medical Necessity | reusable |
| procedure_indication | Indication | reusable, muscle/off-label wording |
| procedure_preparation | Consent + Skin Preparation | reusable, BOTOX consent risks |
| **procedure_prp_prep** | **Product and Preparation** + **Injection Map/Vial Reconciliation** | **REPLACE — BOTOX dosing tables** |
| procedure_anesthesia | (none — BOTOX packet has no separate anesthesia) | optional |
| procedure_injection | Procedure – Injection | reusable, unit-based wording |
| procedure_post_care | Immediate Post-Procedure Monitoring | reusable |
| procedure_followup | Follow-Up | reusable, ~3mo interval |
| assessment_and_plan | Diagnoses | reusable |
| patient_education | (folded into Consent/education) | optional |
| prognosis | Prognosis | reusable |
| clinician_disclaimer | Clinician Disclaimer | reusable |

Net: the 20-section skeleton largely carries. The one PRP-specific section (`procedure_prp_prep`) must be swapped for BOTOX product/dosing content. Section labels containing "PRP" and the prompt prose need a BOTOX variant.

### AI note generation (single fixed PRP prompt)
[src/lib/claude/generate-procedure-note.ts](src/lib/claude/generate-procedure-note.ts): one `SYSTEM_PROMPT` (lines 221-732), no `procedure_type` branching. PRP prose throughout: `procedure_prp_prep` section (537-549), "regenerative treatment"/"tissue regeneration" (532, 712-718), injection-series framing (598-612), "PRP Procedure Note" (222, 736). `ProcedureNoteInputData.procedureRecord` (37-66) carries PRP fields — would need BOTOX dosing fields added.
**BOTOX needs a distinct prompt variant** selected by `procedure_type`: off-label/chemodenervation framing, product/vial/units narration, ~3-month neuromodulator followup, no "regenerative" language.

### Record dialog (PRP-hardcoded, no type selector)
[src/components/procedures/record-procedure-dialog.tsx](src/components/procedures/record-procedure-dialog.tsx): title "Record PRP Procedure" (349), "PRP Prep" nav (52), section heading (474-477), `prep_protocol` default "ACP Double Syringe System" (64), field names `prp_preparation.*`. Validation [prp-procedure.ts](src/lib/validations/prp-procedure.ts) is a monolithic PRP schema (`blood_draw_volume_ml` required-positive, 35).
**BOTOX needs:** a type selector, a BOTOX dosing section (product/NDC/lot/expiration/reconstitution + per-muscle points/units grid), muscle-target site vocabulary, a `botoxProcedureFormSchema` (or discriminated union on `procedure_type`).

### Billing (no drug-unit / waste / per-unit concept)
[src/actions/billing.ts](src/actions/billing.ts): pricing flows from `service_catalog` × quantity, where quantity = injection-site count ([billing.ts:311-321](src/actions/billing.ts#L311-L321)). CPT from `procedure_defaults.default_cpt_codes` or `FALLBACK_CPT_CODES` (280). `charge_amount` was dropped from `procedures` (20260417). Facility items are a separate array priced by catalog description match (325-345).
`invoice_line_items` columns: `id, invoice_id, procedure_id, description, cpt_code, quantity, unit_price, total_price, display_order, service_date, created_at` — [database.ts:1392-1448](src/types/database.ts#L1392-L1448), zod [invoice.ts:3-13](src/lib/validations/invoice.ts#L3-L13).

**Absent, required by packet BOTOX billing:**
- **Per-unit drug pricing** — packet bills 60 U × $15/U. Current model has no `units` field; `quantity` ≠ drug units.
- **Waste line (`PI-WASTE`)** — packet bills 40 U discarded × $15/U as a separate line. No waste concept exists.
- **Flat facility fee** — packet BOTOX facility = $200 flat (vs PRP $12,000). Facility path exists but is catalog-description-matched, not BOTOX-aware.

The existing line-item schema (`quantity` + `unit_price` + `total_price` + free-text `description`) can *hold* a per-unit line (quantity=60, unit_price=$15) and a waste line (quantity=40, unit_price=$15) and a facility line — but the auto-population logic in `getInvoiceFormData` only knows PRP/visit/MRI/discharge line types. BOTOX line generation would be new code branched on `procedure_type === 'botox'`.

## Code References
- `supabase/migrations/20260503_procedure_defaults_and_type.sql:48-58` — procedure_type CHECK to widen
- `src/actions/procedures.ts:129,152` — hard-coded PRP name/type at insert
- `src/lib/validations/procedure-note.ts:3-49` — the 20 section keys + labels (3 places share them)
- `src/lib/claude/generate-procedure-note.ts:221-732,739-781` — PRP prompt + tool schema (`procedure_prp_prep`)
- `src/lib/pdf/procedure-note-template.tsx:51-72,192-200` — PDF sections + header block
- `src/components/procedures/record-procedure-dialog.tsx:52,64,349,474` — PRP copy, no type selector
- `src/lib/validations/prp-procedure.ts:34-39` — PRP-only prep schema
- `src/actions/billing.ts:275-345` — procedure + facility line generation (no units/waste)
- `src/types/database.ts:1392-1448` — invoice_line_items columns
- `src/types/database.ts:2396-2430` — procedures columns

## Architecture Documentation
Procedure record splits into **encounter record** (`procedures` table, `procedures.ts`) vs **generated note** (`procedure_notes` table, `procedure-notes.ts`). The 20-section note schema is shared across three files (validations / AI tool / PDF), so a BOTOX section change touches all three in lockstep. Procedure/discharge/initial_visit share tone_hint wiring via `narrative-directive.ts` ([[project_tone_direction_pattern]]).

## Feature scope (what BOTOX needs)

**Schema**
- Widen `procedure_type` CHECK + TS union to include `'botox'`.
- New nullable BOTOX dosing columns on `procedures` (or a `botox_dosing` jsonb): product_name, ndc, lot_number, expiration, reconstitution_units, reconstitution_diluent_ml, units_administered, units_discarded. Per-muscle points/units go in the `sites` jsonb (extend site shape with `points`, `units`).

**Validation / dialog**
- `botoxProcedureFormSchema`; `procedure_type` selector; BOTOX dosing section (product/vial/reconstitution + per-muscle points/units grid); muscle-target site vocabulary.

**Note generation**
- BOTOX prompt variant (off-label chemodenervation framing, product/vial/units narration, ~3mo followup). Swap `procedure_prp_prep` → BOTOX `procedure_botox_prep` (product + injection-map/vial-reconciliation) section, or make section set type-aware.

**PDF**
- BOTOX section labels; Product-and-Preparation + Injection-Map tables.

**Billing**
- BOTOX line generation branched on `procedure_type`: per-unit admin line (units × unit_price), separate waste line (discarded units × unit_price), flat facility fee. Needs a unit-price source (service_catalog entry for BOTOX $/U) and a waste concept.

## Decisions (locked 2026-07-16)
- **Dosing storage**: `botox_dosing` jsonb column on `procedures` (not flat columns). Per-muscle points/units extend the existing `sites` jsonb site shape.
- **Waste billing**: structured — BOTOX billing carries unit_price + units_administered + units_discarded; admin line + waste line auto-generate and reconcile to the vial (matches packet PI-CASH / PI-WASTE).
- **Consent legal text**: clinic supplies verbatim (confirmed earlier).

## Open Questions (for the plan)
- Should BOTOX be excluded from injection-*series* framing (procedure_number ordinal "Nth Injection")? Packet BOTOX note is a single administration, not a numbered series.
- BOTOX unit-price source: new `service_catalog` entry ($/U) vs a field on the dosing jsonb?
- Facility flat fee ($200) source: `service_catalog` entry vs constant.
