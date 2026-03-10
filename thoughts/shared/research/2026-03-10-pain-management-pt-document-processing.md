---
date: 2026-03-10T00:00:00-05:00
researcher: Claude
git_commit: 3d746d7333fe45c2f4dead855b4d009c1cadc2d9
branch: main
repository: cliniq
topic: "Pain Management & Physical Therapy Document Processing"
tags: [research, codebase, pain-management, physical-therapy, document-processing, extraction]
status: complete
last_updated: 2026-03-10
last_updated_by: Claude
---

# Research: Pain Management & Physical Therapy Document Processing

**Date**: 2026-03-10
**Researcher**: Claude
**Git Commit**: 3d746d7
**Branch**: main
**Repository**: cliniq

## Research Question
Check if pain management document processing is handled properly, and whether physical therapy documents can be accommodated.

## Summary

Pain management document processing is **fully implemented** with a complete end-to-end pipeline: upload → AI extraction → provider review → approve/edit/reject. It follows the same established pattern as MRI and chiro extraction pipelines.

**Physical therapy documents have no dedicated support.** There is no `physical_therapy` document type, no PT-specific extraction pipeline, and no PT tab in the clinical data UI. If a PT document is uploaded today, it would need to be classified as either `pain_management` (closest match structurally) or `other` (no extraction).

## Detailed Findings

### Pain Management Pipeline — Complete Implementation

The pain management extraction pipeline consists of 7 purpose-built files plus modifications to 3 existing files:

#### Database Layer
- [011_pain_management_extractions.sql](supabase/migrations/011_pain_management_extractions.sql) — Creates `pain_management_extractions` table with JSONB columns for `chief_complaints`, `physical_exam`, `diagnoses`, and `treatment_plan`. Includes GIN indexes on diagnoses and chief_complaints for querying.
- The `documents` table CHECK constraint was updated to include `'pain_management'` as a valid `document_type` value (alongside `mri_report`, `chiro_report`, `generated`, `other`).

#### Validation Schemas
- [pain-management-extraction.ts](src/lib/validations/pain-management-extraction.ts) — Zod schemas for:
  - `painManagementExtractionResultSchema` (AI output validation)
  - `painManagementReviewFormSchema` (provider review form with stricter required fields)
  - Sub-schemas: `chiefComplaintSchema`, `romMeasurementSchema`, `orthopedicTestSchema`, `physicalExamRegionSchema`, `diagnosisSchema`, `treatmentPlanItemSchema`

#### AI Extraction
- [extract-pain-management.ts](src/lib/claude/extract-pain-management.ts) — Claude API integration using `claude-sonnet-4-6` with tool-use pattern. The system prompt is tailored for pain management evaluation reports. Extracts:
  - Report metadata (date, DOI, provider)
  - Chief complaints with pain ratings (min/max), radiation, aggravating/alleviating factors
  - Physical exam per body region: palpation, ROM measurements (normal/actual/pain), orthopedic tests (positive/negative), neurological summary
  - ICD-10 diagnoses
  - Treatment plan with type classification and cost estimates
  - Diagnostic studies summary (text, not re-extracting MRI data)

#### Server Actions
- [pain-management-extractions.ts](src/actions/pain-management-extractions.ts) — 6 server actions: `extractPainManagementReport`, `listPainManagementExtractions`, `getPainManagementExtraction`, `approvePainManagementExtraction`, `saveAndApprovePainManagementExtraction`, `rejectPainManagementExtraction`. Includes encrypted PDF detection, retry-once-on-failure, document status sync on approval.

