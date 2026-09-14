# Psychological Assessment UX Plan

## Overview

Status: implementation authorized by the user and implemented locally on 2026-09-13. The original UX specification and reference-based refinement are retained below; the implementation record describes the delivered scope and remaining manual validation.

Provide a dedicated Psychological Assessment intake tab immediately after Chief Complaints. Keep patient reports, clinician observations, clinical interpretation, and follow-up distinct. Add a read-only summary and shortcut in Chief Complaints so psychological concerns remain discoverable during intake.

Start with Initial Visit. The shared editor also serves Pain Evaluation Visit; preserve independent encounter data and account for that shared component during implementation. Follow-up and discharge workflows are later scope.

## Current State

Browser inspection on 2026-09-13 confirmed six intake tabs: Chief Complaints, Accident Details, Past Medical Hx, Social History, Exam Findings, and Vital Signs.

Chief Complaints has repeating pain entries plus a shared Sleep Disturbance yes/no field and Additional Notes. Exam Findings exposes General Appearance, examination regions, and Neurological Notes. No dedicated psychological intake fields were displayed.

Source anchors:

- `src/components/clinical/initial-visit-editor.tsx`: `InitialVisitEditor`, `InitialVisitEditorInner`, `ChiefComplaintsCard`, and `FinalizedView` are relevant integration points. The editor has separate pre-generation, generated, and finalized states.
- `src/lib/validations/initial-visit-note.ts`: `providerIntakeSchema`, `chiefComplaintsSchema`, `defaultProviderIntake`, `initialVisitSections`, and `sectionLabels` define the current input and note section contracts.

The current section list includes `diagnoses`, `physical_exam`, and `treatment_plan`; it does NOT include `assessment`. This supersedes the earlier research document's assumption that Initial Visit has a generic assessment section.

## Desired End State

The clinician can document a brief assessment without completing a long psychiatric intake. More fields appear only when relevant. The form never interprets an untouched input as a negative finding, a diagnosis, or a completed assessment.

### Navigation and layout

- Add Psychological Assessment after Chief Complaints, using the established tab and card styling.
- Chief Complaints shows a compact summary: "Psychological assessment: Not assessed" and "Open assessment." Once saved, show documented symptoms and assessment status rather than a second editable form.
- Use a single column for the clinical narrative. Pair short controls in two columns on desktop, stacked on mobile.
- Keep the tab label and status readable at narrow widths; use accessible scrolling if necessary instead of squeezing seven tabs into one row.
- Use a compact save bar with text states: Unsaved changes, Saving, Saved, or Save failed. Color is supplemental.

### Card 1: Patient-reported concerns

The first control is "Symptoms discussed today": Not assessed (default), No symptoms reported, Symptoms reported, or Patient declined to discuss.

Only Symptoms reported expands the detailed inputs:

| Field | Interaction and purpose |
| --- | --- |
| Reported symptoms | Multi-select checkboxes: anxiety/worry, low mood, irritability, driving/travel fear, avoidance, intrusive memories/nightmares, concentration difficulty, other. These are documentation shortcuts, not diagnostic criteria. |
| Patient description | Short textarea; encourage the patient's own description. Required only if symptoms are reported and no specific symptom is selected, or Other needs clarification. |
| Onset / course | Optional text, with suggestions such as new since accident, pre-existing, worsened since accident, or unclear. A patient-reported timing relationship is not a causation determination. |
| Frequency / triggers | Optional short text; no forced pain scale. |
| Impact on daily life | Optional multi-select: work, driving, relationships, daily activities, other; optional detail text. |

Sleep Disturbance remains a single canonical field in Chief Complaints for this release. Show its existing value and an Edit in Chief Complaints shortcut here. Do not create another yes/no answer. Optional sleep details may be documented here, but do not attribute sleep problems to a psychological cause automatically. Existing default No is not evidence of an explicit denial.

### Card 2: Clinician assessment

Always available, including when the patient reports no symptoms or declines discussion. Symptom reporting and clinician observations can differ.

