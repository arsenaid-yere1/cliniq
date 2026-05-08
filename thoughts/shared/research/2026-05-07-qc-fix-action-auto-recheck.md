---
date: 2026-05-07T22:57:42Z
researcher: arsenaid
git_commit: 268fe73a98c8cf99dff7dbc9e7bb70ad1d5dd807
branch: main
repository: cliniq
topic: "Adding a Fix action in Quality Review that auto-fixes notes via AI and re-checks"
tags: [research, codebase, quality-review, qc, ai-fix, regeneration, findings]
status: complete
last_updated: 2026-05-07
last_updated_by: arsenaid
---

# Research: Adding a Fix action in Quality Review that auto-fixes notes via AI and re-checks

**Date**: 2026-05-07T22:57:42Z
**Researcher**: arsenaid
**Git Commit**: 268fe73a98c8cf99dff7dbc9e7bb70ad1d5dd807
**Branch**: main
**Repository**: cliniq

## Research Question

How can we add a Fix action in Quality Review. The user wants AI to fix the notes automatically and then re-check the fix.

This research documents the **current state** of the Quality Review system and the AI note regeneration system — the two pieces a Fix action would compose. It does not propose a design; it maps the existing surfaces a Fix action would plug into.

## Summary

Quality Review (QC) and note regeneration are already separate, well-isolated systems that share no direct call path today. A finding in QC carries enough metadata (`step`, `note_id`, `procedure_id`, `section_key`, `message`, `rationale`, `suggested_tone_hint`) to identify the note and the section it concerns. The AI regeneration layer already exposes single-section regenerate actions (`regenerateNoteSection`, `regenerateDischargeNoteSectionAction`, `regenerateProcedureNoteSectionAction`) that accept a section key, current content, tone hint, and the other-sections context map. Both layers persist `source_data_hash` over the same `gatherSourceData` payload, and QC already has a recheck flow (`runCaseQualityReview`) plus a per-finding verify flow (`verifyFinding`) and a staleness flag.

The pieces that exist today:

- **Finding identity** — every finding hashes (severity|step|note_id|procedure_id|section_key|message) into a stable `findingHash` used as the key into `case_quality_reviews.finding_overrides`.
- **Override status enum** — `'acknowledged' | 'dismissed' | 'edited' | 'resolved'`. There is no `'fixing'` or `'fix_applied'` value.
- **`suggested_tone_hint`** — every finding can carry a string the provider can paste into the editor's tone-hint field; this field exists for exactly this purpose.
- **Section regen surface** — three server actions accept `(section, currentContent, toneHint, otherSections)` and update only that section in DB.
- **Recheck** — `runCaseQualityReview` re-runs the whole chain-aware QC and carries forward `resolved` overrides; entries whose hash disappears flip to `resolution_source: 'auto_recheck'`.
- **Per-finding verify** — `verifyFinding` already implements a per-finding "did this finding go away?" pattern, but only for findings with deterministic validators (`_qc_external_cause_chain`, `_qc_seventh_character_integrity`) or for `step` ∈ {procedure, discharge} with specific column checks. AI-authored findings on other steps are explicitly rejected and routed to `markFindingResolved`.

The gap a Fix action would bridge:

- No code path today connects a finding to a regenerate call.
- The regeneration layer takes a free-text `toneHint`; it has no concept of "fix this finding" — there is no first-class instruction parameter for a structured fix request.
- Section regen only touches one section, but a finding may target multiple sections (or `cross_step` / `case_summary` findings have no single section anchor).
- `verifyFinding` does not run AI; it is deterministic-only. A post-fix recheck would either reuse `runCaseQualityReview` (full chain) or extend `verifyFinding` semantics.

## Detailed Findings

### 1. QC Data Model — what a finding tells you

**File:** `/Users/macbookpro/Coding/cliniq/src/lib/validations/case-quality-review.ts:26-35`

`qualityFindingSchema` fields:

| Field | Type | Use for Fix |
|---|---|---|
| `severity` | `'info' \| 'warning' \| 'critical'` | UI gating for which findings get the Fix button |
| `step` | `'initial_visit' \| 'pain_evaluation' \| 'procedure' \| 'discharge' \| 'case_summary' \| 'cross_step'` | Routes to which note-type regenerator |
| `note_id` | `uuid \| null` | Identifies the row to update |
| `procedure_id` | `uuid \| null` | Required when `step === 'procedure'` |
| `section_key` | `string \| null` | Names the target section; null on `cross_step` |
| `message` | `string` | The finding text |
| `rationale` | `string \| null` | Why it is a finding |
| `suggested_tone_hint` | `string \| null` | Provider-paste guidance — already designed to drive a fix-style regen |

