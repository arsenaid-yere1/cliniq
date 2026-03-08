---
date: 2026-03-08T00:00:00-07:00
researcher: Claude
git_commit: c1c2879b0e4f6fbc47480ec01c905a083bf23526
branch: main
repository: cliniq
topic: "Epic 0 — Clinic Setup: Design Recommendations & Decision Guide"
tags: [research, codebase, epic-0, clinic-settings, provider-settings, design]
status: complete
last_updated: 2026-03-08
last_updated_by: Claude
---

# Research: Epic 0 — Clinic Setup Design Recommendations & Decision Guide

**Date**: 2026-03-08
**Researcher**: Claude
**Git Commit**: c1c2879b0e4f6fbc47480ec01c905a083bf23526
**Branch**: main
**Repository**: cliniq

## Research Question

Recommend good design patterns and guide decisions for implementing Epic 0 (Clinic Setup) — Stories 0.1 through 0.4 — covering clinic info, provider info, logo upload, and provider signature.

## Summary

Epic 0 is a foundational feature that feeds into every document and invoice the system generates. The codebase already has strong, consistent patterns for forms, server actions, validation, and storage. This research recommends a **single Settings page with tabbed sections**, a **single `clinic_settings` table** (singleton row pattern), a **separate `provider_profiles` table** linked to `users`, and reuse of the existing Supabase Storage + signed-URL pattern for logo/signature uploads.

---

## Key Design Decisions

### Decision 1: Data Model — One Table vs. Two?

**Recommendation: Two tables — `clinic_settings` (singleton) + `provider_profiles` (per-user)**

| Option | Pros | Cons |
|--------|------|------|
| **A: Single `clinic_settings` table** with all fields | Simple, one query | Mixes org-level and user-level data; breaks if multi-provider needed |
| **B: `clinic_settings` + `provider_profiles`** | Clean separation; provider data links to `users`; future-proof for multi-provider | Two tables, two server actions |
| **C: JSON settings in `users` table** | No migration | Unstructured, hard to query, no validation at DB level |

**Why Option B:**
- Clinic info (name, address, phone, email, website, logo) is **organization-level** — one per clinic.
- Provider info (name, credentials, license, NPI, signature) is **user-level** — tied to the authenticated provider.
- The existing `users` table already has `id`, `email`, `full_name`, and `role`. A `provider_profiles` table extends it cleanly.
- If a second provider is ever added, no schema change needed.

#### Proposed Schema: `clinic_settings`

```sql
CREATE TABLE clinic_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_name TEXT NOT NULL,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  zip_code TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  logo_storage_path TEXT,          -- Reference to Supabase Storage
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by_user_id UUID REFERENCES auth.users(id),
  updated_by_user_id UUID REFERENCES auth.users(id),
  deleted_at TIMESTAMPTZ           -- Soft delete (HIPAA)
);
```

**Singleton enforcement**: Use a partial unique index or a CHECK constraint:
```sql
-- Option A: Partial unique index (only one non-deleted row)
CREATE UNIQUE INDEX idx_clinic_settings_singleton
  ON clinic_settings ((true))
  WHERE deleted_at IS NULL;

-- Option B: Use UPSERT in the server action (simpler, app-level enforcement)
```

**Recommendation**: Use `UPSERT` at the application level (simpler). The partial unique index is a nice safety net but adds complexity. For a single-clinic MVP, app-level enforcement via upsert is sufficient.

#### Proposed Schema: `provider_profiles`

```sql
CREATE TABLE provider_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,       -- How name appears on documents
  credentials TEXT,                 -- MD, DO, DC, NP, etc.
  license_number TEXT,
  npi_number TEXT,
  signature_storage_path TEXT,      -- Reference to Supabase Storage
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by_user_id UUID REFERENCES auth.users(id),
  updated_by_user_id UUID REFERENCES auth.users(id),
  deleted_at TIMESTAMPTZ
);

-- One active profile per user
CREATE UNIQUE INDEX idx_provider_profiles_user_active
  ON provider_profiles (user_id)
  WHERE deleted_at IS NULL;
```

---

### Decision 2: Address Storage — Structured vs. Freeform?

**Recommendation: Structured fields (address_line1, city, state, zip)**

