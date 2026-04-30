---
date: 2026-04-30T22:35:00Z
researcher: arsenaid
git_commit: a3dbf5ae530af19149ca8e7077cd17fc6cb0e737
branch: main
repository: cliniq
topic: "Deterministic ICD-10 suffix-rewrite + 7th-character/external-cause QC validators"
tags: [plan, qc, icd-10, case-quality-review, validators, root-fix]
status: ready
last_updated: 2026-04-30
last_updated_by: arsenaid
last_updated_note: "Added root-fix phases (storage A→D rewrite + external-cause strip + discharge pre-gen filter) ahead of validator phases"
---

# Deterministic ICD-10 Suffix-Rewrite + QC Validators

## Overview

Two-tier fix attacking the same problem at storage AND at audit:

**Tier 1 — Root fix (Phases 1-4)**: prevent A-suffix and external-cause leaks at the source. `procedures.diagnoses` jsonb today inherits A-suffix codes from IV/PM extraction and never rewrites them; every procedure note ≥2 and every discharge re-faces the same broken input. Add deterministic A→D rewrite at `createPrpProcedure` / `updatePrpProcedure` for `procedure_number ≥ 2`, and external-cause strip at procedure + discharge write paths. Add discharge pre-generation diagnosis-pool filter so the LLM never sees A-suffix or V/W/X/Y on the discharge step.

**Tier 2 — Audit backstop (Phases 5-7)**: deterministic TS validators run post-LLM inside `runCaseQualityReview`. Replace fuzzy LLM-paraphrased QC findings ("ICD-10 7th-character integrity; mismatched suffix vs. descriptor will be flagged on coding review", "External cause code continuity across the chain") with hash-stable findings the provider can auto-verify. Catches violations the rewrite missed (e.g. legacy data, extraction edge cases).

Two validators in the audit tier:

1. **`validateExternalCauseChain`** — V/W/X/Y codes must appear at IV, must NOT appear at any procedure note or discharge. Cross-step finding when violated.
2. **`validateSeventhCharacterIntegrity`** — A-suffix codes (initial encounter) must not appear at discharge; "A"-suffix on procedure notes ≥2 must downgrade to "D"; M54.5 parent without 5th-character subcode at any step.

Both produce structured `QualityFinding` rows with stable `message` text — same input → same hash, every run. Wire `verifyFinding` to dispatch on these new finding kinds against the same upstream data the validators read.

This decouples the two flag categories from Opus paraphrase. LLM Rule 1 stays for everything outside the two deterministic categories (e.g. "radiculopathy emerging without imaging support" — still requires LLM judgment).

## Why root fix first

