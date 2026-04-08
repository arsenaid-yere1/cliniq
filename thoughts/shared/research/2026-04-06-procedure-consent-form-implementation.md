---
date: 2026-04-06T00:00:00-07:00
researcher: arsen
git_commit: 58b6cd0a55882fdcba992d598c33fa99c88f5135
branch: main
repository: cliniq
topic: "Best way to implement Procedure Consent Form"
tags: [research, procedures, consent, prp, forms, hipaa, signatures, pdf]
status: complete
last_updated: 2026-04-06
last_updated_by: arsen
---

# Research: Best way to implement Procedure Consent Form

**Date**: 2026-04-06
**Researcher**: arsen
**Git Commit**: 58b6cd0a55882fdcba992d598c33fa99c88f5135
**Branch**: main
**Repository**: cliniq

## Research Question
What is the best way to implement a Procedure Consent Form for ClinIQ — covering schema, validation, UI, signature capture, PDF generation, and HIPAA-compliant storage — given the existing PRP procedure infrastructure already in place?

## Summary

ClinIQ already captures a single `consent_obtained: boolean` checkbox inside the PRP procedure dialog ([record-procedure-dialog.tsx:305-320](src/components/procedures/record-procedure-dialog.tsx#L305-L320)), and surfaces it as boilerplate text in the AI-generated procedure note. There is **no dedicated consent record, no signature capture, no consent PDF, and no consent template versioning** anywhere in the codebase. To build a real Procedure Consent Form, the recommended approach reuses every pattern that already exists in the project:

1. A new `procedure_consents` table linked to `case_id` (and optionally `procedure_id`), modeled after the lien-agreement document flow.
2. A versioned static template (similar to `lien-agreement-template.tsx`) with a 17-item PRP consent body, contraindication checklist, itemized risk acknowledgments, and dual signature blocks.
3. A wizard-style React form (modeled after `patient-wizard.tsx`) for the in-office tablet flow, since the field count and per-section initialing maps poorly to a single scrollable dialog.
4. Signature capture via `react-signature-canvas` written to Supabase Storage as a PNG, mirroring the existing `provider-signature-upload.tsx` storage pattern.
5. A PDF/A artifact rendered with `@react-pdf/renderer`, hashed (SHA-256) for tamper detection, stored under the existing `documents` table with a new `document_type` enum value.
6. The existing `procedures.consent_obtained` boolean is repurposed as a derived flag — set to `true` automatically when a signed `procedure_consents` row exists for the case.

The architecture aligns with what production EMR/EHR systems do (Interlace, mConsent, AdvancedMD): templated → sent/presented → patient-signed → provider-countersigned → locked PDF → attached to chart.

---

## Detailed Findings

### Current state of "consent" in the codebase

The word "consent" appears in exactly 8 source files, all tied to the PRP procedure flow. There is no dedicated consent module.

**Database**: A single boolean column.
- [supabase/migrations/013_prp_procedure_encounter.sql:8](supabase/migrations/013_prp_procedure_encounter.sql#L8) — `add column consent_obtained boolean,` (nullable, no default)
- [src/types/database.ts:2194](src/types/database.ts#L2194) — typed `boolean | null`

**Validation**: [src/lib/validations/prp-procedure.ts:50](src/lib/validations/prp-procedure.ts#L50) — `consent_obtained: z.boolean()` (required at form layer).

**UI**: [src/components/procedures/record-procedure-dialog.tsx:305-320](src/components/procedures/record-procedure-dialog.tsx#L305-L320) — a shadcn `<Checkbox>` in the Encounter Details section. No conditional logic, no gating, no secondary fields. Defaults to `false`.

**Server actions**: Read/written verbatim in [src/actions/procedures.ts](src/actions/procedures.ts) (`createPrpProcedure` line 91, `updatePrpProcedure` line 189) and forwarded to AI generation in [src/actions/procedure-notes.ts:151](src/actions/procedure-notes.ts#L151).

**AI generation**: [src/lib/claude/generate-procedure-note.ts:161-162](src/lib/claude/generate-procedure-note.ts#L161-L162) — the boolean drives boilerplate text in the `procedure_preparation` section ("consent obtained, risks/benefits explained, positioning, sterile prep, time-out").

**Display**: [src/components/procedures/procedure-table.tsx:61](src/components/procedures/procedure-table.tsx#L61) — included in `ProcedureTableRow` type.

**There is no**: signature capture, consent template, consent PDF, dedicated consent table, audit trail of who-consented-when, witness/translator capture, contraindication checklist, or per-risk acknowledgment.

---

### Existing patterns this implementation should reuse

#### A. Static legal document template (lien agreement)

[src/lib/pdf/lien-agreement-template.tsx](src/lib/pdf/lien-agreement-template.tsx) is the closest precedent. It:
- Renders 4 hardcoded `LIEN_PARAGRAPH_*` string constants as paragraph blocks
- Uses blank underline boxes for **physical** wet signatures (patient + attorney)
- Pulls clinic/patient/attorney info from case data
- Has a corresponding render layer at [src/lib/pdf/render-lien-agreement-pdf.ts](src/lib/pdf/render-lien-agreement-pdf.ts) that fetches all data, downloads logos as base64, and produces a `Buffer` via `renderToBuffer()`
- Is stored in the `documents` table under `document_type = 'lien_agreement'`, added in [supabase/migrations/024_lien_agreement.sql:8](supabase/migrations/024_lien_agreement.sql#L8)

This is the file to clone-and-modify for the consent PDF.

#### B. Multi-step wizard (patient creation)

[src/components/patients/patient-wizard.tsx](src/components/patients/patient-wizard.tsx) is the only existing wizard pattern. It:
- Creates **one** `useForm` instance with `zodResolver(createPatientCaseSchema)` and `mode: 'onBlur'`
- Shares the form via `FormProvider` across step components
- Maintains `currentStep` (0–N) in local state
- Uses a `STEP_FIELDS` map ([line 21](src/components/patients/patient-wizard.tsx#L21)) so `handleNext()` can run `form.trigger(fields)` with only the current step's field names
- Has a final review step that displays all values in `<Card>` blocks with "Edit" buttons calling `goToStep(n)`
- Calls a `createPatientCase()` server action on final submit

This is the right pattern for a Procedure Consent Form because:
- The 17-item consent has 6+ logical sections (identity → procedure description → contraindications → risks → benefits/alternatives → post-care → signatures)
- Each section needs the patient's attention sequentially (the legal defensibility comes from showing the patient read each section)
- The risk-acknowledgment section requires per-line initialing, which doesn't fit a "scroll the whole form" UX

A scrollable dialog (the pattern used by `record-procedure-dialog.tsx`) is **not** appropriate here — that pattern works for clinician-entered structured data but is the wrong fit for legal acknowledgment.

#### C. Form-section dialog pattern with sticky nav

[src/components/procedures/record-procedure-dialog.tsx:39-46](src/components/procedures/record-procedure-dialog.tsx#L39-L46) defines a `SECTIONS` array and a `scrollToSection()` helper ([line 48-50](src/components/procedures/record-procedure-dialog.tsx#L48-L50)) that calls `getElementById(...).scrollIntoView()`. This is reusable for the in-office "review then sign" UX where the provider steps through with the patient.

#### D. Provider signature storage

[src/components/settings/provider-signature-upload.tsx](src/components/settings/provider-signature-upload.tsx) and [supabase/migrations/009_clinic_assets_storage.sql](supabase/migrations/009_clinic_assets_storage.sql) define:
- A Supabase Storage bucket for clinic assets, including provider signatures
- A `provider_profiles.signature_path` column added in [supabase/migrations/007_clinic_provider_settings.sql](supabase/migrations/007_clinic_provider_settings.sql)
- The render layer pattern ([render-procedure-note-pdf.ts:17-21](src/lib/pdf/render-procedure-note-pdf.ts#L17-L21)) downloads signatures from storage, converts non-PNG → PNG via `sharp`, base64-encodes them for `@react-pdf/renderer`'s `<Image>` component

For patient signatures, the same bucket can be reused (or a new `consent_signatures` bucket created with stricter RLS). The capture mechanism that's missing is a canvas-based drawing component — `react-signature-canvas` is the conventional choice.

#### E. Validation file patterns

[src/lib/validations/prp-procedure.ts](src/lib/validations/prp-procedure.ts) demonstrates the deeply-nested sub-schema pattern. Key conventions to follow:
- Nullable numerics use `.nullable()` not `.optional()` so empty inputs are explicit `null`
- Booleans never use `.optional()` — always concrete `boolean` or `boolean.nullable()`
- UUID FKs use `.uuid('error message')`
- Sub-schemas exported as named types for component use

[src/lib/validations/document.ts](src/lib/validations/document.ts) defines the `documentTypeEnum` that would need a new `'procedure_consent'` value added.

#### F. Documents table for storing signed PDFs

The `documents` table (defined in [supabase/migrations/003_document_storage.sql](supabase/migrations/003_document_storage.sql) and extended in [024_lien_agreement.sql](supabase/migrations/024_lien_agreement.sql)) already supports linking PDFs to a `case_id` with a `document_type` discriminator. The signed consent PDF should land here so it appears in the case's Documents tab automatically with no new UI plumbing.

#### G. PDF rendering toolchain

All 7 existing PDF templates ([src/lib/pdf/](src/lib/pdf/)) follow the same shape:
- Typed data interface
- `StyleSheet.create()` for styles
- React component returning `<Document><Page size="LETTER" ...>`
- Helvetica fonts, 50pt padding, clinic header block, optional logo + signature blocks
- Render layer (`render-*.ts`) fetches data + assets, calls `renderToBuffer()`

The new consent template plugs directly into this toolchain.

---

### What a Procedure Consent Form needs to capture (from PRP consent literature)

A 2024 peer-reviewed paper produced the most validated standardized form (17 items, content validity index 0.94). The fields below are aligned with that standard plus production EMR/EHR patterns (Interlace, mConsent, AdvancedMD).

**Section A — Identity & case linkage** *(prefilled from existing case data)*
- Patient name, DOB
- Date of procedure
- Provider name + credentials
- Clinic name + address
- Personal-injury context: case number, attorney name (already in `cases` and `attorneys` tables)

**Section B — Procedure description** *(static template content, versioned)*
- What PRP is (autologous blood → centrifuged → re-injected)
- Treatment area, laterality
- Number of injections planned, sessions in series

**Section C — Pre-procedure contraindication checklist** *(yes/no fields)*
- Active infection at injection site
- Active cancer / chemo / radiation
- Blood clotting disorder (thrombocytopenia, hemophilia)
- Anticoagulants (Eliquis, Xarelto, Coumadin, etc.)
- Antiplatelet drugs (Plavix, daily aspirin)
- NSAIDs in past 7-10 days
- Systemic corticosteroids in past 2 weeks
- Pregnancy
- Known allergy to local anesthetic
- Previous adverse reaction to PRP

**Section D — Risk acknowledgments** *(per-line initialing)*
- Local discomfort, swelling, bruising
- Infection
- Nerve / vascular injury
- Allergic / hypersensitivity reaction
- Post-injection flare (24–72 hrs)
- No guarantee of relief or cure
- Possible need for repeat injections
- PRP investigational status

**Section E — Benefits & alternatives** *(static text + acknowledgment checkbox)*
- Expected benefits
- Alternatives (corticosteroid injection, hyaluronic acid, surgery, PT, conservative care)

**Section F — Post-procedure instructions** *(static text + acknowledgment checkbox)*
- Avoid NSAIDs 4-6 weeks
- Avoid ice 72 hrs
- Activity restrictions
- Follow-up appointment expectation

**Section G — Photo/video authorization** *(optional opt-in)*

**Section H — Signatures**
- Patient signature + printed name + date
- Legally authorized representative (if applicable): name, relationship, signature
- Provider counter-signature + credentials + date
- Witness signature (optional)
- Interpreter name + signature + language (if applicable)

Sources: [PMC Standardized PRP Consent Form (2024)](https://pmc.ncbi.nlm.nih.gov/articles/PMC11068980/), [PMC Evidence-Based Legal Guide for Orthopaedic Surgeons (2024)](https://pmc.ncbi.nlm.nih.gov/articles/PMC11330123/).

---

### HIPAA & legal storage requirements

From [HIPAA Journal — Retention Requirements](https://www.hipaajournal.com/hipaa-retention-requirements/) and [Calysta EMR — Electronic Signature Requirements](https://calystaemr.com/electronic-signature-requirements-medical-records/):

- **Retention**: 6 years from creation OR last in effect, whichever is later. Some states require longer (CA, NY, FL). Minors: until age 18 + adult retention. The project's existing `deleted_at` soft-delete pattern aligns with this.
- **Tamper-evident**: store SHA-256 hash alongside the PDF; document must be PDF/A or equivalent immutable format.
- **Audit trail**: every access logged (who, when, IP).
- **Capture metadata at signing**: IP address, user-agent, timestamps (opened / signed), identity verification method (in-office tablet vs. SMS link vs. email link), staff member who facilitated.
- **Version control**: store the exact form template version the patient saw — never invalidate previously signed versions when the template is updated.
- **ESIGN Act**: e-signature must be intentionally executed and attributable. Canvas-drawn signatures captured in-office with provider witness present satisfy this.

---

### Recommended schema (`procedure_consents` table)

A new table modeled after the columns the research indicates production EMRs store. Field names follow the project's existing snake_case + audit field conventions ([CLAUDE.md memory: `created_by_user_id`/`updated_by_user_id`, soft deletes, `case_id` foreign key]).

```sql
-- supabase/migrations/0XX_procedure_consents.sql

create table public.procedure_consents (
  id                          uuid primary key default gen_random_uuid(),
  case_id                     uuid not null references public.cases(id),
  procedure_id                uuid references public.procedures(id),  -- nullable: consent can be signed before procedure is recorded

  -- Template versioning
  template_id                 text not null,                           -- e.g., 'prp_injection'
  template_version            text not null,                           -- e.g., 'v1.0.0' — immutable reference

  -- Status workflow
  status                      text not null check (status in (
    'draft', 'sent', 'viewed', 'patient_signed', 'countersigned', 'expired', 'revoked'
  )),

  -- Procedure context (snapshotted at signing time so the consent reflects what was agreed to,
  -- not what the procedure record says today)
  procedure_name              text not null,
  treatment_area              text not null,
  laterality                  text check (laterality in ('left', 'right', 'bilateral')),
  injections_planned          integer,
  sessions_in_series          integer,

  -- Contraindication checklist (Section C) — stored as jsonb for flexibility per template version
  contraindications           jsonb not null default '{}'::jsonb,
  -- Example: { "active_infection": false, "anticoagulants": false, ... }

  -- Per-risk acknowledgments (Section D) — jsonb of risk_id → initialed boolean
  risk_acknowledgments        jsonb not null default '{}'::jsonb,

  -- Section acknowledgments (Sections E, F, G)
  benefits_alternatives_ack   boolean not null default false,
  post_procedure_ack          boolean not null default false,
  photo_authorization         boolean,                                 -- nullable: opt-in

  -- Patient signing
  patient_signed_at           timestamptz,
  patient_signer_name         text,                                    -- printed name typed at signing
  patient_signer_relationship text,                                    -- 'self' or e.g. 'parent', 'guardian'
  patient_signature_path      text,                                    -- Supabase Storage path → PNG
  patient_signer_ip           inet,
  patient_signer_user_agent   text,
  patient_auth_method         text check (patient_auth_method in (
    'in_office_tablet', 'email_link', 'sms_link'
  )),

  -- Witness (optional)
  witness_name                text,
  witness_signature_path      text,
  witness_signed_at           timestamptz,

  -- Translator (optional, required for non-English signing)
  translator_name             text,
  translator_language         text,
  translator_signed_at        timestamptz,

  -- Provider counter-signature
  provider_id                 uuid references public.users(id),
  provider_signed_at          timestamptz,
  provider_signature_path     text,                                    -- typically pulled from provider_profiles

  -- Generated PDF artifact (the legally-binding record)
  document_id                 uuid references public.documents(id),    -- FK to documents row holding the PDF
  document_hash_sha256        text,                                    -- SHA-256 of the locked PDF for tamper detection

  -- Validity window (some clinics require re-consent if >90 days since signing)
  expires_at                  timestamptz,

  -- Audit
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  deleted_at                  timestamptz,
  created_by_user_id          uuid references public.users(id),
  updated_by_user_id          uuid references public.users(id)
);

create index idx_procedure_consents_case_id      on public.procedure_consents(case_id);
create index idx_procedure_consents_procedure_id on public.procedure_consents(procedure_id);
create index idx_procedure_consents_status       on public.procedure_consents(status);

create trigger set_updated_at before update on public.procedure_consents
  for each row execute function update_updated_at();

alter table public.procedure_consents enable row level security;

create policy "Authenticated users full access" on public.procedure_consents
  for all using (auth.role() = 'authenticated');
```

**Why a separate table** rather than extending `procedures`:
- A consent can be signed *before* a procedure record exists (during scheduling).
- The consent is a legal artifact with its own lifecycle (sent → viewed → signed → countersigned).
- HIPAA retention rules apply differently to consent records than to clinical encounter records.
- Production EMR systems universally store consents as discrete records.

---

### Recommended file layout

Following the project's existing conventions:

| Layer | New File | Pattern Reference |
|---|---|---|
| Migration | `supabase/migrations/0XX_procedure_consents.sql` | [013_prp_procedure_encounter.sql](supabase/migrations/013_prp_procedure_encounter.sql), [024_lien_agreement.sql](supabase/migrations/024_lien_agreement.sql) |
| Validation | `src/lib/validations/procedure-consent.ts` | [prp-procedure.ts](src/lib/validations/prp-procedure.ts) |
| Server actions | `src/actions/procedure-consents.ts` | [procedures.ts](src/actions/procedures.ts) |
| Template constants | `src/lib/consent-templates/prp-injection-v1.ts` | (new pattern — JSON-like template definition with risk list, contraindication list, paragraph text, version number) |
| Wizard host | `src/components/consents/consent-wizard.tsx` | [patient-wizard.tsx](src/components/patients/patient-wizard.tsx) |
| Wizard steps | `src/components/consents/wizard-step-{intro,contraindications,risks,benefits,post-care,signatures,review}.tsx` | [wizard-step-identity.tsx](src/components/patients/wizard-step-identity.tsx), etc. |
| Signature capture | `src/components/consents/signature-pad.tsx` | (new — wraps `react-signature-canvas`, uploads PNG to Storage) |
| Trigger button | `src/components/procedures/start-consent-button.tsx` | [record-procedure-dialog.tsx](src/components/procedures/record-procedure-dialog.tsx) trigger pattern |
| PDF template | `src/lib/pdf/procedure-consent-template.tsx` | [lien-agreement-template.tsx](src/lib/pdf/lien-agreement-template.tsx) |
| PDF render layer | `src/lib/pdf/render-procedure-consent-pdf.ts` | [render-lien-agreement-pdf.ts](src/lib/pdf/render-lien-agreement-pdf.ts) |
| Page (optional) | `src/app/(dashboard)/patients/[caseId]/consents/page.tsx` | [/procedures/page.tsx](src/app/(dashboard)/patients/[caseId]/procedures/page.tsx) |
| Document type | Add `'procedure_consent'` to `documentTypeEnum` in `src/lib/validations/document.ts` | [document.ts](src/lib/validations/document.ts) |

---

### Recommended implementation flow

**Phase 1 — Schema + template definition**
1. Create migration for `procedure_consents` table.
2. Define the first template as a TypeScript constant: `prp_injection` v1.0.0 with the literal paragraph text, risk array, and contraindication array. This makes the template a code artifact (versioned via git) rather than a DB row, which avoids the complexity of a template editor for MVP.
3. Add `'procedure_consent'` to `documentTypeEnum`.

**Phase 2 — Validation + server actions**
1. `procedure-consent.ts` validation file with sub-schemas per wizard step, plus an enclosing `procedureConsentSchema`.
2. `procedure-consents.ts` server actions:
   - `createConsentDraft(caseId, templateId)` → inserts a draft row, returns id
   - `updateConsentStep(consentId, partialValues)` → upserts wizard progress
   - `submitPatientSignature(consentId, signatureBlob, signerName, signerRelationship)` → stores PNG to Storage, captures IP/UA, updates `patient_signed_at` + `status='patient_signed'`
   - `countersignConsent(consentId)` → marks `provider_signed_at` from current user, regenerates PDF, computes SHA-256, creates `documents` row, links via `document_id`, sets `status='countersigned'`
   - `getCaseConsents(caseId)` → list for the procedures page

**Phase 3 — Wizard UI**
1. Build `consent-wizard.tsx` modeled directly on `patient-wizard.tsx`, with one `useForm` instance and `STEP_FIELDS` map.
2. Steps: Intro (procedure description display) → Contraindications (checklist) → Risks (per-line initials) → Benefits/Alternatives (ack checkbox) → Post-Care (ack checkbox) → Signatures (patient + optional witness/translator) → Review (read-only display + final submit).
3. Use a "Hand to patient" UX pattern: provider clicks Start → wizard launches in fullscreen mode → tablet handed to patient → patient steps through.
4. Signature capture component (`signature-pad.tsx`) wraps `react-signature-canvas`, exposes `getDataURL()`, uploads to Storage on submit.

**Phase 4 — PDF generation + provider counter-signature**
1. Build `procedure-consent-template.tsx` rendering all sections + embedded patient signature image + provider signature image.
2. Build `render-procedure-consent-pdf.ts` following the existing render-layer pattern.
3. Provider counter-signature flow: provider opens consent in their queue → reviews → clicks "Counter-sign" → server action regenerates PDF, hashes it, attaches to `documents`, updates status. The provider's signature image is pulled from their `provider_profiles` row (no canvas needed).

**Phase 5 — Integration with procedure dialog**
1. Replace the simple `consent_obtained` checkbox in `record-procedure-dialog.tsx` with a derived display: query `procedure_consents` for the case → if a `countersigned` consent exists, show "✓ Consent on file (signed YYYY-MM-DD)" with a link to view the PDF; otherwise show a "Capture Consent" button that launches the wizard.
2. The boolean `procedures.consent_obtained` column can be kept (set automatically by a trigger or by the server action) for backward compatibility with the AI note generator at [generate-procedure-note.ts:161-162](src/lib/claude/generate-procedure-note.ts#L161-L162), or that generator can be updated to query the consents table directly.

**Phase 6 — Documents tab integration**
The signed PDF lands in the existing `documents` table → no new UI needed. It appears alongside MRI reports, lien agreements, etc. on the case Documents page.

---

### Key design decisions and tradeoffs

| Decision | Recommendation | Reasoning |
|---|---|---|
| Wizard vs. single dialog | **Wizard** | Per-section attention is the legal defensibility model; matches `patient-wizard.tsx` precedent. |
| Template storage | **Code constants in `src/lib/consent-templates/`** | No template editor needed for MVP; git provides versioning; matches `LIEN_PARAGRAPH_*` pattern. Future enhancement could move to a `consent_templates` table. |
| Signature capture | **`react-signature-canvas` → PNG → Supabase Storage** | Reuses existing storage bucket pattern from `provider-signature-upload.tsx`; no new infrastructure. |
| Consent record location | **New `procedure_consents` table** | Independent lifecycle from `procedures`; can be signed pre-procedure; HIPAA artifact distinct from clinical record. |
| `procedures.consent_obtained` | **Keep, derive from consents table** | Avoids breaking the AI note generation pipeline. |
| Counter-signature flow | **Async, post-patient-signing** | Most state laws permit; matches Interlace/AdvancedMD workflow; provider signature pulled from `provider_profiles` (no canvas re-capture). |
| Tamper-evidence | **SHA-256 hash stored alongside `documents.id`** | Lightweight; provides forensic verification without requiring blockchain or external timestamping service. |
| Version retention | **Template version + paragraph text snapshot in `procedure_consents` row** | Ensures the exact text the patient saw is reconstructable even if templates change. The wizard reads from the constants file, but the row should snapshot critical text. |
| Storage of patient signature | **Same `clinic-assets` bucket with stricter RLS path** OR new `consent-signatures` bucket | Both work; new bucket gives clearer access control. |
| Expiration | **Optional `expires_at`, NULL by default** | Lets clinics opt into 90-day re-consent policies without forcing it. |

---

### Dependencies to add

- `react-signature-canvas` (~ small, well-maintained) — only new runtime dependency. Type definitions: `@types/react-signature-canvas`.
- `sharp` is already in the project for the existing PDF render pipeline ([render-procedure-note-pdf.ts:17-21](src/lib/pdf/render-procedure-note-pdf.ts#L17-L21)) — can be reused for signature image normalization.
- Node's built-in `crypto` module for SHA-256 hashing — no dependency needed.

---

## Code References

- [src/components/procedures/record-procedure-dialog.tsx:305-320](src/components/procedures/record-procedure-dialog.tsx#L305-L320) — Existing `consent_obtained` checkbox
- [src/lib/validations/prp-procedure.ts:50](src/lib/validations/prp-procedure.ts#L50) — Existing Zod boolean
- [src/actions/procedures.ts:91](src/actions/procedures.ts#L91) — Where `consent_obtained` is written on create
- [src/lib/claude/generate-procedure-note.ts:161-162](src/lib/claude/generate-procedure-note.ts#L161-L162) — How the boolean drives AI-generated boilerplate
- [supabase/migrations/013_prp_procedure_encounter.sql:8](supabase/migrations/013_prp_procedure_encounter.sql#L8) — DB column definition
- [src/components/patients/patient-wizard.tsx](src/components/patients/patient-wizard.tsx) — Wizard pattern to clone
- [src/components/patients/patient-wizard.tsx:21](src/components/patients/patient-wizard.tsx#L21) — `STEP_FIELDS` map for step-scoped validation
- [src/lib/pdf/lien-agreement-template.tsx](src/lib/pdf/lien-agreement-template.tsx) — Static legal document PDF template
- [src/lib/pdf/render-lien-agreement-pdf.ts](src/lib/pdf/render-lien-agreement-pdf.ts) — Render layer pattern
- [supabase/migrations/024_lien_agreement.sql](supabase/migrations/024_lien_agreement.sql) — Document type addition pattern
- [src/components/settings/provider-signature-upload.tsx](src/components/settings/provider-signature-upload.tsx) — Existing signature storage component
- [supabase/migrations/009_clinic_assets_storage.sql](supabase/migrations/009_clinic_assets_storage.sql) — Storage bucket pattern
- [src/lib/validations/document.ts](src/lib/validations/document.ts) — `documentTypeEnum` to extend
- [supabase/migrations/003_document_storage.sql](supabase/migrations/003_document_storage.sql) — `documents` table where the signed PDF lands

---

## Architecture Documentation

The recommended approach treats a Procedure Consent Form as a **first-class workflow object** with its own table, state machine, and PDF artifact — distinct from but linked to the `procedures` row. This mirrors the pattern already used for lien agreements (static template + PDF + `documents` row) and stays consistent with the project's case-centric architecture (everything links to `case_id`).

The wizard UI pattern is borrowed wholesale from the patient creation flow, which is the only existing precedent for a multi-step form in the codebase. The legal defensibility model (per-section reading, per-risk initialing) aligns naturally with a wizard's stepwise gating, whereas the scrollable dialog used for `record-procedure-dialog.tsx` is optimized for clinician data entry, not patient acknowledgment.

The PDF generation pipeline reuses the existing `@react-pdf/renderer` toolchain unchanged, including the clinic header / signature footer conventions shared by all 7 existing templates.

---

## Historical Context (from thoughts/)

- [thoughts/shared/research/2026-03-11-epic-4-prp-procedure-alignment.md](thoughts/shared/research/2026-03-11-epic-4-prp-procedure-alignment.md) — Earlier gap analysis comparing Epic 4 stories to real PRP procedure documentation. Identifies "consent" as captured only at the encounter level (single boolean), with the Procedure → Preparation step including "consent, positioning, sterile prep, time-out" as boilerplate. This research confirms the gap: consent is currently a flag, not a documented agreement.
- [thoughts/shared/plans/2026-03-11-epic-4-story-4.1-create-prp-procedure-encounter.md](thoughts/shared/plans/2026-03-11-epic-4-story-4.1-create-prp-procedure-encounter.md) — Where the `consent_obtained` boolean was introduced in Phase 1's migration.
- [thoughts/shared/plans/2026-03-11-epic-4-story-4.2-capture-prp-procedure-details.md](thoughts/shared/plans/2026-03-11-epic-4-story-4.2-capture-prp-procedure-details.md) — Story that extended the procedure dialog with section nav (the same nav pattern reusable for the consent wizard's review step).

---

## Related Research

- [thoughts/shared/research/2026-03-11-epic-4-prp-procedure-alignment.md](thoughts/shared/research/2026-03-11-epic-4-prp-procedure-alignment.md)

---

## Open Questions

1. **Template editing UX** — Should clinic admins be able to edit consent template text in-app, or is git-based versioning (template constants in code) sufficient for MVP? The recommendation is constants-only for MVP.
2. **Re-consent policy** — Does the clinic require re-consent if >N days since signing, or is one signing valid for the entire treatment series? This determines whether `expires_at` defaults to NULL or a computed date.
3. **Remote signing** — Should the MVP support emailing a consent link to the patient before the appointment, or is in-office tablet capture sufficient? The schema supports both via `patient_auth_method`, but the UI for remote signing (token-based public route, email delivery, identity verification) is a much larger scope.
4. **Multi-language support** — Are translations needed for v1, or English-only? The schema includes translator fields but the template constants would need a `{ en: ..., es: ... }` shape to support translations.
5. **Patient identity verification** — For in-office signing, the provider's physical presence is the verification. For remote signing, a stronger mechanism is needed (e.g., DOB + SMS code). Out of scope for in-office-only MVP.
6. **Witness requirement** — Is a witness signature required by clinic policy, or only when the patient cannot sign themselves? The schema makes it optional.
7. **Auto-set `procedures.consent_obtained`** — Should a DB trigger flip the boolean when a `procedure_consents` row reaches `countersigned`, or should the application code handle it? Trigger is cleaner and harder to bypass.
