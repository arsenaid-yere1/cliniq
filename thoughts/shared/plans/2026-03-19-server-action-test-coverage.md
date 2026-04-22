# Server Action Test Coverage — Implementation Plan

## Overview

Expand unit test coverage from validation schemas/constants (252 tests) to include server actions — the entire backend layer (23 files, ~120+ functions). Uses a hybrid approach: mock Supabase for action-level tests while keeping tests focused on business logic (auth guards, Zod validation, state machine transitions, precondition checks, error handling).

## Current State Analysis

- **19 test files, 252 tests** — all passing, covering Zod schemas and constants only
- **Zero server action tests** — no mocking infrastructure exists
- **Test runner**: Vitest 4.1, `environment: 'node'`, `globals: true`
- **No test utilities, mocks, or setup files** exist anywhere in the project
- All server actions depend on `createClient()` from `@/lib/supabase/server` (async, returns Supabase client)
- All write actions call `revalidatePath()` from `next/cache`
- Pattern: `createClient()` → `auth.getUser()` → Zod validate → DB query → `revalidatePath()`

### Key Discoveries:
- `createClient` (`src/lib/supabase/server.ts:4`) uses Next.js `cookies()` — must be mocked at module level
- `revalidatePath` (`next/cache`) — must be mocked (no-op in test context)
- Server actions use `'use server'` directive — Vitest ignores this, so actions are importable as regular async functions
- No formal return type union — actions return `{ data }`, `{ error }`, or `{ success }` ad-hoc
- `assertCaseNotClosed` and `autoAdvanceFromIntake` accept a pre-built supabase client as parameter (easier to test)
- `transitionInvoiceStatus` in `invoice-status.ts` is a private (non-exported) helper — must be tested through public wrappers

## Desired End State

- **Test infrastructure**: A reusable Supabase mock helper and common test fixtures
- **Server action coverage**: Tests for case-status, invoice-status, attorneys, patients, service-catalog actions
- **What's tested**: Auth guards, Zod validation paths, state machine transitions, precondition checks, error returns, soft delete behavior, audit field stamping
- **What's NOT tested**: Actual DB queries (that's integration testing), Claude AI calls, PDF generation, Storage operations

### Verification:
- `npm run test` passes with all new + existing tests
- `npx tsc --noEmit` passes (type-safe mocks)
- Each phase adds tests that can run independently

## What We're NOT Doing

- **Integration tests** against a real Supabase instance
- **Component tests** (would require jsdom + @testing-library/react)
- **AI extraction/generation action tests** (require complex Claude API mocking — low ROI for unit tests)
- **PDF render tests** (dynamic imports, binary output)
- **Hook or middleware tests** (minimal logic, better suited for e2e)
- **Refactoring action return types** into a formal union (separate task)

## Implementation Approach

Create a lightweight Supabase mock using `vi.mock` that simulates the chainable query builder pattern (`.from().select().eq().single()` etc.). Each test controls what the mock returns. Keep mocks minimal — only mock what each test needs.

---

## Phase 1: Test Infrastructure

### Overview
Set up the Supabase mock helper, `next/cache` mock, and shared test fixtures that all action tests will use.

### Changes Required:

#### 1. Supabase Mock Helper
**File**: `src/test-utils/supabase-mock.ts` (new)
**Purpose**: Provide a factory that creates a mock Supabase client with chainable query builder methods.

```ts
import { vi } from 'vitest'

// Chainable query builder mock — each method returns `this` for chaining
export function createMockQueryBuilder(resolveValue: { data: unknown; error: unknown } = { data: null, error: null }) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {}
  const methods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
    'like', 'ilike', 'is', 'in', 'or', 'not',
    'order', 'limit', 'range', 'single', 'maybeSingle',
  ]

  for (const method of methods) {
    builder[method] = vi.fn()
  }

  // Terminal methods resolve the promise
  builder.single!.mockResolvedValue(resolveValue)
  builder.maybeSingle!.mockResolvedValue(resolveValue)

  // Non-terminal methods return builder for chaining
  for (const method of methods) {
    if (method !== 'single' && method !== 'maybeSingle') {
      builder[method]!.mockReturnValue(builder)
    }
  }

  // select/insert/update/delete without .single() also resolve
  // Override the default return for these to be thenable
  const thenableBuilder = Object.assign(builder, {
    then: (resolve: (value: unknown) => void) => resolve(resolveValue),
  })

  return thenableBuilder
}

export function createMockSupabase() {
  const queryBuilder = createMockQueryBuilder()

  return {
    from: vi.fn().mockReturnValue(queryBuilder),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'test-user-id' } },
        error: null,
      }),
    },
    _queryBuilder: queryBuilder, // escape hatch for test-specific overrides
  }
}
```

