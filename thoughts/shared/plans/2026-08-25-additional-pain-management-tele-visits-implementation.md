# Additional Pain-Management Tele-Visits Implementation Plan

## Overview

Add a same-case return-to-care workflow in which a previously discharged
patient can begin a new clinical care episode, complete an additional
pain-management telehealth follow-up, receive procedure recommendations, and
schedule procedures without rewriting the prior episode's discharge or treating
scheduled procedures as performed care.

The implementation uses an **expand -> migrate -> contract** rollout:

1. Add episode, encounter, follow-up-note, procedure-order, and appointment
   structures without removing existing columns or routes.
2. Backfill current records into a deterministic Episode 1 and make downstream
   readers explicitly episode-aware.
3. Ship the new return/tele-visit/scheduling workflow behind a server-enforced
   readiness gate, with navigation enabled only after compatibility work is
   complete.
4. Enforce stronger foreign-key/cardinality constraints only after all existing
   data and callers use the new ownership model.

Reference research:
`thoughts/shared/research/2026-08-25-additional-pain-management-tele-visits.md`.

## Current State

- `cases` is both the legal/financial container and the implicit clinical
  episode. Case status supports `closed -> active`, while
  `pending_settlement`, `closed`, and `archived` lock clinical writes
  (`src/lib/constants/case-status.ts:17-30`;
  `src/actions/case-status.ts:10-31,50-139`).
- Discharge-note finalization does not close the case, but the database permits
  only one live discharge note per case
  (`src/actions/discharge-notes.ts:914-1005`;
  `supabase/migrations/016_discharge_notes.sql:48-53`).
- Initial/Pain Evaluation notes are singleton document types. The database and
  TypeScript permit only `initial_visit` and `pain_evaluation_visit`, with one
  live row of each type per case
  (`supabase/migrations/20260413_initial_visit_visit_type.sql:3-16`;
  `src/lib/claude/generate-initial-visit.ts:21`).
- Visit actions and UI address those notes by `(caseId, visitType)`, not by an
  encounter ID (`src/actions/initial-visit-notes.ts:325-448,570-724`;
  `src/components/clinical/initial-visit-editor.tsx:213-250`).
- Non-procedure vitals are identified only by
  `vital_signs.procedure_id IS NULL`, so they are not attributable to a
  particular visit (`src/actions/initial-visit-notes.ts:955-1098`).
- `procedures` rows are performed encounters. Every row is eligible for
  performed-care timeline and billing logic; no appointment/status model exists
  (`supabase/migrations/002_case_dashboard_tables.sql:27-41`;
  `src/actions/billing.ts:292-383`; `src/actions/timeline.ts:33-38,101-109`).
- Procedure numbering is derived from all live procedures on the case and does
  not reset after discharge (`src/actions/procedures.ts:107-121,850-930`).
- Billing already has a service-catalog entry and current discharge line-item
  path for CPT `99213` (**Follow up / Discharge visit**)
  (`supabase/migrations/019_service_catalog.sql:31-36`;
  `src/actions/billing.ts:385-399`).

## Desired End State

1. A case remains the legal/financial parent and can own multiple clinical care
   episodes.
2. A finalized discharge closes only its care episode and remains immutable.
   It does not automatically close the legal case.
3. Starting care after discharge atomically creates a new active episode and its
   first pain-follow-up encounter. If the case is `closed` or
   `pending_settlement`, the same operation reactivates it and records
   case-status history. Archived cases must first be moved to Closed by the
   existing status workflow.
4. The return visit is an append-only `pain_follow_up` encounter with an
   explicit modality. The delivered UI supports telehealth; the schema also
   permits `in_person`, `phone`, and `unknown` for migration/future use.
5. Telehealth notes use a dedicated follow-up note schema and prompt. They never
   represent uncollected hands-on examination findings or legacy case-level
   vitals as current-visit facts.
6. A completed follow-up encounter can create procedure orders. Orders can have
   one or more appointment attempts, preserving reschedule/cancellation history.
7. Scheduled appointments do not appear as performed procedures or billable
   procedure services. Completion creates exactly one existing `procedures` row
   and links it to the appointment.
8. A new care episode starts a new procedure series by default. Continuation of
   a prior series is an explicit provider choice.
9. Billing, timeline, quality review, procedure defaults, pain trajectory, and
   discharge generation operate on an explicit episode/encounter rather than an
   arbitrary singleton or all-case aggregation.
10. Existing cases, routes, initial-visit notes, procedure records, PDFs, and
    invoices continue to render during the migration.

## Key Discoveries

### Existing patterns to preserve

- Server actions call Supabase directly and use Zod schemas for user input.
- Soft-deletion and partial unique indexes are used for one-active-record
  constraints.
- Clinical document status is independent of case status.
- Case transitions are validated in TypeScript and persisted to
  `case_status_history`.
- Existing generation actions use a staged `generating -> draft -> finalized`
  lifecycle, progress fields, source hashes, and finalized PDF documents.
- Existing procedure forms are complete performed-encounter forms and should be
  reused at appointment completion rather than weakened for scheduling.

### Decisions fixed by this plan

- The return stays on the same legal case and opens a new care episode.
- A prior finalized discharge is never unfinalized to resume care.
- The new note is a distinct `pain_follow_up_notes` table, not a third singleton
  value in `initial_visit_notes`.
- Historical visit modality backfills as `unknown`; the migration will not claim
  an old visit was in-person when that is not recorded.
- Procedure recommendation and scheduling use separate `procedure_orders` and
  `procedure_appointments` tables.
- New-episode procedure numbering is series-scoped and starts at 1, including an
  explicit continuation series linked to a prior episode; existing procedure
  numbers are preserved during backfill.
- Appointment timestamps are stored as `timestamptz` and displayed/edited in an
  explicit clinic IANA timezone. The migration backfills the current clinic
  default as `America/Los_Angeles`; Settings owns later changes.
- Completed pain follow-ups prepopulate billing with service-catalog CPT `99213`.
  Scheduled/cancelled/no-show encounters and appointments are excluded.
- The rollout gate is the server-only environment variable
  `ENABLE_RETURN_TELE_VISITS`. Add one shared guard under `src/lib/features/`
  that treats only the literal value `true` as enabled. Pages call it before
  loading feature data and return `notFound()` when disabled; every new mutation
  action calls it and returns a stable disabled error. Sidebar visibility uses
  the same helper, so direct URLs cannot bypass the gate.

## What We Are Not Doing

