---
date: 2026-04-23T14:16:32-07:00
researcher: arsenaid
git_commit: 5c043afe1b25ce26974f6e47bb739ff3111730cf
branch: main
repository: cliniq
topic: "Case summary generation — max_tokens error path and current configuration"
tags: [research, codebase, case-summary, claude, max-tokens, generate-summary]
status: complete
last_updated: 2026-04-23
last_updated_by: arsenaid
---

# Research: Case summary generation — max_tokens error path and current configuration

**Date**: 2026-04-23 14:16:32 PDT
**Researcher**: arsenaid
**Git Commit**: 5c043afe1b25ce26974f6e47bb739ff3111730cf
**Branch**: main
**Repository**: cliniq

## Research Question

Find fix for case summary generation. Error returned:
`Claude hit max_tokens (16384) before finishing tool output. Raise maxTokens or shorten input.`

## Summary

The error string comes from the `max_tokens` guard in [src/lib/claude/client.ts:86-91](src/lib/claude/client.ts#L86-L91), which short-circuits the tool-call parse path when Anthropic's response returns `stop_reason: "max_tokens"`. The case summary generator at [src/lib/claude/generate-summary.ts:299](src/lib/claude/generate-summary.ts#L299) is already configured with `maxTokens: 16384` — the ceiling the guard reports. The generator also uses `model: 'claude-opus-4-6'`, `thinking: { type: 'adaptive' }`, and `toolChoice: { type: 'auto' }`.

The request payload is the full case dossier serialized as JSON in a single user message ([generate-summary.ts:305-310](src/lib/claude/generate-summary.ts#L305-L310)), assembled from eight parallel Supabase queries over `cases`, `mri_extractions`, `chiro_extractions`, `pain_management_extractions`, `pt_extractions`, `orthopedic_extractions`, `ct_scan_extractions`, and `x_ray_extractions` — filtered to `review_status IN ('approved', 'edited')` ([src/actions/case-summaries.ts:23-72](src/actions/case-summaries.ts#L23-L72)). The tool output schema declares 7 required top-level fields (chief_complaint, imaging_findings, prior_treatment, symptoms_timeline, suggested_diagnoses, confidence, extraction_notes) and carries a large system prompt (~40 numbered rules including an OBJECTIVE-SUPPORT RUBRIC and per-code DOWNGRADE PRECOMPUTE rules).

When the guard fires, the server action at [src/actions/case-summaries.ts:157-171](src/actions/case-summaries.ts#L157-L171) writes `generation_status = 'failed'`, stores the error in `generation_error`, persists `raw_ai_response` with the truncated response, and revalidates the case page.

## Detailed Findings

### Error Source — Claude Client Guard

The exact error string appears only at [src/lib/claude/client.ts:88](src/lib/claude/client.ts#L88):

```ts
if (apiResponse.stop_reason === 'max_tokens') {
  return {
    error: `Claude hit max_tokens (${opts.maxTokens}) before finishing tool output. Raise maxTokens or shorten input.`,
    rawResponse: apiResponse,
  }
}
```

This guard runs after the API retry loop succeeds (so the HTTP call itself did not fail) and before any tool-block extraction or zod `parse()`. `${opts.maxTokens}` interpolates whatever value the caller passed — `16384` for case summary.

Context of this guard per memory record `feedback_claude_max_tokens_truncation.md`: added to prevent truncated tool_use inputs from disguising as generic zod failures ("Tool output failed Zod validation after 2 attempts"). Before the guard, max_tokens truncation would reach [client.ts:98-102](src/lib/claude/client.ts#L98-L102) with a structurally-incomplete `raw` JSON object and fail safeParse.

### Case Summary Generator Configuration

[src/lib/claude/generate-summary.ts:290-362](src/lib/claude/generate-summary.ts#L290-L362) — `generateCaseSummaryFromData`:

| Option | Value |
|---|---|
| model | `claude-opus-4-6` |
| maxTokens | `16384` |
| thinking | `{ type: 'adaptive' }` |
| toolChoice | `{ type: 'auto' }` |
| toolName | `extract_case_summary` |
| system | ~40-rule clinical synthesis prompt (lines 5-40) |
| messages | single user turn, `JSON.stringify(inputData, null, 2)` |

Note: `thinking: { type: 'adaptive' }` is the only generator in the codebase using adaptive thinking — per Anthropic's API, extended thinking tokens count toward the `max_tokens` budget, so the 16384 cap covers both thinking + tool_use output combined.

### MaxTokens Configuration Across All Generators

Full inventory from `src/lib/claude/` (grep on `maxTokens`):

| File:Line | Generator | maxTokens |
|---|---|---|
| [extract-mri.ts:89](src/lib/claude/extract-mri.ts#L89) | MRI extraction | 4096 |
| [extract-chiro.ts:182](src/lib/claude/extract-chiro.ts#L182) | Chiro extraction | 4096 |
| [extract-pain-management.ts:222](src/lib/claude/extract-pain-management.ts#L222) | PM extraction | 16384 |
| [extract-pt.ts:303](src/lib/claude/extract-pt.ts#L303) | PT extraction | 4096 |
| [extract-orthopedic.ts:231](src/lib/claude/extract-orthopedic.ts#L231) | Ortho extraction | 4096 |
| [extract-ct-scan.ts:74](src/lib/claude/extract-ct-scan.ts#L74) | CT scan extraction | 4096 |
| [extract-x-ray.ts:93](src/lib/claude/extract-x-ray.ts#L93) | X-ray extraction | 4096 |
| [generate-summary.ts:299](src/lib/claude/generate-summary.ts#L299) | Case summary | 16384 |
| [generate-initial-visit.ts:588](src/lib/claude/generate-initial-visit.ts#L588) | Initial visit (first pass) | 16384 |
| [generate-initial-visit.ts:652](src/lib/claude/generate-initial-visit.ts#L652) | Initial visit (second pass) | 4096 |
| [generate-discharge-note.ts:499](src/lib/claude/generate-discharge-note.ts#L499) | Discharge (first pass) | 16384 |
| [generate-discharge-note.ts:558](src/lib/claude/generate-discharge-note.ts#L558) | Discharge (second pass) | 4096 |
| [generate-procedure-note.ts:723](src/lib/claude/generate-procedure-note.ts#L723) | Procedure (first pass) | 16384 |
| [generate-procedure-note.ts:782](src/lib/claude/generate-procedure-note.ts#L782) | Procedure (second pass) | 4096 |
| [generate-clinical-orders.ts:95](src/lib/claude/generate-clinical-orders.ts#L95) | Clinical orders (first pass) | 4096 |
| [generate-clinical-orders.ts:160](src/lib/claude/generate-clinical-orders.ts#L160) | Clinical orders (second pass) | 4096 |

Case summary already sits at the "main note generator" tier of 16384.

### Server Action — `generateCaseSummary`

[src/actions/case-summaries.ts:115-196](src/actions/case-summaries.ts#L115-L196):

1. Auth check via `supabase.auth.getUser()` (line 117)
2. `assertCaseNotClosed` guard (line 120)
3. `gatherSourceData` pulls all approved/edited extractions in parallel (lines 23-72)
4. Empty-input guard — returns error if all extraction arrays are empty (line 86-96)
5. Soft-deletes any existing summary row (lines 128-132)
6. Inserts new `case_summaries` row with `generation_status: 'processing'`, `generation_attempts: 1`, `source_data_hash` (sha256 of serialized inputData) (lines 135-147)
7. Calls `generateCaseSummaryFromData(inputData)` (line 155)
8. On error: updates row to `generation_status: 'failed'`, stores `generation_error`, `raw_ai_response`, revalidates path (lines 157-171)
9. On success: writes back all summary fields, `ai_model: 'claude-opus-4-6'`, `generation_status: 'completed'`, `generated_at`, revalidates (lines 174-195)

### Source Data Assembly — `gatherSourceData`

[src/actions/case-summaries.ts:19-111](src/actions/case-summaries.ts#L19-L111) issues 8 parallel Supabase queries. Column sets per table (verbatim from the `.select()` strings):

- `cases` — accident_type, accident_date, accident_description
- `mri_extractions` — body_region, mri_date, findings, impression_summary, provider_overrides
- `chiro_extractions` — report_type, report_date, treatment_dates, diagnoses, treatment_modalities, functional_outcomes, provider_overrides
- `pain_management_extractions` — report_date, examining_provider, chief_complaints, physical_exam, diagnoses, treatment_plan, diagnostic_studies_summary, provider_overrides
- `pt_extractions` — evaluation_date, evaluating_therapist, pain_ratings, range_of_motion, muscle_strength, special_tests, outcome_measures, short_term_goals, long_term_goals, plan_of_care, diagnoses, clinical_impression, causation_statement, prognosis, provider_overrides
- `orthopedic_extractions` — report_date, date_of_injury, examining_provider, provider_specialty, history_of_injury, present_complaints, physical_exam, diagnostics, diagnoses, recommendations, provider_overrides
- `ct_scan_extractions` — body_region, scan_date, technique, reason_for_study, findings, impression_summary, provider_overrides
- `x_ray_extractions` — body_region, laterality, scan_date, procedure_description, view_count, views_description, reading_type, ordering_provider, reading_provider, reason_for_study, findings, impression_summary, provider_overrides

All queries filter on `case_id`, `deleted_at IS NULL`, and `review_status IN ('approved', 'edited')`. Each `findings`/`diagnoses`/`treatment_plan`/etc. column is a JSONB blob — the entire structure is serialized into the prompt without summarization or trimming.

### Tool Output Schema

[src/lib/claude/generate-summary.ts:42-181](src/lib/claude/generate-summary.ts#L42-L181) — `SUMMARY_TOOL` (Anthropic.Tool):

- `chief_complaint`: string
- `imaging_findings`: array of `{ body_region, summary, key_findings[], severity }`
- `prior_treatment`: `{ modalities[], total_visits, treatment_period, gaps[{from, to, days}] }`
- `symptoms_timeline`: `{ onset, progression[{date, description}], current_status, pain_levels[{date, level, context}] }`
- `suggested_diagnoses`: array of `{ diagnosis, icd10_code, confidence, supporting_evidence, downgrade_to }`
- `confidence`: enum
- `extraction_notes`: string

All seven top-level fields are `required`. The `suggested_diagnoses` array has no declared cap; its size scales with the number of cross-source diagnoses the rubric produces.

### System Prompt Structure

[src/lib/claude/generate-summary.ts:5-40](src/lib/claude/generate-summary.ts#L5-L40) — `SYSTEM_PROMPT`:

- 17 numbered rules
- Rule 8a: OBJECTIVE-SUPPORT RUBRIC (radiculopathy, myelopathy, M79.1, M54.5)
- Rule 8b: DOWNGRADE PRECOMPUTE table (M50.00/01/02, M47.1X, M54.18, M50.12X, M54.12, M51.17, M54.17, M51.16, M48.0X → specific downgrade_to targets)

The prompt is passed as `system` (not counted against output budget) but influences output length via per-diagnosis `supporting_evidence` + `downgrade_to` requirements.

### Zod Result Schema

[src/lib/validations/case-summary.ts:51-59](src/lib/validations/case-summary.ts#L51-L59) — `caseSummaryResultSchema`:

```ts
export const caseSummaryResultSchema = z.object({
  chief_complaint: z.string().nullable(),
  imaging_findings: z.array(imagingFindingSchema),
  prior_treatment: priorTreatmentSchema,
  symptoms_timeline: symptomsTimelineSchema,
  suggested_diagnoses: z.array(suggestedDiagnosisSchema),
  confidence: z.enum(['high', 'medium', 'low']),
  extraction_notes: z.string().nullable(),
})
```

The parser in `generate-summary.ts:311-360` normalizes "null" string literals to real null, coerces `total_visits` to number, defaults `confidence` to `'low'` if missing, and wraps the output in `safeParse`.

### DB Schema

Migration for `case_summaries` table (per [thoughts/shared/research/2026-03-08-epic-2-story-2.3-clinical-case-summary-design.md](thoughts/shared/research/2026-03-08-epic-2-story-2.3-clinical-case-summary-design.md)) includes:
- `generation_status` (processing | completed | failed)
- `generation_error` (text)
- `generation_attempts` (int)
- `raw_ai_response` (jsonb)
- `source_data_hash` (text, sha256)
- `ai_model`, `ai_confidence`, `extraction_notes`
- `chief_complaint`, `imaging_findings`, `prior_treatment`, `symptoms_timeline`, `suggested_diagnoses`
- `provider_overrides`, `review_status`, `reviewed_by_user_id`, `reviewed_at`
- `deleted_at`, `created_by_user_id`, `updated_by_user_id`

Failure rows persist with the truncated `raw_ai_response` for post-hoc inspection.

### Existing Tests

[src/lib/claude/__tests__/generate-summary.test.ts:29](src/lib/claude/__tests__/generate-summary.test.ts#L29) asserts `opts.maxTokens === 16384`. Test file also covers OBJECTIVE-SUPPORT RUBRIC prompt presence via `capturePrompt` helper.

[src/lib/claude/__tests__/client.test.ts](src/lib/claude/__tests__/client.test.ts) — tests for the shared client including the max_tokens guard (not fully read in this research).

## Code References

- `src/lib/claude/client.ts:86-91` — max_tokens guard that produces the error string
- `src/lib/claude/client.ts:88` — exact error template literal
- `src/lib/claude/generate-summary.ts:297-310` — `callClaudeTool` invocation with maxTokens: 16384
- `src/lib/claude/generate-summary.ts:5-40` — SYSTEM_PROMPT with rubric/downgrade rules
- `src/lib/claude/generate-summary.ts:42-181` — `SUMMARY_TOOL` schema (7 required fields)
- `src/lib/claude/generate-summary.ts:311-360` — parse callback with normalization + safeParse
- `src/actions/case-summaries.ts:19-111` — `gatherSourceData` — 8 parallel Supabase queries
- `src/actions/case-summaries.ts:115-196` — `generateCaseSummary` — orchestration + DB writes
- `src/actions/case-summaries.ts:157-171` — failure-path DB write for this error
- `src/lib/validations/case-summary.ts:51-59` — `caseSummaryResultSchema`
- `src/lib/claude/__tests__/generate-summary.test.ts:29` — existing maxTokens assertion

## Architecture Documentation

**Shared client pattern.** Every Claude call in the codebase goes through `callClaudeTool` in [src/lib/claude/client.ts](src/lib/claude/client.ts), which centralizes: API retry (2 attempts, exponential backoff with jitter 1s–15s, retries 429/529/5xx + socket errors), zod retry (1 retry), max_tokens guard, tool-block extraction, and token-usage logging.

**Two-tier maxTokens convention.** Extractors (single-document parsers) use 4096; the PM extractor and case summary + main-pass note generators use 16384. Second-pass note generators (discharge/procedure/initial-visit) use 4096.

**Adaptive thinking.** `generate-summary.ts` is the only place in the codebase with `thinking: { type: 'adaptive' }`. Per Anthropic API semantics, thinking tokens share the `max_tokens` budget with tool_use output.

**Tool choice auto.** `generate-summary.ts` uses `toolChoice: { type: 'auto' }` — unusual versus other generators which default to `{ type: 'tool', name }` via the `toolChoice ?? { type: 'tool', name: opts.toolName }` fallback in [client.ts:66](src/lib/claude/client.ts#L66).

**Source hash caching.** `source_data_hash` (sha256 of serialized `inputData`) is computed on every generate + staleness check to detect when approved extractions change after summary creation. Hash mismatch marks summary stale in the UI via `checkSummaryStaleness`.

**Failure persistence.** The failed generation is not discarded — the row stays with `generation_status: 'failed'`, `raw_ai_response` holding the truncated Claude response, and `generation_error` holding the exact error string. Visible to the UI for debugging and retry.

## Related Research

- [thoughts/shared/research/2026-03-08-epic-2-story-2.3-clinical-case-summary-design.md](thoughts/shared/research/2026-03-08-epic-2-story-2.3-clinical-case-summary-design.md) — original case summary design
- [thoughts/shared/research/2026-03-14-opus-vs-sonnet-report-generation.md](thoughts/shared/research/2026-03-14-opus-vs-sonnet-report-generation.md) — model selection context
- Memory: `feedback_claude_max_tokens_truncation.md` — prior incident that added the max_tokens guard (LAPI 11.18.25 PM report case)

## Open Questions

- What is the token count (input + thinking + output) for the specific case that hit 16384? The `raw_ai_response` row on the failed `case_summaries` record contains the truncated response with usage info for that request.
- How many approved extractions + which extraction types are on the failing case? `source_data_hash` value on the failed row could be reverse-correlated to the source input if reconstructed.
- The `suggested_diagnoses` array has no declared length cap in the tool schema — the rubric in Rule 8b can emit a large number of per-diagnosis `supporting_evidence` + `downgrade_to` strings, which is the most output-token-heavy field.