**Synthetic section keys:** deterministic validators emit `_qc_external_cause_chain` and `_qc_seventh_character_integrity` as `section_key` values. These do not match any real note section column. Source: `/Users/macbookpro/Coding/cliniq/src/lib/qc/diagnosis-validators.ts:34-206`.

**Real section keys:** match the column names produced by note generators:
- Initial visit: 16 sections (`introduction`, `history_of_accident`, …, `clinician_disclaimer`) — `/Users/macbookpro/Coding/cliniq/src/lib/validations/initial-visit-note.ts:49-66`
- Discharge: 12 sections (`subjective`, `objective_vitals`, …, `clinician_disclaimer`) — `/Users/macbookpro/Coding/cliniq/src/lib/validations/discharge-note.ts:36-49`
- Procedure: 20 sections (`subjective`, `past_medical_history`, …, `clinician_disclaimer`) — `/Users/macbookpro/Coding/cliniq/src/lib/validations/procedure-note.ts:52-73`

Section-regen action signatures already accept these section literals as the `section` param.

### 2. Finding Hash & Override Storage

**Hash function** — `/Users/macbookpro/Coding/cliniq/src/lib/validations/case-quality-review.ts:101-111`

```
SHA-256(`${severity}|${step}|${note_id}|${procedure_id}|${section_key}|${message}`)
```

Stable across regenerations: if Claude (or the deterministic validators) re-emit the *same* finding, it gets the same hash, and a Fix action could detect "still here" or "now gone".

**Override entry shape** — `/Users/macbookpro/Coding/cliniq/src/lib/validations/case-quality-review.ts:62-79`

```
status: 'acknowledged' | 'dismissed' | 'edited' | 'resolved'
dismissed_reason: string | null
edited_message: string | null
edited_rationale: string | null
edited_suggested_tone_hint: string | null
actor_user_id: uuid
set_at: ISO8601
resolved_at: string | null
resolution_source: 'auto_recheck' | 'manual_verify' | 'manual_resolve' | null
```

There is no field to record "AI fix applied" today. A Fix action would either reuse `status: 'resolved'` with a new `resolution_source` value, or introduce a new status.

**Storage column** — `/Users/macbookpro/Coding/cliniq/supabase/migrations/20260504_case_quality_reviews.sql:16` — `finding_overrides jsonb not null default '{}'`. Written via `update` of a single hash key by every override mutator.

### 3. Existing Override Mutators — pattern a Fix action would follow

**File:** `/Users/macbookpro/Coding/cliniq/src/actions/case-quality-reviews.ts`

All five share the shape: load active review → merge one hash entry → write back → revalidatePath.

| Action | Lines | Status written |
|---|---|---|
| `acknowledgeFinding` | 527-563 | `'acknowledged'` |
| `dismissFinding` | 565-608 | `'dismissed'` (carries `dismissed_reason`) |
| `editFinding` | 610-653 | `'edited'` (carries edited fields) |
| `clearFindingOverride` | 655-678 | deletes hash key (back to pending) |
| `markFindingResolved` | 819-854 | `'resolved'` + `resolution_source: 'manual_resolve'` |
| `verifyFinding` | 688-817 | `'resolved'` + `resolution_source: 'manual_verify'` (only deterministic + procedure plan-alignment + discharge trajectory-warnings paths) |

`verifyFinding` has the most detailed dispatch logic and is the closest existing analog to "check the fix":
- `section_key === '_qc_external_cause_chain'` → re-runs `validateExternalCauseChain`, checks if hash still present (lines 717-743)
- `section_key === '_qc_seventh_character_integrity'` → re-runs `validateSeventhCharacterIntegrity` (same pattern)
- `step === 'procedure'` → reads `procedure_notes.plan_alignment_status` ≠ `'unplanned'` (lines 744-760)
- `step === 'discharge'` → reads `discharge_notes.raw_ai_response.trajectory_warnings` empty (lines 761-783)
- All other AI findings (initial_visit, pain_evaluation, case_summary, cross_step) → returns error, directs to `markFindingResolved` (lines 784-789)

