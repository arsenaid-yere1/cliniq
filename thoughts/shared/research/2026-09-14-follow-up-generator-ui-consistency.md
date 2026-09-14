# Follow-up note generator UI and custom guidance

## Research question

How does the pain follow-up note generator differ from the initial-visit,
procedure, and discharge generators in layout, generation feedback, and
provider-entered custom guidance? Which existing implementation boundaries
explain the missing custom prompt?

Research date: 2026-09-14. This document records current implementation and
the implications for the requested consistency change; no application changes
were made during this research.

## Summary

The follow-up generator has a separate editor implementation. It does not use
the shared `ToneDirectionCard`, and its full-generation action, section action,
and AI helper do not accept or read provider tone guidance. This is an end-to-end
wiring gap, not a hidden field or a missing database column: `tone_hint` already
exists in the follow-up table and its generated TypeScript types.

Other generators expose **Tone & Direction (optional)** before generation and
in the editable draft. They persist guidance per note and reuse it during
generation, retry, and section regeneration. Their empty states, progress
feedback, section layout, and regeneration confirmations also differ from
the follow-up editor.

## Detailed findings by component

### Page and intake ownership

- `src/app/(dashboard)/patients/[caseId]/visits/[encounterId]/page.tsx:13`
  loads the encounter, owning episode state, note, and procedure relationships.
  It renders a page heading, `TelehealthIntakeCard`, then `PainFollowUpEditor`.
- `src/components/visits/telehealth-intake-card.tsx:32` owns the encounter input
  state: visit date, patient-reported pain, complaint, interval history, review
  of systems, video observations, telehealth consent, and connection/location
  details. These are source facts, separate from generated-note guidance.
- Intake has its own Save action. `gatherSource` reads saved encounter data;
  it cannot access unsaved intake component state.
- The page already provides a `text-2xl font-bold` title. A consistency change
  should account for this existing page heading instead of mechanically adding
  another top-level title inside the editor.

### Follow-up editor

`src/components/visits/pain-follow-up-editor.tsx`, `PainFollowUpEditor`:

| State / feature | Existing follow-up behavior | Comparable generator behavior |
| --- | --- | --- |
| Empty | Compact Card, descriptive text, left-aligned Generate button (`:100`) | Spaced input cards, ToneDirectionCard, centered bordered muted generation panel |
| Pending generation | Button wording changes through generic `pending` state (`:76`, `:115`) | Dedicated optimistic generating branch shown immediately |
| Persisted generating | Card with spinner and one sentence (`:127`) | Generating badge, GeneratingProgress, section skeletons |
| Failed | Error Card, Retry, Reset (`:139`) | Heading/status badge, error strip, Retry, Reset |
| Draft heading | Smaller heading and plain lowercase status (`:215`) | Larger heading with Draft badge and icon buttons |
| Draft content | Eleven separate Cards, small titles, every textarea uses four rows (`:258`) | Labeled form sections with section-specific row counts |
| Section regeneration | Immediate action on click (`:270`) | Confirmation dialog identifies content being replaced |
| Custom guidance | No state or input | ToneDirectionCard before generation and during draft editing |
| Finalized content | Disabled textareas (`:291`) | Separate document-style read-only rendering |

Comparison anchors:

- Initial visit: `src/components/clinical/initial-visit-editor.tsx:410`
  (empty), `:482` (tone), `:489` (generation panel), `:1586` (draft tone),
  `:1622` (regeneration confirmation), `:1639` (section rows).
- Procedure: `src/components/procedures/procedure-note-editor.tsx:224`
  (optimistic generation), `:256` (empty), `:261` (tone), `:267` (panel),
  `:558` (draft form), `:595` (confirmation), `:612` (section rows).
- Discharge: `src/components/discharge/discharge-note-editor.tsx:278`
  (optimistic generation), `:311` (empty), `:325` (tone), `:331` (panel),
  `:791` (draft tone), `:834` (confirmation), `:851` (section rows).

Inference: the different grouping, text hierarchy, textarea sizing, and action
feedback plausibly explain the reported visual mismatch. This was established
from source structure, not a browser screenshot or live visual inspection.

### Existing shared custom-prompt component

`src/components/clinical/tone-direction-card.tsx:17`, `ToneDirectionCard`,
renders a controlled three-row textarea in a Card titled
“Tone & Direction (optional)”. Its props support value, change, blur, disabled
state, and an optional description. Its default description explicitly says
guidance applies to full generation and per-section regeneration.

The equivalent product feature is optional phrasing/style/emphasis guidance,
not a replacement system prompt or another clinical intake field.

### Follow-up persistence and AI wiring

- `supabase/migrations/20260826161637_pain_follow_up_notes.sql:28` already
  declares nullable `tone_hint text`.
- `src/types/database.ts:2731`, `:2767`, and `:2803` include the column in Row,
  Insert, and Update types. Repository schema support is verified; no live
  database introspection was performed.
- `src/actions/pain-follow-up-notes.ts:73`, `generatePainFollowUpNote`, takes
  only case and encounter IDs. Its existing-row projection contains
  `id,status,generation_attempts`; inserts and updates do not set `tone_hint`.
  It calls `generatePainFollowUp(source.data)` at `:103`.
- `src/actions/pain-follow-up-notes.ts:119`, `savePainFollowUpNote`, validates
  note-edit values. The edit schema at
  `src/lib/validations/pain-follow-up-note.ts:62` contains no tone field.
