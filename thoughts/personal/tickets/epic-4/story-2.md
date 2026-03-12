# Epic 4 — PRP Procedure Workflow

**Goal:** Capture structured PRP procedure information and generate procedure notes.

## User Story 4.2 — Capture PRP Procedure Details

As a provider
I want structured fields for PRP treatment
So that procedure documentation is complete.

### Acceptance Criteria

- PRP preparation fields:
  - Blood draw volume (mL)
  - Centrifuge duration (minutes)
  - PRP preparation protocol / kit description
  - Kit lot number
- Anesthesia fields:
  - Anesthetic agent (e.g., lidocaine 1%)
  - Anesthetic dose (mL)
  - Patient tolerance (tolerated well / adverse reaction)
- Injection fields:
  - Injection volume (mL)
  - Needle gauge (e.g., 25-gauge spinal)
  - Guidance method (ultrasound / fluoroscopy / landmark)
  - Target confirmed on imaging (boolean)
- Post-procedure fields:
  - Complications (none / specify)
  - Supplies used
  - Compression bandage applied (boolean)
  - Activity restriction duration (hours)
- Required fields enforced: blood draw volume, injection volume, anesthetic agent, guidance method, complications
