# Follow-Up PDF Document Layout Plan

## Goal

Bring the Pain Management Follow-Up PDF into the same clinical-document format as the Initial Visit, Procedure Note, and Discharge Note PDFs, specifically including clinic branding/contact information and the stored provider signature/NPI.

## Current implementation

- `src/lib/pdf/pain-follow-up-template.tsx` renders a standalone title, telehealth metadata, plain section bodies, and a typed provider name.
- `src/lib/pdf/render-pain-follow-up-pdf.ts` fetches the patient and encounter provider name/credentials, but does not fetch clinic settings, clinic logo, provider NPI, or provider signature.
- `src/lib/pdf/initial-visit-template.tsx`, `src/lib/pdf/procedure-note-template.tsx`, and `src/lib/pdf/discharge-note-template.tsx` establish the clinical-note layout: centered clinic logo/contact header, separator, labeled patient metadata, formatted clinical sections, separator, and a non-breaking `Respectfully` signature block containing the stored signature image, provider identity, and NPI.
- The encounter's `provider_profile_id` relationship is the appropriate signer snapshot for a follow-up encounter; it should remain authoritative rather than switching to the case's current assignment.

## Scope

### Phase 1 - Template parity

Update `src/lib/pdf/pain-follow-up-template.tsx` to:

- accept clinic name/address/phone/fax/logo fields and provider NPI/signature fields;
- render the clinic header and separators using the same dimensions and typography as the established clinical-note templates;
- retain the follow-up title and all telehealth-specific metadata;
- render note sections with the same paragraph, bullet, inline-bold, subheading, and orphan-heading handling used by the reference templates;
- render the saved signature image, provider name/credentials, and NPI in a non-breaking signature block.

Success criteria:

- Existing follow-up fields remain present.
- Supplying clinic and signature data visibly renders the standard header and signature block.
- Missing optional logo/signature data degrades to text-only details without failing PDF generation.

### Phase 2 - Renderer data loading

Update `src/lib/pdf/render-pain-follow-up-pdf.ts` to:

- fetch active clinic settings;
- extend the encounter provider relationship to include NPI and signature storage path;
- download and normalize supported clinic logo/provider signature images from the existing `clinic-assets` bucket, matching the reference renderers;
- assemble and pass clinic contact and provider signature fields into the template;
- preserve current patient, date, modality, consent, location, connection, and note-section mappings.

Success criteria:

- The encounter provider remains the signer.
- PNG/JPEG/SVG stored assets follow the established normalization behavior.
- Unsupported or absent assets do not stop document rendering.
- No schema, migration, encounter workflow, or finalized-note behavior changes.

### Phase 3 - Verification

- Add focused template coverage for header, follow-up metadata, sections, provider signature, and NPI rendering.
- Run the focused tests, TypeScript check, lint on changed files, and the relevant broader test suite.
- Produce a representative multi-page follow-up PDF with a sample logo/signature, convert every page to PNG, and visually inspect the latest rendering for clipping, overlap, blank pages, orphaned headings, and signature/header consistency.
- Review the final diff and confirm unrelated worktree files remain untouched.

## Compatibility and risk

- This is an additive presentation/data-loading change; it does not alter database schemas or action contracts.
- Previously finalized PDFs are immutable and will not be regenerated automatically. Newly finalized follow-up notes will use the corrected layout.
- The main runtime risk is image decoding. Reusing the same MIME detection and PNG normalization as the existing clinical PDF renderers keeps behavior consistent.
