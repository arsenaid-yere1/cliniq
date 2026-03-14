---
date: 2026-03-13T00:00:00-07:00
researcher: arsen
git_commit: 18c165e4b2438f2c14af1e099937a263ba22ecf1
branch: main
repository: cliniq
topic: "How invoice line items are populated from the product/service catalog"
tags: [research, codebase, billing, invoices, service-catalog, pricing]
status: complete
last_updated: 2026-03-13
last_updated_by: arsen
---

# Research: How Invoice Line Items Are Populated from the Product Catalog

**Date**: 2026-03-13
**Researcher**: arsen
**Git Commit**: 18c165e
**Branch**: main

## Research Question
What is the best way to populate line items on an invoice from the product catalog?

## Summary

The system already implements a complete catalog-to-invoice pipeline. The `service_catalog` table stores CPT codes with default prices. When creating an invoice, the server action `getInvoiceFormData` fetches a price map from the catalog via `getServiceCatalogPriceMap()`, then uses those prices to build `prePopulatedLineItems` based on clinical data (procedures, initial visits, MRI reviews, discharge notes). These pre-populated line items are passed to the `CreateInvoiceDialog` as default form values, where the user can edit them before saving.

## Detailed Findings

### 1. Service Catalog (Pricing Source)

**Database table**: `service_catalog` — created in [019_service_catalog.sql](supabase/migrations/019_service_catalog.sql)

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | Primary key |
| `cpt_code` | text | CPT procedure code (indexed) |
| `description` | text | Human-readable service name |
| `default_price` | numeric(10,2) | Default unit price |
| `sort_order` | integer | Display order in admin UI |

Seeded with 6 entries (all at $0 — admin sets real prices):
- `99204` — Initial exam (45-60min)
- `76140` — MRI review
- `0232T` — PRP preparation and injection
- `86999` — Blood draw and centrifuge
- `76942` — Ultrasound guidance
- `99213` — Follow up / Discharge visit

**Admin UI**: [pricing-catalog-form.tsx](src/components/settings/pricing-catalog-form.tsx) — inline-editable table in Settings > Pricing tab. Uses `useState` (not react-hook-form), tracks dirty rows, saves via `createServiceCatalogItem`/`updateServiceCatalogItem` server actions.

### 2. Price Map Lookup

