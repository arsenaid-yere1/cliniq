# Initial Visit Note — No Prior Treatment Support

## Overview

Enable Initial Visit note generation for patients with no prior clinical records. Currently, a two-gate prerequisite chain (extractions -> case summary -> note) completely blocks generation for "fresh" patients — the most common real-world use case. This plan removes the hard case summary gate, adds 5 pre-generation provider intake forms, implements dual-mode prompt auto-detection (**Initial Visit** vs **Pain Evaluation Visit**), and adds companion document generation (Imaging Orders, Chiropractic Therapy Order) with immediate PDF rendering (no separate finalize step for orders).

### Two Visit Types

Each visit type is stored as a **separate `initial_visit_notes` row** on the same case, keyed by `visit_type`. A patient may have both: an Initial Visit written Day 3 post-accident, and a Pain Evaluation Visit written Day 30 after MRI results come back. Both are independently editable, finalizable, and PDF-exportable. Neither overwrites the other.

**Exam data isolation with cross-visit reference**: Each visit has its own provider intake, ROM, and vitals — entered fresh at the time of that visit. The Pain Evaluation Visit does NOT edit or overwrite the Initial Visit's exam data. However, at Pain Evaluation Visit generation time, the pipeline loads the finalized Initial Visit note (if one exists) as **read-only reference data** (`priorVisitData`) and passes it to the prompt so the AI can generate interval-comparison language (e.g., "ROM has improved from the initial evaluation", "persistent symptoms despite conservative care documented at the initial visit"). The prior visit data is never displayed as editable in the Pain Evaluation Visit UI.

The visit type is auto-detected from data availability at generation time:

| Visit Type | Trigger | Clinical Context |
|---|---|---|
| **Initial Visit** | No diagnostics performed | First clinical encounter. Imaging is *ordered*, not reviewed. Diagnoses are clinical impressions based on exam + mechanism. Treatment is conservative. |
| **Pain Evaluation Visit** | Patient has completed diagnostic imaging | Follow-up encounter where imaging findings are reviewed. Diagnoses are imaging-confirmed. Evaluation for advanced interventions (e.g., PRP). |

**Detection logic** (first match wins):
1. **Primary**: `caseSummary.imaging_findings` is populated → Pain Evaluation Visit
2. **Fallback**: Any approved MRI or CT scan extraction exists (`mri_extractions` or `ct_scan_extractions` with `review_status IN ('approved','edited')`) → Pain Evaluation Visit
3. **Otherwise** → Initial Visit

## Current State Analysis

### The Problem
The Initial Visit is the patient's **first clinical encounter** in the PI workflow. A patient arriving 3 days post-accident with zero prior records cannot have a note generated because:

1. **Gate 1** ([case-summaries.ts:79-81](src/actions/case-summaries.ts#L79-L81)): `generateCaseSummary()` requires at least one approved extraction
2. **Gate 2** ([initial-visit-notes.ts:61-63](src/actions/initial-visit-notes.ts#L61-L63)): `generateInitialVisitNote()` requires an approved case summary
3. **UI Gate** ([initial-visit-notes.ts:510-529](src/actions/initial-visit-notes.ts#L510-L529)): `checkNotePrerequisites()` mirrors Gate 2, disabling the generate button

### What Already Works
- `InitialVisitInputData` ([generate-initial-visit.ts:219-278](src/lib/claude/generate-initial-visit.ts#L219-L278)) already accepts all nullable fields
- The AI prompt has sparse data handling ([generate-initial-visit.ts:124](src/lib/claude/generate-initial-visit.ts#L124))
- Pre-generation UI pattern exists for Vitals and ROM tabs
- The original design research explicitly recommended a progressive prerequisite model

### What Doesn't Work
- The system prompt assumes a post-treatment PRP evaluation patient (imaging exists, conservative care completed, PRP recommended)
- No mechanism for provider to enter chief complaints, PMH, social history, exam findings, or structured accident details before generation
- No companion document generation (Imaging Orders, Chiropractic Order)

## Desired End State

1. A provider can generate a clinically complete Initial Visit note for a patient with **zero prior records** — no extractions, no case summary
2. Five new pre-generation input tabs let the provider enter: chief complaints, accident details, past medical/social history, and physical exam findings
3. The system **auto-detects** the note mode based on data availability:
   - **Initial Visit**: No imaging findings and no approved MRI/CT extractions → conservative assessment note with imaging orders and therapy referrals
   - **Pain Evaluation Visit**: `caseSummary.imaging_findings` populated OR approved MRI/CT extractions exist → current PRP-focused note (existing behavior)
4. Companion documents (Imaging Orders, Chiropractic Therapy Order) can be generated from the finalized Initial Visit note data
5. Existing PRP evaluation workflow is **unchanged** — this is purely additive

### How to Verify
- Create a new case with only patient demographics and accident details (no documents uploaded)
- Fill out all 7 pre-generation tabs (vitals, ROM, chief complaints, accident details, PMH, social history, exam findings)
- Generate the note — should auto-detect as **Initial Visit** and produce a clinically complete note with conservative treatment plan, imaging orders mentioned, and clinical impression diagnoses
- Finalize the note and generate companion documents (Imaging Orders, Chiro Order)
- Create a case WITH an approved case summary containing imaging findings — note should auto-detect as **Pain Evaluation Visit** and produce the existing PRP-focused format
- Create a case with approved MRI extractions but no case summary — note should still auto-detect as **Pain Evaluation Visit** via the fallback path

## What We're NOT Doing

- **Not changing the case summary system** — Gate 1 (extractions required for case summary) stays as-is
- **Not removing case summary enrichment** — when a case summary exists, it still enriches the note
- **Not changing the existing PRP evaluation prompt** — Pain Evaluation Visit mode preserves current behavior exactly
- **Not building a structured accident intake form** — we use a single textarea for accident narrative (the existing `accident_description` field), enhanced with a few structured fields (seatbelt, airbag, consciousness, ER visit) stored in `provider_intake`
- **Not auto-generating companion documents** — they are manually triggered after note finalization
- **Not implementing PT, pain management, or orthopedic orders yet** — the `order_type` CHECK constraint includes them for forward-compatibility, but only Imaging Orders and Chiropractic Therapy Orders are built in this plan. Future order types follow the same pattern and require only: a generation function, Zod schema, server action, PDF template, and UI button.

## Implementation Approach

The changes touch 4 layers: database schema, server actions (gate removal + new save/load), AI prompt (dual-mode), and UI (5 new intake tabs + companion doc generation). We phase by dependency order: schema first, then gates, then intake forms, then prompt, then companion docs. Phases 6 and 7 from the original plan have been merged — order generation now renders the PDF immediately in the same server action call, eliminating the separate finalize step.

---

## Phase 1: Database Migration

### Overview
Add `provider_intake` JSONB column to `initial_visit_notes` and create `clinical_orders` table for companion documents.

### Changes Required:

#### 1. New Migration File
**File**: `supabase/migrations/20260326_provider_intake_and_clinical_orders.sql`

```sql
-- Add provider_intake JSONB column to initial_visit_notes
ALTER TABLE initial_visit_notes
ADD COLUMN IF NOT EXISTS provider_intake jsonb;

COMMENT ON COLUMN initial_visit_notes.provider_intake IS 'Provider-entered intake data: chief complaints, accident details, PMH, social history, exam findings';

-- Add visit_type column — separates Initial Visit from Pain Evaluation Visit so both can coexist on the same case
ALTER TABLE initial_visit_notes
ADD COLUMN IF NOT EXISTS visit_type text NOT NULL DEFAULT 'initial_visit'
  CHECK (visit_type IN ('initial_visit', 'pain_evaluation_visit'));

COMMENT ON COLUMN initial_visit_notes.visit_type IS 'Which clinical visit this note represents. Auto-detected at generation time based on diagnostic availability.';

-- Replace the single-row-per-case unique index with one row per (case, visit_type)
-- Prior migration 010_initial_visit_notes.sql (and 20260309194935_*) created:
--   create unique index idx_initial_visit_notes_case_active on initial_visit_notes(case_id) where deleted_at is null
DROP INDEX IF EXISTS idx_initial_visit_notes_case_active;

CREATE UNIQUE INDEX idx_initial_visit_notes_case_visit_type_active
  ON initial_visit_notes(case_id, visit_type)
  WHERE deleted_at IS NULL;

-- Create clinical_orders table for companion documents
CREATE TABLE IF NOT EXISTS clinical_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES cases(id),
  initial_visit_note_id uuid REFERENCES initial_visit_notes(id),
  order_type text NOT NULL CHECK (order_type IN ('imaging', 'chiropractic_therapy', 'physical_therapy', 'pain_management_referral', 'orthopedic_referral')),
  order_data jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generating', 'completed', 'failed')),
  generation_error text,
  ai_model text,
  raw_ai_response jsonb,
  document_id uuid REFERENCES documents(id),
  finalized_by_user_id uuid REFERENCES auth.users(id),
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES auth.users(id),
  updated_by_user_id uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_clinical_orders_case_id ON clinical_orders(case_id);
CREATE INDEX idx_clinical_orders_note_id ON clinical_orders(initial_visit_note_id);
CREATE INDEX idx_clinical_orders_type ON clinical_orders(order_type);

-- Updated_at trigger
CREATE TRIGGER set_clinical_orders_updated_at
  BEFORE UPDATE ON clinical_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE clinical_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage clinical_orders"
  ON clinical_orders FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
```

#### 2. Provider Intake JSONB Shape

The `provider_intake` column stores a structured object with 5 sections:

```typescript
interface ProviderIntake {
  chief_complaints: {
    complaints: Array<{
      body_region: string          // e.g., "Neck", "Lower Back"
      pain_character: string       // e.g., "sharp", "dull", "burning", "aching"
      severity_min: number | null  // 0-10
      severity_max: number | null  // 0-10
      is_persistent: boolean       // persistent vs intermittent
      radiates_to: string | null   // e.g., "left arm", null if no radiation
      aggravating_factors: string  // free text
      alleviating_factors: string  // free text
    }>
    sleep_disturbance: boolean
    additional_notes: string | null
  }
  accident_details: {
    vehicle_position: string | null      // e.g., "driver", "front passenger", "rear passenger"
    impact_type: string | null           // e.g., "rear-end", "front", "side", "t-bone"
    seatbelt_worn: boolean | null
    airbag_deployed: boolean | null
    lost_consciousness: boolean | null
    er_visit: boolean | null
    er_details: string | null            // free text if er_visit is true
    immediate_symptoms: string | null    // free text
    narrative: string | null             // additional details beyond what's in cases.accident_description
  }
  past_medical_history: {
    medical_conditions: string    // free text, e.g., "None reported" or "Hypertension, Type 2 Diabetes"
    prior_surgeries: string       // free text
    current_medications: string   // free text, pre-accident medications
    allergies: string             // free text
  }
  social_history: {
    smoking_status: string        // "never" | "former" | "current"
    alcohol_use: string           // "denies" | "social" | "regular"
    drug_use: string              // "denies" | "other"
    occupation: string | null
  }
  exam_findings: {
    general_appearance: string | null  // e.g., "Alert and oriented, in no acute distress"
    regions: Array<{
      region: string                   // e.g., "Cervical Spine"
      palpation_findings: string       // e.g., "Tenderness and muscle spasm at C3-C7 paraspinal musculature"
      muscle_spasm: boolean
      additional_findings: string | null
    }>
    neurological_notes: string | null  // e.g., "Motor strength 5/5 bilaterally, sensation intact"
  }
}
```

### Success Criteria:

#### Automated Verification:
- [x] Migration applies cleanly: `npx supabase db push` (or local reset)
- [x] TypeScript types compile: `npm run typecheck`
- [x] No linting errors: `npm run lint`

#### Manual Verification:
- [x] `provider_intake` column exists on `initial_visit_notes` in Supabase dashboard
- [x] `clinical_orders` table exists with correct columns and constraints
- [x] RLS policies are active on `clinical_orders`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Remove Prerequisites Gate & Thread visit_type

### Overview
Make the case summary optional for note generation. When a case summary exists and is approved, use it to enrich the note (existing behavior). When no case summary exists, pass null fields and let the AI generate from provider intake + demographics. Also thread a `visitType` parameter through `gatherSourceData`, `generateInitialVisitNote`, `checkNotePrerequisites`, and the intake save/load functions so each visit type addresses its own row.

**Key rule**: every query and upsert on `initial_visit_notes` must filter by both `case_id` AND `visit_type`. A case may now have up to two live rows (one Initial Visit, one Pain Evaluation Visit). Omitting the `visit_type` filter would conflate them and re-introduce the overwrite bug.

### Changes Required:

#### 1. Update `gatherSourceData()` — Make Case Summary Optional & Accept visit_type
**File**: [initial-visit-notes.ts:20-128](src/actions/initial-visit-notes.ts#L20-L128)

**Signature change**: `gatherSourceData(caseId)` becomes `gatherSourceData(caseId, visitType: 'initial_visit' | 'pain_evaluation_visit')`. The `visitType` is used when querying for the existing note row (intake data) so the Initial Visit row and Pain Evaluation Visit row stay separated.

**Change**: The `summaryRes` query at lines 32-39 should use `.maybeSingle()` instead of `.single()`, and the hard gate at lines 61-63 should be replaced with a null fallback.

```typescript
// Line 32-39: Change .single() to .maybeSingle()
supabase
  .from('case_summaries')
  .select('chief_complaint, imaging_findings, prior_treatment, symptoms_timeline, suggested_diagnoses')
  .eq('case_id', caseId)
  .is('deleted_at', null)
  .in('review_status', ['approved', 'edited'])
  .eq('generation_status', 'completed')
  .maybeSingle(),  // <-- was .single()
```

```typescript
// Lines 61-63: Replace hard gate with null fallback
// REMOVE:
// if (summaryRes.error || !summaryRes.data) {
//   return { data: null, error: 'An approved case summary is required before generating an Initial Visit note.' }
// }

// REPLACE WITH: (allow null summary)
const summaryData = summaryRes.data
```

```typescript
// Lines 98-104: Use optional chaining for caseSummary fields
caseSummary: {
  chief_complaint: summaryData?.chief_complaint ?? null,
  imaging_findings: summaryData?.imaging_findings ?? null,
  prior_treatment: summaryData?.prior_treatment ?? null,
  symptoms_timeline: summaryData?.symptoms_timeline ?? null,
  suggested_diagnoses: summaryData?.suggested_diagnoses ?? null,
},
```

#### 2. Add `provider_intake` and `priorVisitData` to `gatherSourceData()` Return and `InitialVisitInputData`
**File**: [initial-visit-notes.ts:20-128](src/actions/initial-visit-notes.ts#L20-L128)

Add a query for the `provider_intake` column from the `initial_visit_notes` row matching `(case_id, visit_type)`. When the caller is generating a Pain Evaluation Visit, also load the **finalized Initial Visit** row (if one exists) as read-only reference data.

```typescript
// Add to the Promise.all block — query for existing note's provider_intake,
// keyed by BOTH case_id and visit_type so the two visit types don't collide.
supabase
  .from('initial_visit_notes')
  .select('provider_intake, rom_data')
  .eq('case_id', caseId)
  .eq('visit_type', visitType)
  .is('deleted_at', null)
  .maybeSingle(),
```

**Prior visit reference query** (only when generating a Pain Evaluation Visit):
```typescript
// Added conditionally — only queried when visitType === 'pain_evaluation_visit'
const priorVisitQuery = visitType === 'pain_evaluation_visit'
  ? supabase
      .from('initial_visit_notes')
      .select(`
        chief_complaint,
        physical_exam,
        imaging_findings,
        medical_necessity,
        diagnoses,
        treatment_plan,
        prognosis,
        provider_intake,
        rom_data,
        finalized_at
      `)
      .eq('case_id', caseId)
      .eq('visit_type', 'initial_visit')
      .eq('status', 'finalized')  // only pull FINALIZED Initial Visit notes as reference
      .is('deleted_at', null)
      .maybeSingle()
  : Promise.resolve({ data: null, error: null })
```

Add `providerIntake` and `priorVisitData` to the returned `inputData`:
```typescript
providerIntake: intakeRes.data?.provider_intake ?? null,
priorVisitData: priorVisitRes.data ?? null,  // null if this IS an Initial Visit, or if no finalized Initial Visit exists yet
```

**File**: [generate-initial-visit.ts:219-278](src/lib/claude/generate-initial-visit.ts#L219-L278)

Add `providerIntake`, `priorVisitData`, and `hasApprovedDiagnosticExtractions` to the `InitialVisitInputData` interface:
```typescript
providerIntake: {
  chief_complaints: unknown
  accident_details: unknown
  past_medical_history: unknown
  social_history: unknown
  exam_findings: unknown
} | null

// Read-only reference data from a prior finalized Initial Visit on the same case.
// Populated only when generating a Pain Evaluation Visit. Null otherwise.
priorVisitData: {
  chief_complaint: string | null
  physical_exam: string | null
  imaging_findings: string | null  // typically "Ordered — results pending" from Initial Visit
  medical_necessity: string | null
  diagnoses: string | null
  treatment_plan: string | null
  prognosis: string | null
  provider_intake: unknown | null
  rom_data: unknown | null
  finalized_at: string | null
} | null

hasApprovedDiagnosticExtractions: boolean
```

#### 3. Update `checkNotePrerequisites()` — Remove Case Summary Requirement
**File**: [initial-visit-notes.ts:510-529](src/actions/initial-visit-notes.ts#L510-L529)

Replace the case summary check with a minimal data check — at minimum, the case must exist and have a patient linked. Accepts an optional `visitType` so the caller (UI) can check per-visit-type enablement if needed.

```typescript
export async function checkNotePrerequisites(
  caseId: string,
  visitType?: 'initial_visit' | 'pain_evaluation_visit',
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Verify case exists and has a patient
  const { data: caseData } = await supabase
    .from('cases')
    .select('id, accident_date, patient:patients!inner(id)')
    .eq('id', caseId)
    .is('deleted_at', null)
    .single()

  if (!caseData) {
    return { data: { canGenerate: false, reason: 'Case not found or has no patient linked.' } }
  }

  return { data: { canGenerate: true } }
}
```

#### 4. Update Page Component — Load Both Visit Types
**File**: [page.tsx](src/app/(dashboard)/patients/[caseId]/initial-visit/page.tsx)

The page now loads **all live `initial_visit_notes` rows for the case** (up to two: one per visit type) and passes them to `InitialVisitEditor` as a `notes: InitialVisitNoteRow[]` prop. The editor picks which note to display based on the active tab (see Phase 4). Also call `getProviderIntake(caseId, visitType)` for each existing row and pass as `intakesByVisitType`.

Dropping the old "one note per page" assumption: the query changes from `.maybeSingle()` to `.order('visit_type')` returning an array (0–2 rows).

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `npm run typecheck`
- [x] No linting errors: `npm run lint`
- [x] Existing tests pass (if any)

#### Manual Verification:
- [x] On a case with NO case summary: the "Generate" button is **enabled** (no prerequisite warning)
- [x] On a case WITH an approved case summary: generation still works and uses the summary data
- [x] The `provider_intake` field is fetched and passed to the editor, scoped per visit_type
- [x] A case with two visit-type rows loads both into the editor without conflating them

**Implementation Note**: After completing this phase, pause for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Provider Intake Schemas & Server Actions

### Overview
Create Zod validation schemas for all 5 intake sections and server actions to save/load the `provider_intake` JSONB.

### Changes Required:

#### 1. Zod Schemas
**File**: `src/lib/validations/initial-visit-note.ts` (add to existing file)

```typescript
// --- Provider Intake Schemas ---

export const chiefComplaintEntrySchema = z.object({
  body_region: z.string().min(1, 'Body region is required'),
  pain_character: z.string().min(1, 'Pain character is required'),
  severity_min: z.number().int().min(0).max(10).nullable(),
  severity_max: z.number().int().min(0).max(10).nullable(),
  is_persistent: z.boolean(),
  radiates_to: z.string().nullable(),
  aggravating_factors: z.string(),
  alleviating_factors: z.string(),
})

export const chiefComplaintsSchema = z.object({
  complaints: z.array(chiefComplaintEntrySchema).min(1, 'At least one complaint is required'),
  sleep_disturbance: z.boolean(),
  additional_notes: z.string().nullable(),
})

export const accidentDetailsSchema = z.object({
  vehicle_position: z.string().nullable(),
  impact_type: z.string().nullable(),
  seatbelt_worn: z.boolean().nullable(),
  airbag_deployed: z.boolean().nullable(),
  lost_consciousness: z.boolean().nullable(),
  er_visit: z.boolean().nullable(),
  er_details: z.string().nullable(),
  immediate_symptoms: z.string().nullable(),
  narrative: z.string().nullable(),
})

export const pastMedicalHistorySchema = z.object({
  medical_conditions: z.string(),
  prior_surgeries: z.string(),
  current_medications: z.string(),
  allergies: z.string(),
})

export const socialHistorySchema = z.object({
  smoking_status: z.enum(['never', 'former', 'current']),
  alcohol_use: z.enum(['denies', 'social', 'regular']),
  drug_use: z.enum(['denies', 'other']),
  occupation: z.string().nullable(),
})

export const examRegionSchema = z.object({
  region: z.string().min(1, 'Region is required'),
  palpation_findings: z.string(),
  muscle_spasm: z.boolean(),
  additional_findings: z.string().nullable(),
})

export const examFindingsSchema = z.object({
  general_appearance: z.string().nullable(),
  regions: z.array(examRegionSchema),
  neurological_notes: z.string().nullable(),
})

export const providerIntakeSchema = z.object({
  chief_complaints: chiefComplaintsSchema,
  accident_details: accidentDetailsSchema,
  past_medical_history: pastMedicalHistorySchema,
  social_history: socialHistorySchema,
  exam_findings: examFindingsSchema,
})

export type ProviderIntakeValues = z.infer<typeof providerIntakeSchema>
export type ChiefComplaintEntry = z.infer<typeof chiefComplaintEntrySchema>
export type ExamRegion = z.infer<typeof examRegionSchema>
```

Also add default data constants (similar to `defaultRomData`):

```typescript
export const defaultProviderIntake: ProviderIntakeValues = {
  chief_complaints: {
    complaints: [
      {
        body_region: 'Neck',
        pain_character: '',
        severity_min: null,
        severity_max: null,
        is_persistent: true,
        radiates_to: null,
        aggravating_factors: '',
        alleviating_factors: '',
      },
    ],
    sleep_disturbance: false,
    additional_notes: null,
  },
  accident_details: {
    vehicle_position: null,
    impact_type: null,
    seatbelt_worn: null,
    airbag_deployed: null,
    lost_consciousness: null,
    er_visit: null,
    er_details: null,
    immediate_symptoms: null,
    narrative: null,
  },
  past_medical_history: {
    medical_conditions: 'None reported',
    prior_surgeries: 'None',
    current_medications: '',
    allergies: 'No known drug allergies',
  },
  social_history: {
    smoking_status: 'never',
    alcohol_use: 'denies',
    drug_use: 'denies',
    occupation: null,
  },
  exam_findings: {
    general_appearance: 'Alert and oriented, in no acute distress',
    regions: [],
    neurological_notes: null,
  },
}
```

#### 2. Server Actions for Save/Load
**File**: `src/actions/initial-visit-notes.ts` (add to existing file)

**`saveProviderIntake(caseId, visitType, intake)`**: Validates against `providerIntakeSchema`, then upserts the `provider_intake` column on the `initial_visit_notes` row matching `(case_id, visit_type)` (same pattern as `saveInitialVisitRom` — update existing row or insert a new draft row with only `provider_intake` and `visit_type` populated).

**`getProviderIntake(caseId, visitType)`**: Reads `provider_intake` from the `initial_visit_notes` row matching `(case_id, visit_type)`. Returns null if no row exists or `provider_intake` is null.

**`saveInitialVisitRom(caseId, visitType, rom)`** and **`getInitialVisitRom(caseId, visitType)`** — existing functions must also gain a `visitType` parameter so ROM data does not leak between visit types.

**`saveInitialVisitVitals(caseId, visitType, vitals)`** — likewise gains a `visitType` parameter if vitals are stored per-visit. If vitals live in a separate `vital_signs` table keyed only by `case_id`, add an encounter_type or similar field so two visits on the same case don't share the same vitals blob.

All queries must filter by BOTH `case_id` AND `visit_type`. Follow the existing patterns from `saveInitialVisitRom` ([initial-visit-notes.ts:624-675](src/actions/initial-visit-notes.ts#L624-L675)) and `getInitialVisitRom` ([initial-visit-notes.ts:605-622](src/actions/initial-visit-notes.ts#L605-L622)).

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `npm run typecheck`
- [x] No linting errors: `npm run lint`
- [x] Schema validation tests pass for all 5 intake sections

#### Manual Verification:
- [x] `saveProviderIntake` writes to DB correctly (check Supabase dashboard)
- [x] `getProviderIntake` returns saved data

**Implementation Note**: After completing this phase, pause for manual confirmation before proceeding to Phase 4.

---

## Phase 4: Provider Intake UI & Visit Type Selector

### Overview
Add 5 new tab panels to the pre-generation state in `InitialVisitEditor`, following the existing VitalSignsCard/RomInputCard pattern exactly. Also add a **top-level visit-type selector** (two tabs or a segmented control) so the provider chooses which visit they are working on: "Initial Visit" or "Pain Evaluation Visit". Each visit type is a completely independent editor state — its own intake data, its own generated note, its own finalized PDF. Switching tabs loads the other row.

### Visit Type Selector Behavior
- If the case has **zero notes**, both tabs are visible. Auto-detect which one to default to: if diagnostics are available (case summary with imaging findings OR approved MRI/CT extractions), default to Pain Evaluation Visit; otherwise Initial Visit.
- If the case has **one note**, open that note's tab by default; the other tab shows an empty "Start this visit" state.
- If the case has **both notes**, each tab shows its respective editor/finalized state.
- Generating a note on one tab does NOT modify the other. Resetting a note on one tab does NOT affect the other.
- Explicit labeling: the tab labels read "Initial Visit" and "Pain Evaluation Visit" so the provider always knows which document they are editing.

### Changes Required:

#### 1. Update Tab Navigation
**File**: [initial-visit-editor.tsx:188-251](src/components/clinical/initial-visit-editor.tsx#L188-L251)

Add 5 new tabs to the `<Tabs>` component in the pre-generation block. The tab order should be:
1. Chief Complaints (new)
2. Accident Details (new)
3. Past Medical History (new)
4. Social History (new)
5. Exam Findings (new)
6. Vital Signs (existing)
7. Range of Motion (existing)

Change `defaultValue` to `"chief-complaints"` since that's the most important first-visit input.

#### 2. Five New Card Components
All defined as private functions within `initial-visit-editor.tsx` (matching the existing pattern):

**`ChiefComplaintsCard`**:
- Uses `useFieldArray` for the complaints array (like RomInputCard)
- Each complaint row: body region (text input), pain character (select: sharp/dull/burning/aching/throbbing/stabbing), severity min/max (number inputs), persistent toggle (switch), radiates to (text), aggravating factors (textarea), alleviating factors (textarea)
- "Add Complaint" button to append new entries
- Sleep disturbance toggle
- Additional notes textarea
- Save button calls `saveProviderIntake`

**`AccidentDetailsCard`**:
- Vehicle position (select: driver/front passenger/rear passenger/pedestrian/cyclist)
- Impact type (select: rear-end/front/side/t-bone/rollover/other)
- Seatbelt worn, airbag deployed, lost consciousness, ER visit (boolean switches)
- ER details (textarea, shown conditionally when ER visit is true)
- Immediate symptoms (textarea)
- Additional narrative (textarea)
- Save button calls `saveProviderIntake`

**`PastMedicalHistoryCard`**:
- Medical conditions (textarea, default "None reported")
- Prior surgeries (textarea, default "None")
- Current medications (textarea, placeholder "e.g., Advil/Ibuprofen as needed")
- Allergies (textarea, default "No known drug allergies")
- Save button calls `saveProviderIntake`

**`SocialHistoryCard`**:
- Smoking status (select: never/former/current)
- Alcohol use (select: denies/social/regular)
- Drug use (select: denies/other)
- Occupation (text input)
- Save button calls `saveProviderIntake`

**`ExamFindingsCard`**:
- General appearance (textarea, default provided)
- Regions array with `useFieldArray` (like RomInputCard):
  - Region name (text input)
  - Palpation findings (textarea)
  - Muscle spasm (switch)
  - Additional findings (textarea)
- "Add Region" button
- Neurological notes (textarea)
- Save button calls `saveProviderIntake`

#### 3. Save Strategy
Each card saves the **entire** `provider_intake` object, not just its own section. On save:
1. Read the current full intake from form state
2. Merge the card's section into the full object
3. Call `saveProviderIntake(caseId, fullIntake)`

This avoids race conditions and partial saves. The component maintains a single `useForm<ProviderIntakeValues>` at the `InitialVisitEditor` level, passed down to each card via props.

#### 4. Props Update
**File**: [initial-visit-editor.tsx](src/components/clinical/initial-visit-editor.tsx)

Replace the single-note props with a per-visit-type map:
```typescript
interface InitialVisitEditorProps {
  caseId: string
  notesByVisitType: {
    initial_visit: InitialVisitNoteRow | null
    pain_evaluation_visit: InitialVisitNoteRow | null
  }
  intakesByVisitType: {
    initial_visit: ProviderIntakeValues | null
    pain_evaluation_visit: ProviderIntakeValues | null
  }
  romByVisitType: {
    initial_visit: RomData | null
    pain_evaluation_visit: RomData | null
  }
  defaultVisitType: 'initial_visit' | 'pain_evaluation_visit' // auto-detected
  // ...existing clinic/provider/case props
}
```

The editor maintains an `activeVisitType` state (initialized to `defaultVisitType`). All card components receive `activeVisitType` and pass it to their save actions.

**File**: [page.tsx](src/app/(dashboard)/patients/[caseId]/initial-visit/page.tsx)

Load all note rows and intakes for both visit types in the page's `Promise.all`:
- `getInitialVisitNotes(caseId)` → returns 0–2 rows
- `getProviderIntake(caseId, 'initial_visit')`
- `getProviderIntake(caseId, 'pain_evaluation_visit')`
- `getInitialVisitRom(caseId, 'initial_visit')`
- `getInitialVisitRom(caseId, 'pain_evaluation_visit')`

Compute `defaultVisitType` server-side using the same detection logic as `detectNoteMode()` and pass it to the editor.

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `npm run typecheck`
- [x] No linting errors: `npm run lint`

#### Manual Verification:
- [x] Visit type selector (Initial Visit / Pain Evaluation Visit) appears at the top of the editor
- [x] Default visit type is auto-detected correctly (Initial Visit for fresh cases, Pain Evaluation Visit when diagnostics exist)
- [x] All 7 intake tabs render correctly in the pre-generation state
- [x] Each card saves independently and persists on page reload
- [x] Form defaults are sensible for a fresh case
- [x] Adding/removing array entries (complaints, exam regions) works
- [x] Conditional fields (ER details) show/hide correctly
- [x] Switching between visit type tabs does NOT lose data on either side
- [x] Saving intake data on one visit type does NOT populate the other visit type's intake

**Implementation Note**: After completing this phase, pause for manual confirmation before proceeding to Phase 5.

---

## Phase 5: Dual-Mode System Prompt

### Overview
Update the system prompt to auto-detect and generate two distinct visit types based on data availability. **Initial Visit** (no diagnostics) produces conservative assessment notes. **Pain Evaluation Visit** (diagnostics complete) preserves the existing PRP-focused prompt behavior. Both modes write to the same note record; only the prompt differs.

### Changes Required:

#### 1. Visit Type Detection (for Defaults Only) and Explicit Pass-Through
**File**: [generate-initial-visit.ts](src/lib/claude/generate-initial-visit.ts)

The visit type is **always explicit** at generation time — it comes from the editor's active visit type tab. The detection function below is used only to choose the **default tab** when opening a case with no notes yet; once the user picks a tab, the tab value is the source of truth and passed into `generateInitialVisitFromData(inputData, visitType, toneHint)`.

This separation is critical: if detection were used at generation time, a provider explicitly working on an Initial Visit note for a case that already has imaging would accidentally get a Pain Evaluation Visit prompt. Explicit pass-through prevents the overwrite risk and gives the user control.

```typescript
export type NoteVisitType = 'initial_visit' | 'pain_evaluation_visit'

// Used by the page component to pick the default open tab.
// Also used by gatherSourceData() to compute hasApprovedDiagnosticExtractions.
export function detectDefaultVisitType(inputData: InitialVisitInputData): NoteVisitType {
  const findings = inputData.caseSummary?.imaging_findings
  const hasImagingFindings = findings != null
    && Array.isArray(findings)
    && (findings as unknown[]).length > 0

  if (hasImagingFindings) return 'pain_evaluation_visit'
  if (inputData.hasApprovedDiagnosticExtractions) return 'pain_evaluation_visit'
  return 'initial_visit'
}
```

The `hasApprovedDiagnosticExtractions` boolean is added to `InitialVisitInputData` and populated by `gatherSourceData()` in [initial-visit-notes.ts](src/actions/initial-visit-notes.ts) via a count query against `mri_extractions` and `ct_scan_extractions` filtered by `case_id`, `deleted_at IS NULL`, and `review_status IN ('approved','edited')`. This is a single cheap query added to the existing `Promise.all` block.

#### 2. Dual-Mode System Prompt
**File**: [generate-initial-visit.ts:11-124](src/lib/claude/generate-initial-visit.ts#L11-L124)

The `SYSTEM_PROMPT` constant becomes a function that takes the mode and returns the appropriate prompt. The structure:

```typescript
function buildSystemPrompt(visitType: NoteVisitType): string {
  const COMMON_RULES = `...` // Global rules, PDF formatting, sections 1, 4-8, 10, 15, 16 (unchanged)

  if (visitType === 'initial_visit') {
    return `${COMMON_RULES}\n\n${INITIAL_VISIT_SECTIONS}`
  }
  return `${COMMON_RULES}\n\n${PAIN_EVALUATION_VISIT_SECTIONS}`
}
```

**Sections that differ by mode:**

| Section | Initial Visit | Pain Evaluation Visit |
|---|---|---|
| **2. History of Accident** | Para 3: "The patient presents today for initial evaluation following the described incident. [He/She] reports ongoing pain and functional limitations affecting activities of daily living." | Para 3: "Despite conservative treatment, continues to complain..." (current) |
| **3. Post-Accident History** | Patient-reported symptom progression since accident, self-treatment (OTC meds), functional impact. NO treatment timeline (none exists). Use `providerIntake.chief_complaints` and `providerIntake.accident_details` as primary data sources. | Current behavior: treatment timeline from case summary |
| **9. Imaging Findings** | "MRI of [Region] – Ordered" per affected region. "Imaging results pending. Diagnostic imaging has been ordered to further evaluate the patient's clinical presentation." | Current behavior: MRI findings with measurements |
| **10. Diagnoses** | Clinical impression codes only (strain/sprain: S13.4XXA, S39.012A, M54.2, M79.1, etc.) based on exam + mechanism. NOT imaging-confirmed codes. | Current behavior: imaging-confirmed codes from case summary |
| **11. Medical Necessity** | "Clinical examination findings warrant diagnostic imaging and structured follow-up. Physical examination reveals [findings] consistent with [injury pattern] sustained during the [accident type]. Diagnostic imaging has been ordered to further evaluate the extent of injury and guide treatment planning." | Current behavior: correlates exam with imaging, cites conservative care failure |
| **12. Treatment Plan** | Conservative: (a) continue OTC medications, (b) imaging orders (list regions), (c) referral to chiropractic care and physical therapy, (d) activity modification and ergonomic guidance, (e) follow-up appointment to review imaging and reassess. NO PRP, NO cost estimate. Mention PRP only as future escalation: "Should diagnostic imaging reveal structural pathology and conservative measures prove insufficient, advanced interventional treatments including regenerative injection therapy may be considered." | Current behavior: PRP protocol with cost estimate |
| **13. Patient Education** | Injury biomechanics, importance of diagnostic imaging, red-flag symptoms to monitor, conservative care guidance, activity modification, medication guidance. NO PRP education. | Current behavior: PRP mechanism, post-injection course |
| **14. Prognosis** | "Prognosis is guarded but favorable given early clinical presentation and absence of neurological compromise. Outcome will depend on diagnostic imaging results, response to conservative treatment, and adherence to the prescribed rehabilitation program." | Current behavior: "guarded to fair given... MRI-confirmed pathology" |

**Sections that stay the same in both modes** (no changes needed):
- 1. Introduction
- 4. Chief Complaint
- 5. Past Medical History
- 6. Social History
- 7. Review of Systems
- 8. Physical Examination *(with one formatting fix — see below)*
- 15. Time and Complexity Attestation
- 16. Clinician Disclaimer

#### 2b. Physical Examination — Bold "GENERAL:" Sub-heading
**File**: [generate-initial-visit.ts:87](src/lib/claude/generate-initial-visit.ts#L87)

Change the prompt instruction from `Then "General:" appearance statement` to `Then "GENERAL:" appearance statement` so it matches the uppercase sub-heading pattern used by VITAL SIGNS:, NEUROLOGICAL:, and region-specific sub-headings. The PDF renderer's `isSubHeading()` function ([initial-visit-template.tsx:107-116](src/lib/pdf/initial-visit-template.tsx#L107-L116)) requires >60% uppercase letters to render a line as bold — `General:` fails this check while `GENERAL:` passes it. This applies to both modes.

#### 3. Provider Intake Data Instructions

Add to the system prompt (both modes) instructions for using `providerIntake` data:

```
=== PROVIDER INTAKE DATA ===

If providerIntake is provided in the source data, use it as the PRIMARY source for:
- Chief Complaint section: Use providerIntake.chief_complaints for body regions, pain character, severity, radiation, and aggravating/alleviating factors
- History of the Accident: Supplement accident_description with providerIntake.accident_details (vehicle position, impact type, seatbelt, airbag, consciousness, ER visit, immediate symptoms)
- Past Medical History: Use providerIntake.past_medical_history directly
- Social History: Use providerIntake.social_history directly
- Physical Examination: Use providerIntake.exam_findings for per-region palpation findings, muscle spasm, and neurological notes
- Post-Accident History: Use providerIntake.chief_complaints and accident_details for symptom/functional impact narrative

If both providerIntake and caseSummary contain data for the same field, prefer providerIntake (it is more recent, entered at this visit).
```

#### 3b. Prior Visit Reference Instructions (Pain Evaluation Visit Only)

Add to the Pain Evaluation Visit prompt ONLY:

```
=== PRIOR VISIT REFERENCE (READ-ONLY) ===

If priorVisitData is provided, it contains the finalized Initial Visit note from an earlier encounter on this same case. Treat it as READ-ONLY reference for interval comparison. DO NOT copy its physical exam findings, vitals, or ROM values into this note — those come from the CURRENT visit's providerIntake. Instead, use priorVisitData to:

1. **History of the Accident (Para 3)**: Reference the prior visit's documented findings and conservative care outcome. Example: "Since the initial evaluation on [priorVisitData.finalized_at], the patient has continued conservative care including [reference priorVisitData.treatment_plan]. Despite these measures, symptoms persist, prompting today's pain management evaluation."

2. **Post-Accident History**: Describe the continuum of care from initial presentation to today. Reference priorVisitData.treatment_plan for what was recommended and summarize adherence/outcome based on the CURRENT visit's providerIntake.

3. **Physical Examination**: Do NOT restate prior exam findings as current findings. Current findings come from the CURRENT visit's providerIntake.exam_findings. You MAY add one brief comparative sentence at the end of each region: "Compared to the initial evaluation, cervical ROM has [improved/worsened/remained unchanged]." Use priorVisitData.rom_data and priorVisitData.physical_exam for the comparison basis only.

4. **Medical Necessity**: Cite that conservative care was documented and attempted at the initial visit (reference priorVisitData.treatment_plan) and has failed to produce adequate relief, supporting the escalation to interventional treatment.

5. **Prognosis**: May reference the evolution from guarded-but-favorable (initial) to the current imaging-informed prognosis.

If priorVisitData is null (no prior Initial Visit exists on this case), generate the Pain Evaluation Visit note without any interval-comparison language — it is a standalone evaluation.
```

#### 4. Update Tool Descriptions
**File**: [generate-initial-visit.ts:126-216](src/lib/claude/generate-initial-visit.ts#L126-L216)

Update the `INITIAL_VISIT_TOOL` property descriptions for sections that vary by mode. For example, `imaging_findings` description should mention both possibilities: "MRI findings by region with specific measurements OR 'Ordered — results pending' for pending imaging."

#### 5. Pass Visit Type to API Call (Explicit, Not Auto-Detected)
**File**: [generate-initial-visit.ts:281-325](src/lib/claude/generate-initial-visit.ts#L281-L325)

```typescript
export async function generateInitialVisitFromData(
  inputData: InitialVisitInputData,
  visitType: NoteVisitType,  // <-- NEW required parameter, from active editor tab
  toneHint?: string | null,
): Promise<...> {
  const systemPrompt = buildSystemPrompt(visitType)
  // ... rest of function uses systemPrompt instead of SYSTEM_PROMPT
}
```

`generateInitialVisitNote()` in [initial-visit-notes.ts](src/actions/initial-visit-notes.ts) gains a `visitType` parameter which it:
1. Passes to `gatherSourceData(caseId, visitType)` — so the correct intake row is loaded
2. Passes to `generateInitialVisitFromData(inputData, visitType, toneHint)` — so the correct prompt is used
3. Uses when looking up / upserting the target row in `initial_visit_notes` — keyed by `(case_id, visit_type)`

Also update `regenerateSection()` ([generate-initial-visit.ts:344-380](src/lib/claude/generate-initial-visit.ts#L344-L380)) to accept and use `visitType`.

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `npm run typecheck`
- [x] No linting errors: `npm run lint`

#### Manual Verification:
- [x] **Initial Visit test**: Case with no case summary and no approved MRI/CT extractions, provider intake filled out → generates Initial Visit note with conservative treatment plan, "Ordered — results pending" imaging, clinical impression diagnoses, no PRP
- [x] **Pain Evaluation Visit test (primary path)**: Case with approved case summary containing imaging findings → generates Pain Evaluation Visit note (current PRP behavior unchanged)
- [x] **Pain Evaluation Visit test (fallback path)**: Case with approved MRI extraction but no case summary → still generates Pain Evaluation Visit note via the extraction fallback
- [x] **Prior visit reference test**: Generate + finalize an Initial Visit note, then generate a Pain Evaluation Visit note on the same case. The Pain Evaluation note should contain interval-comparison language (references to "initial evaluation", progression of symptoms, comparison of ROM, etc.) but its physical exam section should reflect the CURRENT Pain Evaluation intake data, not a copy of the Initial Visit exam.
- [x] **No prior visit test**: Generate a Pain Evaluation Visit note on a case that has no prior Initial Visit (e.g., patient arrived with imaging already in hand). The note should generate correctly without any broken comparison references.
- [x] **Isolation test**: Edit the Initial Visit intake after the Pain Evaluation Visit note is generated. The Pain Evaluation Visit note content is unaffected (re-generate required to pick up changes).
- [x] Section regeneration works correctly in both modes
- [x] Tone hint still works in both modes

**Implementation Note**: Phase 5 is implemented. Phases 6 and 7 have been merged into a single Phase 6 below.

---

## Phase 6: Companion Document Generation & PDF (merged with former Phase 7)

### Overview
Add Imaging Orders and Chiropractic Therapy Order generation with immediate PDF rendering, triggered manually from the "Orders" tab after a visit note is finalized. Generation is a single step: AI generates structured data → PDF is rendered and uploaded → download button appears immediately. No separate "finalize" step for orders.

**Per-visit-type orders**: `clinical_orders.initial_visit_note_id` already points to a specific note row, so each visit type naturally has its own set of orders. Orders generated from an Initial Visit note (e.g., MRI orders at first encounter) are separate from orders generated from a Pain Evaluation Visit note (e.g., PT referral after imaging review). The "Orders" tab in each visit type's editor only shows/generates orders for that visit.

### Changes Required:

#### 1. Companion Document AI Generation
**File**: [generate-clinical-orders.ts](src/lib/claude/generate-clinical-orders.ts) (new file)

Shared `ClinicalOrderInputData` interface with patient info, diagnoses text, chief complaint text, treatment plan text, provider/clinic info, and date of visit.

Two generation functions:

**`generateImagingOrders(inputData)`**:
- Output: structured order with `patient_name`, `date_of_order`, `ordering_provider`, `ordering_provider_npi`, `orders[]` (body_region, modality, icd10_codes, clinical_indication)
- Uses claude-sonnet-4-6 with a forced tool call

**`generateChiropracticOrder(inputData)`**:
- Output: structured order with `patient_name`, `date_of_order`, `referring_provider`, `referring_provider_npi`, `diagnoses[]`, `treatment_plan` (frequency, duration, modalities, goals), `special_instructions`, `precautions`
- Uses claude-sonnet-4-6 with a forced tool call

#### 2. Zod Schemas & Types
**File**: [clinical-orders.ts](src/lib/validations/clinical-orders.ts) (new file)

- `imagingOrderResultSchema` / `ImagingOrderResult`
- `chiropracticOrderResultSchema` / `ChiropracticOrderResult`
- `ORDER_TYPES` constant and `OrderType` type
- `orderTypeLabels` display name map

#### 3. Server Actions
**File**: [clinical-orders.ts](src/actions/clinical-orders.ts) (new file)

- **`generateClinicalOrder(caseId, visitType, orderType)`**: Single action that gathers data from the finalized note **for the given visit type**, calls AI generation, renders PDF immediately, uploads to storage, creates document record, and saves to `clinical_orders` table with `initial_visit_note_id` pointing to the specific visit-type row. No separate finalize needed.
- **`getClinicalOrders(caseId, visitType)`**: Lists non-deleted orders for a case **scoped to the given visit type** (filtered by `initial_visit_note_id = <that visit's row id>`), joins `documents(file_path)` for download URLs.
- **`deleteClinicalOrder(orderId, caseId)`**: Soft-deletes an order.
- **`finalizeClinicalOrder(orderId, caseId)`**: Retained for edge cases but not used in the standard UI flow.

Data flow in `generateClinicalOrder`:
1. Fetch finalized note (diagnoses, chief_complaint, treatment_plan) + case/patient/provider/clinic data
2. Call `generateImagingOrders()` or `generateChiropracticOrder()` via AI
3. Fetch clinic settings, provider profile, patient DOB for PDF rendering
4. Render PDF via `renderImagingOrdersPdf()` or `renderChiropracticOrderPdf()`
5. Upload PDF to Supabase Storage
6. Create `documents` row
7. Update `clinical_orders` row with order_data, document_id, and completed status

#### 4. PDF Templates
**File**: [imaging-orders-template.tsx](src/lib/pdf/imaging-orders-template.tsx) + [render-imaging-orders-pdf.ts](src/lib/pdf/render-imaging-orders-pdf.ts)
**File**: [chiropractic-order-template.tsx](src/lib/pdf/chiropractic-order-template.tsx) + [render-chiropractic-order-pdf.ts](src/lib/pdf/render-chiropractic-order-pdf.ts)

Both follow the existing React-PDF pattern from `initial-visit-template.tsx`. Accept `patientDob` for DOB population. Include clinic header (logo, address, phone/fax), patient info block, order-specific content, and provider signature block.

#### 5. UI — Orders Tab
**File**: [initial-visit-editor.tsx](src/components/clinical/initial-visit-editor.tsx)

`CompanionDocumentsSection` component used in two contexts:

**Finalized view** (`FinalizedView`): Rendered inside a `Tabs` component as the "Orders" tab alongside the "Note" tab. Generation buttons are enabled.

**Draft view** (`DraftEditor`): Orders tab is NOT shown — orders require a finalized note.

UI behavior:
- "Generate Imaging Orders" and "Generate Chiropractic Therapy Order" buttons
- Buttons disabled when: already generated, generation in progress, case locked, or note not finalized
- When not finalized: yellow warning banner "Finalize the Initial Visit note before generating orders."
- After generation: order row shows with "Download PDF" button and delete (trash) button
- No intermediate "finalize" step — PDF is available immediately after generation
- Orders load on component mount via `useEffect`

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `npm run typecheck`
- [x] No linting errors: `npm run lint`

#### Manual Verification:
- [x] After finalizing an Initial Visit note, "Orders" tab appears with generation buttons
- [x] Orders tab is NOT shown in draft view
- [x] Imaging Orders generate with correct ICD-10 codes from the note and PDF downloads immediately
- [x] Chiropractic Order generates with correct diagnoses and treatment plan and PDF downloads immediately
- [x] Patient DOB populates correctly in order PDFs
- [x] Delete button removes orders
- [x] Generation buttons show as disabled/"Generated" after an order exists for that type

**Implementation Note**: This is the final phase. Verify the complete end-to-end workflow: create case → fill intake forms → generate First Visit note → finalize → switch to Orders tab → generate companion documents → download PDFs.

---

## Phase 7: Fix Duplicate Vital Signs in PDF

### Overview
Remove the standalone Vital Signs block that renders at the top of the generated PDF document. Vital Signs are already included within the Physical Examination section (Claude generates a `VITAL SIGNS:` sub-heading with all values per the system prompt instruction), so the standalone block at the top creates an unwanted duplicate.

### Changes Required:

#### 1. Remove Standalone Vital Signs Block from PDF Template
**File**: [initial-visit-template.tsx:220-254](src/lib/pdf/initial-visit-template.tsx#L220-L254)

**Remove** the entire `{/* Vital Signs Summary */}` block (lines 220–254) that conditionally renders `data.vitals` as a structured table before the Introduction section.

The vitals data will continue to appear correctly within the "Physical Examination" section, where Claude embeds it as a `VITAL SIGNS:` sub-heading with bullet points per the system prompt instruction at [generate-initial-visit.ts:86-88](src/lib/claude/generate-initial-visit.ts#L86-L88).

#### 2. Clean Up Unused Vitals Prop (if applicable)
**File**: [render-initial-visit-pdf.ts](src/lib/pdf/render-initial-visit-pdf.ts)

If the `vitals` field on `InitialVisitPdfData` is no longer consumed by the template after the removal, remove the DB query for `vital_signs` data (lines ~44-58) and the `vitals` property from `pdfData` (line ~151). Also remove the `vitals` field from the `InitialVisitPdfData` type.

**Note**: Only remove the vitals prop/query if no other part of the template uses `data.vitals`. If it is only used in the removed block, clean it up.

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `npm run typecheck`
- [x] No linting errors: `npm run lint`

#### Manual Verification:
- [x] Generated PDF does NOT show a standalone "Vital Signs" section at the top of the document
- [x] Vital Signs still appear correctly within the "Physical Examination" section
- [x] Both Initial Visit and Pain Evaluation Visit PDFs render correctly without duplicate vitals

---

## Phase 8: Fix Reset Notes and Row Duplication

### Overview
Two related bugs were fixed together:

1. **Row duplication**: `generateInitialVisitNote` was soft-deleting the existing row and inserting a new one on every generation, accumulating rows (soft-deleted tombstones + one live row per generation cycle). With intake saves also creating rows, a case could end up with multiple historical rows and the unique partial index (`(case_id) WHERE deleted_at IS NULL`) was the only thing preventing two live rows from existing simultaneously.

2. **Reset data loss**: `resetInitialVisitNote` was also soft-deleting the row, which lost `provider_intake` and `rom_data`. An attempted fix using `status: 'pending'` failed silently because `'pending'` is not in the DB CHECK constraint (`generating`, `draft`, `finalized`, `failed`).

### Root Cause
The soft-delete + re-insert pattern in `generateInitialVisitNote` was the core issue. Both generate and reset should update the single row in-place rather than replacing it.

### Changes Required:

#### 1. Refactor `generateInitialVisitNote()` — Update In-Place
**File**: [initial-visit-notes.ts](src/actions/initial-visit-notes.ts)

Replace the soft-delete + insert pattern with an in-place update of the existing row. If a row exists, update it to `generating` status (clearing section fields, preserving `provider_intake` and `rom_data`). If no row exists, insert one.

```typescript
// Find or create the note row for this case AND this visit type.
// The (case_id, visit_type) unique index guarantees at most one live row per pair.
const { data: existingNote } = await supabase
  .from('initial_visit_notes')
  .select('id, rom_data, provider_intake')
  .eq('case_id', caseId)
  .eq('visit_type', visitType)  // <-- critical: do NOT conflate Initial Visit with Pain Evaluation Visit
  .is('deleted_at', null)
  .maybeSingle()

if (existingNote) {
  // Update existing row to generating state (preserves provider_intake and rom_data for THIS visit type)
  await supabase.from('initial_visit_notes').update({
    status: 'generating',
    generation_attempts: 1,
    source_data_hash: sourceHash,
    introduction: null, // ... all 16 section fields nulled
    ai_model: null, raw_ai_response: null, generation_error: null,
    updated_by_user_id: user.id,
  }).eq('id', existingNote.id)
  recordId = existingNote.id
} else {
  // No existing row for this visit type — insert one. Does NOT touch the other visit type's row if it exists.
  const { data: record } = await supabase.from('initial_visit_notes').insert({
    case_id: caseId,
    visit_type: visitType,  // <-- REQUIRED: tags the row so the other visit type is never overwritten
    status: 'generating',
    generation_attempts: 1,
    source_data_hash: sourceHash,
    created_by_user_id: user.id,
    updated_by_user_id: user.id,
  }).select('id').single()
  recordId = record.id
}
```

#### 2. Update `resetInitialVisitNote()` — Update In-Place (Per Visit Type)
**File**: [initial-visit-notes.ts](src/actions/initial-visit-notes.ts)

Accept `visitType` parameter. Replace the soft-delete with an in-place update that nulls all AI-generated fields while leaving `provider_intake`, `rom_data`, AND the **other visit type's row** untouched:

```typescript
export async function resetInitialVisitNote(caseId: string, visitType: NoteVisitType) {
  // ... auth checks ...

  // Look up ONLY the target visit type's row. The other visit type is untouched.
  const { data: note } = await supabase
    .from('initial_visit_notes')
    .select('id')
    .eq('case_id', caseId)
    .eq('visit_type', visitType)  // <-- critical
    .is('deleted_at', null)
    .maybeSingle()
  if (!note) return { error: 'No note to reset for this visit type' }

  await supabase.from('initial_visit_notes').update({
    status: 'draft',
    introduction: null, history_of_accident: null, post_accident_history: null,
    chief_complaint: null, past_medical_history: null, social_history: null,
    review_of_systems: null, physical_exam: null, imaging_findings: null,
    medical_necessity: null, diagnoses: null, treatment_plan: null,
    patient_education: null, prognosis: null, time_complexity_attestation: null,
    clinician_disclaimer: null, ai_model: null, raw_ai_response: null,
    generation_error: null, generation_attempts: 0, source_data_hash: null,
    updated_by_user_id: user.id,
  }).eq('id', note.id)
  // provider_intake, rom_data, and visit_type are NOT in the update — preserved.
  // The other visit type's row is completely untouched.
}
```

#### 3. Update AlertDialog Confirmation Text
**File**: [initial-visit-editor.tsx](src/components/clinical/initial-visit-editor.tsx) (both reset button instances)

Updated text to reflect that all provider-entered data is preserved:
> "This will discard all generated note content and return to the pre-generation state. Your intake data (chief complaints, accident details, medical history, exam findings), vitals, and ROM data will be preserved. Continue?"

### Why In-Place Works
- The `hasGeneratedContent` check (`note?.introduction || note?.chief_complaint`) correctly returns false after reset, showing the pre-generation UI
- `parsedIntake` reads `provider_intake` directly from the note row (line 204 in editor) — forms pre-fill from the preserved data
- `initialRom` is read from `note.rom_data` in the page component — also preserved
- Always exactly one row per `(case_id, visit_type)` pair; the unique partial index `(case_id, visit_type) WHERE deleted_at IS NULL` is never under pressure
- **Visit-type isolation**: every generate/reset/save/load operation filters by `visit_type`, so an Initial Visit note is never overwritten by a Pain Evaluation Visit generation (and vice versa). Both documents coexist and are independently preserved.

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles (no new types introduced, all patterns follow existing code)
- [x] No linting errors

#### Manual Verification:
- [x] Reset a draft note → intake data and ROM are preserved on reload
- [x] After reset, pre-generation UI shows with intake tabs pre-filled
- [x] Generate after reset → AI uses preserved intake data
- [x] Multiple generate → reset → generate cycles produce exactly one DB row **per visit type** throughout
- [x] Vitals (separate `vital_signs` table) are unaffected
- [x] **Overwrite protection**: Generate an Initial Visit note on a fresh case, finalize it, then have MRI extractions approved and generate a Pain Evaluation Visit on the same case. Both notes must coexist as two separate rows in `initial_visit_notes` (verify via Supabase dashboard), both PDFs downloadable, and resetting one must not affect the other.
- [x] **Overwrite protection (reverse)**: Generate Pain Evaluation Visit first, then Initial Visit. Same result — two coexisting rows, neither overwritten.

---

## Testing Strategy

### Unit Tests:
- Zod schema validation for all 5 provider intake sections (valid data, missing required fields, boundary values)
- Zod schema validation for imaging order and chiropractic order results
- `detectDefaultVisitType()` function (used for default tab selection only):
  - returns `'initial_visit'` when no imaging findings AND no approved MRI/CT extractions
  - returns `'pain_evaluation_visit'` when `caseSummary.imaging_findings` is populated (primary path)
  - returns `'pain_evaluation_visit'` when approved MRI or CT extraction exists with no case summary (fallback path)
- `buildSystemPrompt(visitType)` returns different content for each visit type
- `generateInitialVisitFromData` requires an explicit `visitType` — never auto-detects at generation time (this is what prevents the overwrite bug)

### Integration Tests:
- `gatherSourceData(caseId, visitType)` returns valid `InitialVisitInputData` with null `caseSummary` fields when no summary exists
- `gatherSourceData(caseId, visitType)` returns enriched data when case summary exists
- `gatherSourceData(caseId, 'initial_visit')` and `gatherSourceData(caseId, 'pain_evaluation_visit')` return isolated intake data — modifying one does not leak into the other
- `gatherSourceData(caseId, 'pain_evaluation_visit')` returns `priorVisitData` populated ONLY when a finalized Initial Visit exists on the case
- `gatherSourceData(caseId, 'initial_visit')` always returns `priorVisitData: null` (the initial visit is never a reference to itself)
- `saveProviderIntake(caseId, visitType, data)` / `getProviderIntake(caseId, visitType)` round-trip, isolated per visit type
- `checkNotePrerequisites()` returns `canGenerate: true` for cases without case summaries
- **Overwrite isolation test**: generate an Initial Visit note, then generate a Pain Evaluation Visit note on the same case. Query `initial_visit_notes` and assert exactly two live rows with distinct `visit_type` values and fully populated (non-overlapping) section content. Delete one and assert the other still exists.
- **Unique index test**: attempting to insert a second live row with the same `(case_id, visit_type)` must fail with a unique constraint violation.

### Manual Testing Steps:
1. Create a new case with patient demographics and accident description only
2. Navigate to Initial Visit page — verify no prerequisite warning, generate button enabled
3. Fill out all 7 pre-generation tabs, save each
4. Generate note — verify Initial Visit output (conservative, no PRP, ordered imaging)
5. Edit sections, regenerate individual sections — verify mode consistency
6. Verify Orders tab is NOT shown in draft view
7. Finalize note — verify PDF renders correctly
8. Verify Orders tab appears in finalized view with generation buttons enabled
9. Generate Imaging Orders — verify correct ICD-10 codes, PDF downloads immediately (no finalize step)
10. Generate Chiropractic Order — verify correct diagnoses/treatment plan, PDF downloads immediately
11. Verify patient DOB populates correctly in order PDFs
12. Delete an order — verify it disappears, generation button re-enables
13. Test Pain Evaluation Visit (primary path): create case with approved case summary containing imaging — verify default tab is Pain Evaluation Visit and generated note uses the PRP prompt (no regression)
13a. Test Pain Evaluation Visit (fallback path): create case with approved MRI extraction but no case summary — verify default tab is still Pain Evaluation Visit
13b. **Coexistence test**: on the same case, generate an Initial Visit note first, then switch to the Pain Evaluation Visit tab and generate that one. Both notes must be finalized and downloadable independently; neither overwrites the other. Verify via Supabase dashboard that the `initial_visit_notes` table has exactly two live rows for the case with distinct `visit_type` values.
13c. **Explicit visit type override**: on a case with imaging, manually switch to the Initial Visit tab and generate — the prompt must be the Initial Visit prompt even though diagnostics exist (explicit user choice beats auto-detection).
13d. **Prior visit reference**: after finalizing an Initial Visit note on a case, generate a Pain Evaluation Visit on the same case. Read the generated Pain Evaluation note — it should reference "initial evaluation" in History of the Accident, include interval-comparison language in Physical Examination, and cite conservative care attempted since the initial visit in Medical Necessity. The Physical Examination findings themselves should reflect the Pain Evaluation Visit intake data, not a verbatim copy of the Initial Visit findings.
14. Reset a draft note with intake data filled — verify intake data and ROM are preserved, AI-generated sections are cleared
15. Re-generate after reset — verify preserved intake data is used by the AI

## Performance Considerations

- The `provider_intake` JSONB is included in the serialized `inputData` sent to Claude — adds ~1-2KB to the prompt. Well within token limits.
- `buildSystemPrompt()` is a pure function, no performance concern
- Companion document generation is separate API calls — not blocking the main note generation

## Migration Notes

- The `provider_intake` column is nullable with no default — existing rows are unaffected
- The `visit_type` column has a default of `'initial_visit'`. **Existing `initial_visit_notes` rows are backfilled to `'initial_visit'`** automatically via the `DEFAULT`. This preserves clinician-written content without silently reclassifying any pre-migration note. Providers can regenerate in Pain Evaluation Visit mode after migration if they want the PRP-focused prompt for a specific case — this will create a second coexisting row, not overwrite the backfilled one.
- The old unique index `idx_initial_visit_notes_case_active` is replaced by `idx_initial_visit_notes_case_visit_type_active`. Existing rows are compatible because the new index allows one row per `(case_id, visit_type)` and each case has at most one existing row pre-migration.
- The `clinical_orders` table is new — no migration of existing data needed
- No changes to existing case summary or extraction workflows

## References

- Research document: [2026-03-26-initial-visit-no-prior-treatment-use-case.md](thoughts/shared/research/2026-03-26-initial-visit-no-prior-treatment-use-case.md)
- Original design research: [2026-03-09-epic-3-story-3.1-initial-visit-note-design.md](thoughts/shared/research/2026-03-09-epic-3-story-3.1-initial-visit-note-design.md)
- Case summary design: [2026-03-08-epic-2-story-2.3-clinical-case-summary-design.md](thoughts/shared/research/2026-03-08-epic-2-story-2.3-clinical-case-summary-design.md)
