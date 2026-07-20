# Deprecate Initial Visit Range of Motion (ROM) Input — Implementation Plan

## Overview

Remove the Range of Motion input from the Initial Visit feature entirely at the application layer: the two editor tabs, the two ROM components, the prop chain, both server actions, the ROM field on the generation input, all ROM prompt instructions, the four Zod declarations, and the three test describe blocks.

The `initial_visit_notes.rom_data` jsonb column stays in the database, unread and unwritten. No migration, no data mutation, no change to any existing note.

## Current State Analysis

ROM is a self-contained vertical slice on the Initial Visit: its own schema trio + default template, its own get/save server action pair, its own editor component pair mounted in two places, and its own jsonb column. It is not part of `initialVisitSections`, `providerIntakeSchema`, or `initialVisitNoteEditSchema`, and it has no field in the PDF template or the Claude tool schema.

The one place ROM is not self-contained is the AI prompt. `romData` is a field on `InitialVisitInputData`, and the system prompt instructs the model to render it as `RANGE OF MOTION:` bullets **inside the `physical_exam` prose string**. The PDF has no ROM code at all — its generic ALL-CAPS-sub-heading and bullet detection is what styles that prose. So ROM's output path is prose-embedded, and ROM text in already-generated notes is frozen text, not something re-derived at render time.

Two secondary couplings: `romData` sits inside the object hashed by `computeSourceHash` (staleness detection), and a Pain Evaluation Visit reads the prior Initial Visit's `rom_data` as read-only comparison context.

Full surface map, verified at commit `62b9732`:

| Layer | Location |
|---|---|
| Schemas | [initial-visit-note.ts:114-226](../../../src/lib/validations/initial-visit-note.ts) — `romMovementSchema` (L114), `romRegionSchema` (L123), `initialVisitRomSchema` (L130), `defaultRomData` (L136-226), types at L121/L128/L132 |
| Actions | [initial-visit-notes.ts](../../../src/actions/initial-visit-notes.ts) — imports L18/L23, `gatherSourceData` param L67 + assignment L315, prior-visit select L79 + copy L260, `preservedRom` L350/L356, `noteRom` L862, `getInitialVisitRom` L1041-1057, `saveInitialVisitRom` L1061-1116 |
| UI | [initial-visit-editor.tsx](../../../src/components/clinical/initial-visit-editor.tsx) — imports L55/L67/L70/L76, `rom_data` type L109, prop chain L159/L188/L207/L262/L318/L610/L1644/L1656, pre-gen tab L434-437 + L457-459, DraftEditor tab L1902-1904, `RomInputCard` L1402-1490, `RomRegionSection` L1494-1634, comment L355 |
| Page | [initial-visit/page.tsx](../../../src/app/(dashboard)/patients/[caseId]/initial-visit/page.tsx) — import L10, `NoteRow.rom_data` L69, `romByVisitType` L122-125, prop L146 |
| Prompt | [generate-initial-visit.ts](../../../src/lib/claude/generate-initial-visit.ts) — bracket rule L61, render rule L63, PDF-safe rule L71, exam instructions L126-127, ROM reference format L130, prior-visit comparison L266, `romData` type L511-519, `priorVisitData.rom_data` L546 |
| Tests | [initial-visit-note.test.ts](../../../src/lib/validations/__tests__/initial-visit-note.test.ts) — imports L8-11, describes L134-167 / L169-190 / L192-233; [generate-initial-visit.test.ts](../../../src/lib/claude/__tests__/generate-initial-visit.test.ts) — fixture L29, prior-visit fixture L221 |
| DB | `initial_visit_notes.rom_data jsonb` — created [023_initial_visit_rom.sql](../../../supabase/migrations/023_initial_visit_rom.sql), recreated [20260309194935](../../../supabase/migrations/20260309194935_replace_initial_visit_notes_15_sections.sql):31, re-added if missing [20260325192359](../../../supabase/migrations/20260325192359_fix_initial_visit_missing_columns.sql):28 |

### Key Discoveries