### 4. Recheck — `runCaseQualityReview`

**File:** `/Users/macbookpro/Coding/cliniq/src/actions/case-quality-reviews.ts:279-448`

Flow:
1. Auth + closed-case guard
2. `gatherSourceData` (12 concurrent queries assembling `QualityReviewInputData`)
3. Capture prior overrides from active row
4. Soft-delete active row
5. Insert new row, `generation_status: 'processing'`, `sections_total: 3`
6. Call `generateQualityReviewFromData` → Claude Opus 4.7, 16k tokens, tool `generate_case_quality_review`
7. Merge deterministic validator output (validators win on hash collisions)
8. Write findings + summary + assessment + `source_data_hash`
9. **Carry-over override merge** (lines 419-445):
   - `resolved` entries → kept verbatim (so a manually-resolved finding stays resolved)
   - Entries whose hash appears in new findings → kept (the issue is still there, override persists)
   - Entries whose hash is absent from new findings → flipped to `status: 'resolved', resolution_source: 'auto_recheck'`

This carry-over logic is exactly the "did the fix work?" check, applied across the whole finding set in one pass. A Fix action that calls regenerate then `runCaseQualityReview` would automatically get auto-recheck behavior on its targeted finding (gone → `auto_recheck`) without any new code.

**Cost:** every recheck reads 12 tables, builds the full `QualityReviewInputData`, calls Claude Opus with 16k tokens, and runs all deterministic validators. There is no targeted-recheck path today.

### 5. Staleness Detection

**File:** `/Users/macbookpro/Coding/cliniq/src/actions/case-quality-reviews.ts:475-496`

`checkQualityReviewStaleness` re-runs `gatherSourceData` and SHA-256s the JSON. If the hash differs from the stored `source_data_hash`, returns `isStale: true`. The QC page passes this to `QcReviewPanel` which renders a "Stale" badge next to the Recheck button (`/Users/macbookpro/Coding/cliniq/src/components/clinical/qc-review-panel.tsx:277`).

A Fix action that mutates a note via regeneration would invalidate the hash and trigger this staleness flag automatically.

### 6. AI Note Regeneration — already exposes section regen

#### Initial visit
**Action:** `regenerateNoteSection(caseId, visitType, section)` — `/Users/macbookpro/Coding/cliniq/src/actions/initial-visit-notes.ts:798`
**Generator:** `regenerateSection(inputData, visitType, section, currentContent, toneHint, otherSections)` — `/Users/macbookpro/Coding/cliniq/src/lib/claude/generate-initial-visit.ts:638`
**DB write:** `UPDATE` only `[section]` and `raw_ai_response` columns.
**Tone hint:** read from the draft row's `tone_hint` column.

#### Discharge
**Action:** `regenerateDischargeNoteSectionAction(caseId, section)` — `/Users/macbookpro/Coding/cliniq/src/actions/discharge-notes.ts:1042`
**Generator:** `regenerateDischargeNoteSection(inputData, section, currentContent, toneHint, otherSections)` — `/Users/macbookpro/Coding/cliniq/src/lib/claude/generate-discharge-note.ts:556`
**DB write:** two-step — section text first, then `refreshDischargeTrajectory` rebuilds trajectory columns + `raw_ai_response` wrapper.
**Tone hint:** read from draft row.

#### Procedure
**Action:** `regenerateProcedureNoteSectionAction(procedureId, caseId, section)` — `/Users/macbookpro/Coding/cliniq/src/actions/procedure-notes.ts:1018`
**Generator:** `regenerateProcedureNoteSection(inputData, section, currentContent, toneHint, otherSections)` — `/Users/macbookpro/Coding/cliniq/src/lib/claude/generate-procedure-note.ts:796`
**DB write:** `UPDATE` only `[section]` and `raw_ai_response`.
**Tone hint:** read from draft row.

### 7. How Tone Hint flows from finding → regen

The `suggested_tone_hint` field on a finding is a free-text string. It is currently surface-only — displayed in `FindingCard` (`/Users/macbookpro/Coding/cliniq/src/components/clinical/qc-review-panel.tsx:398-642`) and editable through `FindingEditDialog` (`/Users/macbookpro/Coding/cliniq/src/components/clinical/finding-edit-dialog.tsx:19-104`) into `override.edited_suggested_tone_hint`.

