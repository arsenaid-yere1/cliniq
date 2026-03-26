# Initial Visit Note — No Prior Treatment Support

## Overview

Enable Initial Visit note generation for patients with no prior clinical records. Currently, a two-gate prerequisite chain (extractions -> case summary -> note) completely blocks generation for "fresh" patients — the most common real-world use case. This plan removes the hard case summary gate, adds 5 pre-generation provider intake forms, implements dual-mode prompt auto-detection (First Visit vs PRP Evaluation), and adds companion document generation (Imaging Orders, Chiropractic Therapy Order).

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
   - **Mode A (First Visit)**: No imaging findings -> conservative assessment note with imaging orders and therapy referrals
   - **Mode B (PRP Evaluation)**: Imaging findings present -> current PRP-focused note (existing behavior)
4. Companion documents (Imaging Orders, Chiropractic Therapy Order) can be generated from the finalized Initial Visit note data
5. Existing PRP evaluation workflow is **unchanged** — this is purely additive

### How to Verify
- Create a new case with only patient demographics and accident details (no documents uploaded)
- Fill out all 7 pre-generation tabs (vitals, ROM, chief complaints, accident details, PMH, social history, exam findings)
- Generate the note — should produce a clinically complete First Visit note with conservative treatment plan, imaging orders mentioned, and clinical impression diagnoses
- Finalize the note and generate companion documents (Imaging Orders, Chiro Order)
- Create a case WITH an approved case summary containing imaging findings — note should auto-detect as Mode B and produce the existing PRP-focused format

## What We're NOT Doing

- **Not changing the case summary system** — Gate 1 (extractions required for case summary) stays as-is
- **Not removing case summary enrichment** — when a case summary exists, it still enriches the note
- **Not changing the existing PRP evaluation prompt** — Mode B preserves current behavior exactly
- **Not building a structured accident intake form** — we use a single textarea for accident narrative (the existing `accident_description` field), enhanced with a few structured fields (seatbelt, airbag, consciousness, ER visit) stored in `provider_intake`
- **Not auto-generating companion documents** — they are manually triggered after note finalization

## Implementation Approach

The changes touch 4 layers: database schema, server actions (gate removal + new save/load), AI prompt (dual-mode), and UI (5 new intake tabs + companion doc generation). We phase by dependency order: schema first, then gates, then intake forms, then prompt, then companion docs.

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

-- Create clinical_orders table for companion documents
CREATE TABLE IF NOT EXISTS clinical_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES cases(id),
  initial_visit_note_id uuid REFERENCES initial_visit_notes(id),
  order_type text NOT NULL CHECK (order_type IN ('imaging', 'chiropractic_therapy')),
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
- [ ] `provider_intake` column exists on `initial_visit_notes` in Supabase dashboard
- [ ] `clinical_orders` table exists with correct columns and constraints
- [ ] RLS policies are active on `clinical_orders`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Remove Prerequisites Gate

### Overview
Make the case summary optional for Initial Visit note generation. When a case summary exists and is approved, use it to enrich the note (existing behavior). When no case summary exists, pass null fields and let the AI generate from provider intake + demographics.

### Changes Required:

