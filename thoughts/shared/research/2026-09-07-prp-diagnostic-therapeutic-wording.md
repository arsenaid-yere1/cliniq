# PRP recommendation purpose wording

## Research question
Does the current application require “diagnostic and therapeutic purposes” when recommending PRP procedures, and is there support for making that phrase universal?

## Summary
No current code requirement was found. The exact phrase occurs in a historical sample treatment-plan extraction, not in the current generated recommendation template. Clinical interpretation: do not make this a universal PRP statement; diagnostic intent should be supported by the actual clinician-documented procedure. No application behavior was changed.

## Findings by component

### Recommendation generation
`src/lib/claude/generate-initial-visit.ts:340` instructs the pain-evaluation model to emit `[[PRP_TARGET_RECOMMENDATIONS]]`; the server supplies the recommendation paragraph. Line 341 restricts selections to eligible evidence candidates and requires ultrasound guidance and evidence-specific rationale. Neither instruction requires the queried phrase. First-visit instructions prohibit PRP recommendations.

### Deterministic recommendation renderer
`src/lib/clinical/render-prp-treatment-plan.ts:5` defines `TARGET_INTRO`: “Given the incomplete response to conservative measures, I am recommending a series of Platelet-Rich Plasma (PRP) injections targeting the following regions:”.

`renderPrpTargetBlock` (line 53) groups recommendations by region and laterality and adds target descriptions. `TARGET_FOLLOW_UP` (line 6) describes an initial staged course of one to three sessions, reassessment after each injection, and response/functional impairment criteria for extension. None of these strings includes diagnostic-and-therapeutic wording. `renderPrpTreatmentPlan` (line 81) inserts the block into the narrative.

### Execution flow
In the inspected generation path, `src/actions/initial-visit-notes.ts:563` validates model-selected targets for a pain-evaluation visit, then line 577 renders the treatment plan from the validated targets and evidence. This explains why changing only a model instruction would not directly change the deterministic recommendation paragraph.

### Historical example and extraction
`thoughts/shared/plans/2026-03-09-epic-2-story-2.3-pain-management-extraction.md:648` contains: “Cervical facet blocks with platelet-rich plasma for diagnostic and therapeutic purposes. Up to three injections.” This is a sample `treatment_plan` array in an extraction implementation plan. It does not state a universal generation requirement.

`src/lib/claude/extract-pain-management.ts:5` defines a source-document extraction prompt. It classifies blocks, epidurals, and PRP as injection treatment items. It does not instruct the model to append the queried phrase.

Recent renderer history inspected: `a76a1df` (condense PRP target summaries), `923eeb0` (refine recommendation narrative), `2e59e1f` (shorten staged recommendation). Commit subjects alone do not establish why the phrase is absent.

## Clinical context and interpretation
AAOS describes PRP as a treatment intended to support healing, with effectiveness varying by condition: https://www.orthoinfo.org/en/treatment/platelet-rich-plasma-prp/ .

CMS distinguishes diagnostic facet blocks using local anesthetic, with or without corticosteroid, from therapeutic interventions: https://www.cms.gov/medicare-coverage-database/view/lcd.aspx?lcdId=38765&ver=25 . This is a specific Medicare coverage policy, not a universal requirement for this clinic.

Inference/recommendation: the historical wording should not be generalized to all PRP injections. Describe therapeutic intent when that is the actual purpose; document a diagnostic component only when the clinician has specified and supported it. The sources reviewed do not establish a requirement to include this exact phrase in every PRP recommendation.

## Existing tests and verification
- `src/lib/clinical/render-prp-treatment-plan.test.ts`: four tests cover the rendered narrative, empty eligible targets, grouped spinal levels, and shoulder summaries.
- `src/lib/claude/__tests__/generate-initial-visit.test.ts`: prompt and contract tests include evidence-limited PRP selections and an empty PRP list for first visits.
- Ran `npx vitest run src/lib/clinical/render-prp-treatment-plan.test.ts src/lib/claude/__tests__/generate-initial-visit.test.ts`: 2 files, 27 tests passed. These are local automated tests, not clinical validation or a live model-generation test.
- Searched source and historical Markdown for the exact phrase and nearby diagnostic/therapeutic variants; only the historical plan example matched.
- Graphify CLI was unavailable; inspected existing graph metadata as supplemental discovery. Conclusions above are based on current source inspection.
- No lint/typecheck/build run: research document only, no application edits. No manual UI or patient-record verification performed.

## Open questions
- Does a clinician-approved template or payer-specific policy outside this repository require this wording for a particular procedure?
- Does the intended procedure include a separately documented diagnostic block, or PRP treatment alone?
- The original report behind the historical extraction example was not examined; its clinical justification cannot be inferred from sample JSON.

## Follow-up: source report and template revision
The subsequently supplied PDF explicitly uses the dual-purpose wording for cervical and lumbar facet blocks in treatment-plan items 2 and 3 (pages 6–7). This establishes the author's stated intent for that plan; it does not validate universal PRP diagnostic claims.

Following the user's request to assess compliance and facet relevance, the template now describes therapeutic goals without promising benefit. A clarification is included only when a selected spinal target structure explicitly contains “facet”: any diagnostic facet block requires a separately documented indication, technique, injectate, and response assessment, and the proposed PRP treatment does not itself establish a facet-pain diagnosis. No diagnostic block is automatically ordered or inferred. Earlier intro versions remain recognized during regeneration.

Current policy review (2026-09-07):
- CMS LCD L38765 defines diagnostic facet blocks using local anesthetic, with or without corticosteroid. Its limitations require CT/fluoroscopy for covered facet interventions and exclude ultrasound-guided interventions and biological injectates from that coverage framework: https://www.cms.gov/medicare-coverage-database/view/lcd.aspx?lcdid=38765 .
- Noridian LCD L39058 applies in California and is a non-coverage policy for musculoskeletal/joint PRP: https://www.cms.gov/medicare-coverage-database/view/lcd.aspx?lcdid=39058 .

These are Medicare coverage rules, not a determination that a privately funded procedure is unlawful. This wording revision cannot certify legal compliance, medical necessity, or reimbursement eligibility. The application continues to specify ultrasound for PRP; no modality or billing behavior was changed. Patient-specific clinician review and the applicable payer requirements remain necessary. The facet clarification is driven by selected target text, not a structured diagnostic-block order or consent record.

Verification after revision: targeted Vitest command listed above passed 30 tests across 2 files; targeted ESLint, TypeScript (`npx tsc --noEmit`), and diff whitespace review were also performed. Tests cover facet-specific clarification, absence of diagnostic wording for disc and shoulder examples, and replacement of all three introduction versions without duplication.
