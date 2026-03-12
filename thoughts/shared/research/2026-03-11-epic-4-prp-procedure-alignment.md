---
date: 2026-03-11T00:00:00-07:00
researcher: arsen
git_commit: a587783025d76677efd9cd1aaa5ec600e6779b08
branch: main
repository: cliniq
topic: "Epic 4 PRP Procedure Stories — Alignment with Real PRP Procedure Documentation"
tags: [research, epic-4, prp, procedure-notes, document-generation]
status: complete
last_updated: 2026-03-11
last_updated_by: arsen
---

# Research: Epic 4 PRP Procedure Stories — Alignment with Real PRP Procedure Documentation

**Date**: 2026-03-11
**Researcher**: arsen
**Git Commit**: a587783025d76677efd9cd1aaa5ec600e6779b08
**Branch**: main
**Repository**: cliniq

## Research Question
Do the Epic 4 stories (4.1, 4.2, 4.3) cover the data fields and document sections needed to produce PRP procedure notes like the provided real-world examples (PRP Procedure 1 — Feb 20, 2025; PRP Procedure 2 — Mar 04, 2025)?

## Summary

The three Epic 4 stories capture the general intent but are **significantly underspecified** compared to what the real PRP procedure documents contain. The actual procedure notes are 5-6 page SOAP-style clinical documents with 12+ distinct sections, while the stories define only ~12 fields across 4.1 and 4.2, and 5 document sections in 4.3. Major sections of the real document — Subjective, Objective (vitals, physical exam, neurological exam), Review of Systems, Assessment with ICD-10 codes, Patient Education, Prognosis, and Clinician Disclaimer — are not mentioned in any story.

## Detailed Findings

### What the Real PRP Documents Contain

Both PRP procedure PDFs follow an identical structure from the NPMD clinic (16101 Ventura Blvd, Unit 300, Encino, CA 91436). They are SOAP-format procedure notes with these sections:

#### Header / Demographics
- Clinic letterhead (name, address, phone, fax)
- Date of document
- Patient name, DOB
- Date of Visit
- Indication (multi-diagnosis)
- Date of Injury
- Procedure name and target site

#### Subjective
- Patient narrative (age, sex, reason for visit, treatment history)
- Current symptoms and functional limitations
- Pain rating (numeric scale /10)
- Comparison to prior visit (in follow-up notes)

#### Past Medical History
- Relevant conditions (e.g., Hypertension)
- Orthopedic injury history

#### Allergies
- Drug allergy status (NKDA or specific)

#### Current Medications
- Medication name, dose, frequency, indication

#### Social History
- Alcohol, tobacco, drug use status

#### Review of Systems (ROS)
- Musculoskeletal findings
- Neurological findings
- General/constitutional findings

#### Objective — Vital Signs
- BP, HR, RR, Temp, SpO2, Pain scale

#### Objective — Physical Exam
- Inspection (posture, deformities)
- Palpation (tenderness, spasm locations)
- Range of Motion (cervical, thoracic, lumbar — with pain elicitation)
- Neurological Examination (motor, sensory, reflexes, straight leg raise, gait)

#### Assessment Summary
- Clinical interpretation linking exam findings to imaging

#### Procedure Section
- **Indication**: Clinical rationale referencing imaging findings (e.g., "3.2mm disc protrusion at L5-S1")
- **Procedure Details** (6 sub-steps):
  1. Preparation — consent, positioning, sterile prep, time-out
  2. PRP Preparation — blood draw volume, centrifuge time, PRP description
  3. Anesthesia — agent, dose, patient tolerance
  4. Injection — guidance method, needle gauge, target, PRP volume, distribution technique
  5. Post-Procedure Care — bandage, activity restrictions, medication continuation, infection signs education
  6. Follow-Up Plan — return timeline, potential additional injections

#### Assessment and Plan — Diagnoses
- Full ICD-10 code list (14 codes in these examples across cervical, thoracic, lumbar regions)

