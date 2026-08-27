# Pain Evaluation → PRP NSAID Window Gaps

**Date:** 2026-08-27
**Scope:** Current-state research only; no implementation recommendation or code change.

## Research question

Where does the application communicate, screen, or attest to NSAID avoidance between a Pain Management evaluation that recommends PRP and the following PRP procedure, and what gaps exist between the two-week instruction and the seven-day hold?

## Summary

The code intentionally defines three separate NSAID windows in one shared module: a **two-week before-and-after counseling window**, a **seven-day recent-use screening window**, and a **seven-day pre-procedure hold attestation**. The Pain Evaluation treatment plan communicates the two-week window, while the generated PRP procedure note attests only that NSAIDs were held for seven days. The consent PDF repeats both concepts on the same document: it screens for NSAIDs in the past seven days but instructs avoidance for two weeks before and after.

The main continuity gap is therefore not a stale literal or duplicate constant. It is encoded in the canonical model and enforced by tests. A patient can fail the evaluation's 14-day pre-procedure instruction (for example, use an NSAID 8–13 days before PRP), pass the seven-day procedure screening, and receive a procedure note stating compliance “per protocol.” No structured field records last NSAID use, the instructed window, an exception, or clinician disposition. The procedure-note generator emits its seven-day safety statement as boilerplate when the chart has no documentation.

A second, independent contradiction exists after the procedure: the procedure-note prompt's discharge example explicitly tells the patient to continue Naproxen and apply ice, while the consent PDF tells the patient to avoid NSAIDs for two weeks after PRP and not apply ice for 72 hours.

## Detailed findings

### 1. Canonical protocol encodes unequal windows

`src/lib/clinical/prp-protocol.ts` is the single source of truth:

- `preProcedureHoldDays: 7` drives “held NSAIDs for 7 days prior.”
- `protectiveWindowWeeks: 2` drives both Pain Evaluation counseling and consent post-care language (“2 weeks before and after”).
- `screeningRecentDays: 7` drives the consent contraindication checklist.

These are separate values rather than alternate formatting of the same value. Tests assert all three exact values in `src/lib/clinical/__tests__/prp-protocol.test.ts`.

### 2. Pain Management evaluation communicates 14 days before PRP

The Pain Evaluation branch of `src/lib/claude/generate-initial-visit.ts` imports `nsaidAvoidanceTreatmentPlanFragment()` and injects it into Treatment Plan paragraph 4. The generated instruction is to “avoid NSAIDs for 2 weeks before and after each PRP injection,” with acetaminophen allowed for breakthrough pain.

This is an LLM prompt instruction stored as narrative in the generated initial-visit note. The Pain Evaluation input shape shown in this generator does not turn the NSAID instruction into a dated task, acknowledgement, or medication-hold record.

### 3. Procedure stage screens and attests to only seven days

`src/lib/claude/generate-procedure-note.ts` imports `nsaidHeldPreProcedureClause()` and requires every procedure-note subjective to include a safety-clearance sentence stating that the patient held NSAIDs for seven days.

The prompt explicitly says to emit this boilerplate when the chart does not document otherwise, says it represents standard clinical clearance, and forbids a confirmation placeholder. The five reference narratives repeat the seven-day clause.

The structured `ProcedureNoteInputData.procedureRecord` includes `consent_obtained` and procedural details, but no field for:

- last NSAID name or dose;
- last NSAID use date/time;
- number of days actually held;
- whether the two-week Pain Evaluation instruction was followed;
- clinician exception/disposition for use during days 8–13.

`gatherProcedureNoteSourceData()` in `src/actions/procedure-notes.ts` gathers procedure, vitals, earlier notes/extractions, and related clinical context, but no structured NSAID clearance response. Procedure-note generation requires a completed evaluation or follow-up encounter, not documented compliance with its medication instructions.

### 4. Consent PDF contains the same internal split

`src/lib/pdf/procedure-consent-template.tsx` renders:

- a contraindication checkbox labeled “NSAIDs in past 7 days”; and
- a post-procedure instruction to avoid NSAIDs for two weeks before and after PRP.

Thus a patient with NSAID use 8–13 days earlier is outside the checklist's queried period while still inside the document's stated avoidance period. The checklist says to check contraindications that apply, but the application does not feed checked checklist items into the procedure record; `consent_obtained` is a single boolean.

### 5. Post-procedure generated-note instructions conflict with consent

The `procedure_post_care` prompt in `src/lib/claude/generate-procedure-note.ts` uses an example that advises continuing “Naproxen and Acetaminophen” and applying ice as needed. Naproxen is an NSAID. The PRP consent's canonical instruction says to avoid NSAIDs for two weeks after the procedure, and its next item says not to apply ice for at least 72 hours.

The procedure-note prompt does not import or reuse `nsaidPostCareInstructionSentence()`. No focused test found in the NSAID protocol, procedure-note, or consent suites asserts cross-artifact agreement for post-care medication or ice instructions.

