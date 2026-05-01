---
date: 2026-04-30T17:00:58-07:00
researcher: arsenaid
git_commit: c6ab1bfced24fbdcd7c6642fa18d723b2bece144
branch: main
repository: cliniq
topic: "NSAID language conflicts in note generation"
tags: [research, codebase, prompt-engineering, prp, procedure-note, initial-visit, consent-form]
status: complete
last_updated: 2026-04-30
last_updated_by: arsenaid
---

# Research: NSAID language conflicts in note generation

**Date**: 2026-04-30T17:00:58-07:00
**Researcher**: arsenaid
**Git Commit**: c6ab1bfced24fbdcd7c6642fa18d723b2bece144
**Branch**: main
**Repository**: cliniq

## Research Question
Check if there is NSAID language conflict in note generation.

## Summary

Four artifacts in the codebase mention NSAIDs. No conflict exists *inside* any single prompt, but **three distinct NSAID-hold windows are emitted across artifacts that describe the same PRP protocol**, and the pain-evaluation-visit (PRP-recommendation) prompt leaves the window unspecified, allowing the model to pick a value that may disagree with the procedure note boilerplate and the patient consent form generated for the same case.

NSAID-mentioning files:
- [src/lib/claude/generate-initial-visit.ts](src/lib/claude/generate-initial-visit.ts) — note-generation prompt for initial visit + pain-evaluation visit
- [src/lib/claude/generate-procedure-note.ts](src/lib/claude/generate-procedure-note.ts) — note-generation prompt for procedure note
- [src/lib/pdf/procedure-consent-template.tsx](src/lib/pdf/procedure-consent-template.tsx) — patient-facing PDF consent form
- [src/lib/claude/__tests__/generate-procedure-note.test.ts](src/lib/claude/__tests__/generate-procedure-note.test.ts) — asserts the procedure-note boilerplate

`grep -rni "nsaid"` over `src/lib/claude/generate-discharge-note.ts`, `generate-summary.ts`, `generate-clinical-orders.ts`, and `generate-quality-review.ts` returned no hits — discharge, case summary, clinical orders, and QC do not mention NSAIDs at all.

## Detailed Findings

### Three NSAID-hold windows, same PRP protocol

The same clinical event ("hold NSAIDs around the PRP injection") is described with three different durations:

