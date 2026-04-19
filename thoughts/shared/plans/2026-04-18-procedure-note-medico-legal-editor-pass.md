# PRP Procedure Note — Medico-Legal Editor Pass (Prompt-Only)

**Status: PROPOSED**

## Overview

Absorb a set of defensibility-oriented directives from a medico-legal editor prompt into the existing PRP procedure-note generator. This plan is **scoped strictly to category-A prompt-only changes** identified in the companion research [2026-04-18-apply-medico-legal-editor-pass-to-procedure-note.md](../research/2026-04-18-apply-medico-legal-editor-pass-to-procedure-note.md) — directives that branch on data already in `ProcedureNoteInputData` and do not require schema, payload, or UI work.

Out of scope: guardian-signer capture (requires the schema work designed in [2026-04-08-procedure-consent-form.md](2026-04-08-procedure-consent-form.md)), a structured "issue log" output (requires a 21st field in the tool schema + Zod + PDF + UI), and `ptExtraction` threading into the procedure payload (optional enhancement for richer conservative-care citation).

## Current State Analysis

- The full `SYSTEM_PROMPT` lives at [generate-procedure-note.ts:105-245](src/lib/claude/generate-procedure-note.ts#L105-L245) and is 20 required output fields enforced by `PROCEDURE_NOTE_TOOL` at [L247-297](src/lib/claude/generate-procedure-note.ts#L247-L297).
- A `FORBIDDEN PHRASES (MANDATORY)` idiom already exists — in one place, at [L181](src/lib/claude/generate-procedure-note.ts#L181), applied to `objective_physical_exam` when `paintoneLabel = "improved"`.
- The `age` field is computed at `procedureRecord.procedure_date` via `computeAgeAtDate()` ([procedure-notes.ts:165](src/actions/procedure-notes.ts#L165)) and exposed as a top-level field on the input payload ([generate-procedure-note.ts:23](src/lib/claude/generate-procedure-note.ts#L23)). The prompt already instructs the model to use it verbatim ([L126](src/lib/claude/generate-procedure-note.ts#L126)).
- `procedureRecord.guidance_method ∈ {'ultrasound' | 'fluoroscopy' | 'landmark' | null}` ([014_prp_procedure_details.sql:18-23](supabase/migrations/014_prp_procedure_details.sql#L18-L23)) is threaded into the payload at [generate-procedure-note.ts:46](src/lib/claude/generate-procedure-note.ts#L46) but not referenced by the prompt.
- `procedureRecord.target_confirmed_imaging: boolean | null`, `injection_site: string | null`, `laterality: string | null` are all on the payload at [L33-L47](src/lib/claude/generate-procedure-note.ts#L33-L47) and unreferenced in the prompt today.
- All 14 PRP prep fields are nullable ([014_prp_procedure_details.sql](supabase/migrations/014_prp_procedure_details.sql)) and ride through `JSON.stringify(inputData, null, 2)` at [L315](src/lib/claude/generate-procedure-note.ts#L315) with their nulls visible to the model.
- `procedure_prp_prep` reference example at [L208](src/lib/claude/generate-procedure-note.ts#L208) contains the phrase **"a highly concentrated amount of growth factors intended to promote tissue repair"** — one of the exact phrases the medico-legal editor flags as marketing hype.
- `procedure_followup` reference at [L224](src/lib/claude/generate-procedure-note.ts#L224) already uses soft wording ("potential need for 1-2 additional PRP injections"); there is no hardcoded "Session N of 3" anywhere in the codebase. No `series_total` field exists on the `procedures` schema.
- Zero `minor`, `guardian`, `assent`, or `pediatric` tokens anywhere in the codebase; `procedure_preparation` consent language at [L202-204](src/lib/claude/generate-procedure-note.ts#L202-L204) is written in adult-patient voice only.
- Section-level regeneration reuses the same `SYSTEM_PROMPT` ([L344-373](src/lib/claude/generate-procedure-note.ts#L344-L373)), so any directive added here propagates to per-textarea "Regenerate" button flows at [procedure-note-editor.tsx:481-511](src/components/procedures/procedure-note-editor.tsx#L481-L511) automatically.
- An existing prompt-regression test suite at [generate-procedure-note.test.ts:81-159](src/lib/claude/__tests__/generate-procedure-note.test.ts#L81-L159) captures the system prompt and asserts on substring matches — the pattern for verifying each new directive landed.

## Desired End State

After this plan, the procedure-note prompt has five new prompt-only directives, each keyed off data already in `ProcedureNoteInputData`:

1. **Anti-marketing forbidden-phrase block** in `procedure_prp_prep`, `patient_education`, and `prognosis` — same idiom as the existing block at [L181](src/lib/claude/generate-procedure-note.ts#L181), listing the specific hype phrases to avoid.
2. **"No 'Session N of 3' unless documented"** directive in `procedure_followup` and `patient_education` — the prompt cannot invent a series total because none is stored.
3. **Bracketed `[confirm ...]` placeholders** when prep fields are null, in `procedure_prp_prep`, `procedure_anesthesia`, and `procedure_injection`.
4. **Diagnostic-coherence rule** in `procedure_indication` and `procedure_injection` — when `guidance_method ∈ {'ultrasound', 'landmark'}` and `injection_site` describes a paraspinal/periarticular target, do not describe the procedure as disc-directed.
5. **Age-conditional consent branch** in `procedure_preparation` — when `age < 18` (and `age != null`), phrase consent as guardian written consent + patient verbal assent in general terms; otherwise keep adult phrasing.

### Verification

- For a note generated with all prep fields null, `procedure_prp_prep` emits `[confirm ...]` placeholders rather than fabricated volumes / protocols / kit lot numbers.
- For a note with `guidance_method = 'ultrasound'` and `injection_site` containing "paraspinal" / "facet" / "sacroiliac", `procedure_indication` describes the target as periarticular / facet-capsular / paraspinal musculoligamentous — not as disc-directed.
- For a note with `age = 16`, `procedure_preparation` cites guardian written informed consent and patient verbal assent; for `age = 45` it keeps the adult reference phrasing.
- For any note, the literal phrase "highly concentrated growth factors" does not appear in `procedure_prp_prep`, and no generated note emits "Session 1 of 3" / "2 of 3" / "3 of 3" language.
- Prompt-regression tests in `generate-procedure-note.test.ts` assert each new directive's presence in the captured system prompt.

### Key Discoveries

- The existing `FORBIDDEN PHRASES (MANDATORY)` idiom at [L181](src/lib/claude/generate-procedure-note.ts#L181) is directly reusable for the anti-marketing and anti-"of 3" constraints — same `ALL-CAPS header + enumerated quoted list + if-you-reach-for-one-of-these instruction` structure.
- Every field each directive branches on is already serialized into the user message at [L315](src/lib/claude/generate-procedure-note.ts#L315) — the plan is entirely `SYSTEM_PROMPT` text edits plus tests.
- The prompt-regression test pattern at [generate-procedure-note.test.ts:84-89](src/lib/claude/__tests__/generate-procedure-note.test.ts#L84-L89) (`capturePrompt` helper that runs `generateProcedureNoteFromData` against a mocked `callClaudeTool` and reads `opts.system`) is the template for verifying each directive.
- Section-level regeneration uses the same `SYSTEM_PROMPT` — no separate regen-mode edits needed.

## What We're NOT Doing

- **No schema migrations.** `consent_obtained` stays a single boolean; no new guardian/signer fields.
- **No payload changes.** `ProcedureNoteInputData` is untouched; no `ptExtraction` threading, no new `conservative_care` field.
- **No tool-schema changes.** The 20-field output contract is preserved; no 21st "issue_log" field.
- **No UI changes.** The draft editor, per-section Regenerate button, and finalize→PDF flow are untouched.
- **No changes to the `paintoneLabel` / `chiroProgress` / `priorProcedures[]` mechanics** landed in [2026-04-18-procedure-note-pain-tone-improvements.md](2026-04-18-procedure-note-pain-tone-improvements.md) and [2026-04-18-procedure-note-physical-exam-improvement-tone.md](2026-04-18-procedure-note-physical-exam-improvement-tone.md) — those are the narrative-tone axis; this is the defensibility axis.
- **No backfill of existing finalized notes.** Finalized notes are signed-off clinical output and are not regenerated.
- **No discharge-note changes.** [generate-discharge-note.ts](src/lib/claude/generate-discharge-note.ts) has its own different tone profile and is outside this scope.
- **No guardian-name / signer-relationship capture.** The age-conditional branch in §5 is language-only and does not reference a specific signer; capturing signer identity is the separate work at [2026-04-08-procedure-consent-form.md](2026-04-08-procedure-consent-form.md).
- **No "Part 2 issue log" output.** The draft editor already surfaces `[confirm ...]` brackets for human review; a structured parallel log would require schema/UI work out of scope here.

## Implementation Approach

Each of the five directives is independent — they touch different sections of `SYSTEM_PROMPT` and can be added in any order. The plan runs one phase per directive so each can be reviewed on real cases before the next lands. Phase 6 is a test + regression-sweep wrap-up.

All phases edit the same file: [src/lib/claude/generate-procedure-note.ts](src/lib/claude/generate-procedure-note.ts). Each also appends tests to [src/lib/claude/__tests__/generate-procedure-note.test.ts](src/lib/claude/__tests__/generate-procedure-note.test.ts) using the existing `capturePrompt` helper.

---

## Phase 1: Anti-Marketing Forbidden-Phrase Block

### Overview

Add a `FORBIDDEN PHRASES (MANDATORY)` block — modeled on the existing one at [L181](src/lib/claude/generate-procedure-note.ts#L181) — to the three sections where the model is most likely to reach for marketing/hype language: `procedure_prp_prep`, `patient_education`, and `prognosis`. Replace the marketing phrase in the existing `procedure_prp_prep` reference example.

### Changes Required

#### 1. Replace the marketing phrase in the `procedure_prp_prep` reference

**File**: `src/lib/claude/generate-procedure-note.ts`
**Change**: In the block at [L206-L208](src/lib/claude/generate-procedure-note.ts#L206-L208), replace the reference sentence that currently reads "...containing a highly concentrated amount of growth factors intended to promote tissue repair" with a neutral clinical description.

New reference example (replacement):
> "Approximately 30 mL of venous blood was drawn from the patient's left arm using sterile technique. The sample was processed with a [confirm exact PRP preparation system] centrifuge for 15 minutes to separate platelet-rich plasma. The PRP was drawn into a sterile syringe for injection."

#### 2. Add the anti-marketing FORBIDDEN PHRASES block to `procedure_prp_prep`

Append to section 12 (after the new reference, before section 13):

```
FORBIDDEN PHRASES (MANDATORY) in procedure_prp_prep — do NOT use any of the following, anywhere in this section: "highly concentrated growth factors", "high concentration of growth factors", "concentrated healing factors", "regenerative capacity", "tissue regeneration". These are marketing phrases. Describe the PRP neutrally as "platelet-rich plasma" drawn into a sterile syringe. Do not make promotional claims about growth-factor concentration or tissue repair.
```

#### 3. Add a parallel block to `patient_education` (section 18)

In the block at [L231-L233](src/lib/claude/generate-procedure-note.ts#L231-L233), after the existing reference, append:

```
FORBIDDEN PHRASES (MANDATORY) in patient_education — do NOT use any of the following: "promotes tissue regeneration", "stimulates tissue regeneration", "enhances healing capacity", "accelerated healing", "regenerative medicine". Describe PRP neutrally (e.g., "PRP is intended to support the body's natural healing response at the injection site"). Avoid absolute claims about regeneration or definite healing outcomes.
```

#### 4. Add a parallel block to `prognosis` (section 19)

In the block at [L235-L238](src/lib/claude/generate-procedure-note.ts#L235-L238), append to the end:

```
FORBIDDEN PHRASES (MANDATORY) in prognosis — do NOT use any of the following: "full recovery is expected", "complete resolution of symptoms", "definitive healing", "cure", "guaranteed improvement". Prognosis language must remain measured — "guarded" or "guarded-to-favorable" as documented in the references above.
```

### Success Criteria

#### Automated Verification

- [ ] Type checking passes: `npx tsc --noEmit`
- [ ] Linting passes: `npm run lint` (no new errors vs. main)
- [ ] Existing procedure-note tests pass: `npx vitest run src/lib/claude/__tests__/generate-procedure-note.test.ts`
- [ ] New prompt-regression tests (added in Phase 6) lock down presence of the three new FORBIDDEN blocks in the captured system prompt
- [ ] `rg -n "highly concentrated" src/lib/claude/generate-procedure-note.ts` returns zero matches (only the forbidden-phrase list itself; the reference example no longer contains the phrase)

#### Manual Verification

- [ ] Generate a procedure note end-to-end → `procedure_prp_prep` output does NOT contain "highly concentrated growth factors" or "tissue repair"
- [ ] Regenerate `patient_education` via the per-section button → output does NOT contain "promotes tissue regeneration"
- [ ] Regenerate `prognosis` for a `paintoneLabel = "improved"` case → output uses "guarded-to-favorable" wording; no absolute healing claims

**Implementation Note**: After Phase 1 passes verification, pause for user confirmation. Compare 2-3 generated notes before/after on real cases to confirm tone shift is credible rather than overly stiff.

---

## Phase 2: "No 'Session N of 3' Unless Documented" Directive

### Overview

Add an explicit prohibition against inventing series totals in `procedure_followup` and `patient_education`. No data in the `procedures` schema stores a planned series length, so any "1 of 3" / "2 of 3" / "3 of 3" language would be fabrication. Keep the existing soft wording ("1-2 additional PRP injections may be considered") — that framing is the model of what we want.

### Changes Required

#### 1. Add the directive to `procedure_followup`

**File**: `src/lib/claude/generate-procedure-note.ts`
**Change**: In the block at [L222-L224](src/lib/claude/generate-procedure-note.ts#L222-L224), prepend a directive before the existing reference example:

```
16. procedure_followup (~2-3 sentences):
Return timeline, potential additional injections based on procedure_number in series.

SERIES-TOTAL RULE (MANDATORY): Do NOT state that this is "Session 1 of 3", "Session 2 of 3", "Session 3 of 3", or any specific X-of-N series position. The procedures schema does not store a planned series total, so any such number would be fabricated. Phrase additional injections conditionally: "additional PRP treatment may be considered depending on clinical response", "follow-up will determine whether further interventional treatment is indicated", or "the potential need for 1-2 additional PRP injections, depending on the degree of symptom improvement" — all neutral and non-committal. You MAY reference the procedure_number as an ordinal when describing the visit itself (e.g., "second PRP injection") because procedure_number counts completed procedures, not a planned total.

Reference: "Mr. Vardanyan will return for a follow-up in 2 weeks to assess his response to the injection. Additional PRP injections may be considered based on his progress. Patient was reminded of the potential need for 1-2 additional PRP injections, depending on the degree of symptom improvement."
```

#### 2. Add the same constraint to `patient_education`

In the block at [L231-L233](src/lib/claude/generate-procedure-note.ts#L231-L233), append (after the Phase-1 FORBIDDEN PHRASES block for marketing language):

```
SERIES-TOTAL RULE (MANDATORY) in patient_education: Do NOT commit the record to a specific future injection count ("3-injection series", "remaining 2 injections", "complete the series of 3"). Use conditional phrasing: "additional PRP treatment may be considered", "follow-up visits will determine next steps".
```

### Success Criteria

#### Automated Verification

- [ ] Type checking passes: `npx tsc --noEmit`
- [ ] Prompt-regression test (added in Phase 6) asserts both SERIES-TOTAL RULE blocks are present
- [ ] Existing procedure-note tests pass

#### Manual Verification

- [ ] Generate a note for `procedure_number = 1` → output does not contain "of 3" or "of 2" or "session 1 of"
- [ ] Generate a note for `procedure_number = 2` with 1 prior procedure → output describes this as the "second PRP injection" (ordinal ok) but does not commit to a total
- [ ] Regenerate `patient_education` → output uses conditional wording about future injections
- [ ] Spot-check: `rg -ni "of 3|of three|series of (3|three)" <generated output>` returns zero hits across 3 test cases

---

## Phase 3: Bracketed `[confirm ...]` Placeholders for Null Prep Fields

### Overview

Instruct the model to emit named bracket tokens rather than fabricating values when PRP prep / anesthesia / injection metadata fields are null on the input payload. All fields already ride through `JSON.stringify(inputData, null, 2)` at [generate-procedure-note.ts:315](src/lib/claude/generate-procedure-note.ts#L315) with their nulls visible, so no payload changes are needed.

The existing global guard at [L245](src/lib/claude/generate-procedure-note.ts#L245) ("Do not fabricate specific measurements") covers exam-time vitals; this phase extends the same principle to prep/procedural metadata with named bracket tokens that humans can search for in the draft editor.

### Changes Required

#### 1. Add placeholder instructions to `procedure_prp_prep` (section 12)

**File**: `src/lib/claude/generate-procedure-note.ts`
**Change**: In the block at [L206-L208](src/lib/claude/generate-procedure-note.ts#L206-L208) (which Phase 1 already revised), prepend a data-null directive:

```
12. procedure_prp_prep (~1 paragraph):
Blood draw volume from left arm, centrifuge duration, description of PRP product.

DATA-NULL RULE (MANDATORY): When a prep field is null on the input payload, emit a named bracket placeholder rather than fabricating a value. Use these exact tokens:
• procedureRecord.blood_draw_volume_ml null → "[confirm blood draw volume]"
• procedureRecord.centrifuge_duration_min null → "[confirm centrifuge duration]"
• procedureRecord.prep_protocol null → "[confirm exact PRP preparation system]"
• procedureRecord.kit_lot_number null → "[confirm kit lot number]"
Write the sentence normally using the non-null values; only substitute the bracket token where the underlying field is null. Do NOT invent a numeric volume, a duration in minutes, or a kit lot number.
```

#### 2. Add placeholder instructions to `procedure_anesthesia` (section 13)

In the block at [L210-L212](src/lib/claude/generate-procedure-note.ts#L210-L212), prepend:

```
DATA-NULL RULE (MANDATORY): Emit named bracket placeholders when fields are null:
• procedureRecord.anesthetic_agent null → "[confirm anesthetic agent]"
• procedureRecord.anesthetic_dose_ml null → "[confirm anesthetic dose in mL]"
• procedureRecord.patient_tolerance null → omit the tolerance sentence entirely rather than fabricate one
```

#### 3. Add placeholder instructions to `procedure_injection` (section 14)

In the block at [L214-L216](src/lib/claude/generate-procedure-note.ts#L214-L216), prepend:

```
DATA-NULL RULE (MANDATORY): Emit named bracket placeholders when fields are null:
• procedureRecord.guidance_method null → "[confirm guidance method]"
• procedureRecord.needle_gauge null → "[confirm needle gauge]"
• procedureRecord.injection_volume_ml null → "[confirm site-specific injectate distribution]"
• procedureRecord.target_confirmed_imaging null → omit the imaging-confirmation sentence rather than fabricate one
• procedureRecord.complications null → describe as "no complications were noted" (this is the documented default when the field is null on an otherwise-completed procedure)
```

### Success Criteria

#### Automated Verification

- [ ] Type checking passes: `npx tsc --noEmit`
- [ ] Prompt-regression tests (added in Phase 6) assert each of the 10 bracket tokens appears literally in the captured system prompt
- [ ] Existing procedure-note tests pass

#### Manual Verification

- [ ] Build an `emptyInput` procedure (all prep fields null) and generate → `procedure_prp_prep` output contains `[confirm exact PRP preparation system]` and `[confirm blood draw volume]`, not fabricated numeric volumes
- [ ] Generate a note with `guidance_method = 'ultrasound'` and `injection_volume_ml = null` → output mentions ultrasound guidance (real data) but uses `[confirm site-specific injectate distribution]` in place of a volume
- [ ] Provider regenerates `procedure_anesthesia` section with `anesthetic_agent = null` → output emits `[confirm anesthetic agent]` bracket rather than defaulting to "1% lidocaine"
- [ ] When all fields ARE populated, output contains zero `[confirm ...]` brackets (directive is purely conditional)

**Implementation Note**: After Phase 3 passes, review one note with fully populated prep data and one with several null fields side-by-side. Confirm the bracketed version reads as a real draft flagged for confirmation rather than as malformed output.

---

## Phase 4: Diagnostic-Coherence Rule (No Disc-Directed Language for Paraspinal Targets)

### Overview

When the documented technique is ultrasound-guided or landmark-based (not fluoroscopy-guided intradiscal), the `procedure_indication` and `procedure_injection` sections must not describe the procedure as disc-directed. The current `procedure_indication` reference at [L200](src/lib/claude/generate-procedure-note.ts#L200) reads *"PRP injection to promote joint healing and reduce inflammation due to the 3.2 mm disc protrusion at L5-S1"* — which implies disc-directed healing when the technique is commonly periarticular/facet-capsular.

This phase adds a prompt-level rule that branches on `guidance_method` and `injection_site` to keep the indication language consistent with what the procedure actually did.

### Changes Required

#### 1. Add the diagnostic-coherence rule to `procedure_indication` (section 10)

**File**: `src/lib/claude/generate-procedure-note.ts`
**Change**: In the block at [L198-L200](src/lib/claude/generate-procedure-note.ts#L198-L200), prepend:

```
10. procedure_indication (~1-3 bullets):
Bullet per injection site referencing specific imaging finding with measurements.

TARGET-COHERENCE RULE (MANDATORY): The language describing what this injection treats must match the documented technique on procedureRecord.guidance_method. Do NOT describe the procedure as disc-directed or intradiscal unless guidance_method = "fluoroscopy" AND the injection_site explicitly names an intradiscal target.
• When guidance_method = "ultrasound" OR guidance_method = "landmark" — describe targets as periarticular, facet-capsular, paraspinal musculoligamentous, or sacroiliac/sacroiliac-adjacent as appropriate to injection_site. Reference imaging findings as the clinical rationale, NOT as the structure being directly injected. Example: "PRP injection to periarticular and facet-capsular structures adjacent to the L5-S1 level, where imaging demonstrates a 3.2 mm disc protrusion with associated facet arthropathy."
• When guidance_method = "fluoroscopy" — intradiscal / epidural / transforaminal language may be used only when supported by injection_site and documented in the chart.
• When guidance_method is null — use neutral periarticular / paraspinal language and emit "[confirm guidance method]" inline rather than fabricating a technique.

AVOID in this section: "injection to promote disc healing", "disc-directed regeneration", "intradiscal PRP" (unless fluoroscopy-documented).
```

#### 2. Add a corresponding rule to `procedure_injection` (section 14)

In the block at [L214-L216](src/lib/claude/generate-procedure-note.ts#L214-L216) (already touched by Phase 3), append after the DATA-NULL RULE:

```
TARGET-COHERENCE RULE (MANDATORY): The described target must be consistent with guidance_method:
• guidance_method = "ultrasound" → describe needle placement as periarticular / facet-capsular / paraspinal / sacroiliac; do NOT describe the needle as entering a disc unless explicitly documented
• guidance_method = "landmark" → describe surface-landmark placement; avoid intradiscal or epidural claims
• guidance_method = "fluoroscopy" → intradiscal / epidural / transforaminal language permitted only when injection_site documents that level
```

#### 3. Update the `procedure_indication` reference example

Replace the existing reference at [L200](src/lib/claude/generate-procedure-note.ts#L200) — currently implies disc-directed healing:

> Old: "• PRP injection to promote joint healing and reduce inflammation due to the 3.2 mm disc protrusion at L5-S1, with increased T2 signal extending to the right lateral recess..."

With a coherence-respecting reference:

> New: "• PRP injection to periarticular and facet-capsular structures at L5-S1, where MRI demonstrates a 3.2 mm disc protrusion with increased T2 signal extending to the right lateral recess and associated facet arthropathy, as the clinical rationale for intervention."

### Success Criteria

#### Automated Verification

- [ ] Type checking passes: `npx tsc --noEmit`
- [ ] Prompt-regression test asserts `TARGET-COHERENCE RULE` appears in both `procedure_indication` and `procedure_injection` sections
- [ ] Prompt-regression test asserts the three guidance-method branches are all named literally in the captured prompt
- [ ] Existing procedure-note tests pass

#### Manual Verification

- [ ] Generate a note with `guidance_method = 'ultrasound'` and `injection_site = 'lumbar paraspinal'` → `procedure_indication` describes periarticular / facet-capsular targets; does NOT contain "intradiscal", "disc-directed", or "disc healing"
- [ ] Generate a note with `guidance_method = 'fluoroscopy'` and an explicit intradiscal injection_site → intradiscal language is permitted
- [ ] Generate a note with `guidance_method = null` → `procedure_indication` uses neutral periarticular language and emits `[confirm guidance method]` inline
- [ ] `procedure_injection` prose does not contradict `procedure_indication` on target anatomy (spot-check 3 generated notes)

**Implementation Note**: This is the most substantive tone change in the plan. Review 5 real cases across guidance methods before marking complete — the rule has to feel natural, not stilted.

---

## Phase 5: Age-Conditional Consent Branch for Minors

### Overview

When `age < 18` (and `age != null`), phrase `procedure_preparation` consent as guardian written informed consent + patient verbal assent in general terms. When `age >= 18` or `age = null`, keep the existing adult reference phrasing unchanged.

The branch is language-only — it does not reference a specific signer by name or relationship, because neither is captured in the schema today (`consent_obtained` is the only consent field; see [013_prp_procedure_encounter.sql:8](supabase/migrations/013_prp_procedure_encounter.sql#L8) and the unimplemented [2026-04-08-procedure-consent-form.md](2026-04-08-procedure-consent-form.md)).

### Changes Required

#### 1. Add the age-conditional branch to `procedure_preparation` (section 11)

**File**: `src/lib/claude/generate-procedure-note.ts`
**Change**: In the block at [L202-L204](src/lib/claude/generate-procedure-note.ts#L202-L204), prepend a directive and provide two reference examples:

```
11. procedure_preparation (~1 paragraph):
Consent, positioning, sterile prep with chlorhexidine/betadine, time-out.

MINOR-PATIENT CONSENT BRANCH (MANDATORY): Branch consent language on the top-level "age" field.
• When age is null or age >= 18 — use adult consent phrasing: "Informed consent was obtained from the patient."
• When age < 18 — phrase consent as guardian written informed consent plus patient verbal assent: "Written informed consent was obtained from the patient's parent/legal guardian, and verbal assent was obtained from the patient. The procedure, risks, benefits, and alternatives were discussed in age-appropriate terms." Do NOT invent a specific signer name or relationship (e.g., "mother", "father", "John Doe, legal guardian") — the chart does not capture that identity today. Keep the phrasing general.

Reference (adult, age >= 18 or null): "Informed consent was obtained from the patient. The risks, benefits, and alternatives of the PRP procedure were thoroughly explained, including potential for increased pain, infection, bleeding, and the need for additional injections. The patient was positioned in the prone position on the procedure table. The lumbar region was prepped with chlorhexidine/betadine in a sterile fashion and draped appropriately. A time-out was performed to confirm patient identity, procedure, and site of injection."
Reference (minor, age < 18): "Written informed consent was obtained from the patient's parent/legal guardian, and verbal assent was obtained from the patient. The risks, benefits, and alternatives of the PRP procedure were thoroughly explained in age-appropriate terms, including potential for increased pain, infection, bleeding, and the need for additional injections. The patient was positioned in the prone position on the procedure table. The lumbar region was prepped with chlorhexidine/betadine in a sterile fashion and draped appropriately. A time-out was performed to confirm patient identity, procedure, and site of injection."
```

### Success Criteria

#### Automated Verification

- [ ] Type checking passes: `npx tsc --noEmit`
- [ ] Prompt-regression test asserts `MINOR-PATIENT CONSENT BRANCH` appears in the captured prompt
- [ ] Prompt-regression test asserts both reference examples (adult and minor) appear literally
- [ ] Existing procedure-note tests pass

#### Manual Verification

- [ ] Generate a note with `age = 16` → `procedure_preparation` output contains "parent/legal guardian" and "verbal assent"
- [ ] Generate a note with `age = 16` → output does NOT contain a fabricated signer name or relationship (e.g., "mother")
- [ ] Generate a note with `age = 45` → `procedure_preparation` output uses the adult reference phrasing, no guardian/assent language
- [ ] Generate a note with `age = null` → output defaults to adult phrasing (safe default)
- [ ] Regenerate `procedure_preparation` via the per-section button for a minor → directive applies identically

**Implementation Note**: The minor branch is language-only — the provider can edit the finalized note to insert a specific guardian name / relationship before finalizing to PDF. Flag this to the clinical team when the phase lands so they know the draft will need a human edit pass for minor patients until the [2026-04-08-procedure-consent-form.md](2026-04-08-procedure-consent-form.md) signer-capture work is implemented.

---

## Phase 6: Prompt-Regression Tests and Wrap-Up

### Overview

Lock down every new directive with substring-match tests against the captured system prompt, using the `capturePrompt` helper established at [generate-procedure-note.test.ts:84-89](src/lib/claude/__tests__/generate-procedure-note.test.ts#L84-L89). Sweep for regressions in untouched sections.

### Changes Required

#### 1. Add a new test suite block

**File**: `src/lib/claude/__tests__/generate-procedure-note.test.ts`
**Change**: Append after the existing `SYSTEM_PROMPT — objective_physical_exam branching` describe block (after [L159](src/lib/claude/__tests__/generate-procedure-note.test.ts#L159)):

```ts
describe('SYSTEM_PROMPT — medico-legal editor pass (phases 1-5)', () => {
  beforeEach(() => vi.clearAllMocks())

  async function capturePrompt(input: ProcedureNoteInputData): Promise<string> {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData(input)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    return opts.system as string
  }

  // Phase 1 — anti-marketing
  it('includes the anti-marketing FORBIDDEN PHRASES block in procedure_prp_prep', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('FORBIDDEN PHRASES (MANDATORY) in procedure_prp_prep')
    expect(system).toContain('highly concentrated growth factors')
    expect(system).toContain('tissue regeneration')
  })
  it('includes the anti-marketing FORBIDDEN PHRASES block in patient_education', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('FORBIDDEN PHRASES (MANDATORY) in patient_education')
    expect(system).toContain('regenerative medicine')
  })
  it('includes the anti-absolute-claim FORBIDDEN PHRASES block in prognosis', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('FORBIDDEN PHRASES (MANDATORY) in prognosis')
    expect(system).toContain('full recovery is expected')
    expect(system).toContain('guaranteed improvement')
  })
  it('no longer contains the "highly concentrated amount of growth factors" marketing phrase in the prp_prep reference', async () => {
    const system = await capturePrompt(emptyInput)
    // The phrase may appear in the FORBIDDEN list (as the banned phrase) but
    // must NOT appear in the reference example. Verify by checking the reference
    // example substring specifically.
    expect(system).not.toContain('containing a highly concentrated amount of growth factors')
  })

  // Phase 2 — series-total
  it('includes the SERIES-TOTAL RULE in procedure_followup', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('SERIES-TOTAL RULE (MANDATORY)')
    expect(system).toContain('Session 1 of 3')
    expect(system).toContain('Session 3 of 3')
    expect(system).toContain('additional PRP treatment may be considered')
  })
  it('includes the SERIES-TOTAL RULE in patient_education', async () => {
    const system = await capturePrompt(emptyInput)
    // The rule appears twice (once per section) — the patient_education copy
    // references "3-injection series" as a forbidden phrasing.
    expect(system).toContain('SERIES-TOTAL RULE (MANDATORY) in patient_education')
    expect(system).toContain('3-injection series')
  })

  // Phase 3 — bracketed placeholders
  it.each([
    '[confirm blood draw volume]',
    '[confirm centrifuge duration]',
    '[confirm exact PRP preparation system]',
    '[confirm kit lot number]',
    '[confirm anesthetic agent]',
    '[confirm anesthetic dose in mL]',
    '[confirm guidance method]',
    '[confirm needle gauge]',
    '[confirm site-specific injectate distribution]',
  ])('includes the "%s" placeholder token in the system prompt', async (token) => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain(token)
  })
  it('includes the DATA-NULL RULE header in procedure_prp_prep, procedure_anesthesia, and procedure_injection', async () => {
    const system = await capturePrompt(emptyInput)
    const occurrences = system.match(/DATA-NULL RULE \(MANDATORY\)/g) ?? []
    expect(occurrences.length).toBeGreaterThanOrEqual(3)
  })

  // Phase 4 — diagnostic coherence
  it('includes the TARGET-COHERENCE RULE in procedure_indication with all three guidance branches', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('TARGET-COHERENCE RULE (MANDATORY)')
    expect(system).toMatch(/guidance_method = "ultrasound"[\s\S]*?periarticular/)
    expect(system).toMatch(/guidance_method = "fluoroscopy"[\s\S]*?intradiscal/)
    expect(system).toMatch(/guidance_method = "landmark"[\s\S]*?surface-landmark/)
  })
  it('replaces the disc-directed reference example in procedure_indication', async () => {
    const system = await capturePrompt(emptyInput)
    // The old reference read "promote joint healing and reduce inflammation due to
    // the 3.2 mm disc protrusion at L5-S1" — we replaced it with a
    // periarticular/facet-capsular reference.
    expect(system).not.toContain('PRP injection to promote joint healing and reduce inflammation due to the 3.2 mm disc protrusion')
    expect(system).toContain('periarticular and facet-capsular structures at L5-S1')
  })

  // Phase 5 — minor-patient consent
  it('includes the MINOR-PATIENT CONSENT BRANCH with both age conditions', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('MINOR-PATIENT CONSENT BRANCH (MANDATORY)')
    expect(system).toContain('When age is null or age >= 18')
    expect(system).toContain('When age < 18')
    expect(system).toContain('parent/legal guardian')
    expect(system).toContain('verbal assent')
  })
  it('includes both adult and minor reference examples for procedure_preparation', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('Reference (adult, age >= 18 or null)')
    expect(system).toContain('Reference (minor, age < 18)')
  })
})
```

#### 2. Regression sweep

**File**: (no code change)
**Change**: Run these searches and confirm zero new regressions:

```bash
# No marketing phrase in the reference example (only in the forbidden list)
rg -n "highly concentrated amount of growth factors" src/lib/claude/generate-procedure-note.ts

# No "Session N of 3" style language escaped into the prompt by accident
rg -n "of 3|of three" src/lib/claude/generate-procedure-note.ts

# All 9 named bracket tokens present
rg -cn '\[confirm ' src/lib/claude/generate-procedure-note.ts  # expect >= 9
```

#### 3. End-to-end smoke test matrix

On a staging environment, generate notes for all cells of this matrix and visually verify output:

| Scenario | `age` | `guidance_method` | Prep fields | Expected signals |
|---|---|---|---|---|
| Adult, full data, US paraspinal | 45 | `ultrasound` | populated | Periarticular language in indication; no marketing; no "of 3"; adult consent; no brackets |
| Minor, full data, US paraspinal | 16 | `ultrasound` | populated | Guardian/assent consent; periarticular language; no marketing; no brackets |
| Adult, null prep data | 45 | `null` | all null | `[confirm ...]` placeholders in prp_prep, anesthesia, injection; adult consent |
| Adult, fluoroscopy intradiscal | 45 | `fluoroscopy` | populated | Intradiscal language permitted in indication; no marketing; adult consent |
| Adult, 3rd procedure in series | 45 | `ultrasound` | populated | "second PRP injection" ordinal usage permitted; no "2 of 3"/"3 of 3" language |

### Success Criteria

#### Automated Verification

- [ ] All new tests pass: `npx vitest run src/lib/claude/__tests__/generate-procedure-note.test.ts`
- [ ] Full vitest suite passes (no new regressions): `npx vitest run`
- [ ] Type checking passes: `npx tsc --noEmit`
- [ ] Linting: no new errors vs. main
- [ ] Regression sweep commands (above) return the expected results

#### Manual Verification

- [ ] All five smoke-test matrix rows produce output matching the "Expected signals" column
- [ ] Per-section regeneration works for all five new directives (the regeneration path at [generate-procedure-note.ts:344-373](src/lib/claude/generate-procedure-note.ts#L344-L373) shares the same SYSTEM_PROMPT — verify empirically, do not assume)
- [ ] No regressions in `subjective`, `review_of_systems`, `assessment_summary`, `prognosis`, or `objective_physical_exam` — the tone-axis sections from prior pain-tone work should behave identically
- [ ] PDF rendering is unchanged (spot-check one finalized note with all 5 directives exercised)

---

## Testing Strategy

### Unit Tests

- No new unit tests beyond the prompt-regression test suite in Phase 6. All directives are prompt-text edits; there is no new TypeScript logic to unit-test.

### Prompt-Regression Tests

- Each new directive is asserted by substring match against the captured `opts.system` string using the `capturePrompt` helper already established at [generate-procedure-note.test.ts:84-89](src/lib/claude/__tests__/generate-procedure-note.test.ts#L84-L89).
- The test matrix in Phase 6 covers: (a) every new MANDATORY rule header, (b) every named bracket token, (c) every guidance-method branch, (d) the minor/adult age condition, (e) the removal of the disc-directed reference and the marketing-phrase reference.

### Integration Tests

- The existing procedure-note generator test at [generate-procedure-note.test.ts](src/lib/claude/__tests__/generate-procedure-note.test.ts) continues to pass with no shape changes to `ProcedureNoteInputData`.
- No new integration tests required — this plan does not touch `gatherProcedureNoteSourceData`, the tool schema, the Zod validator, or the PDF renderer.

### Manual Testing Steps

The smoke-test matrix in Phase 6 is the core. Additional targeted checks:

1. **Adult / minor contrast**: generate the same case twice, once with a DOB that produces `age = 17` at procedure date, once with `age = 18`. Confirm the consent language flips on the age boundary.
2. **Bracket opt-out**: generate a case with ALL prep fields populated. Confirm zero `[confirm ...]` brackets appear (directive is purely conditional on nullness).
3. **Per-section regeneration**: for each of the 5 directives, regenerate its target section individually via the editor button and confirm the directive applies identically (because the regeneration path shares `SYSTEM_PROMPT`).
4. **PDF finalize round-trip**: finalize a note that exercises all 5 directives. Confirm brackets render in the PDF as-is (they are a signal for the provider to edit before finalizing).

## Performance Considerations

- `SYSTEM_PROMPT` grows by approximately 2-3 KB of instructional text. Claude Opus 4.7's input-token cost per call rises correspondingly (roughly +500 tokens). This is the only performance impact.
- No new queries, no new payload fields, no new network hops. `gatherProcedureNoteSourceData` is untouched.
- Per-section regeneration calls the same (larger) system prompt — same token-cost delta per regeneration.

## Migration Notes

- **No database migrations.**
- **No backfill of existing finalized notes.** Finalized notes are signed-off clinical output; they are not regenerated. This is consistent with the pattern established in [2026-04-18-procedure-note-pain-tone-improvements.md](2026-04-18-procedure-note-pain-tone-improvements.md).
- **Draft notes in-flight**: any procedure note that exists in `draft` status at the time Phase 1 lands will pick up the new directives on next regeneration (either full or per-section). This is the intended behavior — draft notes are explicitly re-runnable.
- **Rollback**: if any phase produces bad output in production, revert the commit for that phase. All phases are additive text edits to `SYSTEM_PROMPT` with no data or schema coupling, so reverting one phase does not affect the others.

## References

- Research: [thoughts/shared/research/2026-04-18-apply-medico-legal-editor-pass-to-procedure-note.md](../research/2026-04-18-apply-medico-legal-editor-pass-to-procedure-note.md)
- Companion research on physical-exam tone: [thoughts/shared/research/2026-04-18-prp-procedure-physical-exam-improvement-tone.md](../research/2026-04-18-prp-procedure-physical-exam-improvement-tone.md)
- Prior landed tone plan: [thoughts/shared/plans/2026-04-18-procedure-note-pain-tone-improvements.md](2026-04-18-procedure-note-pain-tone-improvements.md)
- Prior landed physical-exam plan: [thoughts/shared/plans/2026-04-18-procedure-note-physical-exam-improvement-tone.md](2026-04-18-procedure-note-physical-exam-improvement-tone.md)
- Unimplemented consent-signer plan (out of scope here): [thoughts/shared/plans/2026-04-08-procedure-consent-form.md](2026-04-08-procedure-consent-form.md)
- Current procedure-note prompt: [src/lib/claude/generate-procedure-note.ts:105-245](src/lib/claude/generate-procedure-note.ts#L105-L245)
- Current input gathering: [src/actions/procedure-notes.ts:29-261](src/actions/procedure-notes.ts#L29-L261)
- Existing FORBIDDEN PHRASES idiom: [src/lib/claude/generate-procedure-note.ts:181](src/lib/claude/generate-procedure-note.ts#L181)
- Prompt-regression test pattern: [src/lib/claude/__tests__/generate-procedure-note.test.ts:81-159](src/lib/claude/__tests__/generate-procedure-note.test.ts#L81-L159)
- Per-section regeneration (shares SYSTEM_PROMPT): [src/lib/claude/generate-procedure-note.ts:344-373](src/lib/claude/generate-procedure-note.ts#L344-L373)
- 14 PRP prep detail fields source: [supabase/migrations/014_prp_procedure_details.sql:6-30](supabase/migrations/014_prp_procedure_details.sql#L6-L30)
- `consent_obtained` boolean source: [supabase/migrations/013_prp_procedure_encounter.sql:8](supabase/migrations/013_prp_procedure_encounter.sql#L8)