- Integrating Google Calendar, Outlook, or another external scheduling system.
- Adding reminder delivery, waitlists, recurring appointments, resource/room
  optimization, or real-time provider availability.
- Implementing insurance authorization workflows.
- Providing a video-call platform.
- Making legal or jurisdiction-specific telehealth-compliance determinations.
  The product will store neutral documentation fields; clinic counsel/operations
  must define required values separately.
- Replacing the existing **New Case for This Patient** workflow.
- Renaming `initial_visit_notes`, `procedures`, or other mature tables.
- Rewriting historical generated note text or PDFs.
- Automatically reopening `archived` cases.
- Dropping legacy case/type lookups in the same release that introduces the new
  tables.

## Implementation Approach

### Ownership model

```text
patients
  -> cases
       -> care_episodes
            -> clinical_encounters
            |    -> pain_follow_up_notes
            |    -> procedure_orders
            |
            -> procedure_series
            |    -> procedures (performed)
            |
            -> procedure_orders
                 -> procedure_appointments
                      -> procedures (exactly one when completed)
```

Existing Initial/Pain Evaluation and discharge notes gain nullable episode and
encounter foreign keys for compatibility/backfill. New pain follow-up notes are
encounter-native from their first release.

### Compatibility strategy

- Preserve current `case_id` columns and legacy action signatures.
- Add nullable ownership foreign keys, backfill them, then make only **new**
  workflow writes require episode/encounter IDs.
- Centralize episode selection in a shared helper. Legacy callers resolve the
  active episode, then latest episode, then a deterministic backfilled Episode 1.
- Update every singleton/all-case reader before permitting a second episode or
  second discharge in production.
- Preserve existing procedure numbers. Backfilled procedures share a legacy
  series whose stored per-procedure numbers are not recalculated.
- Use unique foreign keys and idempotent actions so retries cannot create two
  notes or two performed procedures for one encounter/appointment.

### Migration and database-security conventions

- Create every migration with the pinned local CLI using
  `supabase migration new <descriptive_name>`; use the generated timestamped
  filename and never hand-author migration timestamps.
- Keep migrations in the phase order documented below. Before each database
  change, inspect the pinned CLI's relevant `--help` output so repository
  scripts use the installed version's supported flags.
- For every new table in the exposed `public` schema, enable RLS, revoke default
  privileges from `anon` and `authenticated`, then grant only the operations the
  authenticated application actually uses. Define and test a separate policy
  for each granted operation; `anon` receives no clinical-data privileges.
- Define public RPCs as `security invoker`, revoke default execute permission
  from `public` and `anon`, and grant execute only to `authenticated`. Their
  underlying table grants and RLS policies remain authoritative; no
  `security definer` RPC is introduced. Set a fixed empty `search_path` and
  fully qualify every referenced object inside each RPC.
- Put grants, policies, and their pgTAP positive/negative tests in the same
  database change so authorization cannot drift from the schema.

## Phase 1: Additive Clinical-Episode Schema and Backfill

### Files and changes

#### Migration: `care_episodes_and_encounters`

Generate with `supabase migration new care_episodes_and_encounters`.

Create `care_episodes`:

- `id`, `case_id`, `episode_number`;
- `status`: `active | discharged | cancelled`;
- `opened_at`, `ended_at`, `end_reason`, `return_reason`;
- audit and soft-delete fields;
- unique `(case_id, episode_number)`;
- partial unique index allowing one live `active` episode per case;
- authenticated-user RLS matching existing clinical tables, with explicit
  table grants as defined above.

Create `clinical_encounters`:

- `id`, `case_id`, `episode_id`;
- `encounter_type`: `initial_evaluation | pain_evaluation | pain_follow_up |
  discharge`;
- `modality`: `unknown | in_person | telehealth | phone`;
- `status`: `scheduled | in_progress | completed | cancelled | no_show`;
- `scheduled_start`, `scheduled_end`, `encounter_date`, `completed_at`;
- `provider_id references provider_profiles(id)`, `reason_for_visit`; provider
  is an encounter-time snapshot and does not follow later case reassignment;
  audit user IDs continue to reference `users(id)`;
- `provider_intake jsonb` for encounter-scoped complaints, interval history,
  review of systems, and video-observable findings;
- scalar `patient_reported_pain_min`/`patient_reported_pain_max` plus
  `patient_reported_measurements jsonb` for self-reported readings with explicit
  provenance; these are not inserted into clinician-measured `vital_signs`;
- neutral telehealth documentation fields:
  `telehealth_consent_obtained`, `telehealth_consent_at`,
  `patient_location_state`, `provider_location`, `connection_method`;
- audit and soft-delete fields;
- checks that end >= start and completed encounters have an encounter date;
- indexes on case, episode, date, provider, and status.

Create `procedure_series`:

- `id`, `case_id`, `episode_id`, `series_number`, `procedure_type`, `status`;
- `procedure_type` permits every current performed type (`prp`, `cortisone`,
  `hyaluronic`, `botox`) plus `legacy_mixed` only for a backfilled case-wide
  series containing more than one type;
- `status`: `active | completed | cancelled`;
- optional `continued_from_series_id` for an explicit continuation;
- unique `(episode_id, series_number)` and audit fields.

Add nullable compatibility foreign keys:

- `initial_visit_notes.episode_id`, `initial_visit_notes.encounter_id` with a
  unique live `encounter_id` index;
- `discharge_notes.episode_id`, `discharge_notes.encounter_id` with a unique
  live `encounter_id` index;
- `procedures.episode_id`, `procedures.procedure_series_id`,
  `procedures.source_encounter_id`, and
  `procedures.provider_profile_id references provider_profiles(id)`;
- `vital_signs.encounter_id`;
- `clinical_orders.episode_id`, `clinical_orders.encounter_id`;
- `documents.episode_id`, `documents.encounter_id`;
- `invoice_line_items.encounter_id`;
- `case_quality_reviews.episode_id`.

Add `clinic_settings.timezone` as non-null text with the migration default
`America/Los_Angeles`. The Settings validation/UI work in Phase 1 must validate
that submitted values are recognized IANA timezone identifiers before saving.

Do **not** add `procedures.procedure_appointment_id` in this migration because
the referenced appointment table does not exist yet. Add it in the appointments
migration below.

Backfill deterministically:

1. Create Episode 1 for every live case.
2. Mark Episode 1 `discharged` when a finalized live discharge note exists;
   otherwise mark pending-settlement/closed/archived cases `cancelled` with
   `end_reason = 'case_locked_without_finalized_discharge'`; keep other episodes
   active.
