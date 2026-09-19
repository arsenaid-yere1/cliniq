# Additional Quality Review gaps

Date: 2026-09-16

## Research question

Beyond the already documented follow-up omissions, what gaps exist in Quality Review's narrative coverage, evidence inputs, finding verification, and result handling?

Scope: current local implementation. This is research, not a clinical-policy assessment or implementation. The follow-up coverage plan remains unchanged.

## Summary

Coverage is incomplete across other note types too. Several configured review checks lack their authoritative source inputs. There are also confirmed mismatches between findings and the UI's assurance signals: Verify can resolve unrelated findings, the overall assessment is not recomputed after deterministic findings are added, and a recurring resolved finding remains resolved.

These are source-verified behaviors. Conditional consequences below describe what happens for the stated inputs, not incidents observed in a live patient chart.

## Detailed findings by component

### 1. Current saved narratives are only partially collected across all note types

`src/actions/case-quality-reviews.ts:85` and the subsequent payload mapping select only some current narrative columns:

| Note type | Current narrative sections sent directly | Canonical sections |
|---|---:|---:|
| Initial visit | 6 | 16 |
| Pain evaluation | 5 | 16 |
| Procedure | 5 | 20 |
| Discharge | 6 | 12 |

The denominators are the section lists in `src/lib/validations/initial-visit-note.ts:8`, `src/lib/validations/procedure-note.ts:3`, and `src/lib/validations/discharge-note.ts:4`. Pain evaluation maps the shared initial-visit row into a smaller payload and omits even its selected medical-necessity column.

Examples of omitted current prose include initial-visit accident history/imaging/education; procedure allergies, current medications, physical examination, indication, preparation, and aftercare; and discharge examination subsections and education.

The review also receives `raw_ai_response`, which may contain earlier generated versions. That is not equivalent to reviewing the current saved sections. A concrete path is `saveProcedureNote` (`src/actions/procedure-notes.ts:843`): it updates validated narrative fields but not the raw response or narrative warnings. Editing only procedure indication therefore changes neither a directly collected field nor the raw snapshot through this save path. Consequence: that edit can be absent from review and from its source hash.

### 2. Configured checks lack independent evidence

The checklist in `src/lib/claude/generate-quality-review.ts:144` asks for:

- Provider-intake chief-complaint consistency, referring to `provider_intake` and PM `provider_overrides`. Neither field is supplied as a source by `gatherSourceData`.
- Plan continuity involving `procedure_indication`, whose current saved column is not collected.
- Imaging support for diagnosis progression. The collector provides case-summary imaging and extraction counts, not the underlying approved/edited imaging extraction contents or provider overrides.
- Numeric comparison with the initial visit. The collector fetches pain vitals only for procedure IDs (`src/actions/case-quality-reviews.ts:176`). The separate origin-vitals path uses `procedure_id IS NULL` (`src/actions/initial-visit-notes.ts:1098`) and is not called here.

The reviewer can compare supplied summaries and prose, but cannot independently verify all these claims against their omitted source records. This is an evidence limitation, not proof that the model always misses each issue.

### 3. Existing narrative warnings are not reliably surfaced as findings

`validateNarrative` is not rerun by Quality Review. Its saved warnings can reach the model inside raw responses, but there is no deterministic merge for `narrative_warnings` and no explicit checklist instruction requiring their promotion. In contrast, trajectory warnings are explicitly promoted by the prompt (`generate-quality-review.ts:146`). The merge at `case-quality-reviews.ts:407` invokes only two diagnosis validators.

The procedure generator creates narrative warnings at `src/actions/procedure-notes.ts:758` and stores them at line 804; the ordinary save path at line 843 does not refresh them. Therefore those warnings can describe pre-edit text. Discharge has a refresh helper that recalculates narrative warnings (`src/actions/discharge-notes-trajectory.ts:108`), so the behavior is not uniform across note types.

The explicit Quality Review checklist has no dedicated laterality/site, medication/allergy, dose, or general chronological-consistency check. The broad instruction to find inconsistencies may still elicit such findings; absence of a dedicated rule is not proof of zero model coverage.

### 4. Verify can resolve a finding without checking its actual subject

`verifyFinding` correctly replays recognized synthetic diagnosis checks. For other findings it dispatches only by note type:

- Any procedure finding resolves when `plan_alignment_status` is anything other than `unplanned` (`src/actions/case-quality-reviews.ts:796`).
- Any discharge finding resolves when `raw_ai_response.trajectory_warnings` is absent or empty (`src/actions/case-quality-reviews.ts:813`).

It does not establish that a finding concerns plan alignment or trajectory before using those signals. For example, a copied-sentence procedure finding can resolve because plan alignment is clean; a discharge diagnosis/prose contradiction can resolve because no trajectory warning is stored.

The UI offers Verify by the same broad step categories (`src/components/clinical/qc-review-panel.tsx:54`, conditional controls at lines 669 and 704). Conversely, an initial-visit synthetic finding has server replay support but no Verify button because that step is excluded.

### 5. “Review clean” can coexist with critical findings

