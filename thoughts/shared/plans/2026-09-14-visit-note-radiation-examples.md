# Visit Note radiation examples Implementation Plan

## Overview

Add optional, area-specific radiation examples to the existing Chief Complaints form. The user approved planning the demonstrated interaction and then expanded coverage beyond Neck and Lower Back. Deliver broad musculoskeletal coverage without turning example selection into diagnosis or automatically recording findings.

Planning scope: implementation plan only. Application implementation is a subsequent task.

## Current State

The original `ChiefComplaintsCard` in `src/components/clinical/initial-visit-editor.tsx` pairs free-text `body_region` with nullable-string `radiates_to`. Its placeholder is static. The current workspace also contains active factor-hint work: an extracted `src/components/clinical/chief-complaints-card.tsx`, `complaint-factor-field.tsx`, and factor hint/text helpers. Those files are concurrent work, not a completed integration assumption.

`chiefComplaintEntrySchema` in `src/lib/validations/initial-visit-note.ts` already accepts radiation text. `useIntakeSectionSave` in `src/components/clinical/intake-draft-context.tsx` registers dirty sections, saves their values, and resets on success. Existing visit boundaries are Initial Visit and Pain Evaluation before generation, and Initial Visit complaint editing after generation. Preserve them.

## Desired End State

### Coverage and example wording

Recognize the following 22 area groups. This table is an interface catalog of destinations a patient may describe, not a claim that each area causes every listed pattern. Use plain destination text, never diagnosis labels, nerve-root assignments, probability rankings, or automatic defaults. Table order controls display priority, not likelihood.

| Entered area group | Explicit aliases | Destination examples |
| --- | --- | --- |
| Head / occipital area | head, headache, occiput, occipital | Neck; Temple; Forehead; Behind the eye |
| Jaw / TMJ | jaw, TMJ, temporomandibular | Ear; Temple; Face; Neck |
| Neck / cervical | neck, cervical, cervical spine, c-spine | Shoulder; Shoulder blade; Arm; Forearm; Hand; Fingers |
| Upper / mid back | upper back, mid back, middle back, thoracic, thoracic spine, t-spine | Shoulder blade; Around the ribs; Side of chest; Front of chest |
| Lower back / lumbar | low back, lower back, lumbar, lumbar spine, l-spine, lumbosacral | Buttock; Thigh; Lower leg; Calf; Foot; Toes |
| Sacroiliac / buttock | sacroiliac, SI joint, SI region, buttock, buttocks, gluteal | Lower back; Hip; Groin; Thigh; Leg |
| Tailbone | tailbone, coccyx, coccygeal | Buttock; Sacral area |
| Shoulder | shoulder, shoulders | Upper arm; Elbow; Shoulder blade; Neck |
| Shoulder blade | shoulder blade, scapula, scapular | Neck; Shoulder; Upper back; Arm |
| Upper arm | upper arm, upper arms | Shoulder; Elbow; Forearm |
| Elbow | elbow, elbows | Forearm; Wrist; Hand; Fingers |
| Forearm | forearm, forearms | Elbow; Wrist; Hand; Fingers |
| Wrist | wrist, wrists | Hand; Thumb; Fingers; Forearm |
| Hand / fingers | hand, hands, finger, fingers, thumb | Wrist; Forearm; Fingers |
| Hip / groin | hip, hips, groin | Thigh; Knee; Buttock; Lower back |
| Thigh | thigh, thighs | Hip; Knee; Lower leg |
| Knee | knee, knees | Thigh; Shin; Calf |
| Lower leg / calf | lower leg, lower legs, calf, calves, shin | Knee; Ankle; Foot |
| Ankle | ankle, ankles | Foot; Heel; Lower leg |
| Heel / Achilles | heel, heels, Achilles, Achilles tendon | Sole of foot; Calf; Ankle |
| Foot / toes | foot, feet, toe, toes | Toes; Arch of foot; Heel; Ankle |
| Chest wall / ribs | chest wall, rib, ribs, rib cage | Side of chest; Back; Front of chest |

