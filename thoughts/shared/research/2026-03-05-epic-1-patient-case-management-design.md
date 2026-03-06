---
date: 2026-03-05T12:00:00-08:00
researcher: Claude
repository: cliniq
topic: "Epic 1 — Patient Case Management: Design Research"
tags: [research, codebase, patient-case, data-model, ui-ux, tech-stack, epic-1]
status: complete
last_updated: 2026-03-05
last_updated_by: Claude
last_updated_note: "All open questions resolved: PI prefix, attorneys as standalone entity, single provider, duplicate detection, patient portal deferred"
---

# Research: Epic 1 — Patient Case Management Design

**Date**: 2026-03-05
**Researcher**: Claude
**Repository**: cliniq

## Research Question

Read the MVP scope and Epic 1 Story 1.1 (Create Patient Case), then conduct design research covering data models, tech stack, and UI/UX patterns for building a patient case management system for a personal injury clinic.

## Summary

This is a **greenfield project** — no code exists yet. The MVP scope covers 7 capabilities (document upload, data extraction, provider review, clinical doc generation, PRP recording, invoice generation, patient case records). Epic 1 / Story 1.1 focuses specifically on creating a patient case with basic demographics + a system-generated case number and dashboard.

Research was conducted across three domains: **data modeling**, **technology stack**, and **UI/UX design patterns**. Key findings are synthesized below.

---

## MVP Scope (from [mvp-scope.md](thoughts/personal/tickets/mvp-scope.md))

1. Upload MRI and chiropractor documents
2. Extract structured medical data
3. Allow provider review/edit
4. Generate clinical documents
5. Record PRP procedures
6. Generate medical invoices
7. Maintain a patient case record

## Story 1.1 Acceptance Criteria (from [epic-1/story-1.md](thoughts/personal/tickets/epic-1/story-1.md))

- Create patient with: Name, DOB, Contact info, Case ID, Accident date (optional)
- System generates a unique Case Number
- Patient case dashboard is created

---

## Detailed Findings

### 1. Data Model — Patient Entity

Beyond the basic fields in the acceptance criteria, a personal injury clinic patient entity typically includes:

**Core Demographics:**
- `patient_id` (UUID), `first_name`, `middle_name`, `last_name`, `date_of_birth`
- `gender`, `ssn_encrypted` (last 4 only if needed), `photo_url` (optional)

**Contact:**
- `phone_primary`, `phone_secondary`, `email`
- `address_line1`, `address_line2`, `city`, `state`, `zip_code`

**Emergency Contact** (separate table):
- `emergency_contact_name`, `emergency_contact_phone`, `emergency_contact_relationship`

**Attorney** (separate `attorneys` table — profile created independently, linked to case):
- `attorney_id` (FK on `cases` table), `lien_on_file` (boolean on case), `referral_source`
- See `attorneys` table below for entity fields

**Insurance** (for PI clinics):
- `insurance_provider_name`, `insurance_policy_number`, `insurance_claim_number`

**System Fields (every table):**
- `created_at`, `updated_at`, `deleted_at` (soft delete — HIPAA requires 6+ year retention)
- `created_by_user_id`, `updated_by_user_id`

### 2. Data Model — Case Number Generation

**Confirmed format:** `PI-[YYYY]-[NNNN]`
- Example: `PI-2026-0042`
- Zero-padded 4+ digit sequence, never-reset for simplicity
- Store as a generated column with a UNIQUE constraint
- PK remains a UUID — case number is a display/lookup field

**Case Entity Fields:**
- `case_id` (UUID), `case_number` (unique, generated), `patient_id` (FK)
- `accident_date`, `accident_description`, `accident_type` (auto/slip_and_fall/workplace/other)
- `case_status` (intake/active/pending_settlement/closed/archived)
- `case_open_date`, `case_close_date`, `assigned_provider_id` (single provider per case)
- `attorney_id` (FK to `attorneys` table), `lien_on_file` (boolean)
- `total_billed`, `total_paid`, `balance_due` (denormalized for dashboard)

**Attorney Entity Fields** (`attorneys` table — created as standalone profiles):
- `attorney_id` (UUID), `first_name`, `last_name`
- `firm_name`, `phone`, `email`, `fax`
- `address_line1`, `address_line2`, `city`, `state`, `zip_code`
- `notes`, `created_at`, `updated_at`, `created_by_user_id`

### 3. Data Model — Full Schema Architecture

```
patients
  +-- patient_insurance (1:many)
  +-- cases (1:many)
        +-- appointments (1:many)
        +-- documents (1:many)
        |     +-- document_extracted_data (1:many, JSONB)
        +-- procedures (1:many)
        +-- invoices (1:many)
        |     +-- invoice_line_items (1:many)
        |     +-- payments (1:many)
        +-- case_status_history (1:many, append-only audit)

attorneys (standalone profiles, linked 1:many to cases)
providers (one per case via cases.assigned_provider_id)
procedure_types (lookup, with CPT codes)
document_types (lookup)
users / roles (RBAC)
audit_logs (append-only, all PHI tables)
```

