# Add X-ray Document Type Processing Pipeline Implementation Plan

## Overview

Add `x_ray` as ninth uploaded document type following the isomorphic extraction-pipeline pattern already used by MRI, CT, Chiro, PM, PT, and Orthopedic reports. Closest analog is CT Scan ([src/lib/claude/extract-ct-scan.ts](src/lib/claude/extract-ct-scan.ts)) — both are radiology, both support multi-region, both feed `imaging_findings` in case summaries. X-ray adds five radiology-specific fields (`laterality`, `procedure_description`, `view_count` / `views_description`, `reading_type`, `ordering_provider` / `reading_provider`) to capture the difference between formal radiology reads (ABR-diplomate radiologist) and in-office alignment reads (ortho reads own films).

Full surface map and sample-document analysis in [thoughts/shared/research/2026-04-23-xray-document-type-pipeline.md](../research/2026-04-23-xray-document-type-pipeline.md).

## Current State Analysis

- No `x_ray` / `xray` / `x-ray` extraction code exists. `documentTypeEnum` at [src/lib/validations/document.ts:13](src/lib/validations/document.ts#L13) covers 10 types, none radiographic plain-film.
- Existing negative test at [src/lib/validations/__tests__/document.test.ts:45](src/lib/validations/__tests__/document.test.ts#L45) asserts `x_ray` is rejected — will flip to valid-types loop.
- `supporting_evidence` narrative in case summary prompt rule 14 already mentions "X-ray, MRI" but no X-ray data source feeds the prompt — currently only MRI/CT extractions populate `imaging_findings`.
- Orthopedic extractions capture in-office X-ray narrative via free-text `diagnostics` field; dedicated X-ray extraction will overlap. Summary layer resolves via deduplication (explicit note in prompt rule).
- CT Scan is the most recent analog (migration 022, all surfaces complete). Adding X-ray = surgical clone of CT wiring with schema swap.

### Key Discoveries
- Upload + per-doc-type fan-out: [src/components/documents/upload-sheet.tsx:108,164-181,200-295,363-371](src/components/documents/upload-sheet.tsx#L108) — 4 edit points per new type (pendingExtractions union, push branch, fire branch, SelectItem).
- Cascade soft-delete fan-out: [src/actions/documents.ts:220-252](src/actions/documents.ts#L220-L252) — one `supabase.from(...).update({ deleted_at })` per extraction table.
- Clinical tabs aggregator: [src/app/(dashboard)/patients/[caseId]/clinical/page.tsx](src/app/(dashboard)/patients/[caseId]/clinical/page.tsx) — `Promise.all` fan-out, one tab trigger + content per type.
- Case summary query fan-out: [src/actions/case-summaries.ts:23-91](src/actions/case-summaries.ts#L23-L91) — column list per type, `SummaryInputData` type at [src/lib/claude/generate-summary.ts:245-253](src/lib/claude/generate-summary.ts#L245-L253).
- Summary prompt rule 16 explicitly calls out CT data integration at [src/lib/claude/generate-summary.ts:39](src/lib/claude/generate-summary.ts#L39); parallel rule 17 needed for X-ray, with reading-type weighting guidance.
- Initial-visit diagnostic-imaging gate: [src/actions/initial-visit-notes.ts:152-164,192](src/actions/initial-visit-notes.ts#L152-L164) counts MRI + CT; X-ray joins that sum.
- `document_type` CHECK constraint is replaced in full by every migration that adds a type — most recent form at [supabase/migrations/20260408_procedure_consent_document_type.sql](supabase/migrations/20260408_procedure_consent_document_type.sql).
- Per memory note `feedback_supabase_migrations.md`: use `npx supabase db push` (not MCP tools) for migration application.

## Desired End State

After this plan:

1. `x_ray` is the 11th value in `documentTypeEnum` and in `documents_document_type_check`.
2. New `x_ray_extractions` table stores extracted data with same audit/review/multi-region shape as `ct_scan_extractions`, plus X-ray-specific columns.
3. `extractXRayFromPdf` extractor calls `claude-sonnet-4-6` with a tool schema that captures laterality, views, reading type, and separates ordering/reading providers.
4. `src/actions/x-ray-extractions.ts` exports extract/list/get/approve/save/reject matching CT action shape, including multi-region insert helper.
5. Document soft-delete cascades to `x_ray_extractions`.
6. Upload sheet offers "X-Ray Report" SelectItem; upload pipeline fires `extractXRayReport` on completion; toast includes "View" action to clinical tab.
7. Clinical page renders new "X-Ray" tab with list/review/form components.
8. `document-card.tsx` + `document-list.tsx` render label, color, filename-label, filter option.
9. Case summary query includes `x_ray_extractions`, `SummaryInputData` carries `xRayExtractions` array, summary prompt rule 17 instructs integration with reading-type weighting.
10. Initial-visit `hasApprovedDiagnosticExtractions` sums MRI + CT + X-ray counts.
11. `src/types/database.ts` regenerated post-migration to surface `x_ray_extractions` typing.
12. All existing tests still pass; new extractor test mirrors `extract-ct-scan.test.ts`; document enum test now lists `x_ray` as valid.

### Key Discoveries
- Every surface has an existing CT precedent — no new architectural decisions required.
- `findings[].level` column name reuses cleanly across CT (spinal levels like "C5-C6") and X-ray (anatomical locations like "glenohumeral joint") — no rename.
- Multi-region insert helper in CT action ([src/actions/ct-scan-extractions.ts:111-160](src/actions/ct-scan-extractions.ts#L111-L160)) is copy-compatible; expected 1 row/PDF in practice but keep infra for series.
- `'null'` string convention in extractor prompts handled by shared `normalizeNullString` helper — copy into X-ray extractor verbatim.

## What We're NOT Doing

- Not adding a PDF generator under `src/lib/pdf/` — X-ray is an extract-only uploaded document, not a clinic-generated artifact.
- Not adding X-ray-specific ICD confidence rubric changes in the summary prompt rule 8a — rubric already handles "imaging evidence" generically; X-ray reading_type weighting addressed in rule 17.
- Not touching the orthopedic extractor's `diagnostics` free-text field, even though it overlaps with uploaded X-ray reports — dedupe happens at case-summary generation, not source level.
- Not adding `view_projection` as a controlled enum (AP/PA/lateral/oblique/Y-view/axial) — sample docs show "AP/Y" and "TWO VIEWS" free-text dominates; store as `views_description: string`.
- Not refactoring the shared extractor infrastructure (e.g., pulling `normalizeNullString` into a shared module). Four other extractors duplicate it; cleanup is a separate refactor.
- Not changing the CT Scan extractor despite the newly-added X-ray rule 17 mentioning X-ray/CT cross-reference — prompt addition is non-breaking.

## Implementation Approach

Surgical replication of CT Scan pipeline, top-down (DB → types → extractor → actions → upload UI → clinical UI → summary/initial-visit hooks → tests). Each phase independently verifiable. No feature flag — enum addition is safe because upload UI only surfaces the new option after deploy.

---

## Phase 1: Database migration

### Overview

Create `x_ray_extractions` table + extend `documents_document_type_check` to include `x_ray`.

### Changes Required:

#### 1. New migration file
**File**: `supabase/migrations/20260423_xray_extractions.sql` (new)
**Changes**: Model on [supabase/migrations/022_ct_scan_extractions.sql](supabase/migrations/022_ct_scan_extractions.sql). Replace constraint to add `x_ray`. Create table with CT audit columns plus X-ray-specific fields.

```sql
-- ============================================
-- ADD x_ray DOCUMENT TYPE
-- ============================================
alter table public.documents
  drop constraint documents_document_type_check,
  add constraint documents_document_type_check
    check (document_type in (
      'mri_report',
      'chiro_report',
      'pain_management',
      'pt_report',
      'orthopedic_report',
      'ct_scan',
      'x_ray',
      'generated',
      'lien_agreement',
      'procedure_consent',
      'other'
    ));

-- ============================================
-- X-RAY EXTRACTIONS TABLE
-- ============================================
create table public.x_ray_extractions (
  id                    uuid primary key default gen_random_uuid(),
  document_id           uuid not null references public.documents(id),
  case_id               uuid not null references public.cases(id),

  schema_version        integer not null default 1,

  -- Extracted fields (X-ray specific)
  body_region           text,
  laterality            text check (laterality in ('left', 'right', 'bilateral')),
  scan_date             date,
  procedure_description text,
  view_count            integer,
  views_description     text,
  reading_type          text check (reading_type in ('formal_radiology', 'in_office_alignment')),
  ordering_provider     text,
  reading_provider      text,
  reason_for_study      text,
  findings              jsonb not null default '[]',
  impression_summary    text,

  -- AI metadata
  ai_model              text,
  ai_confidence         text check (ai_confidence in ('high', 'medium', 'low')),
  extraction_notes      text,
  raw_ai_response       jsonb,

  -- Extraction pipeline
  extraction_status     text not null default 'pending'
    check (extraction_status in ('pending', 'processing', 'completed', 'failed')),
  extraction_error      text,
  extraction_attempts   integer not null default 0,
  extracted_at          timestamptz,

  -- Provider review workflow
  review_status         text not null default 'pending_review'
    check (review_status in ('pending_review', 'approved', 'edited', 'rejected')),
  reviewed_by_user_id   uuid references public.users(id),
  reviewed_at           timestamptz,
  provider_overrides    jsonb not null default '{}',

  -- Audit
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  created_by_user_id    uuid references public.users(id),
  updated_by_user_id    uuid references public.users(id)
);

create index idx_x_ray_extractions_case_id on public.x_ray_extractions(case_id);
create index idx_x_ray_extractions_document_id on public.x_ray_extractions(document_id);
create index idx_x_ray_extractions_review_status on public.x_ray_extractions(review_status);
create index idx_x_ray_extractions_findings on public.x_ray_extractions using gin(findings);

create trigger set_updated_at before update on public.x_ray_extractions
  for each row execute function update_updated_at();

alter table public.x_ray_extractions enable row level security;

create policy "Authenticated users full access" on public.x_ray_extractions
  for all using (auth.role() = 'authenticated');
```

#### 2. Regenerate database.ts
**File**: `src/types/database.ts` (regenerated)
**Changes**: Run `npx supabase gen types typescript --local > src/types/database.ts` after push.

### Success Criteria:

#### Automated verification
- [ ] `npx supabase db push` succeeds: `npx supabase db push`
- [ ] Migration file lints cleanly: `npx supabase db lint` (if configured)
- [ ] Types build: `npx tsc --noEmit`

#### Manual verification
- [ ] `x_ray_extractions` table exists with all columns: query `information_schema.columns` in Supabase SQL editor
- [ ] `documents_document_type_check` allows `x_ray`: `INSERT INTO documents (..., document_type) VALUES (..., 'x_ray')` succeeds in a test case
- [ ] RLS policy blocks unauthenticated role; allows authenticated

---

## Phase 2: Zod schemas + Claude extractor

### Overview

Add X-ray validation schemas (AI output + provider review form) and Claude extractor function. Mirrors CT Scan structure.

### Changes Required:

#### 1. Validation schema
**File**: `src/lib/validations/x-ray-extraction.ts` (new)
**Changes**: Clone [src/lib/validations/ct-scan-extraction.ts](src/lib/validations/ct-scan-extraction.ts) with X-ray field set.

```ts
import { z } from 'zod'

export const xRayFindingSchema = z.object({
  level: z.string(),
  description: z.string(),
  severity: z.enum(['mild', 'moderate', 'severe']).nullable(),
})

export const xRayExtractionResultSchema = z.object({
  body_region: z.string(),
  laterality: z.enum(['left', 'right', 'bilateral']).nullable(),
  scan_date: z.string().nullable(),
  procedure_description: z.string().nullable(),
  view_count: z.number().int().positive().nullable(),
  views_description: z.string().nullable(),
  reading_type: z.enum(['formal_radiology', 'in_office_alignment']).nullable(),
  ordering_provider: z.string().nullable(),
  reading_provider: z.string().nullable(),
  reason_for_study: z.string().nullable(),
  findings: z.array(xRayFindingSchema),
  impression_summary: z.string().nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
  extraction_notes: z.string().nullable(),
})

export const xRayExtractionResponseSchema = z.object({
  reports: z.array(xRayExtractionResultSchema).min(1),
})

export type XRayExtractionResult = z.infer<typeof xRayExtractionResultSchema>
export type XRayExtractionResponse = z.infer<typeof xRayExtractionResponseSchema>
export type XRayFinding = z.infer<typeof xRayFindingSchema>

export const xRayReviewFormSchema = z.object({
  body_region: z.string().min(1, 'Body region is required'),
  laterality: z.enum(['left', 'right', 'bilateral']).nullable(),
  scan_date: z.string().nullable(),
  procedure_description: z.string().nullable(),
  view_count: z.number().int().positive().nullable(),
  views_description: z.string().nullable(),
  reading_type: z.enum(['formal_radiology', 'in_office_alignment']).nullable(),
  ordering_provider: z.string().nullable(),
  reading_provider: z.string().nullable(),
  reason_for_study: z.string().nullable(),
  findings: z.array(xRayFindingSchema.extend({
    level: z.string().min(1, 'Level is required'),
    description: z.string().min(1, 'Description is required'),
  })),
  impression_summary: z.string().nullable(),
})

export type XRayReviewFormValues = z.infer<typeof xRayReviewFormSchema>
```

#### 2. Claude extractor
**File**: `src/lib/claude/extract-x-ray.ts` (new)
**Changes**: Clone [src/lib/claude/extract-ct-scan.ts](src/lib/claude/extract-ct-scan.ts). Prompt explicitly distinguishes formal radiology vs in-office alignment reads.

Key prompt additions beyond CT template:
- "Reading type: set to `formal_radiology` when the reading provider holds ABR/radiology credentials ('Diplomate American Board of Radiology', 'Radiologist') or the report comes from a dedicated imaging facility. Set to `in_office_alignment` when the ordering physician reads their own films for alignment/anatomy assessment — look for disclaimers like 'not a complete radiological evaluation' or 'for purposes of overall alignment'."
- "Separate ordering_provider (who referred the study) from reading_provider (who interpreted the films). On in-office reads these are the same person."
- "Laterality: for paired anatomy (shoulder, knee, hip, wrist, ankle, elbow, foot, hand) extract left/right/bilateral from the body region string; leave null for midline studies (spine regions)."
- "view_count: parse '2', 'TWO VIEWS', 'AP and lateral' etc. into an integer count. views_description: preserve verbatim the views-obtained text."
- Multi-region note identical to CT.

```ts
import Anthropic from '@anthropic-ai/sdk'
import { callClaudeTool } from '@/lib/claude/client'
import { xRayExtractionResponseSchema, type XRayExtractionResult } from '@/lib/validations/x-ray-extraction'

const SYSTEM_PROMPT = `You are a medical data extraction assistant for a personal injury clinic.
Extract structured information from X-ray (plain radiograph) reports using the provided tool.

Rules:
- A single PDF may contain X-ray reports for MULTIPLE body regions. Create a SEPARATE report object for each body region found.
- Extract the body region (e.g., "Cervical Spine", "Lumbar Spine", "Left Shoulder").
- Laterality: extract 'left', 'right', or 'bilateral' for paired anatomy (shoulder, knee, hip, wrist, ankle, elbow, foot, hand). Use "null" for midline studies (spine regions).
- Extract the scan date (may differ per region).
- Extract the procedure description verbatim (e.g., "X-RAY CERVICAL SPINE, TWO VIEWS").
- Parse view_count as an integer (e.g., "TWO VIEWS" → 2, "AP and lateral" → 2, "AP/Y views" → 2). Use "null" if not stated.
- Preserve views_description verbatim from the report ("AP/Y", "TWO VIEWS", "AP and lateral").
- reading_type: 'formal_radiology' when reading provider has ABR or radiology credentials ("Diplomate American Board of Radiology", "Radiologist"), or report originates from a dedicated imaging facility. 'in_office_alignment' when the ordering physician reads their own films (look for disclaimers like "not a complete radiological evaluation" or "for purposes of overall alignment").
- ordering_provider: physician who referred the study. reading_provider: physician who interpreted. May be the same person (in-office reads).
- reason_for_study: extract from HISTORY, INDICATION, or similar section.
- findings: extract each anatomical finding individually. Use spinal level (e.g., "C5-C6") for spine or anatomical location (e.g., "glenohumeral joint", "acromion") otherwise. Do NOT combine multiple findings into one entry.
- impression_summary: radiologist's Impression section verbatim if present.
- If a field cannot be determined, return "null" — do NOT guess.
- Set confidence to "low" if document quality is poor, report is incomplete, or read is informal (in_office_alignment).
- Add extraction_notes for ambiguities or quality issues.`

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: 'extract_x_ray_data',
  description: 'Extract structured data from one or more X-ray reports in a PDF',
  input_schema: {
    type: 'object',
    properties: {
      reports: {
        type: 'array',
        description: 'One report per body region. Most PDFs have 1, but multi-region PDFs will have 2+.',
        items: {
          type: 'object',
          properties: {
            body_region: { type: 'string' },
            laterality: { type: 'string', enum: ['left', 'right', 'bilateral', 'null'] },
            scan_date: { type: 'string', description: 'ISO 8601 date or "null"' },
            procedure_description: { type: 'string', description: 'Verbatim procedure line or "null"' },
            view_count: { type: 'string', description: 'Integer view count as string, or "null"' },
            views_description: { type: 'string', description: 'Verbatim views text or "null"' },
            reading_type: { type: 'string', enum: ['formal_radiology', 'in_office_alignment', 'null'] },
            ordering_provider: { type: 'string' },
            reading_provider: { type: 'string' },
            reason_for_study: { type: 'string' },
            findings: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  level: { type: 'string', description: 'Spinal level or anatomical location' },
                  description: { type: 'string' },
                  severity: { type: 'string', enum: ['mild', 'moderate', 'severe', 'null'] },
                },
                required: ['level', 'description', 'severity'],
              },
            },
            impression_summary: { type: 'string' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            extraction_notes: { type: 'string' },
          },
          required: [
            'body_region', 'laterality', 'scan_date', 'procedure_description',
            'view_count', 'views_description', 'reading_type',
            'ordering_provider', 'reading_provider', 'reason_for_study',
            'findings', 'impression_summary', 'confidence', 'extraction_notes',
          ],
        },
      },
    },
    required: ['reports'],
  },
}

function normalizeNullString(val: unknown): string | null {
  if (val === 'null' || val === null || val === undefined) return null
  return String(val)
}

function normalizeNullEnum<T extends string>(val: unknown, allowed: readonly T[]): T | null {
  if (val === 'null' || val === null || val === undefined) return null
  return allowed.includes(val as T) ? (val as T) : null
}

export async function extractXRayFromPdf(pdfBase64: string): Promise<{
  data?: XRayExtractionResult[]
  rawResponse?: unknown
  error?: string
}> {
  return callClaudeTool<XRayExtractionResult[]>({
    model: 'claude-sonnet-4-6',
    maxTokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [EXTRACTION_TOOL],
    toolName: 'extract_x_ray_data',
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text', text: 'Extract the structured data from this X-ray report now. If the document contains multiple body regions, return a separate report for each.' },
      ],
    }],
    parse: (raw) => {
      const rawReports = Array.isArray(raw.reports) ? raw.reports : []
      const normalizedReports = rawReports.map((r: Record<string, unknown>) => {
        const rawViewCount = normalizeNullString(r.view_count)
        const coercedViewCount = rawViewCount === null ? null : Number(rawViewCount)
        return {
          body_region: r.body_region,
          laterality: normalizeNullEnum(r.laterality, ['left', 'right', 'bilateral'] as const),
          scan_date: normalizeNullString(r.scan_date),
          procedure_description: normalizeNullString(r.procedure_description),
          view_count: Number.isFinite(coercedViewCount) ? coercedViewCount : null,
          views_description: normalizeNullString(r.views_description),
          reading_type: normalizeNullEnum(r.reading_type, ['formal_radiology', 'in_office_alignment'] as const),
          ordering_provider: normalizeNullString(r.ordering_provider),
          reading_provider: normalizeNullString(r.reading_provider),
          reason_for_study: normalizeNullString(r.reason_for_study),
          findings: Array.isArray(r.findings)
            ? r.findings.map((f: Record<string, unknown>) => ({ ...f, severity: f.severity === 'null' ? null : f.severity }))
            : [],
          impression_summary: normalizeNullString(r.impression_summary),
          confidence: r.confidence,
          extraction_notes: normalizeNullString(r.extraction_notes),
        }
      })
      const validated = xRayExtractionResponseSchema.safeParse({ reports: normalizedReports })
      return validated.success
        ? { success: true, data: validated.data.reports }
        : { success: false, error: validated.error }
    },
  })
}
```

#### 3. Extractor test
**File**: `src/lib/claude/__tests__/extract-x-ray.test.ts` (new)
**Changes**: Clone [src/lib/claude/__tests__/extract-ct-scan.test.ts](src/lib/claude/__tests__/extract-ct-scan.test.ts). Assert model=`claude-sonnet-4-6`, toolName=`extract_x_ray_data`, maxTokens=4096, document source wired.

#### 4. Document enum test update
**File**: [src/lib/validations/__tests__/document.test.ts](src/lib/validations/__tests__/document.test.ts)
**Changes**: Line 45 — remove `x_ray` negative test. Add `x_ray` to valid-types iteration above.

### Success Criteria:

#### Automated verification
- [ ] `npx tsc --noEmit` passes
- [ ] `npx vitest run src/lib/claude/__tests__/extract-x-ray.test.ts` passes
- [ ] `npx vitest run src/lib/validations/__tests__/document.test.ts` passes
- [ ] `npx vitest run` (full suite) green

#### Manual verification
- [ ] None yet — extractor not wired to UI until Phase 4.

---

## Phase 3: Server actions

### Overview

Add `src/actions/x-ray-extractions.ts` with the 7-function CT shape. Extend soft-delete cascade in `documents.ts`.

### Changes Required:

#### 1. X-ray actions
**File**: `src/actions/x-ray-extractions.ts` (new)
**Changes**: Clone [src/actions/ct-scan-extractions.ts](src/actions/ct-scan-extractions.ts). Rename `extractCtScanReport` → `extractXRayReport`, `ct_scan_extractions` → `x_ray_extractions`, `CtScanReviewFormValues` → `XRayReviewFormValues`, `'ct_scan'` → `'x_ray'`, doc-type mismatch error → `'Not an X-ray report'`, `ai_model: 'claude-sonnet-4-6'`. Mirror every helper, including `insertMultiRegionExtractions`.

#### 2. Cascade soft-delete
**File**: [src/actions/documents.ts](src/actions/documents.ts)
**Changes**: In `removeDocument` Promise.all at lines 220-252, add a 7th `supabase.from('x_ray_extractions').update({ deleted_at: now, updated_by_user_id: user.id }).eq('document_id', documentId).is('deleted_at', null)` entry.

### Success Criteria:

#### Automated verification
- [ ] `npx tsc --noEmit` passes
- [ ] `npx vitest run` (full suite) green — no existing action tests broken by schema addition

#### Manual verification
- [ ] Deferred to Phase 4 end-to-end test.

---

## Phase 4: Upload UI + document card/list

### Overview

Surface `x_ray` in upload dropdown, wire extraction fire on upload completion, add labels/colors/filter option.

### Changes Required:

#### 1. Upload sheet
**File**: [src/components/documents/upload-sheet.tsx](src/components/documents/upload-sheet.tsx)
**Changes**:
- Line 24 area: `import { extractXRayReport } from '@/actions/x-ray-extractions'`
- Line 108: extend `pendingExtractions` union with `| 'x_ray'`
- After line 181: add `if (stagedFile.documentType === 'x_ray' && metaResult.data) pendingExtractions.push({ type: 'x_ray', documentId: metaResult.data.id })`
- After line 295: add `if (extraction.type === 'x_ray') extractXRayReport(extraction.documentId).then(...)` — toast: `X-ray findings extracted` singular, `${count} X-ray regions extracted` for multi-region; View action routes to `/patients/${caseId}/clinical`
- After line 368: `<SelectItem value="x_ray">X-Ray Report</SelectItem>`

#### 2. Document card
**File**: [src/components/documents/document-card.tsx](src/components/documents/document-card.tsx)
**Changes**: Add `x_ray` entries to all four maps (lines 21-64):
- `docTypeLabels.x_ray = 'X-Ray'`
- `docTypeColors.x_ray = 'bg-sky-100 text-sky-800 border-sky-200'` (unused color slot)
- `docTypeFilenameLabels.x_ray = 'XRay'`

#### 3. Document list filter
**File**: [src/components/documents/document-list.tsx](src/components/documents/document-list.tsx)
**Changes**: Insert `{ value: 'x_ray', label: 'X-Ray' },` in the filter option array (lines 18-23).

### Success Criteria:

#### Automated verification
- [ ] `npx tsc --noEmit` passes
- [ ] `npx eslint src/components/documents/upload-sheet.tsx src/components/documents/document-card.tsx src/components/documents/document-list.tsx`

#### Manual verification
- [ ] Upload sheet lists "X-Ray Report" option after dropping a PDF
- [ ] Upload succeeds; `documents.document_type = 'x_ray'` row exists in Supabase
- [ ] Extraction fires; `x_ray_extractions` row transitions `pending → processing → completed`
- [ ] Toast appears with "View" action routing to `/patients/{caseId}/clinical`
- [ ] Document list filter dropdown includes "X-Ray"
- [ ] Document card shows "X-Ray" badge in sky color

---

## Phase 5: Clinical tab + list/review/form components

### Overview

Add X-Ray tab to clinical-data page with list → review → form flow.

### Changes Required:

#### 1. Clinical page
**File**: [src/app/(dashboard)/patients/[caseId]/clinical/page.tsx](src/app/(dashboard)/patients/[caseId]/clinical/page.tsx)
**Changes**:
- Import `listXRayExtractions` from `@/actions/x-ray-extractions`
- Import `XRayExtractionList` from `@/components/clinical/x-ray-extraction-list`
- Extend `Promise.all` (line 21) with `listXRayExtractions(caseId)` destructured as `{ data: xRayExtractions }`
- Add `<TabsTrigger value="x-ray">X-Ray</TabsTrigger>` after CT scan trigger
- Add `<TabsContent value="x-ray"><XRayExtractionList extractions={xRayExtractions} caseId={caseId} /></TabsContent>`

#### 2. List component
**File**: `src/components/clinical/x-ray-extraction-list.tsx` (new)
**Changes**: Clone [src/components/clinical/ct-scan-extraction-list.tsx](src/components/clinical/ct-scan-extraction-list.tsx). Replace `Extraction` type to include X-ray fields (`laterality`, `procedure_description`, `views_description`, `reading_type`, etc.). Render body region + laterality in the card label (e.g., "Left Shoulder" = `body_region + laterality`-derived). Preserve multi-region grouping.

#### 3. Review component
**File**: `src/components/clinical/x-ray-extraction-review.tsx` (new)
**Changes**: Clone [src/components/clinical/ct-scan-extraction-review.tsx](src/components/clinical/ct-scan-extraction-review.tsx). Swap action imports to X-ray actions. Pass extended X-ray fields to form.

#### 4. Form component
**File**: `src/components/clinical/x-ray-extraction-form.tsx` (new)
**Changes**: Clone [src/components/clinical/ct-scan-extraction-form.tsx](src/components/clinical/ct-scan-extraction-form.tsx). Wire react-hook-form with `xRayReviewFormSchema`. Add form fields: body_region, laterality (radio: left/right/bilateral/none), scan_date, procedure_description, view_count (number input), views_description, reading_type (radio: formal_radiology/in_office_alignment), ordering_provider, reading_provider, reason_for_study, findings array (level + description + severity), impression_summary.

### Success Criteria:

#### Automated verification
- [ ] `npx tsc --noEmit` passes
- [ ] `npx eslint src/components/clinical/x-ray-extraction-*.tsx src/app/\(dashboard\)/patients/\[caseId\]/clinical/page.tsx`

#### Manual verification
- [ ] Clinical page shows "X-Ray" tab
- [ ] Upload a sample X-ray PDF (Burbank cervical report) → extraction row appears in X-Ray tab as `completed`
- [ ] Click through to review → form prefilled with extracted fields, including `reading_type='formal_radiology'` and finding "C5-C6 Mild loss of disk height"
- [ ] Upload HAAS left-shoulder PDF → `reading_type='in_office_alignment'`, `laterality='left'`, `body_region='Shoulder'`, extraction_notes captures the disclaimer
- [ ] Approve extraction → row badge turns green, underlying `documents.status = 'reviewed'`
- [ ] Save + approve with edits → `provider_overrides` JSON populated

---

## Phase 6: Downstream aggregation (case summary + initial-visit)

### Overview

Wire X-ray extractions into case summary generation and the initial-visit "diagnostic imaging" count gate.

### Changes Required:

#### 1. Case summary query fan-out
**File**: [src/actions/case-summaries.ts](src/actions/case-summaries.ts)
**Changes**:
- Extend `Promise.all` at line 23 with 8th query: `supabase.from('x_ray_extractions').select('body_region, laterality, scan_date, procedure_description, view_count, views_description, reading_type, ordering_provider, reading_provider, reason_for_study, findings, impression_summary, provider_overrides').eq('case_id', caseId).is('deleted_at', null).in('review_status', ['approved', 'edited'])`
- Destructure as `xRayRes`
- Set `const xRayExtractions = xRayRes.data || []`
- Include in empty-state check at line 79 (`&& xRayExtractions.length === 0`)
- Add `xRayExtractions` to returned `SummaryInputData`

#### 2. Summary input type + prompt
**File**: [src/lib/claude/generate-summary.ts](src/lib/claude/generate-summary.ts)
**Changes**:
- Extend `SummaryInputData` (line 245) with `xRayExtractions: Array<{ body_region, laterality, scan_date, procedure_description, view_count, views_description, reading_type, ordering_provider, reading_provider, reason_for_study, findings, impression_summary, provider_overrides }>`
- Add rule 17 to `SYSTEM_PROMPT` (after line 39):
  > "17. When X-ray data is present, incorporate X-ray findings into imaging_findings alongside MRI and CT. Weight by reading_type: `formal_radiology` reads (ABR-certified radiologist, dedicated imaging facility) carry full evidentiary weight; `in_office_alignment` reads (ordering physician reading own films, typically with alignment-only disclaimers) carry lower weight — cite them but do not upgrade ICD confidence based on alignment reads alone. Plain X-ray does not satisfy the imaging-showing-nerve-root-compromise requirement in rule 8a — do NOT upgrade radiculopathy codes to 'high' based on X-ray findings alone; MRI or CT evidence is required. X-ray findings like 'loss of disk height C5-C6' support disc-degeneration codes (M50.3X cervical, M51.3X lumbar) and cervicalgia/lumbago codes at medium-to-high confidence when symptom-correlated. Negative X-ray ('no fracture, normal alignment') still valuable — documents rule-out of acute structural injury."

#### 3. Initial-visit diagnostic count
**File**: [src/actions/initial-visit-notes.ts](src/actions/initial-visit-notes.ts)
**Changes**:
- Add parallel count query in the `Promise.all` alongside `mriCountRes` / `ctCountRes` (around line 159): `supabase.from('x_ray_extractions').select('id', { count: 'exact', head: true }).eq('case_id', caseId).is('deleted_at', null).in('review_status', ['approved', 'edited'])` destructured as `xRayCountRes`
- Line 192 `hasApprovedDiagnosticExtractions`: `((mriCountRes.count ?? 0) + (ctCountRes.count ?? 0) + (xRayCountRes.count ?? 0)) > 0`

### Success Criteria:

#### Automated verification
- [ ] `npx tsc --noEmit` passes
- [ ] `npx vitest run` green

#### Manual verification
- [ ] Upload + approve an X-ray extraction in a test case; generate case summary; confirm `imaging_findings` output references the X-ray finding with reading-type qualifier
- [ ] Case with ONLY X-ray (no MRI/CT) still triggers summary generation (empty-state gate passes)
- [ ] Initial-visit note generation in a case with only X-ray approved (no MRI/CT) treats `hasApprovedDiagnosticExtractions = true`

---

## Phase 7: End-to-end regression test

### Overview

Confirm no existing test breakage; run full suite.

### Changes Required:

(No file changes — verification phase.)

### Success Criteria:

#### Automated verification
- [ ] `npx tsc --noEmit`
- [ ] `npx vitest run` — full suite green
- [ ] `npx eslint .`
- [ ] `npx next build` — build succeeds

#### Manual verification
- [ ] Smoke test: upload each of the 3 sample PDFs from the research doc. Confirm extraction succeeds, finding structure correct, reading_type classification correct (HAAS = in_office_alignment; both Burbank docs = formal_radiology).
- [ ] Delete an X-ray document → `x_ray_extractions.deleted_at` set; extraction disappears from clinical tab.
- [ ] Case-summary regeneration after approving X-ray extraction produces summary with X-ray contribution distinct from MRI/CT contributions.

---

## Testing Strategy

### Unit Tests
- `extract-x-ray.test.ts` — model wiring, tool name, document block presence, error propagation (same shape as CT test).
- `document.test.ts` — move `x_ray` from reject to accept.
- No new action tests required — existing CT action patterns have no unit tests; X-ray follows that precedent.

### Integration Tests
- None net-new. Full vitest suite confirms no regression.

### Manual Testing Steps
1. Apply migration locally.
2. Upload `HAAS Radiology Report 20251201.pdf` as "X-Ray Report". Expect:
   - `body_region: "Shoulder"` (or `"Left Shoulder"`)
   - `laterality: "left"`
   - `reading_type: "in_office_alignment"`
   - `ordering_provider` = `reading_provider` = "Sevag Bastian, MD"
   - `views_description: "AP/Y"`, `view_count: 2`
   - `extraction_notes` captures the alignment-only disclaimer
3. Upload `Burbank Imaging cervical x-ray report 20250918.pdf`. Expect:
   - `body_region: "Cervical Spine"`, `laterality: null`
   - `reading_type: "formal_radiology"`
   - `ordering_provider: "RONI YANI, D.C."`, `reading_provider: "Alexander Grimm, M.D."`
   - `procedure_description: "X-RAY CERVICAL SPINE, TWO VIEWS"`, `view_count: 2`
   - `findings` includes `{ level: "C5-C6", description: "Mild loss of disk height with minimal posterior ridging", severity: "mild" }`
4. Upload `Burbank Imaging lumbar x-ray report 20250918.pdf`. Expect:
   - `body_region: "Lumbar Spine"`, `reading_type: "formal_radiology"`
   - `impression_summary: "Normal x-ray of the lumbar spine."`
   - `findings` possibly empty or a single null-severity "normal alignment" entry
5. Approve all three extractions on a test case; generate case summary; verify X-ray contributions appear in `imaging_findings` distinct from MRI/CT, with reading_type context preserved in `supporting_evidence`.
6. Generate initial-visit note in that test case; confirm `imaging_findings` section references X-ray data.

## Performance Considerations

- Extraction inserts one row per body region (usually 1 for X-ray). No perf regression expected.
- Case summary query fan-out grows from 6 to 7 parallel queries — well within Supabase connection budget.
- Summary prompt adds ~300 tokens (rule 17) — negligible vs 16384 `maxTokens`.
- X-ray JSON `findings` column indexed via GIN, same as CT.

## Migration Notes

Per memory note `feedback_supabase_migrations.md`: apply via `npx supabase db push`, not MCP tools. If remote drift is detected, use `supabase migration repair --status reverted <id>` then `supabase db push --include-all` per `feedback_supabase_migration_drift.md`.

After migration push, regenerate `src/types/database.ts`:
```
npx supabase gen types typescript --local > src/types/database.ts
```

Per memory note `feedback_plan_commit_split.md`: split into two commits — `feat: add x-ray document type processing pipeline` (code + migration) and `docs: x-ray document type research and plan` (research/plan markdown).

## References

- Research: [thoughts/shared/research/2026-04-23-xray-document-type-pipeline.md](../research/2026-04-23-xray-document-type-pipeline.md)
- Canonical analog: CT Scan — [src/lib/claude/extract-ct-scan.ts](../../../src/lib/claude/extract-ct-scan.ts), [src/actions/ct-scan-extractions.ts](../../../src/actions/ct-scan-extractions.ts), [supabase/migrations/022_ct_scan_extractions.sql](../../../supabase/migrations/022_ct_scan_extractions.sql)
- Sample documents used for schema design:
  - HAAS Radiology Report 20251201.pdf (in-office ortho read, left shoulder)
  - Burbank Imaging cervical x-ray report 20250918.pdf (formal radiology, C5-C6 finding)
  - Burbank Imaging lumbar x-ray report 20250918.pdf (formal radiology, normal)
