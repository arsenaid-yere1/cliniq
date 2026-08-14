---
date: 2026-08-14T14:45:00-07:00
author: Codex
git_commit: 3353ec8aeee878ddec05bfc8aff91718fa5c6626
branch: main
repository: cliniq
topic: "Prevent chiropractic compiled-chart extraction from truncating at 4,096 output tokens"
status: implemented-pending-manual-verification
implementation_date: 2026-08-14
related_research: ../research/2026-08-14-silva-aslanyan-pdf-max-tokens.md
---

# Chiropractic Compiled-Chart Max-Tokens Fix Implementation Plan

## Overview

Prevent long or compiled chiropractic PDFs from failing with `stop_reason = max_tokens` at the current 4,096-token ceiling. Increase the chiropractic extractor's output allowance to 16,384 tokens and make its prompt define how multiple examination packets are represented in the existing single-extraction schema. Preserve the shared Claude client's truncation guard and the current database/UI architecture.

This is a scoped reliability fix for the failure documented in [the Silva Aslanyan PDF research](../research/2026-08-14-silva-aslanyan-pdf-max-tokens.md). It does not introduce first-class multi-report storage.

## Implementation Progress

### Automated work

- [x] Raised chiropractic extraction output allowance to 16,384 tokens.
- [x] Added deterministic compiled-chart aggregation and exact-deduplication prompt rules.
- [x] Updated focused regression assertions for the new ceiling and prompt contract.
- [x] Ran the three focused test files: 40 tests passed.
- [x] Ran `npx tsc --noEmit`: passed.
- [x] Ran targeted ESLint: passed.
- [x] Ran `git diff --check` and reviewed the source diff: passed.

### Manual verification still required

- [ ] Process the provided 18-page PDF in a configured non-production environment and review the persisted extraction.
- [ ] Confirm the resulting server usage log reports fewer than 16,384 output tokens.
- [ ] Process a representative short single-report chiropractic PDF and confirm no regression.

The patient PDF and its extracted content were not copied into the repository or sent to an external environment during implementation.

## Current State