3. Create one `clinical_encounters` row for each live Initial/Pain Evaluation
   note, snapshotting the case-assigned `provider_profiles.id` when available,
   setting `encounter_date = coalesce(visit_date, finalized_at::date,
   created_at::date)`, and setting modality to `unknown`. Map finalized notes to
   completed encounters, editable notes in an active episode to `in_progress`,
   and unfinished notes in an ended episode to `cancelled`.
4. Create one discharge encounter for each live discharge note with the same
   finalized/active/ended status mapping and the same
   `coalesce(visit_date, finalized_at::date, created_at::date)` date fallback.
5. Populate note episode/encounter foreign keys.
6. Before applying feature migrations, abort the upgrade preflight if a
   procedure is dated after its case's finalized discharge. Operations must
   correct an erroneous date or explicitly classify the later care into a
   separately prepared episode; the migration never assigns care after an
   episode's `ended_at` silently.
7. Create one legacy procedure series per case that has procedures, using its
   single existing type or `legacy_mixed`, attach all existing procedures, and
   preserve their stored `procedure_number` values. Snapshot the case-assigned
   provider into `procedures.provider_profile_id` when available.
8. Attach procedure-linked vitals to the procedure's episode. Leave legacy
   non-procedure vitals without `encounter_id`; their encounter is ambiguous.
9. Attach every existing `clinical_order` to its case's Episode 1; attach its
   optional encounter through `initial_visit_note_id` when available. Assign existing
   `case_quality_reviews` to Episode 1.
10. Attach generated documents through their source note/procedure where the
   relationship is unambiguous. Leave unrelated uploads episode-null.

After validating that preserved legacy numbering has no conflicts, add a partial
unique live `(procedure_series_id, procedure_number)` index. All new numbering,
including the direct Record Procedure compatibility flow, must use a locked
transactional allocator rather than `max(...) + 1` in application code.

Derive Episode 1 `opened_at` from the earliest associated clinical date, falling
back to `cases.created_at`. Derive `ended_at` for discharged/cancelled episodes
from finalized discharge, case close, or update timestamps in that order.

The migration must be reproducible for development resets and assert, before
completion, that every live Initial/Pain Evaluation note, discharge note,
procedure, clinical order, and quality review has an episode assignment.

#### Migration: `pain_follow_up_notes`

Generate with `supabase migration new pain_follow_up_notes`.

Create `pain_follow_up_notes`, one live note per `encounter_id`, with:

- `case_id`, `episode_id`, `encounter_id`;
- sections: `subjective`, `interval_history`, `review_of_systems`,
  `telehealth_observations`, `imaging_review`, `assessment`, `diagnoses`,
  `treatment_plan`, `patient_education`, `follow_up`,
  `clinician_disclaimer`;
- `procedure_recommendations jsonb`, provider-approved structured items carrying
  a stable `recommendation_id`, procedure type, sites, diagnoses, rationale, and
  suggested timing; narrative treatment-plan text is never reparsed to create
  an order;
- AI generation/progress/source-hash fields matching existing note tables;
- draft/finalization/document/audit/soft-delete fields matching existing note
  lifecycles;
- partial unique live `encounter_id` index and authenticated-user RLS.

#### Migration: `procedure_orders_and_appointments`

Generate with `supabase migration new procedure_orders_and_appointments`.

Create `procedure_orders`:

- `id`, `case_id`, `episode_id`, `source_encounter_id`,
  `source_recommendation_id`, `procedure_series_id`;
- `procedure_type`, proposed `sites`, diagnoses, clinical rationale, priority;
- `status`: `ordered | scheduled | cancelled | completed`;
- audit and soft-delete fields.
- partial unique live `(source_encounter_id, source_recommendation_id)` index.

Create `procedure_appointments`:

- `id`, `case_id`, `episode_id`, `procedure_order_id`;
- `scheduled_start`, `scheduled_end`, `provider_id references
  provider_profiles(id)` as an appointment-time snapshot, location, notes;
- `status`: `scheduled | cancelled | no_show | completed`;
- `cancellation_reason`, `completed_at`;
- audit and soft-delete fields;
- prevent overlapping active appointment attempts for the same order with a
  partial unique index on scheduled attempts;
- add `procedures.procedure_appointment_id` only after the table exists and
  enforce a unique live link so an appointment can produce at most one
  performed record;
- add a partial unique index on `(invoice_id, encounter_id)` to
  `invoice_line_items` when `encounter_id is not null`, ensuring one visit source
  appears at most once per invoice.

Create `billing_source_claims` to prevent the same source/category from appearing
on multiple non-void invoices. It stores `invoice_id`, exactly one
`encounter_id`/`procedure_id`, and `claim_kind`: encounters use `visit`;
procedures use `medical` or `facility` so the existing medical/facility split
remains valid. Add partial unique live indexes per `(source, claim_kind)` and a
check requiring exactly one source. Backfill from existing non-void line items
using invoice type to derive claim kind. A preflight upgrade check aborts if it
finds duplicate historical source/category claims; operations must void or
repair the conflict before retrying. Invoice create, replacement, and void RPCs
own claims and record release reason/time transactionally.

Create `operation_idempotency` with authenticated actor ID, operation type,
client key, aggregate IDs, input hash, status, and the minimal result IDs needed
for replay. Unique `(actor_id, operation_type, client_key)` makes return-start,
scheduling, and appointment-completion lost-response retries persistent. Each
RPC inserts or locks this row inside its transaction, rejects key reuse with a
different input hash, and returns the stored result when complete.

Add ownership constraints in these additive migrations, not in the later
contract phase. Use composite foreign keys where practical and nullable-aware
triggers otherwise so every new case/episode/encounter/series/order/appointment
link belongs to the same case. Apply the same validation immediately to each new
non-null compatibility link. Only legacy nullability is deferred to Phase 6.

#### Local database verification harness

The repository currently has migrations but no `supabase/config.toml` or SQL
test harness. Add:

- `supabase/config.toml` using the standard local Supabase project layout;
- `supabase/tests/20260825_care_episode_backfill_test.sql` with pgTAP coverage for
  backfill, cardinality, ownership, and state transitions;
- a pinned Supabase CLI development dependency and package scripts for local
  reset/type generation/database tests, rather than relying on an unpinned
  transient `npx` download.