There is no current code path that copies the finding's tone hint into a regen call. The provider does this manually: open the finding → copy hint → navigate to note via deep link → paste into Tone & Direction card → press Regenerate.

The `findingDeepLink` map (`qc-review-panel.tsx:88-105`) is the existing navigation layer:
- `initial_visit` / `pain_evaluation` → `/patients/${caseId}/initial-visit`
- `procedure` → `/patients/${caseId}/procedures/${procedure_id}/note`
- `discharge` → `/patients/${caseId}/discharge`
- `case_summary` / `cross_step` → `/patients/${caseId}`

### 8. UI: where Fix would sit in `FindingCard`

**File:** `/Users/macbookpro/Coding/cliniq/src/components/clinical/qc-review-panel.tsx:398-642`

Current per-status button set:

| Status | Buttons |
|---|---|
| `pending` | Acknowledge, Edit, Dismiss, Verify (if step ∈ {procedure, discharge}), Mark Resolved |
| `acknowledged` / `edited` | Verify (if applicable), Mark Resolved, Undo |
| `dismissed` | Undo |
| `resolved` | None |

`isLocked` (from `CaseStatusContext`) suppresses all action buttons when the case is closed. A Fix button would need the same lock check.

`isVerifiable` is `step ∈ {'procedure', 'discharge'}` (line 49). The Verify button uses this to gate; a Fix button has different applicability — any AI-targeted note section is fixable, but `cross_step`, `case_summary`, and synthetic-section findings have no single regenerable target.

### 9. Tool/Schema constraints on regeneration

`SECTION_REGEN_TOOL` is the same shape across all three note types — `/Users/macbookpro/Coding/cliniq/src/lib/claude/generate-initial-visit.ts:623-636`, `generate-discharge-note.ts:541-554`, `generate-procedure-note.ts:781-794`:

```
name: 'regenerate_section'
input_schema: { content: string }
```

The user message into the section regen call follows this template (initial-visit example, line 664):

```
Regenerate the "${sectionLabel}" section...

Current content of this section:
${currentContent}

OTHER SECTIONS CURRENTLY PRESENT:
${otherSectionsBlock}

Full case data:
${JSON.stringify(inputData, null, 2)}
```

The `toneHint` is appended after this in the same user message: `"ADDITIONAL TONE/DIRECTION GUIDANCE FROM THE PROVIDER:\n${toneHint}"`.

There is currently no parameter or message slot reserved for "this is a QC finding to fix" — it would either travel as additional tone-hint text (zero new wiring) or via a new generator parameter (e.g. `findingFix?: { message, rationale }`).

### 10. Concurrency & State during regeneration

- **Initial visit + Procedure** acquire a `generation_lock` (`/Users/macbookpro/Coding/cliniq/src/lib/supabase/generation-lock.ts`) and set `status: 'generating'`. While in this state, the editor UI shows a generating skeleton.
- **Discharge** uses a soft-delete + insert pattern with a 5-minute stale guard (no DB-level lock).
- **QC** has its own `generation_status: 'processing' | 'completed' | 'failed'` lifecycle on the `case_quality_reviews` row, with realtime subscriptions in `GeneratingProgress`.

A Fix action would need to coordinate three states: note row in `generating`, QC row eventual recheck, and the finding's UI row showing in-progress. None of these coordination paths exist today; they are independent state machines.

### 11. Cross-step / case-summary findings — no single-target anchor

Findings with `step === 'cross_step'` or `'case_summary'` have:
- `note_id: null` (always for `cross_step`)
- `section_key` may be null
- No single note row to regenerate

These findings are produced by the QC system prompt's checks for plan continuity, NO CLONE, and provider intake echo (`/Users/macbookpro/Coding/cliniq/src/lib/claude/generate-quality-review.ts:102-134`). They name two notes implicitly through their `message` text, not through structured fields.

A Fix action that auto-fixes would not be able to pick a single regen target for these findings without provider input or a multi-section regen primitive (which does not exist).

### 12. Synthetic-section findings — also not directly regenerable

