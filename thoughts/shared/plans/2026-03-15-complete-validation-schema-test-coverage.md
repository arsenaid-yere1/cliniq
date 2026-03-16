# Complete Validation Schema Test Coverage

## Overview

Add unit tests for the 10 remaining untested Zod validation schemas, bringing validation layer coverage from 7/17 to 17/17. All tests follow the existing colocated `__tests__/` pattern with `safeParse` assertions.

## Current State Analysis

- **Vitest 4.1.0** installed, configured in `vitest.config.ts` (node env, globals enabled)
- **9 test files** already exist in `src/lib/constants/__tests__/` and `src/lib/validations/__tests__/`
- **Test pattern**: import schemas → create valid fixture → test valid/invalid/edge cases via `.safeParse()`
- **Zod v4** (`^4.3.6`) — uses same `.safeParse()` API as v3

### Already Tested (7/17):
- `patient.ts`, `attorney.ts`, `invoice.ts`, `document.ts`, `settings.ts`, `mri-extraction.ts`, `chiro-extraction.ts`

### Not Yet Tested (10/17):
- `pt-extraction.ts`, `pain-management-extraction.ts`, `orthopedic-extraction.ts`, `ct-scan-extraction.ts`
- `case-summary.ts`, `procedure-note.ts`, `initial-visit-note.ts`, `discharge-note.ts`
- `prp-procedure.ts`, `service-catalog.ts`

## Desired End State

All 17 validation schema files have corresponding test files in `src/lib/validations/__tests__/`. Each test file covers:
- Valid data acceptance (happy path)
- Nullable field handling
- Required field rejection (empty strings, missing fields)
- Enum validation where applicable
- Array `.min(1)` constraints on review/edit schemas
- Numeric range/coercion validation where applicable

### Verification:
```bash
npm test -- --reporter=verbose
```
All tests pass. No regressions in existing tests.

## What We're NOT Doing

- No component tests (would require jsdom + @testing-library/react)
- No server action tests (would require Supabase mocking)
- No AI extraction integration tests
- No coverage threshold configuration
- No CI/CD pipeline setup

## Implementation Approach

Follow the exact pattern from existing tests like `mri-extraction.test.ts` and `chiro-extraction.test.ts`:
1. Import all exported schemas/types/constants from the source file
2. Build a `validData` fixture that passes the schema
3. Test happy path, nullable fields, required field rejections, enum constraints, and array minimums

---

## Phase 1: Clinical Extraction Schema Tests

### Overview
Test the 4 untested clinical extraction schemas. These all follow the same dual-schema pattern: an AI extraction result schema (loose) and a provider review form schema (strict, with `.min(1)` on key fields).

### Changes Required:

#### 1. PT Extraction Tests
**File**: `src/lib/validations/__tests__/pt-extraction.test.ts` (new)
**Schemas to test**: `ptExtractionResultSchema`, `ptReviewFormSchema`
**Key test cases**:
- Valid extraction with all 12 sub-schema sections populated
- Nullable fields: `pain_rating` values, `measurement_type`, `side`, `grade` in sub-schemas
- Empty arrays accepted for optional collections (findings, tests, goals)
- `confidence` enum: accepts `high`, `medium`, `low`; rejects invalid
- Review form rejects empty strings on `.min(1)` fields (`region`, `movement`, `muscle_group`, `name`, `description`)

#### 2. Pain Management Extraction Tests
**File**: `src/lib/validations/__tests__/pain-management-extraction.test.ts` (new)
**Schemas to test**: `painManagementExtractionResultSchema`, `painManagementReviewFormSchema`
**Key test cases**:
- Valid extraction with chief complaints, physical exam regions, diagnoses, treatment plan
- Nullable fields: `pain_rating_min/max`, `type` in treatment plan items, `estimated_cost_min/max`
- `radiation`, `aggravating_factors`, `alleviating_factors` as string arrays
- ROM measurement nested inside physical exam regions
- Review form rejects empty `location` in chief complaints, empty `region` in physical exam

#### 3. Orthopedic Extraction Tests
**File**: `src/lib/validations/__tests__/orthopedic-extraction.test.ts` (new)
**Schemas to test**: `orthopedicExtractionResultSchema`, `orthopedicReviewFormSchema`
**Key test cases**:
- Valid extraction with patient demographics, complaints, medications, exam regions, diagnostics, diagnoses, recommendations
- Nullable fields: `radiation`, `pre_existing` boolean, `type` in recommendations, cost estimates
- `films_available` boolean in diagnostic studies
- Rich patient demographics fields (`patient_age`, `patient_sex`, `hand_dominance`, `height`, `weight`)
- Review form `.min(1)` constraints on `location`, `description`, `region`, `modality`, `body_region`

