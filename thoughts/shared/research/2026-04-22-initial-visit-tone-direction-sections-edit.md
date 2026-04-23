---
date: 2026-04-22T17:09:05-07:00
researcher: arsenaid
git_commit: 2d54dacad443ed6dc8f8c5177bf29045756af15e
branch: main
repository: cliniq
topic: "Adding Tone & Direction (optional) to Initial Visit sections edit view"
tags: [research, codebase, initial-visit, tone-direction, clinical-notes, sections-editor]
status: complete
last_updated: 2026-04-22
last_updated_by: arsenaid
---

# Research: Adding Tone & Direction (optional) to Initial Visit sections edit view

**Date**: 2026-04-22T17:09:05-07:00
**Researcher**: arsenaid
**Git Commit**: 2d54dacad443ed6dc8f8c5177bf29045756af15e
**Branch**: main
**Repository**: cliniq

## Research Question

Document where the "Initial Visit" sections edit UI lives, where the existing "Tone & Direction (optional)" component is implemented, how the sibling editors (Procedure, Discharge) integrate that component during their draft/edit state, and the server-action + database + AI-layer surfaces involved — to inform adding a `Tone & Direction (optional)` card to the Initial Visit sections edit view.

## Summary

The `ToneDirectionCard` component already exists as a shared, reusable primitive at [src/components/clinical/tone-direction-card.tsx](src/components/clinical/tone-direction-card.tsx). It is currently used by:

1. **Procedure Note editor** ([src/components/procedures/procedure-note-editor.tsx](src/components/procedures/procedure-note-editor.tsx)) — in both the pre-generation state AND the draft/edit state, with on-blur persistence to `procedure_notes.tone_hint`.
2. **Discharge Note editor** ([src/components/discharge/discharge-note-editor.tsx](src/components/discharge/discharge-note-editor.tsx)) — likewise, with on-blur persistence to `discharge_notes.tone_hint`.

