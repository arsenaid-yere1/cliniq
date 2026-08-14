---
date: 2026-08-14T14:35:00-07:00
researcher: Codex
git_commit: 3353ec8aeee878ddec05bfc8aff91718fa5c6626
branch: main
repository: cliniq
topic: "Evaluations_-_Silva_Aslanyan.pdf chiropractic extraction max_tokens failure"
tags: [research, codebase, chiropractic, pdf, claude, max-tokens, document-processing]
status: complete
last_updated: 2026-08-14
last_updated_by: Codex
---

# Research: `Evaluations_-_Silva_Aslanyan.pdf` max-tokens failure

## Research Question

Why does processing `Evaluations_-_Silva_Aslanyan.pdf` produce this error, and how does the application turn that error into the failed extraction and **Enter Manually** state?

> Claude hit max_tokens (4096) before finishing tool output. Raise maxTokens or shorten input.

## Summary

The PDF is not corrupt, encrypted, image-only, or too large for the application's upload limit. It is a valid, unencrypted, text-readable 18-page PDF. All 18 pages rendered and yielded extractable text.

The exact error proves that the Anthropic request completed normally but Claude stopped because it exhausted the chiropractic extractor's configured **4,096 output-token budget** while constructing the forced `extract_chiro_data` tool input. The shared Claude wrapper detects `stop_reason === 'max_tokens'` and returns the displayed error before attempting tool-block parsing or Zod validation ([client.ts:178](../../../src/lib/claude/client.ts#L178)).

The file-specific pressure is its structure: it contains **six separate three-page chiropractic examination packets** in one PDF, including an initial examination, repeated re-examinations, and final examinations. The current data model and tool schema represent one extraction with one `report_type` and one `report_date`, while also asking Claude to extract all dates, diagnoses, treatment modalities, pain levels, and other required nested data. Historical design explicitly deferred compiled multi-visit charts and treated each upload as one report producing one extraction. It also states that 4,096 tokens were considered sufficient for a single report and should be monitored for truncation on long reports.

**Verified conclusion:** the immediate failure is output truncation at the configured 4,096-token ceiling, not PDF decoding, download, encryption detection, network retry exhaustion, Zod validation, or the 50 MB upload limit.

**Inference from the inspected file and schema:** the unusually large, mixed-report PDF caused Claude's structured JSON/tool output to exceed that ceiling. The exact partial field at which generation stopped can only be established from the failed row's persisted `raw_ai_response`.

## Detailed Findings

### 1. File inspection

Source inspected in full: `/Users/macbookpro/Downloads/Evaluations_-_Silva_Aslanyan.pdf`.

| Property | Observed value |
|---|---|
| Format | PDF 1.7, produced by TCPDF 6.5.0 |
| Size | 122,130 bytes (~119 KiB) |
| Pages | 18 |
| Encryption | None |
| Forms / JavaScript | None |
| Text extraction | Successful on every page |
| Extracted text | ~5,338 words; ~29,566 characters before page markers |
| Visual rendering | All 18 pages rendered; no missing or visibly corrupt pages |
| Logical structure | Six consecutive three-page chiropractic examination packets |

