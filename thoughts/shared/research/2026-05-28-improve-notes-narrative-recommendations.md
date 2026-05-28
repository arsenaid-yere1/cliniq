---
date: 2026-05-28T09:39:47-0700
researcher: arsenaid
git_commit: a4d549deb9b4d570c64808539c929fdb3e55ca7d
branch: main
repository: cliniq
topic: "Recommendations to Improve Note Narrative — Initial Visit, Procedure, Discharge"
tags: [research, codebase, notes, narrative, prompts, initial-visit, procedure-note, discharge-note, claude]
status: complete
last_updated: 2026-05-28
last_updated_by: arsenaid
---

# Research: Recommendations to Improve Note Narrative — Initial Visit, Procedure, Discharge

**Date**: 2026-05-28T09:39:47-0700
**Researcher**: arsenaid
**Git Commit**: a4d549deb9b4d570c64808539c929fdb3e55ca7d
**Branch**: main
**Repository**: cliniq

## Research Question

Recommend ways to improve note narrative quality from the three LLM-generated note types: Initial Visit, Procedure (PRP), and Discharge.

## Summary

All three notes share the same generation pattern: TypeScript pre-computes deterministic signals (pain tone, plan alignment, trajectory, diagnosis pool) → assembles a typed `InputData` blob → JSON.stringify into the user message → Claude Opus 4.6 forced-tool-use call → Zod-validated string sections → per-column DB write.

The pipelines are well-engineered on the deterministic side. The biggest narrative-quality leverage is on the **prompt/context** side: how source data is shaped before Claude sees it, how voice is steered, how cross-note continuity is preserved, and how output is validated for *prose quality* rather than just numeric consistency.

Recommendations are grouped by impact tier. Tier 1 = highest leverage, lowest risk; Tier 3 = exploratory.

---

## Tier 1 — High-Impact, Low-Risk

### 1.1 Replace raw JSON.stringify payloads with a curated context bundle

