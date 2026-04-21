# PRP Procedure Note — Medico-Legal Critique Fixes (Prompt-Only)

**Status: PROPOSED**

## Overview

Four defensibility gaps flagged in a medico-legal review of the PRP procedure-note output:

1. No sentence naming the specific interventional alternatives that were discussed.
2. No justification for multi-level injection when imaging + symptoms are diffuse.
3. No identification of the primary pain generator vs adjacent contributing levels.
4. Mixed coding framework — codes use "disc displacement" (M51.26/M51.27 — traumatic) or "disc degeneration" (M51.36/M51.37 — degenerative) inconsistently, and prose swings between "traumatic disc displacement" and "degenerative disc disease" without a rule pinning the two together.

All four are fixable in the `SYSTEM_PROMPT` in [generate-procedure-note.ts](../../../src/lib/claude/generate-procedure-note.ts). No schema, payload, tool-schema, UI, or migration work. Same category-A prompt-only pattern as [2026-04-18-procedure-note-medico-legal-editor-pass.md](2026-04-18-procedure-note-medico-legal-editor-pass.md).

## Current State Analysis

- `SYSTEM_PROMPT` lives at [generate-procedure-note.ts:143-531](../../../src/lib/claude/generate-procedure-note.ts#L143-L531). 20 required output fields enforced by `PROCEDURE_NOTE_TOOL` at [L533-583](../../../src/lib/claude/generate-procedure-note.ts#L533-L583).
- `procedure_preparation` (section 11) at [L372-380](../../../src/lib/claude/generate-procedure-note.ts#L372-L380) has a reference sentence "The risks, benefits, and alternatives of the PRP procedure were thoroughly explained..." but names no specific alternatives. Reviewer wants epidural steroid + facet-based interventions named and PRP-elected framing.
- `procedure_indication` (section 10) at [L360-370](../../../src/lib/claude/generate-procedure-note.ts#L360-L370) emits per-site bullets. No rule asking the model to justify multi-level treatment or identify a primary pain generator. The `TARGET-COHERENCE RULE` at [L363-368](../../../src/lib/claude/generate-procedure-note.ts#L363-L368) governs guidance-method language only.
- `assessment_and_plan` (section 17) at [L446-509](../../../src/lib/claude/generate-procedure-note.ts#L446-L509) houses the `DIAGNOSTIC-SUPPORT RULE` (filters A-E) and a `DOWNGRADE TABLE` at [L473-478](../../../src/lib/claude/generate-procedure-note.ts#L473-L478). The table currently downgrades M51.17 → M51.37 and M51.16 → M51.36 ("Other intervertebral disc degeneration") regardless of whether the case is a personal-injury / MVC case. The reference diagnoses line at [L508](../../../src/lib/claude/generate-procedure-note.ts#L508) uses `M51.26 Lumbar Disc Displacement` (traumatic framework), creating the mix the reviewer flagged.
- `assessment_summary` (section 9) at [L354-358](../../../src/lib/claude/generate-procedure-note.ts#L354-L358) has a `RADICULAR-PROSE CONSTRAINT` but no disc-pathology-prose constraint pinning it to the chosen coding framework.
- Sibling initial-visit prompt at [generate-initial-visit.ts:273-281](../../../src/lib/claude/generate-initial-visit.ts#L273-L281) uses the traumatic framework (M50.20 / M51.26 / M51.27) throughout, which is the framework the medico-legal reviewer expects for PI cases.
- `caseDetails.accident_date` and `caseDetails.accident_type` are already on the payload at [L27-28](../../../src/lib/claude/generate-procedure-note.ts#L27-L28) — sufficient signal to branch framework (a) traumatic vs (b) degenerative-with-superimposed-trauma.
- `procedureRecord.injection_site` at [L34](../../../src/lib/claude/generate-procedure-note.ts#L34) carries site text; `mriExtractions` array at [L120-125](../../../src/lib/claude/generate-procedure-note.ts#L120-L125) carries findings. Both give the LLM enough signal to identify a primary level without new schema fields.
- Existing `FORBIDDEN PHRASES (MANDATORY)` and `MANDATORY ... RULE` idioms at multiple spots in the prompt (e.g., [L340](../../../src/lib/claude/generate-procedure-note.ts#L340), [L363](../../../src/lib/claude/generate-procedure-note.ts#L363), [L394](../../../src/lib/claude/generate-procedure-note.ts#L394)) are the direct templates for new rules.
- Section-level regeneration ([L631-673](../../../src/lib/claude/generate-procedure-note.ts#L631-L673)) reuses the same `SYSTEM_PROMPT` — any new directive propagates to per-section Regenerate buttons automatically.
- Prompt-regression test pattern at [generate-procedure-note.test.ts:163-168](../../../src/lib/claude/__tests__/generate-procedure-note.test.ts#L163-L168) (`capturePrompt` helper) is the template for verifying each new directive lands in `opts.system`.

## Desired End State

After this plan, the procedure-note `SYSTEM_PROMPT` has four new prompt-only directives:

1. **`ALTERNATIVES-DISCUSSED RULE`** in `procedure_preparation` — requires one sentence naming epidural steroid + facet-based interventions as discussed alternatives and citing PRP as the patient-elected option. Minor-patient branch (age < 18) rewrites "patient elected" as "parent/guardian elected, with patient assent".
2. **`MULTI-LEVEL JUSTIFICATION RULE`** in `procedure_indication` — required when 2+ level-bullets or when `injection_site` names 2+ spinal levels. Appends a concordance sentence after the bullets.
3. **`PRIMARY PAIN GENERATOR RULE`** in `procedure_indication` — required in the same multi-level condition. Appends an identification sentence citing the primary level based on MRI findings or exam concordance. Allows a fallback "diffuse without clear primary level" clause when evidence is ambiguous.
4. **`CODING FRAMEWORK RULE`** spanning `assessment_and_plan` and the assessment/indication/subjective prose — branches on `caseDetails.accident_date` + `accident_type` to pick framework (a) traumatic (M50.20 / M51.26 / M51.27, prose says "traumatic disc displacement") or (b) degenerative-with-superimposed-trauma (M51.36 / M51.37, prose says "degenerative disc disease with superimposed traumatic exacerbation"). Updates `DOWNGRADE TABLE` so substitutions honor the chosen framework.

### Verification

- For a note with `caseDetails.accident_date` non-null, the generated `assessment_and_plan` diagnosis list uses M51.26/M51.27 (not M51.36/M51.37) when disc pathology is downgraded per Filter (C), and the `assessment_summary` / `subjective` prose uses "traumatic disc displacement" or "disc displacement" (not "degenerative disc disease").
- For a note with pre-existing DDD documented in `initialVisitNote.past_medical_history`, the output uses framework (b) consistently — M51.36/M51.37 codes and "degenerative disc disease with superimposed traumatic exacerbation" prose.
- For a note with 2 injection sites across 2 levels (e.g., L4-L5 + L5-S1), `procedure_indication` includes both the multi-level concordance sentence and the primary-pain-generator sentence after the bullet list.
- For any note, `procedure_preparation` contains a sentence naming "epidural steroid injections" and "facet-based interventions" as alternatives that were discussed, and states that the patient (or parent/guardian when minor) elected PRP.
- Prompt-regression tests assert each of the four new directives' presence in the captured `SYSTEM_PROMPT`.
- Existing tests still pass.

### Key Discoveries

- Framework branching key is `caseDetails.accident_date` + `accident_type` — both already on the payload. No new payload fields needed.
- Multi-level detection can be delegated to the LLM: "when `injection_site` names 2+ spinal levels OR you are emitting 2+ level-bullets" — prompt doesn't need explicit structured signal.
- Primary-level identification can cite `mriExtractions[].findings` OR exam concordance from `pmExtraction.physical_exam` — both already on the payload.
- The `DOWNGRADE TABLE` already has the right code anchors (M51.26/M51.27 vs M51.36/M51.37); the rewrite only reshuffles which anchor each downgrade targets based on framework.
- Existing initial-visit prompt uses traumatic framework (M51.26/M51.27) for PI cases — procedure-note alignment with it is additive continuity, not a conflicting new convention.

## What We're NOT Doing

- **No schema migrations.** No new fields on `procedures`, `procedure_details`, or `cases`.
- **No payload changes.** `ProcedureNoteInputData` untouched.
- **No tool-schema changes.** 20-field output contract preserved.
- **No UI changes.** Editor, per-section Regenerate, and PDF flow untouched.
- **No changes to the `paintoneLabel` / `chiroProgress` / `priorProcedures[]` mechanics** landed in prior plans — those are the narrative-tone axis; this is the medico-legal-defensibility axis.
- **No backfill of existing finalized notes.** Finalized notes stay as-is.
- **No discharge-note changes.** Separate prompt with its own tone profile.
- **No changes to initial-visit prompt.** Already aligned with traumatic framework.
- **No automated framework-detection scoring.** The prompt describes the branch criterion in text and lets the LLM apply it — no deterministic scorer in code.
- **No new `FORBIDDEN PHRASES` block for cross-framework language.** The `CODING FRAMEWORK RULE` itself says "do not mix"; a separate forbidden-phrase enforcement is available as follow-up if regressions appear in real cases.

## Implementation Approach

Four phases, one per directive. Each phase is independent and can be reviewed on real cases before the next lands. Phase 1 is smallest/additive (alternatives sentence), Phase 4 is largest (framework rule + downgrade table rewrite) — land them in that order so regressions are caught early.

All phases edit [src/lib/claude/generate-procedure-note.ts](../../../src/lib/claude/generate-procedure-note.ts) and append tests to [src/lib/claude/__tests__/generate-procedure-note.test.ts](../../../src/lib/claude/__tests__/generate-procedure-note.test.ts) using the existing `capturePrompt` helper pattern.

---

## Phase 1: Alternatives-Discussed Rule

### Overview

Add one mandatory clause to `procedure_preparation` (section 11) naming the specific interventional alternatives that were discussed and citing PRP as the patient-elected option. Update the adult + minor reference examples so the LLM copies the pattern.

### Changes Required

#### 1. Insert `ALTERNATIVES-DISCUSSED RULE` into section 11

**File**: `src/lib/claude/generate-procedure-note.ts`

Insert a new rule block immediately after the `MINOR-PATIENT CONSENT BRANCH` ends (line 378) and before the adult reference (line 379):

```
ALTERNATIVES-DISCUSSED RULE (MANDATORY): The procedure_preparation paragraph
must include one sentence naming the specific interventional alternatives that
were discussed with the patient, and citing PRP as the elected option. Use
this exact phrasing when the chart does not document a different alternatives
discussion: "Alternative interventional options, including epidural steroid
injections and facet-based interventions, were discussed. The patient elected
PRP as a regenerative treatment option." Place this sentence immediately after
the risks/benefits sentence and before the positioning/prep sentences.

MINOR-PATIENT BRANCH (age < 18): replace "The patient elected PRP" with
"The patient's parent/legal guardian elected PRP on the patient's behalf, with
the patient's assent." Do NOT invent a specific signer name or relationship.
```

#### 2. Update adult + minor reference examples in section 11

Insert the alternatives sentence into both reference paragraphs at [L379-380](../../../src/lib/claude/generate-procedure-note.ts#L379-L380) so the model has a pattern to copy.

**Adult reference (L379)** — add after "The risks, benefits, and alternatives of the PRP procedure were thoroughly explained, including potential for increased pain, infection, bleeding, and the need for additional injections.":

```
Alternative interventional options, including epidural steroid injections and facet-based interventions, were discussed. The patient elected PRP as a regenerative treatment option.
```

**Minor reference (L380)** — same insertion, but use "The patient's parent/legal guardian elected PRP on the patient's behalf, with the patient's assent."

### Verification

#### Automated

- Add to `generate-procedure-note.test.ts` (new `describe` block `SYSTEM_PROMPT — alternatives-discussed rule`):
  - `capturePrompt(emptyInput)` contains `'ALTERNATIVES-DISCUSSED RULE'`.
  - Prompt contains `'epidural steroid injections and facet-based interventions'`.
  - Prompt contains `'elected PRP as a regenerative treatment option'`.
  - Prompt contains `'MINOR-PATIENT BRANCH (age < 18)'` (context-scoped to the rule block, not the existing consent branch — use a region-scoped match).
- `pnpm test src/lib/claude/__tests__/generate-procedure-note.test.ts` passes.

#### Manual

- Regenerate a procedure-note draft on a real adult case in the dev environment — verify `procedure_preparation` contains the alternatives sentence and names epidural + facet interventions.
- Repeat on a minor-case fixture (`age = 16`) — verify the minor-branch phrasing.

### Success Criteria

- [ ] `ALTERNATIVES-DISCUSSED RULE` block landed in `SYSTEM_PROMPT` directly after the `MINOR-PATIENT CONSENT BRANCH`.
- [ ] Adult + minor reference examples both contain the alternatives sentence.
- [ ] Test suite passes.
- [ ] Manual regeneration on a real case emits the sentence.

---

## Phase 2: Multi-Level Justification Rule

### Overview

Add a mandatory clause to `procedure_indication` (section 10) requiring a justification sentence after the bullet list when 2+ levels are being treated. The LLM decides "multi-level" from `injection_site` string or from the bullets it is about to emit.

### Changes Required

#### 1. Insert `MULTI-LEVEL JUSTIFICATION RULE` into section 10

**File**: `src/lib/claude/generate-procedure-note.ts`

Insert a new rule block immediately after the `TARGET-COHERENCE RULE` ends (line 368) and before the `AVOID in this section:` line (L368):

```
MULTI-LEVEL JUSTIFICATION RULE (MANDATORY when procedure_indication emits 2 or
more level-bullets, OR when procedureRecord.injection_site names 2 or more
spinal levels): Immediately after the bullet list, append one sentence
justifying the multi-level intervention using concordance between imaging and
symptom distribution. Defensible boilerplate: "Multi-level treatment was
selected due to concordant multilevel MRI findings and diffuse symptom
distribution." When mriExtractions documents pathology at only one of the
treated levels, adapt: "Multi-level treatment was selected based on diffuse
symptom distribution across the treated levels, with MRI concordance at
[LEVEL]." Do NOT claim multilevel MRI concordance when mriExtractions does
not support it. Single-level procedures (one bullet, one level in
injection_site) do NOT require this sentence — omit it.
```

#### 2. Update section-10 reference example

The current reference at [L370](../../../src/lib/claude/generate-procedure-note.ts#L370) shows a single-level bullet. Add a second reference showing a 2-level case with the justification sentence appended:

```
Reference (multi-level, 2 bullets): "• PRP injection to periarticular and facet-capsular structures at L4-L5, where MRI demonstrates a 2.5 mm disc protrusion with mild facet arthropathy.\n• PRP injection to periarticular and facet-capsular structures at L5-S1, where MRI demonstrates a 3.2 mm disc protrusion with associated facet arthropathy.\nMulti-level treatment was selected due to concordant multilevel MRI findings and diffuse symptom distribution."
```

### Verification

#### Automated

- New `describe` block `SYSTEM_PROMPT — multi-level justification rule`:
  - Prompt contains `'MULTI-LEVEL JUSTIFICATION RULE'`.
  - Prompt contains `'concordant multilevel MRI findings and diffuse symptom distribution'`.
  - Prompt contains the multi-level reference example (substring match on the 2-bullet boilerplate).
- Test suite passes.

#### Manual

- Regenerate on a real case with `injection_site = 'L4-L5 and L5-S1'` — verify the justification sentence follows the bullet list.
- Regenerate on a single-level case — verify no justification sentence appears (single-level exempt).

### Success Criteria

- [ ] `MULTI-LEVEL JUSTIFICATION RULE` block landed in section 10.
- [ ] Multi-level reference example added.
- [ ] Real multi-level case generation emits the justification sentence; single-level case does not.

---

## Phase 3: Primary Pain Generator Rule

### Overview

Add a mandatory clause to `procedure_indication` (section 10) requiring a primary-pain-generator identification sentence after the multi-level justification (when multi-level). Also surface the primary level in `assessment_summary` (section 9) for cross-section consistency.

### Changes Required

#### 1. Insert `PRIMARY PAIN GENERATOR RULE` into section 10

**File**: `src/lib/claude/generate-procedure-note.ts`

Insert a new rule block immediately after the `MULTI-LEVEL JUSTIFICATION RULE` added in Phase 2:

```
PRIMARY PAIN GENERATOR RULE (MANDATORY when procedure_indication emits 2 or
more level-bullets): After the multi-level justification sentence, identify a
primary pain generator. Select the level with the largest or most severe disc
pathology on mriExtractions (largest disc protrusion measurement, annular
tear, most severe T2 signal change, documented nerve-root contact), OR the
level that most concordantly reproduces the patient's symptoms on
objective_physical_exam / pmExtraction findings. Required sentence:
"Primary pain generator suspected at [LEVEL], with adjacent levels
contributing." When evidence is ambiguous across the treated levels (e.g.,
mriExtractions does not distinguish severity and exam does not localize), use:
"Pain generator distribution is diffuse across the treated levels without a
clear primary level." Do NOT fabricate a primary level when evidence is
insufficient.
```

#### 2. Cross-reference in `assessment_summary` (section 9)

At the end of section 9 at [L358](../../../src/lib/claude/generate-procedure-note.ts#L358), append:

```
PRIMARY-LEVEL CONSISTENCY (MANDATORY when procedure_indication identifies a
primary pain generator per the PRIMARY PAIN GENERATOR RULE): Reference the
same primary level in assessment_summary. Do NOT assert a different primary
level in this section than in procedure_indication. When procedure_indication
uses the diffuse-without-clear-primary clause, assessment_summary should also
avoid asserting a single primary level.
```

#### 3. Update section-10 multi-level reference (from Phase 2)

Extend the multi-level reference example added in Phase 2 with the primary-generator sentence:

```
Reference (multi-level, 2 bullets): "• PRP injection to periarticular and facet-capsular structures at L4-L5, where MRI demonstrates a 2.5 mm disc protrusion with mild facet arthropathy.\n• PRP injection to periarticular and facet-capsular structures at L5-S1, where MRI demonstrates a 3.2 mm disc protrusion with associated facet arthropathy.\nMulti-level treatment was selected due to concordant multilevel MRI findings and diffuse symptom distribution. Primary pain generator suspected at L5-S1, with adjacent levels contributing."
```

### Verification

#### Automated

- New `describe` block `SYSTEM_PROMPT — primary pain generator rule`:
  - Prompt contains `'PRIMARY PAIN GENERATOR RULE'`.
  - Prompt contains `'Primary pain generator suspected at'`.
  - Prompt contains `'Pain generator distribution is diffuse across the treated levels'`.
  - Prompt contains `'PRIMARY-LEVEL CONSISTENCY'` inside the `assessment_summary` section area.
- Test suite passes.

#### Manual

- Regenerate on a case with L4-L5 (2.5 mm protrusion) + L5-S1 (3.2 mm protrusion) — verify `procedure_indication` identifies L5-S1 as primary and `assessment_summary` references the same.
- Regenerate on a case with equal-severity pathology across levels — verify the diffuse fallback clause appears.
- Regenerate on a single-level case — verify no primary-generator sentence (rule gated on multi-level).

### Success Criteria

- [ ] `PRIMARY PAIN GENERATOR RULE` block landed in section 10.
- [ ] `PRIMARY-LEVEL CONSISTENCY` clause landed in section 9.
- [ ] Multi-level reference updated with primary-generator sentence.
- [ ] Test suite passes.
- [ ] Real multi-level case generation identifies a primary level consistent across section 9 + 10; single-level case unchanged.

---

## Phase 4: Coding Framework Rule + Downgrade Table Rewrite

### Overview

Pin the diagnosis-code anchors and the disc-pathology prose to a single coding framework per note. Branch framework (a) traumatic vs (b) degenerative-with-superimposed-trauma on `caseDetails.accident_date` + documented pre-existing DDD. Rewrite the `DOWNGRADE TABLE` so disc-pathology substitutions honor the chosen framework. Update the WORKED EXAMPLE output list accordingly.

This is the largest phase — it touches the `DIAGNOSTIC-SUPPORT RULE` block and the surrounding worked example.

### Changes Required

#### 1. Insert `CODING FRAMEWORK RULE` at the top of the `DIAGNOSTIC-SUPPORT RULE` block

**File**: `src/lib/claude/generate-procedure-note.ts`

Insert immediately after the `DIAGNOSTIC-SUPPORT RULE` preamble ends (line 449) and before the `DOWNGRADE-TO HONOR RULE` (L451):

```
CODING FRAMEWORK RULE (MANDATORY): Select ONE coding framework for this note
and apply it consistently across the diagnosis code list AND across
disc-pathology prose in subjective, assessment_summary, procedure_indication,
and procedure_injection. Do NOT mix frameworks within a single note.

  (a) TRAUMATIC framework — DEFAULT for personal-injury / MVC cases. Applies
      when caseDetails.accident_date is non-null AND initialVisitNote /
      pmExtraction does NOT document pre-existing degenerative disc disease
      as a baseline condition prior to the accident. Disc-pathology anchor
      codes: M50.20 (cervical), M51.26 (lumbar), M51.27 (lumbosacral) —
      "Other intervertebral disc displacement". In prose, describe disc
      pathology as "traumatic disc displacement", "post-traumatic disc
      pathology", or "disc displacement". Do NOT use "degenerative disc
      disease" or "disc degeneration" in prose under this framework.

  (b) DEGENERATIVE-WITH-SUPERIMPOSED-TRAUMA framework — applies only when
      initialVisitNote.past_medical_history or pmExtraction explicitly
      documents pre-existing degenerative disc disease (e.g., baseline
      MRI-confirmed DDD prior to the accident, age-related disc changes
      documented in past medical history). Disc-pathology anchor codes:
      M50.23 (cervical), M51.36 (lumbar), M51.37 (lumbosacral) — "Other
      intervertebral disc degeneration". In prose, describe pathology as
      "degenerative disc disease with superimposed traumatic exacerbation"
      consistently. Do NOT intermix with "traumatic disc displacement"
      language under this framework.

Framework selection is a binary decision for the whole note. When accident_date
is null AND no pre-existing DDD is documented (e.g., non-PI wellness case),
default to framework (a) and phrase pathology neutrally as "disc displacement"
without "traumatic". When both traumatic mechanism AND pre-existing DDD are
documented, use framework (b) — the superimposed-trauma language captures both.
```

#### 2. Rewrite the `DOWNGRADE TABLE` (L473-478)

Replace the existing table with framework-aware substitutions:

```
DOWNGRADE TABLE (MANDATORY when filters B or C omit a code) — substitutions
depend on the CODING FRAMEWORK selected above:

Under framework (a) TRAUMATIC (default):
  • M50.12X (cervical radiculopathy) with no region-matched cervical objective
    finding → replace with M50.20 (Other cervical disc displacement,
    unspecified) AND keep M54.2 (Cervicalgia).
  • M51.17 (lumbosacral disc with radiculopathy) with no region-matched lumbar
    radicular finding → replace with M51.27 (Other intervertebral disc
    displacement, lumbosacral region) AND keep M54.5 (Low back pain).
  • M51.16 (lumbar disc with radiculopathy) with no region-matched lumbar
    radicular finding → replace with M51.26 (Other intervertebral disc
    displacement, lumbar region) AND keep M54.5.
  • M50.00 (cervical disc with myelopathy) with no upper-motor-neuron signs →
    replace with M50.20 AND keep M54.2.

Under framework (b) DEGENERATIVE-WITH-SUPERIMPOSED-TRAUMA:
  • M50.12X with no region-matched cervical objective finding → replace with
    M50.23 (Other cervical disc degeneration, unspecified) AND keep M54.2.
  • M51.17 with no region-matched lumbar radicular finding → replace with
    M51.37 (Other intervertebral disc degeneration, lumbosacral region) AND
    keep M54.5.
  • M51.16 with no region-matched lumbar radicular finding → replace with
    M51.36 (Other intervertebral disc degeneration, lumbar region) AND keep
    M54.5.
  • M50.00 with no upper-motor-neuron signs → replace with M50.23 AND keep
    M54.2.

Never leave disc pathology completely unrepresented in the output list.
```

#### 3. Update the `WORKED EXAMPLE` output (L493-501)

Replace the existing output list to use the traumatic framework (the worked example's input contains `V43.52XA` — an MVC code — signalling a PI case, so framework (a) applies):

```
  OUTPUT diagnosis list (framework (a) TRAUMATIC):
    M50.20 Other cervical disc displacement, unspecified level
    M51.26 Other intervertebral disc displacement, lumbar region
    M51.27 Other intervertebral disc displacement, lumbosacral region
    M54.2 Cervicalgia
    M54.5 Low back pain
    G44.309 Post-traumatic headache, unspecified, not intractable
    G47.9 Sleep disorder, unspecified
```

Update the worked-example reasoning lines for M50.121, M51.17, M51.16 to reference the framework-(a) anchor codes (M50.20 / M51.27 / M51.26 rather than M51.37 / M51.36). The V-code, M79.1, and M54.6 reasoning is unchanged.

#### 4. Add a mirror counter-example under framework (b)

After the existing `COUNTER-EXAMPLE` blocks at L503-506, add:

```
COUNTER-EXAMPLE (framework (b) selection):
  If initialVisitNote.past_medical_history documents "pre-existing lumbar
  degenerative disc disease confirmed on pre-accident MRI", the note uses
  framework (b). Under those same input candidate codes with the same exam
  findings, the OUTPUT list substitutes M50.23 / M51.36 / M51.37 instead of
  M50.20 / M51.26 / M51.27, and the prose describes the clinical picture as
  "degenerative disc disease with superimposed traumatic exacerbation"
  throughout subjective / assessment_summary / procedure_indication.
```

#### 5. Update section-9 (`assessment_summary`) and section-10 (`procedure_indication`) references

The reference diagnoses line at [L508](../../../src/lib/claude/generate-procedure-note.ts#L508) already uses `M51.26 Lumbar Disc Displacement` — consistent with framework (a), so no change needed there.

The section-9 improvement-leaning reference at [L358](../../../src/lib/claude/generate-procedure-note.ts#L358) says "correlating with MRI findings" — neutral, keeps working under both frameworks. The persistence-leaning reference at [L357](../../../src/lib/claude/generate-procedure-note.ts#L357) says "consistent with lumbar disc pathology" — also neutral. No reference edits in section 9.

The section-10 reference at [L370](../../../src/lib/claude/generate-procedure-note.ts#L370) says "MRI demonstrates a 3.2 mm disc protrusion" — factual / neutral, works under both frameworks. No edit.

### Verification

#### Automated

- New `describe` block `SYSTEM_PROMPT — coding framework rule`:
  - Prompt contains `'CODING FRAMEWORK RULE'`.
  - Prompt contains `'(a) TRAUMATIC framework'` AND `'(b) DEGENERATIVE-WITH-SUPERIMPOSED-TRAUMA framework'`.
  - Prompt contains `'M51.26'` AND `'M51.27'` (traumatic anchors).
  - Prompt contains `'M51.36'` AND `'M51.37'` (degenerative anchors).
  - Prompt contains `'Under framework (a) TRAUMATIC'` AND `'Under framework (b) DEGENERATIVE-WITH-SUPERIMPOSED-TRAUMA'` inside the `DOWNGRADE TABLE` area.
  - Prompt contains the updated worked-example output list substring `'M51.26 Other intervertebral disc displacement, lumbar region'`.
- Existing worked-example assertions (if any) updated to match new output.
- Test suite passes.

#### Manual

- Regenerate on a real MVC / PI case with no pre-existing DDD — verify `assessment_and_plan` uses M50.20 / M51.26 / M51.27 and prose says "traumatic disc displacement".
- Regenerate on a case where `initialVisitNote.past_medical_history` mentions "pre-existing DDD" — verify `assessment_and_plan` uses M51.36 / M51.37 and prose says "degenerative disc disease with superimposed traumatic exacerbation".
- Regenerate on an existing case that previously mixed frameworks (one of the cases that triggered the reviewer's critique) — verify the output is now framework-consistent.

### Success Criteria

- [ ] `CODING FRAMEWORK RULE` block landed at the top of the `DIAGNOSTIC-SUPPORT RULE`.
- [ ] `DOWNGRADE TABLE` rewritten with both framework branches.
- [ ] `WORKED EXAMPLE` output updated to framework (a) anchors.
- [ ] Framework (b) counter-example added.
- [ ] Test suite passes.
- [ ] Manual regen on a PI case emits framework (a) codes + prose; manual regen on a pre-existing-DDD case emits framework (b) codes + prose.

---

## Testing Strategy

### Unit Tests

All four phases extend `src/lib/claude/__tests__/generate-procedure-note.test.ts` with new `describe` blocks using the existing `capturePrompt` helper at [generate-procedure-note.test.ts:163-168](../../../src/lib/claude/__tests__/generate-procedure-note.test.ts#L163-L168). Each block asserts the presence of the new directive's key tokens in the captured `opts.system`.

### Integration / Manual Tests

No end-to-end automated integration test exists for procedure-note generation (the existing suite mocks `callClaudeTool`). Manual regeneration on a set of real fixture cases is the integration check per phase:

- Adult + minor cases (Phase 1)
- Single-level + multi-level cases (Phases 2, 3)
- PI case without pre-existing DDD + PI case with pre-existing DDD documented (Phase 4)

### Regression Check

After all four phases, rerun the full procedure-note test suite and regenerate a cross-section of the plan-authoring team's standing fixture cases. Eyeball for:

- `paintoneLabel` branching (improved / stable / worsened / baseline) still renders correctly — new rules should not interact with narrative-tone axis.
- `NO CLONE RULE` still applies to procedure-mechanics sections across a 3-session series.
- `DIAGNOSTIC-SUPPORT RULE` filters (A-E) still drop V-codes / M79.1 / unsupported radiculopathy codes — the framework rule sits ABOVE the filters and governs anchor selection only.

## Performance Considerations

None. Prompt-only changes; no new API calls, no new payload fields, no new DB queries. Prompt length increases by roughly 80-120 lines of text across the four phases — well within the model's context window.

## Migration Notes

None. No schema changes. Existing finalized procedure notes are not regenerated. Newly generated drafts follow the updated prompt.

## References

- Medico-legal reviewer critique: conversation context (this plan's originating message).
- Prior related plan: [2026-04-18-procedure-note-medico-legal-editor-pass.md](2026-04-18-procedure-note-medico-legal-editor-pass.md) — five earlier medico-legal directives (anti-marketing, no "Session N of 3", bracketed placeholders, guidance-target coherence, minor-consent branch).
- Research on PI-case coding conventions: [2026-04-18-apply-medico-legal-editor-pass-to-procedure-note.md](../research/2026-04-18-apply-medico-legal-editor-pass-to-procedure-note.md).
- Prompt file: [src/lib/claude/generate-procedure-note.ts](../../../src/lib/claude/generate-procedure-note.ts).
- Test file: [src/lib/claude/__tests__/generate-procedure-note.test.ts](../../../src/lib/claude/__tests__/generate-procedure-note.test.ts).