| Layer | Tier 2 only (validators alone) | Tier 1 + Tier 2 |
|---|---|---|
| When violation surfaces | post-finalize, in QC review | never persisted |
| Provider effort | regen note + verify per finding | zero — wrong code can't ship |
| Defensibility | depends on provider catching flag + acting | structural — storage rejects A-suffix at procedure ≥2 |
| LLM trust | model still picks D (or doesn't) | model only writes prose; codes deterministic |

Tier 2 alone is a safety net. Tier 1 closes the leak.

## Current State Analysis

Confirmed via direct file reads (commit `a3dbf5a`):

- [src/lib/claude/generate-quality-review.ts:109](../../src/lib/claude/generate-quality-review.ts) — single Rule 1 line is the source of both flag strings. Opus paraphrases freely; messages are not hash-stable across runs because slight rewordings produce different sha256 inputs.
- [src/lib/validations/case-quality-review.ts:101-111](../../src/lib/validations/case-quality-review.ts) — `computeFindingHash` over `severity|step|note_id|procedure_id|section_key|message`. Stable inputs ⇒ stable hash.
- [src/actions/case-quality-reviews.ts:347-379](../../src/actions/case-quality-reviews.ts) — `runCaseQualityReview` writes `findings` directly from LLM result. No post-processing today.
- [src/actions/case-quality-reviews.ts:655-752](../../src/actions/case-quality-reviews.ts) — `verifyFinding` dispatches by `step`: `procedure` (plan_alignment_status) and `discharge` (trajectory_warnings) only. `cross_step` finding types fall through to the generic `'Verify not supported'` error.
- [src/lib/icd10/validation.ts](../../src/lib/icd10/validation.ts) — only structural check + `M54.5 → M54.50` non-billable parent map. No 7th-character logic.
- [src/lib/claude/generate-initial-visit.ts:130-134](../../src/lib/claude/generate-initial-visit.ts) — accident_type → V/W mapping (V43.52XA / W01.0XXA / W18.49XA). Authoritative source for IV external-cause expectation.
- [src/lib/claude/generate-procedure-note.ts:593-602](../../src/lib/claude/generate-procedure-note.ts) — Filter (A) absolute V/W/X/Y omission on procedure notes; Filter (D) prefer "D" suffix on repeat visits.
- [src/lib/claude/generate-discharge-note.ts:408-419](../../src/lib/claude/generate-discharge-note.ts) — Filter (A) absolute V/W/X/Y omission at discharge; Filter (D) no "A" suffix at discharge.
- [src/lib/icd10/parse-ivn-diagnoses.ts:11-25](../../src/lib/icd10/parse-ivn-diagnoses.ts) — already extracts `{ icd10_code, description }` per line from `initial_visit_notes.diagnoses` text. Reusable.
- `procedure_notes.diagnoses` not stored on the note row — sourced from `procedures.diagnoses` jsonb. `gatherSourceData` already loads this at [case-quality-reviews.ts:184](../../src/actions/case-quality-reviews.ts).
- `discharge_notes.diagnoses` is free-text, same format as IVN. `parseIvnDiagnoses` works for it.

## Desired End State

- [src/lib/icd10/](../../src/lib/icd10/) gains:
  - `external-cause.ts` — `EXTERNAL_CAUSE_CODE_PATTERN`, `isExternalCauseCode(code)`, `findExternalCauseCodes(codes)`.
  - `seventh-character.ts` — `getSeventhCharacter(code)`, `isInitialEncounterSuffix(code)` (A-suffix), `isSubsequentEncounterSuffix(code)` (D-suffix), `isSequelaSuffix(code)` (S-suffix), `hasFifthCharacterSpecificity(code)` (for M54.5 parent guard).
  - `extract-procedure-diagnoses.ts` — pulls `{ icd10_code }[]` from a `procedures.diagnoses` jsonb value (currently unstructured array of `{ icd10_code, description }`).
- [src/lib/qc/diagnosis-validators.ts](../../src/lib/qc/diagnosis-validators.ts) — new module:
  - `validateExternalCauseChain(input) → QualityFinding[]`
  - `validateSeventhCharacterIntegrity(input) → QualityFinding[]`
  - Both consume the same `QualityReviewInputData` shape `gatherSourceData` already produces.
- [src/lib/claude/generate-quality-review.ts](../../src/lib/claude/generate-quality-review.ts) Rule 1 trimmed: drop the three sub-bullets ("radiculopathy emerging without imaging support", "M54.5 used without 5th-character specificity", "'A'-suffix codes persisting at discharge") because two of them are now deterministic. Replace with a single line: "Diagnosis progression — flag radiculopathy emerging without imaging support. (External-cause-chain and 7th-character integrity are computed deterministically and merged in post-LLM.)"
- [src/actions/case-quality-reviews.ts](../../src/actions/case-quality-reviews.ts) `runCaseQualityReview` post-LLM:
  1. Run `validateExternalCauseChain(inputData)` and `validateSeventhCharacterIntegrity(inputData)`.
  2. Dedupe against LLM-emitted findings by hash (deterministic findings win — drop any LLM finding sharing the same hash).
  3. Concatenate deterministic findings into `findings`, persist.
- `verifyFinding` adds two new dispatch branches keyed by stable `section_key` markers:
  - `section_key='_qc_external_cause_chain'` → re-run `validateExternalCauseChain` against current data; resolved when the specific cited violation is gone.
  - `section_key='_qc_seventh_character_integrity'` → re-run `validateSeventhCharacterIntegrity`; resolved likewise.
- Stable finding messages (these become the canonical strings, not LLM paraphrase):
  - `"External cause code missing at initial visit (accident_type=auto expects V43.52XA)"` — when accident_type is set and IV diagnoses lack the expected code.
  - `"External cause code <CODE> appears in procedure note <procedure_number> — must omit per coding policy"` — when a V/W/X/Y code appears in `procedures.diagnoses`.
  - `"External cause code <CODE> appears in discharge note — must omit per coding policy"` — when a V/W/X/Y code appears in discharge `diagnoses`.
  - `"A-suffix initial-encounter code <CODE> persists at discharge — replace with D or S suffix"` — per offending code at discharge.
  - `"A-suffix initial-encounter code <CODE> on procedure note #<N> (≥2) — replace with D suffix"` — per offending code on a procedure note whose `procedure_number` ≥ 2.
  - `"M54.5 parent code at <step> — emit M54.50/.51/.59 5th-character subcode"`.
- Severity policy:
  - External-cause violations at procedure/discharge → `critical` (defensibility risk per existing prompt language).
  - Missing IV external-cause code → `warning` (the IV may simply not list it; provider should add).
  - A-suffix at discharge → `critical`.
  - A-suffix at procedure ≥2 → `warning`.
  - M54.5 parent → `warning`.

### Verification:

- Case has IV with V43.52XA + procedure note also lists V43.52XA → after Recheck, two deterministic findings present: cross-step finding "External cause code V43.52XA appears in procedure note 1 — must omit per coding policy", severity critical.
- Same case, provider regenerates the procedure note and the new note's procedures.diagnoses no longer contains V43.52XA → provider clicks Verify on the QC finding → resolved with `resolution_source='manual_verify'`.
- Case has discharge listing S33.5XXA → finding "A-suffix initial-encounter code S33.5XXA persists at discharge — replace with D or S suffix", severity critical. Hash stable across reruns until the code is changed.
- Two consecutive Recheck runs with identical underlying data produce identical deterministic finding hashes (test asserts on hash equality).
- LLM emits a finding with paraphrase like "External cause continuity across the chain" — dedupe step drops it because deterministic finding for the same `(step='cross_step', note_id, procedure_id, section_key='_qc_external_cause_chain')` slot already won. Verify by counting `findings.filter(f => f.message.toLowerCase().includes('external cause')).length === 1`.

### Key Discoveries:

- `gatherSourceData` already assembles every input the validators need: IV diagnoses (free-text via `parseIvnDiagnoses`), procedure diagnoses (jsonb on `procedures`), discharge diagnoses (free-text). No additional DB load needed.
- Finding hash stability requires fixed `section_key` and fixed `note_id` / `procedure_id` per violation. Use `section_key='_qc_external_cause_chain'` / `'_qc_seventh_character_integrity'` to scope deterministic findings — leading underscore signals "synthetic, not a real form section". UI ignores the leading underscore for routing (no editor jump target needed for cross-step findings).
- `procedure_id` field on a procedure-step finding gives the validator a stable per-procedure key. For `cross_step` findings, set `note_id=null` and use `section_key` + first offending `procedure_id` to keep hash stable per offending procedure.
- `discharge_notes.diagnoses` and `initial_visit_notes.diagnoses` parse identically with `parseIvnDiagnoses`. `procedures.diagnoses` is jsonb of `{ icd10_code, description }` per [src/lib/validations/prp-procedure.ts:8](../../src/lib/validations/prp-procedure.ts).
- `verifyFinding` only re-runs the matching validator and looks for the **specific cited code** still present (not just "any external-cause violation"). Otherwise a provider fixing one of three violations can't verify the others independently.
- Rule 1 sub-bullet "radiculopathy emerging without imaging support" stays in the LLM prompt — too context-dependent for a deterministic validator (requires reading exam findings + imaging report prose).

## What We're NOT Doing

- No deterministic validator for "radiculopathy emerging without imaging support". Stays as LLM Rule 1 — requires correlating exam prose + imaging report prose, out of scope for code-pattern check.
- No 7th-character ↔ descriptor text-match check. Descriptor is free-form; no structured ICD-10-CM map shipped in repo. Only encounter-context check (A/D/S vs visit type) is deterministic.
- No backfill of `discharge_notes.diagnoses` (free-text). Provider regenerates after Phase 3 ships → new pre-filter applies. Phase 6 audit catches leftovers.
- No backfill of `initial_visit_notes.diagnoses` — A-suffix at IV is correct (initial encounter).
- No backfill of `case_quality_reviews` rows. Phase 6 validators run on next Recheck only.
- No LLM prompt change beyond trimming the two now-deterministic sub-bullets from Rule 1 (Phase 7) + adding the PRE-FILTERED DIAGNOSIS POOL note at discharge (Phase 3). Procedure-note prompt unchanged — Filter (A)/(D) stay as fallback contract.
- No A→D rewrite on procedure_number=1 — first procedure note is the intake encounter, A-suffix permitted per generate-procedure-note.ts:602.
- No A→S (sequela) rewrite at discharge. Choosing between D and S requires knowing whether the symptom resolved — symptom-resolution detection is LLM judgment (Filter G). Phase 3 always picks D as the safe default; LLM can still emit .S in prose when warranted.
- No external-cause D-suffix rewrite — V/W/X/Y always keep their A-suffix (they describe a one-time causation event). Strip-only at procedure + discharge.
- No UI change beyond what falls out of the existing finding renderer (which already handles `cross_step` findings with `note_id=null`).
- No surface-level "we rewrote your codes" toast in Phase 2. Provider sees rewritten codes on next form load. Wire later if providers complain.
- No change to the structural `validateIcd10Code` regex.
- No external-cause continuity check that the V/W code at IV matches `accident_type` perfectly — only that *some* V/W/X/Y appears at IV when `accident_type ∈ {auto, slip_and_fall, workplace}`. Coding nuance (V43.52XA vs V49.40XA for variant collisions) stays with LLM.
- No retroactive "downgrade suggestion" emission. Findings flag the violation; suggested fix lives in existing prompt language + provider's editor.

## Implementation Approach

Seven phases, root-fix first.

**Tier 1 — Root fix (storage + pre-generation)**
- Phase 1: Pure-TS suffix-rewrite + external-cause helpers
- Phase 2: Apply rewrite at `procedures.diagnoses` write (`procedure_number ≥ 2` → A→D, strip V/W/X/Y)
- Phase 3: Apply same filters at discharge pre-generation diagnosis-pool assembly
- Phase 4: Backfill migration for already-persisted A-suffix codes on procedures with `procedure_number ≥ 2`

**Tier 2 — Audit backstop (post-LLM validators)**
- Phase 5: Pure-TS validator modules + tests
- Phase 6: QC pipeline integration + `verifyFinding` dispatch
- Phase 7: LLM prompt trim + observability

Phases 1, 5 ship independently — pure functions, no DB / Claude touch. Phase 2 + 3 wire rewrites into write paths. Phase 4 is a one-shot data correction. Phase 6 wires validators into `runCaseQualityReview` + `verifyFinding`. Phase 7 trims Rule 1 only after Phase 6 lands.

---

## Phase 1 — Suffix-rewrite + external-cause helpers (pure modules)

### Changes

#### 1.1 `src/lib/icd10/external-cause.ts` (new)

Same module as defined in former Phase 1 — see Phase 5.1 below for full source. Phase 1 + Phase 5 share this file; defining it here once.

#### 1.2 `src/lib/icd10/seventh-character.ts` (new)

Same as Phase 5.2. Adds the rewrite helper used by storage layer:

```ts
// In addition to getSeventhCharacter / isInitialEncounterSuffix etc:

// Rewrite an A-suffix code to its D-suffix counterpart. Mechanical:
// the A is always the last character of the code per the SEVENTH_CHARACTER_REGEX.
// Returns the input unchanged when not an A-suffix code OR when external-cause.
// External-cause V/W/X/Y codes keep their A-suffix forever — they describe the
// causation event, not the encounter for the patient's injury.
export function rewriteASuffixToD(code: string): string {
  if (!code) return code
  const c = code.trim().toUpperCase()
  // External-cause codes (V/W/X/Y): never rewrite — handled by strip at procedure/discharge.
  if (/^[VWXY]\d{2}/.test(c)) return c
  if (getSeventhCharacter(c) === 'A') return c.slice(0, -1) + 'D'
  return c
}

// Same as above but emits the S-suffix (sequela) variant. Used at discharge
// when the symptom is resolved — see Filter (G) at generate-discharge-note.ts:425.
export function rewriteASuffixToS(code: string): string {
  if (!code) return code
  const c = code.trim().toUpperCase()
  if (/^[VWXY]\d{2}/.test(c)) return c
  if (getSeventhCharacter(c) === 'A') return c.slice(0, -1) + 'S'
  return c
}
```

#### 1.3 `src/lib/icd10/diagnosis-rewrite.ts` (new)

Higher-level orchestration the action layer calls. Operates on the `{ icd10_code, description }` jsonb shape stored on `procedures.diagnoses`.

```ts
import { rewriteASuffixToD, isInitialEncounterSuffix } from './seventh-character'
import { isExternalCauseCode } from './external-cause'

export type DiagnosisItem = { icd10_code: string; description: string }

// Apply the procedure-note-≥2 rule: A→D rewrite + external-cause strip.
// Pure function. Returns a new array, does not mutate input.
//
// Reason: per generate-procedure-note.ts:602 (Filter D) procedure notes after
// the first visit are subsequent encounters, and per generate-procedure-note.ts:593
// (Filter A) external-cause codes are absolute-omission on every procedure note.
// Today both rules live only in LLM prompts; this enforces them at storage.
export function rewriteDiagnosesForProcedure(
  diagnoses: DiagnosisItem[],
  opts: { procedureNumber: number },
): DiagnosisItem[] {
  return diagnoses
    .filter((d) => !isExternalCauseCode(d.icd10_code))
    .map((d) =>
      opts.procedureNumber >= 2
        ? {
            icd10_code: rewriteASuffixToD(d.icd10_code),
            description: rewriteDescriptionForD(d.description, d.icd10_code),
          }
        : d,
    )
}

// Helper — when icd10 was rewritten A→D, also flip "initial encounter" to
// "subsequent encounter" in the description. The provider-entered description
// often contains the encounter qualifier verbatim; leaving "initial encounter"
// next to a D-suffix code reads inconsistent on coding review.
// Match is case-insensitive; non-matches are returned unchanged.
function rewriteDescriptionForD(description: string, originalCode: string): string {
  if (!isInitialEncounterSuffix(originalCode)) return description
  return description.replace(/initial encounter/gi, 'subsequent encounter')
}

// Apply the discharge rule: A→D rewrite + external-cause strip + M54.5 parent
// upgrade. M54.5 → M54.50 is the only deterministic substitution allowed
// (per validation.ts NON_BILLABLE_PARENT_CODES); other parent-vs-child decisions
// stay with the LLM.
export function rewriteDiagnosesForDischarge(
  diagnoses: DiagnosisItem[],
): DiagnosisItem[] {
  return diagnoses
    .filter((d) => !isExternalCauseCode(d.icd10_code))
    .map((d) => {
      const code = d.icd10_code.trim().toUpperCase()
      if (code === 'M54.5') {
        return { icd10_code: 'M54.50', description: d.description }
      }
      if (isInitialEncounterSuffix(code)) {
        return {
          icd10_code: rewriteASuffixToD(code),
          description: rewriteDescriptionForD(d.description, code),
        }
      }
      return d
    })
}
```

### Tests

`src/lib/icd10/__tests__/diagnosis-rewrite.test.ts`:

- procedure_number=1 with `[S13.4XXA, V43.52XA, M54.50]` → drops V43.52XA, keeps S13.4XXA (first-procedure exception per Filter D). Result: `[S13.4XXA, M54.50]`.
- procedure_number=2 with `[S13.4XXA, V43.52XA, M54.50]` → drops V43.52XA, rewrites S13.4XXA → S13.4XXD + description "initial encounter" → "subsequent encounter".
- procedure_number=3 with `[S13.4XXA, S33.5XXA, M50.20]` → both A-suffix codes rewritten to D-suffix; M50.20 untouched.
- discharge with `[S13.4XXA, V43.52XA, M54.5]` → drops V43.52XA, rewrites S13.4XXA → S13.4XXD, upgrades M54.5 → M54.50.
- External-cause D-suffix safety: `rewriteASuffixToD('V43.52XA')` → `'V43.52XA'` unchanged.
- Non-A-suffix preservation: `rewriteASuffixToD('M54.50')` → `'M54.50'`.
- Description rewrite is case-insensitive: `"Initial Encounter"` → `"subsequent encounter"`.
- Idempotence: `rewriteDiagnosesForProcedure(rewriteDiagnosesForProcedure(d, opts), opts)` === `rewriteDiagnosesForProcedure(d, opts)`.

### Success Criteria

#### Automated

- [ ] `npx vitest run src/lib/icd10/__tests__/diagnosis-rewrite.test.ts` passes
- [ ] `npx tsc --noEmit` clean

---

## Phase 2 — Apply rewrite at procedure write paths

### Changes

#### 2.1 `src/actions/procedures.ts` `createPrpProcedure`

At [src/actions/procedures.ts:118](../../src/actions/procedures.ts#L118):

```ts
import { rewriteDiagnosesForProcedure } from '@/lib/icd10/diagnosis-rewrite'

// procedureNumber computed at line 104; reuse it for the rewrite.
const rewrittenDiagnoses = rewriteDiagnosesForProcedure(values.diagnoses, {
  procedureNumber,
})

// In the .insert():
diagnoses: rewrittenDiagnoses,
```

#### 2.2 `src/actions/procedures.ts` `updatePrpProcedure`

At [src/actions/procedures.ts:311](../../src/actions/procedures.ts#L311). `procedure_number` not on `values` — load it from the existing row first:

```ts
const { data: existing } = await supabase
  .from('procedures')
  .select('procedure_number')
  .eq('id', procedureId)
  .is('deleted_at', null)
  .single()

if (!existing) return { error: 'Procedure not found' }

const rewrittenDiagnoses = rewriteDiagnosesForProcedure(values.diagnoses, {
  procedureNumber: existing.procedure_number,
})

// In the .update():
diagnoses: rewrittenDiagnoses,
```

#### 2.3 Provider feedback

When the rewrite changes the diagnosis list, the form silently saves the rewritten version. The provider sees the rewritten codes on next form load. Acceptable — the provider's intent is "record this procedure", not "record exactly these codes". If we want surface-level feedback, return a `rewritten: { from, to }[]` array on the action result and toast it on the client. **OUT OF SCOPE for Phase 2** — wire later if providers complain.

### Tests

Extend `src/actions/__tests__/procedures.test.ts` (or create if absent):

- `createPrpProcedure` with `procedureNumber=1` (no prior procedures), diagnoses `[S13.4XXA, V43.52XA]` → DB receives `[S13.4XXA]` (V stripped, A kept on first procedure).
- `createPrpProcedure` with `procedureNumber=2`, diagnoses `[S13.4XXA, V43.52XA]` → DB receives `[S13.4XXD]`.
- `updatePrpProcedure` for an existing `procedure_number=3`, new diagnoses `[S33.5XXA]` → DB receives `[S33.5XXD]`.
- `createPrpProcedure` with already-D-suffix codes → unchanged.

### Success Criteria

#### Automated

- [ ] `npx vitest run src/actions/__tests__/procedures.test.ts` passes
- [ ] `npx tsc --noEmit` clean

#### Manual

- [ ] Record a 2nd procedure on a case where the IV had S13.4XXA → procedure form pre-populates from `getCaseDiagnoses` (still A-suffix), provider clicks Save → re-open the procedure → diagnoses show as S13.4XXD with "subsequent encounter" descriptor
- [ ] Record any procedure with V43.52XA in the diagnoses → re-open → V43.52XA gone

---

## Phase 3 — Apply rewrite at discharge pre-generation

### Changes

#### 3.1 `src/actions/discharge-notes.ts` diagnosis-pool assembly

Discharge generation pulls diagnoses from multiple sources (`procedures.diagnoses`, `case_summaries.suggested_diagnoses`, `pmExtraction.diagnoses`, `chiroExtraction.diagnoses`, `ptExtraction.diagnoses`). The LLM prompt's Filter (A) / (D) / (F) ask the model to clean these up; we now do it deterministically before the prompt sees them.

Two integration points:

(a) **Aggregate-then-rewrite at the action layer.** Add a helper that consolidates jsonb diagnoses + free-text diagnoses (from IVN.diagnoses, parsed via `parseIvnDiagnoses`), passes them through `rewriteDiagnosesForDischarge`, deduplicates by `icd10_code`, and exposes the cleaned list as a new `diagnosisPool: DiagnosisItem[]` field on the discharge generator input.

(b) **Prompt update.** Add a new note in the discharge system prompt: when `diagnosisPool` is non-null, emit those codes verbatim — Filter (A)/(D)/(F) substitutions are already applied. The existing Filter rules stay as a fallback when `diagnosisPool` is null (e.g. early development paths).

Pseudocode for the helper inside `discharge-notes.ts`:

```ts
import { rewriteDiagnosesForDischarge, type DiagnosisItem } from '@/lib/icd10/diagnosis-rewrite'
import { parseIvnDiagnoses } from '@/lib/icd10/parse-ivn-diagnoses'

function assembleDischargeDiagnosisPool({
  procedureDiagnoses, // Array<{ icd10_code, description }> aggregated across procedures
  pmDiagnoses,
  ivnDiagnosesText,
}: {
  procedureDiagnoses: DiagnosisItem[]
  pmDiagnoses: DiagnosisItem[]
  ivnDiagnosesText: string | null
}): DiagnosisItem[] {
  const ivnParsed = parseIvnDiagnoses(ivnDiagnosesText) // already returns { icd10_code, description }
  const merged = [...procedureDiagnoses, ...pmDiagnoses, ...ivnParsed]
  const rewritten = rewriteDiagnosesForDischarge(merged)

  // Dedupe by code, last-write-wins (procedures > pm > ivn).
  const byCode = new Map<string, DiagnosisItem>()
  for (const d of rewritten) {
    byCode.set(d.icd10_code.trim().toUpperCase(), d)
  }
  return [...byCode.values()]
}
```

Wire this into the discharge generator input alongside the existing `pmExtraction.diagnoses` field. Keep the existing fields as the fallback path.

#### 3.2 `src/lib/claude/generate-discharge-note.ts` prompt note

Insert a short paragraph at [src/lib/claude/generate-discharge-note.ts:401](../../src/lib/claude/generate-discharge-note.ts#L401) (just before the existing `7. diagnoses` block):

```
PRE-FILTERED DIAGNOSIS POOL: When `diagnosisPool` is non-null in the input, that array is the authoritative source for the diagnosis section. External-cause codes have already been stripped, A-suffix codes have been rewritten to D-suffix, and M54.5 parent has been upgraded to M54.50. Emit those codes verbatim — do not re-derive from procedureDiagnoses, pmExtraction, or caseSummary.suggested_diagnoses. The Filter (A)/(D)/(F) blocks below remain as a fallback contract when `diagnosisPool` is null.
```

### Tests

Extend `src/actions/__tests__/discharge-notes.test.ts` (or `discharge-notes-regenerate.test.ts`):

- Aggregation: case with one procedure carrying `[S13.4XXA, V43.52XA]` + IVN diagnoses text containing `M54.5` → discharge input `diagnosisPool` is `[S13.4XXD subsequent encounter, M54.50]` (V stripped, A→D, M54.5→M54.50).
- Dedupe: procedures contribute S13.4XXA + IVN text contributes S13.4XXA → pool has one entry post-rewrite (S13.4XXD).
- Prompt assertion: rendered system prompt contains `"PRE-FILTERED DIAGNOSIS POOL"`.

### Success Criteria

#### Automated

- [ ] `npx vitest run src/actions/__tests__/discharge-notes*.test.ts` passes
- [ ] `npx tsc --noEmit` clean

#### Manual

- [ ] Generate a discharge note on a case where some procedure has S13.4XXA + V43.52XA → discharge note diagnosis section emits S13.4XXD (or .S if the symptom resolved), no V code present
- [ ] LLM raw_ai_response shows the model honored the pre-filtered pool (manual eyeball)

---

## Phase 4 — Backfill migration for already-persisted violations

### Changes

#### 4.1 `supabase/migrations/<ts>_backfill_procedure_diagnoses.sql` (new)

One-shot SQL data correction. Targets `procedures` rows where `procedure_number >= 2` AND `diagnoses` jsonb contains any A-suffix code OR external-cause code.

```sql
-- Backfill: rewrite A→D and strip V/W/X/Y on procedures.diagnoses for
-- procedure_number >= 2. Mirrors the deterministic rewrite added in
-- Phase 2 to clean up rows persisted before that change.
--
-- A-suffix detection: ICD-10 7th-character 'A' lives at position 7 of
-- "X##.####A" (after dot, four chars, then A). Use a regex match on the
-- icd10_code string.

-- Requires plpgsql; no extension needed.

create or replace function _backfill_rewrite_diagnoses(
  diagnoses jsonb,
  procedure_number int
) returns jsonb language plpgsql as $$
declare
  result jsonb := '[]'::jsonb;
  item jsonb;
  code text;
  desc_text text;
  new_code text;
  new_desc text;
begin
  if diagnoses is null or jsonb_typeof(diagnoses) <> 'array' then
    return diagnoses;
  end if;

  for item in select * from jsonb_array_elements(diagnoses) loop
    code := upper(trim(item->>'icd10_code'));
    desc_text := coalesce(item->>'description', '');

    -- Strip external-cause V/W/X/Y
    if code ~ '^[VWXY][0-9]{2}' then
      continue;
    end if;

    -- A→D rewrite for procedure_number >= 2
    if procedure_number >= 2 and code ~ '^[A-Z][0-9]{2}\.[A-Z0-9]{1,4}A$' then
      new_code := substring(code from 1 for length(code) - 1) || 'D';
      new_desc := regexp_replace(desc_text, 'initial encounter', 'subsequent encounter', 'gi');
    else
      new_code := code;
      new_desc := desc_text;
    end if;

    result := result || jsonb_build_object(
      'icd10_code', new_code,
      'description', new_desc
    );
  end loop;

  return result;
end;
$$;

update public.procedures
set diagnoses = _backfill_rewrite_diagnoses(diagnoses, procedure_number),
    updated_at = now()
where procedure_number >= 2
  and diagnoses is not null
  and (
    -- Has any V/W/X/Y external-cause
    diagnoses @? '$[*] ? (@.icd10_code like_regex "^[VWXY][0-9]{2}")'
    or
    -- Has any A-suffix
    diagnoses @? '$[*] ? (@.icd10_code like_regex "^[A-Z][0-9]{2}\\.[A-Z0-9]{1,4}A$")'
  );

-- Also strip external-cause from procedure_number = 1 rows (Filter A is absolute,
-- never permitted on any procedure note). A-suffix is permitted on first procedure.
update public.procedures
set diagnoses = (
      select jsonb_agg(item)
      from jsonb_array_elements(diagnoses) item
      where (item->>'icd10_code') !~ '^[VWXY][0-9]{2}'
    ),
    updated_at = now()
where procedure_number = 1
  and diagnoses is not null
  and diagnoses @? '$[*] ? (@.icd10_code like_regex "^[VWXY][0-9]{2}")';

drop function _backfill_rewrite_diagnoses(jsonb, int);
```

#### 4.2 Discharge backfill — out of scope

`discharge_notes.diagnoses` is free-text (one code per line). SQL rewrite is brittle (regex replace on multi-line text + descriptors). Cheaper path: provider regenerates the discharge note after Phase 3 ships → new pre-filter applies. Document this as known-limitation. Phase 6 audit validators will flag any leftover violations on existing discharge notes.

### Tests

- Manual SQL test against a copy of prod data on a Supabase branch (see [thoughts/shared/research/MEMORY.md](MEMORY.md) Supabase migration workflow): apply migration, verify a known violator row was corrected.

### Success Criteria

#### Automated

- [ ] `npx supabase db push` applies migration cleanly on local + branch
- [ ] No SQL syntax errors; function created + dropped within transaction

#### Manual

- [ ] Identify one production case with a known A-suffix on procedure_number=2 (via QC findings audit log if exists, or ad-hoc query)
- [ ] After migration applied to a branch DB clone, the row reflects D-suffix + no V/W/X/Y
- [ ] Affected procedures retain everything else unchanged (sites, vital_signs, etc.)
- [ ] Run a re-Recheck on the affected case → corresponding QC findings auto-resolve via Phase 6 carry-over

---

## Phase 5 — Validator modules + tests

This phase defines the audit-tier validators. Phases 1-4 prevent leaks at storage / pre-generation; Phase 5-7 catch what slipped through.

### Changes

#### 5.1 `src/lib/icd10/external-cause.ts` (shared with Phase 1)

```ts
// External-cause ICD-10-CM codes: chapter XX (V00-Y99). Subset relevant to PI:
// V (transport accidents), W (other external causes of accidental injury),
// X (exposure / assault overlap — kept for completeness),
// Y (other / late effects).
export const EXTERNAL_CAUSE_CODE_PATTERN = /^[VWXY]\d{2}/i

export function isExternalCauseCode(code: string | null | undefined): boolean {
  if (!code) return false
  return EXTERNAL_CAUSE_CODE_PATTERN.test(code.trim())
}

export function findExternalCauseCodes(
  codes: Array<string | null | undefined>,
): string[] {
  const out: string[] = []
  for (const c of codes) {
    if (isExternalCauseCode(c)) out.push((c as string).trim().toUpperCase())
  }
  return out
}

// accident_type → expected external cause prefix (per generate-initial-visit.ts:130-134).
// Keyed by case.accident_type. The validator only checks that *some* external-cause
// code is present when the accident_type expects one — exact code variant is LLM-judged.
export const ACCIDENT_TYPE_EXPECTATIONS: Record<string, { prefix: string; example: string }> = {
  auto: { prefix: 'V', example: 'V43.52XA' },
  slip_and_fall: { prefix: 'W01', example: 'W01.0XXA' },
  workplace: { prefix: 'W18', example: 'W18.49XA' },
}
```

#### 5.2 `src/lib/icd10/seventh-character.ts` (shared with Phase 1; rewrite helpers added in Phase 1.2)

```ts
// ICD-10-CM 7th-character semantics (subset relevant to PI/musculoskeletal):
//   A — initial encounter
//   D — subsequent encounter
//   S — sequela
// Per generate-discharge-note.ts:419, A-suffix codes are forbidden at discharge.
// Per generate-procedure-note.ts:602, A-suffix codes on procedure notes ≥2 should
// be replaced with D-suffix.

const SEVENTH_CHARACTER_REGEX = /^[A-Z]\d{2}\.[A-Z0-9]{1,4}([ADS])$/i

export function getSeventhCharacter(code: string | null | undefined): 'A' | 'D' | 'S' | null {
  if (!code) return null
  const m = code.trim().toUpperCase().match(SEVENTH_CHARACTER_REGEX)
  return m ? (m[1] as 'A' | 'D' | 'S') : null
}

export function isInitialEncounterSuffix(code: string | null | undefined): boolean {
  return getSeventhCharacter(code) === 'A'
}

export function isSubsequentEncounterSuffix(code: string | null | undefined): boolean {
  return getSeventhCharacter(code) === 'D'
}

export function isSequelaSuffix(code: string | null | undefined): boolean {
  return getSeventhCharacter(code) === 'S'
}

// M54.5 parent guard: per validation.ts:13-15 + generate-initial-visit.ts:192-195
// + generate-discharge-note.ts:423, the parent M54.5 must always be replaced
// with .50/.51/.59. Returns true if the code is exactly the parent.
export function isM545Parent(code: string | null | undefined): boolean {
  if (!code) return false
  return code.trim().toUpperCase() === 'M54.5'
}
```

#### 5.3 `src/lib/qc/diagnosis-validators.ts` (new)

```ts
import type { QualityFinding } from '@/lib/validations/case-quality-review'
import type { QualityReviewInputData } from '@/lib/claude/generate-quality-review'
import { parseIvnDiagnoses } from '@/lib/icd10/parse-ivn-diagnoses'
import {
  isExternalCauseCode,
  findExternalCauseCodes,
  ACCIDENT_TYPE_EXPECTATIONS,
} from '@/lib/icd10/external-cause'
import {
  isInitialEncounterSuffix,
  isM545Parent,
} from '@/lib/icd10/seventh-character'

// Section-key sentinels — synthetic, used only for finding hash stability and
// verifier dispatch. Not real form sections; UI does not route on these.
export const SECTION_QC_EXTERNAL_CAUSE_CHAIN = '_qc_external_cause_chain'
export const SECTION_QC_SEVENTH_CHARACTER_INTEGRITY = '_qc_seventh_character_integrity'

function diagnosesFromProcedure(proc: { diagnoses: unknown }): string[] {
  if (!Array.isArray(proc.diagnoses)) return []
  return proc.diagnoses
    .map((d) => (d as { icd10_code?: string }).icd10_code)
    .filter((c): c is string => typeof c === 'string' && c.length > 0)
}

export function validateExternalCauseChain(
  input: QualityReviewInputData,
): QualityFinding[] {
  const findings: QualityFinding[] = []

  // (a) IV expectation when accident_type is set.
  const accidentType = input.caseDetails.accident_type
  const expectation = accidentType
    ? ACCIDENT_TYPE_EXPECTATIONS[accidentType]
    : null
  const ivCodes = input.initialVisitNote
    ? parseIvnDiagnoses(input.initialVisitNote.diagnoses).map((d) => d.icd10_code)
    : []
  if (expectation && input.initialVisitNote) {
    const hasExpected = ivCodes.some((c) =>
      c.toUpperCase().startsWith(expectation.prefix),
    )
    if (!hasExpected) {
      findings.push({
        severity: 'warning',
        step: 'initial_visit',
        note_id: input.initialVisitNote.id,
        procedure_id: null,
        section_key: SECTION_QC_EXTERNAL_CAUSE_CHAIN,
        message: `External cause code missing at initial visit (accident_type=${accidentType} expects ${expectation.example})`,
        rationale: 'Initial-visit note must carry the accident-type-matched V/W external cause code per coding policy.',
        suggested_tone_hint: `Add ${expectation.example} to the diagnosis list as the final entry.`,
      })
    }
  }

  // (b) Procedure notes — V/W/X/Y must be omitted (Filter A).
  for (const pn of input.procedureNotes) {
    const candidateCodes = diagnosesFromProcedure({ diagnoses: pn.diagnoses })
    const offending = findExternalCauseCodes(candidateCodes)
    for (const code of offending) {
      findings.push({
        severity: 'critical',
        step: 'procedure',
        note_id: pn.id,
        procedure_id: pn.procedure_id,
        section_key: SECTION_QC_EXTERNAL_CAUSE_CHAIN,
        message: `External cause code ${code} appears in procedure note ${pn.procedure_number} — must omit per coding policy`,
        rationale: 'External-cause codes establish causation and belong in the initial-visit note only. Their presence on procedure notes reads as aggressive billing and is a defensibility liability at deposition.',
        suggested_tone_hint: `Regenerate the procedure note diagnoses; the note prompt's Filter (A) requires omitting ${code}.`,
      })
    }
  }

  // (c) Discharge — V/W/X/Y must be omitted (Filter A).
  if (input.dischargeNote) {
    const dcCodes = parseIvnDiagnoses(input.dischargeNote.diagnoses).map(
      (d) => d.icd10_code,
    )
    const offending = findExternalCauseCodes(dcCodes)
    for (const code of offending) {
      findings.push({
        severity: 'critical',
        step: 'discharge',
        note_id: input.dischargeNote.id,
        procedure_id: null,
        section_key: SECTION_QC_EXTERNAL_CAUSE_CHAIN,
        message: `External cause code ${code} appears in discharge note — must omit per coding policy`,
        rationale: 'External-cause codes belong in the initial-visit note only. Their presence on the discharge note reads as aggressive billing and is a defensibility liability at deposition.',
        suggested_tone_hint: `Regenerate the discharge diagnoses; Filter (A) requires omitting ${code}.`,
      })
    }
  }

  return findings
}

