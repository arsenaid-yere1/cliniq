---
date: 2026-04-30T16:21:21-0700
researcher: arsenaid
git_commit: 7a32df032fd90b98e6a357db454dde78de63de34
branch: main
repository: cliniq
topic: "Where the forbidden-phrase scan rule for 'full recovery' lives, and how raw_ai_response is included"
tags: [research, codebase, qc, quality-review, forbidden-phrase, raw_ai_response]
status: complete
last_updated: 2026-04-30
last_updated_by: arsenaid
---

# Research: Forbidden-phrase scan rule for `full recovery` and `raw_ai_response` audit-discoverability surface

**Date**: 2026-04-30T16:21:21-0700
**Researcher**: arsenaid
**Git Commit**: 7a32df032fd90b98e6a357db454dde78de63de34
**Branch**: main
**Repository**: cliniq

## Research Question

Locate the issue/code that flags the critical-review message:

> "Forbidden-phrase scan rule: 'full recovery' is not permitted in any prognosis section. Even though the surfaced prognosis was rewritten, leaving the phrase in raw_ai_response creates audit/discoverability risk if the raw is ever rendered."

## Summary

The forbidden-phrase scan rule is **not a deterministic validator**. It exists in two places:

1. **Generation-side prompt prohibition** — the procedure-note generator's system prompt (a prompt-level constraint applied to Claude during the generate call) tells the LLM not to emit specific phrases (including `full recovery is expected`) in `prognosis`.
2. **Quality-review prompt-level rule** — the case-quality-review system prompt instructs the reviewing Claude to flag the literal substrings `"complete resolution"`, `"full recovery"`, `"regenerative capacity"` in any `prognosis` section as a finding.

There is no Node-side post-processor / regex validator that scans `prognosis` (or `raw_ai_response`) for these phrases. The forbidden-phrase enforcement is entirely LLM-mediated — first by prompt-restriction during generation, then by prompt-instructed scan during the QC review pass.

The QC review's input payload includes `raw_ai_response` for **every** note in the chain (case summary, initial visit, pain evaluation, every procedure, discharge). So if a generator wrote `full recovery` into the surfaced prognosis and the editor/regen later rewrote the surfaced prognosis, the original phrase would still survive inside the `raw_ai_response` jsonb column on `note_sessions`. That column is currently stored but never rendered in any UI surface or scanned by any deterministic validator.

## Detailed Findings

### Forbidden-phrase rule definition (the critical-review trigger)

