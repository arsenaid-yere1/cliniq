---
date: 2026-04-22T17:57:10Z
researcher: arsenaid
git_commit: 415e8545c5ec1c0ba7b54e5caf48383b867e679f
branch: main
repository: cliniq
topic: "Does unfinalize remove existing documents from the document repository?"
tags: [research, codebase, unfinalize, document-repository, notes, finalize]
status: complete
last_updated: 2026-04-22
last_updated_by: arsenaid
---

# Research: Does unfinalize remove existing documents from the document repository?

**Date**: 2026-04-22T17:57:10Z
**Researcher**: arsenaid
**Git Commit**: 415e8545c5ec1c0ba7b54e5caf48383b867e679f
**Branch**: main
**Repository**: cliniq

## Research Question

Check if unfinalize removes existing documents from the document repository.

## Summary

No. Unfinalize does **not** touch the document repository in any of the three note types (initial visit, procedure, discharge). Each `unfinalize*` server action performs a single `UPDATE` on the note row itself — flipping `status` from `'finalized'` back to `'draft'` and nulling `finalized_by_user_id` / `finalized_at`. There is no `DELETE` against `document_repository`, no call to `deleteDocument`, and no Supabase storage `remove(...)` call in any unfinalize code path. The confirmation dialogs shown in the UI explicitly state: *"The existing document record will be preserved."*

## Detailed Findings

### Unfinalize server actions — all three note types

All three unfinalize actions share the same shape: one table update, nothing else.

**Initial visit note** ([src/actions/initial-visit-notes.ts:655-680](src/actions/initial-visit-notes.ts#L655-L680)):
```ts
export async function unfinalizeInitialVisitNote(caseId: string, visitType: NoteVisitType) {
  // ...auth + closed-case checks...
  const { error } = await supabase
    .from('initial_visit_notes')
    .update({
      status: 'draft',
      finalized_by_user_id: null,
      finalized_at: null,
      updated_by_user_id: user.id,
    })
    .eq('case_id', caseId)
    .eq('visit_type', visitType)
    .is('deleted_at', null)
    .eq('status', 'finalized')
  if (error) return { error: 'Failed to unfinalize note' }
  revalidatePath(`/patients/${caseId}`)
  return { data: { success: true } }
}
```

**Procedure note** ([src/actions/procedure-notes.ts:904-928](src/actions/procedure-notes.ts#L904-L928)): same pattern, updates `procedure_notes` row.

**Discharge note** ([src/actions/discharge-notes.ts:986-1010](src/actions/discharge-notes.ts#L986-L1010)): same pattern, updates `discharge_notes` row.

None of the three functions:
- imports or calls any document-service helper (`deleteDocument`, `savePdfToRepository`, etc.)
- references `document_repository` table
- references the `clinical-documents` storage bucket or `storage.from(...).remove(...)`

### UI confirmation copy matches behavior

The AlertDialog shown before unfinalize explicitly advertises document preservation:

- Procedure editor ([src/components/procedures/procedure-note-editor.tsx:766-782](src/components/procedures/procedure-note-editor.tsx#L766-L782)):
  > "This will re-open the note for editing. The existing document record will be preserved. Continue?"
- Discharge editor ([src/components/discharge/discharge-note-editor.tsx:766-782](src/components/discharge/discharge-note-editor.tsx#L766-L782)): identical copy.
- Initial visit editor ([src/components/clinical/initial-visit-editor.tsx:1948-1964](src/components/clinical/initial-visit-editor.tsx#L1948-L1964)): identical copy.

Each dialog calls the matching `unfinalize*` server action from the parent handler and shows a toast on success. No follow-up delete call is made.

### Document repository — where documents are created vs. deleted

For contrast, document repository writes happen only on **finalize**, not unfinalize:
- `savePdfToRepository` ([src/lib/documentService.ts](src/lib/documentService.ts)) uploads the PDF to the `clinical-documents` bucket and inserts a row into `document_repository`.
- `POST /api/notes/finalize` ([src/app/api/notes/finalize/route.ts](src/app/api/notes/finalize/route.ts)) generates the PDF, uploads it, inserts the `document_repository` row, and sets the note `status` to `'finalized'`.

Document repository deletions happen only via explicit user action on the documents page:
- `deleteDocument(docId, storagePath)` in [src/lib/documentService.ts](src/lib/documentService.ts) — removes the object from storage, then deletes the `document_repository` row.
- `DELETE /api/patients/[patientId]/documents/[docId]` ([src/app/api/patients/[patientId]/documents/[docId]/route.ts](src/app/api/patients/[patientId]/documents/[docId]/route.ts)) — the HTTP handler that wraps the same pattern.
- UI delete button in [src/components/PatientDocuments.tsx](src/components/PatientDocuments.tsx).

No unfinalize code path reaches any of these.

### Re-finalize behavior (side effect to note)

When a user unfinalizes, edits, then finalizes again, `finalizeProcedureNote` / `finalizeDischargeNote` / `finalizeInitialVisitNote` (and `POST /api/notes/finalize`) will run again and produce a **new** PDF + new `document_repository` row. The old row from the prior finalize is still present (because unfinalize did not remove it), so the repository can end up with multiple document records for the same `note_id` across finalize/unfinalize/re-finalize cycles. This is the current observable behavior in the code, not an evaluation.

## Code References

- `src/actions/initial-visit-notes.ts:655-680` — `unfinalizeInitialVisitNote`: updates `initial_visit_notes` row only
- `src/actions/procedure-notes.ts:904-928` — `unfinalizeProcedureNote`: updates `procedure_notes` row only
- `src/actions/discharge-notes.ts:986-1010` — `unfinalizeDischargeNote`: updates `discharge_notes` row only
- `src/components/procedures/procedure-note-editor.tsx:766-782` — unfinalize confirmation dialog ("document record will be preserved")
- `src/components/discharge/discharge-note-editor.tsx:766-782` — same
- `src/components/clinical/initial-visit-editor.tsx:1948-1964` — same
- `src/lib/documentService.ts` — `deleteDocument`, `savePdfToRepository` (not called by unfinalize)
- `src/app/api/notes/finalize/route.ts` — writes to `document_repository` on finalize
- `src/app/api/patients/[patientId]/documents/[docId]/route.ts` — `DELETE` handler for documents (separate path)

## Architecture Documentation

- Note lifecycle state lives on each note table (`initial_visit_notes`, `procedure_notes`, `discharge_notes`) via `status` + `finalized_at` + `finalized_by_user_id`.
- `document_repository` rows and `clinical-documents` storage objects are created as a side effect of finalize but have no foreign-key cascade tied to note status.
- Unfinalize is modeled as a pure state revert on the note row; document artifacts are treated as immutable records of the finalize event and only removed via the explicit document-delete pathway.

## Related Research

None directly about the unfinalize flow in `thoughts/shared/research/`. Adjacent topics: finalize/document generation flows are referenced incidentally in note-generation research docs.

## Open Questions

- Whether a re-finalize after unfinalize should supersede the prior `document_repository` row (behavioral question, not in scope here).