export function validateSeventhCharacterIntegrity(
  input: QualityReviewInputData,
): QualityFinding[] {
  const findings: QualityFinding[] = []

  // (a) A-suffix at discharge → critical.
  if (input.dischargeNote) {
    const dcParsed = parseIvnDiagnoses(input.dischargeNote.diagnoses)
    for (const { icd10_code } of dcParsed) {
      if (isInitialEncounterSuffix(icd10_code)) {
        findings.push({
          severity: 'critical',
          step: 'discharge',
          note_id: input.dischargeNote.id,
          procedure_id: null,
          section_key: SECTION_QC_SEVENTH_CHARACTER_INTEGRITY,
          message: `A-suffix initial-encounter code ${icd10_code} persists at discharge — replace with D or S suffix`,
          rationale: 'Discharge encounters are subsequent (D) or sequela (S). Initial-encounter (A) codes at discharge contradict the encounter context and will be flagged on coding review.',
          suggested_tone_hint: `Regenerate discharge diagnoses; Filter (D) requires replacing ${icd10_code} with the D- or S-suffix variant.`,
        })
      }
      if (isM545Parent(icd10_code)) {
        findings.push({
          severity: 'warning',
          step: 'discharge',
          note_id: input.dischargeNote.id,
          procedure_id: null,
          section_key: SECTION_QC_SEVENTH_CHARACTER_INTEGRITY,
          message: `M54.5 parent code at discharge — emit M54.50/.51/.59 5th-character subcode`,
          rationale: 'M54.5 is a non-billable parent. Always pick a 5th-character subcode (.50 default, .51 vertebrogenic, .59 other) per Filter (F).',
          suggested_tone_hint: 'Regenerate discharge diagnoses with M54.50 (default).',
        })
      }
    }
  }

  // (b) A-suffix on procedure notes with procedure_number ≥ 2 → warning.
  for (const pn of input.procedureNotes) {
    const candidateCodes = diagnosesFromProcedure({ diagnoses: pn.diagnoses })
    for (const code of candidateCodes) {
      if (isM545Parent(code)) {
        findings.push({
          severity: 'warning',
          step: 'procedure',
          note_id: pn.id,
          procedure_id: pn.procedure_id,
          section_key: SECTION_QC_SEVENTH_CHARACTER_INTEGRITY,
          message: `M54.5 parent code on procedure note ${pn.procedure_number} — emit M54.50/.51/.59 5th-character subcode`,
          rationale: 'M54.5 is a non-billable parent.',
          suggested_tone_hint: 'Regenerate procedure note diagnoses with M54.50.',
        })
      }
      if (pn.procedure_number >= 2 && isInitialEncounterSuffix(code)) {
        findings.push({
          severity: 'warning',
          step: 'procedure',
          note_id: pn.id,
          procedure_id: pn.procedure_id,
          section_key: SECTION_QC_SEVENTH_CHARACTER_INTEGRITY,
          message: `A-suffix initial-encounter code ${code} on procedure note #${pn.procedure_number} (≥2) — replace with D suffix`,
          rationale: 'Procedure notes after the first visit are subsequent encounters. A-suffix codes here contradict the encounter context.',
          suggested_tone_hint: `Regenerate procedure note diagnoses; Filter (D) prefers the D-suffix variant of ${code}.`,
        })
      }
    }
  }

  // (c) M54.5 parent at IV (rare — IV prompt forbids it but defensive).
  if (input.initialVisitNote) {
    const ivParsed = parseIvnDiagnoses(input.initialVisitNote.diagnoses)
    for (const { icd10_code } of ivParsed) {
      if (isM545Parent(icd10_code)) {
        findings.push({
          severity: 'warning',
          step: 'initial_visit',
          note_id: input.initialVisitNote.id,
          procedure_id: null,
          section_key: SECTION_QC_SEVENTH_CHARACTER_INTEGRITY,
          message: `M54.5 parent code at initial visit — emit M54.50/.51/.59 5th-character subcode`,
          rationale: 'M54.5 is a non-billable parent.',
          suggested_tone_hint: 'Regenerate IV diagnoses with M54.50.',
        })
      }
    }
  }

  return findings
}
```

#### 5.4 Tests

- `src/lib/icd10/__tests__/external-cause.test.ts`:
  - `isExternalCauseCode('V43.52XA') === true`
  - `isExternalCauseCode('W01.0XXA') === true`
  - `isExternalCauseCode('M54.5') === false`
  - `findExternalCauseCodes(['V43.52XA', 'M54.5', 'W18.49XA']).length === 2`

- `src/lib/icd10/__tests__/seventh-character.test.ts`:
  - `getSeventhCharacter('S13.4XXA') === 'A'`
  - `getSeventhCharacter('S13.4XXD') === 'D'`
  - `getSeventhCharacter('M54.50') === null`
  - `isInitialEncounterSuffix('S33.5XXA') === true`
  - `isM545Parent('M54.5') === true`
  - `isM545Parent('M54.50') === false`

- `src/lib/qc/__tests__/diagnosis-validators.test.ts`:
  - External-cause: IV with V43.52XA + procedure with V43.52XA → 1 critical procedure finding, 0 IV findings.
  - External-cause: IV without V/W when `accident_type='auto'` → 1 warning IV finding.
  - External-cause: discharge with V43.52XA → 1 critical discharge finding.
  - 7th-char: discharge with S13.4XXA → 1 critical 7th-char finding.
  - 7th-char: procedure_number=1 with S13.4XXA → 0 findings (permitted on first procedure note per generate-procedure-note.ts:602).
  - 7th-char: procedure_number=3 with S13.4XXA → 1 warning finding.
  - 7th-char: any step with M54.5 parent → 1 warning finding.
  - **Hash stability**: `validateExternalCauseChain(input)` invoked twice on the same input → same finding hashes (test asserts on `computeFindingHash(f)` equality across calls).

### Success Criteria:

#### Automated Verification:

- [ ] `npx vitest run src/lib/icd10/__tests__/external-cause.test.ts` passes
- [ ] `npx vitest run src/lib/icd10/__tests__/seventh-character.test.ts` passes
- [ ] `npx vitest run src/lib/qc/__tests__/diagnosis-validators.test.ts` passes (incl. hash-stability assertion)
- [ ] `npx tsc --noEmit` clean

#### Manual Verification:

- (none — phase 1 is pure modules)

---

## Phase 6 — Pipeline integration + verifier dispatch

### Changes

#### 6.1 `src/actions/case-quality-reviews.ts` — post-LLM merge

In `runCaseQualityReview`, between the successful Claude result and the row update at line ~365:

```ts
import {
  validateExternalCauseChain,
  validateSeventhCharacterIntegrity,
  SECTION_QC_EXTERNAL_CAUSE_CHAIN,
  SECTION_QC_SEVENTH_CHARACTER_INTEGRITY,
} from '@/lib/qc/diagnosis-validators'

