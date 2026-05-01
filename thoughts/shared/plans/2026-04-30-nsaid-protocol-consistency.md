# NSAID Protocol Consistency Implementation Plan

## Overview

Eliminate the cross-artifact NSAID-language conflict identified in `thoughts/shared/research/2026-04-30-nsaid-language-conflict.md`. Three different NSAID-hold windows currently appear across the procedure note prompt (5 days), the procedure consent PDF post-care text (4–6 weeks before AND after), the consent PDF contraindication checklist (7–10 days), and an unfilled placeholder in the pain-evaluation visit prompt. This plan introduces a single source of truth (`src/lib/clinical/prp-protocol.ts`) and propagates a single, internally consistent set of values: **7-day pre-procedure hold, 2-week protective window before and after, 7-day recent-NSAID screening threshold**.

## Current State Analysis

Four artifacts emit NSAID windows independently:

- `src/lib/claude/generate-procedure-note.ts:384,386-390` — `PRE-PROCEDURE SAFETY CHECKLIST` boilerplate hard-coded to "**5 days prior**", repeated verbatim in 5 paintone reference exemplars.
- `src/lib/claude/generate-initial-visit.ts:343` — pain-evaluation-visit Treatment Plan Para 4 says "avoid NSAIDs for **a specified window** before and after" with no concrete number.
- `src/lib/pdf/procedure-consent-template.tsx:61` — `POST_CARE_ITEMS[0]`: "**4–6 weeks before and after**".
- `src/lib/pdf/procedure-consent-template.tsx:73` — `CONTRAINDICATION_ITEMS[5]`: "**NSAIDs in past 7–10 days**".
- `src/lib/claude/__tests__/generate-procedure-note.test.ts:608,626` — vitest assertions pin the 5-day phrasing literally.

No shared constant exists. Each artifact carries its own hard-coded string.

The research doc concluded:
- No conflict inside any single prompt; conflict is purely cross-artifact.
- `generate-discharge-note.ts`, `generate-summary.ts`, `generate-clinical-orders.ts`, `generate-quality-review.ts` do not mention NSAIDs.
- `src/lib/clinical/` already exists (currently houses `vitals-ranges.ts`) — natural home for a `prp-protocol.ts` constants module.

## Desired End State

A single `PRP_NSAID_PROTOCOL` constants module is the only authoritative source of NSAID windows. All four emit paths build their strings from these constants. Tests assert windows by referencing the constants, not by literal string match. All four artifacts emit the same set of numbers:

- **7 days** = pre-procedure hold (procedure-note safety boilerplate)
- **2 weeks** = protective avoidance window before AND after each PRP injection (consent post-care + pain-evaluation Treatment Plan)
- **7 days** = "recent NSAID exposure" threshold for the contraindication screening checklist on the consent form

After this plan, `grep -rn "NSAID\|ibuprofen\|naproxen\|aspirin"` across `src/lib/claude/` and `src/lib/pdf/` shows window-bearing strings sourced from the constants module, not literals.

