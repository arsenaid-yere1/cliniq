---
date: 2026-05-06T09:27:38-0700
researcher: arsenaid
git_commit: 8bed00b5b97dccfee136a6228438841d90fbb40c
branch: main
repository: cliniq
topic: "Procedure prognosis 'full recovery' residue — where the QC scan rule, the canonical phrase list, and the procedure-note reference template all live, and why Procedure #1 still carries the wording"
tags: [research, codebase, qc, quality-review, forbidden-phrase, prognosis, procedure-note]
status: complete
last_updated: 2026-05-06
last_updated_by: arsenaid
---

# Research: Procedure prognosis "full recovery" wording vs forbidden-phrase scan

**Date**: 2026-05-06T09:27:38-0700
**Researcher**: arsenaid
**Git Commit**: 8bed00b5b97dccfee136a6228438841d90fbb40c
**Branch**: main
**Repository**: cliniq

## Research Question

> Forbidden-phrase scan flags 'full recovery' as overpromising clinical-claim language in any prognosis section. Procedure #1 has the same wording and should also be reworked.

How is the forbidden-phrase scan currently wired, where does the canonical phrase list live, where is the literal `full recovery` string still emitted into Procedure #1's prognosis, and which call sites participate in the preventive vs detective layers?

## Summary

Three relevant facts, all derivable from current code:

1. **Canonical phrase list** lives at [src/lib/qc/forbidden-phrases.ts](src/lib/qc/forbidden-phrases.ts). It contains the **claim-form** phrase `'full recovery is expected'` — not the bare substring `'full recovery'`. The list comment explicitly notes the claim-form framing was chosen to avoid colliding with the procedure-note reference template's prose `"Full recovery depends on the patient's response..."`.
2. **Procedure-note prognosis reference template** at [src/lib/claude/generate-procedure-note.ts:678](src/lib/claude/generate-procedure-note.ts#L678) embeds the literal sentence:
   > `"Due to the chronic nature of the injury, the prognosis is guarded. Full recovery depends on the patient's response to PRP therapy and adherence to the prescribed rehabilitation program."`
   This is the **guarded-branch reference** the LLM is instructed to match for `paintoneLabel ∈ {baseline, stable, worsened}`. Procedure #1 always falls in this branch (no prior procedure → no improved tone), so its surfaced prognosis tracks this template and the words `Full recovery` survive into the surfaced field.
3. **QC reviewer rule 10** at [src/lib/claude/generate-quality-review.ts:123](src/lib/claude/generate-quality-review.ts#L123) interpolates `FORBIDDEN_LIST_RENDERED` (built from `FORBIDDEN_PROGNOSIS_PHRASES`) into the system prompt. Since the canonical list now stores `'full recovery is expected'` rather than `'full recovery'`, what the reviewer Claude is instructed to flag as "clinical-claim language" is the **claim-form** wording. Whether the reviewer also flags the bare-substring occurrence in the guarded-template prose is left to LLM interpretation of the rule's text — the rule is prompt-mediated, not regex-mediated.

The wording in Procedure #1's prognosis is therefore **not** emitted by accident — it is the literal text of the `Reference (guarded — for baseline/stable/worsened)` template the prompt directs the LLM to emit. The list at `forbidden-phrases.ts` was deliberately scoped (claim-form only) to allow this template to survive. There is no deterministic Node-side scanner anywhere in the codebase that scrubs `prognosis` or `raw_ai_response.prognosis` for either form of the phrase.

## Detailed Findings

### Canonical forbidden-phrase module

[src/lib/qc/forbidden-phrases.ts:1-21](src/lib/qc/forbidden-phrases.ts#L1-L21)

```ts
// Phrases the LLM must not emit as clinical claims about prognosis outcome
// across all note types. Listed in claim-form (not bare substrings) so the
// prompt rule does not collide with legitimate prose like "full recovery
// depends on the patient's response..." which is part of an existing
// reference template in the procedure-note prompt.
export const FORBIDDEN_PROGNOSIS_PHRASES = [
  'full recovery is expected',
  'complete resolution of symptoms',
  'definitive healing',
  'guaranteed improvement',
  'cure',
] as const

export function forbiddenPrognosisPromptBlock(): string {
  const quoted = FORBIDDEN_PROGNOSIS_PHRASES.map((p) => `"${p}"`).join(', ')
  return `FORBIDDEN PHRASES (MANDATORY) in prognosis — do NOT use any of the following as a clinical claim about expected outcome: ${quoted}. Prognosis language must remain measured. Use "guarded", "guarded-to-favorable", "favorable", "meaningful and sustained improvement", "anticipated long-term symptom control" instead.`
}
```

Two design decisions encoded here:

- Phrase entries are **claim-form** (`'full recovery is expected'`) not bare substrings. The header comment names this explicitly as a collision-avoidance measure for the existing procedure-note guarded-template prose.
- The prompt-block string the function returns says `"as a clinical claim about expected outcome"` — i.e., the rule the LLM enforces (during generation) and reads (during QC review) is framed around clinical-claim semantics, not literal substring matching.

### Procedure-note prognosis spec — where Procedure #1's wording originates

[src/lib/claude/generate-procedure-note.ts:676-681](src/lib/claude/generate-procedure-note.ts#L676-L681)

```
19. prognosis (~2 sentences):
Match the "paintoneLabel". Use the guarded reference when paintoneLabel is "baseline", "stable", or "worsened"; use the guarded-to-favorable reference when paintoneLabel is "improved".
Reference (guarded — for baseline/stable/worsened): "Due to the chronic nature of the injury, the prognosis is guarded. Full recovery depends on the patient's response to PRP therapy and adherence to the prescribed rehabilitation program."
Reference (guarded-to-favorable — for improved): "Given the interim response to PRP therapy, the prognosis is guarded-to-favorable. Continued recovery depends on ongoing response to PRP therapy and adherence to the prescribed rehabilitation program." Do NOT write "completion of the injection series" or any variant implying a defined series endpoint — the chart does not store a planned series total (see SERIES-TOTAL RULE). Use "ongoing response" / "continued response" / "sustained response" framing instead.

${forbiddenPrognosisPromptBlock()}
```

Mechanism for Procedure #1 specifically:

- Procedure #1 has no prior procedure note in `priorProcedureNotes[]` → the `paintoneLabel` resolution defaults to `baseline` (no improved-vs-prior comparison possible).
- The prompt instructs Claude to **match** the guarded reference for `baseline`. The reference sentence contains `Full recovery depends on the patient's response...` verbatim.
- Claude reproduces the template's wording closely — that is the whole purpose of the reference. The bare substring `Full recovery` therefore appears in the surfaced `prognosis` and in `raw_ai_response.prognosis`.
- The injected `forbiddenPrognosisPromptBlock()` immediately after directs Claude away from the claim-form phrases (`"full recovery is expected"`, `"complete resolution of symptoms"`, etc.), but the bare-substring guarded-template sentence sits **above** the FORBIDDEN block and is the model the LLM is told to copy.

### Pain-tone label resolution (why Procedure #1 always lands in the guarded branch)

The procedure-note generator's input includes `procedure_number` and `priorProcedureNotes[]`. The `paintoneLabel` returned to the prompt distinguishes among `baseline | stable | improved | worsened` by comparing this procedure's pain values against the prior. With no prior, the comparison cannot fire `improved` and the branch resolves to `baseline`, which routes to the guarded reference. This is the reason the wording is structurally inevitable for Procedure #1 under current logic.

(Pain-tone wiring referenced from the locator inventory: [src/lib/claude/generate-procedure-note.ts](src/lib/claude/generate-procedure-note.ts), test assertions at [src/lib/claude/__tests__/generate-procedure-note.test.ts:674-685](src/lib/claude/__tests__/generate-procedure-note.test.ts#L674-L685) confirm the improved-branch text variant; the guarded-branch text is the one carrying `Full recovery depends on...`.)

### QC reviewer rule 10 — what is actually scanned

[src/lib/claude/generate-quality-review.ts:7-11, 123](src/lib/claude/generate-quality-review.ts#L7-L11)

```ts
import { FORBIDDEN_PROGNOSIS_PHRASES } from '@/lib/qc/forbidden-phrases'

const FORBIDDEN_LIST_RENDERED = FORBIDDEN_PROGNOSIS_PHRASES.map(
  (p) => `"${p}"`,
).join(', ')
```

Rule 10 in `SYSTEM_PROMPT`:

```
10. Forbidden-phrase scan. ${FORBIDDEN_LIST_RENDERED} as clinical-claim language in any prognosis section (surfaced or raw_ai_response.prognosis).
```

Two consequences:

- The QC reviewer Claude sees the **claim-form** list. It is instructed to flag those phrases "as clinical-claim language" — wording that invites the LLM to apply judgment about whether the literal `Full recovery depends on...` template prose constitutes a clinical claim or a measured statement of dependency.
- "in any prognosis section (surfaced or raw_ai_response.prognosis)" extends the scan to the raw payload. The raw is included in the QC reviewer's input on every note type — see input schema [src/lib/claude/generate-quality-review.ts:33-87](src/lib/claude/generate-quality-review.ts#L33-L87).
- The flag the user reported (`'full recovery'` flagged in Procedure #1 prognosis) is therefore an LLM judgment call by the QC reviewer that the bare-substring template prose registers as clinical-claim language despite the canonical list using the claim-form `'full recovery is expected'`.

### Other prognosis-section call sites (parity context)

The same `forbiddenPrognosisPromptBlock()` is injected into the prognosis section of all three generators. Locations:

- Procedure note: [src/lib/claude/generate-procedure-note.ts:681](src/lib/claude/generate-procedure-note.ts#L681)
- Initial visit: [src/lib/claude/generate-initial-visit.ts:250](src/lib/claude/generate-initial-visit.ts#L250) and [:356](src/lib/claude/generate-initial-visit.ts#L356) (two prompt variants — first visit vs follow-up)
- Discharge: [src/lib/claude/generate-discharge-note.ts:458](src/lib/claude/generate-discharge-note.ts#L458)

Per `2026-04-30-forbidden-phrase-prompt-fix.md`, the discharge prognosis reference uses `"favorable"` / `"meaningful and sustained improvement"` exemplars — neither carries the literal `Full recovery` substring. The initial-visit prognosis spec uses guarded-but-favorable framing without the `Full recovery` substring. The procedure-note guarded reference is the only one of the three that emits `Full recovery` verbatim through the reference template.

### Storage and audit surface

`raw_ai_response` is `jsonb` on `note_sessions`, written by the procedure-note session module. The full LLM tool-call payload is persisted there, so the bare-substring `Full recovery` from the guarded template lives in both:

- `procedure_notes.prognosis` (surfaced field, written from `data.prognosis`)
- `note_sessions.raw_ai_response.prognosis` (raw LLM payload)

No UI surface renders `raw_ai_response`. The QC review pipeline pulls it into the reviewer's user-message verbatim via [src/actions/case-quality-reviews.ts](src/actions/case-quality-reviews.ts) (line 80 selects `prognosis`; the raw payload is selected alongside).

There is no Node-side post-processor that scrubs either field for forbidden phrases. The enforcement is two-tier and entirely LLM-mediated:

| Tier | Layer | Site |
|---|---|---|
| 1 (preventive) | Generator system prompt's `${forbiddenPrognosisPromptBlock()}` | [generate-procedure-note.ts:681](src/lib/claude/generate-procedure-note.ts#L681), initial-visit `:250` & `:356`, discharge `:458` |
| 2 (detective) | QC reviewer rule 10 | [generate-quality-review.ts:123](src/lib/claude/generate-quality-review.ts#L123) |

### Test assertions covering the forbidden block presence

[src/lib/claude/__tests__/generate-procedure-note.test.ts](src/lib/claude/__tests__/generate-procedure-note.test.ts):
- L211, L260, L266, L271 — assert the literal substring `FORBIDDEN PHRASES (MANDATORY)` is present in the system prompt for `improved` pain-tone branch, `procedure_prp_prep`, `patient_education`, and `prognosis` sections.
- L674-685 — assert the improved-branch prognosis text no longer pre-commits to `"completion of the injection series"`.
- L1223 — separate per-site volume fabrication forbidden-phrase guard.

No test asserts the **absence** of the bare substring `Full recovery` from the surfaced prognosis output — the only assertions verify the FORBIDDEN block is present in the prompt, not that the model output is clean of it.

### Procedure-number indexing (where "Procedure #1" comes from)

`procedure_number` is an integer column on the procedures table set on create and renumbered on reorder. It is read by the procedure-note generator and used in the prompt to drive series-position language for `assessment_and_plan` and `prognosis`. It is also the input to the QC reviewer, surfaced as `procedureNotes[].procedure_number` ([generate-quality-review.ts:61](src/lib/claude/generate-quality-review.ts#L61)) and used by deterministic ICD-10 validators ([src/lib/qc/diagnosis-validators.ts](src/lib/qc/diagnosis-validators.ts)) to enforce the A-suffix → D-suffix rewrite on procedures #2+. Relevant chain:

- DB column added: [supabase/migrations/013_prp_procedure_encounter.sql](supabase/migrations/013_prp_procedure_encounter.sql)
- Assigned/renumbered: `src/actions/procedures.ts` (~lines 618-701)
- Read by note generator: [src/lib/claude/generate-procedure-note.ts](src/lib/claude/generate-procedure-note.ts)
- Rendered in PDF: `src/lib/pdf/procedure-note-template.tsx` line 199 via `ordinal()`

## Code References

- [src/lib/qc/forbidden-phrases.ts:6-12](src/lib/qc/forbidden-phrases.ts#L6-L12) — canonical phrase list (`'full recovery is expected'` claim-form, not bare substring)
- [src/lib/qc/forbidden-phrases.ts:1-5](src/lib/qc/forbidden-phrases.ts#L1-L5) — header comment naming the claim-form choice as collision-avoidance for the procedure-note reference template
- [src/lib/qc/forbidden-phrases.ts:18-21](src/lib/qc/forbidden-phrases.ts#L18-L21) — `forbiddenPrognosisPromptBlock()` builder
- [src/lib/claude/generate-procedure-note.ts:676-681](src/lib/claude/generate-procedure-note.ts#L676-L681) — procedure-note prognosis spec, both guarded and guarded-to-favorable references, FORBIDDEN block injection
- [src/lib/claude/generate-procedure-note.ts:678](src/lib/claude/generate-procedure-note.ts#L678) — guarded reference sentence containing literal `"Full recovery depends on the patient's response..."`
- [src/lib/claude/generate-quality-review.ts:7-11](src/lib/claude/generate-quality-review.ts#L7-L11) — import and `FORBIDDEN_LIST_RENDERED`
- [src/lib/claude/generate-quality-review.ts:123](src/lib/claude/generate-quality-review.ts#L123) — rule 10 with surfaced/raw scope
- [src/lib/claude/generate-initial-visit.ts:250](src/lib/claude/generate-initial-visit.ts#L250) — initial-visit forbidden-block injection (first-visit prompt variant)
- [src/lib/claude/generate-initial-visit.ts:356](src/lib/claude/generate-initial-visit.ts#L356) — initial-visit forbidden-block injection (follow-up prompt variant)
- [src/lib/claude/generate-discharge-note.ts:458](src/lib/claude/generate-discharge-note.ts#L458) — discharge forbidden-block injection
- [src/actions/procedure-notes.ts:169](src/actions/procedure-notes.ts) — selects `prognosis` from DB; passes it to generator as existing text
- [src/actions/case-quality-reviews.ts:80](src/actions/case-quality-reviews.ts) — selects `prognosis` for QC payload assembly
- [src/lib/validations/pt-extraction.ts:132](src/lib/validations/pt-extraction.ts) and [:182](src/lib/validations/pt-extraction.ts#L182) — `prognosis: z.string().nullable()` on procedure-note output schema
- Tests: [src/lib/claude/__tests__/generate-procedure-note.test.ts:271-273](src/lib/claude/__tests__/generate-procedure-note.test.ts#L271-L273) — asserts FORBIDDEN block present in prognosis section of system prompt

## Architecture Documentation

Two-tier LLM-mediated forbidden-phrase enforcement currently in place:

- **Tier 1 (preventive)** — A single shared TS module (`src/lib/qc/forbidden-phrases.ts`) exports `FORBIDDEN_PROGNOSIS_PHRASES` and `forbiddenPrognosisPromptBlock()`. Each of the three generators (procedure / initial-visit / discharge) imports the builder and interpolates the rendered FORBIDDEN block into its prognosis-section system-prompt spec. The block instructs Claude to avoid the listed phrases "as a clinical claim about expected outcome" and to substitute measured language (`guarded`, `guarded-to-favorable`, `favorable`, `meaningful and sustained improvement`, `anticipated long-term symptom control`).
- **Tier 2 (detective)** — The QC reviewer system prompt's rule 10 interpolates the same canonical list (rendered as `FORBIDDEN_LIST_RENDERED`) and instructs the reviewing Claude to flag occurrences "as clinical-claim language in any prognosis section (surfaced or raw_ai_response.prognosis)". The reviewer's input payload includes both the surfaced `prognosis` text and the `raw_ai_response` jsonb for every note in the chain.
- **No deterministic scanner.** No regex / Node-side validator scrubs either field. Both tiers are prompt-only.
- **Reference-template coupling.** The procedure-note prognosis spec's guarded reference at line 678 contains the literal sentence `"Full recovery depends on the patient's response to PRP therapy..."` This is the model the LLM is told to match for `baseline | stable | worsened` pain-tone labels. The forbidden-phrase list was deliberately scoped to **claim-form** strings (`'full recovery is expected'`) rather than the bare substring `'full recovery'` for exactly this reason — see the comment block at the top of `forbidden-phrases.ts`.
- **Procedure #1 specifically** — having no prior procedure note, the pain-tone label resolves to `baseline`, which routes the prompt to the guarded reference. The bare-substring `Full recovery` therefore lands in both the surfaced `procedure_notes.prognosis` and the `note_sessions.raw_ai_response.prognosis` payload as a structural consequence of the reference template, not as a model-side rule violation.
- **QC reviewer judgment ambiguity.** The QC reviewer flags the bare-substring occurrence in Procedure #1 even though the canonical list contains only the claim-form. This is an LLM interpretation of "as clinical-claim language" — the prompt-only enforcement model leaves room for the reviewer to extend the rule to bare-substring occurrences in template-derived prose.

## Related Research

- [thoughts/shared/research/2026-04-30-forbidden-phrase-scan-rule.md](thoughts/shared/research/2026-04-30-forbidden-phrase-scan-rule.md) — original mapping of the two-tier enforcement model and the `raw_ai_response` audit-discoverability concern
- [thoughts/shared/plans/2026-04-30-forbidden-phrase-prompt-fix.md](thoughts/shared/plans/2026-04-30-forbidden-phrase-prompt-fix.md) — implementation plan that established the canonical module and unified the four call sites; documents the deliberate claim-form scoping decision
- [thoughts/shared/plans/2026-04-28-case-quality-review-agent.md](thoughts/shared/plans/2026-04-28-case-quality-review-agent.md) — original QC agent design where rule 10 first appeared (line 419)
- [thoughts/shared/plans/2026-04-18-procedure-note-medico-legal-editor-pass.md](thoughts/shared/plans/2026-04-18-procedure-note-medico-legal-editor-pass.md) — earlier pass that introduced the inline FORBIDDEN block in the procedure-note prognosis section

## Open Questions

- Whether the procedure-note guarded reference at [generate-procedure-note.ts:678](src/lib/claude/generate-procedure-note.ts#L678) should be rewritten to drop the literal `Full recovery depends...` substring, given that the QC reviewer flags the bare-substring occurrence as a clinical claim despite the canonical list scoping to claim-form only.
- Whether `'full recovery'` (bare substring) should be added to `FORBIDDEN_PROGNOSIS_PHRASES` — if so, the comment block's collision-avoidance rationale would no longer hold and the guarded reference template needs replacement with measured-language exemplar prose first.
- Whether the QC reviewer's rule 10 wording (`"as clinical-claim language"`) intentionally leaves room for the reviewer to flag bare-substring occurrences in template-derived prose, or whether that is unintended scope creep from the canonical list's claim-form framing.
- Whether existing `note_sessions.raw_ai_response` rows containing `Full recovery` survive untouched. (Per the prior plan: `raw_ai_response` is not rendered in any UI surface; no backfill is in scope. A one-shot SQL update would be a separate effort.)