// After Claude success, before the case_quality_reviews update:
const deterministicFindings = [
  ...validateExternalCauseChain(inputData),
  ...validateSeventhCharacterIntegrity(inputData),
]
const deterministicHashes = new Set(
  deterministicFindings.map((f) => computeFindingHash(f)),
)

// Drop any LLM-emitted finding whose hash collides with a deterministic
// finding. Deterministic findings always win — the validator owns the
// section_key namespace `_qc_*` and message format.
const llmFindings = (result.data.findings ?? []).filter(
  (f) =>
    !deterministicHashes.has(computeFindingHash(f as QualityFinding)) &&
    f.section_key !== SECTION_QC_EXTERNAL_CAUSE_CHAIN &&
    f.section_key !== SECTION_QC_SEVENTH_CHARACTER_INTEGRITY,
)
const mergedFindings = [...deterministicFindings, ...llmFindings]
```

Persist `mergedFindings` instead of `result.data.findings`.

Note: the override carry-over loop at lines 381-412 is unchanged. It already keys on hash, and deterministic hashes are stable run-to-run, so a provider's ack/edit on a deterministic finding survives Recheck. When the underlying violation is fixed the hash disappears from the new findings list and the existing carry-over flips the override to `auto_recheck`-resolved — no extra wiring needed.

#### 6.2 `src/actions/case-quality-reviews.ts` — `verifyFinding` dispatch

Insert two new branches before the existing `procedure` / `discharge` branches at line 679:

```ts
import {
  validateExternalCauseChain,
  validateSeventhCharacterIntegrity,
  SECTION_QC_EXTERNAL_CAUSE_CHAIN,
  SECTION_QC_SEVENTH_CHARACTER_INTEGRITY,
} from '@/lib/qc/diagnosis-validators'