The action merges deterministic findings after the AI result (`src/actions/case-quality-reviews.ts:407`) but saves the AI's unchanged summary and overall assessment (`:432`). The UI uses that stored assessment to render “Review clean” (`src/components/clinical/qc-review-panel.tsx:318`).

Conditional consequence: an AI result marked clean plus a deterministic critical finding produces a clean heading alongside a critical finding/count. Schema validation also does not enforce consistency between assessment and findings.

### 6. Recheck identity and resolution do not establish that the underlying issue disappeared

- `computeFindingHash` includes free-text message and severity (`src/lib/validations/case-quality-review.ts:140`). A rephrasing produces a different identity even if the clinical issue is unchanged.
- Recheck marks an old nonresolved override resolved when its exact hash is absent (`src/actions/case-quality-reviews.ts:450`). Thus message drift can look like resolution while a new pending finding describes the same issue.
- An already-resolved override is retained unconditionally (`:455`), even when the same finding returns. The UI excludes it from active counts and score (`src/components/clinical/qc-review-panel.tsx:282`). A recurring identical violation can therefore remain classified as resolved.

The comments explicitly describe sticky resolution as intended behavior; the gap is that it does not distinguish a historical resolution from a newly recurring violation.

### 7. Source and persistence failures are not consistently reported

Only the case-details query error is checked in `gatherSourceData` (`src/actions/case-quality-reviews.ts:158`). Other note/extraction results default to empty lists, null notes, or zero counts; the procedure-vitals error is discarded. A source failure can therefore be treated as missing clinical data rather than a failed review.

`checkQualityReviewStaleness` returns false when source gathering yields no input (`:528`). It does not communicate that freshness could not be established.

The final completed-result write and override carry-over write are awaited but their returned errors are not checked (`:429`, `:471`); the action returns success at line 479. This can report success after a database-reported save failure. Live failure rates were not measured.

### 8. Deterministic diagnosis checks have narrower coverage than their descriptions

Neither diagnosis validator reads `painEvaluationNote`, even though the prompt treats pain evaluation as the origin for pain-management-entry cases. This observation does not establish which additional coding policies should apply there.

The claimed M54.5 parent-code guard for initial/discharge narrative diagnoses runs after `parseIvnDiagnoses`, which normalizes M54.5 to M54.50 (`src/lib/icd10/parse-ivn-diagnoses.ts:19`, `src/lib/icd10/validation.ts:37`). The original parent code consequently cannot trigger `isM545Parent` on those text paths. An existing test expressly confirms only the raw procedure JSON code is flagged (`src/lib/qc/__tests__/diagnosis-validators.test.ts:252`).

### 9. Finding destinations are structurally validated, not matched to source evidence

`qualityFindingSchema` checks UUID format and allows any nullable string section key (`src/lib/validations/case-quality-review.ts:29`). The generator parser does not match returned IDs/sections against its source notes. `findingFixEligibility` checks presence and two synthetic exclusions, not membership in the note type's real section list (`:180`).

Thus a syntactically valid but mismatched ID or unknown section can enter the finding UI and be offered Fix. Some downstream generators reject invalid sections; this finding concerns the missing review-output/eligibility check and does not assert an authorization bypass.

## Execution and data flow

Manual review → gather selected current fields plus raw snapshots and counts → hash input → model findings/summary/assessment → add deterministic diagnosis findings → persist original model assessment alongside merged findings → display counts and finding actions.

Verify is a separate path reading audit fields or replaying synthetic checks. Recheck uses exact finding hashes to carry overrides forward. These boundaries explain why complete narrative inputs alone do not address all result-handling gaps.

## Existing tests and verification

Ran:

```sh
npm test -- src/actions/__tests__/case-quality-reviews.test.ts src/lib/validations/__tests__/case-quality-review.test.ts src/lib/qc/__tests__/diagnosis-validators.test.ts src/lib/qc/__tests__/narrative-validator.test.ts
git diff --check
```

Results: **4 files, 101 tests passed**; diff whitespace check passed.

The inspected Verify tests cover unauthenticated/no-review failures, not verification of the actual finding. Existing action tests do not cover assessment reconciliation after deterministic merge, recurring resolved findings, or successful fix plus recheck; the dispatch tests intentionally return regeneration errors. The schema tests confirm message changes alter hashes. The diagnosis test confirms normalization masks the narrative parent-code check.

Passing existing tests is not a reproduction of every conditional failure described above. Findings were established by source tracing; no live database, browser, or model experiment was performed. No application code was changed. Formatting/lint/type checks were not needed for this research-only Markdown addition.

## Historical context

The source comments document deliberate sticky resolutions and step-based Verify. Git history includes the later follow-up integration and an impact-score addition, but commit intent does not establish the completeness of their interactions. Prior follow-up research and its implementation plan cover only a subset of this report.

## Open questions

- Which clinical consistency rules should be explicit product requirements beyond the current checklist?
- How frequently do live model outputs rephrase the same finding, mismatch IDs, or conflict with deterministic assessment severity?
- Are omitted source fields and sticky recurrence behavior deliberate product choices? Their current behavior is verified; their desired policy is not inferred here.
- How much source context can representative large cases include without unacceptable latency? No live model measurement was made.
