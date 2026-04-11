---
date: 2026-03-26T12:00:00-07:00
researcher: Claude
git_commit: 2467d927094be23a75e37a3b2dbf0c9480ac4c71
branch: main
repository: cliniq
topic: "Initial Visit Note Generation — Handling Cases with No Prior Treatment, No Imaging, No Therapy"
tags: [research, codebase, initial-visit, minimal-data, prerequisites, epic-3]
status: complete
last_updated: 2026-04-11
last_updated_by: Claude
last_updated_note: "Split the note into two visit types: Initial Visit (no diagnostics) and Pain Evaluation Visit (diagnostics exist). Same note record, different prompt mode, auto-detected."
---

## Two Visit Types: Initial Visit vs Pain Evaluation Visit

The same note record serves two distinct clinical scenarios. The prompt mode is auto-detected based on whether diagnostic imaging is available:

| Visit Type | Trigger | Clinical Context |
|---|---|---|
| **Initial Visit** | No diagnostics performed yet | First clinical encounter. Imaging is *ordered*, not reviewed. Diagnoses are clinical impressions based on exam + mechanism. Treatment is conservative (medications, imaging orders, chiro/PT referrals). |
| **Pain Evaluation Visit** | Patient has completed diagnostic imaging | Follow-up encounter where imaging findings are reviewed. Diagnoses are imaging-confirmed. Evaluation for advanced interventions (e.g., PRP injections) based on correlation of exam findings with imaging. |

**Detection logic** (first match wins):
1. **Primary**: If `caseSummary.imaging_findings` is populated → **Pain Evaluation Visit**
2. **Fallback**: If any approved MRI or CT scan extraction exists (`mri_extractions` or `ct_scan_extractions` with `review_status IN ('approved','edited')`) → **Pain Evaluation Visit**
3. **Otherwise** → **Initial Visit**

Both modes produce the same note record and share the same 16-section structure, but the system prompt, section framing, and default treatment plan differ substantially.

---

# Research: Initial Visit Note — Handling Cases with No Prior Treatment, No Imaging, No Therapy

**Date**: 2026-03-26T12:00:00-07:00
**Researcher**: Claude
**Git Commit**: 2467d927094be23a75e37a3b2dbf0c9480ac4c71
**Branch**: main
**Repository**: cliniq

## Research Question

What is the best approach to handle the use case where a patient has not visited a doctor prior to the initial visit and has no radiological findings, no therapy history, and no prior treatment? The current system requires an approved case summary before generating an Initial Visit note, and case summary generation itself requires at least one approved extraction — creating a hard block for "fresh" patients.

## Summary

The current system has a **two-gate prerequisite chain** that completely blocks Initial Visit note generation for patients who arrive without any prior clinical records:

1. **Gate 1 — Case Summary**: `generateCaseSummary()` requires at least one approved extraction (MRI, chiro, PT, pain management, orthopedic, or CT scan). If all extraction arrays are empty, it returns: `"No approved extractions found. Approve at least one extraction first."`

2. **Gate 2 — Initial Visit Note**: `generateInitialVisitNote()` requires an approved/edited case summary with `generation_status: 'completed'`. If no such summary exists, it returns: `"An approved case summary is required before generating an Initial Visit note."`

This means a patient who walks in off the street after an accident — with no prior doctor visits, no MRIs, no chiro records, no PT records — **cannot have an Initial Visit note generated** under the current architecture. The provider would need to manually create the entire note.

This is a significant gap because the Initial Visit is often the patient's **first clinical encounter** in the personal injury workflow. Many patients present directly to the pain management clinic without prior imaging or treatment.

### Evidence: Real-World "Day 3 Post-Accident" Initial Visit Note

A real example Initial Visit note from the clinic (dated January 21, 2026 — 3 days after a January 19, 2026 MVA) demonstrates that this is the **primary use case**, not an edge case. Key observations from the actual document:

1. **No prior imaging existed** — MRIs were *ordered* at this visit, not reviewed. The note says: "MRI of Cervical Spine – Ordered / MRI of Lumbar Spine – Ordered / Imaging results pending."
2. **No prior treatment existed** — The patient self-treated with Tylenol and Ibuprofen only. No chiro, no PT, no prior pain management.
3. **No case summary could exist** — This IS the first clinical encounter. There are no extraction sources upstream.
4. **The note is comprehensive and clinically complete** — All 16 sections are fully written with rich clinical narrative based entirely on: (a) accident description from the patient, (b) in-person physical examination findings, (c) clinical assessment by the provider.
5. **Diagnoses are clinical, not imaging-confirmed** — ICD-10 codes are based on physical exam and mechanism of injury (e.g., S13.4XXA cervical ligament sprain, S39.012A lumbar strain), not MRI findings.
6. **Treatment Plan is conservative** — No PRP recommendations. Instead: continue OTC meds, order imaging, referral to chiro/PT, follow-up to monitor. PRP is mentioned only as a future escalation possibility.
7. **Companion documents generated same day** — A Chiropractic Therapy Order and Imaging Orders were also produced at this visit, meaning the Initial Visit note drives downstream referrals.