| Artifact | Window | Phrasing | Location |
|---|---|---|---|
| Procedure-note prompt boilerplate | **5 days prior** | "He has held NSAIDs for 5 days prior to the procedure per protocol…" | [generate-procedure-note.ts:384](src/lib/claude/generate-procedure-note.ts#L384) |
| Procedure-note prompt — `paintoneLabel` reference exemplars | **5 days prior** | repeated in 5 reference exemplars (baseline / improved-1prior / stable-1prior / worsened-1prior / improved-2+prior) | [generate-procedure-note.ts:386-390](src/lib/claude/generate-procedure-note.ts#L386-L390) |
| Pain-evaluation-visit prompt (Treatment Plan, Para 4) | **unspecified** | "avoid NSAIDs for a specified window before and after each PRP injection" — no number | [generate-initial-visit.ts:343](src/lib/claude/generate-initial-visit.ts#L343) |
| Procedure consent PDF — Post-Care | **4–6 weeks before AND after** | "Avoid NSAIDs (ibuprofen, naproxen, aspirin, etc.) for 4–6 weeks before and after the procedure, as they may interfere with the healing response." | [procedure-consent-template.tsx:61](src/lib/pdf/procedure-consent-template.tsx#L61) |
| Procedure consent PDF — Contraindication checklist | **past 7–10 days** | bullet "NSAIDs in past 7–10 days" | [procedure-consent-template.tsx:73](src/lib/pdf/procedure-consent-template.tsx#L73) |

The procedure-note boilerplate (5 days) and the consent-form post-care language (4–6 weeks before and after) describe the same hold window from the patient's point of view but disagree by ~1 order of magnitude. The consent-form contraindication checklist (7–10 days) further disagrees with both. The pain-evaluation-visit prompt does not pin a number, so the LLM may emit any window in the generated PRP-recommendation note.

### Same-patient cross-artifact path

A single patient case can produce all four artifacts in sequence:

1. **Initial Visit note** — recommends ibuprofen 600 mg TID + acetaminophen ([generate-initial-visit.ts:220-222](src/lib/claude/generate-initial-visit.ts#L220-L222))
2. **Pain-Evaluation Visit note** — recommends PRP series, advises "avoid NSAIDs for a specified window" with no concrete number ([generate-initial-visit.ts:343](src/lib/claude/generate-initial-visit.ts#L343))
3. **Procedure Consent PDF** — printed to the patient with "4–6 weeks before AND after" language ([procedure-consent-template.tsx:61](src/lib/pdf/procedure-consent-template.tsx#L61))
4. **Procedure Note** — boilerplate "held NSAIDs for 5 days prior to the procedure per protocol" ([generate-procedure-note.ts:384](src/lib/claude/generate-procedure-note.ts#L384))

Steps (1) and (2) are produced by the same generator file (`generate-initial-visit.ts`) but by different `visitType` branches (`INITIAL_VISIT_SECTIONS` vs `PAIN_EVALUATION_VISIT_SECTIONS`).

### Initial Visit ibuprofen recommendation

[generate-initial-visit.ts:217-223](src/lib/claude/generate-initial-visit.ts#L217-L223) instructs:

> Medication Management
> Provide specific OTC medication guidance with dose, route, frequency, indication, and daily maximum… Reference tone:
> • "Ibuprofen 600 mg by mouth three times daily as needed with food for pain and inflammation (do not exceed 2,400 mg/day)."
> • "Acetaminophen (Tylenol) 500–1,000 mg by mouth every 6–8 hours as needed (do not exceed 3,000 mg/day)."
> …
> Do NOT recommend prescription opioids, gabapentinoids, or NSAIDs beyond ibuprofen at this stage.

Within the prompt this is internally consistent: ibuprofen is the only NSAID permitted, and the "beyond ibuprofen" qualifier excludes other NSAIDs (naproxen, ketorolac, etc). No NSAID hold is mentioned at the initial-visit stage because the patient has not yet been recommended for PRP.

### Pain-Evaluation Visit NSAID-avoidance language

[generate-initial-visit.ts:343](src/lib/claude/generate-initial-visit.ts#L343), Para 4 of Treatment Plan:

> (a) medication guidance — the patient is advised to avoid NSAIDs for a specified window before and after each PRP injection to avoid inhibiting the platelet-mediated healing response, with acetaminophen permitted for breakthrough pain as needed

The phrase "a specified window" is left as filler. There is no companion data field on the input (e.g., `feeEstimate`-style structured field) that supplies the window length, and no other line in this prompt pins a number. The LLM is therefore free to:
- omit the number (current default behavior),
- emit "5 days" matching the procedure-note boilerplate,
- emit "4–6 weeks" matching the consent-form post-care text,
- emit "7–10 days" matching the consent-form contraindication checklist,
- emit any other clinically reasonable window.

### Procedure-note boilerplate (5 days)

[generate-procedure-note.ts:384](src/lib/claude/generate-procedure-note.ts#L384) is a `PRE-PROCEDURE SAFETY CHECKLIST (MANDATORY)` directive:

> Use this exact language when the chart does not document otherwise: "He [or she] has held NSAIDs for 5 days prior to the procedure per protocol and denies fever, bleeding diathesis, recent anticoagulant use, or new neurological complaints."

The directive is conditional on chart silence — "If any of those fields IS documented separately on the input data, incorporate the actual status; otherwise emit the boilerplate above unchanged" — so the 5-day number is an emit-when-no-data default, not a documented chart fact.

The five reference exemplars at [generate-procedure-note.ts:386-390](src/lib/claude/generate-procedure-note.ts#L386-L390) repeat the 5-day phrasing verbatim across paintone variants.

### Test asserts the 5-day boilerplate

[src/lib/claude/__tests__/generate-procedure-note.test.ts:608](src/lib/claude/__tests__/generate-procedure-note.test.ts#L608) and [:626](src/lib/claude/__tests__/generate-procedure-note.test.ts#L626) assert the literal "held NSAIDs for 5 days prior to the procedure per protocol" string appears in the procedure-note system prompt and in the subjective block. This pins the procedure-note window at 5 days.

### Consent-form windows — two values in one PDF

[procedure-consent-template.tsx](src/lib/pdf/procedure-consent-template.tsx) emits both windows in the SAME document for the SAME case:

- `POST_CARE_ITEMS[0]` ([:61](src/lib/pdf/procedure-consent-template.tsx#L61)): 4–6 weeks before and after.
- `CONTRAINDICATION_ITEMS[5]` ([:73](src/lib/pdf/procedure-consent-template.tsx#L73)): "NSAIDs in past 7–10 days".

These are static template strings, not LLM outputs. They appear under different headings inside the printed consent form.

## Code References
- `src/lib/claude/generate-initial-visit.ts:220-223` — initial-visit ibuprofen recommendation + "no NSAIDs beyond ibuprofen" rule
- `src/lib/claude/generate-initial-visit.ts:343` — pain-evaluation-visit "avoid NSAIDs for a specified window" (no concrete number)
- `src/lib/claude/generate-procedure-note.ts:384` — procedure-note boilerplate 5-day NSAID hold
- `src/lib/claude/generate-procedure-note.ts:386-390` — five paintone reference exemplars repeating the 5-day phrasing
- `src/lib/claude/__tests__/generate-procedure-note.test.ts:608,626` — tests pinning the 5-day language
- `src/lib/pdf/procedure-consent-template.tsx:61` — consent PDF post-care: 4–6 weeks before and after
- `src/lib/pdf/procedure-consent-template.tsx:73` — consent PDF contraindication checklist: 7–10 days

## Architecture Documentation

Three independent emit paths describe NSAID hold:

1. **LLM-generated procedure note** — the system prompt in `generate-procedure-note.ts` includes a hard-coded fallback sentence with the 5-day window. Tests assert the exact wording.
2. **LLM-generated PRP-recommendation note (pain-evaluation visit)** — the system prompt in `generate-initial-visit.ts` (PAIN_EVALUATION_VISIT_SECTIONS branch) leaves the window as the placeholder phrase "a specified window". The model fills or skips it freely.
3. **Static consent PDF** — `procedure-consent-template.tsx` is a `@react-pdf/renderer` template with two static string arrays (`POST_CARE_ITEMS`, `CONTRAINDICATION_ITEMS`) holding the two consent-form windows. No LLM involvement.

There is no shared constant or single source of truth for the NSAID-hold window across these three paths. Each artifact carries its own copy of the window number (or absence of a number).

## Related Research
- [thoughts/shared/research/2026-04-06-procedure-consent-form-implementation.md](thoughts/shared/research/2026-04-06-procedure-consent-form-implementation.md)
- [thoughts/shared/research/2026-03-26-initial-visit-no-prior-treatment-use-case.md](thoughts/shared/research/2026-03-26-initial-visit-no-prior-treatment-use-case.md)

## Open Questions
- Which window is clinically authoritative for this practice (5 days, 7–10 days, or 4–6 weeks)? The codebase does not record a primary source.
- Does the pain-evaluation-visit prompt intentionally leave "a specified window" unfilled (deferring to the consent form / clinician edit), or is the placeholder a TODO?
- Is the consent PDF's internal split between "4–6 weeks before and after" (post-care) and "past 7–10 days" (contraindication checklist) intentional (different decision boundaries — e.g., consent-stage screening vs. healing window), or is one of them stale?