- **ROM has two mount sites, not one.** `RomInputCard` renders in the pre-generation tab list ([initial-visit-editor.tsx:457-459](../../../src/components/clinical/initial-visit-editor.tsx)) *and* inside `DraftEditor` ([L1902-1904](../../../src/components/clinical/initial-visit-editor.tsx)). ROM is editable both before and after generation, which is why `initialRom` is threaded through `DraftEditor`'s props at L610/L1644/L1656.
- **The pre-gen mount has a fallback the post-gen mount lacks**: `initialRom ?? (note?.rom_data as InitialVisitRomValues | null)` (L458) vs plain `initialRom` (L1903). Both die together.
- **Generation never writes `rom_data`.** Every `.update()` in `generateInitialVisitNote` and `regenerateNoteSection` omits the column; ROM is read-only on that path. Only `saveInitialVisitRom` writes it.
- **The prompt already has the exact behavior we want** when ROM is absent: *"If romData is null entirely, do NOT include any ROM measurements or RANGE OF MOTION sub-headings — omit ROM from the note completely"* ([generate-initial-visit.ts:63](../../../src/lib/claude/generate-initial-visit.ts)). This is why Phase 2 is low-risk — we are making permanent a path the prompt already supports.
- **QC reads no ROM.** `generate-quality-review.ts`, `case-quality-reviews.ts`, and `src/lib/qc/` contain zero ROM references, so no QC rule breaks.
- **`rom_data` appears in 3 migrations, not 1** — relevant only if the column is ever dropped later; out of scope here.
- **Three ROM prompt edits are partial-line**, not whole-line deletions: L61 is one bullet inside the "NO UNNECESSARY BRACKETS" permitted-exceptions list, L126 has a trailing ROM clause on a sentence about region sub-sections, and L266 has a ROM clause in a longer comparison instruction. Deleting whole lines there would remove unrelated rules.

## Desired End State

- No ROM tab, component, or input exists anywhere in the Initial Visit editor, in either the pre-generation or draft state.
- `grep -rn "rom" src --include="*.ts" --include="*.tsx" -i` returns hits only in unrelated features (PT extraction, pain-management extraction) and in `src/types/database.ts`.
- Newly generated Initial Visit and Pain Evaluation Visit notes contain no `RANGE OF MOTION:` heading — verified by generating one of each.
- Existing finalized notes are byte-identical to before this change.
- `initial_visit_notes.rom_data` still exists in the database with all its current values intact.
- Typecheck, lint, and the full test suite pass.

## What We're NOT Doing

- **Not dropping or altering the `rom_data` column.** No migration in this plan. Existing values stay readable via SQL indefinitely.
- **Not mutating any stored `physical_exam` text.** Finalized notes are signed clinical documentation; their `RANGE OF MOTION:` bullets stay exactly as generated. There is no backfill script.
- **Not regenerating any existing note.** Notes only lose ROM if a provider chooses to regenerate them, which is normal existing behavior.
- **Not touching ROM in other features** — PT extraction (`pt_extractions.range_of_motion`, `romMeasurementSchema`), pain-management extraction (`normalizeRomArray`, `RomSection` in `pm-extraction-form.tsx`). Different tables, zero shared code.
- **Not regenerating `src/types/database.ts`.** The column still exists, so the generated types stay correct as-is.
- **Not adding a ROM-absence regression test.** Deleting the schemas makes reintroduction a visible, deliberate act.

## Implementation Approach

Three phases, ordered outside-in: UI → actions/prompt → schemas. Each phase leaves the tree compiling and the test suite green.

The ordering matters. Deleting the schema declarations first would simultaneously break the editor, the page, the actions, and the tests — one large red state with no intermediate checkpoint. Removing consumers before the thing they consume means every phase boundary is a clean `npm run typecheck`.

Phase 2 is where behavior actually changes: once `romData` stops being populated, the prompt's existing null-branch takes over and new notes omit ROM. Phase 3 is pure dead-code removal with no behavioral effect.

---

## Phase 1: Remove ROM from the UI

### Overview
Delete both ROM tabs, both ROM components, and the entire `initialRom` / `romByVisitType` prop chain. After this phase ROM is unreachable in the app, but the actions and schemas still exist and still compile.

### Changes Required:

#### 1. Initial Visit editor
**File**: `src/components/clinical/initial-visit-editor.tsx`
**Changes**: Delete both tab blocks, both components, and all ROM props.

- Remove `saveInitialVisitRom` from the `@/actions/initial-visit-notes` import (L55).
- Remove `initialVisitRomSchema` (L67), `defaultRomData` (L70), and `type InitialVisitRomValues` (L76) from the `@/lib/validations/initial-visit-note` import.
- Remove `rom_data: unknown` from the local note-row type (L109).
- Remove `romByVisitType` from the outer props interface (L159), its destructure (L207), and the `initialRom={romByVisitType[vt.value]}` pass-down (L262).
- Remove `initialRom` from the inner props interface (L188) and its destructure (L318).
- Update the comment at L355 — it currently reads "A note row may exist with only rom_data/vitals but no generated sections yet". The condition it describes still holds for vitals; drop the `rom_data/` mention rather than the whole comment.
- Delete the pre-generation `TabsTrigger value="rom"` block (L434-437) and its `TabsContent` (L457-459).
- Remove `initialRom={initialRom}` from the `DraftEditor` call (L610).
- Delete `RomInputCard` in full (L1402-1490).
- Delete `RomRegionSection` in full (L1494-1634).
- Remove `initialRom` from `DraftEditor`'s destructure (L1644) and props interface (L1656).
- Delete the DraftEditor `TabsContent value="rom"` block (L1902-1904) and its corresponding `TabsTrigger` in the same `TabsList`.
- Remove the `Activity` icon from the `lucide-react` import **only if** no other component in the file uses it — check before deleting.
- Update the reset-confirmation dialog copy at L556, which currently promises "Your intake data ... vitals, and ROM data will be preserved." Drop the ROM clause.

