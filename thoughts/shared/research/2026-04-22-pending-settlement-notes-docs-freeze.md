---
date: 2026-04-22T23:08:48Z
researcher: arsenaid
git_commit: bcf68b01d443a7d028a752b595970cc83d8eaf75
branch: main
repository: cliniq
topic: "Why switching case status to Pending Settlement doesn't freeze Edit buttons for Notes and Documents"
tags: [research, codebase, case-status, locked-statuses, notes, documents, pending-settlement]
status: complete
last_updated: 2026-04-22
last_updated_by: arsenaid
---

# Research: Why switching case status to Pending Settlement doesn't freeze Edit buttons for Notes and Documents

**Date**: 2026-04-22T23:08:48Z
**Researcher**: arsenaid
**Git Commit**: bcf68b01d443a7d028a752b595970cc83d8eaf75
**Branch**: main
**Repository**: cliniq

## Research Question
Why does switching a case status to "Pending Settlement" not freeze the Edit buttons on Notes and Documents?

## Summary
The codebase gates editing on the client side using a shared constant `LOCKED_STATUSES = ['closed', 'archived']` defined in [src/lib/constants/case-status.ts:24](src/lib/constants/case-status.ts#L24). Every consumer — clinical note editors, document list, discharge editor, procedure editor, procedure table, case overview — derives `isLocked` from `LOCKED_STATUSES.includes(caseStatus)`.

`pending_settlement` is not in `LOCKED_STATUSES`. It is only listed among the valid `CASE_STATUSES` and wired into `CASE_STATUS_TRANSITIONS`. As a result, every `isLocked` check returns `false` when the case is in Pending Settlement, so Edit/Upload/Delete/Generate affordances remain enabled. The same holds on the server: the shared write guard `assertCaseNotClosed` (used by ~38 write functions across 13 action files) blocks writes only when status is in `LOCKED_STATUSES`.

Two additional observations about scope:
1. "Notes" in this codebase means the three clinical note editors (initial visit, procedure, discharge). There is no generic "notes" CRUD feature.
2. Within the Documents feature, the `isLocked` flag is derived in the list component and used only to disable the `Upload Document` button. The per-row `DocumentCard` Download and Delete buttons are not wired to `isLocked` — they stay enabled for every status, including `closed` and `archived`.

## Detailed Findings

### Case status enum and lock set

[src/lib/constants/case-status.ts](src/lib/constants/case-status.ts)

```ts
export const CASE_STATUSES = ['intake', 'active', 'pending_settlement', 'closed', 'archived'] as const
export type CaseStatus = (typeof CASE_STATUSES)[number]

export const CASE_STATUS_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  intake:             ['active', 'closed'],
  active:             ['pending_settlement', 'closed'],
  pending_settlement: ['closed', 'active'],
  closed:             ['active', 'archived'],
  archived:           ['closed'],
}

export const LOCKED_STATUSES: CaseStatus[] = ['closed', 'archived']
```

- `pending_settlement` is a legal state in the enum and in the transition graph, but it is deliberately not a member of `LOCKED_STATUSES`.
- Unit tests codify the exclusion: [src/lib/constants/__tests__/case-status.test.ts:89](src/lib/constants/__tests__/case-status.test.ts#L89) asserts `expect(LOCKED_STATUSES).not.toContain('pending_settlement')`.

### Case status context (client-side source of truth)

[src/components/patients/case-status-context.tsx](src/components/patients/case-status-context.tsx)

A React context providing the current case's status to any descendant. The provider is mounted once in the case layout:

[src/app/(dashboard)/patients/[caseId]/layout.tsx](src/app/(dashboard)/patients/[caseId]/layout.tsx)

```tsx
return (
  <CaseStatusProvider status={data.case_status}>
    <div className="flex h-full -m-6">
      <CaseSidebar caseData={data} />
      <div className="flex-1 p-6">{children}</div>
    </div>
  </CaseStatusProvider>
)
```

All Notes/Documents sub-pages render inside this provider, so every child reads the current `case_status` via `useCaseStatus()`.

### "Notes" feature — three clinical note editors

There is no generic notes feature in this codebase. User-facing "Notes" are three separate editors, each gated independently with the same pattern.

**Initial-visit note editor** — [src/components/clinical/initial-visit-editor.tsx:320](src/components/clinical/initial-visit-editor.tsx#L320)
```ts
const caseStatus = useCaseStatus()
const isLocked = LOCKED_STATUSES.includes(caseStatus as CaseStatus)
```
`isLocked` is threaded into the editor UI (disabled Generate/Regenerate/Save affordances). Because `pending_settlement` is not in `LOCKED_STATUSES`, `isLocked === false` here, so Edit controls remain enabled.

**Procedure note editor** — [src/components/procedures/procedure-note-editor.tsx:201](src/components/procedures/procedure-note-editor.tsx#L201)
Same pattern; same result for `pending_settlement`.

**Discharge note editor** — [src/components/discharge/discharge-note-editor.tsx:207](src/components/discharge/discharge-note-editor.tsx#L207)
Same pattern; same result for `pending_settlement`. `isLocked` is forwarded to the vitals card and tone-direction card ([discharge-note-editor.tsx:253](src/components/discharge/discharge-note-editor.tsx#L253)).

**Procedure table** — [src/components/procedures/procedure-table.tsx:132](src/components/procedures/procedure-table.tsx#L132)
Same pattern.

**Case overview** — [src/components/patients/case-overview.tsx:79](src/components/patients/case-overview.tsx#L79)
Same pattern.

**Clinical extraction forms and reviews** — all use the same derivation:
- [src/components/clinical/case-summary-card.tsx:75](src/components/clinical/case-summary-card.tsx#L75)
- [src/components/clinical/chiro-extraction-form.tsx:49](src/components/clinical/chiro-extraction-form.tsx#L49), [chiro-extraction-review.tsx:95](src/components/clinical/chiro-extraction-review.tsx#L95)
- [src/components/clinical/ct-scan-extraction-form.tsx:48](src/components/clinical/ct-scan-extraction-form.tsx#L48), [ct-scan-extraction-review.tsx:54](src/components/clinical/ct-scan-extraction-review.tsx#L54)
- [src/components/clinical/mri-extraction-form.tsx:48](src/components/clinical/mri-extraction-form.tsx#L48), [mri-extraction-review.tsx:52](src/components/clinical/mri-extraction-review.tsx#L52)
- [src/components/clinical/ortho-extraction-form.tsx:48](src/components/clinical/ortho-extraction-form.tsx#L48), [ortho-extraction-review.tsx:80](src/components/clinical/ortho-extraction-review.tsx#L80)
- [src/components/clinical/pm-extraction-form.tsx:48](src/components/clinical/pm-extraction-form.tsx#L48), [pm-extraction-review.tsx:62](src/components/clinical/pm-extraction-review.tsx#L62)
- [src/components/clinical/pt-extraction-form.tsx:45](src/components/clinical/pt-extraction-form.tsx#L45), [pt-extraction-review.tsx:91](src/components/clinical/pt-extraction-review.tsx#L91)

All of these resolve `isLocked === false` when status is `pending_settlement`.

### Documents feature

**[src/components/documents/document-list.tsx:63](src/components/documents/document-list.tsx#L63)**
```ts
const caseStatus = useCaseStatus()
const isLocked = LOCKED_STATUSES.includes(caseStatus as CaseStatus)
```
Uses `isLocked` for exactly one thing — the `Upload Document` button at the top of the list:
```tsx
<Button onClick={() => setUploadOpen(true)} disabled={isLocked}>
  <Upload className="h-4 w-4 mr-2" />
  Upload Document
</Button>
```
No `isLocked` prop is passed to `<DocumentCard>`. `DocumentList` renders:
```tsx
<DocumentCard key={doc.id} document={doc} patientLastName={patientLastName} onRemoved={refreshDocuments} />
```

**[src/components/documents/document-card.tsx](src/components/documents/document-card.tsx)**
`DocumentCard` is the per-document row. It has Preview, Download, and Delete (trash icon) buttons. It does not accept any `isLocked`/`caseStatus`/`readOnly`/`disabled` prop and does not consume `useCaseStatus()`. The Download and Delete buttons are therefore always enabled, for every case status — including `closed` and `archived` (the client never disables them; server guards still block the underlying actions).

The `UploadSheet` component is opened by the list-level button gated above; the sheet itself also does not gate internally.

### Server-side write guard

[src/actions/case-status.ts:9-24](src/actions/case-status.ts#L9-L24)
```ts
export async function assertCaseNotClosed(
  supabase: Awaited<ReturnType<typeof createClient>>,
  caseId: string,
): Promise<{ error: string | null }> {
  const { data } = await supabase
    .from('cases')
    .select('case_status')
    .eq('id', caseId)
    .is('deleted_at', null)
    .single()

  if (data?.case_status && LOCKED_STATUSES.includes(data.case_status as CaseStatus)) {
    return { error: 'This case is closed. No modifications are allowed until it is reopened.' }
  }
  return { error: null }
}
```
Keyed off the same `LOCKED_STATUSES` constant. Called at the top of ~38 write functions across 13 action files (see `grep -n "assertCaseNotClosed"` output), including:
- [src/actions/documents.ts:115,141,203](src/actions/documents.ts#L115) — upload, finalize, remove
- [src/actions/initial-visit-notes.ts](src/actions/initial-visit-notes.ts) — 9 sites
- [src/actions/procedure-notes.ts](src/actions/procedure-notes.ts) — 8 sites
- [src/actions/discharge-notes.ts](src/actions/discharge-notes.ts) — 8 sites
- [src/actions/billing.ts:367,436,507](src/actions/billing.ts#L367)
- and others (case-summaries, extractions for chiro/ct/mri/ortho/pm/pt, lien, procedures, procedure-consents, clinical-orders)

Because `pending_settlement` is not in `LOCKED_STATUSES`, `assertCaseNotClosed` returns `{ error: null }` for those cases, so all note/document write actions proceed normally.

### Status change UI

[src/components/patients/status-change-dropdown.tsx](src/components/patients/status-change-dropdown.tsx) — the dropdown that moves a case between statuses. The action `updateCaseStatus` in [src/actions/case-status.ts](src/actions/case-status.ts) validates the transition using `CASE_STATUS_TRANSITIONS`, enforces prerequisites (medical invoice is required before moving to `pending_settlement` or `closed`), logs history, and revalidates. This action changes the `case_status` column only — it does not sweep any other tables and does not interact with `LOCKED_STATUSES` besides the shared guard.

## Code References
- `src/lib/constants/case-status.ts:1-24` — `CASE_STATUSES`, `CASE_STATUS_TRANSITIONS`, `LOCKED_STATUSES`
- `src/lib/constants/__tests__/case-status.test.ts:80-92` — tests that pin `pending_settlement` out of `LOCKED_STATUSES`
- `src/components/patients/case-status-context.tsx` — client-side status context + `useCaseStatus()`
- `src/app/(dashboard)/patients/[caseId]/layout.tsx` — wraps case pages in `CaseStatusProvider`
- `src/components/documents/document-list.tsx:63` — list-level `isLocked` derivation
- `src/components/documents/document-list.tsx:100-105` — Upload button `disabled={isLocked}`
- `src/components/documents/document-card.tsx` — per-document row; no `isLocked` consumption
- `src/components/clinical/initial-visit-editor.tsx:320` — editor `isLocked` derivation
- `src/components/discharge/discharge-note-editor.tsx:207` — editor `isLocked` derivation
- `src/components/procedures/procedure-note-editor.tsx:201` — editor `isLocked` derivation
- `src/actions/case-status.ts:9-24` — `assertCaseNotClosed` server guard
- `src/actions/documents.ts:115,141,203` — guard call-sites for document writes
- `src/actions/case-status.ts:55+` — `updateCaseStatus` and `pending_settlement` prerequisite checks

## Architecture Documentation

The codebase implements a single shared "lock" concept for case-scoped writes, with identical client and server derivations driven by one constant:

1. **Single source of truth** — `LOCKED_STATUSES` in `src/lib/constants/case-status.ts`.
2. **Client gating** — every editor/form computes `isLocked = LOCKED_STATUSES.includes(caseStatus as CaseStatus)` off `useCaseStatus()` and forwards it as a prop or uses it to set `disabled` on buttons and inputs.
3. **Server gating** — every mutating server action calls `assertCaseNotClosed(supabase, caseId)` at the top, which consults the same `LOCKED_STATUSES` set.
4. **Status model** — five statuses (`intake`, `active`, `pending_settlement`, `closed`, `archived`), governed by a transition map (`CASE_STATUS_TRANSITIONS`). `pending_settlement` is a transient, editable state between `active` and `closed`; closure requires a medical invoice prerequisite (verified inside `updateCaseStatus`).
5. **UI coverage gap** — `DocumentList` applies the lock to the top-level Upload button only. `DocumentCard` rows (containing Download and Delete) do not consume the lock and are controlled only by the server guard.

## Related Research
- [2026-04-22-case-close-invoice-check.md](2026-04-22-case-close-invoice-check.md) — how closure interacts with billing, summarizes `LOCKED_STATUSES` role.
- [2026-03-14-case-status-design-recommendation.md](2026-03-14-case-status-design-recommendation.md) — original status-lock design, including `LOCKED_STATUSES` composition.
- [2026-04-22-billing-panel-invoice-download-delete.md](2026-04-22-billing-panel-invoice-download-delete.md) — mirror case for billing row actions.
- [thoughts/shared/plans/2026-03-14-case-status-transitions.md](../plans/2026-03-14-case-status-transitions.md) — plan that introduced `pending_settlement` as a non-locked transient status.

## Open Questions
- None relating strictly to documenting current behavior; the observed behavior is a direct consequence of `pending_settlement` being absent from `LOCKED_STATUSES` by design.
