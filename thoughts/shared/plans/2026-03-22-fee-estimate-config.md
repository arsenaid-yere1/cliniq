# Fee Estimate Configuration — Implementation Plan

## Overview

Add a `fee_estimate_config` table for configuring cost estimate line items with min/max price ranges and fee categories (Professional / Practice Center). Expose it via a new Settings tab. Pipe the configured fee ranges into the Initial Visit AI generation so the Treatment Plan's "Cost Estimate" sub-section uses real configured numbers instead of AI-fabricated values.

## Current State Analysis

- The Treatment Plan section (section 12) of the AI-generated Initial Visit note includes a "Cost Estimate" sub-section with "Professional Fees range + Practice/Surgery Center Fees range" — but the AI has **no access to actual pricing data** and fabricates or brackets the numbers.
- The `service_catalog` table exists for invoice pricing (CPT code → single `default_price`), but it lacks min/max ranges and fee categories. It serves a different purpose (billing) and should not be modified.
- The Settings page has 5 tabs; the Pricing tab manages the `service_catalog`. The fee estimate config needs its own tab.
- `InitialVisitInputData` passed to Claude includes patient, case, summary, clinic, provider, vitals, and ROM data — but no pricing/fee data.

### Key Discoveries:
- AI prompt at [generate-initial-visit.ts:87-92](src/lib/claude/generate-initial-visit.ts#L87-L92) instructs cost estimate as inline text
- `gatherSourceData()` at [initial-visit-notes.ts:19-123](src/actions/initial-visit-notes.ts#L19-L123) fetches 6 data sources but no pricing
- Settings tab pattern at [settings-tabs.tsx](src/components/settings/settings-tabs.tsx) — add type, prop, trigger, content
- CRUD pattern at [service-catalog.ts](src/actions/service-catalog.ts) and [pricing-catalog-form.tsx](src/components/settings/pricing-catalog-form.tsx)
- Migration pattern at [019_service_catalog.sql](supabase/migrations/019_service_catalog.sql)

## Desired End State

1. A `fee_estimate_config` table stores line items like "Initial Consultation", "PRP Injection (per region)", each with `fee_category` (`professional` or `practice_center`), `price_min`, and `price_max`.
2. Settings page has a "Fee Estimates" tab where the admin configures these items (add/edit/remove).
3. When generating an Initial Visit note, the system sums min/max per category and passes the totals to Claude.
4. Claude writes the Treatment Plan cost estimate sub-section using the real configured ranges (e.g., "Professional Fees: $2,500 – $5,000").
5. The provider can still edit the treatment plan text in draft mode if adjustments are needed.

### How to verify:
- Configure fee estimate items in Settings → Fee Estimates tab
- Generate an Initial Visit note for a case
- The Treatment Plan section should contain a cost estimate with the actual configured fee ranges
- Editing the treatment plan text in draft mode still works as before

## What We're NOT Doing

- Not modifying the existing `service_catalog` table (it stays as-is for billing/invoicing)
- Not adding per-case cost estimate overrides (the treatment plan text is already editable)
- Not adding cost estimate fields to the `initial_visit_notes` DB table (it stays as text in `treatment_plan`)
- Not changing the PDF template (cost estimate renders as part of the treatment plan text body, which already works)
- Not adding cost estimate to ortho/PM extractions (different feature)

## Implementation Approach

Follow the exact same CRUD + Settings tab pattern used for `service_catalog`. Create a new table, validation schema, server actions, and Settings form component. Then extend the AI generation pipeline to fetch and inject the fee data.

---

## Phase 1: Database Migration

### Overview
Create the `fee_estimate_config` table with seed data matching typical clinic fee items.

### Changes Required:

#### 1. New migration file
**File**: `supabase/migrations/026_fee_estimate_config.sql`

```sql
-- ============================================
-- FEE ESTIMATE CONFIGURATION
-- Configurable line items for the cost estimate
-- sub-section in the Initial Visit Treatment Plan.
-- Each item has a fee category and min/max range.
-- ============================================
create table public.fee_estimate_config (
  id                    uuid primary key default gen_random_uuid(),
  description           text not null,
  fee_category          text not null default 'professional'
                        check (fee_category in ('professional', 'practice_center')),
  price_min             numeric(10,2) not null default 0,
  price_max             numeric(10,2) not null default 0,
  sort_order            integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  created_by_user_id    uuid references public.users(id),
  updated_by_user_id    uuid references public.users(id)
);

create index idx_fee_estimate_config_category on public.fee_estimate_config(fee_category);

create trigger set_updated_at before update on public.fee_estimate_config
  for each row execute function update_updated_at();

alter table public.fee_estimate_config enable row level security;

create policy "Authenticated users full access" on public.fee_estimate_config
  for all using (auth.role() = 'authenticated');

-- ============================================
-- SEED DEFAULT FEE ESTIMATE ITEMS
-- All at $0 — admin sets real ranges in Settings
-- ============================================
insert into public.fee_estimate_config (description, fee_category, price_min, price_max, sort_order) values
  ('Initial Consultation',              'professional',     0, 0, 1),
  ('PRP Injection (per region)',         'professional',     0, 0, 2),
  ('MRI Review',                         'professional',     0, 0, 3),
  ('Follow-up / Discharge Visit',        'professional',     0, 0, 4),
  ('Practice/Surgery Center Fee',        'practice_center',  0, 0, 5);
```

#### 2. Regenerate Supabase types
Run `npx supabase gen types typescript --local > src/lib/supabase/database.types.ts` after applying the migration, then update `src/types/database.ts` to include the new `fee_estimate_config` table types.

### Success Criteria:

#### Automated Verification:
- [x] Migration applies cleanly: `npx supabase db reset`
- [x] Type generation succeeds: `npx supabase gen types typescript --local`
- [x] TypeScript compiles: `npm run typecheck`

#### Manual Verification:
- [ ] Query `select * from fee_estimate_config` returns 5 seeded rows
- [ ] Soft delete, audit fields, and `updated_at` trigger work as expected

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to the next phase.

---

## Phase 2: Backend — Validation Schema & Server Actions

### Overview
Create Zod validation schema and CRUD server actions for `fee_estimate_config`, plus an aggregate function that returns summed min/max per category.

### Changes Required:

#### 1. Validation schema
**File**: `src/lib/validations/fee-estimate.ts`

```typescript
import { z } from 'zod'

export const feeEstimateItemSchema = z.object({
  id: z.string().uuid().optional(),
  description: z.string().min(1, 'Description is required'),
  fee_category: z.enum(['professional', 'practice_center']),
  price_min: z.coerce.number().min(0, 'Min price must be non-negative'),
  price_max: z.coerce.number().min(0, 'Max price must be non-negative'),
  sort_order: z.coerce.number().int().optional(),
})

export type FeeEstimateItemFormValues = z.infer<typeof feeEstimateItemSchema>

// Aggregated fee ranges passed to AI generation
export interface FeeEstimateTotals {
  professional_min: number
  professional_max: number
  practice_center_min: number
  practice_center_max: number
}
```

#### 2. Server actions
**File**: `src/actions/fee-estimate.ts`

```typescript
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  feeEstimateItemSchema,
  type FeeEstimateItemFormValues,
  type FeeEstimateTotals,
} from '@/lib/validations/fee-estimate'

export async function listFeeEstimateConfig() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('fee_estimate_config')
    .select('*')
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })

  if (error) return { error: error.message, data: [] }
  return { data: data ?? [] }
}

export async function createFeeEstimateItem(values: FeeEstimateItemFormValues) {
  const parsed = feeEstimateItemSchema.safeParse(values)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: maxRow } = await supabase
    .from('fee_estimate_config')
    .select('sort_order')
    .is('deleted_at', null)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextSortOrder = (maxRow?.sort_order ?? 0) + 1

  const { data, error } = await supabase
    .from('fee_estimate_config')
    .insert({
      description: parsed.data.description,
      fee_category: parsed.data.fee_category,
      price_min: parsed.data.price_min,
      price_max: parsed.data.price_max,
      sort_order: nextSortOrder,
      created_by_user_id: user?.id,
      updated_by_user_id: user?.id,
    })
    .select()
    .single()

  if (error) return { error: error.message }
  revalidatePath('/settings')
  return { data }
}

export async function updateFeeEstimateItem(id: string, values: FeeEstimateItemFormValues) {
  const parsed = feeEstimateItemSchema.safeParse(values)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from('fee_estimate_config')
    .update({
      description: parsed.data.description,
      fee_category: parsed.data.fee_category,
      price_min: parsed.data.price_min,
      price_max: parsed.data.price_max,
      updated_by_user_id: user?.id,
    })
    .eq('id', id)
    .select()
    .single()

  if (error) return { error: error.message }
  revalidatePath('/settings')
  return { data }
}

export async function deleteFeeEstimateItem(id: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('fee_estimate_config')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/settings')
  return { success: true }
}

// Aggregate: sum min/max per category — used by AI generation
export async function getFeeEstimateTotals(): Promise<FeeEstimateTotals> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('fee_estimate_config')
    .select('fee_category, price_min, price_max')
    .is('deleted_at', null)

  const totals: FeeEstimateTotals = {
    professional_min: 0,
    professional_max: 0,
    practice_center_min: 0,
    practice_center_max: 0,
  }

  for (const item of data ?? []) {
    if (item.fee_category === 'professional') {
      totals.professional_min += Number(item.price_min)
      totals.professional_max += Number(item.price_max)
    } else {
      totals.practice_center_min += Number(item.price_min)
      totals.practice_center_max += Number(item.price_max)
    }
  }

  return totals
}
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `npm run typecheck`
- [x] Lint passes: `npm run lint`

#### Manual Verification:
- [ ] Can call `listFeeEstimateConfig()` and get seeded items
- [ ] `getFeeEstimateTotals()` returns correct sums after setting non-zero prices

**Implementation Note**: Pause here for confirmation before proceeding to Phase 3.

---

## Phase 3: Settings UI — Fee Estimates Tab

### Overview
Add a "Fee Estimates" tab to the Settings page with an inline-editable table (same pattern as the Pricing catalog). Columns: Description, Category (dropdown), Min Price, Max Price, delete button.

### Changes Required:

#### 1. Fee estimate form component
**File**: `src/components/settings/fee-estimate-form.tsx`

A new component modeled after `pricing-catalog-form.tsx` with these differences:
- Columns: Description (text input), Category (select: Professional / Practice Center), Min Price (number), Max Price (number)
- Uses `createFeeEstimateItem`, `updateFeeEstimateItem`, `deleteFeeEstimateItem` from `@/actions/fee-estimate`
- Same local item pattern: `LocalItem` with `localId`, dirty detection, parallel save
- Client-side validation: description required, prices non-negative, max ≥ min
- Empty state: "No fee estimate items configured. Add your first item to get started."
- Add button: "Add Item"

```typescript
interface FeeEstimateConfigItem {
  id: string
  description: string
  fee_category: string
  price_min: number
  price_max: number
  sort_order: number
}

interface LocalItem {
  localId: string
  id?: string
  description: string
  fee_category: string
  price_min: number
  price_max: number
  sort_order: number
}
```

Table layout:

| Description | Category | Min Price ($) | Max Price ($) | |
|---|---|---|---|---|
| [Initial Consultation] | [Professional ▾] | [$500] | [$1,000] | 🗑 |
| [PRP Injection (per region)] | [Professional ▾] | [$1,000] | [$2,000] | 🗑 |
| [Practice/Surgery Center Fee] | [Practice Center ▾] | [$800] | [$1,500] | 🗑 |

The Category column uses a `<Select>` (from shadcn/ui) with two options:
- `professional` → "Professional"
- `practice_center` → "Practice Center"

Default category for new rows: `'professional'`.

#### 2. Wire into Settings tabs
**File**: `src/components/settings/settings-tabs.tsx`

Changes:
- Import `FeeEstimateForm` from `./fee-estimate-form`
- Add `feeEstimateConfig: FeeEstimateConfigItem[]` to `SettingsTabsProps`
- Add `<TabsTrigger value="fee-estimates">Fee Estimates</TabsTrigger>` after the "Pricing" trigger
- Add `<TabsContent value="fee-estimates"><FeeEstimateForm initialData={feeEstimateConfig} /></TabsContent>`

#### 3. Fetch data in settings page
**File**: `src/app/(dashboard)/settings/page.tsx`

Changes:
- Import `listFeeEstimateConfig` from `@/actions/fee-estimate`
- Add to the `Promise.all`: `listFeeEstimateConfig()`
- Destructure as `{ data: feeEstimateConfig }`
- Pass `feeEstimateConfig={feeEstimateConfig ?? []}` to `<SettingsTabs>`

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `npm run typecheck`
- [x] Lint passes: `npm run lint`

#### Manual Verification:
- [ ] Settings page shows 6 tabs including "Fee Estimates"
- [ ] Seeded items appear in the table with correct descriptions and categories
- [ ] Can add a new row, fill in fields, and save
- [ ] Can edit an existing row's description, category, min/max and save
- [ ] Can delete an existing row (with confirmation dialog)
- [ ] Can remove an unsaved row instantly
- [ ] Save button is disabled when no changes exist
- [ ] Validation: empty description shows toast error, negative prices show toast error, max < min shows toast error
- [ ] After save, new rows get their DB IDs and behave as existing rows

**Implementation Note**: Pause here for confirmation before proceeding to Phase 4.

---

## Phase 4: AI Integration — Plug Fee Ranges into Generation

### Overview
Extend the AI generation pipeline so `gatherSourceData()` fetches fee estimate totals and passes them to Claude. Update the system prompt to use the actual configured values.

### Changes Required:

#### 1. Extend `InitialVisitInputData`
**File**: `src/lib/claude/generate-initial-visit.ts`

Add to the `InitialVisitInputData` interface:

```typescript
feeEstimate: {
  professional_min: number
  professional_max: number
  practice_center_min: number
  practice_center_max: number
} | null
```

#### 2. Update system prompt
**File**: `src/lib/claude/generate-initial-visit.ts`

Replace line 90:
```
Cost estimate sub-section: Professional Fees range + Practice/Surgery Center Fees range.
```

With:
```
Cost estimate sub-section: If feeEstimate data is provided in the source data, use the exact values:
"COST ESTIMATE:" sub-heading, then:
"• Professional Fees: ${professional_min} – ${professional_max}"
"• Practice/Surgery Center Fees: ${practice_center_min} – ${practice_center_max}"
Format dollar amounts with commas (e.g., $2,500 – $5,000). If all fee values are 0, omit the cost estimate sub-section entirely. If feeEstimate is null, use "[To be determined]" as placeholder.
```

#### 3. Update `gatherSourceData()`
**File**: `src/actions/initial-visit-notes.ts`

Changes:
- Import `getFeeEstimateTotals` from `@/actions/fee-estimate`
- Add `getFeeEstimateTotals()` to the `Promise.all` block (alongside case, summary, clinic, vitals queries)
- Add the result to the returned `InitialVisitInputData`:

```typescript
feeEstimate: feeEstimateTotals.professional_max > 0 || feeEstimateTotals.practice_center_max > 0
  ? feeEstimateTotals
  : null,
```

#### 4. Update section regeneration
**File**: `src/lib/claude/generate-initial-visit.ts`

The `regenerateSection()` function already passes the full `inputData` to Claude (line 322), so once `feeEstimate` is included in `InitialVisitInputData`, section regeneration for the treatment plan will automatically have access to fee data. No code changes needed here beyond the type extension in step 1.

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `npm run typecheck`
- [x] Lint passes: `npm run lint`

#### Manual Verification:
- [ ] Configure non-zero fee ranges in Settings → Fee Estimates
- [ ] Generate an Initial Visit note for a case
- [ ] The Treatment Plan section contains "COST ESTIMATE:" with the configured Professional Fees and Practice Center Fees ranges
- [ ] The dollar amounts match what was configured in Settings (summed per category)
- [ ] If all fees are $0, the cost estimate sub-section is omitted
- [ ] Regenerating the treatment plan section also picks up the fee data
- [ ] Editing the treatment plan text in draft mode still works as before

**Implementation Note**: Pause here for confirmation before proceeding to Phase 5.

---

## Phase 5: Tests

### Overview
Add validation schema tests and server action tests for fee estimate config.

### Changes Required:

#### 1. Validation schema tests
**File**: `src/lib/validations/__tests__/fee-estimate.test.ts`

Test cases:
- Valid item with all fields passes
- Missing description fails
- Invalid fee_category fails
- Negative price_min fails
- Negative price_max fails
- `z.coerce.number()` handles string input from HTML inputs
- Optional `id` and `sort_order` work for both create and update

#### 2. Server action tests (if test infrastructure supports it)
Follow the same pattern as existing action tests (e.g., `src/actions/__tests__/service-catalog.test.ts`):
- `listFeeEstimateConfig` returns items ordered by sort_order
- `createFeeEstimateItem` validates and inserts
- `updateFeeEstimateItem` validates and updates
- `deleteFeeEstimateItem` soft-deletes
- `getFeeEstimateTotals` correctly sums per category

### Success Criteria:

#### Automated Verification:
- [ ] All tests pass: `npm test`
- [ ] TypeScript compiles: `npm run typecheck`
- [ ] Lint passes: `npm run lint`

---

## Testing Strategy

### Unit Tests:
- Fee estimate validation schema (valid/invalid inputs, coercion)
- `getFeeEstimateTotals` aggregation logic (mixed categories, all zeros, single category)

### Integration Tests:
- CRUD lifecycle: create → list → update → delete → list (verify soft delete)

### Manual Testing Steps:
1. Apply migration, verify 5 seeded rows in DB
2. Open Settings → Fee Estimates tab, verify seeded items display
3. Set real prices (e.g., Initial Consultation: $500–$1,000 professional)
4. Add a new item, save, verify it persists on page reload
5. Delete an item, verify soft delete
6. Generate an Initial Visit note — verify Treatment Plan contains configured fee ranges
7. Regenerate just the Treatment Plan section — verify fee ranges appear
8. Set all fees to $0 — verify cost estimate is omitted from Treatment Plan
9. Edit treatment plan text in draft mode — verify editing still works

## Migration Notes

- The `fee_estimate_config` table is independent from `service_catalog` — no FK relationships
- Seed data uses $0 for all prices (same pattern as service catalog)
- Existing Initial Visit notes are not affected — only new generations will pick up fee data
- No data migration needed for existing records

## References

- Research: `thoughts/shared/research/2026-03-22-initial-visit-cost-estimate-and-settings-defaults.md`
- Service catalog pattern: `src/actions/service-catalog.ts`, `src/components/settings/pricing-catalog-form.tsx`
- AI generation: `src/lib/claude/generate-initial-visit.ts`, `src/actions/initial-visit-notes.ts`
- Migration pattern: `supabase/migrations/019_service_catalog.sql`