**Current state:**
- Initial visit user message = `JSON.stringify(inputData, null, 2)` containing 14 fields including nulls ([generate-initial-visit.ts:596](src/lib/claude/generate-initial-visit.ts#L596)).
- Procedure: same pattern, dumps prior procedure notes verbatim ([generate-procedure-note.ts:757](src/lib/claude/generate-procedure-note.ts#L757)).
- Discharge: same pattern across 11 query results ([generate-discharge-note.ts:517](src/lib/claude/generate-discharge-note.ts#L517)).

**Why it limits narrative quality:**
- Claude must do field selection from a noisy nested blob while also writing prose. Field-name leakage into prose ("provider_overrides", "imaging_support") is a recurring forbidden-phrase risk.
- Nulls and empty arrays still occupy attention.
- Prior note arrays land raw — encourages copy/paraphrase patterns that drift from the current visit's facts.

**Recommendation:**
Pre-render context into labeled markdown sections before sending. e.g.:
```
## CURRENT VISIT FACTS
- Visit date: 05/14/2026
- Patient age: 43
- Pain (today): 4/10–6/10

## PRIOR VISIT REFERENCE (paraphrase only; do NOT copy)
Subjective: ...trimmed/normalized prose...

## ICD-10 POOL (use verbatim)
- M54.50 — Low back pain, unspecified
- ...
```
Drop nulls. Pre-rewrite procedure prior notes into one-paragraph summaries (TS-side, deterministic, e.g. first 3 sentences) so the LLM stops being tempted by raw text.

**Files touched:** all three generators' user-message builders.

---

### 1.2 Add a global Voice & Style charter as the FIRST block of every system prompt

**Current state:**
Each prompt's first instructions are persona + length target + formatting rules ([generate-initial-visit.ts:41-85](src/lib/claude/generate-initial-visit.ts#L41), [generate-procedure-note.ts:205-225](src/lib/claude/generate-procedure-note.ts#L205), [generate-discharge-note.ts:216](src/lib/claude/generate-discharge-note.ts#L216)). Style rules ("Formal but concise. No filler. No redundancy.") are vague.

**Why it limits narrative quality:**
"No filler" without examples → inconsistent voice between drafts. Reviewers see drafts that read like a different clinician each time.

**Recommendation:**
Extract a `voice-charter.ts` module with explicit rules used by all three:
- **Sentence structure**: prefer simple declaratives; avoid stacked subordinate clauses; one clinical concept per sentence.
- **Verb tense**: past tense for procedure actions, present for current status, present perfect for trajectory.
- **Person**: third-person clinical narrative except section 15 (attestation) and section 16 (disclaimer) which are first-person.
- **Banned hedge words list**: "very", "quite", "somewhat", "fairly", "potentially", "it appears that".
- **Approved transition words**: small whitelist instead of letting the model invent.
- **Concrete-over-abstract** rule with two paired examples (one good, one bad).

Inject as a constant — same wording across all three prompts. Reduces draft-to-draft voice drift and is the single biggest reviewer-perceived quality boost.

---

### 1.3 Move ALL non-trivial branching out of the prompt and into TypeScript labels

**Current state:**
The procedure prompt has multi-page nested matrices: 9-cell paintone matrix ([generate-procedure-note.ts:243-276](src/lib/claude/generate-procedure-note.ts#L243)), series volatility 5-way ([procedure:278](src/lib/claude/generate-procedure-note.ts#L278)), plan-coherence 4-way ([procedure:312](src/lib/claude/generate-procedure-note.ts#L312)). Discharge has equivalent 9-cell tone matrix ([generate-discharge-note.ts:313](src/lib/claude/generate-discharge-note.ts#L313)).

**Why it limits narrative quality:**
- Long branching tables eat the model's working memory.
- Each cell is a separate prose instruction the model may misroute under load.
- Cell coverage gaps (e.g., what about `improved × stable`?) become subtle defects.

**Recommendation:**
Resolve the cell server-side and pass a single `narrativeDirective` field with: tone label, forbidden phrase short-list, required acknowledgement phrase, and one reference sentence. E.g.:
```json
{
  "narrativeDirective": {
    "tone": "mixed-with-final-uptick",
    "must_acknowledge": "modest uptick between penultimate and final injection",
    "forbidden_phrases": ["continued improvement since the prior injection"],
    "reference_sentence": "Cumulative pain decreased from 8/10 to 4/10 across the series, with a transient rise to 6/10 before final injection."
  }
}
```
The prompt then reads: "Use `narrativeDirective.tone` to shape subjective and assessment voice. Honor `must_acknowledge` and `forbidden_phrases` literally."

Cuts prompt length ~30%, removes routing risk, makes adding a new tone case a one-file TS change instead of a prompt edit.

**Files touched:** [pain-tone.ts](src/lib/claude/pain-tone.ts), [compute-plan-alignment.ts](src/lib/procedures/compute-plan-alignment.ts), all three generators.

---

### 1.4 Add a narrative-quality validator (not just numeric)

**Current state:**
Only discharge has a post-gen validator ([pain-trajectory-validator.ts:62](src/lib/claude/pain-trajectory-validator.ts#L62)) — it checks numbers, not prose. QC review agent ([generate-quality-review.ts](src/lib/claude/generate-quality-review.ts)) runs only after finalize.

**Why it limits narrative quality:**
Drafts ship with: forbidden phrases sneaking in via paraphrase ("near-complete resolution" ≈ "complete resolution"); section bleed (Section 7 ROS findings reappearing in Section 8 PE); date format drift; missing required attestation sentences.

**Recommendation:**
Build a deterministic post-gen checker `validateNarrative(sections, inputData) → Warning[]`:
- Regex-scan forbidden phrases including near-variants (fuzzy match on stem).
- Cross-section duplicate-line detector (Jaccard or shingled hash; flag if >70% overlap between any two sections' sentences).
- Date format scan: every `\d{4}-\d{2}-\d{2}` or "March 5, 2026" is a violation.
- Required-sentence presence (e.g., ">60 minutes", "verbalized understanding", time-documentation in Sec 15).
- Length floor/ceiling per section in characters (catch one-liner sections from Claude bailing).

Run synchronously after the LLM call, surface in `raw_ai_response.narrative_warnings`. Optional: auto-retrigger section regen on hard violations.

**Files touched:** new `src/lib/qc/narrative-validator.ts`, called from each action right after the LLM response.

---

### 1.5 Cache the system prompts with Anthropic prompt caching

**Current state:**
The procedure system prompt is ~700 lines of static text ([generate-procedure-note.ts:201-688](src/lib/claude/generate-procedure-note.ts#L201)). Discharge is ~250 lines static. Initial visit is ~300 lines, all module constants.

**Why it limits narrative quality:**
Indirect: high latency on every generation makes providers retry instead of edit, and high cost discourages section regen.

**Recommendation:**
Mark the system prompt as `cache_control: { type: 'ephemeral' }` on every call. Existing infrastructure exists per memory ([feedback_claude_max_tokens_truncation.md] referenced model behavior). Prior research at [2026-04-19-prompt-caching-current-state.md](thoughts/shared/research/2026-04-19-prompt-caching-current-state.md) covers status. Saves ~80% input cost and ~40% TTFB on warm cache, which makes section regen and narrative-quality retries economically viable.

---

## Tier 2 — Medium-Impact, Moderate Effort

### 2.1 Per-section generation, not single-shot 16-section tool call

**Current state:**
All three generators force one tool call with all sections filled simultaneously. Initial visit = 16 fields, procedure = 20, discharge = 12. `maxTokens: 16384`.

**Why it limits narrative quality:**
- Token budget pressure flattens later sections (model rushes Sections 14–16 of the IV note).
- Streaming progress is by-section-completion, but the model decides global pacing in one pass — no chance to reflect on Section 7 quality before writing Section 8.
- A single bad section forces full regen or per-section regen with no shared planning state.

**Recommendation:**
Two-pass generation:
1. **Pass 1 (cheap, Sonnet)**: Produce a structured outline JSON: per-section bullet points, key facts to include, length target. Validate outline against input data deterministically.
2. **Pass 2 (Opus, parallel per logical group)**: Generate sections in 3–4 parallel batches (e.g., history block, exam block, plan block) each with the outline + relevant inputData slice.

Trade-offs: 2× round trips, but each batch has more headroom and the outline catches "section 11 should reference imaging from section 9" issues before prose lands.

If too invasive, start with: **Plan pass + single-shot prose pass.** Outline pass alone catches most coherence defects.

---

### 2.2 Cross-note continuity engine

**Current state:**
- IV note has no prior context (initial_visit type).
- Procedure note pulls 5 of 20 sections from prior procedure notes ([procedure-notes.ts:188](src/actions/procedure-notes.ts#L188)).
- Discharge pulls IV + PT + PM + chiro + procedures separately, no shared "case narrative" object.

**Why it limits narrative quality:**
Each note re-states facts the next reader has already read. Discharge re-describes accident mechanism that's identical to IV section 2. Procedure note 3 re-describes PMH from procedure note 1 in slightly different words → inconsistency complaints from auditors.

**Recommendation:**
Introduce a `case_narrative_brief` table (or column on `cases`) that stores a canonical paragraph each for: accident mechanism, baseline complaint, response trajectory. Update it on IV finalize + after each procedure note finalize. All downstream generators receive it verbatim and are told: "These paragraphs are authoritative; do NOT rewrite, only reference."

Implementation: a single LLM call (Sonnet) on finalize that distills to 3 paragraphs, persisted. Future notes include it in the input bundle.

---

### 2.3 Procedure note: include PT data and raw chiro pain levels

**Current state:**
`buildPainObservations()` exists in [pain-observations.ts:161](src/lib/claude/pain-observations.ts#L161) and is used by discharge — but **never called from `procedure-notes.ts`** (gap documented by procedure analyzer). The procedure note loses PT pain ranges and raw chiro context.

**Why it limits narrative quality:**
Subjective section underutilizes available evidence. Reviewers ask "didn't the PT note say activity-level pain was 7/10?" — the LLM had no way to know.

**Recommendation:**
Wire `buildPainObservations` into `gatherProcedureNoteSourceData`. Pass into `inputData.painObservations`. Add a sentence to the procedure prompt's subjective section: "When 2+ supplementary observations exist, reference them in the second paragraph." Mirrors discharge behavior at [generate-discharge-note.ts:249](src/lib/claude/generate-discharge-note.ts#L249).

Low-risk, ~30 lines of code.

---

### 2.4 Pre-render forbidden-phrase guidance per section (not once globally)

**Current state:**
`forbiddenPrognosisPromptBlock()` is appended once near the prognosis instructions ([forbidden-phrases.ts](src/lib/qc/forbidden-phrases.ts)). The list is short (5 phrases) and applies only to prognosis.

**Why it limits narrative quality:**
Marketing/optimism leakage happens in patient_education and assessment too ("regenerative capacity", "definitive healing"). The procedure prompt has scattered ad-hoc forbidden lists in PRP prep and patient education ([generate-procedure-note.ts:201-688](src/lib/claude/generate-procedure-note.ts) — multiple inline mentions).

**Recommendation:**
Unify into a single `FORBIDDEN_PHRASES_BY_SECTION` map:
```ts
{
  prognosis: ['full recovery', 'cure', ...],
  patient_education: ['stimulates regeneration', 'promotes tissue regeneration', ...],
  procedure_prp_prep: ['highly concentrated growth factors', ...],
  assessment: ['definitive resolution', ...]
}
```
Inject per-section. Also feed the same map into the post-gen narrative validator (1.4) for symmetric enforcement.

---

### 2.5 Add referent-grounded few-shot pairs (not just inline reference strings)

**Current state:**
Each section has inline `Reference: "..."` strings ([generate-discharge-note.ts:379+](src/lib/claude/generate-discharge-note.ts#L379), procedure has 4 per-tone-branch examples for physical exam). They are in the system prompt as instruction text.

**Why it limits narrative quality:**
The model treats them as templates to lightly paraphrase. Quality varies sharply on edge cases (worsened-after-improvement, multi-region with one region unchanged).

**Recommendation:**
Convert top-3 reference examples to actual few-shot user/assistant message pairs in the API call:
```
messages: [
  { role: 'user', content: '<minimal sample inputData>' },
  { role: 'assistant', content: '<sample full note>' },
  { role: 'user', content: '<real inputData>' }
]
```
Reserve for highest-stakes cases (e.g., `mixed_with_regression` discharge). Few-shot pairs in the messages array steer the model harder than examples in the system text. Anthropic-recommended pattern.

Costs: shot examples count as input tokens — manageable with prompt caching (1.5).

---

### 2.6 Discharge: also pre-rewrite the patient education and plan-and-recommendations sections

**Current state:**
ICD-10 codes are pre-filtered into `diagnosisPool` ([discharge-notes.ts:465](src/actions/discharge-notes.ts#L465)). Pain trajectory is pre-rendered into `painTrajectoryText`. Prose sections are still free-form.

**Why it limits narrative quality:**
Patient education and plan sections are where boilerplate inconsistency creeps in across discharges (e.g., HEP language, return-to-clinic timing).

**Recommendation:**
Build `buildDischargeBoilerplateBlocks()` returning per-section starter paragraphs based on case attributes (PRP series complete, ongoing chiro, etc.). Pass as `inputData.boilerplateSeeds`. The prompt instructs: "Use boilerplateSeeds as the structural skeleton — adapt wording to the patient but preserve the clinical content."

Cuts variance, eases reviewer comparison across charts. Same pattern as `painTrajectoryText` mandate at [generate-discharge-note.ts:235](src/lib/claude/generate-discharge-note.ts#L235).

---

## Tier 3 — Exploratory / Higher Risk

### 3.1 Streaming reviewer-in-the-loop

Generate Section N → show to provider → accept/edit/regenerate → use accepted text as context for Section N+1. Trades latency for quality. Best for high-stakes initial visits.

### 3.2 Switch full generation to claude-opus-4-7

Initial visit and procedure use Opus 4.6 hardcoded ([generate-initial-visit.ts:605](src/lib/claude/generate-initial-visit.ts#L605), [generate-procedure-note.ts:763](src/lib/claude/generate-procedure-note.ts#L763)). Opus 4.7 (knowledge cutoff Jan 2026) is the latest. Run an A/B with sample charts; promote if reviewer-edit rate drops.

Prior research: [2026-03-14-opus-vs-sonnet-report-generation.md](thoughts/shared/research/2026-03-14-opus-vs-sonnet-report-generation.md) — re-evaluate with 4.7.

### 3.3 Provider-style adaptation layer

`tone_hint` is a per-note free-text field. Build a per-provider `narrative_style_profile` (sentence length avg, vocabulary preferences, transitional words) learned from finalized notes. Prepend to system prompt. Each provider sees notes that already "sound like them" → lower edit rate.

Privacy: stays within the clinic; just statistical features, not raw text.

### 3.4 Procedure note: actually use `diagnostic_studies_summary` and `supplies_used`

Both fetched but unreferenced in prompt (gap documented). `supplies_used` could power a deterministic "Supplies" sub-section. `diagnostic_studies_summary` could enrich the procedure_indication section's imaging citations.

### 3.5 Initial visit: feed PT/chiro/X-ray content when available

`hasApprovedDiagnosticExtractions` is computed but only used for visit-type detection ([initial-visit-notes.ts:62-325](src/actions/initial-visit-notes.ts)) — content is not passed. For pain_evaluation_visit type, the prompt would benefit from actual MRI text, not just `imaging_findings` in `caseSummary`.

---

## Detailed Findings (architecture map)

### Shared architecture across all three notes

- **Model**: Claude Opus 4.6 hardcoded everywhere. Sonnet 4.6 only as section-regen fallback.
- **Transport**: forced tool use via `tool_choice: { type: 'tool', name }`, streaming through `client.messages.stream` ([client.ts:106](src/lib/claude/client.ts#L106)).
- **Retry**: 2 API retries (3 total) on retryable HTTP errors with jittered exp backoff; 1 Zod retry (2 total) on schema failure; `max_tokens` detected and not retried ([client.ts:155](src/lib/claude/client.ts#L155)).
- **Token budget**: 16384 for full generation, 4096 for section regen.
- **Voice rules**: "Formal but concise. No filler. No redundancy." + PDF formatting (unicode bullet, ALL CAPS subheadings, MM/DD/YYYY dates) — three near-duplicate copies across the three system prompts.
- **Forbidden phrases**: only 5, only enforced on prognosis ([forbidden-phrases.ts](src/lib/qc/forbidden-phrases.ts)).
- **Section regen**: same system prompt with appended directive + optional `findingFix` for QC-driven rewrites.
- **Progress**: streaming `onProgress` callback fires on each completed top-level key; DB throttled to 500ms.
- **Generation lock**: prevents concurrent generation per (case, note) via `acquireGenerationLock` ([generation-lock.ts](src/lib/supabase/generation-lock.ts)).

### Initial Visit specifics

- 16 sections, 3 prompt blocks (preamble + common + visit-specific INITIAL_VISIT or PAIN_EVALUATION_VISIT).
- Visit-type-specific PRP protocol injection ([prp-protocol.ts](src/lib/clinical/prp-protocol.ts)).
- Null contract for initial_visit type: `caseSummary`, `imaging_findings`, `suggested_diagnoses`, `pmExtraction`, `priorVisitData` all forced null with explicit "do NOT reference" rules.
- Pain evaluation visit adds NUMERIC-ANCHOR pain trajectory mandate using `priorVisitData.vitalSigns.pain_score_max`.
- No few-shot examples in messages array — only inline `Reference:` strings.

### Procedure specifics

- 20 sections. Largest system prompt (~700 lines).
- Most sophisticated deterministic pre-computation: paintoneVsBaseline + paintoneVsPrevious + seriesVolatility + chiroProgress + planAlignment.
- 9-cell paintone matrix (vsBaseline × vsPrevious) with explicit per-cell narrative directives.
- Plan-coherence 4-way (aligned/deviation/unplanned/no_plan_on_file) with per-site mismatch info.
- Prior procedure notes raw-dumped (5 fields per prior note) — not summarized.
- **Gap**: `buildPainObservations` not wired in (PT + raw chiro not passed).
- **Gap**: `supplies_used`, `diagnostic_studies_summary` fetched but never referenced in prompt.

### Discharge specifics

- 12 sections, narrative engine is most numerically rigid.
- Deterministic pain trajectory text pre-built ([pain-trajectory.ts:125](src/lib/claude/pain-trajectory.ts#L125)) and mandated verbatim in subjective.
- `dischargeVisitPainDisplay` must appear in 4 sections (subjective, objective_vitals, assessment, prognosis).
- Diagnosis pool pre-filtered (V/W/X/Y exclusion, A→D suffix rewrite, M54.5→M54.50 upgrade) and passed as `diagnosisPool` for verbatim emission.
- Post-gen `pain-trajectory-validator.ts` regex-scans 4 sections for `X/10` patterns and warns on mismatches (non-fatal, stored in `raw_ai_response.trajectory_warnings`).
- `buildPainObservations` IS wired here — supplementary PT/PM/chiro pain ranges passed as `painObservations[]`.
- Tone hint guidance: `"Do NOT silently ignore the hint — apply it everywhere the rules allow."`

---

## Code References

- [src/lib/claude/generate-initial-visit.ts:41-85](src/lib/claude/generate-initial-visit.ts#L41-L85) — IV preamble + global rules
- [src/lib/claude/generate-initial-visit.ts:596-602](src/lib/claude/generate-initial-visit.ts#L596-L602) — IV user message construction (raw JSON.stringify + appended tone hint)
- [src/lib/claude/generate-procedure-note.ts:201-688](src/lib/claude/generate-procedure-note.ts#L201-L688) — procedure system prompt (~700 lines)
- [src/lib/claude/generate-procedure-note.ts:243-276](src/lib/claude/generate-procedure-note.ts#L243-L276) — 9-cell paintone matrix
- [src/lib/claude/generate-procedure-note.ts:312-334](src/lib/claude/generate-procedure-note.ts#L312-L334) — plan-coherence 4-way rules
- [src/lib/claude/generate-discharge-note.ts:212-464](src/lib/claude/generate-discharge-note.ts#L212-L464) — discharge system prompt
- [src/lib/claude/generate-discharge-note.ts:235-247](src/lib/claude/generate-discharge-note.ts#L235-L247) — DETERMINISTIC PAIN TRAJECTORY block
- [src/lib/claude/pain-tone.ts:54-66](src/lib/claude/pain-tone.ts#L54-L66) — paintone thresholds
- [src/lib/claude/pain-tone.ts:116-141](src/lib/claude/pain-tone.ts#L116-L141) — series volatility classifier
- [src/lib/claude/pain-trajectory.ts:125-333](src/lib/claude/pain-trajectory.ts#L125-L333) — discharge trajectory builder
- [src/lib/claude/pain-trajectory-validator.ts:62-116](src/lib/claude/pain-trajectory-validator.ts#L62-L116) — discharge post-gen numeric validator
- [src/lib/claude/pain-observations.ts:161-172](src/lib/claude/pain-observations.ts#L161-L172) — supplementary pain merger (used by discharge, NOT by procedure)
- [src/lib/claude/client.ts:99-160](src/lib/claude/client.ts#L99-L160) — retry + Zod retry + max_tokens detection
- [src/lib/qc/forbidden-phrases.ts](src/lib/qc/forbidden-phrases.ts) — 5 banned prognosis phrases + prompt block
- [src/lib/procedures/compute-plan-alignment.ts:335-397](src/lib/procedures/compute-plan-alignment.ts#L335-L397) — plan alignment classifier
- [src/lib/icd10/diagnosis-rewrite.ts:46](src/lib/icd10/diagnosis-rewrite.ts#L46) — `rewriteDiagnosesForDischarge`
- [src/actions/initial-visit-notes.ts:329-535](src/actions/initial-visit-notes.ts#L329-L535) — IV generation orchestration
- [src/actions/procedure-notes.ts:518-723](src/actions/procedure-notes.ts#L518-L723) — procedure orchestration
- [src/actions/discharge-notes.ts:613-832](src/actions/discharge-notes.ts#L613-L832) — discharge orchestration + post-gen trajectory refresh

---

## Architecture Documentation

### Deterministic-first signal pipeline

The codebase enforces a strong pattern: numbers, codes, and routing decisions are computed in TypeScript before the LLM ever sees them. The LLM contributes **prose** and **clinical interpretation**, not arithmetic.

Examples:
- Pain delta → label transform ([pain-tone.ts:54](src/lib/claude/pain-tone.ts#L54))
- Series volatility classification ([pain-tone.ts:116](src/lib/claude/pain-tone.ts#L116))
- ICD-10 filtering and rewriting ([diagnosis-rewrite.ts:46](src/lib/icd10/diagnosis-rewrite.ts#L46))
- Plan alignment status ([compute-plan-alignment.ts:335](src/lib/procedures/compute-plan-alignment.ts#L335))
- Pain trajectory arrow chain ([pain-trajectory.ts:283](src/lib/claude/pain-trajectory.ts#L283))

This is the right pattern. Tier 1.3 recommends extending it: today the LLM still sees the 9-cell matrix and routes itself. The matrix should resolve in TS into a single directive object.

### Section persistence model

Each note's sections are stored as separate columns in their respective tables (`initial_visit_notes`, `procedure_notes`, `discharge_notes`). Section regeneration writes back a single column. PDF templates read columns independently. Zod schemas validate `z.string()` per field with no length constraints.

This decoupling enables per-section regen but also means there is no enforced cross-section consistency at the DB layer. Tier 1.4's narrative validator would fill this gap.

### Tone & Direction integration

Identical pattern across all three: user-supplied free-text appended to the user message after the JSON blob, prefixed with `ADDITIONAL TONE/DIRECTION GUIDANCE FROM THE PROVIDER:`. Per memory [project_tone_direction_pattern.md] and [project_pre_generation_inputs_pattern.md], this is intentional isomorphism. Recommendations preserve the pattern; Tier 3.3 (per-provider style profile) extends it server-side.

---

## Related Research

- [2026-04-19-prompt-caching-current-state.md](thoughts/shared/research/2026-04-19-prompt-caching-current-state.md) — context for Tier 1.5
- [2026-03-14-opus-vs-sonnet-report-generation.md](thoughts/shared/research/2026-03-14-opus-vs-sonnet-report-generation.md) — context for Tier 3.2
- [2026-04-18-apply-medico-legal-editor-pass-to-procedure-note.md](thoughts/shared/research/2026-04-18-apply-medico-legal-editor-pass-to-procedure-note.md) — adjacent to Tier 1.4 narrative validator
- [2026-04-18-procedure-note-pain-persistence-tone.md](thoughts/shared/research/2026-04-18-procedure-note-pain-persistence-tone.md) — paintone history
- [2026-04-18-prp-procedure-physical-exam-improvement-tone.md](thoughts/shared/research/2026-04-18-prp-procedure-physical-exam-improvement-tone.md) — PE tone history

---

## Open Questions

1. Is there reviewer-edit telemetry (which sections get edited most)? Would prioritize Tier 1.4 forbidden-phrase variants and Tier 2.5 few-shot targets.
2. Are prompts already cached via `cache_control` and the memory note is stale? Need to verify before Tier 1.5.
3. How often do providers populate `tone_hint`? Low usage suggests UX or default-template change before Tier 3.3.
4. Acceptable latency budget per note? Two-pass generation (Tier 2.1) doubles roundtrips.