#### 2. Initial Visit page
**File**: `src/app/(dashboard)/patients/[caseId]/initial-visit/page.tsx`
**Changes**: Remove ROM fetching and prop plumbing.

- Remove `type InitialVisitRomValues` from the L10 import, keeping `providerIntakeSchema`.
- Remove `rom_data: unknown` from the `NoteRow` type (L69).
- Delete the `romByVisitType` object (L122-125).
- Remove `romByVisitType={romByVisitType}` from the `<InitialVisitEditor>` call (L146).

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npx tsc --noEmit` (no `typecheck` script exists in package.json)
- [x] Linting passes: `npm run lint` (1 pre-existing error in `invite-user-dialog.tsx:62`, unrelated to ROM and untouched by this change)
- [x] Test suite passes: `npm test` — 71 files, 1162 tests
- [x] No ROM UI symbols remain: `grep -rn "RomInputCard\|RomRegionSection\|romByVisitType\|initialRom" src` returns nothing
- [x] Build succeeds: `npm run build`

#### Manual Verification:
- [ ] Open an Initial Visit with no generated note — tab strip shows Chief Complaints through Vital Signs, no "Range of Motion" tab
- [ ] Generate a note, then open the draft editor — no "Range of Motion" tab there either
- [ ] Both tab strips still switch cleanly between remaining tabs, no layout gap or dead tab slot
- [ ] Vital Signs tab still saves correctly (it is the closest sibling to the removed code)
- [ ] Repeat on a Pain Evaluation Visit
- [ ] Reset dialog copy reads correctly without the ROM clause

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Remove ROM from server actions and the AI prompt

### Overview
Delete both ROM server actions and strip `romData` from the generation input and every ROM instruction from the system prompt. This is the phase where behavior changes: new notes stop containing ROM.

### Changes Required:

#### 1. Initial Visit server actions
**File**: `src/actions/initial-visit-notes.ts`
**Changes**: Delete the ROM action pair and all ROM threading.

- Remove `initialVisitRomSchema` (L18) and `type InitialVisitRomValues` (L23) from the validations import.
- Remove the `romData?: InitialVisitRomValues | null` parameter from `gatherSourceData` (L67) and the `romData: romData ?? null` assignment (L315). Update the L70-72 comment that describes intake + ROM + vitals scoping.
- Remove `rom_data` from the prior-visit select list (L79) and delete the `rom_data: priorVisitRow.rom_data ?? null` copy (L260).
- In `generateInitialVisitNote`: remove `rom_data` from the select at L350, delete `preservedRom` (L356), and drop the argument from the `gatherSourceData` call (L362-368). Update the "Gather source data (include ROM)" comment at L361.
- In `regenerateNoteSection`: delete `noteRom` (L862) and drop the argument from its `gatherSourceData` call (L862-870).
- Update the comment at L800 that lists `rom_data` among preserved columns.
- Delete `getInitialVisitRom` in full (L1041-1057).
- Delete `saveInitialVisitRom` in full (L1061-1116).

**Note on `computeSourceHash`**: no code change needed. It hashes `JSON.stringify(inputData)`, and `romData` simply stops being a key. This *does* change the hash for every case, so all existing notes will read as stale on the next staleness check — expected and acceptable, since a stale flag prompts an optional regeneration rather than mutating anything.

#### 2. Initial Visit generation module
**File**: `src/lib/claude/generate-initial-visit.ts`
**Changes**: Remove the `romData` input field and every ROM prompt instruction.

- Delete the `romData` field from `InitialVisitInputData` (L511-519).
- Delete `rom_data: unknown | null` from `priorVisitData` (L546).
- **L61 — partial-line edit.** Delete only the ROM bullet from the permitted-brackets list:
  ```
  • ROM "actual" values when the per-movement measurement is null: use "[XX]" for the actual number only.
  ```
  Leave the vital-signs bullet (L60) and diagnosis-description bullet (L62) intact.
- **L63 — whole-line delete.** The entire `If romData is provided...omit ROM from the note completely.` paragraph goes.
- **L71 — whole-line delete.** `• For ROM data, use "• Flexion: ..." format. NEVER use pipe tables.`
- **L126 — partial-line edit.** The sentence currently ends `...palpation levels, and optionally a "RANGE OF MOTION:" sub-heading with "• " bullet per movement (only if ROM data is provided).` Truncate it to end after `palpation levels.` — the region sub-section instruction itself stays.
- **L127 — whole-line delete.** The `If ROM data (romData) is provided...` paragraph.
- **L130 — whole-line delete.** `Reference ROM format: "• Flexion: Normal 60° / Actual 60° / Pain: No\n• Extension: ..."`
- **L266 — partial-line edit.** Remove the comparative-ROM sentence and the `priorVisitData.rom_data` reference from the Pain Evaluation Visit instruction, leaving the surrounding rule (do not restate prior exam findings; current findings come from `providerIntake.exam_findings`) and the `priorVisitData.physical_exam` reference intact.

#### 3. Generation test fixtures
**File**: `src/lib/claude/__tests__/generate-initial-visit.test.ts`
**Changes**: Remove `romData: null` from the base input fixture (L29) and `rom_data: null` from the prior-visit fixture (L221). Both become type errors once the fields are gone.

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npx tsc --noEmit`
- [x] Linting passes: `npm run lint` (same 41 problems / 1 pre-existing error as before Phase 2 — no new issues)
- [x] Test suite passes: `npm test` — 71 files, 1162 tests
- [x] Initial visit generation tests pass specifically: covered by the full run
- [x] No ROM references in actions or generation: verified with word-boundary grep `\bROM\b|\brom_data\b|\bromData\b|[Rr]ange of [Mm]otion`. One intentional survivor: the Medical Necessity **prose example** at `generate-initial-visit.ts:209` ("restricted range of motion") — clinical narrative vocabulary, not a ROM measurement instruction.
- [x] Build succeeds: `npm run build`

