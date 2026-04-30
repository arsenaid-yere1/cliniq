# Forbidden-Phrase Prompt-Block Unification — Implementation Plan

## Overview

Centralize the forbidden-prognosis-phrase list as a single shared TS constant and inject the same `FORBIDDEN PHRASES (MANDATORY)` block into all three note generators (initial-visit, procedure, discharge) and the QC reviewer prompt. Closes the source of new `raw_ai_response` residue without mutating audit payloads.

## Current State Analysis

Source research: `thoughts/shared/research/2026-04-30-forbidden-phrase-scan-rule.md`.

- Procedure-note generator at [src/lib/claude/generate-procedure-note.ts:677](src/lib/claude/generate-procedure-note.ts#L677) carries an inline forbidden-phrase block targeting prognosis: `"full recovery is expected"`, `"complete resolution of symptoms"`, `"definitive healing"`, `"cure"`, `"guaranteed improvement"`.
- A second inline block at [src/lib/claude/generate-procedure-note.ts:501](src/lib/claude/generate-procedure-note.ts#L501) targets `procedure_prp_prep` with marketing phrases (`"regenerative capacity"`, `"tissue regeneration"`, etc.). Out of scope for this plan — different section, different intent.
- Initial-visit generator [src/lib/claude/generate-initial-visit.ts](src/lib/claude/generate-initial-visit.ts) has a `prognosis` field (line 261, 373, 430) but **no forbidden-phrase block**.
- Discharge generator [src/lib/claude/generate-discharge-note.ts](src/lib/claude/generate-discharge-note.ts) extensively templates `prognosis` (line 291, 304, 325, 366, 453-455, 479, 493) but **no forbidden-phrase block**.
- QC reviewer [src/lib/claude/generate-quality-review.ts:118](src/lib/claude/generate-quality-review.ts#L118) carries rule 10: `"complete resolution"`, `"full recovery"`, `"regenerative capacity"`. Three substrings, partial overlap with procedure-note list.
- No deterministic Node-side scanner anywhere.

Phrase-list union across the four call sites (de-duplicated to substrings, lowercase comparison): `"full recovery"`, `"complete resolution"`, `"definitive healing"`, `"cure"`, `"guaranteed improvement"`. Note: `"cure"` is risky as a substring (matches `"cured"`, `"curettage"`, etc.) — treat as word-boundaried in the prompt instruction. `"regenerative capacity"` stays scoped to its existing PRP-prep block, not added to the prognosis list.

## Desired End State

A single TS module exports `FORBIDDEN_PROGNOSIS_PHRASES` and a `forbiddenPrognosisPromptBlock()` template-builder. The procedure-note prompt's inline block, the initial-visit prompt, and the discharge prompt all reference the same constant. QC reviewer's rule 10 is rewritten to reference the same canonical list (kept as belt-and-suspenders detective layer; cost = zero).

Verification: grep across `src/lib/claude/` finds the canonical phrase strings in **one place only** (the new module). All four call sites import that module.

### Key Discoveries:
- Procedure-prep block at [generate-procedure-note.ts:501](src/lib/claude/generate-procedure-note.ts#L501) is intentionally a **separate** marketing-phrase block — leave alone.
- Discharge prognosis already carries elaborate tone-trajectory rules ([generate-discharge-note.ts:325-355](src/lib/claude/generate-discharge-note.ts#L325-L355)); the forbidden-phrase block must be inserted near the prognosis section spec, not at the top of the prompt, so Claude associates it with the right section.
- The reference template at [generate-discharge-note.ts:454-455](src/lib/claude/generate-discharge-note.ts#L454-L455) uses `"favorable"` / `"meaningful and sustained improvement"` — these stay; the forbidden block targets the absolute-claim phrases only.

## What We're NOT Doing

- No deterministic Node-side scanner. (Discussed and rejected in planning thread — prompt-only is the agreed scope.)
- No mutation of `raw_ai_response` at save time. Audit-payload integrity preserved.
- No backfill of historical `note_sessions.raw_ai_response`. If post-deploy monitoring shows residual hits in old rows, a one-shot SQL update can address that — out of scope here.
- No expansion of the `procedure_prp_prep` marketing-phrase block at [generate-procedure-note.ts:501](src/lib/claude/generate-procedure-note.ts#L501) — different section, different concern.
- No deletion of QC rule 10 at [generate-quality-review.ts:118](src/lib/claude/generate-quality-review.ts#L118). Keep as detective backup; rewrite to reference canonical list.

## Implementation Approach

Single phase. One new file (~30 LOC of constants + a string-builder), four call-site edits (three generators + QC review). No tests for prompt strings — verification is grep + manual generation runs.

---

## Phase 1: Centralize forbidden-phrase prompt block

### Overview

Create the constant module, then wire it into the four call sites.

### Changes Required:

#### 1. New module — single source of truth

**File**: `src/lib/qc/forbidden-phrases.ts` (new)

```ts
// Phrases the LLM must not emit in any prognosis section across all note
// types. Substrings are matched in case-insensitive prompt instructions;
// `cure` is the only substring that requires word-boundary framing because
// it collides with benign tokens (`cured`, `curettage`).
export const FORBIDDEN_PROGNOSIS_PHRASES = [
  'full recovery',
  'complete resolution',
  'definitive healing',
  'guaranteed improvement',
] as const

// `cure` listed separately so the prompt can word-boundary it.
export const FORBIDDEN_PROGNOSIS_WORD = 'cure' as const

// Render the canonical FORBIDDEN PHRASES (MANDATORY) block for embedding
// in any generator's prognosis-section prompt. Centralizing the wording
// keeps the four call sites byte-identical so QC review behavior is
// uniform across note types.
export function forbiddenPrognosisPromptBlock(): string {
  const quoted = FORBIDDEN_PROGNOSIS_PHRASES.map((p) => `"${p}"`).join(', ')
  return `FORBIDDEN PHRASES (MANDATORY) in prognosis — do NOT use any of the following anywhere in the prognosis section: ${quoted}, or the standalone word "${FORBIDDEN_PROGNOSIS_WORD}" used as a clinical claim. Prognosis language must remain measured. Use "guarded", "guarded-to-favorable", "favorable", "meaningful and sustained improvement", "anticipated long-term symptom control" instead.`
}
```

#### 2. Procedure-note generator — replace inline block

**File**: `src/lib/claude/generate-procedure-note.ts`

**Change**: Replace the inline string at line 677 with an interpolation of `forbiddenPrognosisPromptBlock()`. Add import at top of file.

```ts
// Add to imports near top of file
import { forbiddenPrognosisPromptBlock } from '@/lib/qc/forbidden-phrases'

// ... in the system prompt template-string near line 677, replace:
//   FORBIDDEN PHRASES (MANDATORY) in prognosis — do NOT use any of the following:
//   "full recovery is expected", "complete resolution of symptoms", ...
// with:
${forbiddenPrognosisPromptBlock()}
```

#### 3. Initial-visit generator — add block

**File**: `src/lib/claude/generate-initial-visit.ts`

**Change**: Add import. Insert `${forbiddenPrognosisPromptBlock()}` into the system prompt immediately after the prognosis-section spec at line 261.

```ts
import { forbiddenPrognosisPromptBlock } from '@/lib/qc/forbidden-phrases'

// In the system prompt, after line 261's prognosis description, add:
//
// 5. Prognosis: May reference the evolution from guarded-but-favorable (initial) to the current imaging-informed prognosis.
// ${forbiddenPrognosisPromptBlock()}
```

#### 4. Discharge generator — add block

**File**: `src/lib/claude/generate-discharge-note.ts`

**Change**: Add import. Insert `${forbiddenPrognosisPromptBlock()}` into the system prompt at the prognosis section spec — best location is immediately after the reference template at line 455 (the `"favorable prognosis"` reference example), so the block follows the model's positive exemplar with the absolute-claim prohibition.

```ts
import { forbiddenPrognosisPromptBlock } from '@/lib/qc/forbidden-phrases'

// In the system prompt, after line 455's reference example, add:
// ${forbiddenPrognosisPromptBlock()}
```

#### 5. QC review reviewer — rewrite rule 10 to reference canonical list

**File**: `src/lib/claude/generate-quality-review.ts`

**Change**: Replace the hardcoded three-phrase list at line 118 with an interpolation of the same constants, so detective layer and preventive prompts share a single source. Add import.

```ts
import {
  FORBIDDEN_PROGNOSIS_PHRASES,
  FORBIDDEN_PROGNOSIS_WORD,
} from '@/lib/qc/forbidden-phrases'

// Replace line 118:
//   10. Forbidden-phrase scan. "complete resolution", "full recovery", "regenerative capacity" in any prognosis section.
// with (interpolated into the SYSTEM_PROMPT template-string):
const FORBIDDEN_LIST_RENDERED = [
  ...FORBIDDEN_PROGNOSIS_PHRASES.map((p) => `"${p}"`),
  `"${FORBIDDEN_PROGNOSIS_WORD}"`,
].join(', ')
// 10. Forbidden-phrase scan. ${FORBIDDEN_LIST_RENDERED} in any prognosis section (surfaced or raw_ai_response.prognosis).
```

Note: `"regenerative capacity"` is dropped from the QC reviewer's rule 10 — that phrase belongs to the PRP-prep section block and is not a prognosis-section concern.

### Success Criteria:

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `npm run lint`
- [ ] Unit tests pass: `npm run test` (no new tests added — existing generator tests must still pass)
- [ ] Build succeeds: `npm run build`
- [ ] Single-source verification: `grep -rn '"full recovery"\|"complete resolution"\|"definitive healing"\|"guaranteed improvement"' src/` returns matches **only inside** `src/lib/qc/forbidden-phrases.ts`. Other source files reference the constant, not the literal.

#### Manual Verification:
- [ ] Generate one initial-visit note, one procedure note, one discharge note against a test case where the provider hint nudges toward optimistic phrasing. Inspect surfaced `prognosis` and `raw_ai_response.prognosis` for any of the forbidden substrings — none should appear.
- [ ] Run a QC review (`runCaseQualityReview`) on the same case. Reviewer's rule 10 still scans correctly with the rewritten phrasing.
- [ ] Existing generator regression: regenerate a known-good note from staging fixtures and confirm output structure unchanged (no schema drift from prompt edit).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before considering the work complete.

---

## Testing Strategy

### Unit Tests:
None. Prompt strings are not unit-testable in a meaningful way; the value is in the LLM's behavior at call time.

### Integration Tests:
Existing generator integration tests must continue to pass with no changes.

### Manual Testing Steps:
1. Generate an initial-visit note from a real case where the prior-note hint is "patient very optimistic, expects to go back to running". Confirm the model does not emit `"full recovery"` or `"complete resolution"` in the surfaced `prognosis` or in `raw_ai_response.prognosis`.
2. Repeat for procedure note (multi-procedure case, pick procedure #2) and discharge note.
3. Trigger a QC review on the same case. Confirm no rule-10 finding fires when the deterministic prompts already prevented the phrase upstream.
4. Edge case: if a model regression somehow emits `"full recovery"` post-prompt-fix, confirm rule 10 still catches it as a backup.

## Performance Considerations

None. Prompt-string constant is built once at module load. Negligible additional bytes per generation call.

## Migration Notes

No DB migration. No data backfill in scope. Historical `note_sessions.raw_ai_response` rows that already contain forbidden phrases remain — risk is hypothetical because the column is not rendered in any UI surface ([research §`raw_ai_response` storage and surface area](src/lib/qc/forbidden-phrases.ts)). If post-deploy monitoring identifies a render path that exposes those legacy rows, a one-shot SQL update can be authored separately.

## References

- Original review comment (verbatim): "Forbidden-phrase scan rule: 'full recovery' is not permitted in any prognosis section. Even though the surfaced prognosis was rewritten, leaving the phrase in raw_ai_response creates audit/discoverability risk if the raw is ever rendered."
- Source research: `thoughts/shared/research/2026-04-30-forbidden-phrase-scan-rule.md`
- Procedure-note inline block (template to mirror): [src/lib/claude/generate-procedure-note.ts:677](src/lib/claude/generate-procedure-note.ts#L677)
- QC reviewer rule 10 (to rewrite): [src/lib/claude/generate-quality-review.ts:118](src/lib/claude/generate-quality-review.ts#L118)
- Companion deterministic-validator pattern (reference for future scanner if monitoring justifies it): [src/lib/qc/diagnosis-validators.ts](src/lib/qc/diagnosis-validators.ts), wired in [src/actions/case-quality-reviews.ts:376-388](src/actions/case-quality-reviews.ts#L376-L388)