**File**: [service-catalog.ts:95-107](src/actions/service-catalog.ts#L95-L107)

`getServiceCatalogPriceMap()` fetches all active catalog entries and returns a `Record<string, number>` mapping CPT codes to default prices:

```typescript
// Returns e.g. { '99204': 250, '76140': 150, '0232T': 500, ... }
const priceMap = await getServiceCatalogPriceMap()
```

If multiple entries share a CPT code, the last one wins (by default DB order).

### 3. Invoice Line Item Pre-Population Flow

**File**: [billing.ts:56-252](src/actions/billing.ts#L56-L252) — `getInvoiceFormData(caseId)`

This is the core function that bridges the catalog to invoices. It:

1. **Fetches clinical data** in parallel (case, procedures, clinic settings, initial visit notes, PM extractions, MRI extractions, discharge notes)
2. **Fetches the price map** from the service catalog (line 155)
3. **Builds `prePopulatedLineItems`** array based on what clinical data exists for the case:

| Condition | CPT Code(s) | Price Source | Line in billing.ts |
|---|---|---|---|
| Initial visit note exists | `99204` | `priceMap['99204']` | 171-181 |
| Approved MRI extraction exists | `76140` | `priceMap['76140']` | 184-194 |
| Each PRP procedure | `0232T` + `86999` + `76942` (bundled) | Sum of 3 catalog prices, fallback to `procedures.charge_amount` | 197-226 |
| Discharge note exists | `99213` | `priceMap['99213']` | 229-239 |

**PRP bundle pricing logic** (lines 214-215):
```typescript
const prpBundlePrice = (priceMap['0232T'] ?? 0) + (priceMap['86999'] ?? 0) + (priceMap['76942'] ?? 0)
const catalogPrice = prpBundlePrice > 0 ? prpBundlePrice : Number(typedProc.charge_amount ?? 0)
```
If catalog prices are all $0, it falls back to the `charge_amount` stored on the procedure record itself.

### 4. Line Items in the Invoice Dialog

**File**: [create-invoice-dialog.tsx:149-151](src/components/billing/create-invoice-dialog.tsx#L149-L151)

The dialog receives `prePopulatedLineItems` via `formData` prop. For new invoices, these become the default `line_items` in the form:

```typescript
line_items: formData.prePopulatedLineItems.length > 0
  ? formData.prePopulatedLineItems
  : [{ service_date: '', cpt_code: '', description: '', quantity: 1, unit_price: 0, total_price: 0 }]
```

Each line item field (date, CPT, description, quantity, unit price) is fully editable. The `total_price` auto-calculates when quantity or unit price changes (line 166-170).

### 5. Data Flow Diagram

```
service_catalog (DB)
       │
       ▼
getServiceCatalogPriceMap()  →  Record<string, number>
       │
       ▼
getInvoiceFormData(caseId)
  ├── fetches clinical data (procedures, visits, MRIs, etc.)
  ├── looks up prices by CPT code from priceMap
  └── builds prePopulatedLineItems[]
       │
       ▼
BillingPageClient
       │
       ▼
CreateInvoiceDialog
  ├── uses prePopulatedLineItems as form defaults
  ├── user can edit all fields
  └── on save → createInvoice() → inserts invoice + invoice_line_items
```

### 6. Invoice Persistence

**File**: [billing.ts:254-307](src/actions/billing.ts#L254-L307) — `createInvoice()`

When the user saves, line items are inserted into `invoice_line_items` with the final `unit_price` and `total_price`. These are snapshots — changing catalog prices later does not affect existing invoices.

## Code References

- `supabase/migrations/019_service_catalog.sql` — Service catalog table definition and seed data
- `src/actions/service-catalog.ts:95-107` — `getServiceCatalogPriceMap()` builds CPT→price lookup
- `src/actions/billing.ts:155` — Price map fetched during invoice form data preparation
- `src/actions/billing.ts:171-239` — Line item builders using catalog prices
- `src/components/billing/create-invoice-dialog.tsx:149-151` — Pre-populated line items used as form defaults
- `src/components/billing/create-invoice-dialog.tsx:166-170` — Auto-calculation of total_price
- `src/components/settings/pricing-catalog-form.tsx` — Admin UI for managing catalog prices
- `src/lib/validations/invoice.ts` — Zod schemas for invoice and line items
- `src/lib/validations/service-catalog.ts` — Zod schema for catalog entries

## Architecture Documentation

The catalog-to-invoice pattern follows a **"defaults with override"** approach:
- Catalog provides default prices keyed by CPT code
- Clinical data determines which line items are generated (condition-driven)
- Users can override any value before saving
- Saved invoices snapshot prices at creation time (no retroactive changes)

The pre-population logic in `getInvoiceFormData` is **rule-based**: specific clinical records (initial visit, MRI, procedures, discharge) trigger specific line items with specific CPT codes. The catalog is purely a price lookup, not a line item driver.

## Historical Context

- `thoughts/shared/plans/2026-03-13-epic-6-story-6.2-define-pricing-catalog.md` — Full implementation plan for Story 6.2. Documents the design decisions: flat catalog table, inline editing, price map lookup pattern, PRP bundle pricing with fallback.
- `thoughts/shared/plans/2026-03-12-epic-6-story-6.1-create-invoice-from-procedure.md` — Story 6.1 plan that established the invoice creation flow.
- `thoughts/personal/tickets/epic-6/story-2.md` — Original ticket for pricing catalog feature.

## Open Questions

- The "Add Line Item" button on the invoice form adds a blank row — there is no picker/dropdown to select from the service catalog. A future enhancement could add a catalog item selector when adding manual line items.
- The catalog currently has no concept of categories or grouping (e.g., "PRP bundle" as a single catalog entry vs. 3 separate CPT codes).