#### Deviations found during implementation (not in the original plan):
- **Tool-schema description** at `generate-initial-visit.ts:415` said `physical_exam` contains "ROM (if provided)". Not listed in the plan; removed.
- **Second prior-visit ROM reference** at `generate-initial-visit.ts:256` ("DO NOT copy its physical exam findings, vitals, or ROM values"). Not listed; ROM clause removed.
- **Explicit ROM prohibition added.** Plan said only to truncate the L126 sentence. Deleting the surrounding lines also removed the old "if romData is null, omit ROM" guard, leaving nothing forbidding ROM. Added `DO NOT include any "RANGE OF MOTION:" sub-heading or range-of-motion measurements in the physical exam.` in its place.
- **Prior-visit comparison sentence** reworded from "cervical ROM has [improved/...]" to "cervical examination findings have [improved/...]" since `priorVisitData.rom_data` no longer exists as a comparison basis.
- `resetInitialVisitNote` never nulled `rom_data` (it only nulls AI fields), so legacy ROM values survive a reset — comment updated, behavior unchanged.

#### Manual Verification:
- [ ] Generate a fresh Initial Visit note — Physical Examination contains VITAL SIGNS, GENERAL, per-region findings, and NEUROLOGICAL, with no `RANGE OF MOTION:` heading
- [ ] The remaining Physical Examination sections read coherently — no dangling sentence fragment where the L126 clause was truncated
- [ ] Generate a Pain Evaluation Visit on a case that has a prior finalized Initial Visit — the prior-visit comparison prose still works and makes no ROM claim
- [ ] Regenerate a single Physical Examination section via per-section regeneration — succeeds, no ROM
- [ ] Open a previously finalized note — its stored ROM text is still displayed, unchanged
- [ ] Download a PDF of a previously finalized note — the old ROM bullets still render correctly

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Remove ROM schemas and tests

### Overview
Delete the four ROM declarations and their tests. Pure dead-code removal — no remaining consumers after Phases 1 and 2, so no behavioral effect.

### Changes Required:

#### 1. Validation schemas
**File**: `src/lib/validations/initial-visit-note.ts`
**Changes**: Delete the contiguous ROM block at L114-226:
- `romMovementSchema` (L114-119) and `type RomMovement` (L121)
- `romRegionSchema` (L123-126) and `type RomRegion` (L128)
- `initialVisitRomSchema` (L130) and `type InitialVisitRomValues` (L132)
- `defaultRomData` (L136-226)

Everything above (sections, labels, vitals) and below (chief complaints, accident details, PMH, social history, exam findings, provider intake) is untouched.

