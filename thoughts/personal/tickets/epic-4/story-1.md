# Epic 4 — PRP Procedure Workflow

**Goal:** Capture structured PRP procedure information and generate procedure notes.

## User Story 4.1 — Create PRP Procedure Encounter

As a provider
I want to create a PRP procedure record
So that the treatment is documented properly.

### Acceptance Criteria

- Provider records:
  - Procedure date
  - Injection site (e.g., L5-S1 facet joint)
  - Laterality (left / right / bilateral)
  - ICD-10 diagnoses (multi-select, linked to case diagnoses)
  - Consent obtained (boolean)
  - Pain rating at visit (0–10 numeric scale)
  - Procedure number in series (e.g., 1st, 2nd, 3rd injection)
- Vital signs recorded at time of visit:
  - Blood pressure (systolic / diastolic)
  - Heart rate (bpm)
  - Respiratory rate (breaths/min)
  - Temperature (°F)
  - SpO2 (%)
- If a prior PRP procedure exists for this case, it is linked automatically (for follow-up comparison)
