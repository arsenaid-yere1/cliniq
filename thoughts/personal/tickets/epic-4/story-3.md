# Epic 4 — PRP Procedure Workflow

**Goal:** Capture structured PRP procedure information and generate procedure notes.

## User Story 4.3 — Generate PRP Procedure Note

As a provider
I want a formatted PRP procedure note
So that documentation meets medical record standards.

### Acceptance Criteria

- Note is AI-generated from:
  - Structured fields captured in Stories 4.1 and 4.2
  - Existing approved case data: MRI findings, pain management extraction (PMH, medications, allergies, social history, diagnoses), prior PT/chiro findings
  - Prior PRP procedure record (if this is a follow-up injection) for pain rating comparison
- Generated note includes all sections required for medical-legal documentation:
  - Patient header (name, DOB, date of visit, date of injury, indication, procedure name)
  - Subjective (patient narrative, current pain rating, comparison to prior visit if applicable, functional limitations)
  - Past medical history, allergies, current medications, social history (sourced from PM extraction)
  - Review of systems (musculoskeletal, neurological, general)
  - Objective — vital signs (from Story 4.1 capture)
  - Objective — physical exam (inspection, palpation, ROM, neurological exam, gait)
  - Assessment summary (links exam findings to imaging)
  - Procedure — indication (references specific imaging findings)
  - Procedure — preparation (consent, positioning, sterile prep, time-out)
  - Procedure — PRP preparation (blood draw, centrifuge, PRP description)
  - Procedure — anesthesia (agent, dose, tolerance)
  - Procedure — injection (guidance, needle, target, volume, distribution)
  - Procedure — post-procedure care (bandage, restrictions, medications, infection signs)
  - Procedure — follow-up plan (return timeline, potential additional injections)
  - Assessment and plan — full ICD-10 diagnosis list with plan items
  - Patient education (procedure explanation, post-injection care, time documentation: total time spent, % counseling)
  - Prognosis (based on injury chronicity and treatment response)
  - Clinician disclaimer (medical-legal boilerplate)
- Provider can edit any section before finalizing
- Provider signs and finalizes the note
- Finalized note is rendered to PDF and stored as a case document
- Clinic letterhead, provider credentials, and signature pulled from clinic/provider settings