This fundamentally changes the understanding of the feature: **the Initial Visit note is not a synthesis of prior records — it is the originating clinical document that creates the medical foundation for all subsequent care.**

---

## Detailed Findings

### 1. Current Prerequisite Chain (As Implemented)

#### Gate 1: Case Summary Requires Extractions

**File**: [case-summaries.ts:79-81](src/actions/case-summaries.ts#L79-L81)

The `gatherSourceData()` function checks all six extraction arrays after querying:

```
if all arrays .length === 0 → return error: "No approved extractions found. Approve at least one extraction first."
```

The six extraction types checked:
- `mri_extractions` (approved/edited)
- `chiro_extractions` (approved/edited)
- `pain_management_extractions` (approved/edited)
- `pt_extractions` (approved/edited)
- `orthopedic_extractions` (approved/edited)
- `ct_scan_extractions` (approved/edited)

**Key detail**: The case details (`accident_type`, `accident_date`, `accident_description`) are all nullable and have no presence check — they can all be `null` and the summary will still attempt generation as long as at least one extraction exists.

#### Gate 2: Initial Visit Note Requires Approved Summary

**File**: [initial-visit-notes.ts:61-63](src/actions/initial-visit-notes.ts#L61-L63)

```typescript
if (summaryRes.error || !summaryRes.data) {
  return { data: null, error: 'An approved case summary is required before generating an Initial Visit note.' }
}
```

The query filters for: `review_status IN ('approved', 'edited')` AND `generation_status = 'completed'`.

#### UI Prerequisite Check

**File**: [initial-visit-notes.ts:510-529](src/actions/initial-visit-notes.ts#L510-L529)

`checkNotePrerequisites()` mirrors the same gate — it queries for an approved/edited, completed case summary and returns `{ canGenerate: false, reason: '...' }` if none exists.

### 2. What the AI Prompt Can Handle vs. What the Gates Block

The AI generation system is actually **more flexible** than its prerequisite gates allow:

#### Case Summary Generator (`generate-summary.ts`)
- System prompt Rule 7: `Use "null" for any field where data is insufficient`
- Rule 8: `Set confidence to "low" if source data is sparse`
- The `extraction_notes` field captures: "Any notes about data quality, missing information, or assumptions made"
- **If the gate were removed**, Claude could generate a minimal summary from just accident details

#### Initial Visit Note Generator (`generate-initial-visit.ts`)
- Line 124: `If source data is sparse for any section, write what can be reasonably inferred from available data. Do not fabricate specific measurements, test results, or vital signs — use brackets only for data that requires in-person examination.`
- The prompt explicitly handles null `romData` (omit ROM), null `vitalSigns` (use `[XX]` placeholders), and null `feeEstimate` (use `[To be determined]`)
- **If the gate were removed**, Claude could generate a note with bracket placeholders for imaging, sparse treatment history, and template-based sections

### 3. Current System Prompt Assumes Pain Evaluation Visit — Not Initial Visit

The system prompt in `generate-initial-visit.ts` is written for a **Pain Evaluation Visit** — a patient who has already completed diagnostic imaging and conservative treatment and is being evaluated for PRP injections. This is a fundamental mismatch with the **Initial Visit** use case:

| Section | Current Prompt Assumption (Pain Evaluation Visit) | Initial Visit Workflow |
|---|---|---|
| **History of Accident** (Para 3) | "Despite conservative treatment, continues to complain..." | No conservative treatment has occurred yet |
| **Post-Accident History** | "Timeline of care sought after the accident — ER visits, initial treatment providers (chiro, PT)" | No care has been sought — patient is at their first clinical encounter |
| **Imaging Findings** (Section 9) | "For each MRI, state findings with specific mm measurements" | MRIs are being *ordered*, not reviewed. Should say "Ordered — results pending" |
| **Medical Necessity** (Section 11) | "Correlates clinical exam findings with imaging" + "persistent symptoms despite conservative care" | No imaging to correlate with; no conservative care has been attempted |
| **Treatment Plan** (Section 12) | PRP injection protocol with specific spinal levels, cost estimates, NSAID avoidance for PRP | Conservative management: medication, imaging orders, chiro/PT referrals, follow-up monitoring |
| **Diagnoses** (Section 10) | Implies imaging-confirmed diagnoses (e.g., disc displacement) | Clinical impression codes only (e.g., cervical strain, lumbar strain) based on exam + mechanism |
| **Patient Education** (Section 13) | "PRP mechanism, expected post-injection course" | Injury biomechanics, red-flag symptoms, conservative care guidance, activity modification |
| **Prognosis** (Section 14) | "MRI-confirmed pathology" | "Guarded but favorable given early presentation and absence of neurologic compromise" |

### 4. What an Initial Visit Note Actually Looks Like

Based on the real-world example, **all 16 sections can be fully written** — none need to be empty or placeholder-heavy. The data sources shift from extracted records to provider-entered examination data:

| Section | Data Source (No Prior Records) | Quality |
|---|---|---|
| Introduction | Patient demographics + accident date/type | Full |
| History of Accident | `accident_description` (patient narrative) | Full |
| Post-Accident History | Patient-reported symptom progression since accident, self-treatment (Tylenol/Ibuprofen), functional impact | Full |
| Chief Complaint | Provider-documented during visit — body regions, pain character, aggravating/alleviating factors | Full |
| Past Medical History | Patient-reported: medical conditions, surgeries, allergies | Full |
| Social History | Patient-reported: smoking/drinking, occupation | Full |
| Review of Systems | Provider assessment — constitutional, MSK, neuro screening | Full |
| Physical Exam | Provider-entered vitals + ROM + examination findings per region | Full |
| Imaging Findings | "MRI of Cervical Spine – Ordered / MRI of Lumbar Spine – Ordered / Imaging results pending" | Appropriate |
| Diagnoses | Clinical impression ICD-10 codes based on exam + mechanism (strain/sprain codes, not disc codes) | Full |
| Medical Necessity | Clinical exam findings warrant diagnostic imaging and structured follow-up | Full (different framing) |
| Treatment Plan | Conservative: medications, imaging orders, chiro/PT referral, activity modification, follow-up schedule | Full (different content) |
| Patient Education | Injury biomechanics, red-flag symptoms, activity modification, medication guidance | Full |
| Prognosis | "Guarded but favorable" — based on presentation, not imaging | Full |
| Time/Complexity | Standard attestation | Full |
| Clinician Disclaimer | Standard + personalized closing | Full |

### 5. Data Available for a "Fresh" Patient

At minimum, a case in ClinIQ always has:

| Data | Source | Always Present? |
|---|---|---|
| Patient name | `patients.first_name`, `patients.last_name` | Yes (required) |
| DOB | `patients.date_of_birth` | Nullable |
| Gender | `patients.gender` | Nullable |
| Case number | `cases.case_number` (auto-generated) | Yes |
| Accident type | `cases.accident_type` | Nullable |
| Accident date | `cases.accident_date` | Nullable |
| Accident description | `cases.accident_description` | Nullable |
| Clinic info | `clinic_settings` | Available if configured |
| Provider info | `provider_profiles` | Available if assigned |

Additionally, the provider can enter before generation:
- **Vital signs** via `saveInitialVisitVitals()` — stored in `vital_signs` table
- **ROM data** via `saveInitialVisitRom()` — stored in `initial_visit_notes.rom_data`

### 6. The Original Design Research Anticipated This

The original research document ([2026-03-09-epic-3-story-3.1-initial-visit-note-design.md](thoughts/shared/research/2026-03-09-epic-3-story-3.1-initial-visit-note-design.md)) explicitly addressed this in Section 7 — "Prerequisite Strategy":

> The note generation should be flexible about prerequisites:
> - **Ideal**: Case summary exists and is approved → best quality note
> - **Acceptable**: At least one approved MRI or chiro extraction → generate from raw extraction data
> - **Minimum**: Just case demographics and accident details → generate a skeleton with template sections filled in and data sections marked "[To be completed after imaging review]"
>
> This progressive approach means providers can generate a note at any point in the case lifecycle, not just after all extractions are complete.

The current implementation chose the strictest prerequisite level ("Ideal") rather than the progressive model recommended in the design.

### 7. How `InitialVisitInputData` Handles Nullability

The `InitialVisitInputData` interface ([generate-initial-visit.ts:219-278](src/lib/claude/generate-initial-visit.ts#L219-L278)) already accepts nullable/absent data:

- `caseSummary` fields are all `string | null` or `unknown`
- `vitalSigns` is `{...} | null`
- `romData` is `Array<...> | null`
- `feeEstimate` is `{...} | null`
- `caseDetails` fields (`accident_type`, `accident_date`, `accident_description`) are all `string | null`

The interface is **already designed** to accept sparse data — the gates in the server action are the only thing preventing it.

---

## Code References

- [case-summaries.ts:79-81](src/actions/case-summaries.ts#L79-L81) — Extraction count gate in case summary generation
- [initial-visit-notes.ts:61-63](src/actions/initial-visit-notes.ts#L61-L63) — Case summary gate in initial visit generation
- [initial-visit-notes.ts:510-529](src/actions/initial-visit-notes.ts#L510-L529) — `checkNotePrerequisites()` UI gate
- [generate-initial-visit.ts:124](src/lib/claude/generate-initial-visit.ts#L124) — Sparse data handling instruction in system prompt
- [generate-initial-visit.ts:219-278](src/lib/claude/generate-initial-visit.ts#L219-L278) — `InitialVisitInputData` interface with nullable fields
- [generate-summary.ts:15-16](src/lib/claude/generate-summary.ts#L15-L16) — Summary generator null/sparse handling rules

## Architecture Documentation

### Current Prerequisite Chain

```
Patient arrives with no records
         │
         ▼
   Can upload documents?
         │
    NO ──┤── YES → extract → approve → [Gate 1 passes]
         │                                    │
         ▼                                    ▼
   ❌ BLOCKED                         Generate case summary
   Cannot generate                    → approve summary
   case summary                              │
         │                                    ▼
         ▼                            [Gate 2 passes]
   ❌ BLOCKED                                │
   Cannot generate                           ▼
   initial visit note              Generate initial visit note
```

### Recommended Progressive Prerequisite Model (from original design)

```
Patient arrives
         │
         ├─ Has approved summary? ──── YES → Full note (highest quality)
         │
         ├─ Has approved extractions? ─ YES → Generate from raw extractions
         │                                     (skip summary requirement)
         │
         └─ Has only demographics? ─── YES → Skeleton note with brackets
                                              for missing clinical data
```

### `InitialVisitInputData` Shape When No Prior Treatment Exists

```typescript
{
  patientInfo: { first_name: "Jane", last_name: "Doe", date_of_birth: "1990-01-15", gender: "female" },
  caseDetails: { case_number: "PI-2026-0042", accident_type: "auto", accident_date: "2026-03-20", accident_description: "Rear-ended at stoplight..." },
  caseSummary: {
    chief_complaint: null,        // No summary exists
    imaging_findings: null,       // No imaging
    prior_treatment: null,        // No prior treatment
    symptoms_timeline: null,      // No timeline
    suggested_diagnoses: null,    // No diagnoses yet
  },
  clinicInfo: { clinic_name: "Example Pain Management", ... },
  providerInfo: { display_name: "Dr. Smith", credentials: "DO", ... },
  vitalSigns: { bp_systolic: 120, ... },  // Entered by provider at visit
  romData: [{ region: "Cervical", movements: [...] }],  // Entered by provider at visit
  feeEstimate: { professional_min: 2500, ... },  // From settings
}
```

## Historical Context (from thoughts/)

- `thoughts/shared/research/2026-03-09-epic-3-story-3.1-initial-visit-note-design.md` — Original design explicitly recommended a progressive prerequisite model (Section 7) that allows generation at any point in the case lifecycle
- `thoughts/personal/tickets/epic-3/story-1.md` — Story definition lists 8 required sections but does not specify that prior records are a prerequisite
- `thoughts/shared/plans/2026-03-09-epic-3-story-3.1-initial-visit-note.md` — Implementation plan for the feature
- `thoughts/shared/research/2026-03-08-epic-2-story-2.3-clinical-case-summary-design.md` — Case summary design (the upstream dependency)
- `thoughts/shared/plans/2026-03-09-epic-3-story-3.2-medical-necessity-full-template.md` — Medical necessity template, also discusses missing data scenarios

## Related Research

- [2026-03-09-epic-3-story-3.1-initial-visit-note-design.md](thoughts/shared/research/2026-03-09-epic-3-story-3.1-initial-visit-note-design.md) — Original design research for this feature
- [2026-03-08-epic-2-story-2.3-clinical-case-summary-design.md](thoughts/shared/research/2026-03-08-epic-2-story-2.3-clinical-case-summary-design.md) — Case summary design (upstream dependency)
- [2026-03-14-opus-vs-sonnet-report-generation.md](thoughts/shared/research/2026-03-14-opus-vs-sonnet-report-generation.md) — AI model selection for report generation

## Recommended Approach

Based on the real-world example, the solution requires changes at **three levels**:

### Level 1: Remove the Case Summary Prerequisite Gate

The Initial Visit note should be generatable **without** a case summary. The `gatherSourceData()` function in [initial-visit-notes.ts:20-128](src/actions/initial-visit-notes.ts#L20-L128) should make the case summary query optional — if one exists and is approved, use it to enrich the note; if not, pass null `caseSummary` fields and let the AI generate from other available data.

Similarly, `checkNotePrerequisites()` at [initial-visit-notes.ts:510-529](src/actions/initial-visit-notes.ts#L510-L529) should be updated to allow generation without a case summary.

### Level 2: Add Pre-Generation Provider Input for Chief Complaints and History

The real-world note shows that the provider documents during the visit:
- **Accident mechanism details** (patient narrative — vehicle position, impact type, seatbelt/airbag, immediate symptoms)
- **Chief complaints** (body regions, pain character, ratings, aggravating/alleviating factors)
- **Past medical/surgical history** (conditions, surgeries, medications, allergies)
- **Social history** (smoking/drinking, occupation)
- **Physical exam findings** (per-region palpation findings, ROM observations, neurological screening)

The system already has pre-generation UI for **vitals** and **ROM data**. A similar pre-generation input form for the items above would give Claude everything needed to generate a clinically complete first-visit note without any external records.

### Level 3: Update the System Prompt for Two Visit Types

The system prompt needs to handle two distinct clinical scenarios using the same note record. Mode is auto-detected from data availability (see "Two Visit Types" section above for detection logic).

**Initial Visit (no diagnostics performed)**:
- Introduction frames as acute/initial evaluation
- Post-Accident History describes symptom onset and self-treatment only
- Imaging Findings states what was ordered, notes results pending
- Diagnoses use clinical impression codes (strain/sprain), not imaging-confirmed codes
- Medical Necessity justifies diagnostic imaging and structured follow-up
- Treatment Plan is conservative: medications, imaging orders, therapy referrals, activity modification
- Patient Education covers injury biomechanics, red-flag symptoms, conservative care
- Prognosis is "guarded but favorable" without imaging reference

**Pain Evaluation Visit (diagnostics complete)** — current prompt behavior:
- Introduction frames as pain management evaluation
- Post-Accident History includes full treatment timeline
- Imaging Findings details MRI results with measurements
- Diagnoses include imaging-confirmed disc codes
- Medical Necessity correlates exam with imaging, cites conservative care failure
- Treatment Plan recommends PRP with specific spinal levels and cost estimates
- Patient Education covers PRP mechanism
- Prognosis references MRI-confirmed pathology

**Mode detection** (first match wins):
1. `caseSummary.imaging_findings` populated → Pain Evaluation Visit
2. Approved MRI or CT scan extraction exists → Pain Evaluation Visit
3. Otherwise → Initial Visit

### Companion Documents

The real-world workflow shows that the Initial Visit also produces companion orders:
- **Imaging Orders** (MRI cervical/lumbar) — with ICD-10 codes from the note
- **Chiropractic Therapy Order** — with diagnoses, treatment plan, frequency, goals, special instructions

These could be future stories but should be considered in the design so the Initial Visit note's data model can support downstream document generation.

## Open Questions

1. **How should the pre-generation provider input be structured?** Options: (a) a multi-section form similar to the vitals/ROM panels, (b) a free-text "patient intake" textarea that Claude parses, or (c) a structured questionnaire (checkboxes for body regions, dropdowns for pain ratings, etc.). The real-world note suggests structured input would produce the most consistent results.

2. **Should Initial Visit vs Pain Evaluation Visit be explicit (user selects) or implicit (auto-detected)?** Auto-detection based on data availability is cleaner, but the provider might want to generate an Initial Visit note even when imaging exists (e.g., to document the first encounter retroactively after imaging has come back).

3. **Should the companion documents (Imaging Orders, Chiropractic Order) be part of this story or separate stories?** They share the same ICD-10 codes and are generated at the same visit. Including them would make the feature complete for the first-visit workflow.

4. **How should the `accident_description` field be enhanced?** The current `cases.accident_description` is a single text field. The real-world note contains structured details (vehicle position, impact type, seatbelt/airbag status, consciousness, immediate symptoms, ER response) that would benefit from structured input rather than a single textarea.
