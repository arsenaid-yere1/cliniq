---
date: 2026-04-23T19:46:47Z
researcher: arsenaid
git_commit: e72734ff792985639ae917e71c11788b80518368
branch: main
repository: cliniq
topic: "Add X-ray document type processing pipeline"
tags: [research, codebase, document-types, extraction-pipeline, radiology, ct-scan, mri]
status: complete
last_updated: 2026-04-23
last_updated_by: arsenaid
last_updated_note: "Added sample-document analysis (3 X-ray reports) and finalized X-ray-specific schema"
---

# Research: Add X-ray document type processing pipeline

**Date**: 2026-04-23T19:46:47Z
**Researcher**: arsenaid
**Git Commit**: e72734ff792985639ae917e71c11788b80518368
**Branch**: main
**Repository**: cliniq

## Research Question

What does the existing document-type processing pipeline look like in the cliniq codebase, so that an X-ray document type could be added following the same pattern? Document every surface an existing radiology document type (CT Scan — the most recent analog) touches: enum registry, Claude extractor, zod schemas, server actions, DB migration, storage, upload UI, clinical tabs UI, review form, case-summary aggregation, initial-visit aggregation, and tests.

## Summary

The codebase does not currently have an X-ray document type. Adding one means replicating the same isomorphic "per-doc-type extraction" surface already used by MRI, CT Scan, Chiro, Pain Management (PM), PT, and Orthopedic reports. The CT Scan extractor ([src/lib/claude/extract-ct-scan.ts](src/lib/claude/extract-ct-scan.ts)) is the closest analog — same body-region-per-record shape, same "multi-region PDFs split into separate rows" pattern, same review workflow.

The canonical wiring surface for a new radiology doc type consists of ~14 touchpoints:

