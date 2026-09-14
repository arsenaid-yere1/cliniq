# Visit-note factor hints expansion

Expanded `src/lib/clinical/complaint-factor-hints.ts` from four to eleven specific regions: neck, lower back, shoulder, knee, upper/mid back, hip, elbow, wrist, hand/fingers, ankle, and foot/toes. Each has six aggravating and four alleviating examples. General fallback remains available. The existing field shows three examples initially and reveals the remainder with More.

`getComplaintRegion` now accepts an optional trailing “pain” after a recognized alias and side prefix, including “Right shoulder pain”. It continues to reject compound regions, negations, and clinical prose. Lookup does not modify saved text. `setComplaintSide` preserves original region wording and whitespace.

Examples are selectable patient-reported factors, not treatment instructions. Content reference checks included NHS [hip pain](https://www.nhs.uk/symptoms/hip-pain/), [wrist pain](https://www.nhs.uk/symptoms/hand-pain/wrist-pain/), [repetitive strain injury](https://www.nhs.uk/conditions/repetitive-strain-injury-rsi/), and [sprains and strains](https://www.nhs.uk/conditions/sprains-and-strains/). These sources provide general context; the catalog is not a diagnostic checklist.

Verification:
- `npx vitest run` targeting complaint-factor-hints, complaint-factor-text, complaint-radiation-hints, chief-complaints-card, and psychological-visit-editor: 83 tests passed across five suites.
- `npx eslint src/lib/clinical/complaint-factor-hints.ts src/lib/clinical/__tests__/complaint-factor-hints.test.ts`: passed.
- `npx tsc --noEmit`: passed.
- Reviewed the two changed source/test files against the prior production snapshot. No new manual browser check for this catalog expansion.

This expansion has not been deployed. Concurrent radiation-hint work was left untouched.