#### 4. CT Scan Extraction Tests
**File**: `src/lib/validations/__tests__/ct-scan-extraction.test.ts` (new)
**Schemas to test**: `ctScanFindingSchema`, `ctScanExtractionResultSchema`, `ctScanExtractionResponseSchema`, `ctScanReviewFormSchema`
**Key test cases**:
- Mirrors MRI pattern — `ctScanExtractionResponseSchema` requires `.min(1)` reports array
- `severity` enum: accepts `mild`, `moderate`, `severe`, `null`; rejects invalid
- Review form rejects empty `level` and `description` in findings
- Valid single and multiple report scenarios

### Success Criteria:

#### Automated Verification:
- [x] All Phase 1 tests pass: `npx vitest run src/lib/validations/__tests__/pt-extraction.test.ts src/lib/validations/__tests__/pain-management-extraction.test.ts src/lib/validations/__tests__/orthopedic-extraction.test.ts src/lib/validations/__tests__/ct-scan-extraction.test.ts`
- [x] No regressions: `npm test`
- [x] TypeScript compiles: `npx tsc --noEmit`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for confirmation before proceeding to Phase 2.

---

## Phase 2: Clinical Note Schema Tests

### Overview
Test the 3 clinical note schemas. These follow a section-based pattern: a const array of section keys, a label map, a result schema (loose strings), and an edit schema (`.min(1)` required strings).

### Changes Required:

#### 1. Procedure Note Tests
**File**: `src/lib/validations/__tests__/procedure-note.test.ts` (new)
**Exports to test**: `procedureNoteSections`, `procedureNoteSectionLabels`, `procedureNoteResultSchema`, `procedureNoteEditSchema`
**Key test cases**:
- `procedureNoteSections` has 22 entries (including `clinician_disclaimer`)
- `procedureNoteSectionLabels` has a label for every section
- Result schema accepts empty strings (AI may return empty sections)
- Edit schema rejects empty strings on all 21 section keys (`.min(1, 'Required')`)
- Valid data with all sections populated

#### 2. Initial Visit Note Tests
**File**: `src/lib/validations/__tests__/initial-visit-note.test.ts` (new)
**Exports to test**: `initialVisitSections`, `sectionLabels`, `initialVisitNoteResultSchema`, `initialVisitNoteEditSchema`, `initialVisitVitalsSchema`, `romMovementSchema`, `romRegionSchema`, `initialVisitRomSchema`, `defaultRomData`
**Key test cases**:
- Section arrays and labels consistency (15 sections)
- Result vs edit schema (empty string acceptance vs rejection)
- **Vitals schema**: numeric ranges — `bp_systolic` 1–300, `bp_diastolic` 1–200, `heart_rate` 1–300, `respiratory_rate` 1–60, `temperature_f` 90–110, `spo2_percent` 0–100; all nullable; reject out-of-range
- **ROM schemas**: `romMovementSchema` requires non-empty `movement`, `normal`/`actual` 0–360 int or null, `pain` boolean
- `romRegionSchema` requires non-empty `region` and `.min(1)` movements array
- **`defaultRomData`**: has 9 regions, each region has correct number of movements (cervical: 6, thoracic: 4, lumbar: 6, shoulders: 6 each, knees: 2 each, hips: 6 each), all `actual` values are null, all `pain` values are false
- `defaultRomData` passes `initialVisitRomSchema` validation

#### 3. Discharge Note Tests
**File**: `src/lib/validations/__tests__/discharge-note.test.ts` (new)
**Exports to test**: `dischargeNoteSections`, `dischargeNoteSectionLabels`, `dischargeNoteResultSchema`, `dischargeNoteEditSchema`
**Key test cases**:
- `dischargeNoteSections` has 13 entries
- `dischargeNoteSectionLabels` has a label for every section
- Result schema accepts empty strings
- Edit schema rejects empty strings on all 13 section keys
- Valid data with all sections populated

### Success Criteria:

#### Automated Verification:
- [x] All Phase 2 tests pass: `npx vitest run src/lib/validations/__tests__/procedure-note.test.ts src/lib/validations/__tests__/initial-visit-note.test.ts src/lib/validations/__tests__/discharge-note.test.ts`
- [x] No regressions: `npm test`
- [x] TypeScript compiles: `npx tsc --noEmit`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for confirmation before proceeding to Phase 3.

---

## Phase 3: Remaining Schema Tests