The six packets repeat detailed complaints, examination findings, orthopedic tests, diagnosis lists, and case narratives. The document mixes multiple report types, while the current extraction result has singular `report_type` and `report_date` fields ([chiro-extraction.ts:77](../../../src/lib/validations/chiro-extraction.ts#L77)).

### 2. Upload and extraction dispatch

Newly staged files default to `mri_report`, and the user can change the type to `chiro_report` in the upload sheet ([upload-sheet.tsx:51](../../../src/components/documents/upload-sheet.tsx#L51), [upload-sheet.tsx:388](../../../src/components/documents/upload-sheet.tsx#L388)).

For a `chiro_report`, upload processing:

1. Uploads the file to Supabase Storage and saves document metadata.
2. Queues `{ type: 'chiro', documentId }` ([upload-sheet.tsx:165](../../../src/components/documents/upload-sheet.tsx#L165)).
3. Calls `extractChiroReport(documentId)` asynchronously after upload completion ([upload-sheet.tsx:202](../../../src/components/documents/upload-sheet.tsx#L202)).
4. Shows the returned server-action error in an `Extraction failed: ...` toast ([upload-sheet.tsx:225](../../../src/components/documents/upload-sheet.tsx#L225)).

The default document type matters operationally, but the reported 4,096-token error and **Enter Manually** state are consistent with the chiropractic extraction path for this file's content.

### 3. Server action and PDF handoff

`extractChiroReport()` performs the following verified sequence ([chiro-extractions.ts:11](../../../src/actions/chiro-extractions.ts#L11)):

1. Authenticates the user and loads the document metadata.
2. Requires `document_type === 'chiro_report'`.
3. Soft-deletes an existing extraction for the same document.
4. Creates one new `chiro_extractions` row with `extraction_status: 'processing'` and `extraction_attempts: 1`.
5. Downloads the original file from the `case-documents` bucket.
6. Rejects a PDF only when the first 8 KiB contains `/Encrypt`.
7. Base64-encodes the entire PDF and calls `extractChiroFromPdf(pdfBase64)`.

The inspected PDF is unencrypted, so it passes the explicit encryption guard. The exact reported Claude error can only occur after the file has been downloaded, encoded, and submitted to Anthropic.

On the Claude failure, the action updates the row to `extraction_status: 'failed'`, copies the exact error to `extraction_error`, preserves the partial response in `raw_ai_response`, and revalidates the clinical page ([chiro-extractions.ts:85](../../../src/actions/chiro-extractions.ts#L85)).

### 4. Chiropractic Claude request

`extractChiroFromPdf()` submits:

| Option | Current value |
|---|---|
| Model | `claude-sonnet-4-6` |
| Maximum output | `maxTokens: 4096` |
| Tool | Forced `extract_chiro_data` tool call |
| PDF input | Entire file as a base64 `application/pdf` document block |
| Thinking | Not enabled |
| Fallback model | Not configured |

References: [extract-chiro.ts:175](../../../src/lib/claude/extract-chiro.ts#L175), [extract-chiro.ts:181](../../../src/lib/claude/extract-chiro.ts#L181), [extract-chiro.ts:189](../../../src/lib/claude/extract-chiro.ts#L189).

The tool requires nine top-level fields and several unbounded arrays, including:

- every visit date and gaps over 14 days;
- all diagnoses;
- all treatment modalities;
- all pain levels and disability scores;
- residual complaints and permanent restrictions;
- a verbatim plateau/MMI statement when present.

The output schema is therefore variable in length and scales with the amount of report content ([extract-chiro.ts:19](../../../src/lib/claude/extract-chiro.ts#L19), [chiro-extraction.ts:77](../../../src/lib/validations/chiro-extraction.ts#L77)).

### 5. Exact source and semantics of the error

The shared `callClaudeTool()` wrapper passes the caller's value directly to Anthropic as `max_tokens` ([client.ts:129](../../../src/lib/claude/client.ts#L129)). After `stream.finalMessage()` returns, it logs usage and checks the stop reason.

When `stop_reason` is `max_tokens`, it returns:

```ts
{
  error: `Claude hit max_tokens (${opts.maxTokens}) before finishing tool output. Raise maxTokens or shorten input.`,
  rawResponse: apiResponse,
}
```

This check occurs before locating the `tool_use` block and before the Zod parser ([client.ts:176](../../../src/lib/claude/client.ts#L176), [client.ts:185](../../../src/lib/claude/client.ts#L185), [client.ts:192](../../../src/lib/claude/client.ts#L192)). Consequently:

- the error is not a Zod schema failure;
- the partial tool output is deliberately not accepted;
- the max-token result is not retried;
- the fallback-model path does not run because this result is not marked as retryable exhaustion, and the chiro caller does not configure a fallback model in any case.

### 6. Why this specific file exceeds the intended shape

The current implementation supports a compiled chart only by aggregating it into one extraction row. It does not create one extraction per examination packet.

The file contains six repeated examination packets, but the result schema has only one `report_type` and one `report_date`. At the same time, prompt rules require **ALL** diagnosis codes, **ALL** modalities, exact numeric functional outcomes, and every treatment date. This combination creates both semantic ambiguity and a large structured response.

Historical research described chiropractic reports as 5-50+ pages and noted compiled-chart complexity, but the MVP decision was: “Multi-visit PDFs (compiled charts) are deferred” and “one report = one extraction” ([2026-03-06 chiro research:298](2026-03-06-epic-2-story-2.2-chiro-report-extraction.md#L298), [2026-03-06 chiro research:331](2026-03-06-epic-2-story-2.2-chiro-report-extraction.md#L331)). The implementation plan selected 4,096 tokens for the single-report design and explicitly said to monitor truncation on long reports ([2026-03-06 chiro plan:281](../plans/2026-03-06-epic-2-story-2.2-chiro-report-extraction.md#L281), [2026-03-06 chiro plan:556](../plans/2026-03-06-epic-2-story-2.2-chiro-report-extraction.md#L556)).

**Inference:** this 18-page, six-packet file is a concrete case of the deferred compiled-chart scenario reaching the monitored truncation risk.

### 7. Failed state and “Enter Manually” behavior

The clinical list renders `extraction_error` verbatim for failed rows and adds an **Enter Manually** badge ([chiro-extraction-list.tsx:133](../../../src/components/clinical/chiro-extraction-list.tsx#L133), [chiro-extraction-list.tsx:154](../../../src/components/clinical/chiro-extraction-list.tsx#L154)). The badge is visual; the whole failed row remains clickable.

Selecting the failed row opens the review screen. `isManualEntry` is true when `extraction_status === 'failed'`, and the form is populated with empty/default values where no successful extraction data exists ([chiro-extraction-review.tsx:107](../../../src/components/clinical/chiro-extraction-review.tsx#L107), [chiro-extraction-review.tsx:117](../../../src/components/clinical/chiro-extraction-review.tsx#L117)). The normal Approve and Reject controls are hidden, and the submit control is labeled **Save** ([chiro-extraction-form.tsx:809](../../../src/components/clinical/chiro-extraction-form.tsx#L809)).

Verified current-state detail: saving manual data calls `saveAndApproveChiroExtraction()`, which stores `review_status: 'edited'` and `provider_overrides`, but does not change `extraction_status` from `failed` to `completed` ([chiro-extractions.ts:198](../../../src/actions/chiro-extractions.ts#L198)). Therefore the extraction row's AI status remains failed after manual data is saved.

## Execution / Data Flow

```text
Upload as chiro_report
  -> save document metadata
  -> extractChiroReport(documentId)
  -> create one processing chiro_extractions row
  -> download + unencrypted check + base64 encode
  -> extractChiroFromPdf(entire 18-page PDF)
  -> Anthropic streams forced extract_chiro_data tool input
  -> response stop_reason = max_tokens at configured 4096
  -> shared wrapper returns exact max_tokens error without parsing
  -> action stores failed status + error + partial raw response
  -> clinical list shows error + Enter Manually
  -> failed row opens default/manual review form
```

## Existing Tests

- [client.test.ts:244](../../../src/lib/claude/__tests__/client.test.ts#L244) verifies that `stop_reason: 'max_tokens'` returns an error, produces no data, and does not retry.
- [extract-chiro.test.ts:13](../../../src/lib/claude/__tests__/extract-chiro.test.ts#L13) verifies Sonnet 4.6, the forced chiro tool, the 4,096-token configuration, and PDF document handoff.
- [extract-chiro.test.ts:26](../../../src/lib/claude/__tests__/extract-chiro.test.ts#L26) verifies helper errors propagate from the extractor.
- [chiro-extraction.test.ts:67](../../../src/lib/validations/__tests__/chiro-extraction.test.ts#L67) verifies the extraction schema and its nested data shapes.

No automated test was found for:

- the `extractChiroReport()` failure-state database write;
- the **Enter Manually** UI path;
- an actual long or compiled chiropractic PDF;
- behavior when manual data is saved on a row whose extraction status is `failed`.

Targeted verification run on 2026-08-14:

```text
npm test -- --run \
  src/lib/claude/__tests__/client.test.ts \
  src/lib/claude/__tests__/extract-chiro.test.ts \
  src/lib/validations/__tests__/chiro-extraction.test.ts

Result: 3 test files passed; 40 tests passed.
```

## Historical Context

- Chiropractic extraction was introduced in commit `8794724f` on 2026-03-06 with `max_tokens: 4096` and one extraction row per uploaded document.
- The shared explicit max-token guard was added in commit `e72734ff` on 2026-04-23 after a pain-management parsing incident. Its purpose is to expose truncation directly instead of allowing a partial tool input to surface later as a generic Zod validation failure.
- The original chiropractic research recognized compiled charts as a distinct challenge but deferred multi-report handling from the MVP.

## File and Symbol References

- [src/components/documents/upload-sheet.tsx](../../../src/components/documents/upload-sheet.tsx) — upload type selection, queueing, extraction toast.
- [`extractChiroReport`](../../../src/actions/chiro-extractions.ts#L11) — orchestration, failure persistence, and one-row lifecycle.
- [`extractChiroFromPdf`](../../../src/lib/claude/extract-chiro.ts#L175) — chiro model/tool request and 4,096-token setting.
- [`callClaudeTool`](../../../src/lib/claude/client.ts#L78) and max-token guard ([line 178](../../../src/lib/claude/client.ts#L178)).
- [`chiroExtractionResultSchema`](../../../src/lib/validations/chiro-extraction.ts#L77) — singular report metadata and nested variable-length arrays.
- [`ChiroExtractionList`](../../../src/components/clinical/chiro-extraction-list.tsx#L58) — failed error and **Enter Manually** badge.
- [`ChiroExtractionReview`](../../../src/components/clinical/chiro-extraction-review.tsx#L87) — failed-row manual-entry mode.
- [`ChiroExtractionForm`](../../../src/components/clinical/chiro-extraction-form.tsx#L42) — manual save behavior.

## Open Questions

1. What are `usage.output_tokens` and the last partially generated field in this failed request? The failed `chiro_extractions.raw_ai_response` row should contain both the Anthropic usage object and partial tool response.
2. Was the upload explicitly classified as `chiro_report`? The upload UI defaults every file to `mri_report`, although the PDF content and downstream UI are consistent with the chiro path.
3. After manual save, is retaining `extraction_status = 'failed'` intentional? The provider data is stored as edited overrides, but the list continues to key its presentation off the failed AI status.