// Deterministic-validator dispatch — re-run the validator against fresh
// source data and check whether *this specific* finding hash is gone.
if (
  finding.section_key === SECTION_QC_EXTERNAL_CAUSE_CHAIN ||
  finding.section_key === SECTION_QC_SEVENTH_CHARACTER_INTEGRITY
) {
  const { data: freshInput, error: freshErr } = await gatherSourceData(
    supabase,
    caseId,
  )
  if (freshErr || !freshInput) {
    return { error: 'Failed to refresh source data for verify' }
  }
  const replays =
    finding.section_key === SECTION_QC_EXTERNAL_CAUSE_CHAIN
      ? validateExternalCauseChain(freshInput)
      : validateSeventhCharacterIntegrity(freshInput)
  const stillPresent = replays.some(
    (f) => computeFindingHash(f) === findingHash,
  )
  if (stillPresent) {
    return {
      data: {
        resolved: false,
        reason:
          finding.section_key === SECTION_QC_EXTERNAL_CAUSE_CHAIN
            ? 'External cause code still present'
            : '7th-character integrity violation still present',
      },
    }
  }
  resolved = true
}
```

Order matters: this branch runs **before** the existing `step==='procedure'` / `step==='discharge'` branches because deterministic findings on those steps should hit the validator dispatch, not the plan-alignment / trajectory-warnings dispatch.

#### 6.3 Tests

- `src/actions/__tests__/case-quality-reviews.test.ts` (extend):
  - **Merge dedupe**: mock `generateQualityReviewFromData` to return one finding sharing a hash with a deterministic external-cause finding → persisted `findings` has the deterministic copy, not the LLM copy.
  - **Verify external-cause**: seed a procedure with V43.52XA → first verify call returns `{ resolved: false, reason: 'External cause code still present' }`. Mutate the procedure to drop the code → second verify call returns `{ resolved: true }` and writes override with `resolution_source='manual_verify'`.
  - **Verify 7th-char on discharge**: seed discharge with S33.5XXA → verify returns `not resolved`. Mutate to S33.5XXD → verify returns resolved.
  - **Recheck auto-resolve**: seed with violation, ack the deterministic finding, fix the data, Recheck → override flips to `resolved` with `resolution_source='auto_recheck'`.

### Success Criteria:

#### Automated Verification:

- [ ] `npx vitest run src/actions/__tests__/case-quality-reviews.test.ts` passes (with new cases)
- [ ] `npx tsc --noEmit` clean

#### Manual Verification:

- [ ] On a real case with a procedure note that lists V43.52XA, run Recheck → QC review shows a `critical` finding "External cause code V43.52XA appears in procedure note 1 — must omit per coding policy"
- [ ] Click Verify on that finding → toast "External cause code still present"
- [ ] Edit the procedure to remove V43.52XA, regenerate, click Verify → finding flips to resolved
- [ ] Same flow for an A-suffix code at discharge
- [ ] Two consecutive Rechecks with no data change produce identical deterministic finding hashes (visible in DB by inspecting `findings` jsonb)

---

## Phase 7 — LLM prompt trim + observability

### Changes

#### 7.1 `src/lib/claude/generate-quality-review.ts` Rule 1

Replace [src/lib/claude/generate-quality-review.ts:109](../../src/lib/claude/generate-quality-review.ts) with:

```
1. Diagnosis progression — flag radiculopathy emerging without imaging support. (External-cause-chain integrity and ICD-10 7th-character integrity are computed deterministically and merged in post-LLM; do NOT emit findings on those topics.)
```

Reason: the deterministic merge at Phase 6 already wins the dedupe race, so leaving the old prompt language is harmless but wastes tokens on findings that get dropped. Trimming also reduces the chance of the LLM emitting a finding with a slightly different `section_key` that escapes dedupe.

#### 7.2 Logging

Add a single log line in `runCaseQualityReview` after the merge:

```ts
console.log(
  `[qc] case=${caseId} llm_findings=${result.data.findings?.length ?? 0} deterministic=${deterministicFindings.length} merged=${mergedFindings.length}`,
)
```

Lets us watch for prompt drift (LLM emitting external-cause findings despite the trimmed prompt) and validator drift (sudden spike in deterministic findings).

#### 7.3 Tests

- `src/lib/claude/__tests__/generate-quality-review.test.ts` (extend if exists; otherwise skip):
  - assert system prompt no longer contains the substring `"M54.5 used without 5th-character specificity"` and no longer contains `"'A'-suffix codes persisting at discharge"`.

### Success Criteria:

#### Automated Verification:

- [ ] `npx vitest run` full suite passes
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run lint` clean