Update `package.json` and the lockfile with the pinned CLI plus scripts such as
`db:reset`, `db:test`, and `gen:types:local`; each script must invoke the locally
installed binary. Do not replace the existing remote `gen:types` workflow.

The existing remote `npm run gen:types` script remains available. Add a local
type-generation script for verification before a remote migration is applied.

Because `supabase test db` runs after all migrations, pgTAP alone cannot test the
upgrade backfill. Add a separate upgrade fixture script/workflow that:

1. applies migrations through the last pre-feature migration;
2. loads representative legacy rows, including every procedure type, mixed
   types, finalized notes with null `visit_date`, existing clinical orders/QC,
   and a procedure dated after discharge;
3. proves the preflight rejects the post-discharge anomaly, duplicate legacy
   procedure numbers, and duplicate billing-source/category fixtures, then
   repairs/removes those anomalies as an operator would;
4. applies the feature migrations in order;
5. runs integrity assertions and then the final-schema pgTAP suite.

Keep the standard pgTAP suite for final constraints, positive/negative RLS and
grant behavior, RPC authorization, and state transitions.

#### `src/types/database.ts`

Regenerate database types from the local migrated database using
`npm run gen:types:local`; do not use the existing remote `npm run gen:types`
until the remote schema has been migrated. After remote deployment, generate
both and require type parity. Review the generated diff; do not hand-edit the
generated table shapes.

#### New domain validation modules

- `src/lib/validations/care-episode.ts`
- `src/lib/validations/clinical-encounter.ts`
- `src/lib/validations/pain-follow-up-note.ts`
- `src/lib/validations/procedure-order.ts`
- `src/lib/validations/procedure-appointment.ts`

Define input schemas and exported value types. Keep database lifecycle enums in
small shared constant modules under `src/lib/constants/` so actions, components,
and tests use one vocabulary.

Update the existing clinic Settings path:

- `src/lib/validations/settings.ts`
- `src/actions/settings.ts`
- `src/components/settings/clinic-info-form.tsx`

Persist and render the clinic timezone used by all appointment forms and date
formatters. Convert local form inputs to `timestamptz` exactly once at the server
boundary and format stored timestamps back in the clinic timezone.

### Automated verification

- Use the new pinned local Supabase harness to apply all migrations to an empty
  database and run pgTAP tests.
- Apply the migrations to a copy containing representative legacy cases:
  active without discharge, active with finalized discharge, pending settlement,
  closed without discharge, closed with discharge, archived, and multi-procedure.
- SQL integrity assertions:
  - one Episode 1 per legacy case;
  - at most one active episode per case;
  - all live legacy notes/discharges/procedures have `episode_id`;
  - existing procedure numbers are unchanged;
  - no historical visit is falsely marked telehealth/in-person;
  - no duplicate encounter/note links.
- Add Zod unit tests next to each new validation module.
- Run `npm run gen:types:local`, `npx tsc --noEmit`, `npm run lint`, and
  `npm test`.

### Manual verification

- Inspect migrated rows for one case of each status combination.
- Confirm all existing patient, Initial Visit, Procedures, Discharge, Billing,
  QC, and Timeline pages still load before any new navigation is exposed.

## Phase 2: Episode-Aware Compatibility Layer and Downstream Readers

### Files and changes

#### `src/lib/clinical/episode-context.ts` (new)

Add shared read helpers:

- `getActiveEpisode(caseId)`;
- `getEpisodeById(caseId, episodeId)`;
- `getActiveOrLatestEpisode(caseId)` for legacy route compatibility;
- `requireWritableEpisode(caseId, episodeId)` combining the existing case lock
  with episode status;
- pure selectors for latest completed encounter and episode date floors.

Helpers must reject cross-case IDs and return explicit errors rather than
falling through to an arbitrary `.maybeSingle()` result.

#### `src/actions/case-status.ts`

Keep existing status transitions and wrappers intact. Add one transactional
Postgres RPC in the CLI-generated `start_return_episode_rpc` migration, called
by a new server action,
`startReturnCareEpisode(caseId, returnReason, firstEncounterInput)`:

1. lock the case row;
2. reject archived/deleted cases;
3. ensure there is no live active episode;
4. create the next episode number;
5. create the first `pain_follow_up` encounter in that episode with its modality,
   scheduled time/date, provider, and reason;
6. change `closed` or `pending_settlement` to `active` and append status history;
7. leave an already Active case Active;
8. return both episode and encounter IDs.

When reactivating, mirror `updateCaseStatus`: clear `case_close_date`, set
`updated_at`/`updated_by_user_id`, and include the return reason in
`case_status_history`. Accept a client-generated idempotency key and return the
original episode/encounter on a retry after a lost response.

Use a security-invoker function and `auth.uid()` for the audit user. The unique
active-episode index is the concurrency backstop. The episode and first
encounter must never be created through two independent client-visible writes.

#### Existing note/order actions

Update the following readers to select an explicit episode or use the legacy
compatibility resolver:

- `src/actions/initial-visit-notes.ts`
- `src/actions/discharge-notes.ts`
- `src/actions/discharge-notes-trajectory.ts`
- `src/actions/procedures.ts`
- `src/actions/procedure-notes.ts`
- `src/actions/clinical-orders.ts`
- `src/actions/case-quality-reviews.ts`
- `src/actions/billing.ts`
- `src/actions/timeline.ts`
- relevant page-level queries under
  `src/app/(dashboard)/patients/[caseId]/`.

Specific corrections:

- When the legacy Initial/Pain Evaluation route creates a note, first resolve or
  create its Episode 1 encounter and write both foreign keys. Preserve the old
  `(caseId, visitType)` action API as a compatibility wrapper.
- When pre-generation discharge vitals/tone create a draft discharge row, first
  resolve or create that episode's discharge encounter; no new discharge row may
  be episode-null.
- When the existing direct **Record Procedure** flow creates a procedure before
  appointment completion is used, attach the active episode and that episode's
  default/legacy series, and snapshot the current case-assigned provider into
  `provider_profile_id`, while preserving the current user flow.
- During the compatibility deployment, an Active case whose Episode 1 is already
  discharged must show **Start Return Visit** in the same release that direct
  procedure writes begin requiring an active episode. Do not deploy the stricter
  guard by itself. Until `ENABLE_RETURN_TELE_VISITS=true`, the existing direct
  action uses its dual-write compatibility behavior. Enable the feature and the
  stricter active-episode guard atomically; afterward direct recording cannot
  append care to a discharged episode.
