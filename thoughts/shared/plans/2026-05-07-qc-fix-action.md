# QC Fix Action Implementation Plan

## Overview

Add a `Fix` action to Quality Review findings that auto-regenerates the affected note section via AI using the finding's message and rationale as a structured fix instruction, then runs a full QC recheck. The recheck's existing carry-over logic auto-flips disappeared findings to `resolved` with `resolution_source: 'auto_recheck'`. The provider gets a single-button workflow: click Fix → AI rewrites the section → QC re-runs → finding either marked resolved (gone) or returns to pending (still present).

## Current State Analysis

QC and note regeneration are two isolated systems sharing no call path. The QC layer at [src/actions/case-quality-reviews.ts](src/actions/case-quality-reviews.ts) exposes five override mutators (acknowledge, dismiss, edit, clear, mark-resolved) plus `verifyFinding` (deterministic-only) and `runCaseQualityReview` (full chain recheck with carry-over override merge). Findings carry `step`, `note_id`, `procedure_id`, `section_key`, `message`, `rationale`, `suggested_tone_hint` — enough to dispatch a fix.

The note-regen layer exposes three section-regen server actions and three section-regen Claude generators that accept `(section, currentContent, toneHint, otherSections)`. Tone hint is the only free-text instruction channel; there is no dedicated parameter for "fix this finding."

The override status enum is `'acknowledged' | 'dismissed' | 'edited' | 'resolved'` — no in-progress state. Storage is jsonb, so adding fields requires no DB migration.

