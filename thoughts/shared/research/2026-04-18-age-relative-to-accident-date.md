---
date: 2026-04-18T00:00:00-07:00
researcher: arsenaid
git_commit: 63c6dd250e4d95cce815b3a1e37a6ba70ac86751
branch: main
repository: cliniq
topic: "Is the age set in documents relative to the accident date?"
tags: [research, codebase, age, accident-date, pdf, claude-prompts, orthopedic-extractions]
status: complete
last_updated: 2026-04-18
last_updated_by: arsenaid
---

# Research: Is the age set in documents relative to the accident date?

**Date**: 2026-04-18T00:00:00-07:00
**Researcher**: arsenaid
**Git Commit**: 63c6dd250e4d95cce815b3a1e37a6ba70ac86751
**Branch**: main
**Repository**: cliniq

## Research Question
Check if the age set in documents is relative to the accident date.

## Summary
No. In every location where age is computed and written into a document, it is calculated relative to **today** (`new Date()`), not relative to the `accident_date` on the case. The accident date is fetched and formatted separately as `dateOfInjury`/`accidentDate` for display, but it is never used as an anchor for the age calculation.

There is one exception to the "computed from today" pattern: the `orthopedic_extractions.patient_age` column is not calculated at all — it is an integer extracted verbatim by Claude from an external orthopedic report PDF ([src/lib/claude/extract-orthopedic.ts:44-47](src/lib/claude/extract-orthopedic.ts#L44-L47)). Its relationship to the accident date depends entirely on whatever the source orthopedic report stated; the codebase neither enforces nor checks that relationship.

## Detailed Findings

### 1. Initial Visit PDF — age computed from today
[src/lib/pdf/render-initial-visit-pdf.ts:130](src/lib/pdf/render-initial-visit-pdf.ts#L130):
```
age: patientDob ? differenceInYears(new Date(), patientDob) : 0,
```
The `accident_date` is fetched on the same path ([src/lib/pdf/render-initial-visit-pdf.ts:135](src/lib/pdf/render-initial-visit-pdf.ts#L135)) but only used to set `dateOfInjury`. The two values are computed independently.

The PDF template then renders `Age:` and `Date of Injury:` as separate labeled rows ([src/lib/pdf/initial-visit-template.tsx:203-206](src/lib/pdf/initial-visit-template.tsx#L203-L206)).

### 2. Initial Visit Editor preview — age computed from today
[src/components/clinical/initial-visit-editor.tsx:1844-1846](src/components/clinical/initial-visit-editor.tsx#L1844-L1846):
```
const age = caseData?.patient.date_of_birth
  ? differenceInYears(new Date(), new Date(caseData.patient.date_of_birth))
  : null
```
`accidentDate` is built on the following lines ([src/components/clinical/initial-visit-editor.tsx:1847-1848](src/components/clinical/initial-visit-editor.tsx#L1847-L1848)) for display, but is not passed into the age computation.

### 3. Procedure Note PDF — no computed age
[src/lib/pdf/render-procedure-note-pdf.ts](src/lib/pdf/render-procedure-note-pdf.ts) fetches `date_of_birth` and `accident_date` and sets `dob` (line 120) and `dateOfInjury` (line 124) on the PDF data object. There is no `age` field computed by the renderer — the age in the generated procedure note narrative comes from the Claude prompt instructions (see §6) operating on `date_of_birth`.

### 4. Discharge Note PDF — no computed age
[src/lib/pdf/render-discharge-note-pdf.ts](src/lib/pdf/render-discharge-note-pdf.ts) follows the same pattern as the procedure note renderer: sets `dob` and `dateOfInjury` (lines 117, 122), does not compute `age`.

### 5. Invoice and Lien-Agreement PDFs — no age at all
[src/lib/pdf/render-invoice-pdf.ts](src/lib/pdf/render-invoice-pdf.ts) (lines 134-135) and [src/lib/pdf/render-lien-agreement-pdf.ts](src/lib/pdf/render-lien-agreement-pdf.ts) (lines 127-128) set `dob`/`dateOfBirth` and `dateOfInjury`. Neither renders an age field.

### 6. Claude AI prompts — `age` is not qualified as "at the time of the accident"
Where the Claude system prompts reference age, they do so without specifying an anchor date:
- Initial Visit prompt: `"State: patient age, gender, presents for pain management evaluation due to injuries sustained in [accident type] on [date]"` ([src/lib/claude/generate-initial-visit.ts:77](src/lib/claude/generate-initial-visit.ts#L77))
- Initial Visit example in the same file: `"Ms. [Name] is a 21-year-old female who presents for pain management evaluation due to injuries sustained in a motor vehicle accident (MVA), occurring on March 12, 2025."` ([src/lib/claude/generate-initial-visit.ts:79](src/lib/claude/generate-initial-visit.ts#L79))
- Procedure Note prompt: `"[Patient Name] is a [age]-year-old [gender] who returns for [his/her] scheduled PRP injection to the [site]."` ([src/lib/claude/generate-procedure-note.ts:120](src/lib/claude/generate-procedure-note.ts#L120))
- Discharge prompt: `"Opening sentence identifying patient, age, presents for follow-up after completing PRP treatment..."` ([src/lib/claude/generate-discharge-note.ts:127](src/lib/claude/generate-discharge-note.ts#L127))

The input payloads pass both `date_of_birth` and `accident_date` to Claude (see e.g. [src/lib/claude/generate-initial-visit.ts:368](src/lib/claude/generate-initial-visit.ts#L368), [src/lib/claude/generate-procedure-note.ts:24](src/lib/claude/generate-procedure-note.ts#L24), [src/lib/claude/generate-discharge-note.ts:24](src/lib/claude/generate-discharge-note.ts#L24)), so Claude has both dates available but is not instructed to compute age-at-accident.

### 7. Orthopedic extractions — age comes from the source report
[src/lib/claude/extract-orthopedic.ts:44-47](src/lib/claude/extract-orthopedic.ts#L44-L47) defines the tool-use schema field:
```
patient_age: {
  type: ['number', 'null'],
  description: 'Patient age in years.',
},
```
The description does not anchor the age to any date. Claude extracts whatever age is literally stated in the uploaded orthopedic report, and [src/actions/orthopedic-extractions.ts:117](src/actions/orthopedic-extractions.ts#L117) writes that number directly into `orthopedic_extractions.patient_age` ([supabase/migrations/021_orthopedic_extractions.sql:27](supabase/migrations/021_orthopedic_extractions.sql#L27)). The `ortho-extraction-form.tsx` review form ([src/components/clinical/ortho-extraction-form.tsx:202-205](src/components/clinical/ortho-extraction-form.tsx#L202-L205)) presents this value under the label "Age" for a provider to edit.

There is no calculation step that could tie this value to the accident date; it is whatever the source document said.

### 8. Schema — no stored `age` column on patients or cases
The `patients` table stores `date_of_birth` only ([supabase/migrations/001_initial_schema.sql:48](supabase/migrations/001_initial_schema.sql#L48)); the `cases` table stores `accident_date` only ([supabase/migrations/001_initial_schema.sql:78](supabase/migrations/001_initial_schema.sql#L78)). The only persisted `age` value anywhere in the schema is `orthopedic_extractions.patient_age` (see §7).

## Code References
- `src/lib/pdf/render-initial-visit-pdf.ts:130` — `age: differenceInYears(new Date(), patientDob)` — current age, not age at accident
- `src/lib/pdf/render-initial-visit-pdf.ts:135` — `dateOfInjury` formatted from `accident_date`, independent of age
- `src/components/clinical/initial-visit-editor.tsx:1844-1846` — same `differenceInYears(new Date(), ...)` pattern in the editor preview
- `src/lib/pdf/render-procedure-note-pdf.ts:120,124` — `dob` + `dateOfInjury`, no computed age
- `src/lib/pdf/render-discharge-note-pdf.ts:117,122` — same pattern, no computed age
- `src/lib/pdf/render-invoice-pdf.ts:134-135` — `dob` + `dateOfInjury`, no age
- `src/lib/pdf/render-lien-agreement-pdf.ts:127-128` — `dateOfBirth` + `dateOfInjury`, no age
- `src/lib/claude/generate-initial-visit.ts:77,79,368` — prompt references "age" (unqualified) and input carries `accident_date`
- `src/lib/claude/generate-procedure-note.ts:24,120` — same pattern for PRP note
- `src/lib/claude/generate-discharge-note.ts:24,127` — same pattern for discharge note
- `src/lib/claude/extract-orthopedic.ts:44-47` — `patient_age` extracted verbatim from ortho report
- `src/actions/orthopedic-extractions.ts:117` — writes extracted `patient_age` to DB
- `supabase/migrations/021_orthopedic_extractions.sql:27` — `patient_age integer` column
- `supabase/migrations/001_initial_schema.sql:48` — `patients.date_of_birth date not null`
- `supabase/migrations/001_initial_schema.sql:78` — `cases.accident_date date`

## Architecture Documentation
Two distinct "age" surfaces exist in the codebase:

1. **Derived at render time from DOB + today.** Initial Visit PDF and editor preview compute `differenceInYears(new Date(), dob)`. The value is not persisted. `accident_date` sits alongside this value in the same data payload but is formatted into its own field (`dateOfInjury`) and never feeds the age computation.

2. **Extracted verbatim into `orthopedic_extractions.patient_age`.** Claude tool-use extraction pulls whatever age is printed in an external orthopedic report PDF, and it is stored as a reviewable integer. The codebase does not compute, validate, or re-anchor this value against the case's `accident_date`.

Procedure and discharge PDFs render `dob` + `dateOfInjury` but do not expose a discrete `age` field — any age appearing in their narratives is generated by Claude from the DOB in the prompt input, under a system instruction that says "age" without specifying an anchor date.

## Related Research
None found in `thoughts/shared/research/` on this specific topic.

## Open Questions
- For the Claude-generated narratives (Initial Visit, Procedure Note, Discharge), does the model in practice state current age or age-at-accident when both `date_of_birth` and `accident_date` are provided? The prompts do not specify, so behavior depends on the model's default interpretation.
- For `orthopedic_extractions.patient_age`, the age in the source report is typically the patient's age on the report's evaluation date; whether that matches, predates, or postdates the case's `accident_date` is not tracked anywhere.