#### Plan
- Medication continuation
- Post-procedure instructions
- Re-evaluation timeline
- Counseling summary

#### Patient Education
- Procedure explanation, post-injection care, follow-up expectations
- Time documentation (>60 min total, >50% counseling/education)

#### Prognosis
- Recovery outlook based on injury chronicity

#### Clinician Disclaimer
- Medical-legal scope statement

#### Signature
- Provider name, credentials, signature image

---

### What Epic 4 Stories Define

#### Story 4.1 — Create PRP Procedure Encounter
Fields: procedure date, injection site, laterality, diagnosis, consent status

#### Story 4.2 — Capture PRP Procedure Details
Fields: blood draw volume, PRP preparation protocol, injection volume, ultrasound guidance, supplies used, kit lot number, complications

#### Story 4.3 — Generate PRP Procedure Note
Sections: indication, procedure details, patient tolerance, post-procedure instructions, follow-up plan

---

### Gap Analysis: Stories vs. Real Document

| Real Document Section | Covered by Story | Gap |
|---|---|---|
| **Header/Demographics** | None | Patient info, DOI, visit date would come from existing case data — no gap if linked to case |
| **Subjective** (patient narrative, pain rating, symptom description, treatment history) | Not in any story | **MAJOR GAP** — This is a substantial narrative section |
| **Past Medical History** | Not in any story | Gap — but may exist in patient intake data |
| **Allergies** | Not in any story | Gap — but may exist in patient intake data |
| **Current Medications** | Not in any story | Gap — but may exist in patient intake data |
| **Social History** | Not in any story | Gap — but may exist in patient intake data |
| **Review of Systems** | Not in any story | **GAP** — musculoskeletal, neuro, general findings |
| **Vital Signs** | Not in any story | **GAP** — BP, HR, RR, Temp, SpO2, Pain |
| **Physical Exam** (inspection, palpation, ROM, neuro exam, gait) | Not in any story | **MAJOR GAP** — extensive structured exam findings |
| **Assessment Summary** | Not in any story | Gap — clinical interpretation paragraph |
| **Procedure — Indication** | Story 4.3 "indication" | Partially covered — real doc references specific imaging findings |
| **Procedure — Preparation** | Story 4.1 "consent status" | Partial — consent captured, but positioning/sterile prep not |
| **Procedure — PRP Prep** | Story 4.2 blood draw volume, protocol | Covered — centrifuge time part of "protocol" |
| **Procedure — Anesthesia** | Not in any story | **GAP** — anesthetic agent, dose, patient tolerance |
| **Procedure — Injection** | Story 4.2 injection volume, ultrasound guidance | Partial — needle gauge, target specifics not captured |
| **Procedure — Post-Care** | Story 4.3 "post-procedure instructions" | Covered at high level |
| **Procedure — Follow-Up** | Story 4.3 "follow-up plan" | Covered |
| **Diagnoses (ICD-10 list)** | Story 4.1 "diagnosis" | Partial — single field vs. 14 ICD-10 codes |
| **Plan** | Story 4.3 partially | Covered by follow-up plan + post-procedure instructions |
| **Patient Education** | Not in any story | **GAP** — time documentation section |
| **Prognosis** | Not in any story | **GAP** |
| **Clinician Disclaimer** | Not in any story | Gap — boilerplate, could be templated |
| **Provider Signature** | Story 4.3 "provider signs" | Covered — existing `provider_profiles` has signature |
| **Supplies / Kit Lot** | Story 4.2 | Covered |
| **Complications** | Story 4.2 | Covered |

### Fields Present in Real Docs But Missing from All Stories

