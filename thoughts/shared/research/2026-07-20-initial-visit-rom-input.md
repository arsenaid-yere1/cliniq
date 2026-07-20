---
date: 2026-07-20T14:51:48Z
researcher: arsenaid
git_commit: 62b97321dfe1baf114979a0967b044e46010661e
branch: main
repository: cliniq
topic: "Range of Motion (ROM) input in Initial Visit — full surface map"
tags: [research, codebase, initial-visit, range-of-motion, rom, validations, claude-prompt, pdf]
status: complete
last_updated: 2026-07-20
last_updated_by: arsenaid
---

# Research: Range of Motion (ROM) input in Initial Visit

**Date**: 2026-07-20T14:51:48Z
**Researcher**: arsenaid
**Git Commit**: 62b97321dfe1baf114979a0967b044e46010661e
**Branch**: main
**Repository**: cliniq

## Research Question

Where does the Range of Motion (ROM) input live in the Initial Visit feature — every schema, UI, server action, AI prompt, PDF, DB, and test touchpoint that would be involved in removing it?

## Summary

ROM in the Initial Visit is a **self-contained vertical slice** with its own schema trio, its own dedicated editor tab and component pair, its own get/save server action pair, and its own `jsonb` column. It is *not* nested inside `providerIntakeSchema`, not one of the 16 `initialVisitSections`, and has no field in the PDF template or the Claude tool schema.

The one place ROM is **not** self-contained is the AI prompt: `romData` is a field on `InitialVisitInputData` that the system prompt instructs the model to render as `RANGE OF MOTION:` bullets *inside the `physical_exam` prose string*. The PDF then renders those bullets through generic sub-heading/bullet detection — there is no ROM-specific PDF code. So ROM's output path is prose-embedded, not structured.

Secondary coupling: `romData` is part of the object hashed by `computeSourceHash`, so ROM participates in staleness detection; and a Pain Evaluation Visit reads the *prior* Initial Visit's `rom_data` as read-only comparison context.

Three unrelated ROM implementations exist elsewhere in the codebase (PT extraction, pain-management extraction, and the `RomSection` component in `pm-extraction-form.tsx`) — these are distinct features on distinct tables and share no code with Initial Visit ROM.

## Detailed Findings

### Validation schemas — `src/lib/validations/initial-visit-note.ts`

Four ROM declarations, all in one contiguous block at lines 114–226:

- `romMovementSchema` ([initial-visit-note.ts:114-119](src/lib/validations/initial-visit-note.ts#L114-L119)) — `{ movement: string, normal: number|null (0-360), actual: number|null (0-360), pain: boolean }`. Type `RomMovement` at [L121](src/lib/validations/initial-visit-note.ts#L121).
- `romRegionSchema` ([initial-visit-note.ts:123-126](src/lib/validations/initial-visit-note.ts#L123-L126)) — `{ region: string, movements: RomMovement[] (min 1) }`. Type `RomRegion` at [L128](src/lib/validations/initial-visit-note.ts#L128).
- `initialVisitRomSchema` ([initial-visit-note.ts:130](src/lib/validations/initial-visit-note.ts#L130)) — `z.array(romRegionSchema)`. Type `InitialVisitRomValues` at [L132](src/lib/validations/initial-visit-note.ts#L132).
- `defaultRomData` ([initial-visit-note.ts:136-226](src/lib/validations/initial-visit-note.ts#L136-L226)) — 91-line hardcoded template: 9 regions (Cervical/Thoracic/Lumbar Spine, L/R Shoulder, L/R Knee, L/R Hip), each movement pre-filled with a `normal` degree value and `actual: null`, `pain: false`.

**Isolation from the other Initial Visit schemas** — ROM appears in none of:
- `initialVisitSections` ([L5-22](src/lib/validations/initial-visit-note.ts#L5-L22)) — the 16 narrative section keys
- `sectionLabels` ([L28-45](src/lib/validations/initial-visit-note.ts#L28-L45))
- `initialVisitNoteEditSchema` ([L72-93](src/lib/validations/initial-visit-note.ts#L72-L93)) — `visit_date` + 16 section strings only
- `providerIntakeSchema` ([L286-292](src/lib/validations/initial-visit-note.ts#L286-L292))

ROM is architecturally a sibling of `initialVisitVitalsSchema` ([L99-108](src/lib/validations/initial-visit-note.ts#L99-L108)): each has its own action pair and its own storage.

### Server actions — `src/actions/initial-visit-notes.ts`

Imports at [L15-25](src/actions/initial-visit-notes.ts#L15-L25) pull only `initialVisitRomSchema` and `type InitialVisitRomValues` (not `defaultRomData` / `romMovementSchema` / `romRegionSchema` — those are client-only).

**Dedicated CRUD pair:**
- `getInitialVisitRom(caseId, visitType)` ([L1041-1057](src/actions/initial-visit-notes.ts#L1041-L1057)) — selects `rom_data` from `initial_visit_notes` scoped by `case_id` + `visit_type` + `deleted_at is null`. Auth check only; no `assertCaseNotClosed` on read.
- `saveInitialVisitRom(caseId, visitType, romData)` ([L1061-1116](src/actions/initial-visit-notes.ts#L1061-L1116)) — the only runtime `initialVisitRomSchema.safeParse` call in this file ([L1074](src/actions/initial-visit-notes.ts#L1074)). Gated by `assertCaseNotClosed` ([L1069](src/actions/initial-visit-notes.ts#L1069)). Branches update ([L1088-1097](src/actions/initial-visit-notes.ts#L1088-L1097)) vs insert ([L1098-1111](src/actions/initial-visit-notes.ts#L1098-L1111)); the insert path also sets `visit_date` to today, so `mapVisitDateOrderError` ([L44-55](src/actions/initial-visit-notes.ts#L44-L55)) applies. Ends with `revalidatePath` ([L1114](src/actions/initial-visit-notes.ts#L1114)).

**Generation-path coupling (read-only — generation never writes `rom_data`):**
- `gatherSourceData` takes a 4th `romData?: InitialVisitRomValues | null` param ([L63-69](src/actions/initial-visit-notes.ts#L63-L69)) and assigns `romData: romData ?? null` into `InitialVisitInputData` ([L315](src/actions/initial-visit-notes.ts#L315)).
- `generateInitialVisitNote` reads the row's `rom_data` as `preservedRom` ([L348-356](src/actions/initial-visit-notes.ts#L348-L356)) and forwards it ([L362-368](src/actions/initial-visit-notes.ts#L362-L368)). Its `.update()` calls ([L390-419](src/actions/initial-visit-notes.ts#L390-L419), [L545-570](src/actions/initial-visit-notes.ts#L545-L570)) never touch `rom_data`.
- `regenerateNoteSection` re-reads `note.rom_data` as `noteRom` and re-passes it ([L862-870](src/actions/initial-visit-notes.ts#L862-L870)).
- `computeSourceHash` ([L33-36](src/actions/initial-visit-notes.ts#L33-L36)) SHA-256s the whole `InitialVisitInputData`, so `romData` is part of the staleness hash stored at [L394](src/actions/initial-visit-notes.ts#L394) / [L568](src/actions/initial-visit-notes.ts#L568).

**Pain Evaluation Visit cross-read:** for `visitType === 'pain_evaluation_visit'`, the prior finalized Initial Visit's `rom_data` is in the `priorVisitQuery` select list ([L78-80](src/actions/initial-visit-notes.ts#L78-L80)) and copied to `priorVisitData.rom_data` ([L260](src/actions/initial-visit-notes.ts#L260)).

### UI — `src/components/clinical/initial-visit-editor.tsx`

- ROM imports at [L64-78](src/components/clinical/initial-visit-editor.tsx#L64-L78) (`initialVisitRomSchema`, `defaultRomData`, `type InitialVisitRomValues`) and `saveInitialVisitRom` at [L55](src/components/clinical/initial-visit-editor.tsx#L55).
- **Tab trigger** "Range of Motion" with `Activity` icon ([L434-437](src/components/clinical/initial-visit-editor.tsx#L434-L437)).
- **Tab content** mounting `RomInputCard` ([L457-459](src/components/clinical/initial-visit-editor.tsx#L457-L459)). Rendered only in the pre-generation branch, gated by `!note || (note.status === 'draft' && !hasGeneratedContent)` ([L403](src/components/clinical/initial-visit-editor.tsx#L403)).
- **`RomInputCard`** ([L1402-1490](src/components/clinical/initial-visit-editor.tsx#L1402-L1490)) — `useForm<{ rom: InitialVisitRomValues }>` with `defaultValues: { rom: initialRom ?? defaultRomData }` ([L1414-1418](src/components/clinical/initial-visit-editor.tsx#L1414-L1418)); `useFieldArray` on `rom` ([L1420-1423](src/components/clinical/initial-visit-editor.tsx#L1420-L1423)); `handleSaveRom` does manual `safeParse` then calls the action ([L1425-1437](src/components/clinical/initial-visit-editor.tsx#L1425-L1437)). Note: **no `zodResolver`** — unlike `VitalSignsCard` which uses `zodResolver(initialVisitVitalsSchema)` at [L1190](src/components/clinical/initial-visit-editor.tsx#L1190).
- **`RomRegionSection`** ([L1494-1634](src/components/clinical/initial-visit-editor.tsx#L1494-L1634)) — nested `useFieldArray` on `rom.${regionIndex}.movements` ([L1505-1508](src/components/clinical/initial-visit-editor.tsx#L1505-L1508)); region name input ([L1513-1527](src/components/clinical/initial-visit-editor.tsx#L1513-L1527)); per-movement grid with movement/normal/actual/pain controls ([L1550-1616](src/components/clinical/initial-visit-editor.tsx#L1550-L1616)); "Add Movement" ([L1621-1631](src/components/clinical/initial-visit-editor.tsx#L1621-L1631)). Used only by `RomInputCard`.
- **Prop plumbing:** outer prop `romByVisitType: Record<NoteVisitType, InitialVisitRomValues | null>` ([L159](src/components/clinical/initial-visit-editor.tsx#L159)) → `initialRom={romByVisitType[vt.value]}` ([L262](src/components/clinical/initial-visit-editor.tsx#L262)) → inner prop `initialRom` ([L188](src/components/clinical/initial-visit-editor.tsx#L188), destructured [L318](src/components/clinical/initial-visit-editor.tsx#L318)) → also forwarded into `DraftEditor` ([L610](src/components/clinical/initial-visit-editor.tsx#L610), props [L1644](src/components/clinical/initial-visit-editor.tsx#L1644), [L1656](src/components/clinical/initial-visit-editor.tsx#L1656)), though `DraftEditor`'s own `initialVisitNoteEditSchema` form ([L1663-1684](src/components/clinical/initial-visit-editor.tsx#L1663-L1684)) has no ROM field.
- **Reset dialog copy** mentions ROM preservation ([L556](src/components/clinical/initial-visit-editor.tsx#L556)).

### Page — `src/app/(dashboard)/patients/[caseId]/initial-visit/page.tsx`

- Imports `type InitialVisitRomValues` ([L10](src/app/(dashboard)/patients/[caseId]/initial-visit/page.tsx#L10)).
- ROM arrives via the shared `getInitialVisitNotes(caseId)` query, not a separate fetch; `NoteRow` declares `rom_data: unknown` ([L69](src/app/(dashboard)/patients/[caseId]/initial-visit/page.tsx#L69)).
- `romByVisitType` built at [L122-125](src/app/(dashboard)/patients/[caseId]/initial-visit/page.tsx#L122-L125), passed to the editor at [L146](src/app/(dashboard)/patients/[caseId]/initial-visit/page.tsx#L146).

### AI prompt — `src/lib/claude/generate-initial-visit.ts`

- `InitialVisitInputData.romData` field type ([L511-519](src/lib/claude/generate-initial-visit.ts#L511-L519)).
- **Global preamble rules** ([L61-63](src/lib/claude/generate-initial-visit.ts#L61-L63)): `[XX]` placeholder for null `actual`; the `"• {movement}: Normal {normal}° / Actual {actual}° / Pain: {Yes|No}"` render format; and the explicit **omit-entirely rule** when `romData` is null.
- **PDF-safe formatting rule** forbidding pipe tables for ROM ([L71](src/lib/claude/generate-initial-visit.ts#L71)).
- **Physical Examination section instructions** in `buildCommonSections` ([L126-130](src/lib/claude/generate-initial-visit.ts#L126-L130)) — the `"RANGE OF MOTION:"` sub-heading and a reference example.
- **Pain Evaluation Visit comparison instruction** referencing `priorVisitData.rom_data` ([L266](src/lib/claude/generate-initial-visit.ts#L266)); prior-visit type field at [L546](src/lib/claude/generate-initial-visit.ts#L546).
- **Tool schema:** `INITIAL_VISIT_TOOL.input_schema` ([L365-455](src/lib/claude/generate-initial-visit.ts#L365-L455)) has **no ROM field**; ROM lives inside the `physical_exam` string, per its description at [L417-420](src/lib/claude/generate-initial-visit.ts#L417-L420).
- `romData` is serialized into the user message via `curateInputDataForPrompt` ([L601-602](src/lib/claude/generate-initial-visit.ts#L601-L602)).

### PDF — `src/lib/pdf/initial-visit-template.tsx` and `render-initial-visit-pdf.ts`

- **No ROM field or component.** `InitialVisitPdfData` ([L4-45](src/lib/pdf/initial-visit-template.tsx#L4-L45)) has no `rom`/`romData`; `sectionEntries` ([L47-63](src/lib/pdf/initial-visit-template.tsx#L47-L63)) has no ROM entry.
- ROM reaches the PDF only as text inside `physical_exam` ([L30](src/lib/pdf/initial-visit-template.tsx#L30)), rendered by the generic `SectionBody` ([L128-179](src/lib/pdf/initial-visit-template.tsx#L128-L179)) using its bullet regex ([L141](src/lib/pdf/initial-visit-template.tsx#L141)) and `isSubHeading` ALL-CAPS detection ([L110-119](src/lib/pdf/initial-visit-template.tsx#L110-L119)).
- `render-initial-visit-pdf.ts` maps `input.note.physical_exam` straight through ([L158](src/lib/pdf/render-initial-visit-pdf.ts#L158)) with no ROM step.

### Database

**Migration `023_initial_visit_rom.sql`** — the entire file is an `alter table ... add column`, not a new table:
```sql
alter table public.initial_visit_notes
  add column rom_data jsonb;

comment on column public.initial_visit_notes.rom_data is
  'Structured ROM measurements: [{region, movements: [{movement, normal, actual, pain}]}]';
```
- Table: `public.initial_visit_notes`; column `rom_data jsonb`, nullable, no default.
- No `initial_visit_rom` table exists anywhere in the codebase.

**Generated types** — `src/types/database.ts`: `rom_data: Json | null` (Row, [L1258](src/types/database.ts#L1258)), `rom_data?: Json | null` (Insert, [L1299](src/types/database.ts#L1299)), (Update, [L1340](src/types/database.ts#L1340)).

### Tests

- `src/lib/validations/__tests__/initial-visit-note.test.ts` — imports the four ROM symbols at [L8-11](src/lib/validations/__tests__/initial-visit-note.test.ts#L8-L11). Three describe blocks: `romMovementSchema` ([L134-167](src/lib/validations/__tests__/initial-visit-note.test.ts#L134-L167), incl. 0/360 boundary and -1/361 rejection), `romRegionSchema` ([L169-190](src/lib/validations/__tests__/initial-visit-note.test.ts#L169-L190)), `defaultRomData` ([L192-233](src/lib/validations/__tests__/initial-visit-note.test.ts#L192-L233), asserting 9 regions and exact per-region movement counts: Cervical 6, Thoracic 4, Lumbar 6, each Shoulder 6, each Knee 2, each Hip 6).
- `src/lib/claude/__tests__/generate-initial-visit.test.ts:221` — fixture with `rom_data: null`.
- No test covers `getInitialVisitRom` / `saveInitialVisitRom`.

### ROM elsewhere in the codebase — NOT Initial Visit

These share no code or storage with Initial Visit ROM:

- **PT extraction** — table `public.pt_extractions`, column `range_of_motion jsonb not null default '[]'` ([012_pt_extractions.sql:37](supabase/migrations/012_pt_extractions.sql#L37)); `romMeasurementSchema` ([pt-extraction.ts:14](src/lib/validations/pt-extraction.ts#L14)), `PtRomMeasurement` ([L143](src/lib/validations/pt-extraction.ts#L143)); AROM/PROM prompt at [extract-pt.ts:10](src/lib/claude/extract-pt.ts#L10).
- **Pain-management extraction** — `normalizeRomArray` ([extract-pain-management.ts:195](src/lib/claude/extract-pain-management.ts#L195)), used at [L244](src/lib/claude/extract-pain-management.ts#L244); `range_of_motion` Json column in `database.ts` at L2640/L2689/L2738; `RomSection` UI component ([pm-extraction-form.tsx:436](src/components/clinical/pm-extraction-form.tsx#L436), [L811](src/components/clinical/pm-extraction-form.tsx#L811)).
- **Chiro extraction** — no ROM field found under those identifiers.

## Code References

- `src/lib/validations/initial-visit-note.ts:114-226` — all four ROM schema/default declarations
- `src/actions/initial-visit-notes.ts:1041-1116` — `getInitialVisitRom` + `saveInitialVisitRom`
- `src/actions/initial-visit-notes.ts:63-69,315` — `gatherSourceData` ROM param and assignment
- `src/actions/initial-visit-notes.ts:348-368,862-870` — ROM preservation on generate/regenerate
- `src/actions/initial-visit-notes.ts:78-80,260` — prior-visit `rom_data` read for pain evaluation
- `src/components/clinical/initial-visit-editor.tsx:434-459` — ROM tab trigger + content
- `src/components/clinical/initial-visit-editor.tsx:1402-1634` — `RomInputCard` + `RomRegionSection`
- `src/components/clinical/initial-visit-editor.tsx:159,262,188,318,610` — `romByVisitType`/`initialRom` prop chain
- `src/app/(dashboard)/patients/[caseId]/initial-visit/page.tsx:122-125,146` — `romByVisitType` construction
- `src/lib/claude/generate-initial-visit.ts:61-63,71,126-130,266,511-519,546` — ROM prompt rules and input type
- `src/lib/pdf/initial-visit-template.tsx:110-119,128-179` — generic renderer ROM passes through
- `supabase/migrations/023_initial_visit_rom.sql` — `rom_data jsonb` column
- `src/types/database.ts:1258,1299,1340` — generated `rom_data` types
- `src/lib/validations/__tests__/initial-visit-note.test.ts:8-11,134-233` — ROM test coverage

## Architecture Documentation

**Sibling-slice pattern.** Initial Visit stores three independently-saved data groups on one `initial_visit_notes` row — `provider_intake`, vitals (in the separate `vital_signs` table), and `rom_data` — each with its own schema, its own get/save action pair, and its own editor card. ROM follows this pattern exactly, which is why its footprint is contiguous rather than threaded through the note-section machinery.

**Structured-in, prose-out.** ROM is the clearest example of the codebase's pattern where structured provider input is fed to the model as JSON but returned as formatted prose inside a narrative section, rather than round-tripping as structure. The system prompt carries the render contract (`Normal X° / Actual Y° / Pain: Z`), the tool schema carries nothing, and the PDF's generic ALL-CAPS-sub-heading + bullet detection is what re-styles it. The prompt's explicit "if romData is null, omit ROM entirely" instruction ([generate-initial-visit.ts:63](src/lib/claude/generate-initial-visit.ts#L63)) is the existing mechanism by which a note is produced with no ROM content.

**Row-scoped by `(case_id, visit_type)`.** Initial Visit and Pain Evaluation Visit are separate rows, so each carries its own independent `rom_data`; the pain-evaluation generation path additionally reads the initial visit's ROM as one-way comparison context.

**Client-side-only validation entry.** `RomInputCard` deliberately omits `zodResolver` and validates once in the save handler, diverging from the sibling `VitalSignsCard`.

## Related Research

- [2026-04-22 Initial Visit tone direction & sections edit](thoughts/shared/research/2026-04-22-initial-visit-tone-direction-sections-edit.md)
- [2026-03-09 Epic 3 Story 3.1 Initial Visit Note design](thoughts/shared/research/2026-03-09-epic-3-story-3.1-initial-visit-note-design.md)
- [2026-03-22 Initial Visit cost estimate and settings defaults](thoughts/shared/research/2026-03-22-initial-visit-cost-estimate-and-settings-defaults.md)

## Open Questions

- Whether any existing rows in `initial_visit_notes` carry non-null `rom_data`, and whether already-finalized notes contain `RANGE OF MOTION:` text baked into their stored `physical_exam` strings (that prose is immutable once generated — it is not re-derived from `rom_data` at render time).
- Whether `defaultRomData`'s 9-region template is referenced by anything outside `RomInputCard` and its tests.