#### 2. Validation tests
**File**: `src/lib/validations/__tests__/initial-visit-note.test.ts`
**Changes**: Remove the four ROM imports (L8-11) and delete three describe blocks: `romMovementSchema` (L134-167), `romRegionSchema` (L169-190), `defaultRomData` (L192-233). Remaining describes for sections, vitals, and intake schemas stay.

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npx tsc --noEmit`
- [x] Linting passes: `npm run lint` (same 41 problems / 1 pre-existing error — no new issues)
- [x] Full test suite passes: `npm test` — 71 files, 1149 tests (was 1162; −13 deleted ROM assertions, no file emptied)
- [x] Validation tests pass specifically: covered by the full run
- [x] No ROM symbols anywhere in app code: `grep -rn "romMovementSchema\|romRegionSchema\|initialVisitRomSchema\|defaultRomData\|InitialVisitRomValues" src` returns nothing
- [x] Initial-visit ROM fully gone: verified with word-boundary `grep -rnE "\brom_data\b|\bromData\b"` (the plain `romData` grep produces false positives — it substring-matches `generateInitialVisitFromData`, `generateDischargeNoteFromData`, etc.)
- [x] Build succeeds: `npm run build`

#### Manual Verification:
- [ ] Full Initial Visit flow end to end: fill intake → vitals → set visit date → generate → edit draft → finalize → download PDF
- [ ] Same flow for a Pain Evaluation Visit
- [ ] Case quality review runs on a generated note without error
- [ ] Confirm in SQL that ROM data is retained: `select count(*) from initial_visit_notes where rom_data is not null;` returns the same count as before the change

---

## Testing Strategy

### Unit Tests:
- Deleting the three ROM describes is the only test change beyond fixtures. Remaining describes in `initial-visit-note.test.ts` must still pass untouched — they are the regression signal that the schema-file edit did not overreach.
- `generate-initial-visit.test.ts` fixture edits (`romData`, `rom_data`) are mechanical; all existing assertions in that file must still pass, confirming prompt-building still works after the ROM instruction removals.

### Integration Tests:
- Generating both visit types is the real integration test — it exercises `gatherSourceData` → `InitialVisitInputData` → prompt → tool response → stored sections.
- Per-section regeneration of Physical Examination specifically exercises the `regenerateNoteSection` path where `noteRom` was removed.

### Manual Testing Steps:
1. Pre-generation Initial Visit editor: confirm no ROM tab, confirm Vital Signs still saves.
2. Generate an Initial Visit; read the Physical Examination section closely for a truncated or dangling sentence from the L126 partial edit.
3. Open the draft editor: confirm no ROM tab, confirm section edits still save.
4. Generate a Pain Evaluation Visit on a case with a prior finalized Initial Visit; confirm comparison prose is coherent and makes no ROM claim.
5. Regenerate the Physical Examination section alone; confirm success and no ROM.
6. Open a note finalized *before* this change; confirm its ROM text still displays and its PDF still renders those bullets.
7. Run the SQL count to confirm `rom_data` values are retained.

## Performance Considerations

Marginally shorter system prompt (~8 fewer lines) and one fewer field in the serialized input — a small token reduction per generation, no measurable latency change.

One operational note: removing `romData` from `InitialVisitInputData` changes the `computeSourceHash` output for every case, so all existing notes will show as stale on their next staleness check. This is a one-time UI flag, not a data change; providers may regenerate or ignore it.

## Migration Notes

No database migration. `initial_visit_notes.rom_data` keeps its definition and all values, becoming an orphaned column that no application code reads or writes.

Rollback within a release is a straight `git revert` — the column is still there, so reverted code finds its data intact.

If the column is ever dropped in a future change, note it is referenced by three migrations ([023](../../../supabase/migrations/023_initial_visit_rom.sql), [20260309194935](../../../supabase/migrations/20260309194935_replace_initial_visit_notes_15_sections.sql):31, [20260325192359](../../../supabase/migrations/20260325192359_fix_initial_visit_missing_columns.sql):28) and that `src/types/database.ts` would need regenerating.

## References

- Research: `thoughts/shared/research/2026-07-20-initial-visit-rom-input.md`
- Original feature plan: `thoughts/shared/plans/2026-03-09-epic-3-story-3.1-initial-visit-note.md`
- ROM schema test coverage origin: `thoughts/shared/plans/2026-03-15-complete-validation-schema-test-coverage.md`
- Sibling pattern to preserve (vitals, structurally identical to ROM): `src/components/clinical/initial-visit-editor.tsx:1190` (`VitalSignsCard`), `src/actions/initial-visit-notes.ts:964-1037`