Constraints discovered:
- Section regen requires the note to be in `status: 'draft'` ([src/actions/initial-visit-notes.ts:816](src/actions/initial-visit-notes.ts#L816), [discharge-notes.ts:1059](src/actions/discharge-notes.ts#L1059), [procedure-notes.ts:1036](src/actions/procedure-notes.ts#L1036)).
- `runCaseQualityReview` already does carry-over: hash gone → `resolution_source: 'auto_recheck'`. Free post-fix recheck with no new code.
- Finding hash is `SHA-256(severity|step|note_id|procedure_id|section_key|message)` — stable across regens.
- Synthetic `_qc_external_cause_chain` and `_qc_seventh_character_integrity` section keys are routing sentinels, not real columns.

## Desired End State

Provider opens Quality Review → sees finding with eligible Fix button → clicks Fix → spinner card replaces button row → AI regenerates target section → full QC recheck runs → finding flips to resolved (with `resolution_source: 'auto_recheck'`) and renders in the resolved collapsible, OR returns to pending if Claude could not address it.

Verification:
- Eligible AI finding renders Fix button alongside existing actions.
- Ineligible finding (cross-step, case-summary, deterministic-synthetic, null section_key, finalized note) does not render Fix button; tooltip explains why.
- Clicking Fix on a finding with a finalized note rejects with "Unfinalize note to fix" error toast.
- Fix click → finding card shows "Fixing… → Rechecking…" two-stage progress.
- After successful flow, finding appears in the Resolved collapsible with `Auto-resolved on Recheck` label (existing label).
- After a Fix where Claude did not eliminate the issue, finding returns to pending status (override cleared by recheck carry-over since hash still present).
- Regen failure clears `fix_in_progress` override so provider can retry.

### Key Discoveries:
- [src/lib/validations/case-quality-review.ts:47-53](src/lib/validations/case-quality-review.ts#L47-L53) — override status enum to extend
- [src/lib/validations/case-quality-review.ts:62-79](src/lib/validations/case-quality-review.ts#L62-L79) — override entry schema to extend with audit fields
- [src/actions/case-quality-reviews.ts:419-445](src/actions/case-quality-reviews.ts#L419-L445) — carry-over merge handles auto-resolve for free
- [src/actions/initial-visit-notes.ts:798-894](src/actions/initial-visit-notes.ts#L798-L894), [discharge-notes.ts:1042-1123](src/actions/discharge-notes.ts#L1042-L1123), [procedure-notes.ts:1018-1083](src/actions/procedure-notes.ts#L1018-L1083) — section regen actions (signatures take optional `findingFix`)
- [src/lib/claude/generate-initial-visit.ts:638-686](src/lib/claude/generate-initial-visit.ts#L638-L686), [generate-discharge-note.ts:556-599](src/lib/claude/generate-discharge-note.ts#L556-L599), [generate-procedure-note.ts:796-839](src/lib/claude/generate-procedure-note.ts#L796-L839) — section regen generators (signatures take optional `findingFix`)
- [src/components/clinical/qc-review-panel.tsx:398-642](src/components/clinical/qc-review-panel.tsx#L398-L642) — `FindingCard` action button block
- [src/components/clinical/qc-review-panel.tsx:49](src/components/clinical/qc-review-panel.tsx#L49) — pattern for `VERIFIABLE_STEPS` set; same shape for `FIXABLE_STEPS`
- [src/components/clinical/finding-edit-dialog.tsx:19-104](src/components/clinical/finding-edit-dialog.tsx#L19-L104) — pattern for an action that mutates an override + revalidates

## What We're NOT Doing

- No DB migration. Override storage is jsonb; new status value + audit fields are pure type changes.
- No targeted-hash recheck. Reusing full `runCaseQualityReview` for free cascade detection.
- No multi-section fix. One finding → one section regen call.
- No fix support for `cross_step`, `case_summary`, deterministic synthetic-section findings, or findings with null `section_key`/`note_id`. These keep the existing Verify / Mark Resolved path.
- No fix on finalized notes. Existing draft-only constraint inherited.
- No queue infra. `fixFinding` runs synchronously; provider waits ~40s.
- No new realtime channel. Existing `case_quality_reviews` realtime subscription drives recheck progress.
- No changes to deterministic validators or QC Claude prompt.
- No changes to `verifyFinding` or `markFindingResolved`.

## Implementation Approach

Bottom-up. Schema first (Phase 1), then generators (Phase 2), then action wiring including section-regen action extension and `fixFinding` (Phase 3), then UI (Phase 4). Each phase compiles and tests independently. Phase 3 is the only phase that requires Phases 1 + 2 to land first.

Generator parameter design: add `findingFix?: { message: string; rationale: string | null }` as an optional 7th parameter to the three section-regen generators. When present, prepend a structured block to the user message above the existing `Current content of this section:` line so the fix instruction reads first. Tone hint plumbing untouched.

Action design: `fixFinding(caseId, findingHash)` writes `'fix_in_progress'` override → loads finding → dispatches by `step` to extended section-regen action with `findingFix` — section-regen does its own draft-status guard and gather/regen/persist — then on success calls `runCaseQualityReview`. Carry-over does the rest. On regen failure, `fixFinding` deletes the `fix_in_progress` entry so the card returns to pending.

UI design: copy the `VERIFIABLE_STEPS` pattern. New `FIXABLE_STEPS` set + helper `isFindingFixable(finding)` returning `{ fixable: boolean; reason?: string }`. Render a Fix button in `FindingCard` for `pending`/`acknowledged`/`edited` statuses where eligible; show spinner replacing the button row when `status === 'fix_in_progress'`.

---

## Phase 1: Schema + types

### Overview
Extend the override status enum with `'fix_in_progress'` and add three audit fields. Pure type/Zod changes. No DB migration since `finding_overrides` is jsonb.

### Changes Required:

#### 1. Override status enum + entry schema
**File**: `src/lib/validations/case-quality-review.ts`
**Changes**:
- Add `'fix_in_progress'` to `findingOverrideStatusValues`
- Add three optional fields to `findingOverrideEntrySchema`: `fix_attempted_at`, `fix_section_regenerated`, `fix_recheck_result`. All nullable with `.default(null)` so existing rows parse cleanly.

```ts
export const findingOverrideStatusValues = [
  'acknowledged',
  'dismissed',
  'edited',
  'resolved',
  'fix_in_progress',
] as const

export const findingOverrideEntrySchema = z.object({
  status: z.enum(findingOverrideStatusValues),
  dismissed_reason: z.string().nullable(),
  edited_message: z.string().nullable(),
  edited_rationale: z.string().nullable(),
  edited_suggested_tone_hint: z.string().nullable(),
  actor_user_id: z.string().uuid(),
  set_at: z.string(),
  resolved_at: z.string().nullable().default(null),
  resolution_source: z.enum(findingResolutionSourceValues).nullable().default(null),
  // Fix-action audit. fix_attempted_at: timestamp of last Fix click.
  // fix_section_regenerated: which section column was regenerated.
  // fix_recheck_result: 'resolved' | 'still_present' | null. Survives recheck
  // carry-over because the recheck merge preserves entries verbatim.
  fix_attempted_at: z.string().nullable().default(null),
  fix_section_regenerated: z.string().nullable().default(null),
  fix_recheck_result: z.enum(['resolved', 'still_present']).nullable().default(null),
})
```

#### 2. Eligibility helper (shared between action + UI)
**File**: `src/lib/validations/case-quality-review.ts` (append to existing file)
**Changes**: New pure function `findingFixEligibility(finding)` returning structured result. Used by both action layer (server) and `FindingCard` (client).

```ts
const FIXABLE_STEPS = new Set<QcStep>([
  'initial_visit',
  'pain_evaluation',
  'procedure',
  'discharge',
])

const SYNTHETIC_SECTION_KEYS = new Set<string>([
  '_qc_external_cause_chain',
  '_qc_seventh_character_integrity',
])

export type FindingFixEligibility =
  | { fixable: true }
  | { fixable: false; reason: string }

export function findingFixEligibility(finding: QualityFinding): FindingFixEligibility {
  if (!FIXABLE_STEPS.has(finding.step)) {
    return { fixable: false, reason: 'Cross-step and case-summary findings are not auto-fixable' }
  }
  if (!finding.section_key) {
    return { fixable: false, reason: 'Finding has no target section' }
  }
  if (SYNTHETIC_SECTION_KEYS.has(finding.section_key)) {
    return { fixable: false, reason: 'Deterministic findings are not auto-fixable; use Verify' }
  }
  if (finding.step === 'procedure' && !finding.procedure_id) {
    return { fixable: false, reason: 'Procedure finding missing procedure_id' }
  }
  if (finding.step !== 'procedure' && !finding.note_id) {
    return { fixable: false, reason: 'Finding missing note_id' }
  }
  return { fixable: true }
}
```

### Success Criteria:

#### Automated Verification:
- [x] Type check passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] Existing schema tests pass: `npm test src/lib/validations/__tests__/case-quality-review.test.ts`
- [x] New tests pass for: `'fix_in_progress'` status round-trips through Zod parse, audit fields default to null when absent from JSON, `findingFixEligibility` returns expected result for each `step` × `section_key` combination (real, synthetic, null)

#### Manual Verification:
- [ ] No runtime impact on existing QC page (no migration, no breaking schema change)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation that nothing in the existing QC page is broken before proceeding to Phase 2.

---

## Phase 2: Generator `findingFix` parameter

### Overview
Add optional `findingFix?: { message: string; rationale: string | null }` to all three section-regen generators. When present, prepend a structured fix block to the user message. Tone-hint plumbing unchanged.

### Changes Required:

#### 1. Initial visit generator
**File**: `src/lib/claude/generate-initial-visit.ts`
**Changes**: Extend `regenerateSection` signature; build `findingFixBlock` and prepend before `Current content` line.

```ts
export async function regenerateSection(
  inputData: InitialVisitInputData,
  visitType: NoteVisitType,
  section: InitialVisitSection,
  currentContent: string,
  toneHint?: string | null,
  otherSections?: Partial<Record<InitialVisitSection, string>>,
  findingFix?: { message: string; rationale: string | null },
): Promise<{ data?: string; error?: string }> {
  // ... existing systemPrompt, sectionLabel, visitLabel, otherSectionsBlock ...

  let findingFixBlock = ''
  if (findingFix) {
    findingFixBlock = `\n\nQC FINDING TO ADDRESS (rewrite this section to resolve the finding below; do not introduce other changes):\nFinding: ${findingFix.message}`
    if (findingFix.rationale?.trim()) {
      findingFixBlock += `\nRationale: ${findingFix.rationale.trim()}`
    }
  }

  let userMessage = `Regenerate the "${sectionLabel}" section of the Initial Visit note.${findingFixBlock}\n\nCurrent content of this section:\n${currentContent}${otherSectionsBlock}\n\nFull case data:\n${JSON.stringify(inputData, null, 2)}`
  // ... rest unchanged: toneHint append, callClaudeTool, return ...
}
```

#### 2. Discharge generator
**File**: `src/lib/claude/generate-discharge-note.ts`
**Changes**: Same shape — add `findingFix` 6th param to `regenerateDischargeNoteSection`, build block, prepend.

#### 3. Procedure generator
**File**: `src/lib/claude/generate-procedure-note.ts`
**Changes**: Same shape — add `findingFix` 6th param to `regenerateProcedureNoteSection`, build block, prepend.

### Success Criteria:

#### Automated Verification:
- [x] Type check passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] Existing generator tests pass: `npm test src/lib/claude/__tests__/generate-initial-visit.test.ts src/lib/claude/__tests__/generate-discharge-note.test.ts src/lib/claude/__tests__/generate-procedure-note.test.ts`
- [x] New tests for each generator: when `findingFix` present, anthropic-mock receives a user message containing `'QC FINDING TO ADDRESS'` and the finding message; when absent, no fix block in user message

#### Manual Verification:
- [ ] Existing section regen flow still works in editors (initial-visit, discharge, procedure note pages — click "Regenerate this section" with no QC involvement)

**Implementation Note**: Pause for confirmation that existing per-section regen flows are not regressed before Phase 3.

---

## Phase 3: Section-regen action extension + `fixFinding` action

### Overview
Extend the three section-regen server actions to accept optional `findingFix` and forward to generators. Add `fixFinding` server action that writes `'fix_in_progress'` override, dispatches to the right section-regen action, runs full recheck, and on regen failure clears the override.

### Changes Required:

#### 1. Section-regen actions
**Files**:
- `src/actions/initial-visit-notes.ts`
- `src/actions/discharge-notes.ts`
- `src/actions/procedure-notes.ts`

**Changes**: Add optional `findingFix` last parameter on each `regenerate*Section` action; forward to generator.

```ts
// initial-visit-notes.ts
export async function regenerateNoteSection(
  caseId: string,
  visitType: NoteVisitType,
  section: InitialVisitSection,
  findingFix?: { message: string; rationale: string | null },
) {
  // ... existing body unchanged through regenerateSectionAI call ...
  const result = await regenerateSectionAI(
    inputData,
    visitType,
    section,
    currentContent,
    toneHint,
    otherSections,
    findingFix,
  )
  // ... rest unchanged ...
}
```

Same shape for `regenerateDischargeNoteSectionAction` and `regenerateProcedureNoteSectionAction`. The draft-status guard already in each action body is the source of "Fix rejected on finalized note" — no extra check needed.

#### 2. `fixFinding` server action
**File**: `src/actions/case-quality-reviews.ts` (append after `markFindingResolved`)
**Changes**: New exported action.

```ts
import { findingFixEligibility } from '@/lib/validations/case-quality-review'
import { regenerateNoteSection } from '@/actions/initial-visit-notes'
import { regenerateDischargeNoteSectionAction } from '@/actions/discharge-notes'
import { regenerateProcedureNoteSectionAction } from '@/actions/procedure-notes'
import type { InitialVisitSection } from '@/lib/validations/initial-visit-note'
import type { DischargeNoteSection } from '@/lib/validations/discharge-note'
import type { ProcedureNoteSection } from '@/lib/validations/procedure-note'

export async function fixFinding(caseId: string, findingHash: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  // Load finding from active review.
  const { data: row } = await supabase
    .from('case_quality_reviews')
    .select('id, findings, finding_overrides')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!row) return { error: 'No active review' }
  const findings = (row.findings as QualityFinding[] | null) ?? []
  const finding = findings.find((f) => computeFindingHash(f) === findingHash)
  if (!finding) return { error: 'Finding not found in current review' }

  // Eligibility gate.
  const eligibility = findingFixEligibility(finding)
  if (!eligibility.fixable) return { error: eligibility.reason }

  // Reject concurrent Fix on same finding.
  const overrides = (row.finding_overrides as FindingOverridesMap | null) ?? {}
  const existing = overrides[findingHash] ?? null
  if (existing?.status === 'fix_in_progress') {
    return { error: 'A fix is already in progress for this finding' }
  }

  // Write fix_in_progress override.
  const fixStartedAt = new Date().toISOString()
  const inProgressEntry: FindingOverrideEntry = {
    status: 'fix_in_progress',
    dismissed_reason: existing?.dismissed_reason ?? null,
    edited_message: existing?.edited_message ?? null,
    edited_rationale: existing?.edited_rationale ?? null,
    edited_suggested_tone_hint: existing?.edited_suggested_tone_hint ?? null,
    actor_user_id: user.id,
    set_at: fixStartedAt,
    resolved_at: null,
    resolution_source: null,
    fix_attempted_at: fixStartedAt,
    fix_section_regenerated: finding.section_key,
    fix_recheck_result: null,
  }
  const beforeRegen: FindingOverridesMap = { ...overrides, [findingHash]: inProgressEntry }
  const { error: lockError } = await supabase
    .from('case_quality_reviews')
    .update({ finding_overrides: beforeRegen, updated_by_user_id: user.id })
    .eq('id', row.id)
  if (lockError) return { error: 'Failed to acquire fix lock' }
  revalidatePath(`/patients/${caseId}/qc`)

  const findingFix = { message: finding.message, rationale: finding.rationale }

  // Dispatch by step.
  let regenResult: { data?: { content: string } | string; error?: string } | null = null
  if (finding.step === 'initial_visit' || finding.step === 'pain_evaluation') {
    regenResult = await regenerateNoteSection(
      caseId,
      finding.step === 'initial_visit' ? 'initial_visit' : 'pain_evaluation_visit',
      finding.section_key as InitialVisitSection,
      findingFix,
    )
  } else if (finding.step === 'discharge') {
    regenResult = await regenerateDischargeNoteSectionAction(
      caseId,
      finding.section_key as DischargeNoteSection,
      findingFix,
    )
  } else if (finding.step === 'procedure') {
    regenResult = await regenerateProcedureNoteSectionAction(
      finding.procedure_id!,
      caseId,
      finding.section_key as ProcedureNoteSection,
      findingFix,
    )
  }

  // Regen failure → clear fix_in_progress entry, return error.
  if (!regenResult || regenResult.error) {
    const cleared = { ...beforeRegen }
    delete cleared[findingHash]
    await supabase
      .from('case_quality_reviews')
      .update({ finding_overrides: cleared, updated_by_user_id: user.id })
      .eq('id', row.id)
    revalidatePath(`/patients/${caseId}/qc`)
    return { error: regenResult?.error ?? 'Section regeneration failed' }
  }

  // Regen succeeded → run full recheck. Carry-over flips disappeared findings
  // to 'resolved' + 'auto_recheck' automatically. The fix_in_progress entry's
  // hash is in the prior overrides; if the finding's hash is still present
  // in the new run, carry-over preserves the entry verbatim — but
  // 'fix_in_progress' is not a terminal state. We post-process below.
  const recheck = await runCaseQualityReview(caseId)
  if (recheck.error) {
    // Recheck failed but regen already happened. Fall back: clear
    // fix_in_progress and let staleness flag prompt manual Recheck.
    const { data: latest } = await supabase
      .from('case_quality_reviews')
      .select('id, finding_overrides')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .maybeSingle()
    if (latest) {
      const next = { ...((latest.finding_overrides as FindingOverridesMap | null) ?? {}) }
      delete next[findingHash]
      await supabase
        .from('case_quality_reviews')
        .update({ finding_overrides: next })
        .eq('id', latest.id)
    }
    revalidatePath(`/patients/${caseId}/qc`)
    return { error: 'Fix applied but recheck failed — run manual Recheck' }
  }

  // Post-recheck cleanup. The new active review row is the result of
  // runCaseQualityReview. If the finding hash disappeared, carry-over
  // already wrote 'resolved' + 'auto_recheck'. If still present, the
  // pre-Fix entry was not 'fix_in_progress' anymore (carry-over preserves
  // verbatim only for non-resolved entries) — so the prior entry was
  // stamped fix_in_progress, which carry-over kept. Convert that lingering
  // fix_in_progress to pending (delete) so UI returns to actionable state
  // and stamp fix_recheck_result on the carried-forward audit fields.
  const { data: post } = await supabase
    .from('case_quality_reviews')
    .select('id, findings, finding_overrides')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .maybeSingle()
  if (post) {
    const postOverrides = (post.finding_overrides as FindingOverridesMap | null) ?? {}
    const postFindings = (post.findings as QualityFinding[] | null) ?? []
    const stillPresent = postFindings.some((f) => computeFindingHash(f) === findingHash)
    const next = { ...postOverrides }
    if (stillPresent) {
      // Hash survived: clear fix_in_progress entry (return to pending),
      // stamp result on a fresh sticky entry so audit survives. We use
      // 'acknowledged' to preserve audit fields without locking the card.
      // Actually simpler: just delete entirely so card is pending; the
      // audit fields are best-effort, not source of truth.
      delete next[findingHash]
    } else {
      // Hash gone: carry-over wrote 'resolved' + 'auto_recheck'. Stamp
      // fix_recheck_result so audit reflects this fix's success.
      const carried = postOverrides[findingHash]
      if (carried?.status === 'resolved') {
        next[findingHash] = {
          ...carried,
          fix_attempted_at: fixStartedAt,
          fix_section_regenerated: finding.section_key,
          fix_recheck_result: 'resolved',
        }
      }
    }
    await supabase
      .from('case_quality_reviews')
      .update({ finding_overrides: next, updated_by_user_id: user.id })
      .eq('id', post.id)
  }

  revalidatePath(`/patients/${caseId}/qc`)
  return { data: { success: true } }
}
```

Note on import cycle: `case-quality-reviews.ts` already imports from generators and validations; importing from three note-action files creates no cycle because those files do not import from `case-quality-reviews.ts`.

### Success Criteria:

#### Automated Verification:
- [x] Type check passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] Section-regen action tests still pass with `findingFix` undefined: `npm test src/actions/__tests__/discharge-notes-regenerate.test.ts`
- [x] New `fixFinding` tests in `src/actions/__tests__/case-quality-reviews.test.ts`:
  - Eligible procedure finding → regen called with `findingFix` set
  - Ineligible finding (cross_step, deterministic synthetic, missing procedure_id) → returns error
  - Concurrent Fix (already `fix_in_progress`) → returns error
  - Finalized note (regen returns "No draft note found") → fixFinding clears override and returns error
  - No active review / finding hash absent → returns error
  - Auth fails → returns "Not authenticated"

#### Manual Verification:
- [ ] Calling `fixFinding` directly via a server-side test script on a real seed case produces a regenerated section column and a resolved override entry
- [ ] No regression in existing override mutators (acknowledge, dismiss, edit, clear, mark-resolved, verify)

**Implementation Note**: Pause for confirmation that `fixFinding` works end-to-end against seed data before adding the UI in Phase 4.

---

## Phase 4: UI Fix button + spinner state

### Overview
Render Fix button in `FindingCard` for eligible findings. Render disabled placeholder with tooltip for ineligible. Show spinner card while `status === 'fix_in_progress'`.

### Changes Required:

#### 1. `FindingCard` action wiring
**File**: `src/components/clinical/qc-review-panel.tsx`
**Changes**:
- Import `fixFinding` action and `findingFixEligibility` helper
- Import `Wand2` icon (or similar) from lucide-react for Fix button
- Inside `FindingCard`: compute `const eligibility = findingFixEligibility(finding)` once
- Add Fix button next to Edit/Dismiss for `pending`/`acknowledged`/`edited` statuses when `eligibility.fixable && !isLocked`
- When ineligible, render a disabled Fix button with `title={eligibility.reason}` so providers see why
- When `status === 'fix_in_progress'`, render a spinner row instead of the button row with text "Applying fix and rechecking…" and disable all other actions
- Add `handleFix` handler that calls `fixFinding(caseId, hash)`, shows toast on error, calls `router.refresh()` on success

```tsx
// Near top of file, with other imports:
import { fixFinding } from '@/actions/case-quality-reviews'
import { findingFixEligibility } from '@/lib/validations/case-quality-review'
import { Wand2, Loader2 } from 'lucide-react'

// Inside FindingCard, before button render block:
const eligibility = findingFixEligibility(finding)

const [isFixPending, startFixTransition] = useTransition()
const handleFix = () => {
  startFixTransition(async () => {
    const res = await fixFinding(caseId, hash)
    if (res.error) {
      toast.error(res.error)
    } else {
      toast.success('Finding fix applied')
      router.refresh()
    }
  })
}

// In status === 'fix_in_progress' render branch (new branch):
if (status === 'fix_in_progress') {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      Applying fix and rechecking…
    </div>
  )
}

// In pending/acknowledged/edited branch, alongside existing buttons:
{eligibility.fixable ? (
  <Button
    size="sm"
    variant="outline"
    onClick={handleFix}
    disabled={isLocked || isFixPending}
  >
    <Wand2 className="h-3.5 w-3.5" /> Fix with AI
  </Button>
) : (
  <Button
    size="sm"
    variant="outline"
    disabled
    title={eligibility.reason}
  >
    <Wand2 className="h-3.5 w-3.5" /> Fix with AI
  </Button>
)}
```

#### 2. Status type update on review row
**File**: `src/components/clinical/qc-review-panel.tsx` (the `ReviewRow` interface and override status references)
**Changes**: Override status reads come from `FindingOverridesMap` which is already typed via Zod schema; the `'fix_in_progress'` literal flows through automatically once Phase 1 lands. Verify no exhaustive switch on status needs a new branch by grepping for `override?.status ===`.

#### 3. Resolution source label
**File**: `src/components/clinical/qc-review-panel.tsx:51-55`
**Changes**: No new label needed — Fix successes flip to `resolution_source: 'auto_recheck'` which already has the label "Auto-resolved on Recheck". Leave existing label map untouched.

### Success Criteria:

#### Automated Verification:
- [x] Type check passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [ ] Component test (if test setup permits) verifies Fix button rendered for eligible AI findings, disabled for ineligible (skipped — no component test infra for `qc-review-panel`; covered by manual verification)

#### Manual Verification:
- [ ] On a seed case with at least one critical AI finding on a draft procedure note, click Fix → spinner appears → after ~40s finding moves to Resolved collapsible with "Auto-resolved on Recheck" label
- [ ] On a finding with `step='cross_step'`, Fix button is disabled with tooltip "Cross-step and case-summary findings are not auto-fixable"
- [ ] On a finding with `_qc_external_cause_chain` section_key, Fix button is disabled with tooltip "Deterministic findings are not auto-fixable; use Verify"
- [ ] On a finding pointing at a finalized note, click Fix → toast shows "No draft note found" → finding returns to pending (override cleared)
- [ ] Run two Fix clicks in rapid succession on the same finding → second is rejected with "A fix is already in progress for this finding"
- [ ] On a closed case, Fix button is disabled (existing `isLocked` gate)
- [ ] Existing actions (Acknowledge, Edit, Dismiss, Verify, Mark Resolved, Undo) still work without regression
- [ ] If Claude regenerates the section but the underlying drift persists, finding returns to pending (override cleared) with a stale-aware staleness badge

**Implementation Note**: Pause for full manual run before declaring the feature done.

---

## Testing Strategy

### Unit Tests:
- Schema: `'fix_in_progress'` status round-trips; audit fields default to null when absent; `findingFixEligibility` covers all step × section_key combinations
- Generators: `findingFix` block appears in user message when supplied; absent when not supplied; tone-hint appended after fix block
- `fixFinding`: each branch (eligible/ineligible/concurrent/regen-fail/recheck-fail/closed-case)

### Integration Tests:
- End-to-end on seed data: critical finding on draft procedure note → fixFinding → assertions on `procedure_notes.[section]` changed, `case_quality_reviews.findings` regenerated, override entry has `resolution_source: 'auto_recheck'` and `fix_recheck_result: 'resolved'`

### Manual Testing Steps:
1. Seed a case with all three note types in draft state and a QC review surfacing AI findings on each
2. Click Fix on an initial-visit finding → confirm section text changes, finding moves to Resolved
3. Click Fix on a procedure finding → confirm only that procedure's note section changes
4. Click Fix on a discharge finding → confirm trajectory columns refresh (two-step write path) and note is re-saved
5. Finalize a note, then click Fix on a finding pointing at it → confirm error toast and finding stays pending
6. Click Fix on a `cross_step` finding → confirm button is disabled with tooltip
7. Mid-fix, refresh the page → confirm spinner persists (status is in DB)
8. Force a Claude API failure (e.g. by setting `ANTHROPIC_API_KEY=invalid` in a sandbox) → click Fix → confirm graceful failure and pending state restored

## Performance Considerations

- A single Fix click runs: section regen (Opus 4.6, 4k tokens, ~10s) + full recheck (Opus 4.7, 16k tokens + 12 source queries, ~30s). Total ~40s of provider wait time.
- No new DB load beyond what existing recheck already does. `finding_overrides` jsonb writes are single-row UPDATEs on a small JSON object.
- Realtime subscription on `case_quality_reviews` already streams progress for the recheck phase; the regen phase has no realtime channel today, but the spinner UI does not require one — `router.refresh()` after the action completes is sufficient.
- `runCaseQualityReview` is the dominant cost. If providers Fix many findings in one session, costs scale linearly. Acceptable given expected usage (a handful of fixes per case).

## Migration Notes

- No DB migration. All storage is jsonb on `case_quality_reviews.finding_overrides`.
- Pre-existing rows have no `fix_*` audit fields; Zod `.default(null)` makes parse non-failing.
- No backfill needed.

## References

- Original research: `thoughts/shared/research/2026-05-07-qc-fix-action-auto-recheck.md`
- Related research: `thoughts/shared/research/2026-04-28-clinical-note-qc-pi-workflow.md`
- Related plan: `thoughts/shared/plans/2026-04-30-qc-finding-resolution-layer.md` (added the override mutators that this plan extends)
- Tone/Direction integration: `thoughts/shared/research/2026-04-19-tone-direction-for-procedure-and-discharge-notes.md`
- Hash function: [src/lib/validations/case-quality-review.ts:101-111](src/lib/validations/case-quality-review.ts#L101-L111)
- Carry-over merge: [src/actions/case-quality-reviews.ts:419-445](src/actions/case-quality-reviews.ts#L419-L445)
- Existing override mutator template: [src/actions/case-quality-reviews.ts:527-563](src/actions/case-quality-reviews.ts#L527-L563)
