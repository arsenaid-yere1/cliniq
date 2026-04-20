---
date: 2026-04-19T17:12:22-07:00
researcher: arsenaid
git_commit: e8bd01f2b6892c7296458badcc040c4c3e443f37
branch: main
repository: cliniq
topic: "Add Tone & Direction (optional) for Procedure and Discharge notes; end user reports low flexibility and copy-paste repetition"
tags: [research, codebase, procedure-notes, discharge-notes, initial-visit, tone-hint, claude-prompts, ai-generation]
status: complete
last_updated: 2026-04-19
last_updated_by: arsenaid
---

# Research: Tone & Direction (optional) for Procedure and Discharge notes

**Date**: 2026-04-19T17:12:22-07:00
**Researcher**: arsenaid
**Git Commit**: e8bd01f2b6892c7296458badcc040c4c3e443f37
**Branch**: main
**Repository**: cliniq

## Research Question

Document the codebase as it relates to adding a "Tone & Direction (optional)" input to **Procedure** and **Discharge** note generation. The end user reports two complaints:

1. The model is not flexible to change output.
2. There is a lot of copy-paste between sections.

Map:
- Where the existing "Tone & Direction" feature lives (Initial Visit) and how it's wired end-to-end.
- How Procedure and Discharge note generation is currently structured (UI → server action → Claude prompt → persistence).
- What anti-repetition / anti-clone rules already exist in each system prompt, and which sections they cover.
- Where a `toneHint` parameter would need to flow to be added to Procedure and Discharge.
- What persistence exists (or doesn't) and how regeneration paths behave.

## Summary

### The reference implementation (Initial Visit) already exists

A "Tone & Direction (optional)" input **is** implemented, but only for **Initial Visit** notes. It is:

- A single `<Textarea>` (3 rows, no char limit, no validation) in [src/components/clinical/initial-visit-editor.tsx:374-390](src/components/clinical/initial-visit-editor.tsx#L374-L390).
- In-memory React state only — `useState('')` at [initial-visit-editor.tsx:294](src/components/clinical/initial-visit-editor.tsx#L294). Never persisted to the database, never restored on remount.
- Visible only on the pre-generation screen — hidden once `note.introduction || note.chief_complaint` is populated.
- Passed as an optional third argument to `generateInitialVisitNote(caseId, visitType, toneHint || null)` at [initial-visit-editor.tsx:398-410](src/components/clinical/initial-visit-editor.tsx#L398-L410).
- Appended at the end of the user message (after the JSON.stringify of inputData) under the literal header `"ADDITIONAL TONE/DIRECTION GUIDANCE FROM THE PROVIDER:"` in [src/lib/claude/generate-initial-visit.ts:492-498](src/lib/claude/generate-initial-visit.ts#L492-L498).
- **Not** referenced by the system prompt — there are no instructions telling the model how to weight, prioritize, or interpret the hint.
- **Not** passed into `regenerateSection` — section regen has no `toneHint` parameter, and because nothing is persisted, there is no way to recover it after initial generation.
- Also not passed on Retry from the `failed` state ([initial-visit-editor.tsx:451-455](src/components/clinical/initial-visit-editor.tsx#L451-L455)).
- Covered by a single test at [src/lib/claude/__tests__/generate-initial-visit.test.ts:47-52](src/lib/claude/__tests__/generate-initial-visit.test.ts#L47-L52) that verifies the string appears in the user message.

### Procedure and Discharge have no equivalent

Neither Procedure Notes nor Discharge Notes expose a freeform provider-text input to the prompt. Both have structurally similar generation pipelines to Initial Visit — same editor pattern, same two Claude entry points (full + section regen), same `callClaudeTool` wrapper, same model (`claude-opus-4-7`), same persistence shape. A `toneHint` could follow the Initial Visit pattern in both, but it does not currently exist.

- Procedure: [src/actions/procedure-notes.ts:292-468](src/actions/procedure-notes.ts#L292-L468) (`generateProcedureNote(procedureId, caseId)`) — no `toneHint` argument.
- Discharge: [src/actions/discharge-notes.ts:340-472](src/actions/discharge-notes.ts#L340-L472) (`generateDischargeNote(caseId)`) — no `toneHint` argument.

### What already exists for tone-like steering

There is one automated, non-user-input tone signal: **`paintoneLabel`** (computed, not entered) — a four-value label (`baseline | improved | stable | worsened`) derived from pain scores by [src/lib/claude/pain-tone.ts:19](src/lib/claude/pain-tone.ts#L19):

- Used only in the Procedure note generator. Passed into `inputData` as a top-level key by [procedure-notes.ts:219-224](src/actions/procedure-notes.ts#L219-L224). The system prompt branches heavily on it in sections 1 (subjective), 6 (ROS), 8 (physical exam), 9 (assessment summary), 16 (followup), 19 (prognosis).
- The Discharge generator computes its own `overallPainTrend` via the same helper ([discharge-notes.ts:218](src/actions/discharge-notes.ts#L218)) and uses it to gate the mandatory `-2` discharge-pain rule override.

This is **automatic steering** based on data, not user-driven steering. There is no user-facing equivalent on Procedure or Discharge.

### Copy-paste / repetition rules already in each prompt

All three prompts (Initial Visit, Procedure, Discharge) contain a `NO REPETITION` global rule that bans repeating content across sections and repeating clinic/provider header identifiers. The procedure prompt additionally has an explicit, targeted `NO CLONE RULE`, an `INTERVAL-CHANGE RULE`, and a `RESPONSE-CALIBRATED FOLLOW-UP` rule covering exactly the "same narrative repeated across procedure visits" complaint — see the **Anti-repetition mechanisms** section below for exact wording and line refs.

The discharge prompt has the generic `NO REPETITION` block but **no equivalent cross-visit anti-clone rule** (discharge is a single-visit artifact) and **no section-to-section variation mandate** beyond "each section should contain only NEW information."

### Section regeneration paths (for scope reference)

All three note types implement per-section regeneration. The regeneration path for each note type reuses the full `SYSTEM_PROMPT` + appends a one-sentence narrowing instruction. None of the three section-regeneration server actions currently accept `toneHint`, and none of the three section-regeneration Claude functions currently accept `toneHint` — in the Initial Visit case, `toneHint` is architecturally absent from the section-regen path.

---

## Detailed Findings

### 1. Initial Visit "Tone & Direction" — Reference Implementation

#### UI layer

State declaration — [src/components/clinical/initial-visit-editor.tsx:294](src/components/clinical/initial-visit-editor.tsx#L294):
```tsx
const [toneHint, setToneHint] = useState('')
```

Visibility gate — [initial-visit-editor.tsx:300, 315](src/components/clinical/initial-visit-editor.tsx#L300):
```tsx
const hasGeneratedContent = note?.introduction || note?.chief_complaint
// ...
if (!note || (note.status === 'draft' && !hasGeneratedContent)) {
  // pre-generation UI renders, including the Tone card
}
```

Textarea block — [initial-visit-editor.tsx:374-390](src/components/clinical/initial-visit-editor.tsx#L374-L390):
```tsx
<Card>
  <CardHeader>
    <CardTitle className="text-base">Tone & Direction (optional)</CardTitle>
    <CardDescription>
      Provide optional guidance to influence the AI's writing style and emphasis. This is used only for the initial generation.
    </CardDescription>
  </CardHeader>
  <CardContent>
    <Textarea
      placeholder="e.g., Use assertive language about medical necessity, emphasize conservative treatment failure, keep prognosis cautious..."
      value={toneHint}
      onChange={(e) => setToneHint(e.target.value)}
      rows={3}
      disabled={isLocked || isPending}
    />
  </CardContent>
</Card>
```

Invocation — [initial-visit-editor.tsx:398-410](src/components/clinical/initial-visit-editor.tsx#L398-L410):
```tsx
const result = await generateInitialVisitNote(caseId, visitType, toneHint || null)
```

Retry button (failed state) — [initial-visit-editor.tsx:451-455](src/components/clinical/initial-visit-editor.tsx#L451-L455): calls `generateInitialVisitNote(caseId, visitType)` with **no third argument**. `toneHint` is not applied on retry.

#### Server action

Signature — [src/actions/initial-visit-notes.ts:244-248](src/actions/initial-visit-notes.ts#L244-L248):
```ts
export async function generateInitialVisitNote(
  caseId: string,
  visitType: NoteVisitType,
  toneHint?: string | null,
)
```

Forwarded directly to the AI function — [initial-visit-notes.ts:345](src/actions/initial-visit-notes.ts#L345):
```ts
const result = await generateInitialVisitFromData(inputData, visitType, toneHint)
```

The action writes to `initial_visit_notes` (update at lines 282–391 and insert at 371–391) but the column set contains **no `tone_hint` column**. The value lives only for the duration of the HTTP request.

The section-regen server action `regenerateNoteSection(caseId, visitType, section)` at [initial-visit-notes.ts:661-707](src/actions/initial-visit-notes.ts#L661-L707) does not accept a `toneHint` parameter.

#### AI generator

Signature — [src/lib/claude/generate-initial-visit.ts:481-488](src/lib/claude/generate-initial-visit.ts#L481-L488):
```ts
export async function generateInitialVisitFromData(
  inputData: InitialVisitInputData,
  visitType: NoteVisitType,
  toneHint?: string | null,
): Promise<{ data?: InitialVisitNoteResult; rawResponse?: unknown; error?: string }>
```

User-message assembly — [generate-initial-visit.ts:492-498](src/lib/claude/generate-initial-visit.ts#L492-L498):
```ts
let userMessage = `Generate a comprehensive Initial Visit note from the following case data.\n\nVisit type: ${visitLabel}\n\n${JSON.stringify(inputData, null, 2)}`
if (toneHint?.trim()) {
  userMessage += `\n\nADDITIONAL TONE/DIRECTION GUIDANCE FROM THE PROVIDER:\n${toneHint.trim()}`
}
```

Key observations about this implementation:
- The `toneHint?.trim()` guard means `null`, `undefined`, empty string, and whitespace-only all evaluate to falsy and produce no appended text.
- The hint is appended **after** the full `JSON.stringify(inputData)` — the last content the model sees in the user message.
- The system prompt (built by `buildSystemPrompt(visitType)`) contains **no instructions** referencing `toneHint`, "tone", "direction", or "provider guidance." The model receives the hint without explicit instructions on how to use it.

Section regeneration is architecturally excluded — [generate-initial-visit.ts:533-540](src/lib/claude/generate-initial-visit.ts#L533-L540):
```ts
export async function regenerateSection(
  inputData: InitialVisitInputData,
  visitType: NoteVisitType,
  section: InitialVisitSection,
  currentContent: string,
): Promise<{ data?: string; error?: string }>
```
No `toneHint` parameter.

#### Test coverage

Single test — [src/lib/claude/__tests__/generate-initial-visit.test.ts:47-52](src/lib/claude/__tests__/generate-initial-visit.test.ts#L47-L52):
```ts
it('includes toneHint in user message when provided', async () => {
  ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
  await generateInitialVisitFromData(emptyInput, 'initial_visit', 'be concise')
  const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
  expect(opts.messages[0].content).toContain('be concise')
})
```

Does not test: header wording, whitespace suppression, null/undefined handling, position in prompt, absence from section regen.

---

### 2. Procedure Note Generation Pipeline

#### UI — [src/components/procedures/procedure-note-editor.tsx](src/components/procedures/procedure-note-editor.tsx)

- State-machine router at [line 166](src/components/procedures/procedure-note-editor.tsx#L166) selects between: pre-generation / generating / failed / finalized / draft editor.
- `hasGeneratedContent` at [line 187](src/components/procedures/procedure-note-editor.tsx#L187): `!!(note?.subjective || note?.assessment_and_plan)`.
- **Single "Generate Procedure Note" button** at [line 200](src/components/procedures/procedure-note-editor.tsx#L200), calling `generateProcedureNote(procedureId, caseId)` with no user-provided strings. No tone card, no freeform input.
- `DraftEditor` at [line 338](src/components/procedures/procedure-note-editor.tsx#L338) uses `react-hook-form`; default values populated from `note[section]` for all 20 sections ([line 359-361](src/components/procedures/procedure-note-editor.tsx#L359-L361)).
- Per-section "Regenerate" button inside an `AlertDialog` gate at [lines 481-510](src/components/procedures/procedure-note-editor.tsx#L481-L510), calling `handleRegenerate(section)` at [line 373](src/components/procedures/procedure-note-editor.tsx#L373).

#### Server action — [src/actions/procedure-notes.ts](src/actions/procedure-notes.ts)

Full generation — [procedure-notes.ts:292](src/actions/procedure-notes.ts#L292):
```ts
export async function generateProcedureNote(procedureId: string, caseId: string)
```

Data gathering — `gatherProcedureNoteSourceData` at [procedure-notes.ts:29](src/actions/procedure-notes.ts#L29) runs 9 parallel Supabase queries (procedures, vital_signs, cases+patients, pain_management_extractions, mri_extractions, initial_visit_notes, prior procedures, clinic_settings, chiro_extractions) followed by a batched prior-procedure vitals query and a provider-profile query.

`paintoneLabel` computation at [procedure-notes.ts:219-224](src/actions/procedure-notes.ts#L219-L224):
```ts
paintoneLabel: computePainToneLabel(
  vitalsRes.data?.pain_score_max ?? null,
  priorProcedureRows.length > 0
    ? priorVitalsByProcedureId.get(priorProcedureRows[0].id)?.pain_score_max ?? null
    : null,
),
```
Compared against the **series baseline** (oldest prior procedure), not the most recent.

AI invocation — [procedure-notes.ts:394](src/actions/procedure-notes.ts#L394):
```ts
const result = await generateProcedureNoteFromData(inputData)
```
**No `toneHint` argument.**

Section-regen action — [procedure-notes.ts:693](src/actions/procedure-notes.ts#L693):
```ts
export async function regenerateProcedureNoteSectionAction(
  procedureId: string,
  caseId: string,
  section: ProcedureNoteSection,
)
```
No `toneHint`. Calls `regenerateSectionAI(inputData, section, currentContent)` at [line 722](src/actions/procedure-notes.ts#L722) and writes only the target column at [line 728-733](src/actions/procedure-notes.ts#L728-L733).

#### AI generator — [src/lib/claude/generate-procedure-note.ts](src/lib/claude/generate-procedure-note.ts)

Full generation — [generate-procedure-note.ts:442](src/lib/claude/generate-procedure-note.ts#L442):
```ts
export async function generateProcedureNoteFromData(
  inputData: ProcedureNoteInputData,
): Promise<{ data?: ProcedureNoteResult; rawResponse?: unknown; error?: string }>
```

User-message assembly — [generate-procedure-note.ts:456-458](src/lib/claude/generate-procedure-note.ts#L456-L458):
```ts
messages: [{
  role: 'user',
  content: `Generate a comprehensive PRP Procedure Note from the following case and procedure data.\n\n${JSON.stringify(inputData, null, 2)}`,
}]
```
No tone-hint concatenation branch.

Section regen — [generate-procedure-note.ts:487-516](src/lib/claude/generate-procedure-note.ts#L487-L516): reuses full `SYSTEM_PROMPT`, appends a narrowing sentence, no `toneHint` parameter.

#### Validation — [src/lib/validations/procedure-note.ts](src/lib/validations/procedure-note.ts)

Sections (20 total, document order) — [procedure-note.ts:3-24](src/lib/validations/procedure-note.ts#L3-L24):
```
subjective, past_medical_history, allergies, current_medications, social_history,
review_of_systems, objective_vitals, objective_physical_exam, assessment_summary,
procedure_indication, procedure_preparation, procedure_prp_prep, procedure_anesthesia,
procedure_injection, procedure_post_care, procedure_followup, assessment_and_plan,
patient_education, prognosis, clinician_disclaimer
```

---

### 3. Discharge Note Generation Pipeline

#### UI — [src/components/discharge/discharge-note-editor.tsx](src/components/discharge/discharge-note-editor.tsx)

- State-machine router at [line 188-335](src/components/discharge/discharge-note-editor.tsx#L188-L335) follows the same pattern as Procedure/Initial Visit.
- `hasGeneratedContent` at [line 189](src/components/discharge/discharge-note-editor.tsx#L189): `!!(note?.subjective || note?.assessment)`.
- **Single "Generate Discharge Summary" button** at [lines 205-217](src/components/discharge/discharge-note-editor.tsx#L205-L217), calling `generateDischargeNote(caseId)`. No tone card.
- A `DischargeVitalsCard` at [lines 735-945](src/components/discharge/discharge-note-editor.tsx#L735-L945) renders a separate form for 8 discharge-visit vitals fields (`pain_score_min/max`, BP, HR, RR, temp, SpO2) — these are numeric fields, not prose.
- Per-section Regenerate button at [lines 498-528](src/components/discharge/discharge-note-editor.tsx#L498-L528) calling `handleRegenerate(section)` at [line 376-388](src/components/discharge/discharge-note-editor.tsx#L376-L388).

#### Server action — [src/actions/discharge-notes.ts](src/actions/discharge-notes.ts)

Full generation — [discharge-notes.ts:340](src/actions/discharge-notes.ts#L340):
```ts
export async function generateDischargeNote(caseId: string)
```

`gatherDischargeNoteSourceData` at [discharge-notes.ts:31-312](src/actions/discharge-notes.ts#L31-L312) runs 9 parallel queries plus provider profile and batched vital_signs queries. Computes `overallPainTrend` via `computePainToneLabel(latestVitals.pain_score_max, baselinePain.pain_score_max)` at [line 218](src/actions/discharge-notes.ts#L218).

Vitals **are** preserved across regeneration — [discharge-notes.ts:357-378](src/actions/discharge-notes.ts#L357-L378) reads the existing discharge row's vitals and `visit_date` before soft-deleting and re-inserting. This is the only piece of provider-entered state currently carried across regeneration.

AI invocation — [discharge-notes.ts:427](src/actions/discharge-notes.ts#L427):
```ts
const result = await generateDischargeNoteFromData(inputData)
```
**No `toneHint` argument.**

Section regen — [discharge-notes.ts:655-701](src/actions/discharge-notes.ts#L655-L701):
```ts
export async function regenerateDischargeNoteSectionAction(
  caseId: string,
  section: DischargeNoteSection,
)
```
No `toneHint`. Important asymmetry: section regen does **not** pass `dischargeVitals` to `gatherDischargeNoteSourceData` ([discharge-notes.ts:679](src/actions/discharge-notes.ts#L679)), so the `-2` pain default rule applies to section regen even when explicit discharge vitals are saved. This is relevant because any new persistence mechanism for `toneHint` would need a similar decision about whether regen carries it forward.

#### AI generator — [src/lib/claude/generate-discharge-note.ts](src/lib/claude/generate-discharge-note.ts)

Full generation — [generate-discharge-note.ts:271-297](src/lib/claude/generate-discharge-note.ts#L271-L297):
```ts
messages: [{
  role: 'user',
  content: `Generate a Final PRP Follow-Up and Discharge Visit note from the following aggregated case data.\n\n${JSON.stringify(inputData, null, 2)}`,
}]
```
No tone-hint concatenation.

Hardcoded tone directive — [generate-discharge-note.ts:149](src/lib/claude/generate-discharge-note.ts#L149):
```
The tone should reflect completion, improvement, and forward-looking recommendations.
```
This is a fixed instruction in the `=== CONTEXT ===` block. There is no provider-controllable tone input.

Section regen — [generate-discharge-note.ts:316-344](src/lib/claude/generate-discharge-note.ts#L316-L344). No `toneHint` parameter.

#### Validation — [src/lib/validations/discharge-note.ts](src/lib/validations/discharge-note.ts)

Sections (12 total) — [discharge-note.ts:3-16](src/lib/validations/discharge-note.ts#L3-L16):
```
subjective, objective_vitals, objective_general, objective_cervical,
objective_lumbar, objective_neurological, diagnoses, assessment,
plan_and_recommendations, patient_education, prognosis, clinician_disclaimer
```

---

### 4. Anti-Repetition Mechanisms Currently in Each Prompt

The user complaint about "copy-paste between sections" lands on specific existing prompt directives. Here is the current state, verbatim where possible.

#### Procedure Note — [src/lib/claude/generate-procedure-note.ts](src/lib/claude/generate-procedure-note.ts)

**NO REPETITION** (global) — [generate-procedure-note.ts:115](src/lib/claude/generate-procedure-note.ts#L115):
```
NO REPETITION: DO NOT repeat information that appears in earlier sections.
Each section should contain only NEW information. DO NOT repeat clinic
name/address/phone/fax or provider name/credentials — these are rendered
separately in the PDF header and signature block.
```

**NO CLONE RULE** (cross-visit, procedure-specific) — [generate-procedure-note.ts:123-128](src/lib/claude/generate-procedure-note.ts#L123-L128):
```
NO CLONE RULE (MANDATORY when priorProcedures has 1 or more entries):
This note is one document in a series. A reviewer reading notes #1, #2,
and #3 side-by-side should NOT see verbatim-identical paragraphs where the
underlying clinical facts have evolved. Apply these variation patterns to
the procedure-mechanics sections (procedure_preparation, procedure_prp_prep,
procedure_anesthesia, procedure_injection, procedure_post_care):
• Vary sentence ORDERING and STRUCTURE from note to note...
• When the protocol IS identical across sessions... you MAY briefly
  acknowledge continuity — e.g., "The PRP preparation followed the same
  protocol as the prior injection" — and then list only the essential
  numeric details...
• Do NOT fabricate procedural variation that did not happen...
  Sentence-level variation (word choice, clause ordering, active vs. passive
  voice) is sufficient.
• Sections that are inherently template-shaped (allergies, social history,
  past medical history, current medications) may remain identical across
  sessions when the source data is identical — do NOT force variation there;
  the NO CLONE RULE applies only to the procedure-mechanics sections (11-15)
  and to the physical exam (section 8).
```

**INTERVAL-CHANGE RULE** (physical exam) — [generate-procedure-note.ts:194-196](src/lib/claude/generate-procedure-note.ts#L194-L196):
```
SOURCE: Treat pmExtraction.physical_exam as a STARTING REFERENCE describing
the patient's baseline exam at intake — NOT as a source to paste verbatim...

INTERVAL-CHANGE RULE (MANDATORY when paintoneLabel is "improved", "stable",
or "worsened"): Do NOT reproduce the baseline pmExtraction findings
word-for-word.
```

**MINIMUM INTERVAL-CHANGE FLOOR** (physical exam, stable label) — [generate-procedure-note.ts:200-203](src/lib/claude/generate-procedure-note.ts#L200-L203):
```
MINIMUM INTERVAL-CHANGE FLOOR (MANDATORY for "stable" when at least one
prior procedure exists): The exam narrative MUST include at least one
interval-comparison phrase... Do NOT emit an exam that reads as a pure
clone of the intake baseline with only a trailing "without meaningful
interval change" tag.
```

**RESPONSE-CALIBRATED FOLLOW-UP** — [generate-procedure-note.ts:295-299](src/lib/claude/generate-procedure-note.ts#L295-L299):
```
RESPONSE-CALIBRATED FOLLOW-UP (MANDATORY when at least one prior procedure
exists): Match the follow-up narrative to the top-level "paintoneLabel"
— do NOT emit identical boilerplate across every session of the series.
```

Includes section-16 specific guidance against repeating "1-2 additional PRP injections, depending on the degree of symptom improvement" verbatim across sessions.

#### Discharge Note — [src/lib/claude/generate-discharge-note.ts](src/lib/claude/generate-discharge-note.ts)

**NO REPETITION** (global) — [generate-discharge-note.ts:138-139](src/lib/claude/generate-discharge-note.ts#L138-L139):
```
NO REPETITION: DO NOT repeat information that appears in earlier sections.
Each section should contain only NEW information. DO NOT repeat clinic
name/address/phone/fax or provider name/credentials — these are rendered
separately in the PDF header and signature block.
```

Discharge has **no NO CLONE RULE** (discharge is a single visit), **no INTERVAL-CHANGE RULE** (no prior-discharge to compare against), and no section-to-section uniqueness mandate beyond the generic `NO REPETITION` sentence. The hardcoded tone directive at [line 149](src/lib/claude/generate-discharge-note.ts#L149) — *"The tone should reflect completion, improvement, and forward-looking recommendations"* — is the only tone-steering mechanism.

#### Initial Visit — [src/lib/claude/generate-initial-visit.ts](src/lib/claude/generate-initial-visit.ts)

**NO REPETITION** (global) — [generate-initial-visit.ts:47-51](src/lib/claude/generate-initial-visit.ts#L47-L51):
```
NO REPETITION: DO NOT repeat information that appears in earlier sections.
Each section should contain only NEW information...
```

Section-scoped anti-repeat rules at [line 152](src/lib/claude/generate-initial-visit.ts#L152) (POST-ACCIDENT HISTORY — "Do NOT reference prior clinical encounters... Do NOT repeat accident mechanism details"), [lines 226-235](src/lib/claude/generate-initial-visit.ts#L226-L235) (PRIOR VISIT REFERENCE — "Do NOT restate prior exam findings as current findings"), [line 269](src/lib/claude/generate-initial-visit.ts#L269) (MEDICAL NECESSITY — "Do NOT restate the mechanism of injury. Do NOT list specific MRI findings...").

#### Summary of coverage

| Rule | Initial Visit | Procedure | Discharge |
|---|---|---|---|
| Global `NO REPETITION` | ✓ | ✓ | ✓ |
| Section-scoped repeat bans | ✓ (multiple) | implicit in section instructions | only the generic global rule |
| Cross-visit `NO CLONE` | n/a | ✓ (sections 8, 11–15) | n/a |
| Interval-change narrative rule | ✓ (pain eval variant) | ✓ (section 8) | ✗ |
| Response-calibrated follow-up | ✗ | ✓ (section 16) | ✗ |
| Provider-controllable tone | ✓ (`toneHint`) | ✗ | ✗ |

---

### 5. Section Regeneration (Structural Reference)

All three note types implement per-section regeneration via the same 4-layer pattern:

| Layer | Initial Visit | Procedure | Discharge |
|---|---|---|---|
| UI button | inside `DraftEditor` section loop | inside `DraftEditor` section loop ([editor:481-510](src/components/procedures/procedure-note-editor.tsx#L481-L510)) | inside `DraftEditor` section loop ([editor:498-528](src/components/discharge/discharge-note-editor.tsx#L498-L528)) |
| `handleRegenerate` | spinner + setValue on success | [editor:373-385](src/components/procedures/procedure-note-editor.tsx#L373-L385) | [editor:376-388](src/components/discharge/discharge-note-editor.tsx#L376-L388) |
| Server action | `regenerateNoteSection` | `regenerateProcedureNoteSectionAction` | `regenerateDischargeNoteSectionAction` |
| AI function | `regenerateSection` | `regenerateProcedureNoteSection` | `regenerateDischargeNoteSection` |

Common properties of all three AI section-regen functions:
- `maxTokens`: 4096 (vs 16384 for full generation).
- System: full `SYSTEM_PROMPT` + appended narrowing sentence (identical template across all three note types).
- Tool schema: `{ content: string }` via `SECTION_REGEN_TOOL`.
- User message: section label + current content + full `JSON.stringify(inputData)`.
- Database write: only the single section column is updated.
- None accept a `toneHint` parameter.

The appended narrowing sentence — identical template across all three note types — is at [procedure:497](src/lib/claude/generate-procedure-note.ts#L497), [discharge:326](src/lib/claude/generate-discharge-note.ts#L326), [initial-visit:548](src/lib/claude/generate-initial-visit.ts#L548):
```
You are regenerating ONLY the "<sectionLabel>" section of an existing
<Note Type>. Write a fresh version of this section based on the source
data. Do not repeat the section title — just provide the content. Follow
the exact length targets and conciseness constraints from the
section-specific instructions above.
```

---

### 6. Persistence and State Notes

- No `tone_hint` column exists on any of the note tables (`initial_visit_notes`, `procedure_notes`, `discharge_notes`). Search of [src/types/database.ts](src/types/database.ts) finds no fields named `tone`, `style`, `instructions`, `guidance`, `direction`, `customPrompt`, `additionalContext`, or `preferences`.
- No settings UI ([src/components/settings/settings-tabs.tsx](src/components/settings/settings-tabs.tsx), [src/components/settings/clinic-info-form.tsx](src/components/settings/clinic-info-form.tsx), [src/actions/settings.ts](src/actions/settings.ts)) currently exposes clinic-level or user-level tone/style/instruction preferences that feed into note generation.
- The only cross-regeneration persistence today is discharge vitals + `visit_date` ([discharge-notes.ts:357-378](src/actions/discharge-notes.ts#L357-L378)).

---

## Code References

### Initial Visit (reference implementation)
- [src/components/clinical/initial-visit-editor.tsx:294](src/components/clinical/initial-visit-editor.tsx#L294) — `useState('')` for `toneHint`
- [src/components/clinical/initial-visit-editor.tsx:300](src/components/clinical/initial-visit-editor.tsx#L300) — `hasGeneratedContent` visibility gate
- [src/components/clinical/initial-visit-editor.tsx:374-390](src/components/clinical/initial-visit-editor.tsx#L374-L390) — Textarea and card UI
- [src/components/clinical/initial-visit-editor.tsx:401](src/components/clinical/initial-visit-editor.tsx#L401) — `toneHint || null` passed to action
- [src/components/clinical/initial-visit-editor.tsx:451-455](src/components/clinical/initial-visit-editor.tsx#L451-L455) — Retry button without toneHint
- [src/actions/initial-visit-notes.ts:244-248](src/actions/initial-visit-notes.ts#L244-L248) — Server action signature
- [src/actions/initial-visit-notes.ts:345](src/actions/initial-visit-notes.ts#L345) — Forwarded to AI function
- [src/actions/initial-visit-notes.ts:661-707](src/actions/initial-visit-notes.ts#L661-L707) — `regenerateNoteSection` (no toneHint)
- [src/lib/claude/generate-initial-visit.ts:481-488](src/lib/claude/generate-initial-visit.ts#L481-L488) — AI function signature
- [src/lib/claude/generate-initial-visit.ts:492-498](src/lib/claude/generate-initial-visit.ts#L492-L498) — toneHint interpolation into user message
- [src/lib/claude/generate-initial-visit.ts:533-540](src/lib/claude/generate-initial-visit.ts#L533-L540) — `regenerateSection` signature
- [src/lib/claude/__tests__/generate-initial-visit.test.ts:47-52](src/lib/claude/__tests__/generate-initial-visit.test.ts#L47-L52) — single toneHint test

### Procedure Note
- [src/components/procedures/procedure-note-editor.tsx:166](src/components/procedures/procedure-note-editor.tsx#L166) — state-machine router
- [src/components/procedures/procedure-note-editor.tsx:200](src/components/procedures/procedure-note-editor.tsx#L200) — Generate button
- [src/components/procedures/procedure-note-editor.tsx:338](src/components/procedures/procedure-note-editor.tsx#L338) — `DraftEditor`
- [src/components/procedures/procedure-note-editor.tsx:373-385](src/components/procedures/procedure-note-editor.tsx#L373-L385) — `handleRegenerate`
- [src/components/procedures/procedure-note-editor.tsx:481-510](src/components/procedures/procedure-note-editor.tsx#L481-L510) — per-section Regenerate button
- [src/actions/procedure-notes.ts:29](src/actions/procedure-notes.ts#L29) — `gatherProcedureNoteSourceData`
- [src/actions/procedure-notes.ts:219-224](src/actions/procedure-notes.ts#L219-L224) — paintoneLabel computation
- [src/actions/procedure-notes.ts:292](src/actions/procedure-notes.ts#L292) — `generateProcedureNote`
- [src/actions/procedure-notes.ts:394](src/actions/procedure-notes.ts#L394) — AI invocation
- [src/actions/procedure-notes.ts:693-740](src/actions/procedure-notes.ts#L693-L740) — `regenerateProcedureNoteSectionAction`
- [src/lib/claude/generate-procedure-note.ts:105](src/lib/claude/generate-procedure-note.ts#L105) — SYSTEM_PROMPT constant
- [src/lib/claude/generate-procedure-note.ts:115](src/lib/claude/generate-procedure-note.ts#L115) — NO REPETITION rule
- [src/lib/claude/generate-procedure-note.ts:123-128](src/lib/claude/generate-procedure-note.ts#L123-L128) — NO CLONE RULE
- [src/lib/claude/generate-procedure-note.ts:194-203](src/lib/claude/generate-procedure-note.ts#L194-L203) — INTERVAL-CHANGE RULE + FLOOR
- [src/lib/claude/generate-procedure-note.ts:295-299](src/lib/claude/generate-procedure-note.ts#L295-L299) — RESPONSE-CALIBRATED FOLLOW-UP
- [src/lib/claude/generate-procedure-note.ts:442](src/lib/claude/generate-procedure-note.ts#L442) — `generateProcedureNoteFromData`
- [src/lib/claude/generate-procedure-note.ts:456-458](src/lib/claude/generate-procedure-note.ts#L456-L458) — user message assembly
- [src/lib/claude/generate-procedure-note.ts:487-516](src/lib/claude/generate-procedure-note.ts#L487-L516) — `regenerateProcedureNoteSection`
- [src/lib/validations/procedure-note.ts:3-24](src/lib/validations/procedure-note.ts#L3-L24) — `procedureNoteSections`

### Discharge Note
- [src/components/discharge/discharge-note-editor.tsx:188-335](src/components/discharge/discharge-note-editor.tsx#L188-L335) — state-machine router
- [src/components/discharge/discharge-note-editor.tsx:205-217](src/components/discharge/discharge-note-editor.tsx#L205-L217) — Generate button
- [src/components/discharge/discharge-note-editor.tsx:376-388](src/components/discharge/discharge-note-editor.tsx#L376-L388) — `handleRegenerate`
- [src/components/discharge/discharge-note-editor.tsx:498-528](src/components/discharge/discharge-note-editor.tsx#L498-L528) — per-section Regenerate button
- [src/components/discharge/discharge-note-editor.tsx:735-945](src/components/discharge/discharge-note-editor.tsx#L735-L945) — `DischargeVitalsCard`
- [src/actions/discharge-notes.ts:31-312](src/actions/discharge-notes.ts#L31-L312) — `gatherDischargeNoteSourceData`
- [src/actions/discharge-notes.ts:218](src/actions/discharge-notes.ts#L218) — `overallPainTrend` computation
- [src/actions/discharge-notes.ts:340-472](src/actions/discharge-notes.ts#L340-L472) — `generateDischargeNote`
- [src/actions/discharge-notes.ts:357-378](src/actions/discharge-notes.ts#L357-L378) — vitals preservation across regeneration
- [src/actions/discharge-notes.ts:655-701](src/actions/discharge-notes.ts#L655-L701) — `regenerateDischargeNoteSectionAction`
- [src/actions/discharge-notes.ts:679](src/actions/discharge-notes.ts#L679) — section regen omits `dischargeVitals`
- [src/lib/claude/generate-discharge-note.ts:128-233](src/lib/claude/generate-discharge-note.ts#L128-L233) — SYSTEM_PROMPT
- [src/lib/claude/generate-discharge-note.ts:138-139](src/lib/claude/generate-discharge-note.ts#L138-L139) — NO REPETITION rule
- [src/lib/claude/generate-discharge-note.ts:149](src/lib/claude/generate-discharge-note.ts#L149) — hardcoded tone directive
- [src/lib/claude/generate-discharge-note.ts:152-174](src/lib/claude/generate-discharge-note.ts#L152-L174) — PAIN TRAJECTORY rules
- [src/lib/claude/generate-discharge-note.ts:271-297](src/lib/claude/generate-discharge-note.ts#L271-L297) — `generateDischargeNoteFromData` call
- [src/lib/claude/generate-discharge-note.ts:316-344](src/lib/claude/generate-discharge-note.ts#L316-L344) — `regenerateDischargeNoteSection`
- [src/lib/validations/discharge-note.ts:3-16](src/lib/validations/discharge-note.ts#L3-L16) — `dischargeNoteSections`

### Shared infrastructure
- [src/lib/claude/pain-tone.ts:19](src/lib/claude/pain-tone.ts#L19) — `computePainToneLabel`
- [src/lib/claude/pain-tone.ts:32](src/lib/claude/pain-tone.ts#L32) — `deriveChiroProgress`
- [src/lib/claude/client.ts:45-105](src/lib/claude/client.ts#L45-L105) — `callClaudeTool` wrapper (retry + Zod validation)
- [src/lib/claude/client.ts:66](src/lib/claude/client.ts#L66) — forced `tool_choice`

---

## Architecture Documentation

### Three-note pipeline symmetry

All three clinical note types (Initial Visit, Procedure Note, Discharge Note) follow the same 5-component architecture:

1. **Editor component** (`*-note-editor.tsx`) — a state-machine router over `note.status` + a `hasGeneratedContent` sentinel, rendering one of: pre-generation, generating skeleton, failed+retry, finalized read-only, or `DraftEditor` with `react-hook-form`.
2. **Server action** (`*-notes.ts`) — auth + closed-case guard + prerequisite check + parallel Supabase gather + DB status flip to `generating` + Claude call + DB write of results + `revalidatePath`.
3. **Gather helper** (`gather*SourceData`) — issues 8–10 parallel Supabase queries against the case's associated extractions, procedures, vitals, clinic settings, and provider profile.
4. **Claude wrapper** (`generate-*.ts`) — exports `generate*FromData` (full) and `regenerate*Section` (single section). Both use `callClaudeTool` with `claude-opus-4-7`, forced tool choice, Zod result validation, and retry logic.
5. **Validation module** (`src/lib/validations/*-note.ts`) — defines the `sections` const array (single source of truth for UI loops, tool schema `required` array, and both Claude-output and form-edit Zod schemas).

### Tone-steering surface area today

Two categories exist:

- **Data-derived, automatic tone signals**: `paintoneLabel` (Procedure note), `overallPainTrend` (Discharge note), `chiroProgress` (Procedure note). All computed from pain scores / chiro outcomes in the source data. These are top-level keys on the `inputData` object passed to Claude and are explicitly referenced by section-branching rules in the system prompts.
- **Provider-entered freeform tone**: `toneHint` (Initial Visit only). Appended to the user message under a labeled header. The system prompt does not reference it; the model interprets it implicitly.

### Anti-repetition coverage by prompt

The procedure prompt has the most developed anti-copy-paste scaffolding: a global `NO REPETITION`, a targeted cross-visit `NO CLONE RULE` (sections 11–15, 8), an `INTERVAL-CHANGE RULE` with a `MINIMUM INTERVAL-CHANGE FLOOR`, and a `RESPONSE-CALIBRATED FOLLOW-UP` rule. The initial visit prompt has several targeted "Do NOT restate..." directives in specific sections. The discharge prompt has only the generic global `NO REPETITION` rule.

### Section regeneration invariants

Section regen always:
- Re-runs the full source gather (fresh DB state).
- Reuses the full `SYSTEM_PROMPT`.
- Appends a templated narrowing sentence.
- Uses `maxTokens: 4096` and a `{ content: string }` tool schema.
- Passes the current section content in the user message.
- Writes only the single target column.
- Does not accept `toneHint` in any of the three note types today.

---

## Related Research

- [2026-04-18-procedure-note-pain-persistence-tone.md](thoughts/shared/research/2026-04-18-procedure-note-pain-persistence-tone.md) — prior work on procedure note pain-tone narrative
- [2026-04-18-prp-procedure-physical-exam-improvement-tone.md](thoughts/shared/research/2026-04-18-prp-procedure-physical-exam-improvement-tone.md) — physical exam tone research
- [2026-04-18-apply-medico-legal-editor-pass-to-procedure-note.md](thoughts/shared/research/2026-04-18-apply-medico-legal-editor-pass-to-procedure-note.md) — medico-legal editor pass research
- [2026-04-19-prompt-caching-current-state.md](thoughts/shared/research/2026-04-19-prompt-caching-current-state.md) — prompt caching state (relevant: caching keys off prompt structure)
- Plans: [2026-04-18-procedure-note-pain-tone-improvements.md](thoughts/shared/plans/2026-04-18-procedure-note-pain-tone-improvements.md), [2026-04-18-procedure-note-physical-exam-improvement-tone.md](thoughts/shared/plans/2026-04-18-procedure-note-physical-exam-improvement-tone.md), [2026-04-18-procedure-note-medico-legal-editor-pass.md](thoughts/shared/plans/2026-04-18-procedure-note-medico-legal-editor-pass.md)

---

## Open Questions

These are factual gaps the codebase does not answer on its own; they would need user/product input before a plan is drafted:

1. **Scope of the new `toneHint`**: should the new inputs mirror Initial Visit's "pre-generation only, not persisted, not applied to section regen" scope, or a different scope (persisted per-note, available during section regen, available on Retry)?
2. **Interaction with section regeneration**: the user complaint about "copy-paste" may be experienced during section regen specifically — section regen today re-uses the full `SYSTEM_PROMPT` but has no awareness of the other sections' current text (unlike full generation, where the model produces all sections together). No mechanism currently tells section regen "here is what the other 11/19 sections look like, write something that doesn't duplicate them."
3. **Which complaint maps to which solution**: "not flexible to change output" points at the absence of `toneHint`; "lots of copy-paste in between" could point at either (a) cross-section duplication within a single note, (b) cross-visit duplication across procedure notes in a series, or (c) section-regen output duplicating the other sections currently persisted. Each of these surfaces to different prompt locations.
4. **Discharge-specific tone tension**: the discharge prompt has a hardcoded tone directive at [line 149](src/lib/claude/generate-discharge-note.ts#L149) — *"The tone should reflect completion, improvement, and forward-looking recommendations"*. A provider-entered tone hint that contradicted this (e.g., "emphasize incomplete recovery") would be in direct conflict; the system prompt does not currently say how to reconcile a provider-supplied hint against a hardcoded directive.
5. **Whether Procedure should accept toneHint at both full-generation and per-procedure-visit level**: procedure notes are part of a series. A toneHint entered on procedure visit #2 would either (a) be scoped to that single visit's generation, (b) be persisted and re-applied to future procedure visits' generation, or (c) be per-regeneration-only. The existing pattern (Initial Visit) is (a)+(c) with no persistence.