- `src/actions/pain-follow-up-notes.ts:148`,
  `regeneratePainFollowUpSectionAction`, reads `id,status,updated_at`, calls
  the full generator, and persists only the selected narrative section plus
  response/audit metadata. It does not read guidance. Its optional fourth
  argument is an existing quality-finding fix, not provider tone.
- `src/lib/claude/generate-pain-follow-up.ts:78`, `generatePainFollowUp`, accepts
  source data and optional quality-finding regeneration instructions. The user
  message contains the source JSON and finding instruction; there is no
  custom-guidance parameter or prompt block.
- The generator already enforces structured output, telehealth examination
  boundaries, current consent sourcing, and treatment-decision safeguards.
  Those are distinct from stylistic guidance.

### Guidance lifecycle in other generators

Procedure and discharge generation normalize incoming guidance and fall back
to persisted guidance for retry (`src/actions/procedure-notes.ts:607`, `:620`;
`src/actions/discharge-notes.ts:778`). Draft editors initialize from the stored
column and save changes on blur. Initial-visit and discharge editors use
`useDraftNoteMutations`; the procedure editor calls its tone save action directly
(`src/components/procedures/procedure-note-editor.tsx:419`).

AI helpers append a labeled provider-guidance block to both full and sectional
requests:

- `src/lib/claude/generate-initial-visit.ts:614`, `:692`
- `src/lib/claude/generate-procedure-note.ts:879`, `:954`
- `src/lib/claude/generate-discharge-note.ts:561`, `:632`

Thus adding a textarea alone would not deliver equivalent behavior. Persistence,
retry, section regeneration, and prompt construction are all part of the
current comparable feature.

### Editor state and version constraints

`src/lib/clinical/pain-follow-up-editor-state.ts:23`,
`getPainFollowUpEditorState`, already recognizes missing/empty drafts, generating,
failed, draft, and finalized states. It considers all eleven sections and
structured recommendations when deciding whether a draft is empty.

`src/lib/clinical/pain-follow-up-editor-key.ts:6`,
`buildPainFollowUpEditorKey`, keys the component by note ID and `updated_at`.
A persisted update followed by a route refresh can therefore remount the
editor. Inference: independently saving guidance and refreshing could discard
unsaved narrative edits unless mutation handling accounts for this boundary.

The editor tracks an expected version in a ref and validates the returned saved
row before finalizing (`src/components/visits/pain-follow-up-editor.tsx:67`,
`:193`). `saveDraft` updates that acknowledged version and canonical local
content. Finalize saves first, then passes the acknowledged timestamp
(`:244`). Any additional write to the same note must integrate with this
version sequence.

## Execution and data flow

```text
Encounter intake -> explicit intake save -> clinical_encounters
  -> follow-up Generate action -> gatherSource
  -> generatePainFollowUp(source, optional quality finding)
  -> structured output + clinical validators
  -> pain_follow_up_notes -> route refresh -> editor remount

Other note generators:
ToneDirectionCard -> local guidance -> generate/save-tone action
  -> persisted tone_hint -> full/retry/section AI prompt guidance

Follow-up today:
tone_hint column exists, but no editor/action/AI guidance path connects to it
```

## Existing tests and verification

Executed:

```sh
npm test -- src/components/visits/__tests__/pain-follow-up-decision.test.tsx src/lib/claude/__tests__/generate-pain-follow-up.test.ts src/lib/clinical/__tests__/pain-follow-up-editor-state.test.ts src/lib/clinical/__tests__/pain-follow-up-editor-key.test.ts src/lib/validations/__tests__/pain-follow-up-note.test.ts
```

Result: **5 files, 64 tests passed**. Coverage includes draft/finalize version
chaining, retained edits after failure, decision handling, locked episodes,
state selection, editor remount keys, schema validation, model routing,
quality-finding instructions, and clinical output safeguards.

No follow-up custom-guidance tests exist in these suites because the feature
is absent. They also do not establish visual parity with the other editors.
No browser/manual visual verification, live AI request, or database mutation
was performed. Formatting, lint, and type checking were not run for this
documentation-only change.

## Historical context

- `thoughts/shared/research/2026-04-19-tone-direction-for-procedure-and-discharge-notes.md`
  describes an older state where procedure/discharge guidance was absent.
  Current source now contains shared UI and persisted guidance; that document
  must not be treated as the current implementation.
- `thoughts/shared/research/2026-09-03-pain-follow-up-reset-functionality.md`
  already identified the unused follow-up tone column. Its older claims about
  missing reset and editor states have since been superseded by current code.
- Recent editor history includes `fabba99` (avoid stale note-finalize version),
  `279e1de` (revert follow-up source review), and `61b6725` (record visit
  treatment-plan decisions). Existing save/version behavior is relevant to
  extending the form safely.
- Graphify traversal found the shared tone and comparable generator nodes.
  The broad graph query was used for orientation; current source supplied the
  detailed findings above.

## Open questions

1. The request invokes a research-only skill while describing an implementation
   outcome. Scope clarification was requested: research only or research followed
   by implementation. No implementation was performed in this research phase.
2. “Form looks off” does not identify whether it includes the encounter intake
   or finalized document presentation. Those are separate components/states;
   the verified generator differences above do not require changing intake facts.
3. A future implementation should define clear-versus-omitted guidance semantics
   explicitly: comparable full-generation actions currently fall back to stored
   guidance for blank/null input, whereas draft tone saves can clear it.

The direct implementation boundary for the requested generator consistency is
the follow-up editor, follow-up actions, AI helper, and focused regression
tests. The repository already contains the shared guidance UI and database field.