Findings from `validateExternalCauseChain` and `validateSeventhCharacterIntegrity` use `section_key` values `_qc_external_cause_chain` / `_qc_seventh_character_integrity`. These are routing sentinels for `verifyFinding`, not real note section column names. Regenerating "the diagnoses section" of the named note via existing section regen would be the closest match, but the mapping is not encoded today.

### 13. Where progress + audit live

- **Note progress:** `sections_done` / `sections_total` columns on each note table; written by `writeProgress` closures throttled to 500ms during generation.
- **QC progress:** same columns on `case_quality_reviews`; `sections_total: 3` for QC (see `QUALITY_REVIEW_SECTIONS_TOTAL` at `/Users/macbookpro/Coding/cliniq/src/lib/claude/generate-quality-review.ts:100`).
- **Audit:** every regen merges into `raw_ai_response` JSONB. No per-finding audit ledger today (no `qc_finding_fix_attempts` table or similar).

## Code References

- `/Users/macbookpro/Coding/cliniq/src/lib/validations/case-quality-review.ts:26-35` — finding shape
- `/Users/macbookpro/Coding/cliniq/src/lib/validations/case-quality-review.ts:62-79` — override entry shape
- `/Users/macbookpro/Coding/cliniq/src/lib/validations/case-quality-review.ts:101-111` — `computeFindingHash`
- `/Users/macbookpro/Coding/cliniq/src/actions/case-quality-reviews.ts:279-448` — `runCaseQualityReview` (recheck + carry-over)
- `/Users/macbookpro/Coding/cliniq/src/actions/case-quality-reviews.ts:475-496` — staleness check
- `/Users/macbookpro/Coding/cliniq/src/actions/case-quality-reviews.ts:498-854` — five override mutators (template for Fix)
- `/Users/macbookpro/Coding/cliniq/src/actions/case-quality-reviews.ts:688-817` — `verifyFinding` (closest analog to per-finding recheck)
- `/Users/macbookpro/Coding/cliniq/src/actions/initial-visit-notes.ts:798-892` — `regenerateNoteSection`
- `/Users/macbookpro/Coding/cliniq/src/actions/discharge-notes.ts:1042-1120` — `regenerateDischargeNoteSectionAction`
- `/Users/macbookpro/Coding/cliniq/src/actions/procedure-notes.ts:1018-1078` — `regenerateProcedureNoteSectionAction`
- `/Users/macbookpro/Coding/cliniq/src/lib/claude/generate-initial-visit.ts:638-680` — `regenerateSection` generator
- `/Users/macbookpro/Coding/cliniq/src/lib/claude/generate-discharge-note.ts:556-590` — `regenerateDischargeNoteSection` generator
- `/Users/macbookpro/Coding/cliniq/src/lib/claude/generate-procedure-note.ts:796-830` — `regenerateProcedureNoteSection` generator
- `/Users/macbookpro/Coding/cliniq/src/lib/claude/generate-quality-review.ts:100-186` — `QUALITY_REVIEW_SECTIONS_TOTAL`, `REVIEW_TOOL` schema
- `/Users/macbookpro/Coding/cliniq/src/lib/qc/diagnosis-validators.ts:34-206` — deterministic validators that emit synthetic-section findings
- `/Users/macbookpro/Coding/cliniq/src/lib/qc/forbidden-phrases.ts:5-11` — `FORBIDDEN_PROGNOSIS_PHRASES`
- `/Users/macbookpro/Coding/cliniq/src/components/clinical/qc-review-panel.tsx:88-105` — `findingDeepLink` (step → URL)
- `/Users/macbookpro/Coding/cliniq/src/components/clinical/qc-review-panel.tsx:398-642` — `FindingCard` (where a Fix button would render)
- `/Users/macbookpro/Coding/cliniq/src/components/clinical/finding-edit-dialog.tsx:19-104` — pattern for a dialog that mutates an override
- `/Users/macbookpro/Coding/cliniq/supabase/migrations/20260504_case_quality_reviews.sql` — `case_quality_reviews` table DDL

## Architecture Documentation

### Current architecture

