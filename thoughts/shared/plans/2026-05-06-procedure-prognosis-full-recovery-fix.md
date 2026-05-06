# Procedure Prognosis "Full Recovery" Fix — Implementation Plan

## Overview

Drop the bare-substring `Full recovery` from the procedure-note guarded prognosis reference template, then swap the canonical `FORBIDDEN_PROGNOSIS_PHRASES` list from claim-form (`'full recovery is expected'`) to bare substring (`'full recovery'`). Closes the QC reviewer flag on Procedure #1's prognosis (`'full recovery'` flagged as overpromising clinical-claim language) and aligns both preventive and detective tiers around the same literal.

## Current State Analysis

Per source research at [thoughts/shared/research/2026-05-06-procedure-prognosis-full-recovery-residue.md](thoughts/shared/research/2026-05-06-procedure-prognosis-full-recovery-residue.md):

- Canonical list at [src/lib/qc/forbidden-phrases.ts:6-12](src/lib/qc/forbidden-phrases.ts#L6-L12) stores `'full recovery is expected'` (claim-form). Header comment at [:1-5](src/lib/qc/forbidden-phrases.ts#L1-L5) explicitly chose claim-form to avoid colliding with procedure-note guarded reference template.
- Procedure-note guarded reference at [src/lib/claude/generate-procedure-note.ts:678](src/lib/claude/generate-procedure-note.ts#L678) literally contains `"Due to the chronic nature of the injury, the prognosis is guarded. Full recovery depends on the patient's response to PRP therapy and adherence to the prescribed rehabilitation program."` Procedure #1 → `paintoneLabel = baseline` → routes to this template → `Full recovery` lands in surfaced `prognosis` and `raw_ai_response.prognosis`.
- QC reviewer rule 10 at [src/lib/claude/generate-quality-review.ts:123](src/lib/claude/generate-quality-review.ts#L123) interpolates the canonical list. Reviewer Claude flags the bare-substring occurrence in Procedure #1 even though the canonical list scopes to claim-form — LLM judgment over `"as clinical-claim language"` framing.
- Test assertion at [src/lib/claude/__tests__/generate-procedure-note.test.ts:274](src/lib/claude/__tests__/generate-procedure-note.test.ts#L274) explicitly checks the system prompt contains the literal `'full recovery is expected'`. Must update when swapping list to bare substring.
- Other prognosis call sites (initial-visit, discharge) do not carry the bare `Full recovery` substring in their reference templates.

Grep across `src/` and `supabase/` for `full recovery` / `Full recovery` (case variants):

- [src/lib/claude/generate-procedure-note.ts:678](src/lib/claude/generate-procedure-note.ts#L678) — guarded reference template (target of edit)
- [src/lib/qc/forbidden-phrases.ts:3](src/lib/qc/forbidden-phrases.ts#L3) — header comment text (collision-avoidance rationale, will rewrite)
- [src/lib/qc/forbidden-phrases.ts:7](src/lib/qc/forbidden-phrases.ts#L7) — canonical list entry (target of edit)
- [src/lib/claude/__tests__/generate-procedure-note.test.ts:274](src/lib/claude/__tests__/generate-procedure-note.test.ts#L274) — test assertion (target of edit)
- [src/actions/procedure-notes.ts:1060](src/actions/procedure-notes.ts#L1060) — descriptive comment in regen path citing `"Full recovery"` as example forbidden output (non-load-bearing prose; optional refresh)

No other matches in source or migrations.

## Desired End State

After this plan:

- Procedure-note guarded prognosis reference uses measured language with no `Full recovery` substring. New procedure notes generated under `paintoneLabel ∈ {baseline, stable, worsened}` no longer emit `Full recovery` in surfaced `prognosis` or `raw_ai_response.prognosis`.
- Canonical `FORBIDDEN_PROGNOSIS_PHRASES` list at `src/lib/qc/forbidden-phrases.ts` contains bare-substring `'full recovery'` (claim-form entry removed). Header comment rewritten to drop the now-stale collision-avoidance rationale.
- QC reviewer rule 10 sees the bare substring in `FORBIDDEN_LIST_RENDERED` (interpolation already in place — no edit to `generate-quality-review.ts` needed). Reviewer scans uniformly across surfaced and raw payloads.
- Test assertion updated to check for the bare substring `'full recovery'` instead of the claim-form `'full recovery is expected'`.
- Single-source verification: `grep -rn "full recovery\|Full recovery" src/ supabase/` returns matches **only** in `src/lib/qc/forbidden-phrases.ts` (canonical list + header comment) and `src/lib/claude/__tests__/generate-procedure-note.test.ts` (updated assertion). No matches in any generator file or reference template.

### Key Discoveries:

- Procedure #1 wording is structurally inevitable under current prompt logic — fix must be at the reference template, not at the prompt FORBIDDEN block alone (the FORBIDDEN block sits *after* the template in the system prompt, so Claude reproduces template language despite the block).
- Discharge-branch reference at [generate-procedure-note.ts:679](src/lib/claude/generate-procedure-note.ts#L679) contains `"Continued recovery depends..."` — bare word `recovery` is **not** in the canonical list and stays. Only `Full recovery` substring is the concern.
- `'cure'` entry in the canonical list at [forbidden-phrases.ts:11](src/lib/qc/forbidden-phrases.ts#L11) has documented word-boundary risk (collides with `cured`, `curettage`) per prior plan `2026-04-30-forbidden-phrase-prompt-fix.md` §"Current State Analysis". Out of scope for this plan — leaving the existing entry alone.
- Test at [generate-procedure-note.test.ts:271-275](src/lib/claude/__tests__/generate-procedure-note.test.ts#L271-L275) is the **only** test asserting specific phrases from the canonical list. Other tests (L211, L260, L266) check for the literal `FORBIDDEN PHRASES (MANDATORY)` block-header substring — those keep passing without edits.
- Comment at [src/actions/procedure-notes.ts:1060](src/actions/procedure-notes.ts#L1060) cites `"Full recovery"` as an example of forbidden-phrase output. Remains accurate after the fix (it is exactly the kind of residue the regen-merge logic is designed to clear from `raw_ai_response`). Optional cosmetic refresh; not required for behavior.

## What We're NOT Doing

- **No deterministic Node-side scrubber.** Same scope decision as prior plan `2026-04-30-forbidden-phrase-prompt-fix.md`. Two-tier LLM-mediated enforcement remains.
- **No backfill of existing `procedure_notes.prognosis` rows or `note_sessions.raw_ai_response` jsonb.** The regen-merge logic at [procedure-notes.ts:1058-1067](src/actions/procedure-notes.ts#L1058-L1067) already clears the residue when a provider regenerates the section. A one-shot SQL UPDATE could be authored separately if monitoring shows the column getting rendered.
- **No edit to the discharge-branch reference at [generate-procedure-note.ts:679](src/lib/claude/generate-procedure-note.ts#L679)** (`"Continued recovery depends on..."`). Bare word `recovery` is not in the canonical list and reads as measured continuation, not absolute claim.
- **No edit to initial-visit or discharge generators.** Their prognosis reference templates do not contain the `Full recovery` substring.
- **No edit to `generate-quality-review.ts`.** It already interpolates the canonical list via `FORBIDDEN_LIST_RENDERED`. The list swap propagates automatically.
- **No change to `'cure'` entry word-boundary handling.** Documented risk, out of scope for this plan.
- **No new tests added.** Existing test at L271-275 covers the FORBIDDEN-block presence and a load-bearing phrase from the list.

## Implementation Approach

Single phase. Three file edits (one source, one canonical-list module, one test). Optional fourth edit (descriptive comment) deferred to discretion. No migrations. No new dependencies.

Edit ordering inside the phase: list swap first, then template rewrite, then test update. This ordering keeps the prompt-builder consistent at every intermediate state — at no point does the test pass against a stale literal.

---

## Phase 1: Drop bare substring from template + swap canonical list

### Overview

Three coordinated edits across two source files plus one test.

### Changes Required:

#### 1. Canonical list module — swap claim-form to bare substring + rewrite header comment

**File**: `src/lib/qc/forbidden-phrases.ts`

**Changes**:
- Replace the entry `'full recovery is expected'` with `'full recovery'`.
- Rewrite the header comment: drop the collision-avoidance rationale (no longer applicable), keep the cross-note-type scope statement and the `'cure'` substring caveat.

```ts
// Phrases the LLM must not emit anywhere in any prognosis section across
// all note types. Substrings are matched in case-insensitive prompt
// instructions; `cure` is the only entry that requires word-boundary
// framing because it collides with benign tokens (`cured`, `curettage`).
export const FORBIDDEN_PROGNOSIS_PHRASES = [
  'full recovery',
  'complete resolution of symptoms',
  'definitive healing',
  'guaranteed improvement',
  'cure',
] as const

// Render the canonical FORBIDDEN PHRASES (MANDATORY) block for embedding
// in any generator's prognosis-section prompt. Centralizing the wording
// keeps the call sites byte-identical so QC review behavior is uniform
// across note types.
export function forbiddenPrognosisPromptBlock(): string {
  const quoted = FORBIDDEN_PROGNOSIS_PHRASES.map((p) => `"${p}"`).join(', ')
  return `FORBIDDEN PHRASES (MANDATORY) in prognosis — do NOT use any of the following anywhere in the prognosis section: ${quoted}. Prognosis language must remain measured. Use "guarded", "guarded-to-favorable", "favorable", "meaningful and sustained improvement", "anticipated long-term symptom control" instead.`
}
```

Two notable wording shifts in the prompt-block string:
- `"as a clinical claim about expected outcome"` → `"anywhere in the prognosis section"`. The previous framing was the LLM-judgment escape hatch that left the bare-substring template prose ambiguous; the new framing is unambiguous bare-substring.
- The `cure` word-boundary caveat is left to the comment, not the prompt — Claude is expected to apply the substitution-list common sense already encoded in the `Use ... instead` clause.

#### 2. Procedure-note generator — rewrite guarded reference template

**File**: `src/lib/claude/generate-procedure-note.ts`

**Change**: Edit line 678. Replace the guarded reference sentence to drop `Full recovery`. Use measured-language exemplar that mirrors the substitution suggestions from the FORBIDDEN block (`"meaningful and sustained improvement"`).

Before (line 678):
```
Reference (guarded — for baseline/stable/worsened): "Due to the chronic nature of the injury, the prognosis is guarded. Full recovery depends on the patient's response to PRP therapy and adherence to the prescribed rehabilitation program."
```

After:
```
Reference (guarded — for baseline/stable/worsened): "Due to the chronic nature of the injury, the prognosis is guarded. Meaningful and sustained symptom control depends on the patient's response to PRP therapy and adherence to the prescribed rehabilitation program."
```

The structural elements that remain (and intentionally stay):
- Lead clause `"Due to the chronic nature of the injury, the prognosis is guarded."` — load-bearing tone anchor.
- Trailing dependency clause `"depends on the patient's response to PRP therapy and adherence to the prescribed rehabilitation program."` — load-bearing rehab-and-adherence framing.
- Only the noun phrase swaps: `Full recovery` → `Meaningful and sustained symptom control`.

#### 3. Test assertion — update literal

**File**: `src/lib/claude/__tests__/generate-procedure-note.test.ts`

**Change**: Edit line 274.

Before:
```ts
expect(system).toContain('full recovery is expected')
```

After:
```ts
expect(system).toContain('full recovery')
```

Surrounding test context (L271-276) is unchanged. The assertion still spot-checks a load-bearing phrase from the canonical list; only the literal updates.

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: implicit via `npm run build` (no standalone `typecheck` script in package.json — Next.js build runs `tsc`)
- [x] Linting passes: `npm run lint` (0 errors; 39 pre-existing warnings in untouched test files)
- [x] Unit tests pass: `npm run test` (64 files / 1045 tests pass)
- [x] Build succeeds: `npm run build` (compile + TypeScript + static gen all clean)
- [x] Single-source grep: `grep -rn "full recovery\|Full recovery" src/ supabase/` returns matches **only** in `src/lib/qc/forbidden-phrases.ts:6` (canonical list entry), `src/lib/claude/__tests__/generate-procedure-note.test.ts:274` (updated assertion), and `src/actions/procedure-notes.ts:1060` (descriptive comment, out of scope per plan). Zero matches in any generator file, reference template, or migration.
- [x] Spot-check generator prompt via temporary vitest harness: (a) no `Full recovery` substring in built system prompt, (b) `Meaningful and sustained symptom control` appears exactly once, (c) `"full recovery"` (lowercase, quoted) present in FORBIDDEN block. Temp test removed after pass.

#### Manual Verification:
- [ ] Generate a fresh Procedure #1 note against a real or seed case. Inspect surfaced `prognosis` field — should not contain `Full recovery`. Should contain measured-language phrasing (e.g., `Meaningful and sustained symptom control`, `guarded`).
- [ ] Inspect `note_sessions.raw_ai_response.prognosis` for the same generation — should not contain `Full recovery`.
- [ ] Generate a Procedure #2+ note where `paintoneLabel` resolves to `baseline` (e.g., no usable prior pain values). Same checks.
- [ ] Generate a Procedure #2+ note where `paintoneLabel` resolves to `improved`. The guarded-to-favorable reference at line 679 still applies. Confirm `Continued recovery depends on ongoing response...` wording appears (untouched by this plan) and that no forbidden substring leaks in.
- [ ] Run a QC review (`runCaseQualityReview`) on a case with the freshly-generated Procedure #1 note. Confirm rule 10 does not fire a finding against the prognosis.
- [ ] Regenerate just the prognosis section of an existing legacy procedure note via the regen path at [src/actions/procedure-notes.ts:1058-1067](src/actions/procedure-notes.ts#L1058-L1067). Confirm the regen-merge clears `Full recovery` from `raw_ai_response.prognosis` (the comment at L1060 documents this exact behavior).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before considering the work complete.

---

## Testing Strategy

### Unit Tests:
None added. The single existing assertion at [generate-procedure-note.test.ts:274](src/lib/claude/__tests__/generate-procedure-note.test.ts#L274) is updated to track the bare-substring entry. Other prompt-presence assertions (L211, L260, L266, L271, L273) keep passing unchanged.

### Integration Tests:
Existing generator integration tests must continue to pass with no changes.

### Manual Testing Steps:
1. Generate a Procedure #1 note for any test case. Confirm surfaced `prognosis` does not contain `Full recovery` and uses measured language.
2. Open `note_sessions.raw_ai_response` for the same row. Confirm the `prognosis` key in the JSON also does not contain `Full recovery`.
3. Generate a Procedure #2 note where the prior procedure's pain values are missing or unparseable (forces `baseline` branch). Same checks.
4. Generate a Procedure #2 note where the prior procedure shows clear pain improvement (forces `improved` branch). Confirm the guarded-to-favorable reference still emits `Continued recovery depends on ongoing response...` (untouched by this plan).
5. Trigger a QC review on the case from step 1. Confirm no rule-10 finding fires.
6. Edge case: prompt the model with a tone hint that nudges optimistic phrasing (e.g., `"patient is highly motivated and expects to return to running"`). Confirm the bare substring `full recovery` does not survive into the surfaced field — the FORBIDDEN block should now match the bare substring deterministically.

## Performance Considerations

None. Three text edits to source files. The interpolated prompt block changes by a few bytes per generation call.

## Migration Notes

No DB migration. No data backfill in scope.

Existing rows: `procedure_notes.prognosis` and `note_sessions.raw_ai_response.prognosis` for previously-generated Procedure #1 notes still contain `Full recovery`. These clear through one of two paths:
- Provider regenerates the prognosis section → regen-merge at [procedure-notes.ts:1058-1067](src/actions/procedure-notes.ts#L1058-L1067) overwrites both the surfaced field and the corresponding `raw_ai_response.prognosis` key with the new (clean) output.
- Full-document regeneration of the procedure note → standard save path overwrites both fields.

`raw_ai_response` is not rendered in any UI surface (verified in source research). The audit-discoverability concern is bounded by that fact. If post-deploy monitoring identifies a render path that exposes legacy rows, a one-shot SQL UPDATE can be authored separately.

## References

- Source research: [thoughts/shared/research/2026-05-06-procedure-prognosis-full-recovery-residue.md](thoughts/shared/research/2026-05-06-procedure-prognosis-full-recovery-residue.md)
- Prior unification plan (established the canonical module + four-call-site interpolation pattern): [thoughts/shared/plans/2026-04-30-forbidden-phrase-prompt-fix.md](thoughts/shared/plans/2026-04-30-forbidden-phrase-prompt-fix.md)
- Original audit-discoverability research that motivated the canonical module: [thoughts/shared/research/2026-04-30-forbidden-phrase-scan-rule.md](thoughts/shared/research/2026-04-30-forbidden-phrase-scan-rule.md)
- Earlier procedure-note medico-legal editor pass that introduced the inline FORBIDDEN block: [thoughts/shared/plans/2026-04-18-procedure-note-medico-legal-editor-pass.md](thoughts/shared/plans/2026-04-18-procedure-note-medico-legal-editor-pass.md)
- Canonical list module to edit: [src/lib/qc/forbidden-phrases.ts](src/lib/qc/forbidden-phrases.ts)
- Procedure-note generator template to edit: [src/lib/claude/generate-procedure-note.ts:678](src/lib/claude/generate-procedure-note.ts#L678)
- Test assertion to update: [src/lib/claude/__tests__/generate-procedure-note.test.ts:274](src/lib/claude/__tests__/generate-procedure-note.test.ts#L274)
- Regen-merge logic that clears legacy residue on per-section regeneration: [src/actions/procedure-notes.ts:1058-1067](src/actions/procedure-notes.ts#L1058-L1067)
- QC reviewer rule 10 (not edited; auto-propagates via interpolation): [src/lib/claude/generate-quality-review.ts:123](src/lib/claude/generate-quality-review.ts#L123)