1. **Subjective narrative** — patient's own description, pain scale, functional limitations, comparison to prior visit
2. **Vital signs** — BP, HR, RR, Temp, SpO2
3. **Physical exam findings** — inspection, palpation, ROM per spine region, neurological exam (motor, sensory, reflexes, SLR, gait)
4. **Review of Systems** — musculoskeletal, neurological, general/constitutional
5. **Anesthesia details** — agent (lidocaine), dose (5mL of 1%), tolerance
6. **Needle gauge** — 25-gauge spinal needle
7. **Multiple ICD-10 codes** — 14 codes organized by body region
8. **Patient education / time documentation** — >60 min total, >50% counseling
9. **Prognosis statement** — guarded/good/etc. with rationale
10. **Assessment summary** — clinical interpretation linking exam to imaging
11. **Past medical history, allergies, medications, social history** — may come from patient intake

### What Can Be Derived from Existing Case Data

Some missing fields don't need to be captured in Epic 4 because they already exist or could be sourced from other parts of the system:

- **Header/Demographics**: case → patient → name, DOB; case → date_of_injury; clinic_settings → address, phone, fax
- **Past Medical History / Allergies / Medications / Social History**: Could come from patient intake (if captured in Epic 1/2) or from the pain management extraction data already in the system
- **ICD-10 Diagnoses**: Already captured in pain management extractions and case summaries
- **Provider info + signature**: Already in `provider_profiles` table
- **Clinic letterhead**: Already in `clinic_settings` table

### Existing Document Generation Pipeline Context

The codebase already has a mature extraction → summary → generation pipeline for Initial Visit Notes:
- 4 extraction types (MRI, Chiro, PM, PT) in `src/lib/claude/`
- Case summary synthesis in `src/lib/claude/generate-summary.ts`
- Initial Visit Note generation in `src/lib/claude/generate-initial-visit.ts`
- PDF rendering via `@react-pdf/renderer` in `src/lib/pdf/`

The `procedures` table currently has only basic fields: `procedure_date`, `procedure_name`, `cpt_code`, `charge_amount`, `notes`, `provider_id`. None of the PRP-specific fields from Story 4.1 or 4.2 exist in the schema.

## Code References
- `thoughts/personal/tickets/epic-4/story-1.md` — Story 4.1 definition
- `thoughts/personal/tickets/epic-4/story-2.md` — Story 4.2 definition
- `thoughts/personal/tickets/epic-4/story-3.md` — Story 4.3 definition
- `src/types/database.ts:1337-1413` — Current `procedures` table schema
- `src/actions/procedures.ts` — Current read-only procedure actions
- `src/components/procedures/procedure-table.tsx:118` — Disabled "Record Procedure" button
- `src/lib/claude/generate-initial-visit.ts` — Existing document generation pattern
- `src/lib/pdf/initial-visit-template.tsx` — Existing PDF template pattern

## Architecture Documentation

The existing document generation pipeline (extract → summarize → generate → PDF) provides a proven pattern for PRP procedure note generation. Story 4.3's note generation would follow the same architecture: structured data in → Claude generation → provider review → PDF render.

The key architectural question is whether PRP procedure data should extend the existing `procedures` table with PRP-specific columns, use a separate `prp_procedures` table, or use a JSONB `details` column on the existing table.

## Open Questions

1. **Where does Subjective/HPI data come from?** The real documents have substantial patient narratives. Should these be manually entered per visit, or AI-generated from prior clinical data?
2. **Physical Exam and Vital Signs** — Are these entered per-procedure, or do they exist in another system?
3. **Should Epic 4 stories be expanded** to cover the full SOAP note structure, or should the note generation (4.3) use AI to fill in sections from existing case data (similar to how the Initial Visit Note is generated)?
4. **Multiple ICD-10 codes** — Story 4.1 says "diagnosis" (singular). Real docs list 14 codes. Should this be a multi-select?
5. **Anesthesia details** — Not captured in any story. Are these standardized enough to template, or do they vary per procedure?
6. **Follow-up procedure notes** — PRP Procedure 2 references improvements since PRP Procedure 1. Should the system track procedure sequences and auto-include prior visit comparisons?