#### Upload Integration
- [upload-sheet.tsx:161-169](src/components/documents/upload-sheet.tsx#L161-L169) — When a file is uploaded with type `pain_management`, it queues extraction. After upload completes, the extraction fires asynchronously.
- [upload-sheet.tsx:303-305](src/components/documents/upload-sheet.tsx#L303-L305) — "Pain Management" appears as a selectable document type in the upload dropdown.

#### Clinical Data UI
- [clinical/page.tsx](src/app/(dashboard)/patients/[caseId]/clinical/page.tsx) — "Pain Management" tab in the clinical data page, data fetched via `listPainManagementExtractions` in parallel with MRI and chiro.
- [pm-extraction-list.tsx](src/components/clinical/pm-extraction-list.tsx) — List view showing file name, provider, date, diagnosis/complaint counts, confidence badges, review status.
- [pm-extraction-review.tsx](src/components/clinical/pm-extraction-review.tsx) — Split-view: PDF on left, editable form on right.
- [pm-extraction-form.tsx](src/components/clinical/pm-extraction-form.tsx) — react-hook-form with field arrays for complaints, exam regions, diagnoses, treatment plan.

### Physical Therapy — No Dedicated Support

The current document type enum in [document.ts:13](src/lib/validations/document.ts#L13) is:
```typescript
z.enum(['mri_report', 'chiro_report', 'pain_management', 'generated', 'other'])
```

The DB CHECK constraint in [011_pain_management_extractions.sql:7](supabase/migrations/011_pain_management_extractions.sql#L7) mirrors this:
```sql
check (document_type in ('mri_report', 'chiro_report', 'pain_management', 'generated', 'other'))
```

The upload dropdown in [upload-sheet.tsx:301-308](src/components/documents/upload-sheet.tsx#L301-L308) only offers: MRI Report, Chiropractor Report, Pain Management, Other.

There is **no** `physical_therapy` value, no PT extraction table, no PT-specific Claude prompt, and no PT tab in the clinical data UI.

### Pain Management vs Physical Therapy — Structural Comparison

The current pain management extraction schema is designed for **pain management evaluation reports** specifically. Key structural elements:

| Pain Management Report | Physical Therapy Report |
|----------------------|----------------------|
| Chief complaints with pain ratings | Treatment goals / functional limitations |
| ROM measurements (normal/actual/pain) | ROM measurements (similar structure) |
| Orthopedic tests (positive/negative) | Functional assessments / outcome measures |
| ICD-10 diagnoses | ICD-10 diagnoses |
| Treatment plan with cost estimates | Plan of care with frequency/duration |
| Palpation findings | Manual therapy findings |
| Neurological summary | Functional status scores |
| Injection/surgery recommendations | Exercise programs / modalities |

There is **some overlap** (ROM, diagnoses, physical exam findings) but PT reports have distinct data points like treatment goals, functional outcome measures, visit frequency/duration, and exercise programs that the pain management schema does not capture.

### MVP Scope Reference

The [mvp-scope.md](thoughts/personal/tickets/mvp-scope.md) states the MVP should enable:
- Upload MRI and chiropractor documents
- Extract structured medical data
- Allow provider review/edit

Physical therapy documents are **not mentioned** in the MVP scope. Pain management was added as Story 2.3 (beyond the original MVP scope of MRI + chiro).

## Code References

- `src/lib/validations/document.ts:13` — Document type enum (no PT type)
- `supabase/migrations/011_pain_management_extractions.sql` — PM table and document type constraint
- `src/lib/claude/extract-pain-management.ts` — Claude extraction with PM-specific system prompt
- `src/actions/pain-management-extractions.ts` — 6 server actions for PM pipeline
- `src/components/documents/upload-sheet.tsx:301-308` — Upload type selector
- `src/components/clinical/pm-extraction-list.tsx` — PM extraction list component
- `src/components/clinical/pm-extraction-form.tsx` — PM review form
- `src/components/clinical/pm-extraction-review.tsx` — PM split-view review
- `src/app/(dashboard)/patients/[caseId]/clinical/page.tsx` — Clinical data page with PM tab

## Architecture Documentation

The extraction pipeline follows a consistent per-document-type pattern across all three types (MRI, Chiro, PM):

```
Upload (upload-sheet.tsx)
  → Queue extraction by document_type
  → Server Action: extract[Type]Report(documentId)
    → Download PDF from Supabase Storage
    → Check for encryption
    → Convert to base64
    → Call Claude API with type-specific system prompt + tool schema
    → Validate output with Zod
    → Store in type-specific extractions table
  → Provider Review UI (list → split-view → form)
    → Approve / Edit+Approve / Reject
    → Sync document status on approval
```

Each new document type requires: 1 migration, 1 validation file, 1 Claude module, 1 server actions file, 3 UI components, + modifications to document type enum, upload sheet, and clinical page.

## Historical Context (from thoughts/)

- `thoughts/shared/plans/2026-03-09-epic-2-story-2.3-pain-management-extraction.md` — Full implementation plan for PM extraction. Explicitly notes "What We're NOT Doing" includes no cross-referencing between extraction types and no auto-populating initial visit notes.
- `thoughts/personal/tickets/mvp-scope.md` — MVP scope mentions MRI and chiro documents only; PM and PT not in original scope.
- `thoughts/personal/tickets/epic-2/story-1.md` — Epic 2 parent ticket for Medical Document Processing.

## Open Questions

1. **Should PT documents use the pain management pipeline?** The PM extraction schema has significant overlap (ROM, diagnoses, exam findings) but PT reports have distinct data points (treatment goals, functional outcomes, visit frequency, exercise programs) that would be lost or misclassified.
2. **Would a separate `physical_therapy` document type and extraction pipeline be needed?** Following the established pattern, this would require a new migration, validation schemas, Claude module, server actions, and 3 UI components.
3. **Could the pain management pipeline be generalized to handle both?** This would require schema changes (adding PT-specific fields) and prompt updates, but risks degrading PM extraction quality for a broader scope.