For **Initial Visit**, the tone-hint facility is **only present in the pre-generation state** and is an **inline Card**, not the shared `ToneDirectionCard` component. It is held in local `useState` ([initial-visit-editor.tsx:316](src/components/clinical/initial-visit-editor.tsx#L316)), rendered inline at [initial-visit-editor.tsx:435-451](src/components/clinical/initial-visit-editor.tsx#L435-L451), and passed as an argument to `generateInitialVisitNote(caseId, visitType, toneHint)`. **It is never persisted** — the `initial_visit_notes` table has no `tone_hint` column, and the Initial Visit draft/edit view (`DraftEditView`) does not render any tone-hint card. The section-regeneration action `regenerateNoteSection` and its AI-layer counterpart `regenerateSection` do **not** currently accept a tone-hint parameter.

The Initial Visit sections edit UI is at [initial-visit-editor.tsx:1789-1849](src/components/clinical/initial-visit-editor.tsx#L1789-L1849), inside a `<TabsContent value="note">` block: it maps over the 16-entry `initialVisitSections` array and renders a `<FormField>`/`<Textarea>` with a per-section Regenerate button for each.

## Detailed Findings

### 1. The shared `ToneDirectionCard` component

Defined in [src/components/clinical/tone-direction-card.tsx:1-42](src/components/clinical/tone-direction-card.tsx#L1-L42) (41 lines total).

Props:
- `value: string`
- `onChange: (value: string) => void`
- `onBlur?: () => void`
- `disabled?: boolean`
- `description?: string` — optional override for the default description string

Key markup ([lines 24-40](src/components/clinical/tone-direction-card.tsx#L24-L40)):
```tsx
<Card>
  <CardHeader>
    <CardTitle className="text-base">Tone & Direction (optional)</CardTitle>
    <CardDescription>{description ?? DEFAULT_DESCRIPTION}</CardDescription>
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
```

`DEFAULT_DESCRIPTION` ([line 14-15](src/components/clinical/tone-direction-card.tsx#L14-L15)):
> "Provide optional guidance to influence the AI's writing style and emphasis. Applied to full generation and per-section regeneration."

### 2. Initial Visit sections data model

[src/lib/validations/initial-visit-note.ts:5-22](src/lib/validations/initial-visit-note.ts#L5-L22) — `initialVisitSections` is a frozen 16-entry array:

```ts
export const initialVisitSections = [
  'introduction',
  'history_of_accident',
  'post_accident_history',
  'chief_complaint',
  'past_medical_history',
  'social_history',
  'review_of_systems',
  'physical_exam',
  'imaging_findings',
  'diagnoses',
  'medical_necessity',
  'treatment_plan',
  'patient_education',
  'prognosis',
  'time_complexity_attestation',
  'clinician_disclaimer',
] as const
```

[initial-visit-note.ts:28-45](src/lib/validations/initial-visit-note.ts#L28-L45) — `sectionLabels: Record<InitialVisitSection, string>` maps each key to a display label.

[initial-visit-note.ts:72-95](src/lib/validations/initial-visit-note.ts#L72-L95) — `initialVisitNoteEditSchema` is the Zod schema for the edit form; every section string is `.min(1, '… is required')` (all sections required). A `visit_date` field is `.nullable()`.

No section definition carries an `optional: true` flag or metadata. Section-level optionality is not a concept in this schema.

### 3. Initial Visit editor file — structural map

File: [src/components/clinical/initial-visit-editor.tsx](src/components/clinical/initial-visit-editor.tsx) (2285 lines).

Key line ranges:
- [L65-L66](src/components/clinical/initial-visit-editor.tsx#L65-L66) — imports `initialVisitSections`, `sectionLabels` from the validation module.
- [L278](src/components/clinical/initial-visit-editor.tsx#L278) — `sectionRows: Record<InitialVisitSection, number>` — per-section textarea row heights.
- [L316](src/components/clinical/initial-visit-editor.tsx#L316) — `const [toneHint, setToneHint] = useState('')` in the outer `InitialVisitEditorInner` component (kept local, not persisted).
- [L323-L335](src/components/clinical/initial-visit-editor.tsx#L323-L335) — `runGenerate(toneHintArg)` wraps `generateInitialVisitNote(caseId, visitType, toneHintArg)`.
- [L376-L468](src/components/clinical/initial-visit-editor.tsx#L376-L468) — **pre-generation render path**: tabs for intake cards, THEN the inline "Tone & Direction (optional)" Card, THEN the Generate button.
  - Inline Tone Card at [L435-L451](src/components/clinical/initial-visit-editor.tsx#L435-L451). Description text differs from the shared component's default: "This is used only for the initial generation." — reflecting the current Initial Visit behavior where tone is not reused by regeneration.
- [L472-L490](src/components/clinical/initial-visit-editor.tsx#L472-L490) — "Generating" state skeleton.
- [L1663-L1675](src/components/clinical/initial-visit-editor.tsx#L1663-L1675) — `handleRegenerate(section)` inside `DraftEditView`: calls `regenerateNoteSection(caseId, visitType, section)` with **no tone-hint argument**.
- [L1773-L1858](src/components/clinical/initial-visit-editor.tsx#L1773-L1858) — draft-edit `Tabs` shell with three tab values: `note`, `vitals`, `rom`.
- **[L1789-L1849](src/components/clinical/initial-visit-editor.tsx#L1789-L1849)** — the **section edit form**:
  ```tsx
  <TabsContent value="note" className="mt-4">
    <Form {...form}>
      <form className="space-y-6">
        {initialVisitSections.map((section) => (
          <FormField
            key={section}
            control={form.control}
            name={section}
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between">
                  <FormLabel className="text-base font-semibold">
                    {sectionLabels[section]}
                  </FormLabel>
                  {/* AlertDialog + Regenerate button */}
                </div>
                <FormControl>
                  <Textarea {...field} rows={sectionRows[section]} className="resize-y" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ))}
      </form>
    </Form>
  </TabsContent>
  ```
  No `ToneDirectionCard` is rendered here; the `toneHint` useState in the outer component is defined but never reached from this view (the outer component re-mounts `DraftEditView` on draft; the `toneHint` setter on the parent belongs to the pre-generation branch).

- [L2042-L2048](src/components/clinical/initial-visit-editor.tsx#L2042-L2048) — finalized (read-only) view rendering section headings from `sectionLabels`.

### 4. Procedure Note editor — reference integration pattern

File: [src/components/procedures/procedure-note-editor.tsx](src/components/procedures/procedure-note-editor.tsx) (893 lines).

- [L41](src/components/procedures/procedure-note-editor.tsx#L41) — imports `saveProcedureNoteToneHint` server action.
- [L44](src/components/procedures/procedure-note-editor.tsx#L44) — imports `ToneDirectionCard`.
- **Pre-generation usage** at [L250-L253](src/components/procedures/procedure-note-editor.tsx#L250-L253):
  ```tsx
  <ToneDirectionCard
    value={toneHint}
    onChange={setToneHint}
    disabled={isLocked || isPending}
  />
  ```
  Before Generate button; `toneHint` passed to `runGenerate(toneHint || null)` at [L262](src/components/procedures/procedure-note-editor.tsx#L262).
- **Draft/edit usage** at [L595-L603](src/components/procedures/procedure-note-editor.tsx#L595-L603), rendered INSIDE the `<Form>`, BEFORE the section loop:
  ```tsx
  <Form {...form}>
    <form className="space-y-6">
      <ToneDirectionCard
        value={toneHint}
        onChange={setToneHint}
        onBlur={handleToneHintBlur}
        disabled={isLocked || isPending}
        description="Edits apply to subsequent section regenerations. Saved automatically on blur."
      />
      {procedureNoteSections.map((section) => (
        …
      ))}
    </form>
  </Form>
  ```
- Draft-state tone state init at [L417](src/components/procedures/procedure-note-editor.tsx#L417): `useState<string>(note.tone_hint ?? '')` — hydrated from DB.
- Blur handler at [L428-L432](src/components/procedures/procedure-note-editor.tsx#L428-L432):
  ```ts
  function handleToneHintBlur() {
    void saveProcedureNoteToneHint(procedureId, caseId, toneHint || null).then((result) => {
      if (result.error) toast.error(result.error)
    })
  }
  ```

### 5. Discharge Note editor — same pattern

File: [src/components/discharge/discharge-note-editor.tsx](src/components/discharge/discharge-note-editor.tsx).

- [L46](src/components/discharge/discharge-note-editor.tsx#L46) — imports `saveDischargeNoteToneHint`.
- [L487-L491](src/components/discharge/discharge-note-editor.tsx#L487-L491) — blur handler that calls `saveDischargeNoteToneHint(caseId, toneHint || null)`.

### 6. Server actions — tone-hint surfaces per feature

**Procedure**: [src/actions/procedure-notes.ts](src/actions/procedure-notes.ts)
- [L542-L557](src/actions/procedure-notes.ts#L542-L557) — generate flow reads existing `tone_hint` for preservation on Retry; falls back to existing when arg is null/empty.
- [L601, L627](src/actions/procedure-notes.ts#L601) — writes `tone_hint` into the `procedure_notes` row on insert/update during generation.
- [L648](src/actions/procedure-notes.ts#L648) — passes `effectiveToneHint` into `generateProcedureNoteFromData`.
- [L1018](src/actions/procedure-notes.ts#L1018) — regeneration action reads `note.tone_hint` from DB row.
- [L1045](src/actions/procedure-notes.ts#L1045) — passes that `toneHint` into `regenerateSectionAI`.
- [L1047-L1073](src/actions/procedure-notes.ts#L1047-L1073) — `saveProcedureNoteToneHint(procedureId, caseId, toneHint)` server action that updates `tone_hint` column.

**Discharge**: [src/actions/discharge-notes.ts](src/actions/discharge-notes.ts)
- [L553](src/actions/discharge-notes.ts#L553) — `generateDischargeNote` signature accepts `toneHint?: string | null`.
- [L575](src/actions/discharge-notes.ts#L575) — selects `tone_hint` with existing-note fetch.
- [L602-L604](src/actions/discharge-notes.ts#L602-L604) — same normalize + preserve pattern as procedure.
- [L670](src/actions/discharge-notes.ts#L670) — writes `tone_hint` during generation.
- [L1038](src/actions/discharge-notes.ts#L1038) — regen reads `note.tone_hint`.
- [L1045](src/actions/discharge-notes.ts#L1045) — passes into `regenerateSectionAI`.
- [L1276-L1313](src/actions/discharge-notes.ts#L1276-L1313) — `saveDischargeNoteToneHint(caseId, toneHint)` action.

**Initial Visit**: [src/actions/initial-visit-notes.ts](src/actions/initial-visit-notes.ts)
- [L318-L321](src/actions/initial-visit-notes.ts#L318-L321) — `generateInitialVisitNote(caseId, visitType, toneHint?)` — accepts toneHint.
- [L430](src/actions/initial-visit-notes.ts#L430) — passes `toneHint` into `generateInitialVisitFromData(inputData, visitType, toneHint)`.
- [L521](src/actions/initial-visit-notes.ts#L521) — `saveInitialVisitNote(caseId, visitType, values)` — **does not** touch tone_hint.
- [L741-L819](src/actions/initial-visit-notes.ts#L741-L819) — `regenerateNoteSection(caseId, visitType, section)` — **does not accept a toneHint parameter**, does not read `tone_hint`, calls `regenerateSectionAI(inputData, visitType, section, currentContent, otherSections)` at L802 without a tone-hint argument.
- **No `saveInitialVisitNoteToneHint` action exists.**

### 7. AI generation layer — tone-hint surfaces

**Initial Visit**: [src/lib/claude/generate-initial-visit.ts](src/lib/claude/generate-initial-visit.ts)
- [L567-L583](src/lib/claude/generate-initial-visit.ts#L567-L583) — `generateInitialVisitFromData(inputData, visitType, toneHint?)` appends to the user message when `toneHint?.trim()` is truthy:
  ```ts
  if (toneHint?.trim()) {
    userMessage += `\n\nADDITIONAL TONE/DIRECTION GUIDANCE FROM THE PROVIDER:\n${toneHint.trim()}`
  }
  ```
- [L619](src/lib/claude/generate-initial-visit.ts#L619) — `regenerateSection(inputData, visitType, section, currentContent, otherSections?)` — **no toneHint parameter**. Neither the systemPrompt nor userMessage in this function incorporate a tone hint.

**Procedure**: [src/lib/claude/generate-procedure-note.ts](src/lib/claude/generate-procedure-note.ts) — both the full-generation and section-regen entry points accept and thread `toneHint`.

**Discharge**: [src/lib/claude/generate-discharge-note.ts](src/lib/claude/generate-discharge-note.ts) — same.

### 8. Database schema — `tone_hint` column presence

[src/types/database.ts](src/types/database.ts) (Supabase-generated types):

| Table | tone_hint column |
|---|---|
| `initial_visit_notes` ([L1127-L1275](src/types/database.ts#L1127-L1275)) | **NOT present** |
| `procedure_notes` ([L2079, L2121, L2163](src/types/database.ts#L2079)) | `string \| null` (Row/Insert/Update) |
| `discharge_notes` ([L843, L887, L931](src/types/database.ts#L843)) | `string \| null` (Row/Insert/Update) |

Migration that added the column for procedure and discharge:
- [supabase/migrations/20260422_procedure_and_discharge_tone_hint.sql](supabase/migrations/20260422_procedure_and_discharge_tone_hint.sql)

No migration currently adds `tone_hint` to `initial_visit_notes`.

### 9. "(optional)" label convention across the codebase

The codebase has a single dominant convention: append the literal string `" (optional)"` (with leading space) inside the label text itself (`FormLabel` or `CardTitle`). No separate component, badge, or className is used.

Examples:
- `<FormLabel>Firm Name (optional)</FormLabel>` — [src/components/attorneys/attorney-form.tsx:106](src/components/attorneys/attorney-form.tsx#L106)
- `<FormLabel>Middle Name (optional)</FormLabel>` — [src/components/patients/wizard-step-identity.tsx:106](src/components/patients/wizard-step-identity.tsx#L106)
- `<FormLabel>Accident Date (optional)</FormLabel>` — [src/components/patients/wizard-step-details.tsx:139](src/components/patients/wizard-step-details.tsx#L139)
- `<CardTitle className="text-base">Tone & Direction (optional)</CardTitle>` — [src/components/clinical/tone-direction-card.tsx:27](src/components/clinical/tone-direction-card.tsx#L27) and [src/components/clinical/initial-visit-editor.tsx:437](src/components/clinical/initial-visit-editor.tsx#L437)

Zod fields for these labels are `.optional()` or `.optional().or(z.literal(''))`. One-off informal variant (placeholder only): [src/components/billing/create-invoice-dialog.tsx:606](src/components/billing/create-invoice-dialog.tsx#L606).

## Code References

- `src/components/clinical/tone-direction-card.tsx:1-42` — reusable `ToneDirectionCard` component.
- `src/components/clinical/initial-visit-editor.tsx:316` — `toneHint` local state (outer component, pre-generation scope).
- `src/components/clinical/initial-visit-editor.tsx:435-451` — inline Tone & Direction Card in pre-generation view.
- `src/components/clinical/initial-visit-editor.tsx:1789-1849` — Initial Visit sections edit form (no tone card rendered).
- `src/components/clinical/initial-visit-editor.tsx:1663-1675` — `handleRegenerate` in draft-edit view (no tone-hint threaded).
- `src/components/procedures/procedure-note-editor.tsx:44,250-253,417,428-432,595-603` — procedure editor's full integration pattern (pre-gen card, draft-state card, on-blur save).
- `src/components/discharge/discharge-note-editor.tsx:46,487-491` — discharge editor's blur handler.
- `src/lib/validations/initial-visit-note.ts:5-22` — 16 sections defining Initial Visit structure.
- `src/lib/validations/initial-visit-note.ts:28-45` — section labels.
- `src/lib/validations/initial-visit-note.ts:72-95` — edit schema (all sections required).
- `src/actions/initial-visit-notes.ts:318,430,521,741-819` — generate/save/regenerate actions.
- `src/lib/claude/generate-initial-visit.ts:567-583` — full-generation tone-hint ingestion.
- `src/lib/claude/generate-initial-visit.ts:619-660` — section regeneration (no tone-hint today).
- `src/actions/procedure-notes.ts:1047-1073` — `saveProcedureNoteToneHint` server action (reference).
- `src/actions/discharge-notes.ts:1276-1313` — `saveDischargeNoteToneHint` server action (reference).
- `src/types/database.ts:1127-1275` — `initial_visit_notes` table type (no tone_hint column).
- `src/types/database.ts:2079,843` — `procedure_notes.tone_hint`, `discharge_notes.tone_hint`.
- `supabase/migrations/20260422_procedure_and_discharge_tone_hint.sql` — migration that added tone_hint to procedure and discharge.

## Architecture Documentation

**Three clinical-note features, two integration shapes for Tone & Direction.**

- **Shared component**: `ToneDirectionCard` is the canonical reusable UI for the Tone & Direction feature. It lives at `src/components/clinical/tone-direction-card.tsx`. Its prop contract supports both "unsaved transient" (pre-generation: no `onBlur`, value in local state) and "persisted with on-blur save" (draft-edit: `onBlur` provided) usages.

- **Procedure & Discharge**: end-to-end tone-hint support. The editors render `ToneDirectionCard` in both the pre-generation state and the draft/edit state. The draft-state card is hydrated from `note.tone_hint` in the DB and persisted on blur via dedicated `saveProcedure/DischargeNoteToneHint` server actions that write to a `tone_hint` column on the note row. The full generation action reads a passed or preserved `tone_hint`, writes it onto the row, and forwards it to the AI-layer `generate…FromData`. Section regeneration reads `note.tone_hint` from the DB and forwards it into the AI-layer `regenerateSection…` function.

- **Initial Visit**: partial tone-hint support. The editor renders an inline Card (not the shared component) only in the pre-generation state. `toneHint` is local React state, never persisted; the `initial_visit_notes` table has no `tone_hint` column; there is no `saveInitialVisitNoteToneHint` action. The full-generation path accepts a `toneHint` argument and forwards it to the Claude user-message suffix. The section-regeneration path (`regenerateNoteSection` → `regenerateSection`) does not accept or use tone hints today. The draft/edit view at `initial-visit-editor.tsx:1789-1849` renders `<FormField>`s over `initialVisitSections` without any surrounding or preceding `ToneDirectionCard`.

**Section-edit UI pattern (shared across all three)**: a `<Form>` wrapping a `.map()` over a `constSections` array, where each iteration renders a `FormField` / `FormItem` with `FormLabel` (section name from `sectionLabels`) + a ghost "Regenerate" button opening an `AlertDialog` that calls a `regenerate…NoteSection` server action, which writes the returned content back into the form via `form.setValue(section, result.data.content)`.

**Optional-field labeling convention**: literal `" (optional)"` appended to label text (both in `FormLabel` for small fields and `CardTitle` for whole-section cards). No badge, no styling, no metadata flag. The Tone & Direction Card already exemplifies this at the section-card level.

## Related Research

- `thoughts/shared/research/2026-04-20-vitals-normal-range-hints.md`
- `thoughts/shared/research/2026-04-20-ui-streaming-page-refresh.md`

## Open Questions

- Scope of the intended change: whether "add Tone & Direction (optional) to Initial Visit sections edit" means (a) rendering the shared `ToneDirectionCard` in the Initial Visit draft-edit tab purely as a UI addition (still transient, non-persistent), (b) wiring it to persist via a new `initial_visit_notes.tone_hint` column + `saveInitialVisitNoteToneHint` action (matching the Procedure/Discharge pattern end-to-end), or (c) also threading tone_hint through `regenerateNoteSection` and `regenerateSection` so per-section regeneration honors it.
- Whether the existing inline Card at `initial-visit-editor.tsx:435-451` in the pre-generation branch should be replaced with the shared `ToneDirectionCard` component as part of this change (the description text currently differs).
