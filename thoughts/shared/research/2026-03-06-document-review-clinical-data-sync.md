---
date: 2026-03-07T01:00:00-05:00
researcher: Claude
git_commit: 559b6b93c7927109f206a1002c8198571466cec7
branch: main
repository: cliniq
topic: "Document Review vs Clinical Data Approval — Status Synchronization Analysis"
tags: [research, documents, clinical-data, extraction, review-workflow, status-sync]
status: complete
last_updated: 2026-03-06
last_updated_by: Claude
---

# Research: Document Review vs Clinical Data Approval — Status Synchronization

**Date**: 2026-03-07T01:00:00-05:00
**Researcher**: Claude
**Git Commit**: 559b6b93
**Branch**: main
**Repository**: cliniq

## Research Question

Is document review relevant to clinical data extraction, and how should document review status be synchronized with clinical data approval?

## Summary

The system currently has **two independent review workflows** that operate on different entities with no synchronization between them:

1. **Document review** (`documents.status`: `pending_review` → `reviewed`) — tracks whether a staff member has reviewed the uploaded file itself
2. **Extraction review** (`mri_extractions.review_status` / `chiro_extractions.review_status`: `pending_review` → `approved` / `edited` / `rejected`) — tracks whether a provider has reviewed the AI-extracted clinical data

**Key finding**: These two workflows are currently disconnected. No code updates `documents.status` when an extraction is approved, and no code prevents extraction if the document hasn't been reviewed. This is actually the correct design for MVP, but future stories should consider adding synchronization.

## Detailed Findings

### 1. Document Status Lifecycle

The `documents` table has a simple binary status field:

| Field | Values | Default | Location |
|-------|--------|---------|----------|
| `status` | `pending_review`, `reviewed` | `pending_review` | [002_case_dashboard_tables.sql:12](supabase/migrations/002_case_dashboard_tables.sql#L12) |
| `reviewed_by_user_id` | UUID (nullable) | null | [002_case_dashboard_tables.sql:15](supabase/migrations/002_case_dashboard_tables.sql#L15) |
| `reviewed_at` | timestamp (nullable) | null | [002_case_dashboard_tables.sql:16](supabase/migrations/002_case_dashboard_tables.sql#L16) |

**Current state**: Documents are always created with `status: 'pending_review'` ([documents.ts:103](src/actions/documents.ts#L103)). There is **no server action to mark a document as "reviewed"** — the `reviewed_by_user_id`, `reviewed_at`, and status transition to `reviewed` are never written by any code. The document status badge is displayed in the UI ([document-card.tsx:33-41](src/components/documents/document-card.tsx#L33-L41)) but all documents permanently show "Pending Review".

### 2. Extraction Review Lifecycle

Both `mri_extractions` and `chiro_extractions` have a richer review workflow:

| Field | Values | Default | Location |
|-------|--------|---------|----------|
| `review_status` | `pending_review`, `approved`, `edited`, `rejected` | `pending_review` | [004_mri_extractions.sql](supabase/migrations/004_mri_extractions.sql), [005_chiro_extractions.sql](supabase/migrations/005_chiro_extractions.sql) |
| `reviewed_by_user_id` | UUID | null | Same |
| `reviewed_at` | timestamp | null | Same |
| `provider_overrides` | JSONB | `{}` | Same |

**The extraction review is fully implemented** with three actions:
- **Approve** → `review_status = 'approved'` ([mri-extractions.ts:176](src/actions/mri-extractions.ts#L176))
- **Save & Approve** → `review_status = 'edited'`, overrides stored ([mri-extractions.ts:204](src/actions/mri-extractions.ts#L204))
- **Reject** → `review_status = 'rejected'` ([mri-extractions.ts:230](src/actions/mri-extractions.ts#L230))

### 3. The Disconnect: No Status Synchronization

**There is zero code that connects these two status systems.** Specifically:

- `extractMriReport()` and `extractChiroReport()` read from `documents` to get `file_path` and `case_id` but never update `documents.status`
- `approveMriExtraction()`, `saveAndApproveMriExtraction()`, and `rejectMriExtraction()` only update `mri_extractions` — they don't touch `documents`
- Same pattern for all chiro extraction actions
- No database triggers sync statuses between tables
- The document list filter supports filtering by status ([documents.ts:25](src/actions/documents.ts#L25)), but since documents never transition to `reviewed`, this filter is effectively non-functional

### 4. Is Document Review Relevant to Clinical Data?

**Yes, but they serve different purposes:**

| Aspect | Document Review | Extraction Review |
|--------|----------------|-------------------|
| **Who** | Staff (any role) | Provider (clinical) |
| **What** | The file itself (correct file? readable? complete?) | The AI-extracted clinical data |
| **When** | After upload, before extraction ideally | After AI extraction completes |
| **Why** | Quality gate: ensure correct document was uploaded | Clinical accuracy: verify AI didn't hallucinate |
| **MVP status** | Schema exists but workflow not implemented | Fully implemented with approve/edit/reject |

**Document review is a quality gate that should precede extraction**, but currently extraction runs immediately on upload without any document review step. This is acceptable for MVP (fast workflow, no friction) but could cause issues:
- Wrong document uploaded → AI extracts garbage → provider wastes time reviewing nonsense
- Corrupted/partial document → extraction fails or produces low-confidence results

### 5. Recommended Synchronization Strategy

For a future story, here's how these should be synchronized:

#### Option A: Auto-sync document status from extraction review (Recommended for next iteration)

When a provider approves an extraction, automatically mark the parent document as "reviewed":

```typescript
// In approveMriExtraction() or saveAndApproveMriExtraction():
await supabase
  .from('documents')
  .update({
    status: 'reviewed',
    reviewed_by_user_id: user.id,
    reviewed_at: new Date().toISOString(),
    updated_by_user_id: user.id,
  })
  .eq('id', extraction.document_id)
```

**Rationale**: If a provider approved the extracted data, they implicitly reviewed the source document. This is the simplest sync that makes the document status meaningful.

#### Option B: Require document review before extraction (Future)

Add a check in `extractMriReport()`:
```typescript
if (doc.status !== 'reviewed') {
  return { error: 'Document must be reviewed before extraction' }
}
```

**Rationale**: Prevents wasted AI API calls on wrong/corrupt documents. However, this adds friction and may not be worth it for MVP when the clinic is small.

#### Option C: Three-phase workflow (Future, more robust)

```
Upload → Document Review (staff) → AI Extraction (auto) → Clinical Review (provider)
```

This requires:
1. A "Review Document" action on the document card (mark as reviewed)
2. Extraction only triggers after document is reviewed (not on upload)
3. Provider reviews extraction in the clinical data page

**This is the most correct workflow** but adds a manual step that slows down the fast-track MVP experience.

### 6. Current Status Field Redundancy

The `documents.status` field with values `pending_review` / `reviewed` is **currently redundant** — it's displayed but never transitioned. Two options:

1. **Implement document review** as a separate action (add a "Mark Reviewed" button to DocumentCard)
2. **Remove document status display** and rely solely on extraction review status

Given the MVP philosophy, option 1 is better for the next iteration since the schema already supports it.

## Code References

| Purpose | File |
|---------|------|
| Documents table schema (status field) | [002_case_dashboard_tables.sql:4-22](supabase/migrations/002_case_dashboard_tables.sql#L4-L22) |
| Document created with pending_review | [documents.ts:103](src/actions/documents.ts#L103) |
| Document status badges (UI) | [document-card.tsx:33-41](src/components/documents/document-card.tsx#L33-L41) |
| Document status filter | [documents.ts:25](src/actions/documents.ts#L25) |
| MRI extraction review actions | [mri-extractions.ts:170-240](src/actions/mri-extractions.ts#L170-L240) |
| Chiro extraction review actions | [chiro-extractions.ts:173-243](src/actions/chiro-extractions.ts#L173-L243) |
| MRI extraction table (review_status) | [004_mri_extractions.sql](supabase/migrations/004_mri_extractions.sql) |
| Chiro extraction table (review_status) | [005_chiro_extractions.sql](supabase/migrations/005_chiro_extractions.sql) |
| Upload triggers extraction | [upload-sheet.tsx:157](src/components/documents/upload-sheet.tsx#L157) |

## Architecture Insights

1. **Two-tier review is the right design** — document review (file quality) and extraction review (data accuracy) serve different purposes and should remain separate concerns
2. **The current "extract on upload" shortcut** skips document review entirely, which is fine for MVP speed but should be revisited
3. **Provider overrides pattern** (`overrides[field] ?? ai_extraction[field]`) preserves audit trail independently of document status
4. **No database triggers** connect the two — synchronization should be at the application layer (server actions) for transparency

## Historical Context (from thoughts/)

- [thoughts/shared/research/2026-03-06-epic-1-story-1.3-patient-document-repository.md](thoughts/shared/research/2026-03-06-epic-1-story-1.3-patient-document-repository.md) — Document repository research. Decision #6: "All uploads default to `pending_review`. Review toggle deferred to a future story."
- [thoughts/shared/research/2026-03-06-epic-2-story-2.1-mri-report-extraction.md](thoughts/shared/research/2026-03-06-epic-2-story-2.1-mri-report-extraction.md) — MRI extraction research. Established the provider review workflow (approve/edit/reject) on extractions, separate from document review.
- [thoughts/personal/tickets/mvp-scope.md](thoughts/personal/tickets/mvp-scope.md) — MVP scope: "Allow provider review/edit" refers to clinical data review, not document review.

## Related Research

- [2026-03-06-epic-1-story-1.3-patient-document-repository.md](thoughts/shared/research/2026-03-06-epic-1-story-1.3-patient-document-repository.md) — Document upload design
- [2026-03-06-epic-2-story-2.1-mri-report-extraction.md](thoughts/shared/research/2026-03-06-epic-2-story-2.1-mri-report-extraction.md) — MRI extraction design
- [2026-03-06-epic-2-story-2.2-chiro-report-extraction.md](thoughts/shared/research/2026-03-06-epic-2-story-2.2-chiro-report-extraction.md) — Chiro extraction design

## Recommendations

### For MVP (Current): No changes needed
The current disconnected design is acceptable. Extraction fires on upload, provider reviews extracted data. Document status is displayed but non-functional — this is a known deferral.

### For Next Iteration: Auto-sync (Option A)
Implement Option A (auto-sync document status when extraction is approved). This is ~10 lines of code per extraction action and makes the document status badges meaningful with minimal workflow changes.

### For Future: Consider Option C
If the clinic processes high volumes or encounters frequent wrong-document-uploaded issues, implement the three-phase workflow where document review gates extraction.

## Open Questions

1. **Should document review be a separate user action or auto-derived from extraction review?** (Recommendation: auto-derived for simplicity — Option A)
2. **Should rejected extractions affect document status?** (Recommendation: no — a rejected extraction means the AI failed, not that the document is wrong)
3. **Should re-extraction reset document status?** (Recommendation: no — the document was already reviewed, only the extraction data is being regenerated)