### Overview
Test the 3 remaining schemas: case summary (clinical AI), PRP procedure (complex nested form), and service catalog (simple CRUD form with coercion).

### Changes Required:

#### 1. Case Summary Tests
**File**: `src/lib/validations/__tests__/case-summary.test.ts` (new)
**Schemas to test**: `caseSummaryResultSchema`, `caseSummaryEditSchema`
**Key test cases**:
- Valid case summary with imaging findings, prior treatment, symptoms timeline, suggested diagnoses
- `severity` enum in imaging findings: `mild`, `moderate`, `severe`, `null`
- `confidence` enum in suggested diagnoses: `high`, `medium`, `low`
- Nested arrays: `key_findings: string[]`, `progression: [{date, description}]`, `pain_levels: [{date, level, context}]`, `gaps: [{from, to, days}]`
- Edit schema `.min(1)` constraints on `body_region`, `summary`, `description` in arrays
- Result schema accepts empty strings; edit schema rejects them

#### 2. PRP Procedure Tests
**File**: `src/lib/validations/__tests__/prp-procedure.test.ts` (new)
**Schema to test**: `prpProcedureFormSchema`
**Key test cases**:
- Valid complete PRP procedure form with all 6 sub-schemas populated
- Required fields: `procedure_date`, `injection_site`, `laterality`, `diagnoses` (min 1), `consent_obtained`
- `laterality` enum: `left`, `right`, `bilateral`; rejects invalid
- Diagnosis requires non-empty `icd10_code` and `description`
- **Vital signs**: same ranges as initial-visit vitals (1–300 systolic, etc.), all nullable
- **PRP preparation**: `blood_draw_volume_ml` must be positive, `centrifuge_duration_min` positive int or null
- **Anesthesia**: `anesthetic_agent` required non-empty, `patient_tolerance` enum or null
- **Injection**: `injection_volume_ml` positive, `guidance_method` enum (`ultrasound`/`fluoroscopy`/`landmark`), `target_confirmed_imaging` boolean or null
- **Post-procedure**: `complications` required non-empty, `compression_bandage` boolean or null, `activity_restriction_hrs` positive int or null
- `pain_rating` int 0–10 or null

#### 3. Service Catalog Tests
**File**: `src/lib/validations/__tests__/service-catalog.test.ts` (new)
**Schema to test**: `serviceCatalogItemSchema`
**Key test cases**:
- Valid item with `cpt_code`, `description`, `default_price`
- `default_price` coerces string `"150.00"` to number `150`
- `sort_order` coerces string `"1"` to int `1`
- `default_price` rejects negative numbers (`.min(0)`)
- `id` optional; when provided, must be UUID
- `cpt_code` and `description` reject empty strings

### Success Criteria:

#### Automated Verification:
- [x] All Phase 3 tests pass: `npx vitest run src/lib/validations/__tests__/case-summary.test.ts src/lib/validations/__tests__/prp-procedure.test.ts src/lib/validations/__tests__/service-catalog.test.ts`
- [x] No regressions: `npm test`
- [x] TypeScript compiles: `npx tsc --noEmit`

#### Manual Verification:
- [x] Run `npm run test:coverage` and confirm validation schema directory shows improved coverage

---

## Testing Strategy

### Pattern to Follow (from existing tests):
```typescript
import { describe, it, expect } from 'vitest'
import { someSchema } from '../some-schema'

describe('someSchema', () => {
  const validData = { /* complete valid fixture */ }

  it('accepts valid data', () => {
    expect(someSchema.safeParse(validData).success).toBe(true)
  })

  it('rejects empty required field', () => {
    const result = someSchema.safeParse({ ...validData, field: '' })
    expect(result.success).toBe(false)
  })

  it('accepts nullable field as null', () => {
    expect(someSchema.safeParse({ ...validData, field: null }).success).toBe(true)
  })
})
```

### Key Testing Patterns:
- **Dual schemas** (extraction + review): test that extraction schema is loose (accepts empty strings) while review schema is strict (rejects them)
- **Enum fields**: test all valid values and one invalid value
- **Numeric ranges**: test boundary values (min, max, min-1, max+1)
- **Coercion**: test string-to-number conversion with `z.coerce.number()`
- **Nested arrays with `.min(1)`**: test empty array rejection

## References

- Test coverage assessment: `thoughts/shared/research/2026-03-15-test-coverage-assessment.md`
- Existing test examples: `src/lib/validations/__tests__/mri-extraction.test.ts`, `src/lib/validations/__tests__/chiro-extraction.test.ts`
- Vitest config: `vitest.config.ts`