- Replace unqualified finalized Initial Visit `.maybeSingle()` calls in
  discharge gathering with explicit encounter/episode selection.
- Scope discharge source procedures, vitals, diagnoses, and trajectory to the
  discharge note's episode.
- Scope procedure defaults and date floors to the selected episode.
- Update procedure note generation, finalized views, and PDF/signature rendering
  to use the procedure's provider snapshot, with the current case-assigned
  provider only as a compatibility fallback for legacy null snapshots.
- Make billing gather all **completed** encounter notes for visit line items and
  exclude scheduled/cancelled/no-show encounters.
- Keep invoices case-owned; add `encounter_id` only to generated visit line
  items for deduplication and traceability.
- Replace the current multi-write invoice create/update path with transactional
  security-invoker RPCs that write the invoice, replace line items, and acquire
  or release `billing_source_claims` atomically. A uniqueness failure must not
  leave an orphan invoice or delete the prior line-item set.
- Update `src/lib/validations/invoice.ts` and
  `src/components/billing/create-invoice-dialog.tsx` so create/edit flows carry
  the hidden nullable `encounter_id` source through form state and persistence;
  manual line items leave it null.
- Add encounter/episode/treatment-series event types to `TimelineEventType` while
  preserving existing event shapes.
- Change quality-review ownership and active uniqueness from case-only to
  episode-aware after backfill; legacy QC routes default to active/latest
  episode.

#### Episode-scoped cardinality migration

After the episode-aware dual-write writers are deployed, run a
`catch_up_episode_ownership` migration before changing cardinality. It repeats
the deterministic Phase 1 assignment for any live note, procedure, clinical
order, document, or quality review created by the old application between the
initial migration and writer deployment; creates the required singleton
encounters; and aborts unless every core live row is now episode-owned. Keep the
old and new writers compatible until this catch-up succeeds.

Then generate an `episode_scoped_cardinality` migration only after the readers
and writers above are episode-aware:

- replace `idx_discharge_notes_case_active` with a partial unique live
  `episode_id` index;
- require `episode_id` and `encounter_id` for newly inserted discharge notes;
- keep `case_id` for compatibility and efficient case history queries;
- add a trigger ensuring note, encounter, episode, and case ownership agree;
- replace `idx_case_quality_reviews_case_active` with a partial unique live
  `(episode_id)` index, retaining the case index for history queries.
- add partial unique live cardinality for `initial_evaluation`,
  `pain_evaluation`, and `discharge` encounter types per episode; return visits
  remain append-only and may repeat.

Do not make the legacy columns globally `NOT NULL` yet; the contract phase owns
that enforcement after production validation.

### Automated verification

- Add unit tests for active/latest episode resolution, wrong-case IDs, no active
  episode, and concurrent-return unique violations.
- Extend existing action tests to cover explicit episode selection and legacy
  fallback behavior.
- Regression tests for discharge gathering with both Initial and Pain Evaluation
  notes finalized.
- Regression tests proving Episode 2 discharge/procedures do not enter Episode 1
  pain trajectory, QC input, or default selection.
- Billing tests proving only completed encounters produce 99204/99213 lines and
  that `encounter_id` prevents duplicate prepopulation.
- Compatibility test for an Active case with a finalized Episode 1 discharge,
  proving the return-start action is available before direct procedure writes
  are blocked.
- Deployment-window fixture that inserts legacy episode-null records after the
  Phase 1 backfill, then proves the catch-up migration assigns them before
  cardinality changes.
- Timeline tests for legacy and new event types.
- Run targeted action/unit tests, followed by `npx tsc --noEmit`,
  `npm run lint`, `npm test`, and `npm run build`.

### Manual verification

- Compare existing case pages before and after episode-aware readers using the
  same seeded database.
- Confirm a legacy case with two finalized evaluation note types no longer
  depends on an ambiguous singleton query.
- Confirm starting a return on closed/pending-settlement/active cases produces
  the intended case status and exactly one new episode; archived remains blocked.

## Phase 3: Return-to-Care and Telehealth Pain Follow-Up

### Files and changes

#### Server actions

Create `src/actions/care-episodes.ts` for episode list/detail/start-return reads
and commands, delegating the atomic start to the Phase 2 RPC.

Create `src/actions/clinical-encounters.ts` for encounter scheduling,
rescheduling, cancellation/no-show, start, and completion. Validate that the
encounter belongs to the active writable episode.

Create `src/actions/pain-follow-up-notes.ts` following the established note
lifecycle:

- one note per pain-follow-up encounter;
- generation lock and progress updates;
- source-data hash;
- draft editing and section regeneration;
- finalization to a generated PDF/document linked to episode and encounter;
- transactional unfinalize/reset only while the episode is active, the case is
  writable, no live procedure order references the encounter, and no unreleased
  visit billing claim exists; the RPC returns the encounter to `in_progress`
  with the note lifecycle change;
- revalidation of visits/documents/timeline paths.

Finalizing a follow-up note must atomically finalize the note and mark its
encounter completed through a security-invoker RPC defined in the CLI-generated
`finalize_pain_follow_up_rpc` migration. Procedure orders may only be created
after that transition. If PDF upload/document creation succeeds but the RPC
fails, remove the uploaded object and soft-delete the orphan document before
returning the error.

#### AI generation and clinical safeguards

Create:

- `src/lib/claude/generate-pain-follow-up.ts`
- `src/lib/claude/__tests__/generate-pain-follow-up.test.ts`

Gather source context from:

- the current encounter's provider-entered telehealth intake;
- the latest relevant completed encounter in the current episode;
- the immediately preceding episode's finalized discharge summary;
- prior performed procedures and current imaging/approved extraction context;
- encounter-scoped patient-reported pain values.

Prompt and deterministic validation requirements:

- label the modality explicitly;
- separate patient-reported findings from provider-observed video findings;
- prohibit palpation, strength grading, reflex testing, range-of-motion degrees,
  procedure vitals, and other hands-on findings unless explicitly supplied;
- never import legacy `procedure_id IS NULL` vitals as current telehealth data;
- carry prior values only as historical comparisons with dates/source labels;
- keep procedure recommendations conditional until an order is explicitly
  created by the provider.

Add modality-specific validators under `src/lib/qc/` and unit tests for
forbidden hands-on findings and unsupported current-visit vitals.

Extend the QC contract and UI for `pain_follow_up` findings:

- `src/lib/validations/case-quality-review.ts`
- `src/lib/claude/generate-quality-review.ts`
- `src/actions/case-quality-reviews.ts`
- `src/components/clinical/qc-review-panel.tsx`

Include nullable `encounter_id` in finding payloads, route new findings to the
encounter note, and dispatch **Fix** to the pain-follow-up section regeneration
action. Persisted legacy findings without the field validate with null and keep
the legacy hash algorithm; new encounter-scoped findings use a versioned hash.
Add old-payload regression fixtures so existing finding steps/hashes remain
readable.

#### PDF

Create:

- `src/lib/pdf/pain-follow-up-template.tsx`
- `src/lib/pdf/render-pain-follow-up-pdf.ts`

Render encounter date, modality, consent/location fields when present, provider,
the dedicated follow-up sections, and the normal medico-legal header/signature.
Use the existing filename builder and generated-document storage conventions.

#### Routes and components

Create:

- `src/lib/features/return-tele-visits.ts`
- `src/app/(dashboard)/patients/[caseId]/visits/page.tsx`
- `src/app/(dashboard)/patients/[caseId]/visits/[encounterId]/page.tsx`
- `src/components/visits/visit-list.tsx`
- `src/components/visits/start-return-episode-dialog.tsx`
- `src/components/visits/schedule-visit-dialog.tsx`
- `src/components/visits/pain-follow-up-editor.tsx`
- encounter-scoped telehealth intake and patient-reported-pain components.

The Visits page shows episodes and append-only encounters. It includes
**Start Return Visit** when the latest episode is not active. Its dialog collects
the first encounter's modality, date/time, provider, and return reason, then
invokes the single atomic episode-plus-encounter action.

The feature helper reads `ENABLE_RETURN_TELE_VISITS` server-side. Both Visits
pages call `requireReturnTeleVisitsPage()` before queries, and all new encounter,
return, order, appointment, and completion actions call the mutation guard before
database access. Document the deployment variable in the rollout runbook.

Update `src/components/patients/case-sidebar.tsx` to add **Visits** only after the
end-to-end path is ready. Keep the existing **Initial Visit** route and action
exports working; link the two legacy singleton visits into the Visits history.

Update `src/app/(dashboard)/patients/[caseId]/layout.tsx` to resolve the
active/latest episode and pass a compact episode status to the sidebar. Display
case status and care-episode status separately so an Active legal case with a
Discharged clinical episode is intentional rather than appearing inconsistent.

### Automated verification

- Action tests for start-return, wrong-case encounter access, encounter state
  transitions, locked/cancelled episode guards, and idempotent note creation.
- Generator tests for telehealth wording, prior-discharge continuity, historical
  pain labels, missing data, and forbidden in-person findings.
- Validation tests for date/time, modality, status, consent/location fields, and
  cross-field rules.
- PDF render test confirming modality/date/provider and absence of unsupported
  physical-exam output.
- Billing test for one completed pain follow-up -> one CPT 99213 line, with no
  line while merely scheduled.
- Timeline test for scheduled/completed/cancelled/no-show visits.
- Run targeted tests plus the full TypeScript, lint, test, and build commands.

### Manual verification

- On a case with a finalized prior discharge, start a return visit and confirm
  the old discharge PDF and note remain unchanged.
- Generate/finalize a telehealth note with and without patient-reported vitals;
  inspect UI and PDF for modality-appropriate wording.
- Reopen a closed case through Start Return Visit and confirm status history,
  case close date, new episode, and encounter are consistent.
- Confirm old Initial Visit links/bookmarks continue to work.

## Phase 4: Procedure Recommendation and Scheduling

### Files and changes

#### Server actions and validation

Create `src/actions/procedure-orders.ts` and
`src/actions/procedure-appointments.ts`:

- create an order only from a completed encounter in the same active episode;
- additionally require a finalized live pain-follow-up note; each structured
  recommendation has a stable `recommendation_id`, and a partial unique link on
  `(source_encounter_id, recommendation_id)` prevents duplicate live orders;
- copy provider-approved procedure type, sites, diagnoses, and rationale from the
  follow-up note's structured `procedure_recommendations` through a confirmation
  form—never parse a finalized narrative silently;
- create a current-episode procedure series, defaulting to a new series for a
  return episode. **Continue prior series** creates a new current-episode series
  linked by `continued_from_series_id`; it never reuses the prior episode's
  series row. Numbering restarts at 1 in every episode, while the continuation
  link preserves clinical lineage;
- schedule, reschedule, cancel, no-show, and list appointment attempts;
- preserve prior cancelled appointments during rescheduling;
- enforce `scheduled_end > scheduled_start`, writable case/episode, matching
  case/episode/order ownership, an active `provider_profiles` row, and valid
  state transitions. Default to the case-assigned provider but preserve an
  explicitly selected different provider as the appointment snapshot;
- prevent two active appointment attempts for one order;
- expose a read model containing order, active appointment, attempt history, and
  any completed procedure link.

Define order-state derivation explicitly:

- a new recommendation creates an `ordered` order;
- creating an active appointment changes it to `scheduled`;
- cancelling/no-showing the only active attempt returns the order to `ordered`
  unless the provider cancels the order itself;
- rescheduling atomically cancels the old attempt with
  `cancellation_reason = 'rescheduled'` and creates the replacement;
- completed procedure linkage changes both appointment and order to `completed`;
- `cancelled` and `completed` orders are terminal.

Use transactional security-invoker RPCs for initial scheduling, rescheduling,
and cancellation/no-show transitions so order status and appointment history
cannot diverge. The server actions validate input, invoke the RPC, and map
database errors to user-facing messages. Define the functions in the
CLI-generated `procedure_scheduling_rpcs` migration. Each mutation accepts a
client-generated idempotency key; a retry after a lost response returns the
original active attempt or transition result.

Define transition constants and tests so UI and server actions share the same
state machine. Server actions remain authoritative.

#### UI

Update the completed pain-follow-up view with **Recommend Procedure**, opening a
provider confirmation form prefilled from the note's approved diagnoses and
treatment plan.

Update:

- `src/app/(dashboard)/patients/[caseId]/procedures/page.tsx`
- `src/components/procedures/procedure-table.tsx`

Add **Scheduled** and **Performed** sections without changing current performed
rows. Create:

- `src/components/procedures/procedure-order-dialog.tsx`
- `src/components/procedures/schedule-procedure-dialog.tsx`
- `src/components/procedures/procedure-appointment-table.tsx`