| Option | Pros | Cons |
|--------|------|------|
| Structured fields | Consistent formatting on documents; easier validation; can format differently per context | More fields in form |
| Single `address` text field | Simple | Hard to reformat; inconsistent output |
| JSONB object | Flexible | No DB-level validation; harder to query |

**Why structured**: Documents and invoices need to format the address consistently. A structured approach lets you render `123 Main St\nSuite 200\nPhoenix, AZ 85001` reliably.

---

### Decision 3: Credentials — Free Text vs. Enum?

**Recommendation: Free text with optional predefined suggestions**

| Option | Pros | Cons |
|--------|------|------|
| DB enum (`credential_type`) | Strict validation | Rigid; migration needed to add new types |
| Free text with UI suggestions | Flexible; covers edge cases (PharmD, PA-C, etc.) | No DB constraint |
| Array of credentials | Supports multiple (MD, FAAOS) | More complex |

**Why free text with suggestions**: Credential abbreviations vary widely across medical specialties. A combobox/input with common suggestions (MD, DO, DC, NP, PA, DPT) but allowing custom entry is the most practical. Store as a single text field — the provider controls how their credentials appear on documents.

---

### Decision 4: UI Layout — Separate Pages vs. Tabbed Settings?

**Recommendation: Single `/settings` page with tabs**

| Option | Pros | Cons |
|--------|------|------|
| **Tabs on one page** | Single destination; easy to navigate; familiar pattern | All forms load together |
| Separate pages per story | Clean URLs; independent loading | More navigation; feels fragmented |
| Wizard/stepper | Guided flow | Overkill for settings that change rarely |

**Why tabs**: Settings pages are a well-understood UX pattern. shadcn/ui's `Tabs` component is already installed. Four tabs map cleanly to the four stories:

```
/settings
├── Tab: Clinic Info      (Story 0.1)
├── Tab: Provider Info    (Story 0.2)
├── Tab: Clinic Logo      (Story 0.3)
└── Tab: Signature        (Story 0.4)
```

The URL can use query params or hash for tab state: `/settings?tab=provider` (optional, not critical for MVP).

---

### Decision 5: Logo & Signature Upload — Inline or Separate Step?

**Recommendation: Inline upload within each tab, using existing storage patterns**

The codebase already handles file uploads via Supabase Storage (see `case-documents` bucket in migration 003). Reuse the same pattern:

1. **Create a new private bucket**: `clinic-assets` (for logo + signatures)
2. **Upload flow**: File picker → upload to Storage → save `storage_path` in DB
3. **Display flow**: Fetch signed URL (short expiry) → render `<img>`
4. **Validation**: Accept common image formats (PNG, JPG, SVG for logo; PNG, JPG for signature). Limit file size (2MB logo, 1MB signature).

**Logo-specific considerations**:
- Recommend minimum dimensions (e.g., 200x200px) and max (1000x1000px)
- Show preview after upload
- Consider auto-resize/crop on client side (nice-to-have, not MVP-critical)

**Signature-specific considerations**:
- Upload image (simplest for MVP)
- Future: draw-on-canvas signature pad (post-MVP)
- Preview placement on a mock document snippet
- Store as PNG with transparent background (recommended)

---

### Decision 6: Sidebar Navigation — Where Does Settings Live?

**Recommendation: Bottom of sidebar, gear icon**

Looking at the existing sidebar ([app-sidebar.tsx](src/components/layout/app-sidebar.tsx)), the main navigation includes Patients and Attorneys. Settings should be:

- **Position**: Bottom of the sidebar (below main nav, above user menu)
- **Icon**: `Settings` (gear) from lucide-react
- **Label**: "Settings"
- **Route**: `/settings`

This follows the convention of most SaaS apps where settings is a secondary navigation item at the bottom.

---

### Decision 7: First-Run Experience — What Happens Before Settings Are Configured?

**Recommendation: Soft prompt, not a blocking wizard**

| Option | Pros | Cons |
|--------|------|------|
| **Blocking setup wizard** | Forces completion | Annoying; prevents exploring the app |
| **Banner/toast reminder** | Non-intrusive; user can explore first | Might be ignored |
| **Pre-fill with defaults** | No friction | Documents generate with placeholder data |