- [`extractChiroFromPdf()`](../../../src/lib/claude/extract-chiro.ts#L175) sends the entire PDF to `claude-sonnet-4-6` as a base64 `application/pdf` document and forces the `extract_chiro_data` tool.
- The call is limited to `maxTokens: 4096` ([extract-chiro.ts:182](../../../src/lib/claude/extract-chiro.ts#L182)).
- The tool schema has singular `report_type` and `report_date` fields plus variable-length arrays for dates, diagnoses, modalities, pain levels, disability scores, complaints, and restrictions ([extract-chiro.ts:19](../../../src/lib/claude/extract-chiro.ts#L19)).
- The prompt requires all diagnosis codes, modalities, numeric functional outcomes, and individual visit dates, but it does not define how to aggregate a PDF containing multiple examination packets ([extract-chiro.ts:5](../../../src/lib/claude/extract-chiro.ts#L5)).
- When Anthropic returns `stop_reason === 'max_tokens'`, [`callClaudeTool()`](../../../src/lib/claude/client.ts#L78) rejects the partial tool input before Zod parsing and returns the exact error to the caller ([client.ts:178](../../../src/lib/claude/client.ts#L178)).
- [`extractChiroReport()`](../../../src/actions/chiro-extractions.ts#L11) stores the failed status, exact error, and partial raw response in the existing `chiro_extractions` row ([chiro-extractions.ts:85](../../../src/actions/chiro-extractions.ts#L85)).
- The current unit test locks the chiropractic limit to 4,096 tokens ([extract-chiro.test.ts:13](../../../src/lib/claude/__tests__/extract-chiro.test.ts#L13)).
- The shared Anthropic client already has a four-minute request timeout described as sufficient for 16k-token generation ([client.ts:8](../../../src/lib/claude/client.ts#L8)). Other complex extractors, including pain management and orthopedic, already use 16,384 tokens.

## Desired End State

- Chiropractic extraction allows up to 16,384 output tokens.
- Short reports retain the same model, tool schema, parse behavior, and persistence flow.
- A compiled PDF with multiple examination packets is represented deterministically within the current single-extraction schema:
  - `report_type` is `other` when more than one distinct report type is present;
  - `report_date` is the latest explicitly documented examination/report date;
  - `treatment_dates.visit_dates` contains each unique explicitly documented examination/visit date in chronological order, `first_visit`/`last_visit` match its bounds, `total_visits` matches its count, and `treatment_gaps` contains only gaps exceeding 14 days;
  - repeated diagnoses and modalities are not emitted as identical duplicate array entries;
  - distinct pain observations remain separate by date and context;
  - `extraction_notes` identifies the input as a compiled chart and records the aggregation choice.
- The shared max-token guard remains active so a response that reaches 16,384 without finishing still fails safely rather than storing partial clinical data.
- The provided 18-page regression PDF completes extraction in a non-production verification environment without being copied into the repository.

## Key Discoveries

1. The immediate error is an output-budget failure, not an input-context, file-decoding, encryption, upload-size, network, or Zod problem.
2. Raising `maxTokens` does not force every call to generate or bill 16,384 output tokens; it raises the maximum available to calls that need it.
3. A prompt-only deduplication rule can reduce repeated structured output before truncation. Post-parse deduplication alone cannot prevent this failure because parsing never runs when the response stops at `max_tokens`.
4. Retrying first at 4,096 and then at 16,384 would repeat the full PDF request and add latency/cost without preserving useful partial output. The existing codebase already uses a direct 16,384 ceiling for complex extraction.
5. The existing schema cannot store six independent `report_type`/`report_date` pairs. A deterministic aggregation policy is required until first-class compiled-chart support exists.
6. Manual-entry rows retaining `extraction_status = 'failed'` is a shared pattern across all extraction types. Changing that behavior only for chiro would create inconsistent lifecycle semantics and is outside this fix.

## What We Are Not Doing

- No PDF page splitting or pre-processing service.
- No `reports[]` tool schema, multiple `chiro_extractions` rows per document, or database migration.
- No changes to downstream case-summary aggregation or the chiro review form's data model.
- No shared-client automatic retry for `stop_reason = max_tokens`.
- No model change, fallback-model addition, extended thinking, prompt caching, or streaming changes.
- No weakening or removal of the shared max-token safety guard.
- No repository fixture containing the patient PDF or extracted protected health information.
- No change to manual-entry extraction-status semantics; that requires a cross-extractor design decision.

## Implementation Approach

Keep the change inside the chiropractic extractor and its focused tests:

1. Raise the output ceiling from 4,096 to 16,384.
2. Extend the system prompt with explicit compiled-chart aggregation and exact-deduplication rules that fit the current schema.
3. Update unit tests to lock both the new ceiling and the aggregation contract.
4. Run targeted automated checks, then manually process the original 18-page PDF in a safe environment and inspect the stored result.

No action, validation, database, or UI code should change unless implementation reveals a repository fact that invalidates this plan; if that occurs, stop and revise the plan before expanding scope.

## Phase 1: Increase the Output Budget and Define Compiled-Chart Semantics

### Files and changes

#### [`src/lib/claude/extract-chiro.ts`](../../../src/lib/claude/extract-chiro.ts)

- Change `maxTokens` from `4096` to `16384` in `extractChiroFromPdf()`.
- Preserve the current model (`claude-sonnet-4-6`), forced tool name, PDF message block, normalization, and Zod parser.
- Append concise rules to `SYSTEM_PROMPT` with the following exact behavior:
  - Detect whether the PDF contains multiple distinct examination/report packets.
  - For a mixed compiled chart, set `report_type` to `other` and `report_date` to the latest explicit examination/report date.
  - Include each unique explicit examination/visit date in `treatment_dates.visit_dates` in chronological order; set `first_visit` and `last_visit` from the list bounds, set `total_visits` to the list length, and include only gaps exceeding 14 days in `treatment_gaps`.
  - Emit one diagnosis entry per unique `(icd10_code, description, region)` combination; when the same combination repeats, merge it and set `is_primary: true` if any occurrence is primary.
  - Emit one treatment-modality entry per unique `(modality, cpt_code, regions_treated, frequency)` combination; do not collapse entries whose frequency or treated regions differ.
  - Keep pain levels separate when their date, score, or clinical context differs; do not discard longitudinal changes to save tokens.
  - State in `extraction_notes` that the source is a compiled chart and summarize the number/types of packets detected without reproducing patient narrative.
- Do not impose hard array caps. The larger output ceiling and exact duplicate suppression should preserve clinically distinct data.

### Automated verification

- Run the focused extractor and shared-client tests:

  ```text
  npm test -- --run \
    src/lib/claude/__tests__/extract-chiro.test.ts \
    src/lib/claude/__tests__/client.test.ts
  ```

- Run TypeScript checking through the repository's configured compiler:

  ```text
  npx tsc --noEmit
  ```

- Run ESLint only on the modified extractor and test:

  ```text
  npx eslint \
    src/lib/claude/extract-chiro.ts \
    src/lib/claude/__tests__/extract-chiro.test.ts
  ```

### Manual verification

- Review the prompt diff for unambiguous singular-field behavior and confirm that no rule asks Claude to omit clinically distinct observations.
- Confirm the production action/UI path remains untouched and the shared max-token guard still rejects incomplete tool input.

## Phase 2: Lock the Regression Contract in Tests

### Files and changes

#### [`src/lib/claude/__tests__/extract-chiro.test.ts`](../../../src/lib/claude/__tests__/extract-chiro.test.ts)

- Rename the existing configuration test if needed so its title reflects Sonnet, the tool schema, and the 16,384-token ceiling.
- Change the assertion from `4096` to `16384`.
- Capture `opts.system` from the mocked `callClaudeTool()` call and add assertions for the stable behavioral anchors rather than the full prompt text:
  - mixed compiled charts use `report_type: other`;
  - the latest explicit date becomes `report_date`;
  - diagnoses and modalities suppress exact duplicates;
  - clinically distinct longitudinal pain observations are retained;
  - compiled-chart handling is recorded in `extraction_notes`.
- Retain the existing PDF handoff assertion and error-propagation test.
- Do not add a real Anthropic call to the unit suite. The mock-based test should verify request configuration and prompt contract deterministically.

### Automated verification

- Run all three existing chiropractic-focused test files:

  ```text
  npm test -- --run \
    src/lib/claude/__tests__/extract-chiro.test.ts \
    src/lib/claude/__tests__/client.test.ts \
    src/lib/validations/__tests__/chiro-extraction.test.ts
  ```

- Run `git diff --check` and review the complete diff.

### Manual verification

- Use `/Users/macbookpro/Downloads/Evaluations_-_Silva_Aslanyan.pdf` only as a local or staging verification input; do not add it, rendered pages, extracted text, or model output to version control.
- Upload it explicitly as **Chiropractor Report** because the upload UI defaults new files to MRI.
- Verify the extraction reaches `completed`, not `failed`, and the clinical list no longer shows the max-token error or **Enter Manually** for this attempt.
- Inspect the persisted extraction and review form:
  - `report_type` is `other`;
  - `report_date` is the latest explicit examination date;
  - all six explicit examination dates are present and ordered;
  - repeated diagnosis rows are deduplicated;
  - distinct date/context pain observations remain available;
  - `extraction_notes` identifies compiled-chart aggregation;
- Inspect the server's existing `[claude]` usage log and confirm `output_tokens` is below 16,384. Successful extractions persist the parsed tool input as `raw_ai_response`, not the Anthropic message-level usage object, so token usage must be read from logs.
- Re-run one representative short single-report chiropractic PDF and confirm its ordinary extraction remains accurate.

## Risks and Rollback Considerations

### Risks

- A highly detailed compiled chart could still exceed 16,384 tokens. The shared guard will continue to fail safely and retain the raw response for diagnosis.
- Prompt aggregation may change which singular `report_type` and `report_date` are stored for mixed documents. The plan makes that behavior explicit and testable instead of leaving it model-dependent.
- Deduplication could accidentally merge clinically different entries if uniqueness rules are vague. The prompt must use the exact tuples specified above and preserve different dates, scores, contexts, regions, and frequencies.
- Larger permitted responses can increase worst-case latency. The shared client already uses a four-minute timeout designed for 16k-token calls, but manual verification should observe completion time.
- A passing unit suite cannot prove the live model finishes this exact PDF; the non-production regression run is required.

### Rollback

- Revert the prompt additions and restore `maxTokens: 4096` in `extract-chiro.ts`.
- Revert the matching unit-test expectations.
- No database rollback, data migration, or cleanup is required because the tool schema and persisted columns remain unchanged.
- Extractions completed under the new prompt remain valid under the existing schema and do not need rewriting.

## Completion Criteria

- `extractChiroFromPdf()` uses `maxTokens: 16384` without changing model or tool schema.
- The system prompt deterministically defines mixed compiled-chart aggregation and exact duplicate suppression while preserving distinct longitudinal clinical observations.
- Focused tests assert the new ceiling, PDF handoff, error propagation, and compiled-chart prompt contract.
- Chiropractic validation, shared Claude client, TypeScript, and targeted lint checks pass.
- The provided 18-page PDF completes in a safe verification environment and produces a reviewable single extraction with all six examination dates.
- A representative short chiropractic report still extracts successfully.
- The final diff contains no patient PDF, extracted patient text, rendered pages, or model output.
- No database, shared-client, action, UI, or unrelated extraction pipeline files are modified.
