---
date: 2026-03-22T00:00:00-07:00
researcher: Claude
git_commit: 3834383c45e34e79384b0cf154d5d1b174952e76
branch: main
repository: cliniq
topic: "Add cost estimate configuration to Initial Visit with defaults in Settings"
tags: [research, codebase, initial-visit, cost-estimate, settings, pricing, service-catalog, treatment-plan]
status: complete
last_updated: 2026-03-22
last_updated_by: Claude
last_updated_note: "Added follow-up research on AI prompt, PDF template, and user requirements"
---

# Research: Add Cost Estimate Configuration to Initial Visit with Defaults in Settings

**Date**: 2026-03-22
**Researcher**: Claude
**Git Commit**: 3834383
**Branch**: main
**Repository**: cliniq

## Research Question
How does the Initial Visit system currently work, how does the Settings/pricing system work, and what currently exists for cost estimates — to inform adding cost estimate configuration to Initial Visit with defaults specified in Settings?

## Summary

The Initial Visit is an AI-generated 15-section clinical note. The **Treatment Plan** section (section 12) already includes a **cost estimate sub-section** in its AI-generated text, with "Professional Fees range + Practice/Surgery Center Fees range" — but these are currently **hardcoded in the AI prompt** and generated as free-form text within the `treatment_plan` text column. There are no structured cost estimate fields in the database or UI.

The Settings page has a **Pricing tab** with a `service_catalog` table (CPT code → default price), but the catalog currently only has a single `default_price` column — no min/max ranges or fee category distinctions (Professional vs Practice Center).

The user wants: (1) cost estimates derived from the service catalog with min/max ranges, (2) split into Professional Fees and Practice Center Fees, (3) Settings-driven defaults, (4) summing all fees, (5) rendered in the Treatment Plan section under "Cost Estimate".

---

## Detailed Findings

### 1. How Cost Estimates Currently Work in the AI Prompt