**Why soft prompt**: Show a dismissible banner on the dashboard: *"Complete your clinic setup to start generating documents."* with a CTA button to `/settings`. Documents that reference clinic/provider info should show a placeholder or warning if not configured, but the system should not block usage.

---

## Recommended File Structure

```
src/
├── app/(dashboard)/settings/
│   ├── page.tsx                    # Server component: fetches settings, renders tabs
│   └── loading.tsx                 # Skeleton loader (optional)
├── components/settings/
│   ├── clinic-info-form.tsx        # Story 0.1
│   ├── provider-info-form.tsx      # Story 0.2
│   ├── clinic-logo-upload.tsx      # Story 0.3
│   ├── provider-signature-upload.tsx # Story 0.4
│   └── settings-tabs.tsx           # Tab container (client component)
├── actions/
│   └── settings.ts                 # All settings server actions
├── lib/validations/
│   └── settings.ts                 # Zod schemas for clinic + provider
supabase/
└── migrations/
    └── 007_clinic_settings.sql     # New migration
```

---

## Validation Schemas (Zod)

```typescript
// lib/validations/settings.ts
import { z } from 'zod'

export const clinicInfoSchema = z.object({
  clinic_name: z.string().min(1, 'Clinic name is required'),
  address_line1: z.string().optional().default(''),
  address_line2: z.string().optional().default(''),
  city: z.string().optional().default(''),
  state: z.string().optional().default(''),
  zip_code: z.string().optional().default(''),
  phone: z.string().optional().default(''),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  website: z.string().url('Invalid URL').optional().or(z.literal('')),
})

export const providerInfoSchema = z.object({
  display_name: z.string().min(1, 'Provider name is required'),
  credentials: z.string().optional().default(''),
  license_number: z.string().optional().default(''),
  npi_number: z.string().optional().default(''),
})

export type ClinicInfoFormValues = z.infer<typeof clinicInfoSchema>
export type ProviderInfoFormValues = z.infer<typeof providerInfoSchema>
```

---

## Server Action Pattern

```typescript
// actions/settings.ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { clinicInfoSchema } from '@/lib/validations/settings'
import { revalidatePath } from 'next/cache'

export async function getClinicSettings() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('clinic_settings')
    .select('*')
    .is('deleted_at', null)
    .maybeSingle()  // Returns null if no row exists (first-run)

  if (error) return { error: error.message }
  return { data }
}

export async function updateClinicSettings(formData: ClinicInfoFormValues) {
  const parsed = clinicInfoSchema.safeParse(formData)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Check if settings already exist
  const { data: existing } = await supabase
    .from('clinic_settings')
    .select('id')
    .is('deleted_at', null)
    .maybeSingle()

  let result
  if (existing) {
    // Update existing
    result = await supabase
      .from('clinic_settings')
      .update({ ...parsed.data, updated_by_user_id: user?.id })
      .eq('id', existing.id)
      .select()
      .single()
  } else {
    // Insert new
    result = await supabase
      .from('clinic_settings')
      .insert({
        ...parsed.data,
        created_by_user_id: user?.id,
        updated_by_user_id: user?.id,
      })
      .select()
      .single()
  }

  if (result.error) return { error: result.error.message }

  revalidatePath('/settings')
  return { data: result.data }
}
```

---

## Integration Points (How Settings Feed Into Documents)

When generating documents or invoices, the system will need to:

1. **Fetch clinic settings**: `getClinicSettings()` — called once per document generation
2. **Fetch provider profile**: `getProviderProfile(userId)` — called per document
3. **Fetch logo signed URL**: Generate a short-lived URL from `logo_storage_path`
4. **Fetch signature signed URL**: Generate from `signature_storage_path`

These should be utility functions in the server actions, not fetched client-side. Document templates will receive this data as props.

---

## RLS Policy

Follow the existing pattern — single authenticated-user-full-access policy:

```sql
ALTER TABLE clinic_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users full access"
  ON clinic_settings FOR ALL
  USING (auth.role() = 'authenticated');

ALTER TABLE provider_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users full access"
  ON provider_profiles FOR ALL
  USING (auth.role() = 'authenticated');
```

---

## Implementation Order