## Execution and data flow

1. A Pain Evaluation note is generated with a narrative instruction to avoid NSAIDs for two weeks before and after each PRP injection.
2. A completed evaluation/follow-up encounter satisfies the procedure-note prerequisite.
3. The PRP procedure is recorded with a general `consent_obtained` boolean and procedural facts; no NSAID timing value is captured.
4. The consent PDF presents a seven-day contraindication screen alongside a two-week avoidance instruction.
5. Procedure-note generation receives no structured NSAID response and is directed to state a seven-day hold by default.
6. Its post-care section may follow an example that permits Naproxen and ice, despite the consent's opposite instructions.

## Gap matrix

| Transition or artifact | Current behavior | Verified gap |
|---|---|---|
| Pain Evaluation → procedure screening | Evaluation says 14 days; screen asks 7 days | Days 8–13 are instructed against but not screened by the canonical checklist. |
| Screening → procedure-note attestation | No structured response; generated note defaults to a 7-day hold | The note can assert clearance without source data and without addressing the full instructed window. |
| Consent instruction → consent checklist | Same PDF says 14 days but checks only 7 | The document is internally inconsistent about relevant pre-procedure NSAID exposure. |
| Evaluation note → procedure prerequisite | Completed encounter is required | Completion does not establish medication-instruction acknowledgement or compliance. |
| Consent → generated post-care note | Consent prohibits NSAIDs and ice; note example permits Naproxen and ice | Patient-facing aftercare can conflict across artifacts. |
| Shared protocol → tests | Tests assert 14-day, 7-day, and 7-day values independently | Tests preserve the split but do not test semantic continuity across the care path. |

## Existing tests

- `src/lib/clinical/__tests__/prp-protocol.test.ts` asserts the three canonical windows and exact generated phrases.
- `src/lib/claude/__tests__/generate-procedure-note.test.ts` asserts that the mandatory prompt includes the shared seven-day clause and repeats it in reference examples.
- `src/lib/pdf/__tests__/procedure-consent-template.test.ts` asserts that the consent includes the shared two-week instruction and seven-day screening label, and excludes older literals.

These tests verify wiring to shared helpers. They do not assert that the evaluation instruction, screening interval, attestation interval, and post-care note agree semantically.

## Historical context

Commit `7693fe5` (“single source of truth for PRP NSAID protocol windows,” 2026-04-30) introduced the shared module and deliberately selected a seven-day hold, two-week protective window, and seven-day recent-use screen. Its stated purpose was to replace older inconsistent literals (five days, four-to-six weeks, and seven-to-ten days). The current discrepancy therefore originated in a consolidation change and is not an accidental failure to adopt the shared module.

## Inferences

- **Inference:** A patient reporting NSAID use 10 days before PRP would pass the literal seven-day checklist while violating the literal two-week instruction. This follows from the encoded intervals; actual clinic handling is not represented in the repository.
- **Inference:** Because the safety sentence is mandatory boilerplate without a supporting input field, a finalized note may state a seven-day hold based on clinician editing/review rather than captured source data. The repository does not prove whether clinicians always perform an external verbal check.
- **Inference:** The Naproxen/ice example creates generation risk, but because output is produced by an LLM and editable, the repository alone cannot establish that every finalized note contains those instructions.

## Open questions

- Is the clinic's intended pre-PRP exclusion window seven days or two weeks?
- Is the two-week “before” language intended as ideal counseling while seven days is the minimum procedure threshold? The code names the values differently but does not document that clinical distinction.
- Is NSAID clearance performed on paper or verbally outside the application, and if so, where is the completed response retained?
- Should aspirin used for antiplatelet therapy be handled differently from OTC NSAID use? The consent lists daily aspirin under antiplatelet drugs and again includes aspirin in the broad NSAID instruction.

## File and symbol references

- `src/lib/clinical/prp-protocol.ts:1-25` — canonical values and phrase builders.
- `src/lib/claude/generate-initial-visit.ts:13-15,336-345` — Pain Evaluation two-week treatment-plan instruction.
- `src/lib/claude/generate-procedure-note.ts:16-18,24-80,445-451,605-610` — procedure input shape, mandatory seven-day attestation, and conflicting aftercare example.
- `src/actions/procedure-notes.ts:120-153,560-600` — gathered sources and completed-encounter prerequisite.
- `src/lib/pdf/procedure-consent-template.tsx:64-85,340-367` — two-week post-care text and seven-day checklist rendered in the consent.
- `src/lib/clinical/__tests__/prp-protocol.test.ts:1-37` — exact protocol assertions.
- `src/lib/claude/__tests__/generate-procedure-note.test.ts:606-632` — procedure prompt assertions.
- `src/lib/pdf/__tests__/procedure-consent-template.test.ts:1-27` — consent phrase assertions.