### Key Discoveries:
- Procedure-note tests at [generate-procedure-note.test.ts:608,626](src/lib/claude/__tests__/generate-procedure-note.test.ts#L608) literal-match the boilerplate; updating the prompt without updating the test breaks `npm test`.
- The five paintone reference exemplars at [generate-procedure-note.ts:386-390](src/lib/claude/generate-procedure-note.ts#L386-L390) all repeat the same hold-days clause — single template-literal substitution updates all five.
- Pain-eval prompt placeholder phrase "a specified window" at [generate-initial-visit.ts:343](src/lib/claude/generate-initial-visit.ts#L343) is the LLM's only signal — replacing with a concrete number ("2 weeks before and after each PRP injection") removes the freedom to drift.
- Consent PDF strings are static module-level constants — string-builder helpers replace them cleanly.

## What We're NOT Doing

- Not changing the initial-visit ibuprofen recommendation at [generate-initial-visit.ts:220-223](src/lib/claude/generate-initial-visit.ts#L220-L223). Initial-visit patient is not yet recommended for PRP; "no NSAIDs beyond ibuprofen" rule stays.
- Not introducing a database column for the NSAID protocol. Values live in code.
- Not surfacing the protocol to clinic settings/admin UI. Hard-coded constants module.
- Not changing any other section of the consent PDF (procedure description, benefits, risks, signature block).
- Not modifying `generate-discharge-note.ts`, `generate-summary.ts`, `generate-clinical-orders.ts`, `generate-quality-review.ts` — none reference NSAIDs.
- Not migrating existing finalized notes/PDFs in storage. The fix takes effect on newly generated artifacts only.
- Not adding clinic-protocol overrides. One protocol, codebase-wide.

## Implementation Approach

Three phases. Phase 1 lands the constants module and helper sentence-builders, with unit tests. Phase 2 wires the LLM-prompt builders (procedure note + pain-evaluation visit) to consume the constants and updates the existing prompt-tests to assert via the constants. Phase 3 wires the consent PDF and any related render tests. Each phase is independently mergeable; intermediate state remains correct because each consumer is migrated atomically with its tests.

---

## Phase 1: Add `prp-protocol` constants module + sentence-builder helpers

### Overview
Create the single source of truth and the small string-builder helpers that downstream consumers will call. Land with full unit-test coverage so subsequent phases can rely on stable contracts.

### Changes Required:

#### 1. New constants + helpers module
**File**: `src/lib/clinical/prp-protocol.ts` (new)
**Changes**: Export the protocol object and three string-builder helpers.

```ts
export const PRP_NSAID_PROTOCOL = {
  // Hard hold immediately before a PRP injection — surfaced in procedure-note safety boilerplate.
  preProcedureHoldDays: 7,
  // Protective avoidance window before AND after each injection — surfaced in consent post-care
  // and in the pain-evaluation visit treatment plan.
  protectiveWindowWeeks: 2,
  // Threshold for the consent contraindication checklist — flags recent NSAID exposure that
  // would defer the procedure.
  screeningRecentDays: 7,
} as const

// "...has held NSAIDs for 7 days prior to the procedure per protocol..."
export function nsaidHeldPreProcedureClause(): string {
  const { preProcedureHoldDays } = PRP_NSAID_PROTOCOL
  return `held NSAIDs for ${preProcedureHoldDays} days prior to the procedure per protocol`
}

// "Avoid NSAIDs (ibuprofen, naproxen, aspirin, etc.) for 2 weeks before and after the procedure..."
export function nsaidPostCareInstructionSentence(): string {
  const { protectiveWindowWeeks } = PRP_NSAID_PROTOCOL
  return `Avoid NSAIDs (ibuprofen, naproxen, aspirin, etc.) for ${protectiveWindowWeeks} weeks before and after the procedure, as they may interfere with the healing response.`
}

// "NSAIDs in past 7 days"
export function nsaidScreeningContraindicationLabel(): string {
  const { screeningRecentDays } = PRP_NSAID_PROTOCOL
  return `NSAIDs in past ${screeningRecentDays} days`
}

// "avoid NSAIDs for 2 weeks before and after each PRP injection"
export function nsaidAvoidanceTreatmentPlanFragment(): string {
  const { protectiveWindowWeeks } = PRP_NSAID_PROTOCOL
  return `avoid NSAIDs for ${protectiveWindowWeeks} weeks before and after each PRP injection`
}
```

#### 2. Unit tests for the module
**File**: `src/lib/clinical/__tests__/prp-protocol.test.ts` (new)
**Changes**: Vitest spec covering all four exports.

```ts
import { describe, it, expect } from 'vitest'
import {
  PRP_NSAID_PROTOCOL,
  nsaidHeldPreProcedureClause,
  nsaidPostCareInstructionSentence,
  nsaidScreeningContraindicationLabel,
  nsaidAvoidanceTreatmentPlanFragment,
} from '../prp-protocol'

describe('PRP_NSAID_PROTOCOL', () => {
  it('exposes the canonical windows', () => {
    expect(PRP_NSAID_PROTOCOL.preProcedureHoldDays).toBe(7)
    expect(PRP_NSAID_PROTOCOL.protectiveWindowWeeks).toBe(2)
    expect(PRP_NSAID_PROTOCOL.screeningRecentDays).toBe(7)
  })
})

describe('sentence builders', () => {
  it('builds the pre-procedure held clause', () => {
    expect(nsaidHeldPreProcedureClause()).toBe('held NSAIDs for 7 days prior to the procedure per protocol')
  })
  it('builds the post-care instruction sentence', () => {
    expect(nsaidPostCareInstructionSentence()).toBe(
      'Avoid NSAIDs (ibuprofen, naproxen, aspirin, etc.) for 2 weeks before and after the procedure, as they may interfere with the healing response.'
    )
  })
  it('builds the screening contraindication label', () => {
    expect(nsaidScreeningContraindicationLabel()).toBe('NSAIDs in past 7 days')
  })
  it('builds the treatment-plan avoidance fragment', () => {
    expect(nsaidAvoidanceTreatmentPlanFragment()).toBe('avoid NSAIDs for 2 weeks before and after each PRP injection')
  })
})
```

### Success Criteria:

#### Automated Verification:
- [x] Type check passes: `npx tsc --noEmit`
- [x] Lint passes: `npm run lint`
- [x] New module tests pass: `npx vitest run src/lib/clinical/__tests__/prp-protocol.test.ts`
- [x] Full suite still green (no consumer migrations yet, so no regressions expected): `npm test`

#### Manual Verification:
- [x] None — phase introduces no user-visible behavior.

**Implementation Note**: Phase 1 is purely additive. Pause here only long enough to confirm the new tests pass; no manual verification needed.

---

## Phase 2: Wire LLM prompt builders to the constants

### Overview
Replace hard-coded NSAID strings in the procedure-note system prompt and the pain-evaluation visit Treatment Plan with calls into `prp-protocol.ts`. Update the procedure-note tests to assert via the constants. The pain-evaluation prompt's placeholder ("a specified window") becomes the concrete fragment from `nsaidAvoidanceTreatmentPlanFragment()`.

### Changes Required:

#### 1. Procedure-note system prompt
**File**: `src/lib/claude/generate-procedure-note.ts`
**Changes**: Import the helper, replace the literal "5 days" boilerplate at line 384 and the five paintone reference exemplars at lines 386–390. The simplest mechanism is to define a local sentence constant near the top of the file and interpolate it into the template-literal prompt.

Add at the top of the file (after existing imports):
```ts
import { nsaidHeldPreProcedureClause } from '@/lib/clinical/prp-protocol'

const NSAID_HELD_CLAUSE = nsaidHeldPreProcedureClause() // "held NSAIDs for 7 days prior to the procedure per protocol"
```

Replace, in the `PRE-PROCEDURE SAFETY CHECKLIST` paragraph (around line 384), every literal `held NSAIDs for 5 days prior to the procedure per protocol` with `${NSAID_HELD_CLAUSE}` inside the surrounding template literal. The five paintone exemplars at lines 386–390 each contain the same fragment as part of an embedded sentence: `He has held NSAIDs for 5 days prior to the procedure per protocol and denies fever, ...` — replace the fixed substring with `He has ${NSAID_HELD_CLAUSE} and denies fever, ...`. Apply the same substitution for `She has ...` in the "Ms. Taylor" exemplar.

#### 2. Pain-evaluation visit Treatment Plan Para 4
**File**: `src/lib/claude/generate-initial-visit.ts`
**Changes**: Import the helper. Replace the placeholder phrase "avoid NSAIDs for a specified window before and after each PRP injection" at line 343 with the helper output.

Add at the top of the file:
```ts
import { nsaidAvoidanceTreatmentPlanFragment } from '@/lib/clinical/prp-protocol'

const NSAID_AVOIDANCE_FRAGMENT = nsaidAvoidanceTreatmentPlanFragment() // "avoid NSAIDs for 2 weeks before and after each PRP injection"
```

In `PAIN_EVALUATION_VISIT_SECTIONS`, change `the patient is advised to avoid NSAIDs for a specified window before and after each PRP injection to avoid inhibiting the platelet-mediated healing response` to `the patient is advised to ${NSAID_AVOIDANCE_FRAGMENT} to avoid inhibiting the platelet-mediated healing response`.

The initial-visit Medication Management block at lines 217–223 is intentionally unchanged (see "What We're NOT Doing").

#### 3. Procedure-note tests
**File**: `src/lib/claude/__tests__/generate-procedure-note.test.ts`
**Changes**: Replace the two literal-string assertions at lines 608 and 626 with assertions sourced from the helper.

```ts
import { nsaidHeldPreProcedureClause } from '@/lib/clinical/prp-protocol'

// line 608 area:
expect(system).toContain(nsaidHeldPreProcedureClause())

// line 626 area:
const clause = nsaidHeldPreProcedureClause()
const matches = sBlock.match(new RegExp(clause.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []
```

This makes the test track the canonical value. If `preProcedureHoldDays` is later tuned, the prompt and the test both follow without manual sync.

### Success Criteria:

#### Automated Verification:
- [x] Type check passes: `npx tsc --noEmit`
- [x] Lint passes: `npm run lint`
- [x] Procedure-note generator tests pass: `npx vitest run src/lib/claude/__tests__/generate-procedure-note.test.ts`
- [x] Full suite green: `npm test`
- [x] Sanity grep — no remaining `5 days prior to the procedure` literal in `src/`: `! grep -rn '5 days prior to the procedure' src/`
- [x] Sanity grep — no remaining `a specified window` placeholder in `src/lib/claude/`: `! grep -rn 'a specified window' src/lib/claude/`

#### Manual Verification:
- [ ] Generate a procedure note via the running app for a sample case; confirm the safety-clearance sentence reads "...held NSAIDs for 7 days prior to the procedure per protocol..." in the rendered subjective.
- [ ] Generate a pain-evaluation visit note for a sample case with PRP recommendation; confirm Treatment Plan Para 4 reads "...avoid NSAIDs for 2 weeks before and after each PRP injection..." with no placeholder phrasing.
- [ ] Spot-check a `paintoneLabel="improved", 2+ prior` case to confirm the female-pronoun exemplar phrasing renders correctly.

**Implementation Note**: After Phase 2 automated verification, pause for the manual checks above before starting Phase 3 — the prompt changes are user-visible in generated notes and warrant a real-data spot-check.

---

## Phase 3: Wire consent PDF to the constants

### Overview
Replace the two static literal strings in `procedure-consent-template.tsx` with the helper outputs. Add or update render tests to assert the new text.

### Changes Required:

#### 1. Consent PDF template
**File**: `src/lib/pdf/procedure-consent-template.tsx`
**Changes**: Import the two relevant helpers; rewrite `POST_CARE_ITEMS[0]` and `CONTRAINDICATION_ITEMS[5]` to call them.

Add to the existing imports:
```ts
import {
  nsaidPostCareInstructionSentence,
  nsaidScreeningContraindicationLabel,
} from '@/lib/clinical/prp-protocol'
```

Change `POST_CARE_ITEMS` (around lines 60–65):
```ts
const POST_CARE_ITEMS = [
  nsaidPostCareInstructionSentence(),
  'Do not apply ice to the injection site for at least 72 hours.',
  'Observe activity restrictions as directed by your provider; avoid strenuous activity involving the treated area for the recommended period.',
  'Attend all scheduled follow-up appointments and notify the clinic of any signs of infection, severe pain, or unexpected reactions.',
]
```

Change `CONTRAINDICATION_ITEMS` (around lines 67–78):
```ts
const CONTRAINDICATION_ITEMS = [
  'Active infection at injection site',
  'Active cancer / chemotherapy / radiation',
  'Blood clotting disorder (thrombocytopenia, hemophilia)',
  'Anticoagulants (Eliquis, Xarelto, Coumadin, etc.)',
  'Antiplatelet drugs (Plavix, daily aspirin)',
  nsaidScreeningContraindicationLabel(),
  'Systemic corticosteroids in past 2 weeks',
  'Pregnancy',
  'Known allergy to local anesthetic',
  'Previous adverse reaction to PRP',
]
```

#### 2. Consent PDF render test (add if missing, extend if present)
**File**: `src/lib/pdf/__tests__/procedure-consent-template.test.tsx` (new if absent — check first)
**Changes**: Render the component to a string snapshot via `@react-pdf/renderer`'s `renderToBuffer`/`renderToString` (or whichever helper the existing PDF tests already use — match the convention from sibling tests like `render-procedure-note-pdf.ts` consumers). Assert the rendered output contains both the post-care sentence and the contraindication label sourced from the helpers.

```ts
import { describe, it, expect } from 'vitest'
import {
  nsaidPostCareInstructionSentence,
  nsaidScreeningContraindicationLabel,
} from '@/lib/clinical/prp-protocol'
// + whichever rendering helper the other PDF tests use to obtain text content

describe('ProcedureConsentPdf NSAID language', () => {
  it('uses the canonical post-care sentence', async () => {
    const text = await renderConsentToText(sampleData) // helper matching existing pattern
    expect(text).toContain(nsaidPostCareInstructionSentence())
  })

  it('uses the canonical screening contraindication label', async () => {
    const text = await renderConsentToText(sampleData)
    expect(text).toContain(nsaidScreeningContraindicationLabel())
  })
})
```

If no PDF unit-test infrastructure exists in the repo, add a lightweight assertion against the source-level `POST_CARE_ITEMS` and `CONTRAINDICATION_ITEMS` arrays via a re-export, OR skip this test file and rely on the existing render-helper tests for `render-procedure-consent-pdf.ts` if they already cover string content.

### Success Criteria:

#### Automated Verification:
- [x] Type check passes: `npx tsc --noEmit`
- [x] Lint passes: `npm run lint`
- [x] Consent-template tests pass (if added): `npx vitest run src/lib/pdf/__tests__/procedure-consent-template.test.ts`
- [x] Full suite green: `npm test`
- [x] Sanity grep — no remaining "4–6 weeks before and after" or "past 7–10 days" literal: `! grep -rn '4–6 weeks before and after\|past 7–10 days' src/`
- [x] Build succeeds: `npm run build`

#### Manual Verification:
- [ ] Render the consent PDF for a sample case; confirm Post-Procedure Instructions list bullet 1 reads "Avoid NSAIDs (ibuprofen, naproxen, aspirin, etc.) for 2 weeks before and after the procedure, as they may interfere with the healing response."
- [ ] Confirm the Contraindications checklist bullet reads "NSAIDs in past 7 days".
- [ ] Cross-check: open a procedure note + consent PDF generated for the same case in the same browser session; confirm the patient-facing windows are now mutually consistent (consent says "2 weeks before and after"; procedure note says "held NSAIDs for 7 days prior").
- [ ] Layout regression check: confirm the consent PDF still fits its expected page count (the new post-care sentence is a few characters shorter than the old "4–6 weeks" wording, so wrapping should be neutral or better).

**Implementation Note**: After Phase 3 manual verification, the cross-artifact consistency goal is met. No further phases.

---

## Testing Strategy

### Unit Tests:
- `prp-protocol.test.ts` (Phase 1) is the foundation: a single source of truth means a single set of assertions on canonical values. If `PRP_NSAID_PROTOCOL` values change in the future, this test catches accidental drift.
- `generate-procedure-note.test.ts` updates (Phase 2) shift from literal string match to helper-call assertion, so the tests follow the constant automatically.
- Consent PDF assertion (Phase 3) follows the same pattern.

### Integration Tests:
- `npm test` (full vitest suite) at the end of each phase verifies no other code path silently depended on the old literals.

### Manual Testing Steps:
1. Open the app, pick a sample case with a procedure scheduled.
2. Generate a procedure note. Read the subjective paragraph: confirm "...held NSAIDs for 7 days prior to the procedure per protocol..."
3. Pick a sample case at the pain-evaluation stage (no procedure yet, MRI on file). Generate a pain-evaluation visit note. Read Treatment Plan Para 4: confirm "...avoid NSAIDs for 2 weeks before and after each PRP injection..."
4. Generate the procedure-consent PDF for a procedure-stage case. Read the Post-Procedure Instructions: confirm "Avoid NSAIDs (ibuprofen, naproxen, aspirin, etc.) for 2 weeks before and after the procedure...". Read the Contraindications checklist: confirm "NSAIDs in past 7 days".
5. Side-by-side check: a single patient's note + consent PDF together tell one consistent story (7-day pre-hold, 2-week protective window, 7-day screening look-back).

## Performance Considerations

None. Constants are evaluated once at module load; helper calls are pure string concatenation. No runtime overhead.

## Migration Notes

- Existing finalized notes and PDFs stored in Supabase storage are not migrated. The fix applies only to artifacts generated after the change ships.
- No database schema changes.
- No environment-variable changes.
- Rollback: revert the three commits (one per phase) in reverse order. Each phase is independently revertable because Phase 1 is additive, and Phases 2 and 3 each migrate a single consumer.

## References

- Research doc: `thoughts/shared/research/2026-04-30-nsaid-language-conflict.md`
- Related: `thoughts/shared/research/2026-04-06-procedure-consent-form-implementation.md`
- Procedure-note prompt — current state: [src/lib/claude/generate-procedure-note.ts:384-390](src/lib/claude/generate-procedure-note.ts#L384-L390)
- Pain-eval-visit prompt — current state: [src/lib/claude/generate-initial-visit.ts:343](src/lib/claude/generate-initial-visit.ts#L343)
- Consent PDF — current state: [src/lib/pdf/procedure-consent-template.tsx:60-78](src/lib/pdf/procedure-consent-template.tsx#L60-L78)
- Procedure-note tests — current state: [src/lib/claude/__tests__/generate-procedure-note.test.ts:608](src/lib/claude/__tests__/generate-procedure-note.test.ts#L608)
- Existing constants module sibling: [src/lib/clinical/vitals-ranges.ts](src/lib/clinical/vitals-ranges.ts)