| Phase | Story | Effort | Dependencies |
|-------|-------|--------|--------------|
| 1 | **0.1 — Clinic Info** | Small | None — start here |
| 2 | **0.2 — Provider Info** | Small | None (can parallel with 0.1) |
| 3 | **0.3 — Clinic Logo** | Medium | 0.1 (needs clinic_settings row) |
| 4 | **0.4 — Provider Signature** | Medium | 0.2 (needs provider_profiles row) |

Stories 0.1 and 0.2 can be implemented in parallel since they use separate tables. Stories 0.3 and 0.4 are additive — they add upload capabilities to the existing forms.

**Suggestion**: Implement 0.1 + 0.2 together in one migration (they share the same migration file). Then 0.3 + 0.4 together as a follow-up. This gives you a working settings page in two passes.

---

## Architecture Insights

1. **Follows existing patterns exactly**: Server actions, Zod validation, react-hook-form, shadcn/ui, Supabase Storage — no new dependencies needed.
2. **Singleton pattern for clinic settings**: The `maybeSingle()` query + upsert logic handles first-run gracefully.
3. **Provider profiles extend users**: Rather than adding columns to the `users` table (which is sync'd from `auth.users`), a separate table keeps concerns clean.
4. **Storage bucket reuse**: A new `clinic-assets` bucket follows the same pattern as `case-documents` but with different size limits.
5. **TypeScript types gap**: The generated `database.ts` is behind by two migrations. After adding the new migration, run `supabase gen types` to update.

---

## Open Questions

1. **Should credentials support multiple values?** (e.g., "MD, FAAOS") — Recommend: single text field, provider formats it themselves.
2. **Should logo have a crop/resize UI?** — Recommend: not for MVP. Accept common formats, show preview.
3. **Should there be a "reset to defaults" or "clear all" action?** — Recommend: not for MVP. Individual field clearing is sufficient.
4. **Phone number formatting?** — Recommend: store raw, format on display. Use a simple input mask in the UI (optional enhancement).

---

## Code References

- [app-sidebar.tsx](src/components/layout/app-sidebar.tsx) — Sidebar nav (add Settings link)
- [attorney-form.tsx](src/components/attorneys/attorney-form.tsx) — Reference form pattern
- [patient-wizard.tsx](src/components/patients/patient-wizard.tsx) — Multi-step form reference
- [actions/attorneys.ts](src/actions/attorneys.ts) — Server action CRUD pattern
- [lib/validations/attorney.ts](src/lib/validations/attorney.ts) — Zod schema pattern
- [lib/supabase/server.ts](src/lib/supabase/server.ts) — Server client factory
- [types/database.ts](src/types/database.ts) — Generated types (needs regen after migration)
- [supabase/migrations/003_document_storage.sql](supabase/migrations/003_document_storage.sql) — Storage bucket pattern

## Historical Context (from thoughts/)

- [thoughts/personal/tickets/mvp-scope.md](thoughts/personal/tickets/mvp-scope.md) — MVP scope defining clinic settings as foundational
- [thoughts/personal/tickets/epic-0/story-1.md](thoughts/personal/tickets/epic-0/story-1.md) — Story 0.1 acceptance criteria
- [thoughts/personal/tickets/epic-0/story-2.md](thoughts/personal/tickets/epic-0/story-2.md) — Story 0.2 acceptance criteria
- [thoughts/personal/tickets/epic-0/story-3.md](thoughts/personal/tickets/epic-0/story-3.md) — Story 0.3 acceptance criteria
- [thoughts/personal/tickets/epic-0/story-4.md](thoughts/personal/tickets/epic-0/story-4.md) — Story 0.4 acceptance criteria
- [thoughts/shared/research/2026-03-05-epic-1-patient-case-management-design.md](thoughts/shared/research/2026-03-05-epic-1-patient-case-management-design.md) — Architecture decisions and tech stack
- [thoughts/shared/plans/2026-03-05-epic-1-story-1.1-create-patient-case.md](thoughts/shared/plans/2026-03-05-epic-1-story-1.1-create-patient-case.md) — Implementation patterns established

## Related Research

- [2026-03-05-epic-1-patient-case-management-design.md](thoughts/shared/research/2026-03-05-epic-1-patient-case-management-design.md) — Established the architecture patterns this feature should follow