```
                            ┌────────────────────────────────────┐
                            │  case_quality_reviews table        │
                            │  - findings: jsonb (immutable      │
                            │    after generation)               │
                            │  - finding_overrides: jsonb        │
                            │    (sidecar, hash-keyed)           │
                            │  - source_data_hash                │
                            │  - generation_status               │
                            └────────────────────────────────────┘
                                          ▲
                                          │ writes
   ┌──────────────────────────────────────┼─────────────────────────────┐
   │                                      │                             │
runCaseQualityReview              5 override mutators           verifyFinding
(full chain recheck)              (acknowledge, dismiss,        (deterministic
                                   edit, clear, mark            re-run + 2 column
                                   resolved)                    checks only)

   ▲
   │ calls
   │
generateQualityReviewFromData   ──── Claude Opus 4.7 ────  REVIEW_TOOL
                                                          (10 cross-cutting checks
                                                           + forbidden-phrase scan)
   ▲
   │ assembles
   │
gatherSourceData (12 concurrent queries)


╔════════════════════════════════════════════════════════════════════════════════╗
║                  Note generation/regeneration — separate world                ║
╠════════════════════════════════════════════════════════════════════════════════╣
║ initial_visit_notes   ◄─── generateInitialVisitNote / regenerateNoteSection   ║
║ discharge_notes       ◄─── generateDischargeNote   / regenerateDischargeNote..║
║ procedure_notes       ◄─── generateProcedureNote   / regenerateProcedureNote..║
║                                                                                ║
║ Each section regen action:                                                    ║
║   (caseId/procedureId, [section]) → reads draft + sources                     ║
║                                  → Claude Opus 4.6, 4k tokens                 ║
║                                  → SECTION_REGEN_TOOL { content: string }     ║
║                                  → UPDATE [section] + raw_ai_response         ║
╚════════════════════════════════════════════════════════════════════════════════╝
```

### Gaps a Fix flow would compose across

1. **Finding → regenerator routing** — `step` already maps to a note type, but no code performs this dispatch. `findingDeepLink` does the equivalent for *navigation* but not for *invocation*.
2. **Finding → section dispatch** — `section_key` values for AI findings are real column names; for deterministic findings they are sentinels; for `cross_step`/`case_summary` they are null. Three different cases, no unified handler.
3. **Tone-hint plumbing** — `finding.suggested_tone_hint` exists for this purpose, but the path from finding to `regenerateSectionAI`'s `toneHint` parameter is not wired today.
4. **Per-finding recheck** — `verifyFinding` covers two deterministic paths and two column-shape paths. AI findings on initial-visit/pain-eval/case-summary/cross-step are explicitly out of scope. A post-fix recheck of an AI finding currently requires `runCaseQualityReview` (full chain).
5. **Status vocabulary** — no `'fixing'` (in-progress) or `'fix_applied'` value in the override status enum. Today the closest is `'edited'` (manual provider edit) and `'resolved'`.

## Related Research

- `/Users/macbookpro/Coding/cliniq/thoughts/shared/research/2026-04-28-clinical-note-qc-pi-workflow.md` — original QC workflow research
- `/Users/macbookpro/Coding/cliniq/thoughts/shared/plans/2026-04-28-case-quality-review-agent.md` — original QC agent plan
- `/Users/macbookpro/Coding/cliniq/thoughts/shared/plans/2026-04-30-qc-finding-resolution-layer.md` — finding resolution layer plan (added the override mutators)
- `/Users/macbookpro/Coding/cliniq/thoughts/shared/research/2026-04-30-icd10-7th-character-integrity-qc.md` — deterministic validator research
- `/Users/macbookpro/Coding/cliniq/thoughts/shared/research/2026-04-19-tone-direction-for-procedure-and-discharge-notes.md` — tone hint integration research

## Open Questions

These were not answered by the research because they are design decisions, not facts about the current code:

1. Which finding subset is fixable? AI-authored findings on `initial_visit` / `pain_evaluation` / `procedure` / `discharge` with a real `section_key` are the natural fit. Deterministic synthetic-section findings, `cross_step`, and `case_summary` need separate decisions.
2. Should the fix call section-regen (single section) or full-note-regen? Section regen is cheaper (4k tokens) and surgical; full regen rewrites all sections from source data and clears overrides.
3. Should the fix pass `finding.message` + `finding.rationale` as a *new* generator parameter, or smuggle them through `toneHint`? Current code only knows `toneHint`.
4. Should the recheck after fix be a full `runCaseQualityReview` (works today, expensive) or a targeted "did this hash disappear?" pass (would extend `verifyFinding`)?
5. Should the override status grow a `'fixing'` in-progress value, or piggy-back on the note-level `generation_lock`?