#### Manual Verification:

- [ ] On a case with no diagnosis-related issues, Recheck produces 0 deterministic findings + an LLM `findings` array that does not contain any external-cause / 7th-character paraphrase
- [ ] Server logs show one `[qc] case=… llm_findings=… deterministic=… merged=…` line per Recheck

---

## Performance Considerations

- Validators are O(diagnoses across the case) — at most ~50 codes per case. Negligible cost vs the Claude call.
- `verifyFinding` re-runs `gatherSourceData`, which fires 12 parallel Supabase reads. Same cost as a Recheck data-gather, but no Claude call. Acceptable for an interactive provider click.
- `parseIvnDiagnoses` is invoked twice on the discharge text (once per validator). Inline cache via `useMemo`-equivalent pure variable inside `runCaseQualityReview` if profiling shows it matters; otherwise leave alone.

## Migration Notes

- One DB migration in Phase 4: `<ts>_backfill_procedure_diagnoses.sql` rewrites `procedures.diagnoses` for `procedure_number ≥ 2` (A→D + V/W/X/Y strip) and `procedure_number = 1` (V/W/X/Y strip only, A-suffix permitted). Use `npx supabase db push` per project convention (memory: feedback_supabase_migrations).
- Existing `case_quality_reviews` rows with LLM-paraphrased findings stay untouched until next Recheck. First Recheck after deploy emits deterministic findings + drops the LLM paraphrase via dedupe. Provider override state on a paraphrased finding is wiped that one time (hash differs) — acceptable cost for the cleanup.
- Phase 5-7 audit-tier `section_key` values (`_qc_external_cause_chain`, `_qc_seventh_character_integrity`) are app-side strings; no DB-schema change needed.
- Phase 4 backfill is idempotent — re-running the migration is a no-op because rewritten codes no longer match the WHERE clause patterns. Safe to re-run on a fresh branch.
- Order of deploy matters: Phases 1-3 must land **before** Phase 4 (otherwise new writes re-introduce the same violations the migration just fixed). Phase 5-7 can land any time after Phase 1.

## References

- Research: [thoughts/shared/research/2026-04-30-icd10-7th-character-integrity-qc.md](../research/2026-04-30-icd10-7th-character-integrity-qc.md)
- QC reviewer: [src/lib/claude/generate-quality-review.ts](../../src/lib/claude/generate-quality-review.ts)
- Action layer: [src/actions/case-quality-reviews.ts](../../src/actions/case-quality-reviews.ts)
- Existing icd10 helpers: [src/lib/icd10/validation.ts](../../src/lib/icd10/validation.ts), [src/lib/icd10/parse-ivn-diagnoses.ts](../../src/lib/icd10/parse-ivn-diagnoses.ts)
- Note-generation rules being mirrored: [src/lib/claude/generate-initial-visit.ts:130-201](../../src/lib/claude/generate-initial-visit.ts), [src/lib/claude/generate-procedure-note.ts:593-649](../../src/lib/claude/generate-procedure-note.ts), [src/lib/claude/generate-discharge-note.ts:401-427](../../src/lib/claude/generate-discharge-note.ts)
- Prior plan (template + override layer): [thoughts/shared/plans/2026-04-30-qc-finding-resolution-layer.md](2026-04-30-qc-finding-resolution-layer.md)
