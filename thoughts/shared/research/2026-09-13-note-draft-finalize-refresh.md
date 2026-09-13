---
date: 2026-09-13T15:29:07-07:00
researcher: Codex
git_commit: 1a363f27aa44d38ed9cb93da2c5d6fe3a1f03b55
branch: main
repository: cliniq
topic: "Why Save Draft in notes needs refresh before finalizing"
tags: [research, codebase, clinical-notes, concurrency]
status: complete
last_updated: 2026-09-13
last_updated_by: Codex
---

# Research: Save Draft and finalization refresh

## Research Question

Check why Save Draft in notes needs refresh before finalizing.

## Summary

The strongest matching path is the telehealth follow-up editor. Save Draft receives a new saved row but does not adopt its version locally. It depends on route refresh to supply that version. Finalize first saves again using the version in the current props. If refreshed props have not arrived, that preliminary save uses the old version and the server rejects it with “Note changed. Reload before saving”. Refresh reloads the current row and remounts the editor.

This is a confirmed component-level stale-props sequence, not a verified live-browser explanation for every note type. The user has not specified the affected note type or exact symptom. Server route revalidation can also deliver updated props, so manual refresh is not necessarily required on every save.

## Detailed Findings

### Shared version contract

- `src/lib/clinical/save-visit-decision.ts:13` requires the browser's expected timestamp and sends it to the database save function.
- `supabase/migrations/20260910234459_visit_treatment_decision.sql:94` locks and loads the note; line 97 rejects a mismatched timestamp. Lines 130–133 persist the decision and return the updated row.
- Finalization in the editors first saves the current form. A save failure prevents signing, so the visible finalization failure may actually be from this preliminary save.

### Telehealth follow-up

- `src/components/visits/pain-follow-up-editor.tsx:60` initializes narrative and decision from props on mount.
- `src/components/visits/pain-follow-up-editor.tsx:73` runs actions, ignores successful returned data, requests `router.refresh()`, then clears pending without waiting for refreshed props.
- `src/components/visits/pain-follow-up-editor.tsx:172` takes the submitted version from `initialNote.updated_at`.
- `src/components/visits/pain-follow-up-editor.tsx:219` saves before finalizing, stops on an error, and otherwise passes the returned saved version to finalization.
- `src/actions/pain-follow-up-notes.ts:136` revalidates the visit route after save. This may provide fresh props as part of the server action lifecycle.
- `src/app/(dashboard)/patients/[caseId]/visits/[encounterId]/page.tsx:29` keys the editor using the helper at `src/lib/clinical/pain-follow-up-editor-key.ts:8`. The key includes id and updated_at, so a changed saved version remounts it.

Sequence: mounted v1 → Save Draft writes v2 → editor still has v1 until props refresh → Finalize attempts save with v1 → stale-version rejection → refresh loads v2.

### Initial visit, pain evaluation, and discharge

- Initial visit/pain evaluation adopt the returned row immediately in `acceptSavedNote`, including updated_at, decision, and education (`src/components/clinical/initial-visit-editor.tsx:1413`). Save calls it at line 1437; finalization saves and passes the returned version at lines 1510–1523.
- Discharge similarly adopts the saved version (`src/components/discharge/discharge-note-editor.tsx:479`), calls this after Save Draft (lines 549–565), and saves before signing (lines 653–663).
- `src/hooks/use-visit-note-version.ts:8` fingerprints narrative/decision data and accepts refreshed versions only when that fingerprint matches the acknowledged baseline. It preserves local content against unrelated external narrative edits.
- Discharge save also refreshes trajectory and reloads its final saved row before returning it (`src/actions/discharge-notes.ts:1028`).
- Separate tone-hint writes update the same note but return neither a saved version nor route revalidation: `src/actions/initial-visit-notes.ts:1279` and `src/actions/discharge-notes.ts:1610`. The editor blur handlers call these separately. A tone write after the editor last reconciled its version can therefore make a later Save/Finalize stale, even without a narrative change. This is a distinct trigger, not proof that ordinary Save Draft fails to reconcile these editors.

### Procedure notes