**Key design decisions:**
- Appointments link to `case_id`, not `patient_id` — all activity is per-case
- Documents link to `case_id` + optionally `appointment_id`
- Invoices snapshot patient/provider info at creation time (immutable for legal/audit)
- Binary files stored in cloud storage, DB holds metadata + storage key only
- AI-extracted data stored as JSONB with schema versioning

### 4. Technology Stack Recommendation

| Layer | Technology | Notes |
|---|---|---|
| Frontend | Next.js 15 (App Router) | Server Components for PHI handling |
| Backend/DB | Supabase (Team Plan + HIPAA add-on) | BAA required before real PHI |
| Auth | Supabase Auth with MFA | RLS policies per provider role |
| File Storage | Supabase Storage (private buckets) | Signed URLs only, short expiry |
| AI/OCR | Claude API (Anthropic) | Enterprise HIPAA plan for production |
| PDF Generation | @react-pdf/renderer | Server-side, no client exposure |
| UI Components | shadcn/ui + Tailwind CSS | Radix primitives, WCAG 2.1 AA |
| Data Tables | @tanstack/react-table | Patient case dashboard |
| Charts | recharts | Case statistics |
| Forms | react-hook-form + Zod | End-to-end type safety |
| Deployment | Vercel | Native Next.js support |

**HIPAA production path requires BAAs with:** Supabase (Team Plan), Anthropic (Enterprise HIPAA plan), and Vercel (Enterprise). For MVP with synthetic data, standard plans are sufficient.

### 5. UI/UX — Dashboard Layout

**Recommended: Left Sidebar + Tabbed Content Area**

**Left Sidebar (persistent, 240-280px):**
- Patient identity block: full name, Case ID (monospace, copy button), DOB, accident date
- Case status badge (Active/Closed/Pending)
- Navigation links: Overview, Documents, Clinical Data, Procedures, Invoices

**Horizontal Tabs (content area):**
```
[Overview] [Documents] [Clinical Data] [Procedures] [Invoices]
```
Keep to 5-7 tabs max. Content scrolls vertically within each tab.

### 6. UI/UX — Patient Case Creation Form

**Multi-step wizard (3 steps) with progress bar:**

- **Step 1 — Patient Identity:** First/Last/Middle name (separate fields), DOB (date picker + manual entry), Sex/Gender, Case ID (auto-generated, displayed read-only)
- **Step 2 — Contact & Case Details:** Phone, email, address (with autocomplete), Accident Date, Referring provider
- **Step 3 — Review & Confirm:** Summary of all values, edit links back to steps, Submit button

**Form design rules:**
- Single-column layout (15 seconds faster, higher accuracy per research)
- Labels above inputs (not inline placeholders)
- Mark optional fields as "(optional)" rather than required with asterisks
- Inline validation on blur, not just on submit
- Auto-generate Case ID on Step 1 completion

### 7. UI/UX — Case Overview Tab

**Top band:** Alert/status bar for open items (missing docs, unpaid invoices)

**Left column (~60%):** Case summary card — demographics (readonly + edit link), Case ID with copy button, accident date, case status dropdown

**Right column (~40%):** Activity feed — document count, last clinical note date, invoice status summary, recent activity timeline

**Bottom:** Quick action buttons — Upload Document, Add Clinical Note, Record Procedure, Create Invoice

### 8. Accessibility Requirements

WCAG 2.1 Level AA is legally mandated for federally-funded healthcare orgs as of May 2026:
- 4.5:1 contrast ratio for body text
- Never use color alone for status — always pair with text labels
- Full keyboard navigation with visible focus indicators
- Semantic HTML landmarks (`<nav>`, `<main>`, `<section>`)
- ARIA tab patterns for tab panels
- Proper `<label>` and `aria-describedby` for all form fields

### 9. HIPAA Data Modeling Requirements

- **Audit log table:** Append-only, tracks every CREATE/UPDATE/DELETE on PHI tables
- **Soft deletes only:** Never hard-delete; use `deleted_at` timestamp
- **Field-level encryption:** SSN, health plan numbers (AES-256 at app layer)
- **RBAC:** `users` + `roles` tables; every PHI table has `created_by`/`updated_by`
- **No PHI in URLs:** Storage keys use UUIDs, not patient names
- **Data minimization:** Only capture SSN if billing genuinely requires it

---

## Architecture Insights

1. **Personal injury clinic workflow** is the core domain — this drives data model decisions like linking appointments/documents/procedures to cases (not directly to patients), attorney/lien tracking, and accident-type categorization.

2. **Case-centric architecture** — the Case entity is the central aggregate, not the Patient. All clinical activity, documents, and billing flow through a case. A patient can theoretically have multiple cases (multiple accidents).

3. **Snapshot pattern for invoices** — invoice line items must freeze price, provider name, and patient info at creation time. This is legally required for PI billing.