1. **Doc-type enum** at [src/lib/validations/document.ts:13](src/lib/validations/document.ts#L13)
2. **DB constraint alteration** + new `*_extractions` table (model after [supabase/migrations/022_ct_scan_extractions.sql](supabase/migrations/022_ct_scan_extractions.sql))
3. **Zod schemas** for AI output + review form (model after [src/lib/validations/ct-scan-extraction.ts](src/lib/validations/ct-scan-extraction.ts))
4. **Claude extractor** using `callClaudeTool` (model after [src/lib/claude/extract-ct-scan.ts](src/lib/claude/extract-ct-scan.ts))
5. **Server actions** for extract/list/get/approve/save/reject/soft-delete (model after [src/actions/ct-scan-extractions.ts](src/actions/ct-scan-extractions.ts))
6. **Cascade soft-delete** wiring in [src/actions/documents.ts:220-252](src/actions/documents.ts#L220-L252)
7. **Clinical Data tab** in [src/app/(dashboard)/patients/[caseId]/clinical/page.tsx](src/app/(dashboard)/patients/[caseId]/clinical/page.tsx)
8. **Review/List/Form components** under `src/components/clinical/` (three files per type)
9. **Upload sheet** — add enum case, toast, `SelectItem` in [src/components/documents/upload-sheet.tsx](src/components/documents/upload-sheet.tsx)
10. **Document card labels + colors + filename labels** in [src/components/documents/document-card.tsx:21-64](src/components/documents/document-card.tsx#L21-L64)
11. **Document list filter option** at [src/components/documents/document-list.tsx:18-23](src/components/documents/document-list.tsx#L18-L23)
12. **Case-summary aggregation** in [src/actions/case-summaries.ts:23-91](src/actions/case-summaries.ts#L23-L91) and `SummaryInputData` type in [src/lib/claude/generate-summary.ts:245-253](src/lib/claude/generate-summary.ts#L245-L253), plus summary prompt rule at [src/lib/claude/generate-summary.ts:39](src/lib/claude/generate-summary.ts#L39)
13. **Initial-visit aggregation** (`hasApprovedDiagnosticExtractions` gating) in [src/actions/initial-visit-notes.ts:152-164,192](src/actions/initial-visit-notes.ts#L152-L164)
14. **Regenerated types.ts** after migration (`supabase gen types`)

A `x_ray` string is already explicitly rejected by the enum test at [src/lib/validations/__tests__/document.test.ts:45](src/lib/validations/__tests__/document.test.ts#L45).

## Detailed Findings

### 1. Document type registry

**Enum** — [src/lib/validations/document.ts:13](src/lib/validations/document.ts#L13)
```ts
export const documentTypeEnum = z.enum(['mri_report', 'chiro_report', 'pain_management', 'pt_report', 'orthopedic_report', 'ct_scan', 'generated', 'lien_agreement', 'procedure_consent', 'other'])
```

**DB check constraint evolution** (each new type replaces the constraint):
- [supabase/migrations/003_document_storage.sql](supabase/migrations/003_document_storage.sql) — first constraint
- [supabase/migrations/022_ct_scan_extractions.sql:4-7](supabase/migrations/022_ct_scan_extractions.sql#L4-L7) — adds `ct_scan`
- [supabase/migrations/024_lien_agreement.sql:7-9](supabase/migrations/024_lien_agreement.sql#L7-L9) — adds `lien_agreement`
- [supabase/migrations/20260408_procedure_consent_document_type.sql](supabase/migrations/20260408_procedure_consent_document_type.sql) — adds `procedure_consent` (latest)

**Allowed MIME types** — [src/lib/validations/document.ts:3-9](src/lib/validations/document.ts#L3-L9) — PDF, JPEG, PNG, WebP, DOCX. `MAX_FILE_SIZE = 50MB`.

**Existing negative test** — [src/lib/validations/__tests__/document.test.ts:45](src/lib/validations/__tests__/document.test.ts#L45) — `expect(documentTypeEnum.safeParse('x_ray').success).toBe(false)` — this line will flip to `true` and the test should be moved to the valid-types loop above it.

### 2. Storage + upload flow

**Upload session + storage path** — [src/actions/documents.ts:96-127](src/actions/documents.ts#L96-L127) — validates upload meta, checks case closure, computes `storagePath = cases/{caseId}/{timestamp}-{sanitized}`. Bucket: `case-documents`.

**TUS upload** — [src/lib/tus-upload.ts](src/lib/tus-upload.ts) — resumable upload client, used by `upload-sheet.tsx`.

**Metadata save** — [src/actions/documents.ts:129-176](src/actions/documents.ts#L129-L176) — inserts `documents` row with `status = 'pending_review'`. Special side-effect: `lien_agreement` flips `cases.lien_on_file = true`.

**Encrypted-PDF guard** — repeated pattern, first 8192 bytes scanned for `/Encrypt` header. See [src/actions/ct-scan-extractions.ts:67-77](src/actions/ct-scan-extractions.ts#L67-L77).

### 3. Claude extractor shape (CT Scan canonical)

[src/lib/claude/extract-ct-scan.ts](src/lib/claude/extract-ct-scan.ts) — 105 lines.

Structure:
- `SYSTEM_PROMPT` — rules for extraction, multi-region behavior, "null" string convention for missing data, confidence guidance
- `EXTRACTION_TOOL: Anthropic.Tool` — input schema with `reports: array` (one per body region), required fields enumerated
- `extractCtScanFromPdf(pdfBase64)` — calls `callClaudeTool<CtScanExtractionResult[]>` with:
  - `model: 'claude-sonnet-4-6'`
  - `maxTokens: 4096`
  - `toolName: 'extract_ct_scan_data'`
  - User message combines `{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }` + text instruction
  - `parse` callback normalizes `'null'` string → `null`, validates via zod `ctScanExtractionResponseSchema`

`normalizeNullString` helper at [src/lib/claude/extract-ct-scan.ts:62-65](src/lib/claude/extract-ct-scan.ts#L62-L65) is copied verbatim across extractors. Generic version in [src/lib/claude/generate-summary.ts:256-272](src/lib/claude/generate-summary.ts#L256-L272).

Shared client — [src/lib/claude/client.ts](src/lib/claude/client.ts) — `callClaudeTool` wrapper (not read in detail; memory note `feedback_claude_max_tokens_truncation.md` warns that `stop_reason=max_tokens` masquerades as zod failure).

### 4. Zod schemas

[src/lib/validations/ct-scan-extraction.ts](src/lib/validations/ct-scan-extraction.ts) — 45 lines, two tiers:

1. **AI output schema** (`ctScanExtractionResultSchema`, `ctScanExtractionResponseSchema`) — matches Claude tool output. All optional fields as `.nullable()`. `confidence: z.enum(['high','medium','low'])`.
2. **Provider review form schema** (`ctScanReviewFormSchema`) — same shape but with `.min(1)` on required user-facing fields.

Inferred types: `CtScanExtractionResult`, `CtScanExtractionResponse`, `CtScanFinding`, `CtScanReviewFormValues`.

### 5. Server actions (CT Scan canonical — 314 lines)

[src/actions/ct-scan-extractions.ts](src/actions/ct-scan-extractions.ts) exports:

| Function | Purpose |
|---|---|
| `extractCtScanReport(documentId)` | soft-deletes prior extractions, inserts `processing` placeholder, downloads PDF, encrypted check, base64, calls extractor, calls `insertMultiRegionExtractions`, revalidates paths |
| `insertMultiRegionExtractions` (private) | first report updates placeholder row, additional regions insert new rows, all share `raw_ai_response` |
| `listCtScanExtractions(caseId)` | joins `documents` for file name, filters deleted, orders by created_at |
| `getCtScanExtraction(extractionId)` | single fetch with doc join |
| `approveCtScanExtraction(extractionId)` | `review_status='approved'`, calls `syncDocumentReviewed` |
| `saveAndApproveCtScanExtraction(extractionId, overrides)` | `review_status='edited'`, stores overrides JSON |
| `rejectCtScanExtraction(extractionId, reason)` | `review_status='rejected'`, stores reason in `extraction_notes` |
| `syncDocumentReviewed` (private) | flips `documents.status='reviewed'` |

Guards repeated on every write: `auth.getUser()`, `assertCaseNotClosed(supabase, caseId)` from [src/actions/case-status.ts](src/actions/case-status.ts).

Revalidation: `/patients/${caseId}/clinical` and `/patients/${caseId}/documents`.

### 6. DB schema per extraction table

[supabase/migrations/022_ct_scan_extractions.sql](supabase/migrations/022_ct_scan_extractions.sql) — canonical shape:

```sql
create table public.ct_scan_extractions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id),
  case_id uuid not null references cases(id),
  schema_version integer not null default 1,

  -- Extracted fields (per doc type)
  body_region text, scan_date date, technique text,
  reason_for_study text, findings jsonb not null default '[]',
  impression_summary text,

  -- AI metadata (identical across doc types)
  ai_model text,
  ai_confidence text check (ai_confidence in ('high','medium','low')),
  extraction_notes text,
  raw_ai_response jsonb,

  -- Extraction pipeline
  extraction_status text not null default 'pending'
    check (extraction_status in ('pending','processing','completed','failed')),
  extraction_error text,
  extraction_attempts integer not null default 0,
  extracted_at timestamptz,

  -- Provider review workflow
  review_status text not null default 'pending_review'
    check (review_status in ('pending_review','approved','edited','rejected')),
  reviewed_by_user_id uuid references users(id),
  reviewed_at timestamptz,
  provider_overrides jsonb not null default '{}',

  -- Audit (identical across doc types)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by_user_id uuid references users(id),
  updated_by_user_id uuid references users(id)
);

create index idx_ct_scan_extractions_case_id on ct_scan_extractions(case_id);
create index idx_ct_scan_extractions_document_id on ct_scan_extractions(document_id);
create index idx_ct_scan_extractions_review_status on ct_scan_extractions(review_status);
create index idx_ct_scan_extractions_findings on ct_scan_extractions using gin(findings);

create trigger set_updated_at before update on ct_scan_extractions
  for each row execute function update_updated_at();

alter table ct_scan_extractions enable row level security;
create policy "Authenticated users full access" on ct_scan_extractions
  for all using (auth.role() = 'authenticated');
```

Same migration also drops + re-adds `documents_document_type_check` to include the new type.

### 7. Upload UI

[src/components/documents/upload-sheet.tsx](src/components/documents/upload-sheet.tsx) — 395 lines.

Key extension points:
- `StagedFile.documentType: DocumentType` — default at line 53
- `pendingExtractions: Array<{ type: 'mri' | 'chiro' | ... | 'ct_scan'; documentId: string }>` — string-literal union at line 108
- Per-type `if (stagedFile.documentType === 'X' && metaResult.data) pendingExtractions.push(...)` — lines 164-181
- Per-type `if (extraction.type === 'X') extractXReport(id).then(...)` with toast + View action — lines 200-295
- `<SelectItem>` list in the JSX — lines 363-371

Extractions are fired inside a `setTimeout(0)` so the document list revalidates first.

### 8. Document card + list UI

[src/components/documents/document-card.tsx:21-64](src/components/documents/document-card.tsx#L21-L64) — four parallel `Record<string, string>` maps:
- `docTypeLabels` (human label)
- `docTypeColors` (badge class)
- `docTypeFilenameLabels` (camelCase for download filename)
- `generatedFileNameLabels` (unrelated, for `document_type='generated'` subtypes)

[src/components/documents/document-list.tsx:18-23](src/components/documents/document-list.tsx#L18-L23) — filter dropdown options.

### 9. Clinical tabs aggregator

[src/app/(dashboard)/patients/[caseId]/clinical/page.tsx](src/app/(dashboard)/patients/[caseId]/clinical/page.tsx) — 63 lines.

- `Promise.all([listMriExtractions, listChiroExtractions, listPainManagementExtractions, listPtExtractions, listOrthopedicExtractions, listCtScanExtractions])`
- One `<TabsTrigger>` + one `<TabsContent>` per doc type
- Each tab renders `<XExtractionList extractions={...} caseId={caseId} />`

### 10. Review / list / form components

Per doc type, three files under [src/components/clinical/](src/components/clinical/):

- `*-extraction-list.tsx` — groups by `document_id` for multi-region display, ExtractionCard with confidence + review badges
- `*-extraction-review.tsx` — side-by-side raw vs. edit form, approve/save/reject buttons
- `*-extraction-form.tsx` — react-hook-form + zod review schema, editable fields

CT Scan example: [src/components/clinical/ct-scan-extraction-list.tsx](src/components/clinical/ct-scan-extraction-list.tsx) (198 lines), `ct-scan-extraction-review.tsx` (161), `ct-scan-extraction-form.tsx` (356).

Loading state: [src/components/clinical/generating-progress.tsx](src/components/clinical/generating-progress.tsx).

### 11. Cascade soft-delete

[src/actions/documents.ts:220-252](src/actions/documents.ts#L220-L252) — `removeDocument` runs `Promise.all` of 6 updates, one per `*_extractions` table. Adding a new doc type means adding a 7th entry here.

### 12. Case summary aggregation

**Query fan-out** — [src/actions/case-summaries.ts:23-66](src/actions/case-summaries.ts#L23-L66) — parallel `supabase.from('X_extractions').select(...).in('review_status', ['approved','edited'])` for each doc type. Column lists are per-type and feed directly into the summary prompt JSON.

**Empty-state gate** — [src/actions/case-summaries.ts:79-81](src/actions/case-summaries.ts#L79-L81) — summary generation requires ≥1 approved/edited extraction across all types.

**`SummaryInputData` type** — [src/lib/claude/generate-summary.ts:245-253](src/lib/claude/generate-summary.ts#L245-L253) — per-type array shape, unioned.

**Summary prompt rule** — [src/lib/claude/generate-summary.ts:39](src/lib/claude/generate-summary.ts#L39):
> "When CT scan data is present, incorporate CT findings into imaging_findings alongside MRI data."

The prompt only *names* MRI/CT/ortho/PM/PT explicitly — it does not template-enumerate them. Adding X-ray means adding rule 17 with analogous guidance (X-ray = bone structural complement to MRI/CT).

Summary model: `claude-opus-4-6`, `thinking: adaptive`, 16384 tokens.

### 13. Initial visit aggregation

[src/actions/initial-visit-notes.ts:152-164,192](src/actions/initial-visit-notes.ts#L152-L164) — `mriCountRes` + `ctCountRes` count queries used to compute `hasApprovedDiagnosticExtractions`. An X-ray extraction would participate here so initial-visit note generation can gate on "any imaging reviewed."

### 14. Document type constant outside main enum

[src/app/(dashboard)/patients/[caseId]/documents/page.tsx](src/app/(dashboard)/patients/[caseId]/documents/page.tsx) — not read in detail; referenced by `document-list.tsx` filter options above.

### 15. Downstream PDF templates (not required for extraction-only types)

[src/lib/pdf/](src/lib/pdf/) contains PDF *generators* (discharge, initial visit, procedure consent, procedure note, imaging orders, chiropractic order, lien, invoice). Radiology-uploaded document types (MRI/CT/PT/PM/Chiro/Ortho) do NOT generate PDFs — they only extract. X-ray should follow the extract-only pattern — no file needed under `src/lib/pdf/`.

### 16. Existing imaging/x-ray mentions

- [src/lib/claude/generate-summary.ts:37](src/lib/claude/generate-summary.ts#L37) — prompt references "X-ray, MRI" in orthopedic integration rule (informational only)
- [src/lib/pdf/imaging-orders-template.tsx](src/lib/pdf/imaging-orders-template.tsx) + [src/lib/pdf/render-imaging-orders-pdf.ts](src/lib/pdf/render-imaging-orders-pdf.ts) — imaging *order* generator (separate concern; used when provider orders imaging, not when receiving a radiology report)

No X-ray extraction table, zod schema, action, Claude extractor, or UI currently exists.

## Code References

Registry and validation:
- `src/lib/validations/document.ts:13` — `documentTypeEnum`
- `src/lib/validations/__tests__/document.test.ts:45` — existing negative-test for `x_ray`

Claude extractor canonical (CT Scan):
- `src/lib/claude/extract-ct-scan.ts:1-105` — prompt, tool, extract function
- `src/lib/claude/__tests__/extract-ct-scan.test.ts:1-31` — test pattern
- `src/lib/validations/ct-scan-extraction.ts:1-45` — dual schema (AI + review form)

Server actions:
- `src/actions/ct-scan-extractions.ts:1-314` — extract/list/get/approve/save/reject
- `src/actions/documents.ts:96-176` — upload session + save metadata
- `src/actions/documents.ts:220-252` — cascade soft-delete

DB schema:
- `supabase/migrations/022_ct_scan_extractions.sql` — table shape + constraint evolution
- `supabase/migrations/20260408_procedure_consent_document_type.sql` — latest constraint form

UI — documents:
- `src/components/documents/upload-sheet.tsx:108,164-181,200-295,363-371`
- `src/components/documents/document-card.tsx:21-64`
- `src/components/documents/document-list.tsx:18-23`

UI — clinical:
- `src/app/(dashboard)/patients/[caseId]/clinical/page.tsx:1-63`
- `src/components/clinical/ct-scan-extraction-list.tsx:1-198`
- `src/components/clinical/ct-scan-extraction-review.tsx:1-161`
- `src/components/clinical/ct-scan-extraction-form.tsx:1-356`

Downstream aggregation:
- `src/actions/case-summaries.ts:23-91` — query fan-out + empty-state gate
- `src/lib/claude/generate-summary.ts:39,245-253` — summary prompt + type
- `src/actions/initial-visit-notes.ts:152-164,192` — diagnostic extraction gating

## Architecture Documentation

### Isomorphic doc-type pattern

Every uploaded radiology/clinical doc type (MRI, CT, Chiro, PM, PT, Ortho) follows an identical N-surface wiring. The surfaces are structural, not behavioral — only the *extracted fields* differ per type. The shape is:

```
upload-sheet.tsx ──► saveDocumentMetadata ──► documents row (pending_review)
                                                   │
                                                   ▼
                                         extractXReport(documentId)
                                                   │
                                                   ▼
                               download PDF ──► encrypted check ──► base64
                                                   │
                                                   ▼
                                     extractXFromPdf (Claude tool)
                                                   │
                                                   ▼
                                insertMultiRegionExtractions (1-N rows)
                                                   │
                                                   ▼
                     revalidatePath clinical + documents; toast with View action
```

Review flow:
```
extraction row (pending_review) ──► provider opens review ──► approve | edit+approve | reject
                                                                       │
                                                                       ▼
                                             syncDocumentReviewed (documents.status='reviewed')
                                                                       │
                                                                       ▼
                                 enables case-summary + initial-visit downstream queries
                              (those queries filter `review_status IN ('approved','edited')`)
```

### Multi-region pattern (CT + MRI)

Both MRI and CT use the one-PDF-many-rows pattern. First region updates the `processing` placeholder row; additional regions insert fresh rows. All share the same `document_id` and `raw_ai_response`. UI groups by `document_id` and shows a "{N} regions" badge.

Simpler doc types (Chiro, PM, PT, Ortho) have a 1:1 PDF:row relationship, but the schema is identical — they just never trigger the insert branch.

### Prompt conventions

- `'null'` string convention: Claude is instructed to emit the string `"null"` for missing data. Server-side `normalizeNullString` converts to SQL `null` pre-validation.
- `confidence: 'high' | 'medium' | 'low'` is required on every extraction.
- `extraction_notes` is freeform ambiguity log.
- Each extractor uses `claude-sonnet-4-6` with `maxTokens: 4096` (generate-summary uses opus-4-6 with 16384).
- `document` content-block carries the PDF as base64.

Memory note `feedback_claude_max_tokens_truncation.md` warns that zod failure in the `parse` callback may actually be a truncated tool-use input due to `stop_reason=max_tokens` — relevant to any new extractor.

### Migration workflow

Per memory note `feedback_supabase_migrations.md`: new migrations are pushed with `npx supabase db push` (not MCP tools). Migration files are named `YYYYMMDD_description.sql` and both (a) alter the `documents_document_type_check` CHECK constraint to add the new string and (b) create the new `x_ray_extractions` table.

After migration, regenerate `src/types/database.ts` (2909 lines) via Supabase CLI to pick up the new table.

### Commit split convention

Per memory note `feedback_plan_commit_split.md`: split feat (code) + docs (plan/research) into separate commits.

## Related Research

- `thoughts/shared/research/2026-04-23-lapi-pm-report-zod-failure.md` — recent radiology extractor debugging
- `thoughts/shared/research/2026-04-22-initial-visit-tone-direction-sections-edit.md` — isomorphic tone_hint pattern (different surface but similar multi-type wiring)

## Open Questions

Resolved in follow-up below.

## Follow-up Research 2026-04-23T20:15:00Z — Sample document analysis

Three X-ray sample PDFs analyzed to finalize schema:

1. **HAAS Radiology Report 20251201.pdf** — in-office ortho read
   - Provider: Sevag Bastian, MD (Orthopedic Surgeon, HAAS Spine & Orthopaedics)
   - Body region: Left shoulder; Views: AP/Y
   - Impression: "no obvious fractures or significant degenerative changes"
   - Explicit disclaimer: "not to represent a complete radiological evaluation... purpose is to understand overall alignment and anatomy"
   - Reading type: **in_office_alignment**

2. **Burbank Imaging cervical x-ray 20250918.pdf** — formal radiology read
   - Ordering: RONI YANI, D.C. (chiropractor); Reading: Alexander Grimm, M.D. (Diplomate American Board of Radiology)
   - Procedure: "X-RAY CERVICAL SPINE, TWO VIEWS"
   - History: "Trauma, pain"
   - Impression: "Loss of lordosis may represent muscle spasm. Mild loss of disk height at C5-C6 with minimal posterior ridging."
   - Findings include spinal level "C5-C6" — matches CT `level` convention
   - Reading type: **formal_radiology**

3. **Burbank Imaging lumbar x-ray 20250918.pdf** — formal radiology, normal study
   - Same provider/facility; Procedure: "X-RAY LUMBAR SPINE, TWO VIEWS"
   - Impression: "Normal x-ray of the lumbar spine"
   - Demonstrates negative finding case — schema must support empty/minimal findings[]

### Shape differences from CT

| Field | CT | X-ray | Notes |
|---|---|---|---|
| `body_region` | ✓ | ✓ | Reuse |
| `scan_date` | ✓ | ✓ | Reuse |
| `technique` | slice thickness, contrast | — | Drop |
| `reason_for_study` | ✓ | ✓ (HISTORY field) | Reuse |
| `findings[].level` | "C5-C6", "Head" | "C5-C6", "glenohumeral joint" | Reuse — anatomical string works for both |
| `impression_summary` | ✓ | ✓ | Reuse |
| — | — | `laterality` | NEW — shoulder/knee/hip need L/R |
| — | — | `procedure_description` | NEW — verbatim "X-RAY CERVICAL SPINE, TWO VIEWS" for CPT mapping |
| — | — | `view_count` + `views_description` | NEW — "AP/Y", "TWO VIEWS" |
| — | — | `reading_type` | NEW — `formal_radiology` \| `in_office_alignment` |
| — | — | `ordering_provider` | NEW — split from reading provider |
| — | — | `reading_provider` | NEW — same as ordering on in-office reads, differs on formal |

### Final X-ray extraction shape

```ts
{
  body_region: string,                  // "Cervical Spine", "Lumbar Spine", "Left Shoulder"
  laterality: 'left' | 'right' | 'bilateral' | null,
  scan_date: string | null,             // ISO YYYY-MM-DD
  procedure_description: string | null, // verbatim "X-RAY CERVICAL SPINE, TWO VIEWS"
  view_count: number | null,            // 2, 3
  views_description: string | null,     // "AP/Y", "AP and lateral", raw text from report
  reading_type: 'formal_radiology' | 'in_office_alignment' | null,
  ordering_provider: string | null,
  reading_provider: string | null,
  reason_for_study: string | null,      // "Trauma, pain"
  findings: Array<{
    level: string,                      // "C5-C6", "glenohumeral joint", "lumbar spine"
    description: string,
    severity: 'mild' | 'moderate' | 'severe' | null,
  }>,
  impression_summary: string | null,
  confidence: 'high' | 'medium' | 'low',
  extraction_notes: string | null,
}
```

### Resolutions

- **Multi-region**: keep CT multi-row infra for consistency. Expect 1 row/PDF typical (plain X-ray series rarely span multiple regions). Cervical+lumbar "series" split into separate PDFs in samples.
- **Downstream imaging_findings**: X-ray feeds `imaging_findings` alongside MRI/CT, but `reading_type='in_office_alignment'` carries lower evidentiary weight. Summary prompt must flag this distinction in `supporting_evidence` strings.
- **Initial-visit gating**: X-ray approved/edited count joins MRI + CT in `hasApprovedDiagnosticExtractions` at [src/actions/initial-visit-notes.ts:192](src/actions/initial-visit-notes.ts#L192).
- **ICD confidence rubric (rule 8a)**: plain X-ray evidence alone must NOT upgrade radiculopathy codes to "high" — rubric requires MRI/CT-grade nerve-root compromise imaging. X-ray findings like "loss of disk height C5-C6" support disc-degeneration codes (M50.3X cervical, M51.3X lumbar) at medium confidence and cervicalgia/lumbago codes (M54.2, M54.5X) at high when correlated with symptoms.

### Confirmed downstream surfaces touched

Validated existing patterns cover every surface needed. No new architecture. Plan scope = replicate CT wiring + prompt rule addendum.
