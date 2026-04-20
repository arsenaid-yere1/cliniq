# Tone & Direction for Procedure and Discharge Notes — Implementation Plan

## Overview

Add an optional "Tone & Direction" freeform textarea to Procedure Notes and Discharge Notes, mirroring the existing Initial Visit pattern but fixing three of its gaps: (1) persist the hint on the note row so it survives Retry / refresh / section regen, (2) thread it through section regeneration, (3) add a system-prompt precedence block so the model knows how to apply the hint relative to hardcoded rules. Separately, address the user's "copy-paste between sections" complaint by giving section regen awareness of the other sections' current text.

## Current State Analysis

The complete baseline is documented in [thoughts/shared/research/2026-04-19-tone-direction-for-procedure-and-discharge-notes.md](thoughts/shared/research/2026-04-19-tone-direction-for-procedure-and-discharge-notes.md). Summary:

- **Initial Visit** has `toneHint` as React state only — appended to the user message but not persisted, not referenced by the system prompt, not applied on Retry, and architecturally absent from the section-regen path ([initial-visit-editor.tsx:294](src/components/clinical/initial-visit-editor.tsx#L294), [generate-initial-visit.ts:496-498](src/lib/claude/generate-initial-visit.ts#L496-L498)).
- **Procedure** and **Discharge** have no equivalent input; their `generate*` server actions take no `toneHint` argument ([procedure-notes.ts:292](src/actions/procedure-notes.ts#L292), [discharge-notes.ts:340](src/actions/discharge-notes.ts#L340)).
- All three note types implement per-section regeneration with an identical 4-layer pattern. Section regen reuses the full `SYSTEM_PROMPT` + an appended narrowing sentence, passes the current section's text, but has **no awareness of the other sections' current text**.
- Discharge has a hardcoded tone directive at [generate-discharge-note.ts:149](src/lib/claude/generate-discharge-note.ts#L149): *"The tone should reflect completion, improvement, and forward-looking recommendations."* A provider hint could conflict with this.
- The only existing cross-regeneration persistence is discharge vitals + `visit_date` ([discharge-notes.ts:357-378](src/actions/discharge-notes.ts#L357-L378)).
- Migration naming convention is `YYYYMMDD_description.sql`; last migration is `20260421_discharge_notes_vitals.sql`.

## Desired End State

After this plan is complete:

1. The Procedure Note editor and Discharge Note editor each display a "Tone & Direction (optional)" textarea card on both the pre-generation screen and the draft-editor screen (always editable). The field is saved on first generation and auto-saved on blur during draft editing.
2. The `tone_hint` is stored on `procedure_notes.tone_hint` and `discharge_notes.tone_hint` (nullable TEXT).
3. The hint is applied on initial generation, on Retry from `failed`, and on every per-section regeneration.
4. Each system prompt contains an explicit precedence block instructing the model to apply the hint to phrasing/emphasis only — never overriding clinical facts, the MANDATORY rules, or the automated pain-trend branching.
5. Section regeneration receives the full text of all *other* sections currently on the note row and is instructed not to duplicate their content.
6. Unit tests cover the new generator parameters and cross-section context assembly.

**Verification**: The end-to-end scenario in the Manual Verification checklist of Phase 4 passes.

### Key Discoveries

- Migration convention: `YYYYMMDD_description.sql` in `supabase/migrations/` (feedback memory: use `npx supabase db push` to apply, not MCP tools).
- Discharge already preserves vitals across full-note regeneration ([discharge-notes.ts:357-378](src/actions/discharge-notes.ts#L357-L378)). The `tone_hint` preservation should piggyback on this same read-before-replace pattern.
- Discharge section-regen omits `dischargeVitals` when it re-gathers data ([discharge-notes.ts:679](src/actions/discharge-notes.ts#L679)). `tone_hint` should be passed from the note row directly to the AI function, not rehydrated via the gather helper.
- The three AI section-regen functions share an identical appended system-prompt template — changes here are trivially parallel across files.
- `ProcedureNoteSection` (20 sections) and `DischargeNoteSection` (12 sections) are exported as `as const` tuples from their validation modules; they drive UI loops, tool schemas, and Zod validators (single source of truth).

## What We're NOT Doing

- **Not** adding `tone_hint` to `initial_visit_notes` in this plan. Fixing Initial Visit's known gaps (no persistence, no section-regen threading, no Retry) is a separate decision and a separate migration.
- **Not** adding a clinic-level or user-level "default tone" preference or settings page.
- **Not** adding a character limit, debouncing, preview, or character counter to the textarea (matches Initial Visit).
- **Not** adding a NO CLONE RULE to the Discharge prompt (discharge is a single-visit artifact — no cross-visit comparison).
- **Not** changing `paintoneLabel`, `overallPainTrend`, `chiroProgress`, or any other automated tone signal.
- **Not** adding Playwright/E2E tests — test coverage matches Initial Visit's baseline (unit tests for generator interpolation).
- **Not** changing the finalize / PDF render / document storage flow. `tone_hint` is draft-only metadata and does not appear in the finalized PDF.

## Implementation Approach

Six phases in dependency order. DB first (Phase 1) so the column exists when server actions need to read it. AI generators next (Phase 2) so server actions have functions to call with the new signature. Server actions (Phase 3) glue DB and AI. UI (Phase 4) is last. Phases 5 and 6 are prompt-only changes that can happen in parallel with Phase 2 — they are sequenced last so the prompt work can be reviewed independently.

---

## Phase 1: Database Migration

### Overview

Add a nullable `tone_hint TEXT` column to `procedure_notes` and `discharge_notes`.

### Changes Required:

#### 1. New migration file
**File**: `supabase/migrations/20260422_procedure_and_discharge_tone_hint.sql`
**Changes**: Add `tone_hint` column to both tables.

```sql
-- Add tone_hint column to procedure_notes
ALTER TABLE procedure_notes
  ADD COLUMN tone_hint TEXT;

COMMENT ON COLUMN procedure_notes.tone_hint IS
  'Optional provider-entered tone/direction guidance for AI note generation. Applied on full generation, Retry, and section regeneration. Not persisted into finalized PDF.';

-- Add tone_hint column to discharge_notes
ALTER TABLE discharge_notes
  ADD COLUMN tone_hint TEXT;

COMMENT ON COLUMN discharge_notes.tone_hint IS
  'Optional provider-entered tone/direction guidance for AI note generation. Applied on full generation, Retry, and section regeneration. Not persisted into finalized PDF.';
```

#### 2. Regenerate Supabase types
**File**: `src/types/database.ts`
**Changes**: Regenerate via the project's standard command to pick up the new columns.

### Success Criteria:

#### Automated Verification:
- [ ] Migration file exists at the expected path
- [ ] Migration applies cleanly: `npx supabase db push`
- [ ] Supabase types regenerated; `tone_hint: string | null` appears on both `procedure_notes` and `discharge_notes` in `src/types/database.ts`
- [ ] TypeScript compiles: `npx tsc --noEmit`

#### Manual Verification:
- [ ] Inspect the local `procedure_notes` and `discharge_notes` tables in the Supabase Studio; confirm the new column with TEXT type and nullable.

**Implementation Note**: Pause after Phase 1 for manual confirmation before proceeding.

---

## Phase 2: AI Generator Changes

### Overview

Add an optional `toneHint?: string | null` parameter to both full-generation and section-regeneration Claude functions for Procedure and Discharge notes. Follow the exact Initial Visit pattern: guard with `toneHint?.trim()`, append at the end of the user message under the header `ADDITIONAL TONE/DIRECTION GUIDANCE FROM THE PROVIDER:`.

### Changes Required:

#### 1. Procedure Note generator
**File**: `src/lib/claude/generate-procedure-note.ts`
**Changes**: Add `toneHint` to both `generateProcedureNoteFromData` and `regenerateProcedureNoteSection`.

```ts
// Line 442 — update signature
export async function generateProcedureNoteFromData(
  inputData: ProcedureNoteInputData,
  toneHint?: string | null,
): Promise<{
  data?: ProcedureNoteResult
  rawResponse?: unknown
  error?: string
}> {
  let userMessage = `Generate a comprehensive PRP Procedure Note from the following case and procedure data.\n\n${JSON.stringify(inputData, null, 2)}`
  if (toneHint?.trim()) {
    userMessage += `\n\nADDITIONAL TONE/DIRECTION GUIDANCE FROM THE PROVIDER:\n${toneHint.trim()}`
  }

  return callClaudeTool<ProcedureNoteResult>({
    model: 'claude-opus-4-7',
    maxTokens: 16384,
    system: SYSTEM_PROMPT,
    tools: [PROCEDURE_NOTE_TOOL],
    toolName: 'generate_procedure_note',
    messages: [{ role: 'user', content: userMessage }],
    parse: (raw) => {
      const validated = procedureNoteResultSchema.safeParse(raw)
      return validated.success
        ? { success: true, data: validated.data }
        : { success: false, error: validated.error }
    },
  })
}

// Line 487 — update signature (otherSections added in Phase 6; toneHint added here)
export async function regenerateProcedureNoteSection(
  inputData: ProcedureNoteInputData,
  section: ProcedureNoteSection,
  currentContent: string,
  toneHint?: string | null,
): Promise<{ data?: string; error?: string }> {
  const sectionLabel = procedureNoteSectionLabels[section]

  let userMessage = `Regenerate the "${sectionLabel}" section of the PRP Procedure Note.\n\nCurrent content of this section:\n${currentContent}\n\nFull case and procedure data:\n${JSON.stringify(inputData, null, 2)}`
  if (toneHint?.trim()) {
    userMessage += `\n\nADDITIONAL TONE/DIRECTION GUIDANCE FROM THE PROVIDER:\n${toneHint.trim()}`
  }

  // ...rest unchanged; messages[0].content = userMessage
}
```

#### 2. Discharge Note generator
**File**: `src/lib/claude/generate-discharge-note.ts`
**Changes**: Same pattern as Procedure. Apply to `generateDischargeNoteFromData` (line 271) and `regenerateDischargeNoteSection` (line 316).

```ts
export async function generateDischargeNoteFromData(
  inputData: DischargeNoteInputData,
  toneHint?: string | null,
): Promise<{
  data?: DischargeNoteResult
  rawResponse?: unknown
  error?: string
}> {
  let userMessage = `Generate a Final PRP Follow-Up and Discharge Visit note from the following aggregated case data.\n\n${JSON.stringify(inputData, null, 2)}`
  if (toneHint?.trim()) {
    userMessage += `\n\nADDITIONAL TONE/DIRECTION GUIDANCE FROM THE PROVIDER:\n${toneHint.trim()}`
  }
  // ...rest of callClaudeTool unchanged; messages[0].content = userMessage
}

export async function regenerateDischargeNoteSection(
  inputData: DischargeNoteInputData,
  section: DischargeNoteSection,
  currentContent: string,
  toneHint?: string | null,
): Promise<{ data?: string; error?: string }> {
  // same pattern as above
}
```

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles: `npx tsc --noEmit`
- [ ] Linting passes: `npm run lint`
- [ ] Existing tests still pass: `npx vitest run src/lib/claude`
- [ ] New unit tests pass (added in Phase 3/7):
  - Procedure full: `tone_hint` string appears in user message when provided
  - Procedure full: whitespace-only `tone_hint` is suppressed
  - Procedure regen: `tone_hint` appears in user message when provided
  - Discharge full: `tone_hint` string appears in user message when provided
  - Discharge regen: `tone_hint` appears in user message when provided

#### Manual Verification:
- [ ] None (pure code change — covered by automated tests).

---

## Phase 3: Server Action Changes

### Overview

Thread `toneHint` through `generate*` and `regenerate*SectionAction` for Procedure and Discharge. Persist on initial generation, preserve across full regeneration (Discharge already does this for vitals — piggyback), read from the note row for section regen and Retry.

### Changes Required:

#### 1. Procedure — full generation
**File**: `src/actions/procedure-notes.ts`
**Changes**: Accept `toneHint`, persist it on insert/update, pass to AI function.

```ts
// Line 292 — update signature
export async function generateProcedureNote(
  procedureId: string,
  caseId: string,
  toneHint?: string | null,
) {
  // ...existing auth + prereq + gather...

  // When updating the existing row to status='generating', include tone_hint
  // When inserting a new row, include tone_hint
  // Normalize: empty string or whitespace-only → null before writing
  const normalizedToneHint = toneHint?.trim() ? toneHint.trim() : null

  // In the UPDATE at lines ~329-367 and INSERT at ~371-391, add:
  //   tone_hint: normalizedToneHint,

  // Line 394 — pass to AI
  const result = await generateProcedureNoteFromData(inputData, normalizedToneHint)

  // ...rest unchanged...
}
```

#### 2. Procedure — section regeneration
**File**: `src/actions/procedure-notes.ts`
**Changes**: Read `tone_hint` from the fetched note row; pass to AI function. Do **not** accept it as an argument (not user-input at regen time — the provider edits the textarea and saves, which updates the DB; section regen reads the saved value).

```ts
// Line 693 — signature unchanged
export async function regenerateProcedureNoteSectionAction(
  procedureId: string,
  caseId: string,
  section: ProcedureNoteSection,
) {
  // ...existing fetch of note row (line 707) — note.tone_hint is now available...

  const currentContent = (note[section] as string) || ''
  const toneHint = (note.tone_hint as string | null) ?? null

  // Line 722 — pass toneHint (otherSections added in Phase 6)
  const result = await regenerateSectionAI(inputData, section, currentContent, toneHint)

  // ...rest unchanged...
}
```

#### 3. Procedure — add `saveToneHint` server action
**File**: `src/actions/procedure-notes.ts`
**Changes**: Add a new action for auto-save-on-blur from the draft editor.

```ts
export async function saveProcedureNoteToneHint(
  procedureId: string,
  caseId: string,
  toneHint: string | null,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'Unauthorized' }

  await assertCaseNotClosed(supabase, caseId)

  const normalized = toneHint?.trim() ? toneHint.trim() : null

  const { error } = await supabase
    .from('procedure_notes')
    .update({ tone_hint: normalized, updated_by_user_id: user.id })
    .eq('procedure_id', procedureId)
    .is('deleted_at', null)
    .in('status', ['draft', 'generating', 'failed'])

  if (error) return { error: 'Failed to save tone hint' }

  // No revalidatePath — this is a silent background save; avoids unnecessary re-render.
  return {}
}
```

#### 4. Discharge — full generation
**File**: `src/actions/discharge-notes.ts`
**Changes**: Same pattern as Procedure. Preserve across full regeneration using the existing read-before-replace block at [discharge-notes.ts:357-378](src/actions/discharge-notes.ts#L357-L378).

```ts
// Line 340 — update signature
export async function generateDischargeNote(
  caseId: string,
  toneHint?: string | null,
) {
  // ...existing auth + prereq...

  // Line 357-378 — existing read-before-replace already reads the row for vitals.
  // Include tone_hint in that SELECT and preservation logic:
  //   SELECT ... tone_hint ...
  //   const preservedToneHint = existingRow?.tone_hint ?? null

  // Decide: when the caller passes toneHint explicitly (initial generation from
  // pre-generation screen), use it; otherwise fall back to preserved value
  // (applies to Retry from failed state).
  const normalized = toneHint?.trim() ? toneHint.trim() : null
  const effectiveToneHint = normalized ?? preservedToneHint

  // In the INSERT at lines ~398-419, include tone_hint: effectiveToneHint

  // Line 427 — pass to AI
  const result = await generateDischargeNoteFromData(inputData, effectiveToneHint)
  // ...rest unchanged...
}
```

#### 5. Discharge — section regeneration
**File**: `src/actions/discharge-notes.ts`
**Changes**: Read `tone_hint` from note row and pass to AI function.

```ts
// Line 655 — signature unchanged
export async function regenerateDischargeNoteSectionAction(
  caseId: string,
  section: DischargeNoteSection,
) {
  // ...existing fetch (line 667-675)...
  const toneHint = (note.tone_hint as string | null) ?? null

  // Line 684 — pass toneHint (otherSections added in Phase 6)
  const result = await regenerateSectionAI(inputData, section, currentContent, toneHint)
  // ...rest unchanged...
}
```

#### 6. Discharge — add `saveToneHint` server action
**File**: `src/actions/discharge-notes.ts`
**Changes**: Mirror the procedure version.

```ts
export async function saveDischargeNoteToneHint(
  caseId: string,
  toneHint: string | null,
): Promise<{ error?: string }> {
  // Similar pattern to saveProcedureNoteToneHint.
  // Also supports upsert: if no discharge_notes row exists yet, insert one with
  // status='draft' and tone_hint populated (matches the pattern already used by
  // saveDischargeVitals at discharge-notes.ts:778-825).
}
```

#### 7. Unit tests for generators
**File**: `src/lib/claude/__tests__/generate-procedure-note.test.ts`
**Changes**: Add tests mirroring [generate-initial-visit.test.ts:47-52](src/lib/claude/__tests__/generate-initial-visit.test.ts#L47-L52) plus additional edge cases.

```ts
describe('tone hint', () => {
  it('includes toneHint in user message when provided', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData(fakeInputData, 'use assertive language')
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.messages[0].content).toContain('ADDITIONAL TONE/DIRECTION GUIDANCE FROM THE PROVIDER:')
    expect(opts.messages[0].content).toContain('use assertive language')
  })

  it('omits toneHint when whitespace-only', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData(fakeInputData, '   ')
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.messages[0].content).not.toContain('ADDITIONAL TONE/DIRECTION')
  })

  it('omits toneHint when null/undefined', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData(fakeInputData, null)
    await generateProcedureNoteFromData(fakeInputData)
    const callA = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    const callB = (callClaudeTool as unknown as Mock).mock.calls[1][0]
    expect(callA.messages[0].content).not.toContain('ADDITIONAL TONE/DIRECTION')
    expect(callB.messages[0].content).not.toContain('ADDITIONAL TONE/DIRECTION')
  })

  it('includes toneHint in section regeneration user message', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: { content: 'x' }, rawResponse: {} })
    await regenerateProcedureNoteSection(fakeInputData, 'subjective', 'prior', 'keep tone guarded')
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.messages[0].content).toContain('keep tone guarded')
  })
})
```

**File**: `src/lib/claude/__tests__/generate-discharge-note.test.ts`
**Changes**: Mirror the procedure tests for both `generateDischargeNoteFromData` and `regenerateDischargeNoteSection`.

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles: `npx tsc --noEmit`
- [ ] Linting passes: `npm run lint`
- [ ] New generator tests pass: `npx vitest run src/lib/claude`
- [ ] Existing action tests still pass: `npx vitest run src/actions`

#### Manual Verification:
- [ ] None (pure code change — covered by automated tests; end-to-end behavior verified in Phase 4).

---

## Phase 4: UI Changes

### Overview

Add a "Tone & Direction (optional)" card to both editors, visible on both the pre-generation and draft screens, always editable. Auto-save on blur. Retry passes the persisted hint. Pre-generation uses local state seeded from the note row (if one exists from a prior reset/retry).

### Changes Required:

#### 1. Shared `ToneDirectionCard` component
**File**: `src/components/clinical/tone-direction-card.tsx` (new)
**Changes**: Extract the Initial Visit textarea UI into a reusable component.

```tsx
'use client'

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'

interface ToneDirectionCardProps {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  disabled?: boolean
  description?: string
}

export function ToneDirectionCard({
  value,
  onChange,
  onBlur,
  disabled,
  description,
}: ToneDirectionCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tone & Direction (optional)</CardTitle>
        <CardDescription>
          {description ?? `Provide optional guidance to influence the AI's writing style and emphasis. Applied to full generation and per-section regeneration.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Textarea
          placeholder="e.g., Use assertive language about medical necessity, emphasize conservative treatment failure, keep prognosis cautious..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          rows={3}
          disabled={disabled}
        />
      </CardContent>
    </Card>
  )
}
```

**Note**: We do NOT refactor `initial-visit-editor.tsx` to consume this new component in this plan — that would expand scope. It may happen in a follow-up.

#### 2. Procedure Note editor — pre-generation view
**File**: `src/components/procedures/procedure-note-editor.tsx`
**Changes**: Add `toneHint` local state (seeded from `note?.tone_hint`), render `ToneDirectionCard` above the Generate button at [line 194-213](src/components/procedures/procedure-note-editor.tsx#L194-L213), pass hint to `generateProcedureNote`.

```tsx
// Add to component state (near line 180-183):
const [toneHint, setToneHint] = useState<string>(
  (note?.tone_hint as string | null) ?? ''
)

// In the pre-generation branch (line 190), replace the current div with:
return (
  <div className="space-y-6">
    <h1 className="text-2xl font-bold">Procedure Note</h1>

    <ToneDirectionCard
      value={toneHint}
      onChange={setToneHint}
      disabled={isLocked || isPending}
    />

    <div className="flex flex-col items-center justify-center py-16 space-y-4 border rounded-lg bg-muted/30">
      <p className="text-sm text-muted-foreground text-center max-w-md">
        {canGenerate
          ? 'Generate an AI-powered PRP Procedure Note from the case data and procedure details.'
          : prerequisiteReason || 'Cannot generate note.'}
      </p>
      <Button
        onClick={() => {
          startTransition(async () => {
            const result = await generateProcedureNote(procedureId, caseId, toneHint || null)
            if (result.error) toast.error(result.error)
            else toast.success('Note generated successfully')
          })
        }}
        disabled={isLocked || !canGenerate || isPending}
      >
        {/* ...icon and label... */}
      </Button>
    </div>
  </div>
)
```

#### 3. Procedure Note editor — failed state Retry
**File**: `src/components/procedures/procedure-note-editor.tsx`
**Changes**: Pass the persisted `note.tone_hint` on Retry at [line 255](src/components/procedures/procedure-note-editor.tsx#L255).

```tsx
const result = await generateProcedureNote(
  procedureId,
  caseId,
  (note.tone_hint as string | null) ?? null,
)
```

#### 4. Procedure Note editor — draft editor
**File**: `src/components/procedures/procedure-note-editor.tsx`
**Changes**: Render `ToneDirectionCard` at the top of the `DraftEditor` form with auto-save-on-blur.

```tsx
// In DraftEditor component body, add local state:
const [toneHint, setToneHint] = useState<string>(
  (note.tone_hint as string | null) ?? ''
)

function handleToneHintBlur() {
  // Fire-and-forget save — no toast on success to avoid noise; toast on error only.
  saveProcedureNoteToneHint(procedureId, caseId, toneHint || null).then((result) => {
    if (result.error) toast.error(result.error)
  })
}

// In the JSX, immediately inside <Form>...</Form> as the first child:
<ToneDirectionCard
  value={toneHint}
  onChange={setToneHint}
  onBlur={handleToneHintBlur}
  disabled={isLocked || isPending}
  description="Edits apply to subsequent section regenerations. Saved automatically on blur."
/>
```

#### 5. Discharge Note editor — apply the same three changes
**File**: `src/components/discharge/discharge-note-editor.tsx`
**Changes**: Mirror items 2, 3, 4 above. Note that the pre-generation view already has the `DischargeVitalsCard` ([line 197](src/components/discharge/discharge-note-editor.tsx#L197)) — place `ToneDirectionCard` *after* it (vitals come first in flow order). Retry is at [line 260](src/components/discharge/discharge-note-editor.tsx#L260).

```tsx
// Pre-generation view:
<DischargeVitalsCard caseId={caseId} note={note} isLocked={isLocked} defaultVitals={defaultVitals} />
<ToneDirectionCard value={toneHint} onChange={setToneHint} disabled={isLocked || isPending} />
{/* ...Generate button passes toneHint || null as third argument to generateDischargeNote... */}
```

#### 6. Type widening for `note.tone_hint`
**File**: `src/components/procedures/procedure-note-editor.tsx` + `src/components/discharge/discharge-note-editor.tsx`
**Changes**: Ensure the `NoteRow` type (wherever defined in each editor) includes `tone_hint: string | null`. This should fall out automatically from the regenerated Supabase types in Phase 1; if not, add explicitly.

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles: `npx tsc --noEmit`
- [ ] Linting passes: `npm run lint`
- [ ] All existing tests still pass: `npx vitest run`

#### Manual Verification:
- [ ] **Procedure pre-generation**: navigate to a case → procedure → note page. See the Tone & Direction card above Generate button. Type a hint. Click Generate. Verify DB: `procedure_notes.tone_hint` is populated. Verify network tab / logs: user message to Claude contains `ADDITIONAL TONE/DIRECTION GUIDANCE FROM THE PROVIDER:` followed by the entered text.
- [ ] **Procedure draft editor**: after generation, see the Tone & Direction card at top of draft editor with the prior value pre-filled. Edit the text, click outside (blur). Refresh the page — value persists. Regenerate any section. Verify network tab / logs: section regen user message contains the edited tone hint.
- [ ] **Procedure Retry**: set the note to `failed` state (manually via DB or by provoking a generation error). Enter a hint on pre-generation first. Click Retry on failed state. Verify the user message to Claude contains the previously-entered tone hint.
- [ ] **Procedure empty hint behavior**: leave hint blank or whitespace-only → verify user message does NOT contain `ADDITIONAL TONE/DIRECTION GUIDANCE`.
- [ ] **Discharge: same four checks** as above, using the Discharge editor.
- [ ] **Discharge tone conflict**: enter a hint like "emphasize incomplete recovery, keep prognosis guarded." Verify the generated note respects clinical facts (the hardcoded `-2` rule still applies if `dischargeVitals` is null) but the phrasing/emphasis shifts toward the provider direction. (This verifies Phase 5's precedence block is working.)
- [ ] **UX**: verify no stuck spinners, no double-submit, no console errors.

**Implementation Note**: Pause here after all manual checks before proceeding to Phase 5.

---

## Phase 5: System Prompt Precedence Blocks

### Overview

Add a short, uniform block to each `SYSTEM_PROMPT` telling the model how to use the tone hint. Position: after the `GLOBAL RULES` section, before `SECTION-SPECIFIC INSTRUCTIONS`. This location keeps it in the cacheable portion of the system prompt (before the per-section content) — important because the prompt-caching research [thoughts/shared/research/2026-04-19-prompt-caching-current-state.md](thoughts/shared/research/2026-04-19-prompt-caching-current-state.md) notes that system-prompt changes invalidate cache.

### Changes Required:

#### 1. Procedure Note system prompt
**File**: `src/lib/claude/generate-procedure-note.ts`
**Changes**: Insert new block after the existing `NO CLONE RULE` block (ends around line 128), before `=== SECTION-SPECIFIC INSTRUCTIONS ===` at line 130.

```
=== PROVIDER TONE/DIRECTION HINT (CONDITIONAL) ===

If the user message contains a section labeled "ADDITIONAL TONE/DIRECTION GUIDANCE FROM THE PROVIDER:", treat its content as the provider's preference for phrasing, emphasis, and voice. Apply it to:
• Word choice and tone (e.g., assertive vs. conservative medical-necessity language).
• Which data points to emphasize or de-emphasize in prose.
• Rhetorical framing of forward-looking statements.

The provider hint does NOT override:
• Clinical facts, numeric values, or structured data in the input payload.
• The MANDATORY rules above (NO REPETITION, NO CLONE RULE, INTERVAL-CHANGE RULE, MINIMUM INTERVAL-CHANGE FLOOR, SERIES-TOTAL RULE, INTERVAL-RESPONSE NARRATIVE, PRE-PROCEDURE SAFETY CHECKLIST, RESPONSE-CALIBRATED FOLLOW-UP, DIAGNOSTIC-SUPPORT RULE, TARGET-COHERENCE RULE, DATA-NULL RULE).
• The paintoneLabel-based and chiroProgress-based branching logic in the section-specific instructions.
• PDF-SAFE FORMATTING rules.

If the provider hint conflicts with any of the above, follow the rules and render the hint's intent in whatever latitude the rules permit. Do NOT silently ignore the hint — apply it everywhere the rules allow.
```

#### 2. Discharge Note system prompt
**File**: `src/lib/claude/generate-discharge-note.ts`
**Changes**: Insert the analogous block after the `=== PAIN TRAJECTORY (MANDATORY) ===` block (ends around line 174), before `=== SECTION-SPECIFIC INSTRUCTIONS ===` at line 176. The wording must account for the hardcoded tone directive at line 149.

```
=== PROVIDER TONE/DIRECTION HINT (CONDITIONAL) ===

If the user message contains a section labeled "ADDITIONAL TONE/DIRECTION GUIDANCE FROM THE PROVIDER:", treat its content as the provider's preference for phrasing, emphasis, and voice. Apply it to:
• Word choice and tone, including modulating the default "completion, improvement, and forward-looking" framing when the provider explicitly directs otherwise (e.g., if the provider hint says "emphasize incomplete recovery" or "keep prognosis guarded", shift accordingly).
• Which data points to emphasize or de-emphasize in prose.
• Rhetorical framing of forward-looking statements.

The provider hint does NOT override:
• Clinical facts, numeric values, or structured data in the input payload.
• The MANDATORY rules in === PAIN TRAJECTORY === (including the dischargeVitals priority, the -2 default rule, the "stable"/"worsened" override, and the "never invent pain numbers" rule).
• The NO REPETITION rule.
• PDF-SAFE FORMATTING rules.

If the provider hint conflicts with any of the above, follow the rules and render the hint's intent in whatever latitude the rules permit. Do NOT silently ignore the hint — apply it everywhere the rules allow.
```

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles: `npx tsc --noEmit`
- [ ] All existing tests still pass: `npx vitest run`
- [ ] New snapshot / string-presence tests pass (optional but recommended):
  ```ts
  it('system prompt contains tone hint precedence block', () => {
    // Import SYSTEM_PROMPT (export it if not already exported, or import via module internals)
    expect(SYSTEM_PROMPT).toContain('PROVIDER TONE/DIRECTION HINT (CONDITIONAL)')
    expect(SYSTEM_PROMPT).toContain('does NOT override')
  })
  ```

#### Manual Verification:
- [ ] **Conflict test (Procedure)**: generate a procedure note with hint "describe patient as fully recovered, skip safety-clearance language." Verify the PRE-PROCEDURE SAFETY CHECKLIST text still appears (the rule wins) but the overall phrasing tilts toward recovery framing.
- [ ] **Alignment test (Discharge)**: hint "emphasize incomplete recovery, guarded prognosis." Verify the `-2` rule still applies to `objective_vitals` pain number but the `prognosis` and `assessment` prose lean cautious.
- [ ] Verify no regression in the baseline (no-hint) generation by generating one note of each type with an empty hint.

**Implementation Note**: Pause after Phase 5 manual tests before Phase 6.

---

## Phase 6: Cross-Section Awareness for Section Regeneration

### Overview

When regenerating a single section, pass the current text of all *other* sections in the user message and instruct the model not to duplicate their content. This addresses the "copy-paste between sections" complaint at its most likely origin point — section regen, which today has no awareness of what the rest of the note contains.

Applies to both Procedure and Discharge section regen. Intentionally does NOT apply to full-note generation (the model already produces all sections together there and the existing `NO REPETITION` rule handles it).

### Changes Required:

#### 1. AI generator — Procedure section regen
**File**: `src/lib/claude/generate-procedure-note.ts`
**Changes**: Add `otherSections` parameter to `regenerateProcedureNoteSection`. Include it in the user message as a structured block. Add a one-line instruction to the appended system-prompt narrowing sentence.

```ts
export async function regenerateProcedureNoteSection(
  inputData: ProcedureNoteInputData,
  section: ProcedureNoteSection,
  currentContent: string,
  toneHint?: string | null,
  otherSections?: Partial<Record<ProcedureNoteSection, string>>,
): Promise<{ data?: string; error?: string }> {
  const sectionLabel = procedureNoteSectionLabels[section]

  // Build the other-sections block (only sections with non-empty content)
  let otherSectionsBlock = ''
  if (otherSections) {
    const entries = Object.entries(otherSections)
      .filter(([k, v]) => k !== section && v && v.trim().length > 0)
      .map(([k, v]) => `--- ${procedureNoteSectionLabels[k as ProcedureNoteSection]} ---\n${v}`)
    if (entries.length > 0) {
      otherSectionsBlock = `\n\nOTHER SECTIONS CURRENTLY PRESENT IN THIS NOTE (for context — do NOT duplicate their content):\n${entries.join('\n\n')}`
    }
  }

  let userMessage = `Regenerate the "${sectionLabel}" section of the PRP Procedure Note.\n\nCurrent content of this section:\n${currentContent}${otherSectionsBlock}\n\nFull case and procedure data:\n${JSON.stringify(inputData, null, 2)}`
  if (toneHint?.trim()) {
    userMessage += `\n\nADDITIONAL TONE/DIRECTION GUIDANCE FROM THE PROVIDER:\n${toneHint.trim()}`
  }

  // Append to the existing system-prompt narrowing sentence:
  const systemWithNarrowing = `${SYSTEM_PROMPT}\n\nYou are regenerating ONLY the "${sectionLabel}" section of an existing PRP Procedure Note. Write a fresh version of this section based on the source data. Do not repeat the section title — just provide the content. Follow the exact length targets and conciseness constraints from the section-specific instructions above. Avoid duplicating content that already appears in the OTHER SECTIONS listed in the user message — each section must contribute NEW information.`

  // ...rest unchanged (callClaudeTool with systemWithNarrowing and userMessage)
}
```

#### 2. AI generator — Discharge section regen
**File**: `src/lib/claude/generate-discharge-note.ts`
**Changes**: Same pattern as Procedure.

#### 3. Server action — Procedure section regen
**File**: `src/actions/procedure-notes.ts`
**Changes**: In `regenerateProcedureNoteSectionAction`, assemble `otherSections` from the fetched note row and pass it.

```ts
// Near line 720 in regenerateProcedureNoteSectionAction:
const otherSections = Object.fromEntries(
  procedureNoteSections
    .filter((s) => s !== section)
    .map((s) => [s, (note[s] as string | null) ?? ''])
) as Partial<Record<ProcedureNoteSection, string>>

const toneHint = (note.tone_hint as string | null) ?? null
const result = await regenerateSectionAI(inputData, section, currentContent, toneHint, otherSections)
```

#### 4. Server action — Discharge section regen
**File**: `src/actions/discharge-notes.ts`
**Changes**: Same pattern using `dischargeNoteSections`.

#### 5. Unit tests for cross-section context
**File**: `src/lib/claude/__tests__/generate-procedure-note.test.ts`
**Changes**: Add tests for the `otherSections` parameter.

```ts
describe('cross-section awareness', () => {
  it('includes other sections block when provided', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: { content: 'x' }, rawResponse: {} })
    await regenerateProcedureNoteSection(
      fakeInputData,
      'subjective',
      'current subjective text',
      null,
      { assessment_and_plan: 'existing assessment text', prognosis: 'existing prognosis' },
    )
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.messages[0].content).toContain('OTHER SECTIONS CURRENTLY PRESENT')
    expect(opts.messages[0].content).toContain('existing assessment text')
    expect(opts.messages[0].content).toContain('existing prognosis')
  })

  it('excludes the target section from the other-sections block', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: { content: 'x' }, rawResponse: {} })
    await regenerateProcedureNoteSection(
      fakeInputData,
      'subjective',
      'current subjective',
      null,
      { subjective: 'SHOULD NOT APPEAR', prognosis: 'existing prognosis' },
    )
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.messages[0].content).not.toContain('SHOULD NOT APPEAR')
    expect(opts.messages[0].content).toContain('existing prognosis')
  })

  it('omits the other-sections block when all other sections are empty', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: { content: 'x' }, rawResponse: {} })
    await regenerateProcedureNoteSection(
      fakeInputData,
      'subjective',
      'current',
      null,
      { assessment_and_plan: '', prognosis: '   ' },
    )
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.messages[0].content).not.toContain('OTHER SECTIONS CURRENTLY PRESENT')
  })

  it('includes anti-duplication instruction in system prompt suffix', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: { content: 'x' }, rawResponse: {} })
    await regenerateProcedureNoteSection(fakeInputData, 'subjective', 'current', null, {
      assessment_and_plan: 'x',
    })
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.system).toContain('Avoid duplicating content that already appears')
  })
})
```

**File**: `src/lib/claude/__tests__/generate-discharge-note.test.ts`
**Changes**: Mirror the procedure tests.

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles: `npx tsc --noEmit`
- [ ] Linting passes: `npm run lint`
- [ ] New tests pass: `npx vitest run src/lib/claude`
- [ ] Existing tests still pass: `npx vitest run`

#### Manual Verification:
- [ ] **Procedure copy-paste fix**: generate a procedure note. Identify two sections with noticeably similar content (a common offender: `subjective` and `assessment_summary`). Regenerate one of them. Verify the new version does NOT repeat the other section's phrasing. Spot-check a few other section pairs.
- [ ] **Discharge copy-paste fix**: generate a discharge note. Identify repetition between `subjective` and `assessment` (likely hotspot per research). Regenerate `assessment`. Verify it does not duplicate the `subjective` trajectory narrative verbatim.
- [ ] **Empty-note edge case**: generate a note. Immediately regenerate one section before editing anything else. Verify network payload shows the other sections populated (from the DB, not empty).
- [ ] Verify no regression in generation latency — section regen with the full other-sections block should still return within normal bounds (typically < 15s for 4096 output tokens).

---

## Testing Strategy

### Unit Tests
- **Generator interpolation** (Phase 3): `toneHint` is appended under the exact labeled header when provided; suppressed when null / undefined / whitespace-only; applies to both full and section regen for both note types.
- **System prompt content** (Phase 5): each `SYSTEM_PROMPT` contains the precedence block.
- **Cross-section context** (Phase 6): `otherSections` is serialized into the expected block; target section is excluded; empty values are filtered; anti-duplication instruction appears in the system-prompt suffix.

### Integration Tests
No new integration tests required — the existing server-action tests already cover the full/regen flow, and the unit tests above cover the new surface area deterministically via mocked Claude calls.

### Manual Testing Steps
Full manual checklist is embedded in Phase 4 and Phase 6 success criteria. The critical end-to-end scenarios:

1. Pre-generation tone hint → persisted → applied on first generation.
2. Draft-editor edit of tone hint → auto-saved → applied on next section regen.
3. Retry from failed state → picks up the persisted hint.
4. Empty/whitespace hint → no trace in prompt, no regression.
5. Conflicting hint (e.g., "emphasize incomplete recovery" on discharge) → clinical numbers unchanged, phrasing/emphasis shifted.
6. Copy-paste regression check → regenerated section does not duplicate prose from other sections.

## Performance Considerations

- **Prompt size (Procedure section regen)**: worst-case 19 other sections, each up to ~1 page. Rough estimate: 3-4k tokens of "other sections" text added to the user message. Claude Opus 4.7 has a 200k input window; `maxTokens: 4096` is output-only. No cost concern.
- **Prompt caching**: the `SYSTEM_PROMPT` changes in Phase 5 invalidate the existing cache once per deploy (Anthropic cache is content-addressed). Single-session: cache-friendly because the system prompt is identical across requests in a session. User messages are not cached (per [thoughts/shared/research/2026-04-19-prompt-caching-current-state.md](thoughts/shared/research/2026-04-19-prompt-caching-current-state.md) this project does not use explicit cache markers), so the per-request `otherSections` block doesn't interact with caching.
- **Auto-save on blur**: a single UPDATE with no `revalidatePath`. Effectively free.

## Migration Notes

- The migration is additive and nullable — existing rows get `tone_hint = NULL`. No backfill needed.
- No rollback concerns: dropping a nullable column later is a single `ALTER TABLE ... DROP COLUMN` if the feature is ever removed.
- Finalized notes from before this migration remain correct (they never had a hint; the column stays NULL on historical rows).

## References

- Research document: [thoughts/shared/research/2026-04-19-tone-direction-for-procedure-and-discharge-notes.md](thoughts/shared/research/2026-04-19-tone-direction-for-procedure-and-discharge-notes.md)
- Reference implementation (Initial Visit `toneHint`):
  - [src/components/clinical/initial-visit-editor.tsx:294](src/components/clinical/initial-visit-editor.tsx#L294)
  - [src/components/clinical/initial-visit-editor.tsx:374-390](src/components/clinical/initial-visit-editor.tsx#L374-L390)
  - [src/lib/claude/generate-initial-visit.ts:492-498](src/lib/claude/generate-initial-visit.ts#L492-L498)
  - [src/lib/claude/__tests__/generate-initial-visit.test.ts:47-52](src/lib/claude/__tests__/generate-initial-visit.test.ts#L47-L52)
- Pattern for draft-editor auto-save of supplementary data (Discharge vitals):
  - [src/actions/discharge-notes.ts:778-825](src/actions/discharge-notes.ts#L778-L825) — `saveDischargeVitals` upsert pattern (model for `saveDischargeNoteToneHint`)
  - [src/actions/discharge-notes.ts:357-378](src/actions/discharge-notes.ts#L357-L378) — read-before-replace pattern (model for `tone_hint` preservation across full regen)
- Anti-repetition rules already in prompts:
  - [src/lib/claude/generate-procedure-note.ts:115](src/lib/claude/generate-procedure-note.ts#L115) — NO REPETITION
  - [src/lib/claude/generate-procedure-note.ts:123-128](src/lib/claude/generate-procedure-note.ts#L123-L128) — NO CLONE RULE
  - [src/lib/claude/generate-discharge-note.ts:138-139](src/lib/claude/generate-discharge-note.ts#L138-L139) — NO REPETITION
- Related prior research:
  - [thoughts/shared/research/2026-04-18-procedure-note-pain-persistence-tone.md](thoughts/shared/research/2026-04-18-procedure-note-pain-persistence-tone.md)
  - [thoughts/shared/research/2026-04-19-prompt-caching-current-state.md](thoughts/shared/research/2026-04-19-prompt-caching-current-state.md)