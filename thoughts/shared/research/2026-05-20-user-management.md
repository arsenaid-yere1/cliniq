---
date: 2026-05-20T14:02:10-0700
researcher: arsenaid
git_commit: 4377fd705ac014bd90cc1410e62c40c66026c2fc
branch: main
repository: cliniq
topic: "Existing user management surface — auth, users, roles, provider profiles"
tags: [research, codebase, auth, users, roles, supabase, rls, provider-profiles, settings]
status: complete
last_updated: 2026-05-20
last_updated_by: arsenaid
---

# Research: Existing user management surface in cliniq

**Date**: 2026-05-20T14:02:10-0700
**Researcher**: arsenaid
**Git Commit**: 4377fd705ac014bd90cc1410e62c40c66026c2fc
**Branch**: main
**Repository**: cliniq

## Research Question

"Add user management feature" — phrased as a feature request, scoped here to documentation of what already exists in the codebase that relates to users, authentication, roles, and provider identity. No recommendations, no proposals; map only.

## Summary

cliniq is a Next.js 15 / App Router app backed by Supabase. Auth is fully delegated to Supabase Auth via `@supabase/ssr`. The app maintains a `public.users` mirror of `auth.users` (populated by a trigger), a `provider_profiles` table that is decoupled from auth (since migration 025), and a singleton `clinic_settings` row. There is no dedicated "users" management UI — only a provider profiles list under `/settings`. The schema declares three roles (`admin | provider | staff`) via a SQL check constraint, but no TypeScript enum, no permission helper, and no role-gated code path consumes them anywhere in `src/`. The RLS posture across every `public.*` table is a single uniform policy: `for all using (auth.role() = 'authenticated')`. Auth enforcement happens at exactly one place — `src/middleware.ts` → `src/lib/supabase/middleware.ts`. Server actions read `auth.getUser()` only to stamp audit columns (`created_by_user_id` / `updated_by_user_id`), not to gate access.

## Detailed Findings

### Auth client factories

Three Supabase client constructors, all named `createClient`, in different files:

- [src/lib/supabase/client.ts](src/lib/supabase/client.ts) — browser client via `createBrowserClient` from `@supabase/ssr`; reads `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Synchronous. No manual cookie wiring (browser client uses `document.cookie`).
- [src/lib/supabase/server.ts](src/lib/supabase/server.ts) — server client via `createServerClient`; wires `cookies()` from `next/headers`. `setAll` wrapped in silent try/catch to tolerate calls from RSC contexts (`src/lib/supabase/server.ts:14-22`).
- [src/lib/supabase/middleware.ts](src/lib/supabase/middleware.ts) — separate server client used inside the Edge middleware request cycle. Implements the canonical `@supabase/ssr` two-phase cookie rewrite (writes cookies to both `request.cookies` and a fresh `NextResponse`).

No `SUPABASE_SERVICE_ROLE_KEY` reference exists anywhere in `src/`. Only the anon key is used.

### Edge middleware — sole auth gate

- [src/middleware.ts](src/middleware.ts) — pass-through shim; delegates to `updateSession`.
- `config.matcher` ([src/middleware.ts:9-11](src/middleware.ts#L9-L11)) covers every path except `_next/static`, `_next/image`, `favicon.ico`, and image/SVG file extensions. All app + API routes pass through.

`updateSession` in [src/lib/supabase/middleware.ts](src/lib/supabase/middleware.ts):

1. Builds Supabase server client wired to request cookies ([src/lib/supabase/middleware.ts:9-30](src/lib/supabase/middleware.ts#L9-L30)).
2. Calls `supabase.auth.getUser()` ([src/lib/supabase/middleware.ts:32-34](src/lib/supabase/middleware.ts#L32-L34)) — actual network call to Supabase Auth, not a JWT-decode.
3. Redirect rules:
   - `!user && pathname !== '/login'` → redirect to `/login` ([src/lib/supabase/middleware.ts:38-41](src/lib/supabase/middleware.ts#L38-L41))
   - `user && pathname === '/login'` → redirect to `/patients` ([src/lib/supabase/middleware.ts:44-47](src/lib/supabase/middleware.ts#L44-L47))
   - Otherwise → return `supabaseResponse` (may carry refreshed cookies).

No other layout, page, or action runs a session check that redirects. The dashboard layout has no auth check.

### Login UI

- [src/app/(auth)/login/page.tsx](src/app/(auth)/login/page.tsx) — `'use client'`. Constructs the browser Supabase client inline ([src/app/(auth)/login/page.tsx:23](src/app/(auth)/login/page.tsx#L23)), calls `supabase.auth.signInWithPassword` ([src/app/(auth)/login/page.tsx:24-27](src/app/(auth)/login/page.tsx#L24-L27)), then on success calls `router.push('/patients')` followed by `router.refresh()` ([src/app/(auth)/login/page.tsx:35-36](src/app/(auth)/login/page.tsx#L35-L36)). The `router.refresh()` is what propagates the new cookie to server components.
- [src/app/(auth)/layout.tsx](src/app/(auth)/layout.tsx) — RSC; renders a centered `<main>`. No session logic.
- The `signIn` server action in `src/actions/auth.ts` exists but is NOT used by the login page — it is dead with respect to login. Search of imports shows no consumer.

### Auth server actions

[src/actions/auth.ts](src/actions/auth.ts) exports three actions, all `'use server'`:

- `signIn(formData)` ([src/actions/auth.ts:6-22](src/actions/auth.ts#L6-L22)) — `signInWithPassword`; on success `redirect('/patients')`; on error returns `{ error: error.message }`. **Currently uncalled.**
- `signOut()` ([src/actions/auth.ts:24-28](src/actions/auth.ts#L24-L28)) — `supabase.auth.signOut()` then `redirect('/login')`.
- `getUser()` ([src/actions/auth.ts:30-34](src/actions/auth.ts#L30-L34)) — wraps `supabase.auth.getUser()` and returns the `user` object.

### `public.users` table

Defined in [supabase/migrations/001_initial_schema.sql:7-14](supabase/migrations/001_initial_schema.sql#L7-L14):

```sql
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  role text not null default 'staff' check (role in ('admin','provider','staff')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Auto-populated via trigger `on_auth_user_created` ([supabase/migrations/001_initial_schema.sql:216-218](supabase/migrations/001_initial_schema.sql#L216-L218)) → function `public.handle_new_user()` ([supabase/migrations/001_initial_schema.sql:202-214](supabase/migrations/001_initial_schema.sql#L202-L214)). The function is `SECURITY DEFINER`, inserts `id`, `email`, `full_name` (from `raw_user_meta_data->>'full_name'` or fallback to `email`), and hardcoded `role = 'staff'`. New signups always land as `staff`; elevation requires a manual UPDATE.

Lifecycle:
- INSERT into `auth.users` (Supabase Auth invite / signup) → trigger fires → row in `public.users` created.
- DELETE on `auth.users` → cascades to `public.users` via FK.

### Role values

The strings `'admin' | 'provider' | 'staff'` exist ONLY in the SQL check constraint at [supabase/migrations/001_initial_schema.sql:11](supabase/migrations/001_initial_schema.sql#L11). No TypeScript enum, no constant, no zod schema references them. In [src/types/database.ts](src/types/database.ts) the `users.role` column is typed as plain `string`, not a union. No code path in `src/` reads the `role` column at all (no grep hit for selecting `role` from `users`).

### `provider_profiles` table

Originally defined in [supabase/migrations/007_clinic_provider_settings.sql:33-46](supabase/migrations/007_clinic_provider_settings.sql#L33-L46):

```sql
create table public.provider_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  display_name text not null,
  credentials text,
  license_number text,
  npi_number text,
  signature_storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references public.users(id),
  updated_by_user_id uuid references public.users(id),
  deleted_at timestamptz
);
```

Partial unique index on `(user_id) where deleted_at is null` ([supabase/migrations/007_clinic_provider_settings.sql:49-51](supabase/migrations/007_clinic_provider_settings.sql#L49-L51)).

`supervising_provider_id` added in [supabase/migrations/024_lien_agreement.sql:2-3](supabase/migrations/024_lien_agreement.sql#L2-L3) — initially FK to `users(id)`.

Decoupled in [supabase/migrations/025_decouple_provider_profiles.sql](supabase/migrations/025_decouple_provider_profiles.sql):
- `user_id` → nullable, `ON DELETE SET NULL` ([025:8-16](supabase/migrations/025_decouple_provider_profiles.sql#L8-L16))
- Unique index now `where deleted_at is null and user_id is not null` ([025:18-24](supabase/migrations/025_decouple_provider_profiles.sql#L18-L24))
- `supervising_provider_id` repointed to `provider_profiles(id)` ([025:29-33](supabase/migrations/025_decouple_provider_profiles.sql#L29-L33))
- `cases.assigned_provider_id` repointed to `provider_profiles(id)` after in-place data migration ([025:35-47](supabase/migrations/025_decouple_provider_profiles.sql#L35-L47))

Net relationship: provider_profile is 0-or-1 to public.users. A profile can exist with no auth account (used for cases assigned to a non-user provider).

### RLS pattern — uniform across schema

Every `public.*` table uses one policy:

```sql
create policy "Authenticated users full access" on <table>
  for all using (auth.role() = 'authenticated');
```

Locations:
- `users`, `patients`, `cases`, `attorneys`, `case_status_history` ([001:178-191](supabase/migrations/001_initial_schema.sql#L178-L191))
- `audit_logs` — only exception: SELECT requires `authenticated`, INSERT has `with check (true)` ([001:193-197](supabase/migrations/001_initial_schema.sql#L193-L197))
- `clinic_settings`, `provider_profiles` ([007:27-28, 57-58](supabase/migrations/007_clinic_provider_settings.sql#L27))
- All other `public.*` tables follow the same single-policy form (24 migrations carry RLS DDL — see file list under Code References).

Storage RLS (009) uses Supabase storage syntax (`TO authenticated` role specifier) with per-operation policies on `bucket_id = 'clinic-assets'` ([009:16-33](supabase/migrations/009_clinic_assets_storage.sql#L16-L33)).

Effective access: any authenticated session has full CRUD on every business table. No row-level scoping by user, clinic, or org exists.

### Settings page — sole user/provider-facing surface

Page: [src/app/(dashboard)/settings/page.tsx](src/app/(dashboard)/settings/page.tsx) — fetches `getClinicSettings()` + `listProviderProfiles()` server-side, renders `SettingsTabs`.

Tabs: Clinic Info, Provider Info, Clinic Logo, plus fee/pricing tabs ([src/components/settings/settings-tabs.tsx](src/components/settings/settings-tabs.tsx)).

#### Provider list

[src/components/settings/provider-list.tsx](src/components/settings/provider-list.tsx) — table with columns Display Name, Credentials, License #, NPI, Supervising Provider, Actions. Edit + soft-delete per row. `handleConfirmDelete` ([provider-list.tsx:69-81](src/components/settings/provider-list.tsx#L69-L81)) calls `deleteProviderProfile`, then `router.refresh()`.

#### Provider form dialog

[src/components/settings/provider-form-dialog.tsx](src/components/settings/provider-form-dialog.tsx) — react-hook-form + zod (`providerInfoSchema`). Fields: display_name, credentials, license_number, npi_number, supervising_provider_id. On create, after server action returns, `savedProfileId` is set ([provider-form-dialog.tsx:109](src/components/settings/provider-form-dialog.tsx#L109)) so the signature uploader becomes available without closing the dialog.

#### Signature upload

[src/components/settings/provider-signature-upload.tsx](src/components/settings/provider-signature-upload.tsx) — drag-and-drop + hidden input. Type whitelist `image/jpeg, image/png`, max 1 MB. After upload, re-calls `getProviderSignatureUrl` for a fresh signed URL.

### Settings server actions

[src/actions/settings.ts](src/actions/settings.ts) — full CRUD surface for clinic + provider profiles. Read functions (`getClinicSettings`, `listProviderProfiles`, `getProviderProfileById`, `getClinicLogoUrl`, `getProviderSignatureUrl`) do NOT call `getUser()`. Write functions call `getUser()` but use the result only for `created_by_user_id` / `updated_by_user_id` audit stamping — `user?.id` is passed through with no early return when absent.

Per-function detail (line refs in `src/actions/settings.ts`):

| Function | Lines | Auth | Validation | Side effect |
|---|---|---|---|---|
| `getClinicSettings` | 13-23 | none | none | — |
| `updateClinicSettings` | 25-63 | `getUser()` for audit | `clinicInfoSchema.safeParse` (field errors object on fail) | `revalidatePath('/settings')` |
| `listProviderProfiles` | 65-75 | none | none | — |
| `getProviderProfileById` | 77-88 | none | none | — |
| `createProviderProfile` | 90-119 | `getUser()` for audit | `providerInfoSchema.safeParse` (flat string on fail) | `revalidatePath('/settings')` |
| `updateProviderProfile` | 121-148 | `getUser()` for audit | `providerInfoSchema.safeParse` | `revalidatePath('/settings')` |
| `deleteProviderProfile` | 150-164 | `getUser()` for audit | none | soft delete via `deleted_at`; `revalidatePath` |
| `uploadClinicLogo` | 166-233 | `getUser()` for audit | size/MIME pre-checks | replaces existing file; `revalidatePath` |
| `removeClinicLogo` | 235-267 | `getUser()` for audit | guard on missing path | `revalidatePath` |
| `getClinicLogoUrl` | 269-286 | none | none | signed URL TTL 3600s |
| `uploadProviderSignature` | 288-345 | `getUser()` for audit | size/MIME pre-checks | replaces existing; `revalidatePath` |
| `removeProviderSignature` | 347-380 | `getUser()` for audit | guard on missing path | `revalidatePath` |
| `getProviderSignatureUrl` | 382-400 | none | none | signed URL TTL 3600s |

### Zod validation

[src/lib/validations/settings.ts](src/lib/validations/settings.ts):
- `clinicInfoSchema` ([:3-14](src/lib/validations/settings.ts#L3-L14)) — `clinic_name` required; email/website permit empty string OR valid format; all other fields optional strings.
- `providerInfoSchema` ([:18-24](src/lib/validations/settings.ts#L18-L24)) — `display_name` required; `supervising_provider_id` permits empty string OR UUID.

No format constraints on `npi_number` or `license_number` (free text).

### Header component

[src/components/layout/header.tsx](src/components/layout/header.tsx) — only UI consumer of `supabase.auth.getUser()` outside of middleware/actions. Calls client-side via `.then` chain.

### Server actions that read `auth.getUser()` for audit

The `getUser()`-for-audit pattern is replicated across ~25 action files. They do not gate; they stamp:

- patients.ts, procedures.ts, procedure-notes.ts, discharge-notes.ts, initial-visit-notes.ts, case-summaries.ts, case-status.ts, case-quality-reviews.ts, billing.ts, settings.ts, documents.ts, attorneys.ts, service-catalog.ts, clinical-orders.ts, invoice-status.ts, lien.ts, fee-estimate.ts, procedure-consents.ts, mri-extractions.ts, chiro-extractions.ts, pt-extractions.ts, pain-management-extractions.ts, ct-scan-extractions.ts, orthopedic-extractions.ts, x-ray-extractions.ts (all under [src/actions/](src/actions/)).

### Tests

[src/test-utils/supabase-mock.ts](src/test-utils/supabase-mock.ts) — mock client exposing `mockSupabase.auth.getUser`. Several action tests assert behavior when user is `null` (e.g. [src/actions/__tests__/case-quality-reviews.test.ts](src/actions/__tests__/case-quality-reviews.test.ts), `case-status.test.ts`, `invoice-status.test.ts`, `patients.test.ts`).

### Notable absences (state of repo today, no judgement)

- No user management UI (no list-users page, no invite flow, no role-change UI).
- No `requireAuth` / `hasPermission` / `isAdmin` / `canAccess` helper file in `src/`.
- No TypeScript enum or constant for `'admin' | 'provider' | 'staff'`.
- No multi-tenant scoping: `clinic_settings` is a singleton; no `clinic_id` / `org_id` FK exists on users, patients, or cases.
- No `supabase/config.toml`; no `supabase/seed.sql`.
- No service-role usage in app code.

## Code References

- [src/middleware.ts](src/middleware.ts) — Next.js middleware entry shim.
- [src/lib/supabase/middleware.ts:32-50](src/lib/supabase/middleware.ts#L32-L50) — session check + redirect logic (sole auth gate).
- [src/lib/supabase/server.ts:14-22](src/lib/supabase/server.ts#L14-L22) — server cookie adapter with RSC-safe try/catch.
- [src/lib/supabase/client.ts](src/lib/supabase/client.ts) — browser client factory.
- [src/actions/auth.ts:6-34](src/actions/auth.ts#L6-L34) — signIn (unused), signOut, getUser.
- [src/app/(auth)/login/page.tsx:18-37](src/app/(auth)/login/page.tsx#L18-L37) — client-side login form + `signInWithPassword` + `router.refresh()` pattern.
- [supabase/migrations/001_initial_schema.sql:7-14](supabase/migrations/001_initial_schema.sql#L7-L14) — `public.users` definition with role check.
- [supabase/migrations/001_initial_schema.sql:202-218](supabase/migrations/001_initial_schema.sql#L202-L218) — `handle_new_user()` + trigger.
- [supabase/migrations/001_initial_schema.sql:170-197](supabase/migrations/001_initial_schema.sql#L170-L197) — RLS enable + `Authenticated users full access` policies.
- [supabase/migrations/007_clinic_provider_settings.sql:4-58](supabase/migrations/007_clinic_provider_settings.sql#L4-L58) — `clinic_settings` + `provider_profiles` + RLS.
- [supabase/migrations/025_decouple_provider_profiles.sql](supabase/migrations/025_decouple_provider_profiles.sql) — decouple profile from auth user.
- [supabase/migrations/009_clinic_assets_storage.sql](supabase/migrations/009_clinic_assets_storage.sql) — `clinic-assets` bucket + per-op storage policies.
- [src/actions/settings.ts](src/actions/settings.ts) — full clinic/provider CRUD + storage upload server actions.
- [src/lib/validations/settings.ts](src/lib/validations/settings.ts) — zod schemas.
- [src/app/(dashboard)/settings/page.tsx](src/app/(dashboard)/settings/page.tsx) — settings page entry.
- [src/components/settings/settings-tabs.tsx](src/components/settings/settings-tabs.tsx) — tab container.
- [src/components/settings/provider-list.tsx](src/components/settings/provider-list.tsx) — provider table + delete dialog.
- [src/components/settings/provider-form-dialog.tsx](src/components/settings/provider-form-dialog.tsx) — provider create/edit dialog.
- [src/components/settings/provider-signature-upload.tsx](src/components/settings/provider-signature-upload.tsx) — signature upload widget.
- [src/components/layout/header.tsx](src/components/layout/header.tsx) — only client-side `getUser()` consumer.
- [src/types/database.ts](src/types/database.ts) — generated Supabase types (`users.role` typed as `string`).
- [src/test-utils/supabase-mock.ts](src/test-utils/supabase-mock.ts) — mock Supabase client used by action tests.

## Architecture Documentation

Authentication architecture as it stands:

```
Browser ── cookies ──> Edge Middleware ──> Supabase Auth (auth.getUser network call)
                              │
                              ├─ null + not /login  → redirect /login
                              ├─ user + on /login   → redirect /patients
                              └─ otherwise          → pass-through with refreshed Set-Cookie
                                                              │
                                                              ▼
                                                     RSC / Server Action
                                                              │
                                                              ▼
                                              supabase server client (cookies wired)
                                                              │
                                                              ▼
                                              auth.getUser() (per-action, audit-only)
                                                              │
                                                              ▼
                                                       Postgres + RLS
                                                       (role check: `authenticated`)
```

Identity model:

```
auth.users (managed by Supabase Auth)
   │  on insert trigger handle_new_user()
   ▼
public.users (id mirrors auth.users.id, role default 'staff')
   ▲
   │ user_id (nullable, since migration 025)
   │
public.provider_profiles ── id ◄── cases.assigned_provider_id
                            ▲
                            └── supervising_provider_id (self FK)
```

Data access posture: single-tenant, single-org. Any authenticated session reads/writes everything. Audit columns (`created_by_user_id`, `updated_by_user_id`) populated by application code; not enforced by RLS.

## Related Research

None of the prior research docs in `thoughts/shared/research/` (April–May 2026) cover auth/user management; all focus on clinical notes, QC, billing, or extraction pipelines.

## Open Questions

- Whether the `signIn` server action in [src/actions/auth.ts:6-22](src/actions/auth.ts#L6-L22) is intentionally retained (it is currently unreferenced; login uses the client-side path).
- Whether the `role` column in `public.users` is read by any external system (Supabase dashboard policies, edge functions outside this repo, etc.) — no app-code consumer was found.
- Whether `provider_profiles.user_id` is ever populated in practice today, or whether all provider rows are auth-less since the migration 025 decoupling. A SQL query against the live DB would answer this.
