---
date: 2026-04-23T00:00:00-07:00
researcher: arsenaid
git_commit: efd2ffeb574d4ff69eba93c93f98c5875d63baeb
branch: main
repository: cliniq
topic: "Why Zod validation fails on the LAPI 11.18.25 pain management report"
tags: [research, codebase, pain-management, zod, extraction, claude]
status: complete
last_updated: 2026-04-23
last_updated_by: arsenaid
---

# Research: Why Zod validation fails on the LAPI 11.18.25 pain management report

**Date**: 2026-04-23
**Researcher**: arsenaid
**Git Commit**: efd2ffeb574d4ff69eba93c93f98c5875d63baeb
**Branch**: main
**Repository**: cliniq

## Research Question

Why does the pain-management zod validation fail on the attached LAPI
Los Angeles Pain Institute initial-exam PDF for patient AZNAVOUR, HASMIG
dated 2025-11-18?

## Summary

Extraction pipeline: PDF → base64 → Claude `claude-sonnet-4-6` tool call
`extract_pain_management_data` → `parse()` normalizer → `painManagementExtractionResultSchema.safeParse()`.
Retry budget is `ZOD_RETRY_ATTEMPTS = 1` (total 2 attempts) in
[src/lib/claude/client.ts:40](src/lib/claude/client.ts#L40).

Report content contains one structural pattern the current schema + normalizer
cannot absorb safely:

- **Shoulder ROM table on PDF page 4 has an empty "R" column** (right side has no
  values; only Left and Normal are populated). Every ROM row requires
  `pain: z.boolean()` (non-nullable, non-optional) plus `normal`/`actual` of
  `z.number().nullable()`. If Claude emits a right-side ROM entry with
  `pain: null` (or omits the field, or returns a string placeholder), zod
  rejects the whole extraction.

Secondary risk surfaces but are lower probability:
- orthopedic test grammar artifact on page 4 ("…tests **are**.")
- treatment plan item #6 (PCP follow-up) has no clean `type` enum fit
- `normalizeNullStringsInArray` does not coerce nested ROM fields

Detailed findings below.

## Detailed Findings

### Extraction entrypoint + retry budget

- [src/actions/pain-management-extractions.ts:11-101](src/actions/pain-management-extractions.ts#L11-L101)
  — `extractPainManagementReport(documentId)`. Downloads PDF, rejects
  `/Encrypt` header, base64-encodes, calls `extractPainManagementFromPdf`.
  On `result.error`, writes `extraction_status='failed'` + `extraction_error`
  + `raw_ai_response` to `pain_management_extractions` row.
- [src/lib/claude/client.ts:40-105](src/lib/claude/client.ts#L40-L105) —
  `callClaudeTool` retries failed zod parse **once** (constant
  `ZOD_RETRY_ATTEMPTS = 1`). After 2 failed zod attempts returns
  `error: "Tool output failed Zod validation after 2 attempts"` + last raw.
  No schema error details propagate to DB — only the generic string.

### Zod schema ([src/lib/validations/pain-management-extraction.ts](src/lib/validations/pain-management-extraction.ts))

Top-level `painManagementExtractionResultSchema`
([L65-L76](src/lib/validations/pain-management-extraction.ts#L65-L76)):
- `report_date`, `date_of_injury`, `examining_provider`: `z.string().nullable()` (format not validated)
- `chief_complaints: z.array(chiefComplaintSchema)`
- `physical_exam: z.array(physicalExamRegionSchema)`
- `diagnoses: z.array(diagnosisSchema)`
- `treatment_plan: z.array(treatmentPlanItemSchema)`
- `diagnostic_studies_summary: z.string().nullable()`
- `confidence: z.enum(['high','medium','low'])` — required
- `extraction_notes: z.string().nullable()`

Critical nested constraints:
- `chiefComplaintSchema` ([L5-L12](src/lib/validations/pain-management-extraction.ts#L5-L12)):
  `pain_rating_min/max: z.number().nullable()` — a string ("6/10") fails.
- **`romMeasurementSchema`** ([L16-L21](src/lib/validations/pain-management-extraction.ts#L16-L21)):
  - `movement: z.string()` required
  - `normal: z.number().nullable()`
  - `actual: z.number().nullable()`
  - **`pain: z.boolean()` — non-nullable, non-optional**
- `orthopedicTestSchema` ([L25-L28](src/lib/validations/pain-management-extraction.ts#L25-L28)):
  `result: z.enum(['positive','negative'])` — no "unknown", no null.
- `diagnosisSchema` ([L42-L48](src/lib/validations/pain-management-extraction.ts#L42-L48)):
  `imaging_support`/`exam_support`/`source_quote` all `.nullable().optional()` — lenient.
- `treatmentPlanItemSchema` ([L52-L61](src/lib/validations/pain-management-extraction.ts#L52-L61)):
  `type` is nullable enum; `estimated_cost_min/max` nullable numbers.

### Claude tool schema + normalizer ([src/lib/claude/extract-pain-management.ts](src/lib/claude/extract-pain-management.ts))

- Tool `extract_pain_management_data`
  ([L30-L161](src/lib/claude/extract-pain-management.ts#L30-L161)) mirrors the
  zod shape. ROM items require `['movement','normal','actual','pain']` and
  `pain` is typed `{ type: 'boolean' }` — no `null` permitted at the tool level either.
- `normalizeNullString` ([L163-L166](src/lib/claude/extract-pain-management.ts#L163-L166))
  turns the literal string `"null"` into JS `null`.
- `normalizeNullStringsInArray` ([L168-L182](src/lib/claude/extract-pain-management.ts#L168-L182))
  applies `normalizeNullString` only to **scalar string fields** passed in.
- In the `parse` callback ([L202-L228](src/lib/claude/extract-pain-management.ts#L202-L228))
  the nested ROM array is forwarded without coercion
  ([L213](src/lib/claude/extract-pain-management.ts#L213)): `range_of_motion: Array.isArray(region.range_of_motion) ? region.range_of_motion : []`.
  → No defensive coercion for `normal`/`actual`/`pain`. Any deviation
  (string "null", `null` in `pain`, missing field) propagates straight to zod.

### PDF content vs. schema — failure points

Report = LAPI pain management initial exam for AZNAVOUR, HASMIG (2025-11-18).
Sections scanned: chief complaints, cervical ROM, cervical orthopedic tests,
cervical motor + sensory, **left shoulder**, lumbar ROM, lumbar orthopedic
tests, lumbar motor + sensory, diagnostic studies, diagnoses, treatment plan.

**Primary failure candidate — Shoulder ROM table (PDF page 4):**

```
Shoulder ROM   R   L    Normal
Flexion            180  180
Extension          50   50
Abduction          170  180
Adduction          45   45
External Rotation  90   90
Internal Rotation  90   90
```

R column is blank across all 6 rows. The chief complaint is **left** shoulder only
and the narrative reads "musculoskeletal examination revealed tenderness upon
palpation of the left posterior area" — right shoulder not exam'd.

Claude has two plausible emissions:
1. Emit only Left rows → OK. Array length not constrained.
2. Emit both sides with Right rows having `normal: 180, actual: null, pain: null`
   or `pain: undefined` / omitted → **zod rejects** because `pain` is a required
   non-nullable boolean. The tool-schema `required: [...'pain']` also fails at
   tool input validation.

Rule 3 of the system prompt
([src/lib/claude/extract-pain-management.ts:11](src/lib/claude/extract-pain-management.ts#L11))
says "extract the Normal, Actual, and Pain columns **exactly as shown** in the
report tables." The table does not show Pain columns for the shoulder at all
(only Cervical and Lumbar tables have the Pain column) — so for shoulder rows
Claude has no column to copy from and must invent `pain`. This is the single
strongest failure trigger in this PDF.

**Secondary candidates:**

- **PDF page 4, shoulder orthopedic tests sentence is ungrammatical:**
  "The following orthopedic tests had negative results: Apprehension, Hawkins,
  Instability, Neer's, and Yergason's tests **are**."
  All 5 are intended negative. If Claude renders any as `result: ''` or any
  value outside `['positive','negative']`, zod rejects.
- **Chief complaint #2 "Intermittent left shoulder pain, rated 6/10":**
  pain_rating_min=6, max=6. `radiation` must be `string | null`; the sentence has
  no radiation for shoulder. If Claude emits `""` instead of `null`, schema
  still passes (`z.string().nullable()` accepts empty string). OK.
- **Treatment plan item #6** — "see primary care physician regarding
  thyroglossal duct cyst" — no clean enum match. `type` is `.nullable()` so
  `null` is accepted; `monitoring` or `other` would also pass.
- **Diagnoses list (16 codes)** — schema permits duplicates and injury codes
  with 7th character (`S13.9XXA`, `S43.409A`, `S39.021A`, `S33.5XXA`,
  `S16.1XXA`). `icd10_code: z.string().nullable()` — no regex. `M79.1` appears
  twice with different descriptions; array allows it. Low risk.
- **Report date "November 18, 2025"** — schema just `z.string().nullable()`.
  Model-emitted `2025-11-18` passes. No format check.

### Why the normalizer does not save this run

`normalizeNullStringsInArray` ([L168-L182](src/lib/claude/extract-pain-management.ts#L168-L182))
accepts a whitelist of scalar string fields per item; the ROM shape is not in
scope. The physical-exam region mapper at
[L208-L216](src/lib/claude/extract-pain-management.ts#L208-L216) only coerces
`palpation_findings` and `neurological_summary` scalars, and passes
`range_of_motion` through untouched. Nothing converts:
- `pain: null` / `pain: undefined` / omitted `pain` → valid boolean
- `actual: ""` / `actual: "--"` → number-or-null
- `orthopedic_tests[].result: ""` → enum value

### How the failure surfaces to the UI

When all retries are exhausted
([src/lib/claude/client.ts:101-104](src/lib/claude/client.ts#L101-L104)),
`callClaudeTool` returns
`{ error: 'Tool output failed Zod validation after 2 attempts', rawResponse: <last raw> }`.

The action at
[src/actions/pain-management-extractions.ts:85-95](src/actions/pain-management-extractions.ts#L85-L95)
writes this string verbatim into `extraction_error` and stores the last raw
AI response in `raw_ai_response`. The specific zod `.issues[]` list is **not**
persisted — by the time `parse()` returns `{ success: false, error }` the
`ZodError` stays inside `callClaudeTool` and is discarded after the retry
decision.

## Code References

- `src/actions/pain-management-extractions.ts:11-101` — server action that
  triggers extraction, handles failure state
- `src/lib/claude/extract-pain-management.ts:30-161` — Anthropic tool schema
- `src/lib/claude/extract-pain-management.ts:168-182` — `normalizeNullStringsInArray`
  helper (scalar-only)
- `src/lib/claude/extract-pain-management.ts:202-228` — `parse` callback that
  feeds `painManagementExtractionResultSchema.safeParse`
- `src/lib/claude/client.ts:40` — `ZOD_RETRY_ATTEMPTS = 1` constant
- `src/lib/claude/client.ts:93-104` — zod retry loop + final error shape
- `src/lib/validations/pain-management-extraction.ts:16-21` —
  `romMeasurementSchema` (the hot spot: `pain: z.boolean()`)
- `src/lib/validations/pain-management-extraction.ts:25-28` —
  `orthopedicTestSchema` strict enum
- `src/lib/validations/pain-management-extraction.ts:65-76` — top-level
  extraction schema
- `src/lib/validations/__tests__/pain-management-extraction.test.ts:22-40` —
  example of well-formed ROM entry (all fields present, `pain: true`)

## Architecture Documentation

- Extraction model: Claude `claude-sonnet-4-6`, `maxTokens: 4096`, tool-use
  with a single forced tool (`tool_choice: { type: 'tool', name: ... }`).
- Two validation layers:
  1. Anthropic tool `input_schema` — enforced server-side by Anthropic before
     the tool block is returned.
  2. `painManagementExtractionResultSchema.safeParse` inside the `parse`
     callback — authoritative.
- Retry taxonomy in `callClaudeTool`:
  - API-level retries: up to 3 attempts for 429/5xx + network resets, exp
    backoff with jitter (`BASE_BACKOFF_MS=1000`, cap 15s).
  - Zod-level retries: 1 re-call to Claude on a failed `safeParse`.
- Normalizer discipline: per-field scalar coercion from literal `"null"`
  string to JS `null`. Nested arrays (ROM, orthopedic_tests) are passed
  through without per-item coercion.
- The PM extraction pipeline is one of seven parallel Claude extractors
  (chiro, ct-scan, mri, orthopedic, pain-management, pt, plus the
  initial-visit generator), all following the same pattern in
  `src/lib/claude/*` + `src/lib/validations/*`.

## Related Research

- [2026-04-21-pm-diagnosis-mri-exam-support-flow.md](2026-04-21-pm-diagnosis-mri-exam-support-flow.md)
  — the imaging/exam support tag pipeline that shipped in commit e8a9164.

## Open Questions

- Does Claude actually emit right-shoulder ROM rows when the R column is blank,
  or does it correctly skip them? The `raw_ai_response` column on the failed
  extraction row would confirm — pull the stored JSON for the latest failed
  `pain_management_extractions` row tied to this PDF.
- If the failure is not the shoulder ROM, the next likely culprits are
  `orthopedic_tests[].result` coming back as empty string or the cervical
  neurological table being squeezed into `neurological_summary` as a stringified
  object.
