---
date: 2026-03-14T00:00:00-07:00
researcher: Claude
git_commit: 929dd90880d58c37076415bfec3b6a80c3808b49
branch: main
repository: cliniq
topic: "Orthopedic Report Extraction Support"
tags: [research, codebase, extraction, orthopedic, radiology, xray]
status: complete
last_updated: 2026-03-14
last_updated_by: Claude
---

# Research: Orthopedic Report Extraction Support

**Date**: 2026-03-14
**Researcher**: Claude
**Git Commit**: 929dd90880d58c37076415bfec3b6a80c3808b49
**Branch**: main
**Repository**: cliniq

## Research Question
Can the codebase extract structured data from orthopedic surgical evaluation reports and radiographic (X-ray) reports? If not, what would be needed?

## Summary

The codebase currently supports 4 extraction types: MRI, chiropractic, pain management, and physical therapy. **Neither orthopedic surgical evaluations nor radiographic/X-ray reports are supported.** The sample documents from HAAS Spine & Orthopaedics contain two distinct report types:

1. **Radiographic Report** (X-ray) — A brief findings-only document with body region, imaging date, and a short narrative (e.g., "no obvious fractures or significant degenerative changes"). The existing MRI extractor's Zod schema is structurally permissive enough to hold this data, but the system prompt, tool description, action gate, and UI labels are all MRI-specific.

2. **Orthopedic Surgical Evaluation** — A comprehensive clinical document with present complaints, history of injury, past medical/surgical history, medications, allergies, social/family history, physical examination, diagnostics, ICD-10 diagnoses, and recommendations/referrals with cost estimates. No existing extractor covers this report type. The pain management extractor is the closest structural analog (it captures complaints, physical exam, diagnoses, and treatment plans with costs), but it's tuned for pain management-specific fields.

## Detailed Findings

### Existing Extraction Types

| Type | Doc Type Enum | Extractor | DB Table | Migration |
|---|---|---|---|---|
| MRI | `mri_report` | `extract-mri.ts` | `mri_extractions` | 004 |
| Chiropractic | `chiro_report` | `extract-chiro.ts` | `chiro_extractions` | 005 |
| Pain Management | `pain_management` | `extract-pain-management.ts` | `pain_management_extractions` | 011 |
| Physical Therapy | `pt_report` | `extract-pt.ts` | `pt_extractions` | 012 |

### Full Extraction Stack Pattern (per type)

Each extraction type follows a consistent 6-layer pattern:

1. **Document type enum** — `src/lib/validations/document.ts:13` defines allowed types
2. **Claude extractor** — `src/lib/claude/extract-{type}.ts` with system prompt + forced tool call
3. **Zod validation schema** — `src/lib/validations/{type}-extraction.ts` validates AI output
4. **Server actions** — `src/actions/{type}-extractions.ts` with extract/list/get/approve/save/reject
5. **DB migration** — `supabase/migrations/0XX_{type}_extractions.sql` creates the table
6. **UI components** — `src/components/clinical/{prefix}-extraction-{form,list,review}.tsx`
7. **Upload dispatch** — `src/components/documents/upload-sheet.tsx` auto-triggers extraction on upload
8. **Clinical page tab** — `src/app/(dashboard)/patients/[caseId]/clinical/page.tsx` renders the list

### MRI Extractor vs. X-ray Compatibility

The MRI extractor schema is generic enough at the Zod level (`body_region: string`, `findings: [{ level, description, severity }]`, `impression_summary: string | null`), but the system prompt explicitly instructs Claude to look for disc levels and spinal findings. An X-ray report with "no obvious fractures" would be forced into an ill-fitting model. The action gate at `mri-extractions.ts:25` also hard-rejects anything not typed `mri_report`.

### Pain Management Extractor vs. Orthopedic Eval Compatibility

The pain management extractor captures `chief_complaints`, `physical_exam` (with ROM, orthopedic tests), `diagnoses` (ICD-10), and `treatment_plan` (with costs). An orthopedic eval contains all of these plus: history of injury, past medical history, surgical history, medications, allergies, social history, and family history — fields not present in the PM schema.

## Architecture Decision

Two approaches were considered:

**Option A: Broaden MRI extractor to "Radiology"** — Rename `mri_report` → `radiology_report`, adjust system prompt to handle MRI, X-ray, and CT. Pros: fewer tables, simpler. Cons: breaking change to existing data, MRI-specific fields would be underutilized for X-rays.

**Option B: Separate orthopedic extractor (recommended)** — Create a new `orthopedic_report` document type and extractor that handles both the surgical evaluation and the radiographic report as sub-components of a single orthopedic visit. This mirrors the real-world pattern where the HAAS reports come as a pair from the same provider on the same date.

Option B is recommended because:
- It follows the existing pattern of one extractor per report type
- The orthopedic eval is structurally different enough to warrant its own schema
- The X-ray findings are a sub-component of the orthopedic visit (read by the same surgeon)
- No breaking changes to existing MRI extraction data

## Code References

- `src/lib/validations/document.ts:13` — Document type enum
- `src/lib/claude/extract-mri.ts` — MRI extractor (system prompt + tool schema)
- `src/lib/claude/extract-pain-management.ts` — PM extractor (closest structural analog)
- `src/actions/pain-management-extractions.ts` — PM actions (pattern to follow)
- `src/components/documents/upload-sheet.tsx:162-231` — Upload-to-extraction dispatch
- `src/app/(dashboard)/patients/[caseId]/clinical/page.tsx` — Clinical tabs
- `supabase/migrations/011_pain_management_extractions.sql` — PM migration (pattern to follow)