#### 2. Module-level Mocks Setup
**File**: `src/test-utils/setup-action-mocks.ts` (new)
**Purpose**: Provide `vi.mock` calls for `@/lib/supabase/server` and `next/cache` that action test files import.

```ts
import { vi } from 'vitest'
import { createMockSupabase } from './supabase-mock'

// Mock next/cache
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// Mock Supabase — export the mock instance so tests can configure it
export const mockSupabase = createMockSupabase()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue(mockSupabase),
}))
```

#### 3. Shared Test Fixtures
**File**: `src/test-utils/fixtures.ts` (new)
**Purpose**: Common valid data objects used across action tests.

```ts
export const TEST_USER_ID = 'test-user-id'
export const TEST_CASE_ID = '550e8400-e29b-41d4-a716-446655440000'
export const TEST_PATIENT_ID = '660e8400-e29b-41d4-a716-446655440000'
export const TEST_ATTORNEY_ID = '770e8400-e29b-41d4-a716-446655440000'
export const TEST_PROVIDER_ID = '880e8400-e29b-41d4-a716-446655440000'
export const TEST_INVOICE_ID = '990e8400-e29b-41d4-a716-446655440000'

export const validAttorneyData = {
  first_name: 'Sarah',
  last_name: 'Connor',
  firm_name: 'Connor & Associates',
  email: 'sarah@connor.law',
  phone: '555-0100',
}

export const validPatientCaseData = {
  first_name: 'John',
  last_name: 'Doe',
  date_of_birth: '1990-01-15',
  attorney_id: TEST_ATTORNEY_ID,
  assigned_provider_id: TEST_PROVIDER_ID,
  lien_on_file: false,
}

export const validServiceCatalogItem = {
  cpt_code: '99213',
  description: 'Office visit - established patient',
  default_price: 150,
}
```

### Success Criteria:

#### Automated Verification:
- [ ] `npx tsc --noEmit` — mock files type-check cleanly
- [ ] `npm run test` — existing 252 tests still pass (no regressions)
- [ ] Mock helper can be imported and instantiated without errors

#### Manual Verification:
- [ ] Review mock helper covers the Supabase chainable API patterns used in the codebase

**Implementation Note**: After completing this phase and all automated verification passes, pause here for confirmation before proceeding.

---

## Phase 2: Case Status Action Tests

### Overview
Test `assertCaseNotClosed`, `updateCaseStatus`, `autoAdvanceFromIntake`, `closeCase`, and `reopenCase`. These are the most critical actions — `assertCaseNotClosed` is a guard imported by ~15 other action files.

### Changes Required:

#### 1. Case Status Tests
**File**: `src/actions/__tests__/case-status.test.ts` (new)

**Test cases for `assertCaseNotClosed`:**
- Returns `{ error: null }` when case status is `'intake'`
- Returns `{ error: null }` when case status is `'active'`
- Returns error string when case status is `'closed'`
- Returns error string when case status is `'archived'`
- Returns `{ error: null }` when case is not found (data is null)

**Test cases for `updateCaseStatus`:**
- Returns error when user is not authenticated
- Returns error when case is not found
- Returns error for same-status transition (e.g., `active` → `active`)
- Returns error for disallowed transition (e.g., `intake` → `pending_settlement`)
- Returns error when transitioning to `pending_settlement` without a medical invoice (`invoice_type='visit'`)
- Returns error when transitioning to `closed` without a medical invoice (`invoice_type='visit'`)
- Returns `{ data: { success: true } }` for valid `intake` → `active` transition
- Returns `{ data: { success: true } }` for valid `active` → `closed` with medical invoice present
- Sets `case_close_date` when transitioning to `closed`
- Clears `case_close_date` when transitioning from `closed` to `active`
- Inserts case_status_history record on success