The AI generation prompt in [generate-initial-visit.ts:87-92](src/lib/claude/generate-initial-visit.ts#L87-L92) instructs Claude:

```
12. TREATMENT PLAN (~2-3 short paragraphs + cost estimate):
Para 1: "Based on the patient's clinical presentation and diagnostic findings, I recommend a series of one to three PRP injections."
Bullet per target region (cervical, lumbar) with specific levels and guidance modality.
Cost estimate sub-section: Professional Fees range + Practice/Surgery Center Fees range.
Para 2: Brief conservative care recommendations...
```

The cost estimate is currently:
- Generated as **free-form text** by the AI within the `treatment_plan` string
- No structured data — just a text blob that includes fee ranges
- The AI has **no access to the actual service catalog prices** — it either makes up numbers or uses brackets
- No separate database fields for cost estimate data

### 2. Initial Visit Note Database & Validation

**Database table** `initial_visit_notes`:
- `treatment_plan text` — stores the entire treatment plan including the cost estimate as one text field
- No `cost_estimate_data`, `professional_fees`, or `practice_center_fees` columns exist
- `rom_data jsonb` — precedent for storing structured data alongside text sections

**Validation schema** ([initial-visit-note.ts](src/lib/validations/initial-visit-note.ts)):
- `treatment_plan: z.string().min(1)` — simple string, no structured cost data

### 3. Service Catalog (Current State)

**Table** `service_catalog`:
```sql
cpt_code       text not null,
description    text not null,
default_price  numeric(10,2) not null default 0,  -- single price, no min/max
sort_order     integer not null default 0,
```

**Seeded entries** (all $0 — admin sets prices):
| CPT | Description | Sort |
|-----|-------------|------|
| 99204 | Initial exam (45-60min) | 1 |
| 76140 | MRI review | 2 |
| 0232T | PRP preparation and injection | 3 |
| 86999 | Blood draw and centrifuge | 4 |
| 76942 | Ultrasound guidance | 5 |
| 99213 | Follow up / Discharge visit | 6 |

Current columns do NOT support:
- Min/max price ranges
- Fee category (Professional vs Practice Center)
- Which items should be included in an initial visit cost estimate

### 4. Settings Page Architecture

**Tabs** ([settings-tabs.tsx](src/components/settings/settings-tabs.tsx)):
- 5 tabs: Clinic Info, Provider Info, Clinic Logo, **Pricing**, Appearance
- Pricing tab renders `PricingCatalogForm` — an inline-editable table

**Pricing catalog form** ([pricing-catalog-form.tsx](src/components/settings/pricing-catalog-form.tsx)):
- Columns: CPT Code, Description, Default Price ($)
- Add/remove/save rows
- No concept of fee category, min/max, or "include in initial visit estimate"

**Clinic settings table** `clinic_settings`:
- Singleton with clinic info fields
- No pricing or cost estimate default fields

### 5. Initial Visit Editor Component

**Component** ([initial-visit-editor.tsx](src/components/clinical/initial-visit-editor.tsx)):
- `InitialVisitEditorProps` includes: `caseId`, `note`, `canGenerate`, `initialVitals`, `initialRom`, `clinicSettings`, `providerProfile`, `clinicLogoUrl`, `providerSignatureUrl`, `caseData`, `documentFilePath`
- No cost estimate data is passed to the editor
- The treatment plan section is edited as a plain `<Textarea>` — no structured cost estimate UI

**Page** ([initial-visit/page.tsx](src/app/(dashboard)/patients/[caseId]/initial-visit/page.tsx)):
- Fetches note, prereqs, vitals, clinic settings, provider, logo, signature
- Does NOT fetch service catalog or pricing data

### 6. AI Generation Data Flow

**Input data** (`InitialVisitInputData` in [generate-initial-visit.ts:194-246](src/lib/claude/generate-initial-visit.ts#L194-L246)):
- patientInfo, caseDetails, caseSummary, clinicInfo, providerInfo, vitalSigns, romData
- No pricing or cost estimate data is passed to the AI

**gatherSourceData()** in [initial-visit-notes.ts:19-123](src/actions/initial-visit-notes.ts#L19-L123):
- Fetches case, summary, clinic settings, vitals, provider
- Does NOT fetch service catalog

### 7. PDF Template

**Template** ([initial-visit-template.tsx](src/lib/pdf/initial-visit-template.tsx)):
- Renders `treatment_plan` as plain text via `SectionBody` component
- No special rendering for cost estimate — it's just part of the treatment plan text
- `SectionBody` handles bullets, sub-headings (ALL CAPS + colon), and paragraphs

### 8. Existing Cost Estimate Patterns (PM/Ortho)

The orthopedic and pain management extractions use per-treatment-item min/max:
```typescript
// orthopedic-extraction.ts
estimated_cost_min: z.number().nullable(),
estimated_cost_max: z.number().nullable(),
```
These are per-line-item estimates, different from the aggregate "Professional Fees" / "Practice Center Fees" concept needed here.

### 9. Billing System Integration

In [billing.ts:174-184](src/actions/billing.ts#L174-L184), when creating an invoice:
- If initial visit note exists → adds CPT 99204 line item at `priceMap['99204']`
- If MRI extraction exists → adds CPT 76140 line item
- For each PRP procedure → bundles 0232T + 86999 + 76942
- If discharge note exists → adds CPT 99213

This is the closest existing implementation to "sum of all service catalog fees."

---

## Code References

### AI Prompt & Generation
- [src/lib/claude/generate-initial-visit.ts:87-92](src/lib/claude/generate-initial-visit.ts#L87-L92) — Treatment plan section instructions with cost estimate
- [src/lib/claude/generate-initial-visit.ts:194-246](src/lib/claude/generate-initial-visit.ts#L194-L246) — `InitialVisitInputData` interface (no pricing data)
- [src/lib/claude/generate-initial-visit.ts:248-286](src/lib/claude/generate-initial-visit.ts#L248-L286) — `generateInitialVisitFromData()` function

### Initial Visit Editor & Page
- [src/app/(dashboard)/patients/[caseId]/initial-visit/page.tsx](src/app/(dashboard)/patients/[caseId]/initial-visit/page.tsx) — Route page (no pricing fetch)
- [src/components/clinical/initial-visit-editor.tsx](src/components/clinical/initial-visit-editor.tsx) — Editor component (no cost estimate UI)
- [src/actions/initial-visit-notes.ts](src/actions/initial-visit-notes.ts) — Server actions (no pricing integration)
- [src/lib/validations/initial-visit-note.ts](src/lib/validations/initial-visit-note.ts) — Schemas (treatment_plan is plain string)

### PDF
- [src/lib/pdf/initial-visit-template.tsx](src/lib/pdf/initial-visit-template.tsx) — Renders treatment_plan as plain text

### Settings / Pricing
- [src/components/settings/settings-tabs.tsx](src/components/settings/settings-tabs.tsx) — 5-tab settings container
- [src/components/settings/pricing-catalog-form.tsx](src/components/settings/pricing-catalog-form.tsx) — CPT/description/price table
- [src/actions/service-catalog.ts](src/actions/service-catalog.ts) — CRUD + `getServiceCatalogPriceMap()`
- [src/lib/validations/service-catalog.ts](src/lib/validations/service-catalog.ts) — Schema (single `default_price`)
- [supabase/migrations/019_service_catalog.sql](supabase/migrations/019_service_catalog.sql) — Table + seeds
- [supabase/migrations/007_clinic_provider_settings.sql](supabase/migrations/007_clinic_provider_settings.sql) — Clinic settings table

### Billing (reference for pricing integration)
- [src/actions/billing.ts:155-240](src/actions/billing.ts#L155-L240) — Pre-populates invoice line items from service catalog

### Existing Cost Estimate Pattern
- [src/lib/validations/orthopedic-extraction.ts:49-57](src/lib/validations/orthopedic-extraction.ts#L49-L57) — Per-item min/max
- [src/components/clinical/ortho-extraction-form.tsx](src/components/clinical/ortho-extraction-form.tsx) — Min/max cost inputs UI

---

## Architecture Documentation

### Current Cost Estimate Flow (AI-generated text only)
1. AI prompt tells Claude to include "Professional Fees range + Practice/Surgery Center Fees range" in treatment plan
2. Claude generates this as free-form text within the `treatment_plan` string column
3. No actual service catalog data is passed to the AI — fee amounts are fabricated or bracketed
4. The text renders in the PDF as part of the Treatment Plan section body
5. No structured data exists — the cost estimate is trapped inside a text blob

### Service Catalog → Billing Flow (existing pattern to model after)
1. Admin configures CPT codes with `default_price` in Settings → Pricing
2. `getServiceCatalogPriceMap()` returns `{ '99204': 250, '76140': 150, ... }`
3. `getInvoiceFormData()` uses this map to pre-populate invoice line items
4. Each line item has: `cpt_code`, `description`, `quantity`, `unit_price`, `total_price`

### Key Gaps for Implementation
1. **Service catalog lacks**: min/max price ranges, fee category (Professional vs Practice Center), "include in initial visit estimate" flag
2. **Initial visit note lacks**: structured cost estimate data (JSONB column similar to `rom_data`)
3. **AI generation lacks**: pricing data in input, structured cost output
4. **Editor/page lack**: cost estimate display/configuration UI
5. **Settings lack**: cost estimate defaults configuration (which services, which category, min/max)

---

## User Requirements (from follow-up)

1. Cost estimate should be **min/max** ranges, split into **Professional Fees** and **Practice Center Fees**
2. Should be **Settings-driven** — a new `fee_estimate_config` table with its own Settings UI
3. Should **sum all configured fees** per category to produce total min/max ranges
4. Currently shows in the **Treatment Plan section** under "Cost Estimate" (as AI-generated text) — keep it there
5. AI prompt should be fed actual fee ranges from the config so it plugs in real numbers
6. The treatment plan section is already editable in draft mode — providers can adjust text if needed

---

## Historical Context (from thoughts/)

- [thoughts/shared/plans/2026-03-13-epic-6-story-6.2-define-pricing-catalog.md](thoughts/shared/plans/2026-03-13-epic-6-story-6.2-define-pricing-catalog.md) — Original pricing catalog plan
- [thoughts/shared/research/2026-03-13-invoice-line-items-from-product-catalog.md](thoughts/shared/research/2026-03-13-invoice-line-items-from-product-catalog.md) — How invoice line items populate from catalog
- [thoughts/shared/plans/2026-03-09-epic-3-story-3.1-initial-visit-note.md](thoughts/shared/plans/2026-03-09-epic-3-story-3.1-initial-visit-note.md) — Initial visit note implementation plan
- [thoughts/shared/research/2026-03-09-epic-3-story-3.1-initial-visit-note-design.md](thoughts/shared/research/2026-03-09-epic-3-story-3.1-initial-visit-note-design.md) — Design research for initial visit note

---

## Related Research
- [thoughts/shared/research/2026-03-13-invoice-line-items-from-product-catalog.md](thoughts/shared/research/2026-03-13-invoice-line-items-from-product-catalog.md)
- [thoughts/shared/research/2026-03-08-epic-0-clinic-setup-design.md](thoughts/shared/research/2026-03-08-epic-0-clinic-setup-design.md)

---

## Resolved Design Decisions

1. **Fee categories**: Create a **separate `fee_estimate_config` table** with min/max ranges and fee categories (`professional` / `practice_center`). This is independent from the existing `service_catalog` table (which stays as-is for invoice pricing).

2. **Min/max ranges**: The new `fee_estimate_config` table has `price_min` and `price_max` per line item. These are NOT on `service_catalog` — they're a separate configuration specifically for cost estimates.

3. **Which services**: All items in `fee_estimate_config` are included and summed. No flag needed — if it's in the config, it's in the estimate.

4. **Per-case override**: The AI-generated Treatment Plan section (which includes the cost estimate text) is already editable in draft mode. No separate per-case override UI needed — the provider edits the text directly if needed.

5. **AI integration**: The AI prompt is updated to receive actual configured fee ranges from `fee_estimate_config`, and it plugs those numbers into the "Professional Fees" and "Practice Center Fees" sub-section of the treatment plan text.