[src/lib/claude/generate-quality-review.ts:118](src/lib/claude/generate-quality-review.ts#L118)

```
10. Forbidden-phrase scan. "complete resolution", "full recovery", "regenerative capacity" in any prognosis section.
```

This line lives inside the `SYSTEM_PROMPT` constant for the case-quality-review LLM call. It is item 10 in the `WHAT TO CHECK` numbered list (items 1–10 in [src/lib/claude/generate-quality-review.ts:108-118](src/lib/claude/generate-quality-review.ts#L108-L118)).

The rule is a string instruction to the reviewing Claude — not a deterministic regex. The reviewer Claude is expected to scan the `prognosis` fields it sees in the input payload and emit a finding via the `generate_case_quality_review` tool when it encounters any of the three substrings.

### Generation-time prompt prohibition (procedure note prognosis)

[src/lib/claude/generate-procedure-note.ts:677](src/lib/claude/generate-procedure-note.ts#L677)

```
FORBIDDEN PHRASES (MANDATORY) in prognosis — do NOT use any of the following:
"full recovery is expected", "complete resolution of symptoms", "definitive healing",
"cure", "guaranteed improvement". Prognosis language must remain measured —
"guarded" or "guarded-to-favorable" as documented in the references above.
```

A separate forbidden-phrase block in the same procedure-note generator targets the `procedure_prp_prep` section: [src/lib/claude/generate-procedure-note.ts:501](src/lib/claude/generate-procedure-note.ts#L501) — phrases here include `regenerative capacity`, `tissue regeneration`, `concentrated healing factors`, etc.

### Input shape of the QC review (why `raw_ai_response` matters here)

The QC review's input data type [src/lib/claude/generate-quality-review.ts:9-92](src/lib/claude/generate-quality-review.ts#L9-L92) carries `raw_ai_response: unknown` on every note object, alongside the surfaced `prognosis` field:

| Note source | Has `prognosis` | Has `raw_ai_response` | Lines |
|---|---|---|---|
| `caseSummary` | — | yes | [26](src/lib/claude/generate-quality-review.ts#L26) |
| `initialVisitNote` | yes | yes | [38-39](src/lib/claude/generate-quality-review.ts#L38-L39) |
| `painEvaluationNote` | yes | yes | [49-50](src/lib/claude/generate-quality-review.ts#L49-L50) |
| `procedureNotes[]` | yes | yes | [62, 67](src/lib/claude/generate-quality-review.ts#L62) |
| `dischargeNote` | yes | yes | [78, 81](src/lib/claude/generate-quality-review.ts#L78-L81) |

The entire `inputData` is JSON-stringified and embedded verbatim in the user-message at [src/lib/claude/generate-quality-review.ts:215](src/lib/claude/generate-quality-review.ts#L215):

```ts
content: `Review the following case for quality and consistency.\n\n${JSON.stringify(inputData, null, 2)}`,
```

This means the reviewer Claude receives every note's `raw_ai_response` blob in its prompt. Two consequences relevant to the audit-discoverability concern:

1. The reviewer can in principle observe `full recovery` inside `raw_ai_response` even if the surfaced `prognosis` field has been rewritten.
2. Rule 10's wording — "in any prognosis section" — does not explicitly tell the reviewer to scan `raw_ai_response.prognosis` (the raw object's prognosis key) versus only the top-level `prognosis` string. There is no deterministic scanner that disambiguates this — the behavior depends on how the LLM interprets the rule.

### `raw_ai_response` storage and surface area

DB column (jsonb on `note_sessions`):
- Migration: [supabase/migrations/](supabase/migrations/) — `20250424215826_add_raw_ai_response.sql` adds `raw_ai_response jsonb` with comment "Full AI response payload stored for audit and debugging"

Writers (each session module persists the entire LLM tool-call payload):
- [src/lib/noteSession.ts](src/lib/noteSession.ts) — initial-visit / pain-evaluation
- [src/lib/dischargeNoteSession.ts](src/lib/dischargeNoteSession.ts) — discharge
- [src/lib/procedureNoteSession.ts](src/lib/procedureNoteSession.ts) — procedure

Readers / consumers:
- The case-quality-review action layer (e.g. [src/actions/case-quality-reviews.ts](src/actions/case-quality-reviews.ts)) selects `raw_ai_response` to assemble the `QualityReviewInputData` shape above.
- The discharge generator reads upstream `raw_ai_response.trajectory_warnings` per the prompt at [src/lib/claude/generate-quality-review.ts:110](src/lib/claude/generate-quality-review.ts#L110): "Read discharge.raw_ai_response.trajectory_warnings if present".
- No UI component renders `raw_ai_response`. Searching `src/components/` and `src/app/` finds no consumer that displays the column to a user. The column is therefore stored-but-not-rendered — the audit-discoverability risk in the review message is hypothetical ("if the raw is ever rendered").

### What currently runs deterministically vs. via LLM

| Layer | Forbidden-phrase enforcement |
|---|---|
| Procedure-note generator system prompt | LLM-soft (rule in prompt, not a parser-side check) — [src/lib/claude/generate-procedure-note.ts:501, 677](src/lib/claude/generate-procedure-note.ts#L501) |
| Initial-visit / discharge generator system prompts | No explicit forbidden-phrase block found for `full recovery` / `complete resolution` in the prognosis sections of these generators (grep finds matches only in `generate-procedure-note.ts` and `generate-quality-review.ts`) |
| QC review pass | LLM-soft — [src/lib/claude/generate-quality-review.ts:118](src/lib/claude/generate-quality-review.ts#L118) |
| Deterministic validator on persisted note rows | None |
| Deterministic validator on `raw_ai_response` jsonb | None |

The recent commits `bf1db91 feat: deterministic ICD-10 suffix-rewrite + QC validators` and `1724abe feat: QC finding resolution layer` add deterministic validators but those target ICD-10 7th-character integrity and finding carry-over — not phrase scanning.

## Code References

- [src/lib/claude/generate-quality-review.ts:118](src/lib/claude/generate-quality-review.ts#L118) — the forbidden-phrase rule (item 10 of the QC review system prompt)
- [src/lib/claude/generate-quality-review.ts:108-118](src/lib/claude/generate-quality-review.ts#L108-L118) — full `WHAT TO CHECK` block where rule 10 lives
- [src/lib/claude/generate-quality-review.ts:9-92](src/lib/claude/generate-quality-review.ts#L9-L92) — `QualityReviewInputData` type carrying `raw_ai_response` on every note
- [src/lib/claude/generate-quality-review.ts:212-217](src/lib/claude/generate-quality-review.ts#L212-L217) — user-message construction that JSON-stringifies the full input (including all `raw_ai_response` blobs)
- [src/lib/claude/generate-procedure-note.ts:677](src/lib/claude/generate-procedure-note.ts#L677) — generation-time prognosis forbidden-phrase block
- [src/lib/claude/generate-procedure-note.ts:501](src/lib/claude/generate-procedure-note.ts#L501) — generation-time `procedure_prp_prep` forbidden-phrase block
- [supabase/migrations/](supabase/migrations/) `20250424215826_add_raw_ai_response.sql` — adds the `note_sessions.raw_ai_response jsonb` column with audit-debug comment
- [src/lib/noteSession.ts](src/lib/noteSession.ts), [src/lib/dischargeNoteSession.ts](src/lib/dischargeNoteSession.ts), [src/lib/procedureNoteSession.ts](src/lib/procedureNoteSession.ts) — writers of `raw_ai_response`
- [src/actions/case-quality-reviews.ts](src/actions/case-quality-reviews.ts) — reader that assembles QC input including `raw_ai_response`

## Architecture Documentation

- Two-tier LLM-mediated phrase enforcement:
  - **Tier 1 (preventive)**: section-scoped `FORBIDDEN PHRASES (MANDATORY)` blocks inside generator system prompts (procedure-note `prognosis` and `procedure_prp_prep`). Block is enforced by Claude during generation; no parser-side check after the tool call returns.
  - **Tier 2 (detective)**: rule 10 in the case-quality-review system prompt scans for three substrings in any `prognosis` section across the assembled note chain. The reviewer Claude emits a finding via the `generate_case_quality_review` tool.
- `raw_ai_response` is `jsonb` on `note_sessions`, populated by every session module's save path with the full LLM tool-call payload. It is shipped into the QC reviewer's user-message verbatim (no field-level redaction) but is not rendered in any UI surface today.
- QC findings flow through a separate resolution layer ([src/lib/qc/](src/lib/qc/) directory present, plus `resolveQcFindings` carry-over logic introduced in commit `1724abe`) — a phrase-scan finding from the reviewer would persist there and be carried across regenerations until verified.

## Related Research

- thoughts/shared/research/2026-04-28-clinical-note-qc-pi-workflow.md — broader QC-flow research
- thoughts/shared/research/2026-04-29-qc-rule1-specificity-monotonicity.md — companion deep-dive on QC rule 1
- thoughts/shared/research/2026-04-30-icd10-7th-character-integrity-qc.md — companion deep-dive on the deterministic ICD-10 validator added in `bf1db91`

## Open Questions

- Whether rule 10's "any prognosis section" is intended to include `raw_ai_response.prognosis` (raw payload) or only the top-level surfaced `prognosis` string — current wording is ambiguous and depends on Claude's interpretation per call.
- Whether the audit-discoverability concern is intended to be addressed by a deterministic post-generation scrub of `raw_ai_response` (no such scrubber exists today) or by a redaction pass before the field is included in QC input.
