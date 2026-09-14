# Research: Best way to incorporate psychological complaints and assessment in visit notes

Date: 2026-09-13

## Research question
What is the best way to represent psychological complaints and psychological assessment content in existing visit notes while staying aligned with current data model, AI generation pipeline, and UI validation behavior?

## Summary
The current implementation has no dedicated psychological complaint or psychological assessment storage field in initial visit, discharge, or pain follow-up note schemas. Psychological content is currently expected to live in existing free-text clinical sections (`chief_complaint`, `subjective`, `assessment`, etc.) and/or narrative fragments such as `caseSummary` and intake text. The most resilient near-term change is to represent psychological complaints and assessment in existing sections (preferably `subjective`/`assessment`) plus prompt/validation adjustments, then introduce dedicated schema/UI columns only if teams require structured reporting and longitudinal filtering.

## Current implementation findings

### Initial visit notes
- Source assembly:
  - Uses `gatherSourceData` in [`src/actions/initial-visit-notes.ts`](/Users/macbookpro/Coding/cliniq/src/actions/initial-visit-notes.ts) to build input from case summary, chief complaint, protocols, prior visits, procedures, imaging, and extras.
  - No structured psych extraction, and no psych-specific branch in `visitType` handling.

- Sections and persistence:
  - Note data is persisted as `initial_visit_notes` section fields in `gatherInitialVisitNoteSourceData`, `generateInitialVisitNote`, `saveInitialVisitNote`, and `finalizeInitialVisitNote` in [`src/actions/initial-visit-notes.ts`](/Users/macbookpro/Coding/cliniq/src/actions/initial-visit-notes.ts).
  - Supported section keys are fixed to standard fields like `chief_complaint`, `history_of_present_illness`, `assessment`, etc.; no psych-specific key exists.

- Prompting and validation:
  - Generator instructions in [`src/lib/claude/generate-initial-visit.ts`](/Users/macbookpro/Coding/cliniq/src/lib/claude/generate-initial-visit.ts) are section-based and do not include a dedicated psych section.
  - Validation uses `initialVisitNoteEditSchema` in [`src/lib/validations/initial-visit-note.ts`](/Users/macbookpro/Coding/cliniq/src/lib/validations/initial-visit-note.ts), where psych fields are not represented.

### Discharge notes
- Source assembly:
  - `gatherDischargeNoteSourceData` in [`src/actions/discharge-notes.ts`](/Users/macbookpro/Coding/cliniq/src/actions/discharge-notes.ts) merges case summary, procedures, PM/Pain/PT context, and prior notes.
  - There is no psych-specific data source or model-level column.

- Sections and persistence:
  - Discharge sections are constrained to existing narrative fields (`subjective`, `assessment`, `plan_and_recommendations`, etc.) in the same file and UI in [`src/components/discharge/discharge-note-editor.tsx`](/Users/macbookpro/Coding/cliniq/src/components/discharge/discharge-note-editor.tsx).

- Prompting and validation:
  - Generator in [`src/lib/claude/generate-discharge-note.ts`](/Users/macbookpro/Coding/cliniq/src/lib/claude/generate-discharge-note.ts) uses these same fields.
  - Validation schema in [`src/lib/validations/discharge-note.ts`](/Users/macbookpro/Coding/cliniq/src/lib/validations/discharge-note.ts) has no psych field.

### Pain follow-up notes
- Editor flow currently uses section set including `subjective`, `review_of_systems`, and `assessment` in [`src/components/visits/pain-follow-up-editor.tsx`](/Users/macbookpro/Coding/cliniq/src/components/visits/pain-follow-up-editor.tsx).
- Generation + validation (`generate-pain-follow-up.ts`, `validate` schema file) similarly have no psych-specific fields.

### Database schema evidence
- `initial_visit_notes`, `discharge_notes`, and `pain_follow_up_notes` tables in [`src/types/database.ts`](/Users/macbookpro/Coding/cliniq/src/types/database.ts) list section columns only for the existing narrative sections.
- The migration set inspected includes:
  - `supabase/migrations/20260309194935_replace_initial_visit_notes_15_sections.sql`
  - `supabase/migrations/016_discharge_notes.sql`
  - `supabase/migrations/20260826161637_pain_follow_up_notes.sql`
  
  None introduce dedicated psych-complaint/assessment columns.

### Intake/prefill continuity
- Follow-up intake prefill in [`src/lib/clinical/follow-up-intake-prefill.ts`](/Users/macbookpro/Coding/cliniq/src/lib/clinical/follow-up-intake-prefill.ts) and tests rehydrate existing narrative history (chief complaint, interval history, prior assessments) as free text, but do not target dedicated psych fields.

## Best-fit strategy (recommended)
1. **Immediate (low risk):** keep storage in existing sections and add explicit instruction to include psychological complaint and assessment content in
   - `chief_complaint` (or `subjective` for follow-up notes), and
   - `assessment`.
   This preserves schema/UI compatibility and avoids migration + API + validation breakage.

2. **Near term quality improvement:** update generation prompts and section helper copy to explicitly call out psychological domains, so generated notes consistently include this content without ad-hoc phrasing.

3. **Medium term (if reporting needs demand structure):** add dedicated columns (for example `psychological_complaints`, `psychological_assessment`) across relevant note tables and validators.
   - Requires coordinated migration + type updates + UI schema additions + prompt mapping + prefill + backward-compat handling.
   - Higher impact and should be done only if product requires structured extraction/search or analytics on psych-specific fields.

## Explicit open questions
- Do we need psychological information represented as required discrete fields, or is high-quality narrative output sufficient?
- Should this behavior apply only to pain follow-up and initial visits, or also discharge and procedure notes?
- Is there a privacy/consent policy that requires psych content to be conditionally hidden or redacted in certain workflows?

## Evidence vs. inference
- **Directly evidenced:** all current note types use fixed section schemas listed above and have no dedicated psych columns.
- **Inferred:** the recommended phased approach is inferred from architecture stability concerns and change scope; no explicit migration preference is encoded in the code.

## Suggested implementation starting point (if you want minimal change)
- Update prompt templates that drive these note types to enforce a short heading convention such as `Psychological Complaint` and `Psychological Assessment` within `chief_complaint`/`assessment` sections.
- Add tests that assert generated text contains key psychological language when provided in source data.
- Add optional inline reviewer checklist in the editor (non-schema) to reduce omission risk.