| Field | Interaction and purpose |
| --- | --- |
| Assessment status | Not assessed (default), Partial assessment, or Assessed today. Independent of symptom status. |
| Observations | Optional textarea for observed mood, affect, behavior, or other relevant findings. Do not prefill normal findings from General Appearance. |
| Clinical impression | Textarea for clinician interpretation; required when explicitly marking Assessed today. No automatic diagnostic labels or codes. |
| Relevant prior history / care | Optional disclosure section for relevant history and current care. Reference existing medical history rather than requiring re-entry. |

Saving a partial assessment is allowed. A Saved badge confirms persistence only; it must not imply clinical completion.

### Card 3: Safety and follow-up

Keep a small safety documentation control visible independently of symptom status: Not assessed (default), Assessed - no concerns identified, Concerns identified, or Unable to assess.

If Concerns identified is chosen, reveal clinician-entered concern details, actions taken, and disposition/follow-up. Show "Safety concern documented - review actions and disposition." Allow saving incomplete work; require actions/disposition or an explicit explanation before finalization. This documentation control is not a validated risk screen and must not assign a risk category or claim to determine safety.

Provide optional follow-up choices: monitor/reassess, discuss referral, referral recommended, already receiving care, or other. Show follow-up timeframe and notes when selected. A recorded recommendation does not create or send a referral order.

### Form behavior

- Keep fields empty until explicitly entered. No default normal mood, denial, diagnosis, referral, or risk conclusion.
- Changing from Symptoms reported to another status after entering details requires an explicit choice to retain the current answer or clear the contradictory symptom details. Do not silently submit hidden positive symptoms alongside No symptoms reported.
- Preserve unsaved input across tab changes within the encounter. Warn before navigation away if input would be lost.
- Save Psychological Assessment explicitly, using the existing section-save convention. A failed save preserves the draft and offers Retry.
- Generation must wait for successful persistence of relevant dirty inputs. Offer Save and generate; do not silently generate from stale saved intake.
- After an assessment changes on an already generated draft, show "Assessment updated; note needs review." Let the clinician review affected sections before replacing existing prose.
- Expose the intake card in generated draft state as well as pre-generation. Finalized notes show a read-only snapshot under the existing lock/reopen workflow.
- Keep each encounter's assessment independent. Historical information must be labeled with its source date and never silently copied as today's assessment.
- Use labeled native controls, keyboard navigation, visible focus, field-level errors, and announced save status. Avoid placeholder-only labels.

## Key Discoveries

A UI-only placeholder change would not meet the requested assessment workflow. It needs dedicated structured intake, a clear output location, and continuity after generation.

The user-selected finalized Initial Visit example demonstrates psychological content within the existing note sections, including a PSYCHIATRIC subsection in Physical Examination. Use that output structure instead of adding a new top-level narrative section. Do not place tentative clinician impressions under Diagnoses by default.

## What We Are Not Doing

- Automated diagnosis, causation determination, or risk classification.
- Mandatory full psychiatric examination for every visit.
- Built-in screening questionnaires or scoring in the first release.
- Automatic referral submission, medication recommendations, or emergency outreach.
- Psychological changes across follow-up, discharge, and procedure notes in the first release.
- Broad redesign of unrelated intake defaults or tabs.

## Implementation Approach

The following is the intended product contract. The implementation record below resolves persistence, action, generation, and test integration while preserving the existing PDF section contract.

Patient-reported concerns contribute to Chief Complaint and relevant history. Observed findings appear in a PSYCHIATRIC subsection within Physical Examination, clearly separated from patient reports. Clinician interpretation and documented rationale contribute to Medical Necessity and the Treatment Plan introduction. Explicit clinician diagnoses remain in Diagnoses. Documented actions and follow-up contribute to Treatment Plan. The detailed template below governs this mapping.

An untouched assessment adds no affirmative or negative clinical assertions. An explicitly recorded Not assessed may be rendered as "Psychological assessment was not performed at this visit." No symptoms reported must remain patient-attributed and must not become a normal exam or negative suicide screen.

Optional psychological intake must not invalidate older notes. Full generation and per-section regeneration must receive the same saved psychological source data. Existing narrative sections, finalized display, and PDF retain their current section contract. Generated narrative remains reviewable before finalization.

## Phase 1: Review the interaction design

### Files and changes