Both sections can be filtered/grouped by episode. The scheduled table displays
date/time in clinic timezone, type, sites, provider, episode, source visit, and
status. It does not display a procedure-note badge until a performed procedure
exists. The order dialog defaults to a new series and provides an explicit
**Continue prior series** choice with the selected series shown before save.

#### Timeline and billing

Extend `src/actions/timeline.ts` and
`src/components/timeline/case-timeline.tsx` with order/scheduled/rescheduled/
cancelled/no-show events.

Do not add procedure billing lines from orders or appointments. Existing billing
continues to query only `procedures`.

### Automated verification

- Validation and transition tests for all order/appointment states.
- Action tests for cross-case/episode IDs, double scheduling, rescheduling
  history, cancellation reason, no-show, and locked cases.
- Regression billing test proving a scheduled appointment produces zero
  performed-procedure/facility line items.
- Timeline tests distinguishing appointment events from performed procedures.
- Component-level logic tests where existing test infrastructure permits;
  otherwise keep interaction coverage in action/validation tests.
- Run targeted and full verification commands.

### Manual verification

- Recommend and schedule PRP and BOTOX from a completed telehealth visit.
- Reschedule once and confirm both the cancelled attempt and new appointment are
  visible.
- Confirm scheduled/cancelled/no-show appointments never appear as performed,
  do not expose Procedure Note, and do not prepopulate procedure billing.

## Phase 5: Appointment Completion, Series Scoping, and Episode Discharge

### Files and changes

#### Performed-procedure handoff

Update:

- `src/actions/procedures.ts`
- `src/components/procedures/record-procedure-dialog.tsx`
- `src/components/procedures/record-botox-dialog.tsx`

Accept an optional `procedureAppointmentId` only for creation. Resolve the linked
order/episode/series server-side and prefill—but still require provider
confirmation of—the performed date, sites, diagnoses, consent, vitals, and all
procedure-specific details.

Make completion a single idempotent security-invoker RPC:

1. lock and validate the appointment, order, episode, case, recommendation, and
   current provider snapshot;
2. return the existing completed procedure for a repeated idempotency key or
   already-linked appointment;
3. allocate the next series-scoped number under lock;
4. insert the performed procedure and its optional vitals from the confirmed
   form in the same transaction, copying
   `procedure_appointments.provider_id` into
   `procedures.provider_profile_id`;
5. link the procedure and mark the appointment/order completed atomically.

The existing direct Record Procedure action remains a compatibility path but
it must use a companion transactional creation RPC with the same locked series
allocator. Appointment completion must use the appointment RPC. Unique series
number and appointment linkage constraints remain defense-in-depth, not the
primary consistency mechanism.

#### Series numbering and deletion

Update procedure creation, prior-procedure lookup, note generation, and deletion
display to use `procedure_series_id`. For legacy rows without a series during
the compatibility window, retain the current case-wide fallback. Once a
performed procedure is committed, its number is immutable and later deletion
leaves a permanent sequence gap; never renumber historical rows. Prohibit normal
deletion of an appointment-completed procedure once it has a finalized note or
appears on a non-void invoice. For other linked procedures, use an audited
transaction that soft-deletes the procedure/vitals and returns the appointment
and order to `scheduled`; never leave a completed appointment without its
performed record.

Replace the database procedure-date floor with episode-aware enforcement:

- procedure date must be on/after the source completed encounter and the latest
  relevant completed evaluation/follow-up in its episode;
- it must not be compared with later encounters from another episode;
- trigger validates matching case/episode ownership.

Do not renumber committed procedures within or across series. Preserve historical
numbers and finalized document references.

#### Episode-scoped discharge

Update the Discharge route and `src/actions/discharge-notes.ts` to accept an
explicit episode. Generate only from that episode's completed encounters,
performed procedures, and encounter-scoped vitals, while optionally including a
labeled prior-episode summary as historical context.

Finalization should complete the discharge note and mark its episode discharged
in one database transaction after the PDF/document record exists. Add an
idempotent RPC in the CLI-generated `finalize_episode_discharge_rpc` migration
for the final note/episode state transition. Case status remains unchanged and
is still managed by the existing status dropdown.

The RPC also completes the discharge encounter. It rejects discharge while the
episode has another scheduled/in-progress encounter, an ordered/scheduled
procedure order, or an active appointment. Those records are not silently
cancelled; the provider must resolve them first through their audited workflows.
After those checks pass, the same transaction marks any remaining active
procedure series in the episode `completed` before discharging the episode.

If that RPC fails after file upload/document insertion, follow the same cleanup
path as follow-up-note finalization: remove the uploaded object and soft-delete
the orphan document. A retry must detect an already-finalized note/episode and
return success without creating another document.

Update quality review and pain-trajectory tests for a second full episode so the
new discharge cannot blend procedure/vital values from Episode 1.

#### Billing

Update `src/actions/billing.ts`:

- completed pain follow-up encounters add CPT 99213 with `encounter_id`;
- an episode discharge also uses 99213 but its own discharge encounter ID;
- performed procedure lines continue to reference `procedure_id`;
- dedupe by source encounter/procedure so repeated form loads do not duplicate
  prepopulated sources;
- exclude sources claimed by another non-void invoice; voiding an invoice
  releases its claims, after which the source can be billed again;
- use the transactional invoice RPCs for create/edit/void so claim and line-item
  state cannot diverge;
- scheduled/cancelled/no-show records remain excluded.

### Automated verification

- Idempotency test: completing the same appointment twice creates one procedure.
- Repair-path test: procedure exists but appointment remains scheduled; retry
  marks it completed without another insert.
- Atomic rollback test proving procedure, vitals, appointment, and order all
  remain unchanged if any completion step fails.
- Provider-snapshot test where the appointment provider differs from the case
  assignment and remains the procedure note/PDF signer after later reassignment.
- New-series and explicit-continuation numbering tests.
- Deletion tests proving committed procedure numbers never change and sequence
  gaps remain visible.
- Linked-procedure deletion tests for finalized-note/non-void-invoice rejection
  and audited reversion of an otherwise-correctable completion.
- Database trigger tests for wrong episode, procedure before source encounter,
  and valid same-day performance.
- Two-episode discharge generation, trajectory, QC, timeline, and billing tests.
- Discharge rejection tests for unresolved encounters, orders, and appointments,
  plus successful atomic completion of note, discharge encounter, and episode.
- Regression tests for legacy no-series procedures and existing discharge pages.
- Run full migration smoke, type generation/check, lint, tests, and production
  build.