**Test cases for `autoAdvanceFromIntake`:**
- Updates case to `'active'` when current status is `'intake'`
- Does nothing when current status is not `'intake'`
- Inserts history record with auto-advance note

**Test cases for `closeCase` / `reopenCase`:**
- `closeCase` delegates to `updateCaseStatus` with `'closed'`
- `reopenCase` delegates to `updateCaseStatus` with `'active'`

### Success Criteria:

#### Automated Verification:
- [ ] `npm run test src/actions/__tests__/case-status.test.ts` — all tests pass
- [ ] `npx tsc --noEmit` — no type errors
- [ ] `npm run test` — full suite passes including new + existing tests

#### Manual Verification:
- [ ] Review test coverage adequately exercises the transition matrix and guard logic

**Implementation Note**: After completing this phase and all automated verification passes, pause here for confirmation before proceeding.

---

## Phase 3: Invoice Status Action Tests

### Overview
Test `transitionInvoiceStatus` (via public wrappers), `issueInvoice`, `markInvoicePaid`, `voidInvoice`, `markInvoiceOverdue`, `writeOffInvoice`, and `getInvoiceStatusHistory`.

### Changes Required:

#### 1. Invoice Status Tests
**File**: `src/actions/__tests__/invoice-status.test.ts` (new)

**Test cases for `issueInvoice`:**
- Returns error when invoice has no line items
- Succeeds when invoice has line items and status is `'draft'`
- Returns error when current status doesn't allow transition to `'issued'`

**Test cases for `voidInvoice`:**
- Returns error when reason is empty/missing
- Returns error when reason is whitespace only
- Succeeds with valid reason from `'draft'` status
- Succeeds with valid reason from `'issued'` status

**Test cases for `writeOffInvoice`:**
- Returns error when reason is empty
- Succeeds from `'overdue'` status

**Test cases for `markInvoicePaid`:**
- Succeeds from `'issued'` status
- Succeeds from `'overdue'` status
- Returns error from `'draft'` status (not in allowed transitions)

**Test cases for `markInvoiceOverdue`:**
- Succeeds from `'issued'` status
- Returns error from `'draft'` status

**Test cases for transition validation (tested through wrappers):**
- Cannot transition from terminal statuses (`paid`, `void`, `uncollectible`)
- Returns error when invoice not found
- Returns error when user not authenticated

**Test cases for `getInvoiceStatusHistory`:**
- Returns history records ordered by `changed_at` descending
- Returns empty array when no history exists
- Returns error on DB failure

### Success Criteria:

#### Automated Verification:
- [ ] `npm run test src/actions/__tests__/invoice-status.test.ts` — all tests pass
- [ ] `npx tsc --noEmit` — no type errors
- [ ] `npm run test` — full suite passes

#### Manual Verification:
- [ ] Review test coverage exercises all 6 statuses and transition boundaries

**Implementation Note**: After completing this phase and all automated verification passes, pause here for confirmation before proceeding.

---

## Phase 4: CRUD Action Tests — Attorneys

### Overview
Test `createAttorney`, `updateAttorney`, `deleteAttorney`, `getAttorney`, `listAttorneys`. Simplest CRUD pattern — validates the mock infrastructure works for standard operations.

### Changes Required:

#### 1. Attorney Action Tests
**File**: `src/actions/__tests__/attorneys.test.ts` (new)

**Test cases for `createAttorney`:**
- Returns field errors for invalid data (empty first_name)
- Returns error when user not authenticated
- Returns `{ data: attorney }` on success
- Stamps `created_by_user_id` and `updated_by_user_id`

**Test cases for `updateAttorney`:**
- Returns field errors for invalid data
- Returns error when user not authenticated
- Returns `{ data: attorney }` on success
- Only stamps `updated_by_user_id`

**Test cases for `deleteAttorney`:**
- Returns error when user not authenticated
- Soft-deletes by setting `deleted_at`
- Returns `{ success: true }`

**Test cases for `getAttorney`:**
- Returns attorney data when found
- Returns error when not found
- Filters out soft-deleted records (`.is('deleted_at', null)`)

**Test cases for `listAttorneys`:**
- Returns list of attorneys
- Applies search filter when provided
- Returns empty array when none found

### Success Criteria:

#### Automated Verification:
- [ ] `npm run test src/actions/__tests__/attorneys.test.ts` — all tests pass
- [ ] `npx tsc --noEmit` — no type errors
- [ ] `npm run test` — full suite passes

#### Manual Verification:
- [ ] Review test patterns can be replicated for other CRUD action files

**Implementation Note**: After completing this phase and all automated verification passes, pause here for confirmation before proceeding.

---

## Phase 5: CRUD Action Tests — Patients & Service Catalog

### Overview
Test the more complex CRUD actions: `createPatientCase` (multi-step insert), `checkDuplicatePatient`, `updatePatient`, `updateCase`, and all service-catalog actions.

### Changes Required:

#### 1. Patient Action Tests
**File**: `src/actions/__tests__/patients.test.ts` (new)

**Test cases for `checkDuplicatePatient`:**
- Returns empty duplicates array when no match
- Returns matching records when duplicates exist

**Test cases for `createPatientCase`:**
- Returns field errors for invalid data (missing required fields)
- Returns error when user not authenticated
- Inserts patient, then case, then case_status_history (3 sequential inserts)
- Sets initial `case_status: 'intake'`
- Returns error if patient insert fails
- Returns error if case insert fails (after patient succeeds)

**Test cases for `updatePatient`:**
- Validates input with Zod before updating
- Returns error when not authenticated
- Filters by `deleted_at` is null on update

**Test cases for `updateCase`:**
- Updates case fields including `attorney_id`, `assigned_provider_id`
- Returns error when not authenticated

#### 2. Service Catalog Action Tests
**File**: `src/actions/__tests__/service-catalog.test.ts` (new)

**Test cases for `createServiceCatalogItem`:**
- Computes next sort_order from existing max + 1
- Defaults sort_order to 1 when no items exist
- Returns created item

**Test cases for `updateServiceCatalogItem`:**
- Updates only `cpt_code`, `description`, `default_price`
- Does NOT update `sort_order`

**Test cases for `deleteServiceCatalogItem`:**
- Soft-deletes by setting `deleted_at`

**Test cases for `getServiceCatalogPriceMap`:**
- Returns `Record<string, number>` keyed by `cpt_code`
- Returns empty object when no items

### Success Criteria:

#### Automated Verification:
- [ ] `npm run test src/actions/__tests__/patients.test.ts` — all tests pass
- [ ] `npm run test src/actions/__tests__/service-catalog.test.ts` — all tests pass
- [ ] `npx tsc --noEmit` — no type errors
- [ ] `npm run test` — full suite passes (all ~252 existing + all new tests)

#### Manual Verification:
- [ ] Review that multi-step `createPatientCase` tests verify sequential insert behavior
- [ ] Confirm mock patterns are consistent across all action test files

**Implementation Note**: After completing this phase and all automated verification passes, pause here for confirmation before proceeding.

---

## Testing Strategy

### Unit Tests (this plan):
- Mock Supabase at module level — test action logic, not DB queries
- Focus on: auth guards, input validation, state transitions, error paths, return shapes
- Each action file gets a corresponding `__tests__/[action-name].test.ts`

### What Each Test Validates:
1. **Auth guard** — unauthenticated user gets error
2. **Zod validation** — invalid input returns field errors before DB call
3. **Business logic** — state machine transitions, precondition checks
4. **Error handling** — DB errors, not-found cases
5. **Return shape** — correct `{ data }` / `{ error }` / `{ success }` shape

### Not Covered (future work):
- Integration tests with real Supabase (separate test environment)
- Component tests (need jsdom + testing-library)
- AI extraction/generation tests (need Claude mock)
- E2E tests (need Playwright or Cypress)

## Performance Considerations

- All tests are pure unit tests with mocked I/O — should run in < 3 seconds total
- No database, network, or file system access
- Existing test duration is 1.97s for 252 tests — expect ~3-4s with new tests added

## References

- Test coverage assessment: `thoughts/shared/research/2026-03-19-test-coverage-assessment.md`
- Existing test patterns: `src/lib/validations/__tests__/` and `src/lib/constants/__tests__/`
- Vitest config: `vitest.config.ts`
- Server actions: `src/actions/` (23 files)
- Supabase client: `src/lib/supabase/server.ts`