4. **JSONB for extracted data** — AI-extracted medical data from documents should use JSONB to allow schema evolution without migrations for each new field type.

5. **Document processing pipeline:** Upload → Edge Function trigger → Claude API extraction → JSONB storage → Provider review notification.

---

## Story 1.1 Implementation Scope (Recommended)

For **Story 1.1 — Create Patient Case** specifically, the minimum implementation includes:

**Database:**
- `patients` table (demographics)
- `cases` table (with auto-generated case number, FK to `attorneys`)
- `attorneys` table (standalone profiles, created before cases)
- `case_status_history` table (audit)
- `users` table (basic, for `created_by`)
- Case number generation function/trigger

**Frontend:**
- Multi-step patient creation form (3 steps)
- Patient case dashboard shell (sidebar + tabs, Overview tab only)
- Case overview with summary card + quick actions (buttons disabled until later stories)
- Patient list view with search by name/case number

**API:**
- Server action: create patient + case (with duplicate patient detection by name + DOB)
- Server action: get patient case by ID
- Server action: list/search patient cases

---

## Resolved Decisions

1. **Case number prefix:** `PI-` (domain-based) — confirmed
2. **Provider model:** Single provider per case (`assigned_provider_id` on `cases` table)
3. **Attorney/legal info:** Required — attorneys are a standalone entity (profile created before cases); selected/linked during case creation. One attorney can handle multiple cases.
4. **Duplicate detection:** Check for existing patient by name + DOB on case creation; prompt user if match found
5. **Patient portal:** Deferred — not in MVP scope

---

## Sources

### Data Modeling
- [Clinic Management System Data Model — Red Gate / Vertabelo](https://www.red-gate.com/blog/clinic-management-system-data-model/)
- [Healthcare Management Database Design — GeeksForGeeks](https://www.geeksforgeeks.org/dbms/how-to-design-a-database-for-healthcare-management-system/)
- [Case Number Format — Case IQ](https://help.caseiq.com/workflow/case-number-format)
- [Automatic Case Numbering — MyCase](https://support.mycase.com/en/articles/6082128-automatic-case-numbering)
- [EHR Checklist for PI Practices — ChiroTouch](https://www.chirotouch.com/article/chiropractic-ehr-checklist-for-personal-injury-practices)
- [Personal Injury Documents — ChiroEco](https://www.chiroeco.com/personal-injury-documents/)
- [Billing System ERD — Red Gate](https://www.red-gate.com/blog/billing-system-database-model/)
- [Invoice Management ERD — Red Gate](https://www.red-gate.com/blog/erd-for-invoice-management/)

### HIPAA Compliance
- [HIPAA PHI: 18 Identifiers — UC Berkeley CPHS](https://cphs.berkeley.edu/hipaa/hipaa18.html)
- [HIPAA Audit Log Requirements — Compliancy Group](https://compliancy-group.com/hipaa-audit-log-requirements/)
- [HIPAA Compliant Data Design — FormAssembly](https://www.formassembly.com/blog/hipaa-compliant-data/)
- [HIPAA Compliant Databases — MedStack](https://medstack.co/blog/hipaa-tips-2-hipaa-compliant-databases/)

### Technology Stack
- [Supabase HIPAA Projects](https://supabase.com/docs/guides/platform/hipaa-projects)
- [Supabase for Healthcare](https://supabase.com/solutions/healthcare)
- [Claude for Healthcare — Anthropic](https://www.anthropic.com/news/healthcare-life-sciences)
- [HIPAA-ready Enterprise Plans — Claude](https://support.claude.com/en/articles/13296973-hipaa-ready-enterprise-plans)
- [@react-pdf/renderer — npm](https://www.npmjs.com/package/@react-pdf/renderer)

### UI/UX Design
- [Healthcare UI Design 2026 — Eleken](https://www.eleken.co/blog-posts/user-interface-design-for-healthcare-applications)
- [EHR Interface Design Principles — Fuselab Creative](https://fuselabcreative.com/ehr-interface-design-principles-ux-and-usability-challenges/)
- [EHR System Design — Phenomenon Studio](https://phenomenonstudio.com/ehr-system-design/)
- [Patient Intake Form Best Practices — Feathery](https://www.feathery.io/blog/patient-intake-form)
- [Patient Form Design Best Practices — 314e](https://www.314e.com/practifly/blog/patient-form-design-best-practices/)
- [Healthcare Dashboard Design — Fuselab Creative](https://fuselabcreative.com/healthcare-dashboard-design-best-practices/)
- [WCAG 2.1 AA Healthcare 2026 — Pilot Digital](https://pilotdigital.com/blog/what-wcag-2-1aa-means-for-healthcare-organizations-in-2026/)
- [shadcn/ui Dashboard](https://ui.shadcn.com/examples/dashboard)
- [Hospital Admin Management — Shadcn UI Kit](https://shadcnuikit.com/dashboard/hospital-management)
