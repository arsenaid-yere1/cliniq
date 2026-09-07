# PRP Reassessment Interval Consistency Implementation Plan

## Overview

Align the PRP procedure-note generation instructions for Follow-Up Plan and Assessment and Plan. User authorized implementation after the PRP-specific research.

## Current State

`src/lib/claude/generate-procedure-note.ts` supplies two-week Follow-Up Plan examples, a one-week worsened-response exception, and a conflicting Assessment and Plan example of 10–14 days. Full generation and section regeneration share `systemPromptForProcedureType`. Generation validates strings rather than clinical timing. Existing prompt tests check response branches but not agreement between sections.

## Desired End State

Both PRP sections recommend reassessment in 2 weeks for routine follow-up. The existing worsened-response branch retains 1 week, and Assessment and Plan must use that same interval. Missing-vitals cadence remains the baseline cadence. Minimal improvement uses the routine cadence. Reassessment wording describes symptom, function, and treatment-response review without implying another injection is scheduled.

## Key Discoveries

Changing only the 10–14-day example would leave the worsened-response conflict and the regeneration instruction to avoid repeating information unresolved. Both require explicit cross-section guidance. The PRP rule must explicitly exclude other procedure types because BOTOX receives the base prompt with an appended override.

## What We Are Not Doing

No telehealth changes, retrospective record rewrites, database changes, automatic edits to clinician-authored text, or deployment. This fixes conflicting generation instructions; it does not guarantee model compliance or repair an untouched section of an existing note.

## Implementation Approach

Keep this a scoped prompt change in the existing generator, with a shared routine reassessment sentence used by its examples. Retain response-dependent narrative and the existing earlier-review exception.

## Phase 1: Align the prompt

### Files and changes

- `src/lib/claude/generate-procedure-note.ts`: add a PRP-specific interval consistency rule; share routine reassessment wording across references; remove the competing 10–14-day instruction; explicitly apply the same interval to Assessment and Plan including the worsened exception; clarify that repeating the interval during regeneration is permitted.

### Automated verification

- [x] Diff review confirms routine and worsened references agree across the two sections, with no changes to procedure-type routing.

### Manual verification

- [ ] Generate routine and worsened PRP drafts and inspect both sections; regenerate each timing section and inspect agreement. Requires a suitable clinician-reviewed case and live generation; not performed automatically against patient records.

## Phase 2: Regression verification

### Files and changes

- `src/lib/claude/__tests__/generate-procedure-note.test.ts`: cover cross-section wording, removal of old timing, preservation of the exception, and the rule reaching full generation and both section-regeneration calls.

### Automated verification

- [x] `npm test -- src/lib/claude/__tests__/generate-procedure-note.test.ts` — 151 passed, including three new regression cases.
- [x] `npx eslint src/lib/claude/generate-procedure-note.ts src/lib/claude/__tests__/generate-procedure-note.test.ts` — passed.
- [x] `npx tsc --noEmit` — passed.
- [x] `git diff --check` — passed.

## Risks and rollback considerations

Prompt tests verify model instructions, not live model adherence. Existing notes retain their saved text, and changing one section cannot repair a second section containing old wording. Rollback consists of reverting these generator and test edits.

## Completion criteria

Both sections receive consistent interval guidance, tests and static checks pass (or unrelated failures are reported), and remaining live verification is clearly disclosed.

## Plan verification

Ready. Verified generator entry points, response references, schema behavior, existing test patterns, and BOTOX routing against source. The revised scope addresses all identified prompt conflicts without imposing a new clinical timing policy or silently changing stored records. No material implementation questions remain.

## Implementation status

Both implementation phases completed locally. Automated checks passed; live generation and UI/PDF review remain unperformed. No deployment or patient-record edits were made. Existing notes need explicit editing or regeneration of affected sections to adopt the new wording.