- This document records the UX contract.
- Next deliverable: a disposable interactive mockup, using synthetic examples and the current ClinIQ visual language.
- Mockup views: untouched, no symptoms reported, symptoms with partial assessment, completed assessment, safety concern, save failure, and finalized read-only.

### Automated verification

For a future interactive mockup, check status transitions and conditional visibility. No application tests are applicable to this document-only change.

### Manual verification

- Confirm the clinician can document no symptoms without entering irrelevant detail.
- Confirm patient report and clinician impression are visibly distinct.
- Confirm users recognize the difference between Saved and Assessed today.
- Confirm sleep is entered in one place.
- Walk through tablet/mobile and keyboard-only navigation.

## Phase 2: Engineering plan and implementation

### Files and changes

- Extend the intake validation contract in `src/lib/validations/initial-visit-note.ts` with backward-compatible psychological assessment input.
- Integrate a proposed new `src/components/clinical/psychological-assessment-card.tsx` with `InitialVisitEditorInner` and `ChiefComplaintsCard` in `src/components/clinical/initial-visit-editor.tsx`.
- Research the action imported by the editor, `saveProviderIntake`, to determine section merge, concurrency, and lock behavior before specifying persistence changes.
- Trace generation, regeneration, narrative persistence, finalized rendering, and PDF integration to preserve the existing section contract while incorporating the psychological source data. Exact files beyond the inspected editor/schema must be established by that engineering plan.
- Resolve sharing with Pain Evaluation Visit explicitly: either include it with encounter isolation tests or gate the first release to Initial Visit. Recommended first-release exposure is Initial Visit only.

### Automated verification

- Legacy intake with no psychological object still parses and retains unrelated sections.
- Blank/untouched fields produce no negative clinical claims.
- Saving one intake section does not overwrite another section or another encounter.
- Symptom-state changes cannot persist contradictory hidden values.
- Failed saves retain entered content; generation cannot race pending saves.
- Changing intake marks existing generated content for review without overwriting it.
- Psychological content in existing narrative sections round-trips through save, regeneration, finalization, and PDF; old notes still render.
- Locked and finalized encounters reject unauthorized mutations on the server as well as in the UI.

### Manual verification

Perform an end-to-end synthetic encounter covering entry, tab changes, save, reload, generation, clinician edits, regeneration, and finalized PDF. Confirm no diagnosis or safety conclusion was invented, and review the saved note against the original input.

## Phase 3: Optional screening and longitudinal follow-up

Consider validated questionnaires only after the core documentation flow works. Preserve exact instrument/version, responses, date, respondent, missing responses, and scoring rules. Present results as screening results rather than diagnoses. Choose instruments and the response workflow with the clinic before implementation.

The VA distinguishes PTSD screening from diagnostic assessment: positive screens need further assessment. NIMH provides an outpatient assessment and disposition pathway after positive suicide screening. These support keeping screening, assessment, and action separate rather than adding isolated score inputs.

Sources:

- https://www.ptsd.va.gov/professional/assessment/screens/
- https://www.nimh.nih.gov/research/research-conducted-at-nimh/asq-toolkit-materials/adult-outpatient/adult-outpatient-brief-suicide-safety-assessment-guide

## Risks and rollback considerations

- Structured intake and generation changes require coordinated work beyond the form; this plan does not claim those dependencies have been fully inspected. Preserve the existing top-level narrative section contract.
- The existing Sleep Disturbance default cannot distinguish an untouched value from an explicit answer. Do not infer assessment completion from it.
- Saving structured input without updating a generated note creates stale documentation; the review indicator is part of the release, not optional polish.
- Keep old data compatible and retain captured assessment data if new UI exposure is disabled. Do not remove stored clinical content as a rollback strategy.
- Confirm the clinic's safety documentation and disposition language during mockup review before implementing any finalization constraint.

## Completion criteria

UX planning is complete when the proposed placement, fields, conditional states, output mapping, and review workflow are concrete enough for a clinician to evaluate.

Implementation readiness requires a separate verified engineering plan resolving persistence, all note-output consumers, and existing test commands. Application implementation is complete only when the specified behavior and regression checks pass.

## Design review

The user approved the design, selected a finalized note as the template, and then authorized implementation. See the implementation record below for resolved engineering decisions.

