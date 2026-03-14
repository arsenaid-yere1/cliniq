# Catalog Item Picker for Invoice Line Items — Implementation Plan

## Overview

Add a combobox/popover to the CPT code field in invoice line items so users can search and select from the service catalog. Selecting a catalog item auto-fills the CPT code, description, and unit price. All fields remain editable after selection. Free-text entry is still supported for items not in the catalog.

## Current State Analysis

- **"Add Line Item" button** appends a blank row with empty CPT, description, and $0 price ([create-invoice-dialog.tsx:379-395](src/components/billing/create-invoice-dialog.tsx#L379-L395))
- **CPT code field** is a plain `<Input>` with no catalog awareness ([create-invoice-dialog.tsx:419-427](src/components/billing/create-invoice-dialog.tsx#L419-L427))
- **Service catalog data** is fetched server-side via `getServiceCatalogPriceMap()` but only used for pre-population — the full catalog items (with descriptions) are never sent to the client dialog
- **`listServiceCatalog()`** already exists and returns all active catalog items with `cpt_code`, `description`, `default_price`, `sort_order` ([service-catalog.ts:10-20](src/actions/service-catalog.ts#L10-L20))
- **Popover + Command (cmdk)** components are both installed in `src/components/ui/` but unused — these are the standard shadcn combobox building blocks
- **Grid layout** uses fixed column widths: `grid-cols-[100px_70px_1fr_50px_80px_36px]` — the CPT column is only 70px wide, which is tight for a combobox trigger

### Key Discoveries:
- `getInvoiceFormData` returns `prePopulatedLineItems` but NOT the full catalog list — we need to add `catalogItems` to the return payload
- The `InvoiceFormData` interface in the dialog needs a new `catalogItems` field
- The CPT column at 70px is too narrow for a combobox trigger with a dropdown icon — we should widen it slightly (to ~90px) or use the popover anchored to the input without a dropdown chevron

## Desired End State

Every line item row's CPT code field is a combobox. When the user focuses or types in it:
- A dropdown appears showing matching catalog items (filtered by CPT code or description)
- Selecting an item fills `cpt_code`, `description`, and `unit_price` (and recalculates `total_price`)
- The user can continue typing a custom CPT code without selecting from the dropdown
- All fields (description, unit_price) remain fully editable after selection

### How to verify:
1. Open the Create Invoice dialog
2. Click "Add Line Item" — a blank row appears
3. Click/focus the CPT field — a dropdown shows all catalog items
4. Type "99" — dropdown filters to matching items (e.g., 99204, 99213)
5. Select "99204 — Initial exam" — CPT, description, and price auto-fill
6. Edit the description or price — changes stick, no lock-in
7. Type a custom CPT code like "12345" with no match — no dropdown, field accepts free text
8. Pre-populated line items (from clinical data) still work correctly

## What We're NOT Doing

- No new database tables or migrations
- No changes to `getServiceCatalogPriceMap()` or the pre-population logic
- No "Add from Catalog" button — the picker is inline in the CPT field
- No multi-select or bundle selection (PRP bundle is already handled by pre-population)
- No changes to the pricing catalog admin UI

## Implementation Approach

Use a Popover + Command (cmdk) pattern — the standard shadcn combobox approach. The CPT input becomes the trigger for a popover containing a searchable list of catalog items. This gives us keyboard navigation, filtering, and a clean UX without building a custom autocomplete.

## Phase 1: Pass Catalog Items to the Dialog

### Overview
Fetch the full catalog items server-side and pass them to the dialog alongside the existing form data.

### Changes Required:

#### 1. Add catalog items to `getInvoiceFormData` return
**File**: `src/actions/billing.ts`
**Changes**: Import `listServiceCatalog`, call it alongside the price map, include catalog items in the return.

At the top of the function (around line 155), after the existing `getServiceCatalogPriceMap()` call:

```typescript
// Fetch default prices from service catalog
const priceMap = await getServiceCatalogPriceMap()

// Fetch full catalog items for the line item picker
const { data: catalogItems } = await listServiceCatalog()
```

In the return object (line 241-251), add `catalogItems`:

```typescript
return {
  data: {
    caseData: caseResult.data,
    procedures,
    clinic: clinicResult.data,
    providerProfile,
    diagnoses,
    indication,
    prePopulatedLineItems,
    catalogItems: catalogItems ?? [],
  },
}
```

#### 2. Update `InvoiceFormData` interface in the dialog
**File**: `src/components/billing/create-invoice-dialog.tsx`
**Changes**: Add `catalogItems` to the `InvoiceFormData` interface.

```typescript
interface InvoiceFormData {
  // ... existing fields ...
  catalogItems: Array<{
    id: string
    cpt_code: string
    description: string
    default_price: number
    sort_order: number
  }>
}
```

#### 3. Pass catalog items from billing page client
**File**: `src/components/billing/billing-page-client.tsx`
**Changes**: No changes needed — `invoiceFormData` already spreads the full return from `getInvoiceFormData`, so `catalogItems` will flow through automatically since the billing page client passes `formData={invoiceFormData}`.

Verify that the billing page client does pass the full `data` object from `getInvoiceFormData` — it does at line 93.

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles cleanly: `npx tsc --noEmit`
- [x] No lint errors: `npm run lint`
- [x] App builds successfully: `npm run build`

#### Manual Verification:
- [ ] Open the Create Invoice dialog — no regressions, everything works as before
- [ ] Confirm via React DevTools or console log that `formData.catalogItems` contains the catalog entries

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Build the CPT Code Combobox Component

### Overview
Create a `CptCodeCombobox` component that replaces the plain CPT `<Input>` in each line item row. Uses Popover + Command from shadcn/ui.

### Changes Required:

#### 1. Create `CptCodeCombobox` component
**File**: `src/components/billing/cpt-code-combobox.tsx` (new file)

```tsx
'use client'

import { useState, useRef } from 'react'
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'

interface CatalogItem {
  id: string
  cpt_code: string
  description: string
  default_price: number
}

interface CptCodeComboboxProps {
  value: string
  onChange: (value: string) => void
  onSelect: (item: CatalogItem) => void
  catalogItems: CatalogItem[]
  className?: string
  placeholder?: string
}

export function CptCodeCombobox({
  value,
  onChange,
  onSelect,
  catalogItems,
  className,
  placeholder = 'CPT',
}: CptCodeComboboxProps) {
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Filter catalog items by CPT code or description
  const filtered = catalogItems.filter((item) => {
    if (!value) return true
    const search = value.toLowerCase()
    return (
      item.cpt_code.toLowerCase().includes(search) ||
      item.description.toLowerCase().includes(search)
    )
  })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            if (!open) setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          className={className}
          placeholder={placeholder}
          autoComplete="off"
        />
      </PopoverTrigger>
      <PopoverContent
        className="w-[280px] p-0"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandList>
            <CommandEmpty>No matching services</CommandEmpty>
            <CommandGroup>
              {filtered.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.cpt_code}
                  onSelect={() => {
                    onSelect(item)
                    setOpen(false)
                    inputRef.current?.focus()
                  }}
                >
                  <div className="flex flex-col">
                    <span className="text-xs font-medium">{item.cpt_code}</span>
                    <span className="text-xs text-muted-foreground truncate">
                      {item.description} — ${Number(item.default_price).toFixed(2)}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
```

Key design decisions:
- **`shouldFilter={false}`** on Command — we do our own filtering since we want to filter by both CPT code and description
- **`onOpenAutoFocus` prevented** — keeps focus in the input, not the popover
- **`onSelect` callback** — the parent handles filling description and price into the form
- **No chevron icon** — the input looks like a normal text input; the popover appears on focus/type. This keeps the narrow column width working.

#### 2. Replace the CPT `<Input>` with `CptCodeCombobox` in the dialog
**File**: `src/components/billing/create-invoice-dialog.tsx`

Import the new component:
```typescript
import { CptCodeCombobox } from './cpt-code-combobox'
```

Replace the CPT code FormField (lines 419-427) with:

```tsx
<FormField
  control={form.control}
  name={`line_items.${index}.cpt_code`}
  render={({ field }) => (
    <FormItem>
      <FormControl>
        <CptCodeCombobox
          value={field.value}
          onChange={field.onChange}
          catalogItems={formData.catalogItems}
          className="text-xs"
          onSelect={(item) => {
            field.onChange(item.cpt_code)
            form.setValue(`line_items.${index}.description`, item.description)
            form.setValue(`line_items.${index}.unit_price`, item.default_price)
            setTimeout(() => handleQuantityOrPriceChange(index), 0)
          }}
        />
      </FormControl>
    </FormItem>
  )}
/>
```

The `onSelect` handler:
1. Sets the CPT code
2. Sets the description from the catalog
3. Sets the unit price from the catalog
4. Triggers the existing `handleQuantityOrPriceChange` to recalculate `total_price`

#### 3. Widen the CPT column slightly
**File**: `src/components/billing/create-invoice-dialog.tsx`

Change the grid template from:
```
grid-cols-[100px_70px_1fr_50px_80px_36px]
```
to:
```
grid-cols-[100px_80px_1fr_50px_80px_36px]
```

This applies to both the header row (line 399) and each item row (line 409). The extra 10px gives the CPT field breathing room without significantly impacting the description column.

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles cleanly: `npx tsc --noEmit`
- [x] No lint errors: `npm run lint`
- [x] App builds successfully: `npm run build`

#### Manual Verification:
- [ ] Focus the CPT field on a blank line item — dropdown appears with all catalog items
- [ ] Type "99" — dropdown filters to 99204 and 99213
- [ ] Select "99204" — CPT, description, and unit_price auto-fill; total_price recalculates
- [ ] Edit the description after selection — change persists
- [ ] Edit the unit_price after selection — total recalculates
- [ ] Type a custom CPT code "12345" — no crash, dropdown shows "No matching services", free text accepted
- [ ] Pre-populated line items still display correctly (their CPT fields show existing values)
- [ ] Existing edit invoice flow still works (no regressions)
- [ ] Keyboard navigation works in the dropdown (arrow keys, Enter to select, Escape to close)

**Implementation Note**: After completing this phase and all verification passes, the feature is complete.

---

## Testing Strategy

### Manual Testing Steps:
1. **New invoice with blank line items**: Add Line Item → use picker → verify auto-fill
2. **New invoice with pre-populated items**: Create from a case with procedures → verify existing items display, picker works on new rows
3. **Edit existing invoice**: Open edit → verify existing CPT codes display, picker works on all rows
4. **Free text entry**: Type custom CPT not in catalog → verify it saves correctly
5. **Empty catalog**: If no catalog items exist, the dropdown shows "No matching services" — the field still works as plain text input
6. **Price override**: Select catalog item → change price → save → verify saved price is the override, not catalog price

## Performance Considerations

- The catalog is small (6 items currently) — no virtualization needed
- Catalog items are fetched once with `getInvoiceFormData` — no additional network requests when the picker opens
- `shouldFilter={false}` with manual filtering avoids cmdk's internal re-renders

## References

- Research: `thoughts/shared/research/2026-03-13-invoice-line-items-from-product-catalog.md`
- Story 6.2 plan: `thoughts/shared/plans/2026-03-13-epic-6-story-6.2-define-pricing-catalog.md`
- shadcn Combobox pattern: Popover + Command composition
- Existing combobox reference: `src/components/procedures/diagnosis-combobox.tsx`