### Manual verification

- Complete a scheduled appointment and confirm the existing PRP/BOTOX performed
  form is prefilled but still requires clinical confirmation.
- Confirm exactly one performed procedure, one procedure note path, correct
  series number, timeline event, and billing source.
- Discharge Episode 2 and verify Episode 1 discharge/note/PDF/trajectory remain
  unchanged and separately accessible.

## Phase 6: Contract, Constraints, and Rollout Hardening

### Files and changes

#### Contract migration

After production backfill verification, add a separate migration that:

- enforces non-null `episode_id` on live Initial/Pain Evaluation notes,
  discharge notes, and procedures;
- enforces non-null `encounter_id` on new/active encounter-native notes and
  non-procedure vitals created after the cutover;
- validates the ownership-consistency constraints installed with the additive
  schema and strengthens only checks that could not be made non-null during the
  compatibility window;
- verifies the case-level discharge unique index removed in Phase 2 has not been
  recreated and the episode-level unique index is present;
- keeps `case_id` denormalized on clinical records for compatibility and query
  performance.

Do not remove legacy action exports or the Initial Visit route in this project.
Track that cleanup separately after usage confirms no external callers remain.

#### Operational checks

Add a documented integrity query/runbook under
`thoughts/shared/handoffs/` or repository operations documentation covering:

- cases with zero/multiple active episodes;
- live clinical records missing episode/encounter links;
- completed appointments without procedures;
- procedures linked to non-completed appointments;
- cross-case ownership mismatches;
- duplicate billing sources;
- discharged episodes without a finalized discharge note and vice versa.

Use existing structured `console.warn` conventions for repairable compatibility
fallbacks during rollout. Remove or downgrade warnings once contract constraints
are deployed.

### Automated verification

- Run integrity queries before and after the contract migration.
- Re-run migration from an empty database and from the legacy-data fixture
  through the pinned local Supabase harness.
- Cover every legacy procedure type and mixed series, finalized legacy notes
  with null visit dates, provider-profile ownership, existing order/QC
  backfills, and post-discharge procedure reporting.
- Cover duplicate recommendation/order submission, scheduling retry after a
  lost response, follow-up unfinalization after order creation, and discharge
  with unresolved work.
- Cover unauthenticated RPC rejection, authenticated least-privilege grants,
  old QC JSON without `encounter_id`, and server-gate rejection through a direct
  route/action call.
- Verify local and post-deployment remote generated database types are equal.
- Run `npm run gen:types:local`, `npx tsc --noEmit`, `npm run lint`,
  `npm test`, and `npm run build`; after remote migration, run the existing
  remote generator and verify parity before accepting its output.
- Confirm no code path still uses an unqualified `.single()`/`.maybeSingle()` for
  multi-episode notes or discharges.

### Manual verification

- End-to-end production-like scenario:
  1. finalize and preserve Episode 1 discharge;
  2. close the case;
  3. start a return telehealth visit;
  4. finalize the follow-up note;
  5. recommend, schedule, reschedule, and complete a procedure;
  6. generate the procedure note and invoice;
  7. discharge Episode 2;
  8. inspect both episodes, PDFs, timeline, QC, and billing.

## Risks and Rollback Considerations

### Migration/backfill risk

The largest risk is assigning historical records to the wrong episode or
inventing modality. Mitigation: all historical clinical records go to Episode 1,
modality is `unknown`, ambiguous non-procedure vitals stay encounter-null, and
integrity assertions block migration completion on missing core links.

Rollback: Phases 1-2 are additive. Hide new navigation, stop new writes, and keep
legacy readers using case/type fallbacks. Do not drop new tables after production
data exists; use forward-fix migrations.

### Mixed-scope clinical context

All-case queries could blend prior discharge/procedure/vital data into a new
episode. Mitigation: Phase 2 updates every downstream reader before navigation
exposes Episode 2, with two-episode regression fixtures.

Rollback: disable Start Return Visit while keeping existing episodes readable.

### Procedure/billing corruption

Treating appointments as procedures would create premature timeline and billing
events. Mitigation: separate tables, unique appointment-to-procedure linkage,
idempotent completion, and regression tests that scheduled records never reach
performed billing.

Rollback: disable completion actions; appointments remain operational records and
existing performed procedures are untouched.

### Case/episode status divergence

A case may be Active while its latest episode is discharged; that is intentional
because legal and clinical closure are separate. UI must show both states and
write guards must validate both.

Rollback: hide episode start controls; do not infer or rewrite case status from
episode state outside the explicit atomic return action.

### Finalized document immutability

Existing unfinalize flows can mutate the singleton discharge after reopen.
Mitigation: once an episode is discharged, its finalized note cannot be
unfinalized through normal provider flows. Any administrative correction must be
a separately audited future capability.

### Deployment ordering

Deploy in this order:

1. additive schema/backfill;
2. compatibility readers;
3. server-gated routes/actions and dual-write compatibility writers, while the
   existing direct-action guard remains conditional on the disabled gate;
4. end-to-end verification;
5. atomically set `ENABLE_RETURN_TELE_VISITS=true`, expose navigation, and
   activate the stricter active-episode guard;
6. contract constraints in a later release.

Never deploy the relaxed discharge uniqueness before episode-aware readers.

## Completion Criteria

- All existing live clinical records are assigned to a deterministic care
  episode without changing generated content, procedure numbers, or PDFs.
- Existing Initial Visit, Procedures, Discharge, Billing, QC, Timeline, and
  document routes pass regression checks.
- A discharged same-case patient can start exactly one new active episode and a
  pain-management telehealth follow-up.
- The prior episode's finalized discharge remains immutable and accessible.
- The telehealth note is encounter-scoped, modality-labeled, and guarded against
  unsupported in-person findings/vitals.
- A completed follow-up can create a procedure order and retain appointment
  history through schedule/reschedule/cancel/no-show states.
- Scheduled procedures are absent from performed billing, procedure notes, and
  performed-care timeline events.
- Appointment completion creates exactly one existing performed procedure and
  correct series-scoped numbering.
- Episode 2 discharge/QC/trajectory/billing exclude Episode 1 clinical data
  except where explicitly labeled as historical context.
- Database ownership/cardinality integrity checks pass.
- Targeted and full tests, type-checking, linting, migration smoke tests, and the
  production build pass.
- Manual end-to-end verification covers return, tele-visit, scheduling,
  performance, billing, and second discharge.