#### 1. Update `gatherSourceData()` — Make Case Summary Optional
**File**: [initial-visit-notes.ts:20-128](src/actions/initial-visit-notes.ts#L20-L128)

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

#### 2. Add `provider_intake` to `gatherSourceData()` Return and `InitialVisitInputData`
**File**: [initial-visit-notes.ts:20-128](src/actions/initial-visit-notes.ts#L20-L128)

Add a query for the `provider_intake` column from the `initial_visit_notes` row (if one exists). This is needed so the AI can use the provider's intake data.

```typescript
// Add to the Promise.all block — query for existing note's provider_intake
supabase
  .from('initial_visit_notes')
  .select('provider_intake')
  .eq('case_id', caseId)
  .is('deleted_at', null)
  .order('created_at', { ascending: false })
  .limit(1)
  .maybeSingle(),
```

Add `providerIntake` to the returned `inputData`:
```typescript
providerIntake: intakeRes.data?.provider_intake ?? null,
```

**File**: [generate-initial-visit.ts:219-278](src/lib/claude/generate-initial-visit.ts#L219-L278)

Add `providerIntake` to the `InitialVisitInputData` interface:
```typescript
providerIntake: {
  chief_complaints: unknown
  accident_details: unknown
  past_medical_history: unknown
  social_history: unknown
  exam_findings: unknown
} | null
```

#### 3. Update `checkNotePrerequisites()` — Remove Case Summary Requirement
**File**: [initial-visit-notes.ts:510-529](src/actions/initial-visit-notes.ts#L510-L529)

Replace the case summary check with a minimal data check — at minimum, the case must exist and have a patient linked.

```typescript
export async function checkNotePrerequisites(caseId: string) {
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

#### 4. Update Page Component — Load Provider Intake
**File**: [page.tsx](src/app/(dashboard)/patients/[caseId]/initial-visit/page.tsx)

Add `getProviderIntake(caseId)` to the parallel fetch and pass `initialIntake` to `InitialVisitEditor`.

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `npm run typecheck`
- [x] No linting errors: `npm run lint`
- [x] Existing tests pass (if any)

#### Manual Verification:
- [ ] On a case with NO case summary: the "Generate" button is **enabled** (no prerequisite warning)
- [ ] On a case WITH an approved case summary: generation still works and uses the summary data
- [ ] The `provider_intake` field is fetched and passed to the editor

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

**`saveProviderIntake(caseId, intake)`**: Validates against `providerIntakeSchema`, then upserts the `provider_intake` column on the `initial_visit_notes` row (same pattern as `saveInitialVisitRom` — update existing row or insert a new draft row with only `provider_intake` populated).

**`getProviderIntake(caseId)`**: Reads `provider_intake` from the active `initial_visit_notes` row. Returns null if no row exists or `provider_intake` is null.

Follow the exact patterns from `saveInitialVisitRom` ([initial-visit-notes.ts:624-675](src/actions/initial-visit-notes.ts#L624-L675)) and `getInitialVisitRom` ([initial-visit-notes.ts:605-622](src/actions/initial-visit-notes.ts#L605-L622)).

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `npm run typecheck`
- [x] No linting errors: `npm run lint`
- [ ] Schema validation tests pass for all 5 intake sections

#### Manual Verification:
- [ ] `saveProviderIntake` writes to DB correctly (check Supabase dashboard)
- [ ] `getProviderIntake` returns saved data

**Implementation Note**: After completing this phase, pause for manual confirmation before proceeding to Phase 4.

---

## Phase 4: Provider Intake UI

### Overview
Add 5 new tab panels to the pre-generation state in `InitialVisitEditor`, following the existing VitalSignsCard/RomInputCard pattern exactly.

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

Add `initialIntake: ProviderIntakeValues | null` prop to `InitialVisitEditor`. Initialize the intake form with `initialIntake ?? defaultProviderIntake`.

**File**: [page.tsx](src/app/(dashboard)/patients/[caseId]/initial-visit/page.tsx)

Load `getProviderIntake(caseId)` in the page's `Promise.all` and pass as `initialIntake` prop.

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `npm run typecheck`
- [x] No linting errors: `npm run lint`

#### Manual Verification:
- [ ] All 7 tabs render correctly in the pre-generation state
- [ ] Each card saves independently and persists on page reload
- [ ] Form defaults are sensible for a fresh case
- [ ] Adding/removing array entries (complaints, exam regions) works
- [ ] Conditional fields (ER details) show/hide correctly

**Implementation Note**: After completing this phase, pause for manual confirmation before proceeding to Phase 5.

---

## Phase 5: Dual-Mode System Prompt

### Overview
Update the system prompt to auto-detect and generate two distinct note modes based on data availability. Mode A (First Visit / Acute Evaluation) produces conservative assessment notes. Mode B (PRP Evaluation) preserves the existing prompt behavior.

### Changes Required:

#### 1. Mode Detection Logic
**File**: [generate-initial-visit.ts](src/lib/claude/generate-initial-visit.ts)

Add a helper function:

```typescript
function detectNoteMode(inputData: InitialVisitInputData): 'first_visit' | 'prp_evaluation' {
  const hasImagingFindings = inputData.caseSummary?.imaging_findings != null
    && Array.isArray(inputData.caseSummary.imaging_findings)
    && (inputData.caseSummary.imaging_findings as unknown[]).length > 0

  return hasImagingFindings ? 'prp_evaluation' : 'first_visit'
}
```

#### 2. Dual-Mode System Prompt
**File**: [generate-initial-visit.ts:11-124](src/lib/claude/generate-initial-visit.ts#L11-L124)

The `SYSTEM_PROMPT` constant becomes a function that takes the mode and returns the appropriate prompt. The structure:

```typescript
function buildSystemPrompt(mode: 'first_visit' | 'prp_evaluation'): string {
  const COMMON_RULES = `...` // Global rules, PDF formatting, sections 1, 4-8, 10, 15, 16 (unchanged)

  if (mode === 'first_visit') {
    return `${COMMON_RULES}\n\n${FIRST_VISIT_SECTIONS}`
  }
  return `${COMMON_RULES}\n\n${PRP_EVALUATION_SECTIONS}`
}
```

**Sections that differ by mode:**

| Section | Mode A (First Visit) | Mode B (PRP Evaluation) |
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
- 8. Physical Examination
- 15. Time and Complexity Attestation
- 16. Clinician Disclaimer

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

#### 4. Update Tool Descriptions
**File**: [generate-initial-visit.ts:126-216](src/lib/claude/generate-initial-visit.ts#L126-L216)

Update the `INITIAL_VISIT_TOOL` property descriptions for sections that vary by mode. For example, `imaging_findings` description should mention both possibilities: "MRI findings by region with specific measurements OR 'Ordered — results pending' for pending imaging."

#### 5. Pass Mode to API Call
**File**: [generate-initial-visit.ts:281-325](src/lib/claude/generate-initial-visit.ts#L281-L325)

```typescript
export async function generateInitialVisitFromData(
  inputData: InitialVisitInputData,
  toneHint?: string | null,
): Promise<...> {
  const mode = detectNoteMode(inputData)
  const systemPrompt = buildSystemPrompt(mode)

  // ... rest of function uses systemPrompt instead of SYSTEM_PROMPT
}
```

Also update `regenerateSection()` ([generate-initial-visit.ts:344-380](src/lib/claude/generate-initial-visit.ts#L344-L380)) to detect mode and use the correct prompt.

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles: `npm run typecheck`
- [ ] No linting errors: `npm run lint`

#### Manual Verification:
- [ ] **Mode A test**: Case with no case summary, provider intake filled out -> generates First Visit note with conservative treatment plan, "Ordered — results pending" imaging, clinical impression diagnoses, no PRP
- [ ] **Mode B test**: Case with approved case summary containing imaging findings -> generates PRP evaluation note (current behavior unchanged)
- [ ] Section regeneration works correctly in both modes
- [ ] Tone hint still works in both modes

**Implementation Note**: After completing this phase, pause for manual confirmation before proceeding to Phase 6.

---

## Phase 6: Companion Document Generation

### Overview
Add Imaging Orders and Chiropractic Therapy Order generation, triggered manually after the Initial Visit note is finalized. These companion documents use ICD-10 codes and clinical data from the note.

### Changes Required:

#### 1. Companion Document AI Generation
**File**: `src/lib/claude/generate-clinical-orders.ts` (new file)

Two generation functions:

**`generateImagingOrders(inputData)`**:
- Input: patient info, diagnoses from note, affected body regions, provider info, clinic info
- Output: structured order with fields: `patient_name`, `date_of_order`, `ordering_provider`, `ordering_provider_npi`, `clinic_info`, `orders` (array of `{ body_region, modality: 'MRI', icd10_codes: string[], clinical_indication }`)
- Uses claude-sonnet-4-6 with a forced tool call
- System prompt: "Generate imaging orders based on the Initial Visit note findings. Each order should include the body region, imaging modality, relevant ICD-10 codes from the diagnoses, and clinical indication."

**`generateChiropracticOrder(inputData)`**:
- Input: patient info, diagnoses from note, chief complaints, treatment plan text, provider info, clinic info
- Output: structured order with fields: `patient_name`, `date_of_order`, `referring_provider`, `referring_provider_npi`, `clinic_info`, `diagnoses` (ICD-10 list), `treatment_plan` (frequency, duration, modalities, goals), `special_instructions`, `precautions`
- Uses claude-sonnet-4-6 with a forced tool call

#### 2. Zod Schemas for Companion Documents
**File**: `src/lib/validations/clinical-orders.ts` (new file)

```typescript
export const imagingOrderResultSchema = z.object({
  patient_name: z.string(),
  date_of_order: z.string(),
  ordering_provider: z.string(),
  ordering_provider_npi: z.string().nullable(),
  orders: z.array(z.object({
    body_region: z.string(),
    modality: z.string(),
    icd10_codes: z.array(z.string()),
    clinical_indication: z.string(),
  })),
})

export const chiropracticOrderResultSchema = z.object({
  patient_name: z.string(),
  date_of_order: z.string(),
  referring_provider: z.string(),
  referring_provider_npi: z.string().nullable(),
  diagnoses: z.array(z.object({
    code: z.string(),
    description: z.string(),
  })),
  treatment_plan: z.object({
    frequency: z.string(),
    duration: z.string(),
    modalities: z.array(z.string()),
    goals: z.array(z.string()),
  }),
  special_instructions: z.string().nullable(),
  precautions: z.string().nullable(),
})
```

#### 3. Server Actions
**File**: `src/actions/clinical-orders.ts` (new file)

- **`generateImagingOrder(caseId)`**: Reads the finalized note, extracts diagnoses and regions, calls `generateImagingOrders()`, writes to `clinical_orders` table
- **`generateChiropracticOrder(caseId)`**: Same pattern for chiro order
- **`getClinicalOrders(caseId)`**: Lists all non-deleted orders for a case
- **`finalizeClinicalOrder(orderId)`**: Generates PDF, uploads to storage, creates document record (same pattern as `finalizeInitialVisitNote`)

#### 4. UI — Companion Documents Tab
**File**: [initial-visit-editor.tsx](src/components/clinical/initial-visit-editor.tsx)

In the **finalized** view (`FinalizedView`), add a "Companion Documents" section below the existing content:

- "Generate Imaging Orders" button (disabled if already generated)
- "Generate Chiropractic Therapy Order" button (disabled if already generated)
- List of generated orders with status, preview, and "Download PDF" buttons
- Each order shows as a Card with the order type, status badge, and action buttons

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles: `npm run typecheck`
- [ ] No linting errors: `npm run lint`
- [ ] Schema validation tests pass for order schemas

#### Manual Verification:
- [ ] After finalizing an Initial Visit note, companion document buttons appear
- [ ] Imaging Orders generate with correct ICD-10 codes from the note
- [ ] Chiropractic Order generates with correct diagnoses and treatment plan
- [ ] Generated orders can be finalized and downloaded as PDFs

**Implementation Note**: After completing this phase, pause for manual confirmation before proceeding to Phase 7.

---

## Phase 7: Companion Document PDF Templates

### Overview
Create PDF templates for Imaging Orders and Chiropractic Therapy Orders following the existing React-PDF pattern.

### Changes Required:

#### 1. Imaging Orders PDF
**File**: `src/lib/pdf/imaging-orders-template.tsx` (new file)
**File**: `src/lib/pdf/render-imaging-orders-pdf.ts` (new file)

Follow the pattern from [initial-visit-template.tsx](src/lib/pdf/initial-visit-template.tsx) and [render-initial-visit-pdf.ts](src/lib/pdf/render-initial-visit-pdf.ts).

Template structure:
- Clinic header (logo, address, phone/fax) — reuse from initial visit template
- "IMAGING ORDERS" title
- Patient info block (name, DOB, date of order)
- For each order: body region, modality, ICD-10 codes, clinical indication
- Ordering provider signature block

#### 2. Chiropractic Therapy Order PDF
**File**: `src/lib/pdf/chiropractic-order-template.tsx` (new file)
**File**: `src/lib/pdf/render-chiropractic-order-pdf.ts` (new file)

Template structure:
- Clinic header
- "CHIROPRACTIC THERAPY ORDER" title
- Patient info block
- Diagnoses list with ICD-10 codes
- Treatment plan: frequency, duration, modalities, goals
- Special instructions and precautions
- Referring provider signature block

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles: `npm run typecheck`
- [ ] No linting errors: `npm run lint`

#### Manual Verification:
- [ ] Imaging Orders PDF renders correctly with clinic header, patient info, and orders
- [ ] Chiropractic Order PDF renders correctly with all sections
- [ ] PDFs are downloadable and display properly in browser
- [ ] Signature images render (when available)

**Implementation Note**: This is the final phase. Verify the complete end-to-end workflow: create case -> fill intake forms -> generate First Visit note -> finalize -> generate companion documents -> download PDFs.

---

## Testing Strategy

### Unit Tests:
- Zod schema validation for all 5 provider intake sections (valid data, missing required fields, boundary values)
- Zod schema validation for imaging order and chiropractic order results
- `detectNoteMode()` function: returns `'first_visit'` when no imaging, `'prp_evaluation'` when imaging exists
- `buildSystemPrompt()` returns different content for each mode

### Integration Tests:
- `gatherSourceData()` returns valid `InitialVisitInputData` with null `caseSummary` fields when no summary exists
- `gatherSourceData()` returns enriched data when case summary exists
- `saveProviderIntake()` / `getProviderIntake()` round-trip
- `checkNotePrerequisites()` returns `canGenerate: true` for cases without case summaries

### Manual Testing Steps:
1. Create a new case with patient demographics and accident description only
2. Navigate to Initial Visit page — verify no prerequisite warning, generate button enabled
3. Fill out all 7 pre-generation tabs, save each
4. Generate note — verify Mode A output (conservative, no PRP, ordered imaging)
5. Edit sections, regenerate individual sections — verify mode consistency
6. Finalize note — verify PDF renders correctly
7. Generate companion documents — verify correct ICD-10 codes flow through
8. Download companion PDFs — verify rendering
9. Test Mode B: create case with approved case summary containing imaging — verify PRP evaluation note (no regression)

## Performance Considerations

- The `provider_intake` JSONB is included in the serialized `inputData` sent to Claude — adds ~1-2KB to the prompt. Well within token limits.
- `buildSystemPrompt()` is a pure function, no performance concern
- Companion document generation is separate API calls — not blocking the main note generation

## Migration Notes

- The `provider_intake` column is nullable with no default — existing rows are unaffected
- The `clinical_orders` table is new — no migration of existing data needed
- No changes to existing case summary or extraction workflows

## References

- Research document: [2026-03-26-initial-visit-no-prior-treatment-use-case.md](thoughts/shared/research/2026-03-26-initial-visit-no-prior-treatment-use-case.md)
- Original design research: [2026-03-09-epic-3-story-3.1-initial-visit-note-design.md](thoughts/shared/research/2026-03-09-epic-3-story-3.1-initial-visit-note-design.md)
- Case summary design: [2026-03-08-epic-2-story-2.3-clinical-case-summary-design.md](thoughts/shared/research/2026-03-08-epic-2-story-2.3-clinical-case-summary-design.md)