All areas retain free text. Unsupported, blank, ambiguous, or compound area entries show no destination chips and the helper “Describe where the pain travels.” Do not infer anatomy from substrings (e.g. “neck and shoulder”), automatically map generic “back” or “arm”, or introduce organ-related diagnostic suggestions. The catalog is intentionally extensible, not exhaustive.

Clinical context used to distinguish documentation from diagnostic inference: [AAFP neck evaluation](https://www.aafp.org/afp/2020/0801/p150), [AAFP hip evaluation](https://www.aafp.org/afp/2021/0115/p81), and [Merck lumbosacral radiculopathy](https://www.merckmanuals.com/professional/musculoskeletal-and-connective-tissue-disorders/neck-and-back-pain/lumbosacral-radiculopathy). These references do not validate every cell as a common causal referral pattern. Do not label this table “clinically validated patterns”.

### Selection and laterality

- Keep the accessible label Radiates To and an always-editable textarea bound to the existing nullable string.
- Show three destination examples initially, with independent More/Fewer examples. Label “Examples — select only if reported”. Show No radiation and Not assessed as explicit choices, never defaults.
- Destinations are side-neutral by default. Do not infer destination side from the complaint's origin side. Providers add left/right/bilateral wording in the editable text; this avoids tripling the chips and assuming ipsilateral radiation. For example, selecting Arm inserts “Arm”, which can be edited to “Left arm to the hand”. This deliberately refines the small prototype's left/right/both chips for a broad catalog.
- A chip appends a semicolon-delimited destination. Repeated selection removes only an exact standalone segment, using trimmed case-insensitive matching. Never remove substrings or rewrite unrelated punctuation, whitespace, or custom prose.
- Manually edited chip text becomes custom text; it is never deleted by toggling the original chip. Derive selection from the current string, not separate persisted metadata.
- No radiation and Not assessed are whole-field statuses. With existing descriptive text, ask inline Replace/Cancel; replacement provides one-step Undo. Selecting a destination replaces an exact whole-field status directly. Never silently discard descriptive text as the prototype did.
- Empty text persists as null. Preserve pre-existing empty strings until the provider edits; mounting or browsing examples must not dirty intake.
- Region/side changes refresh suggestions, preserve radiation verbatim, collapse More, and cancel pending replacement/Undo. When the region changes with existing radiation show “Existing radiation kept — review for this area.”
- Save/reset, external field changes, row removal, and subsequent edits invalidate transient replacement state. Preserve stable field-array identity. Controls are disabled while locked or saving; presentation-only disclosure does not alter data.

## Key Discoveries

The factor-hint implementation already has a matching chip/textarea pattern, exact-segment text editing, replacement confirmation, and Undo. Reuse the pattern without tying radiation matching to the factor helper's four-region catalog. Adding a radiation region must not silently add new aggravating/alleviating examples or change factor fallback behavior.

## What We Are Not Doing

No database/schema/prompt changes, provider-authored example library, diagnostic suggestions, automatic findings, new follow-up/extraction forms, or new complaint-editor availability. Do not reproduce the mockup's single severity input: keep severity minimum and maximum.

## Implementation Approach

Work against the completed extracted complaint card when the concurrent factor work is integrated. First re-read workspace status and the live editor mounts; do not overwrite or duplicate that work. Implement radiation-specific catalog and text semantics in new modules, then a field matching the factor field's existing visual conventions. Avoid a broad generic-component refactor in this change.

Verification update: the live editor now imports the extracted card, at the existing pre-generation and Initial Visit draft mounts. No second extraction is needed. Key radiation presentation by the raw body-region string (not merely its canonical region key) so side/alias edits also cancel transient replacement state; the parent form retains radiation values.

## Phase 1: Catalog and text behavior

### Files and changes

- New `src/lib/clinical/complaint-radiation-hints.ts`: typed 22-group catalog, explicit aliases, strict normalization of case/spacing and anchored optional Left/Lt./L/Right/Rt./R/Bilateral/Bilat/Both prefixes. Return a radiation key and ordered destinations independently from factor keys. Lookup never mutates stored body-region text.
- New `src/lib/clinical/complaint-radiation-text.ts`: nullable adapter and standalone-segment add/remove/status helpers, following the factor-text algorithm. Use No radiation/Not assessed, not factor-specific None reported. Keep helper duplication small rather than modifying active shared factor code.
- New corresponding helper tests in `src/lib/clinical/__tests__/`.
- Extend the complaint card's datalist with a deduplicated union of existing factor options and canonical radiation areas. Do not alter `getComplaintRegion` or factor examples. Existing Side control behavior for unsupported factor regions remains unchanged; typed laterality is recognized by radiation lookup.

### Automated verification

Run both new helper suites. Cover every alias/group, whitespace/case/prefixes, collisions, blank/compound/prose fallback, unique examples, null/empty, exact statuses, edited/negated prose, duplicates, separators, append/remove at every position, and preservation of unrelated text. Assert catalog lookup has no effects on factor mappings.

### Manual verification

Review that every destination is optional plain documentation wording and all 22 groups are represented. Verify labels never imply a diagnosis or default patient finding.

## Phase 2: Radiation field integration

### Files and changes

- New `src/components/clinical/complaint-radiation-field.tsx`: field binding, label, textarea, chips, More/Fewer, status replacement/Undo, disabled and accessible behavior. Follow `ComplaintFactorField` styling and form-control wiring. Forward ref/name/onBlur to the textarea; normalize user-cleared values to null.
- Update `src/components/clinical/chief-complaints-card.tsx`: use the row's watched body region for radiation lookup; replace only its existing radiation field; add radiation to the collapsed complaint summary (blank displays Not entered). Use a radiation-region key to reset only presentation state, never form values. Retain save registration, row lifecycle, numeric severity and all other inputs.
- New `src/components/clinical/__tests__/complaint-radiation-field.test.tsx`, plus radiation cases in the complaint card tests created by the factor task.

### Automated verification

Test chip additions/removals and custom edits; all optional values untouched on mount; More does not dirty; status Cancel/Replace/Undo; stale Undo cancellation on reset and area change; side-neutral wording; null serialization; row removal/reindex and visit isolation; locked/busy controls; exact selected strings in save payload; failed save retains text.

### Manual verification

Use synthetic complaints for neck, hip, wrist, thoracic, foot and unknown areas. Exercise keyboard, narrow viewport, long values, More/Fewer, statuses and Undo. Confirm laterality can be typed without changing origin side. Verify no area change deletes findings. Check native datalist and labels in the browser.

## Phase 3: Regression verification

### Files and changes

Extend `src/components/clinical/__tests__/psychological-visit-editor.test.tsx` to select radiation in both visit types before generation, prove dirty values save before generation and failure blocks generation. Retain the factor task's datalist combobox queries. Verify Initial Visit draft edits and existing finalized/locked boundaries.

### Automated verification

Run new radiation suites, complaint-card tests, existing factor helper tests, psychological visit-editor tests, and initial-visit-note schema tests. Run scoped `npm run lint -- <changed source and test files>`, `npx tsc --noEmit`, and `git diff --check`. There is no dedicated formatting script; follow existing style and whitespace checks. Report each command/result. Do not change unrelated files to remedy baseline failures.

### Manual verification

Save and reload synthetic intake; test two complaints, tab switching, region changes, status replacement, and locked state. Check 360px and desktop, keyboard and light/dark. Mocked generation integration verifies transport; no paid AI generation is required. Report manual checks separately.

## Risks and rollback considerations

- Active factor work is a dependency: rebase implementation assumptions onto its final component/export shape first. Do not integrate a second ChiefComplaintsCard.
- A broad catalog can look diagnostic: use neutral destinations and explicit patient-report labeling, without frequency/etiology claims.
- Region-specific examples must never clear data or assume side. Exact text operations and status confirmation are required.
- Reverting UI/catalog helpers leaves saved strings valid in the prior editor; no migration or data rollback is needed.

## Completion criteria

- All 22 groups resolve their explicit aliases; unknown areas retain free text.
- Only provider edits/selections become findings; no implicit laterality or defaults.
- Existing factor behavior, visit boundaries, save/generation flow and row identity remain intact.
- Automated checks and manual review are completed and reported, with baseline limitations identified.