Resolved in this proposal: dedicated intake tab, chief-complaint shortcut, independent report/assessment statuses, no implicit normal findings, one sleep source, explicit save behavior, generated-note review, and psychological content mapped into the existing note sections using the user-selected example.

Engineering decisions and automated verification are recorded below. Authenticated visual review and clinician review of generated wording remain manual checks.

## Reference-based template refinement

The user supplied a finalized Initial Visit Note in ClinIQ and it was inspected in the browser on 2026-09-13. Use its organization as the reference. Patient identifiers and case-specific clinical values are intentionally not copied into this reusable template.

The example contains psychological symptoms in Post-Accident History and Chief Complaint, prior psychological history in Past Medical History, a PSYCHIATRIC examination subsection, clinician-entered diagnostic content, behavioral-health rationale in Medical Necessity, and referral/education content in Treatment Plan and Patient Education. These observations describe the example; they do not independently validate its clinical conclusions.

### Refined intake fields

| Group | Template fields |
| --- | --- |
| Symptoms | Fear/anxiety, recurrent recollections, flashbacks, nightmares, shakiness, avoidance or travel-related fear, low mood, irritability, concentration difficulty, other. Select only symptoms reported today. |
| Timing | Onset/date or duration; new, pre-existing, worsened, or unclear relative to the event; patient description of the course. |
| Sleep | Read-only reference to the existing Sleep Disturbance answer; optional details about falling asleep, staying asleep, or nightmares. Record reported contributors such as pain, anxiety, both, other, or unclear without inferring them. |
| Functional impact | Patient-described effect on work, travel, relationships, daily activities, or self-care. No default impairment language. |
| Prior history | Relevant pre-existing symptoms/conditions and prior/current care, initially referencing existing medical history. Explicitly distinguish historical information from today's concerns. |
| Observed findings | Mood/affect and behavior in clinician-entered text, including response when discussing the event if actually observed. No default anxious affect or visible distress. |
| Clinical impression | Clinician-entered interpretation, uncertainty, and rationale. Diagnosis confirmation is separate; selecting a symptom must not populate an ICD code. |
| Follow-up | Referral recommendation and reason, education actually provided, patient response if documented, and reassessment timeframe. Record recommendations separately from orders placed. |

### Output template using existing sections

| Existing section | Reusable content pattern |
| --- | --- |
| History of the Accident | Brief immediate emotional response only if documented; retain attribution to the patient. |
| Post-Accident History | "The patient reports [symptoms] beginning [onset/course]. [Documented sleep and functional impact]." |
| Chief Complaint | "Psychological symptoms: [reported symptoms], with [documented triggers/impact]." Use a more specific complaint label only if supported by clinician input. |
| Past Medical History | "Relevant psychological history: [documented prior conditions or symptoms and care]." Do not invent a negative history. |
| Review of Systems | Concise patient-reported psychological/sleep positives or explicit negatives; do not repeat the full history. |
| Physical Examination | "PSYCHIATRIC: [clinician-observed mood/affect/behavior]." Patient reports, if needed for context, remain explicitly attributed. Omit the subsection when there are no documented findings rather than invent normal findings. |
| Diagnoses | Only explicit clinician-confirmed diagnoses/codes, retaining documented uncertainty. Never copy diagnoses from the reference case into other encounters. |
| Medical Necessity | "[Documented symptoms/findings and impact] support [clinician-recommended evaluation or referral] because [documented rationale]." Include only when supported. |
| Treatment Plan | "[Referral or follow-up recommendation] for [documented concern]. [Timing and actions actually recorded]." A recommendation must not become a completed referral. |
| Patient Education | Record psychological/sleep education and patient response only when documented as provided. |
| Prognosis | Include psychological factors only if the clinician documented their relevance; no automatic prognosis judgment. |

### Example-driven acceptance scenario

Using a synthetic encounter, enter fear/anxiety, flashbacks, nightmares, sleep disruption, relevant prior anxiety history, observed anxious affect, and a clinician-recommended behavioral-health referral. Verify that the output separates reported symptoms from observations, preserves prior-versus-current history, and includes the documented referral rationale. It must not add PTSD, an ICD code, a negative safety assessment, patient agreement, or education merely because these appear in the reference example.