`src/actions/procedure-notes.ts:837` saves without a browser expected-version field. The procedure editor saves before calling finalize (`src/components/procedures/procedure-note-editor.tsx:495`); the finalizer reads the current database row (`src/actions/procedure-notes.ts:881`) and supplies that version to completion (line 962). The follow-up stale-props mechanism does not directly apply here.

## Architecture Documentation

Note families share server-side timestamp concurrency checks but use different client reconciliation paths: explicit saved-response adoption for initial/discharge and route-prop remounting for follow-up. Additional metadata writes also advance the row timestamp.

## Verification

- `npm test -- src/hooks/__tests__/use-visit-note-version.test.ts src/components/clinical/__tests__/visit-editor-regeneration.test.tsx`: 2 files, 11 tests passed.
- Temporary component reproduction copied the existing follow-up decision tests and added Save Draft → Finalize without refreshed props. It confirmed the second save submits v1 after receiving saved v2, and a mocked server stale error prevents finalize. The refresh function was mocked; this did not test Next.js route delivery timing or a live database.
- `npm test -- src/components/visits/__tests__/draft-refresh-research.test.tsx src/actions/__tests__/pain-follow-up-notes-finalize.test.ts`: 2 files, 13 tests passed. Temporary test removed afterward; application code unchanged.
- Existing graph query located related note/save paths; current source was used as authority. The graphify executable was unavailable on PATH; its configured Python module ran successfully. `gh repo view --json owner,name` was unavailable because gh is not installed; the verified Git remote supplies permalink ownership below.
- No live-browser reproduction, lint, formatting, or type check was performed; the retained change is this research document only.

## Code References

- [src/components/visits/pain-follow-up-editor.tsx:73](https://github.com/arsenaid-yere1/cliniq/blob/1a363f27aa44d38ed9cb93da2c5d6fe3a1f03b55/src/components/visits/pain-follow-up-editor.tsx#L73)
- [src/components/visits/pain-follow-up-editor.tsx:172](https://github.com/arsenaid-yere1/cliniq/blob/1a363f27aa44d38ed9cb93da2c5d6fe3a1f03b55/src/components/visits/pain-follow-up-editor.tsx#L172)
- [src/lib/clinical/save-visit-decision.ts:13](https://github.com/arsenaid-yere1/cliniq/blob/1a363f27aa44d38ed9cb93da2c5d6fe3a1f03b55/src/lib/clinical/save-visit-decision.ts#L13)
- [supabase/migrations/20260910234459_visit_treatment_decision.sql:97](https://github.com/arsenaid-yere1/cliniq/blob/1a363f27aa44d38ed9cb93da2c5d6fe3a1f03b55/supabase/migrations/20260910234459_visit_treatment_decision.sql#L97)
- [src/components/clinical/initial-visit-editor.tsx:1413](https://github.com/arsenaid-yere1/cliniq/blob/1a363f27aa44d38ed9cb93da2c5d6fe3a1f03b55/src/components/clinical/initial-visit-editor.tsx#L1413)
- [src/components/discharge/discharge-note-editor.tsx:479](https://github.com/arsenaid-yere1/cliniq/blob/1a363f27aa44d38ed9cb93da2c5d6fe3a1f03b55/src/components/discharge/discharge-note-editor.tsx#L479)
- [src/actions/initial-visit-notes.ts:1279](https://github.com/arsenaid-yere1/cliniq/blob/1a363f27aa44d38ed9cb93da2c5d6fe3a1f03b55/src/actions/initial-visit-notes.ts#L1279)
- [src/actions/discharge-notes.ts:1610](https://github.com/arsenaid-yere1/cliniq/blob/1a363f27aa44d38ed9cb93da2c5d6fe3a1f03b55/src/actions/discharge-notes.ts#L1610)

## Related Research

- [Case reactivation and note reset](2026-09-08-case-reactivation-and-note-reset.md)
- [Other notes consent and understanding](2026-09-10-other-notes-consent-and-understanding.md)

## Open Questions

- Which note type is affected, and is the symptom a disabled button or an error? What is the exact message?
- Does the live route deliver fresh props after saving, and was a tone field blurred or another write made before finalization?