The new tab remains the single psychological capture surface. The final document keeps the familiar structure demonstrated by the reference note.

## Implementation record (2026-09-13)

### Resolved engineering decisions

- Store optional `psychological_assessment` within the existing provider-intake JSON. No table migration or top-level narrative section is introduced.
- `src/lib/validations/psychological-assessment.ts` defines the form contract, blank defaults, contradictory-state checks, and finalization requirements. `providerIntakeSchema` in `src/lib/validations/initial-visit-note.ts` accepts the new optional object without invalidating legacy intake.
- `PsychologicalAssessmentCard` in `src/components/clinical/psychological-assessment-card.tsx` provides the three form groups, optional history/education, conditional symptom/safety/follow-up details, and explicit save/retry states.
- `InitialVisitEditor` and `DraftEditor` in `src/components/clinical/initial-visit-editor.tsx` expose the new tab for Initial Visit only. Drafts also expose Chief Complaints so the canonical sleep field remains reachable. Finalized notes with assessment data expose a read-only intake snapshot.
- `IntakeDraftProvider` and `useIntakeSectionSave` in `src/components/clinical/intake-draft-context.tsx` register dirty sections, preserve mounted tabs, guard navigation, serialize saves before generation, and retain input after failures. Vitals participate in the same pre-generation save barrier. Native hidden attributes keep inactive forms out of accessibility navigation.
- `saveProviderIntake` in `src/actions/initial-visit-notes.ts` merges a selected section with the latest stored intake, rejects generating/finalized writes, and compares the note version during update. Legacy whole-object calls preserve existing psychological data.
- Updating intake on a generated note with psychological data sets server-managed `note_review_required`. `acknowledgePsychologicalReview` records the clinician's explicit review against an expected note version. Finalization rejects an outstanding review or incomplete documented safety concerns. Full generation clears the source-review marker when it replaces the note content.
- `PSYCHOLOGICAL_ASSESSMENT_PROMPT` in `src/lib/claude/psychological-assessment-prompt.ts` is shared by full generation and section regeneration via `buildSystemPrompt` in `src/lib/claude/generate-initial-visit.ts`. It maps content into existing sections, including PSYCHIATRIC under Physical Examination, and overrides automatic psychological/sleep diagnosis inference.
- `src/components/clinical/visit-date-card.tsx` accepts an optional input ID so the two preserved visit-type panels do not duplicate date-input IDs.

### Verification scope

New tests cover schemas/defaults, clinical-report versus observation separation in the prompt contract, section-specific persistence, concurrent-write conflicts, read/auth/lock failures, review acknowledgement, finalization barriers, form disclosure and retry, tab/encounter isolation, and intake/vitals saving before generation.

New test files:

- `src/lib/validations/__tests__/psychological-assessment.test.ts`
- `src/actions/__tests__/psychological-intake.test.ts`
- `src/components/clinical/__tests__/psychological-assessment-card.test.tsx`
- `src/components/clinical/__tests__/psychological-visit-editor.test.tsx`
- `src/lib/claude/__tests__/psychological-assessment-prompt.test.ts`

Regression coverage includes existing initial-visit validation, intake save, generation, note-tone/version, and editor regeneration tests. Server-action tests use mocked database clients; prompt tests inspect generation requests rather than making live AI calls.

Results:

- Targeted `npx vitest run` across the five new test files and five regression files: 10 files, 110 tests passed.
- The final editor test typing correction was followed by rerunning `psychological-visit-editor.test.tsx`: all 4 tests passed.
- `npx tsc --noEmit`: passed.
- `npx eslint` on all changed TypeScript/TSX source and new tests: passed.
- `git diff --check`: passed.
- The unrelated treatment-decision edits were restored to HEAD at the user's request. The local preview was started without deploying or changing patient records.

### Remaining manual checks

- The local server starts at `http://127.0.0.1:3001`; the browser reaches the sign-in screen. Authenticated desktop/mobile visual review remains pending.
- A clinician should review a synthetic generated note and finalized PDF for source fidelity and wording. No live patient data was changed, no live AI generation was requested, and no deployment was performed.
- Standardized screening questionnaires and follow-up/discharge expansion remain later scope.
