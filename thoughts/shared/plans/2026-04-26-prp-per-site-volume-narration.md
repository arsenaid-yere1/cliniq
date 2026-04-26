# PRP Per-Site Volume Narration in Procedure Note — Implementation Plan

## Overview

Add a prompt rule to `generate-procedure-note.ts` so the LLM-generated `procedure_injection` paragraph narrates per-site (or per-level) volume allocation when the procedure treats multiple sites. No schema, form, or billing changes. Single-phase, prompt-only edit, plus tests.

## Current State Analysis

Today, [src/lib/claude/generate-procedure-note.ts](src/lib/claude/generate-procedure-note.ts) feeds the LLM a scalar `injection_volume_ml` and a free-text `injection_site` string. Multi-site is expressed by comma-joining sites into the string (e.g. `"L4-L5, L5-S1"` or `"Knee, Shoulder"`). The `procedure_injection` reference paragraph at line 511 narrates one needle insertion at one volume:

> "Under ultrasound guidance, a 25-gauge spinal needle was inserted into the facet joint, … The PRP solution (5 mL) was injected slowly into the joint…"

There is a `MULTI-LEVEL JUSTIFICATION RULE` ([generate-procedure-note.ts:453](src/lib/claude/generate-procedure-note.ts#L453)) that fires on "2 or more spinal levels in `injection_site`" but that rule only adds a justification sentence in the `procedure_indication` section — it does not break the volume across levels in `procedure_injection`. Non-spine multi-site (e.g. `"Knee, Shoulder"`) does not trigger that rule at all.

Compliance gap: when a multi-site procedure is billed as multiple line-item units (via `countInjectionSites` in [src/actions/billing.ts:23](src/actions/billing.ts#L23)) but the chart narrates one shared volume, the chart does not document discrete per-site delivery. Adding generic per-site allocation language closes that gap without requiring providers to enter per-site volumes in the form.

## Desired End State

When `procedureRecord.injection_site` parses to ≥2 distinct sites/levels:
- The `procedure_injection` paragraph names each site and asserts that allocation was calibrated to per-site pathology, WITHOUT inventing a numeric per-site mL split. Example with total known: `"The PRP solution (6 mL total) was distributed across L4-L5 and L5-S1, with allocation calibrated to the pathology burden at each level."`
- When the total volume is null, both the total and per-site allocation are emitted as bracket placeholders: `"The PRP solution was distributed across L4-L5 and L5-S1; [confirm total volume in mL] and [confirm per-site mL allocation]."`
- Single-site procedures retain the existing reference text unchanged.
- Non-spine multi-site (e.g. `"Knee, Shoulder"`) is covered by the same rule, using site names instead of vertebral level codes.

**Defensibility rationale:** the chart stores only a scalar `injection_volume_ml`. Computing `total / N` and emitting `"approximately X mL per site"` would commit the note to a per-site number the provider never recorded — defensibility risk at deposition, and a contradiction of the existing DATA-NULL RULE at [generate-procedure-note.ts:480](src/lib/claude/generate-procedure-note.ts#L480) ("Do NOT invent a numeric volume"). The wording chosen instead names the sites, preserves the total, and lets the prose acknowledge that allocation varied by pathology — without claiming a specific mL per site.

Verify: snapshot tests on `opts.system` confirm the new rule text is present; runtime tests confirm prompt is unchanged for single-site input.

### Key Discoveries:
- Existing tests in [src/lib/claude/__tests__/generate-procedure-note.test.ts:164-196](src/lib/claude/__tests__/generate-procedure-note.test.ts#L164-L196) capture `opts.system` via `capturePrompt(input)` and assert with `toContain` / `toMatch`. New tests follow this pattern.
- The `procedure_injection` DATA-NULL block at [generate-procedure-note.ts:499-504](src/lib/claude/generate-procedure-note.ts#L499-L504) already uses bracket placeholders like `[confirm injection volume in mL]` — matching `[confirm per-site mL allocation]` is consistent.
- Site detection is delegated to the model via comma/semicolon-split + vertebral-level regex over `procedureRecord.injection_site`. No new parser added alongside the three documented in research.
- Wording principle: name the sites, do NOT compute or assert a per-site mL number. Total `injection_volume_ml` is reported once. Per-site allocation is described qualitatively ("calibrated to the pathology burden at each level") OR via bracket placeholder when null.
- Threshold for "multi": either ≥2 comma/semicolon-separated tokens OR ≥2 vertebral level patterns. Laterality words (`left`, `right`, `bilateral`, `lt`, `rt`) are not counted as sites.

## What We're NOT Doing

- No new database column. No `injection_sites_detail` jsonb. No new migration.
- No form change. No repeating-site-row UI in `record-procedure-dialog.tsx`.
- No change to `actions/billing.ts`. Invoice description and quantity logic stay as-is.
- No parser unification across `parseBodyRegion` / `extractLevels` / `countInjectionSites`. Three parsers stay as-is.
- No change to mixed-laterality handling. `laterality` remains scalar.
- No change to `blood_draw_volume_ml` narration. One draw per session, narrated as today.
- No change to `procedure_anesthesia` narration. Anesthetic dose stays scalar.
- No PDF rendering change. Display surfaces unchanged.

## Implementation Approach

Single phase. Edit the system prompt string in `generate-procedure-note.ts` to insert a `PER-SITE VOLUME ALLOCATION RULE` block inside section 14 (`procedure_injection`), immediately after the existing `DATA-NULL RULE` block and before the `TARGET-COHERENCE RULE` block. Add a new reference paragraph for multi-site cases adjacent to the existing single-site reference at line 511. Add tests asserting the new rule text appears in `opts.system`.

---

## Phase 1: Add `PER-SITE VOLUME ALLOCATION RULE` to procedure_injection prompt

### Overview
Insert a new mandatory rule into section 14 of the system prompt, plus a multi-site reference paragraph and three test cases.

### Changes Required:

#### 1. System prompt rule + reference text
**File**: `src/lib/claude/generate-procedure-note.ts`
**Changes**: After line 504 (end of DATA-NULL RULE for `procedure_injection`) and before line 506 (TARGET-COHERENCE RULE), insert the new rule block. After line 511 (existing single-site reference), append a multi-site reference and a multi-site-with-null-volume reference.

New rule block to insert after the DATA-NULL RULE bullet list:

```
PER-SITE VOLUME ALLOCATION RULE (MANDATORY when procedureRecord.injection_site contains 2 or more distinct sites — counted as comma/semicolon-separated tokens OR as 2 or more vertebral level patterns like L4-L5, C5-C6, etc.): The injection paragraph MUST name each treated site explicitly and acknowledge that allocation was calibrated to per-site pathology. The note MUST NOT assert a specific per-site mL number — the chart stores only a scalar total. This rule extends the existing DO-NOT-INVENT-A-NUMERIC-VOLUME principle to the per-site dimension.
• When procedureRecord.injection_volume_ml is non-null and ≥2 sites detected: "The PRP solution (TOTAL mL total) was distributed across SITE_A and SITE_B, with allocation calibrated to the pathology burden at each level." Adapt the conjunction to a comma-list when 3 or more sites: "across SITE_A, SITE_B, and SITE_C". For non-spine sites (knee, shoulder, hip, etc.), use "at each site" instead of "at each level".
• When procedureRecord.injection_volume_ml is null and ≥2 sites detected: "The PRP solution was distributed across SITE_A and SITE_B; [confirm total volume in mL] and [confirm per-site mL allocation]." Emit BOTH bracket placeholders. Do NOT fabricate a numeric volume.
• When only 1 site is detected: this rule does NOT apply. Use the single-site reference paragraph below.
FORBIDDEN PHRASES (MANDATORY) under this rule, anywhere in procedure_injection: "approximately X mL per site", "approximately X mL was delivered to [site]", "X mL was injected at [site]", or any phrasing that commits the note to a specific mL number for an individual site. The chart does not record per-site mL; emitting one is fabrication.
Counting rule for "distinct sites": split procedureRecord.injection_site on commas and semicolons; trim whitespace; deduplicate case-insensitively. If the resulting list has length ≥2, treat as multi-site. ADDITIONALLY, if procedureRecord.injection_site matches 2 or more vertebral level patterns (regex like [CTL]\d+[-/]\d+ or [CTL]\d+), treat as multi-site even if commas were not used. Do NOT count laterality words ("left", "right", "bilateral", "lt", "rt") as separate sites — they are modifiers of the site that follows them.
NEEDLE-INSERTION LANGUAGE (MANDATORY for multi-site narration): describe needle technique generically as "a NN-gauge needle was inserted at each treated site" (or "level" for spine). Do NOT claim a specific number of needles, a specific number of insertions, or that the same needle was redirected — the chart does not record technique granularity below needle_gauge. When needle_gauge is null, use the existing "[confirm needle gauge]" placeholder.
```

New reference paragraphs to append after line 511:

```
Reference (multi-site, total volume known, spine): "Under ultrasound guidance, a 25-gauge spinal needle was inserted at each treated level, targeting the most affected areas as visualized on prior imaging. The PRP solution (6 mL total) was distributed across L4-L5 and L5-S1, with allocation calibrated to the pathology burden at each level. The needle was withdrawn at each site, and sterile gauze was applied to the injection sites. No complications, such as bleeding or infection, were noted."
Reference (multi-site, total volume null, spine): "Under ultrasound guidance, a 25-gauge spinal needle was inserted at each treated level. The PRP solution was distributed across L4-L5 and L5-S1; [confirm total volume in mL] and [confirm per-site mL allocation]. The needle was withdrawn at each site, and sterile gauze was applied to the injection sites. No complications, such as bleeding or infection, were noted."
Reference (multi-site, non-spine, total known): "Under ultrasound guidance, a 25-gauge needle was inserted at each treated site. The PRP solution (6 mL total) was distributed across the right knee and the right shoulder, with allocation calibrated to the pathology burden at each site. The needle was withdrawn at each site, and sterile gauze was applied. No complications were noted."
```

The existing single-site reference at line 511 stays unchanged.

#### 2. Tests
**File**: `src/lib/claude/__tests__/generate-procedure-note.test.ts`
**Changes**: Add a new `describe('SYSTEM_PROMPT — per-site volume allocation', ...)` block following the pattern at line 164. Three test cases.

```ts
describe('SYSTEM_PROMPT — per-site volume allocation', () => {
  beforeEach(() => vi.clearAllMocks())

  async function capturePrompt(input: ProcedureNoteInputData): Promise<string> {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData(input)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    return opts.system as string
  }

  it('emits PER-SITE VOLUME ALLOCATION RULE with FORBIDDEN PHRASES guard against per-site mL fabrication', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('PER-SITE VOLUME ALLOCATION RULE')
    expect(system).toContain('MUST NOT assert a specific per-site mL number')
    expect(system).toContain('FORBIDDEN PHRASES')
    expect(system).toContain('approximately X mL per site')
  })

  it('emits both [confirm total volume in mL] and [confirm per-site mL allocation] for the null-volume branch', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('[confirm total volume in mL]')
    expect(system).toContain('[confirm per-site mL allocation]')
  })

  it('includes a spine multi-site reference paragraph that names sites without per-site mL', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('distributed across L4-L5 and L5-S1, with allocation calibrated to the pathology burden at each level')
    expect(system).not.toMatch(/approximately 3 mL .* L4-L5/)
  })

  it('includes a non-spine multi-site reference paragraph', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('right knee and the right shoulder')
    expect(system).toContain('at each site')
  })

  it('forbids needle-redirection / multi-needle technique claims in multi-site narration', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('NEEDLE-INSERTION LANGUAGE')
    expect(system).toContain('Do NOT claim a specific number of needles')
  })

  it('preserves the existing single-site reference paragraph unchanged', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('The PRP solution (5 mL) was injected slowly into the joint to maximize distribution and tissue saturation.')
  })
})
```

### Success Criteria:

#### Automated Verification:
- [ ] Type check passes: `npx tsc --noEmit`
- [ ] Lint passes: `npm run lint`
- [ ] New tests pass: `npx vitest run src/lib/claude/__tests__/generate-procedure-note.test.ts`
- [ ] Existing test suite still passes: `npx vitest run`

#### Manual Verification:
- [ ] Generate a procedure note for a case with `injection_site = "L4-L5, L5-S1"` and `injection_volume_ml = 6`. Verify the `procedure_injection` paragraph names both levels, reports `(6 mL total)`, says allocation was calibrated to per-level pathology, and does NOT contain any "X mL per site" or "approximately N mL" per-site number.
- [ ] Generate a procedure note for a case with `injection_site = "Right Knee, Right Shoulder"` and `injection_volume_ml = 6`. Verify the paragraph names both joints, uses "at each site" wording, and does NOT contain a per-site mL number.
- [ ] Generate a procedure note for a case with `injection_site = "L5-S1"` (single site) and `injection_volume_ml = 5`. Verify the paragraph still uses the single-site narrative ("The PRP solution (5 mL) was injected slowly…") with no multi-site language.
- [ ] Generate a procedure note for a case with `injection_site = "L4-L5, L5-S1"` and `injection_volume_ml = null`. Verify the paragraph emits BOTH `[confirm total volume in mL]` and `[confirm per-site mL allocation]` and does not fabricate a number.
- [ ] Generate a procedure note for a case with `injection_site = "L4-L5/L5-S1"` (slash separator, no comma). Verify the multi-site narration is triggered via the vertebral-level regex path.
- [ ] Open one finalized note from a real prior multi-site case (if any) and confirm regenerating produces the new multi-site narration; the prior finalized text is preserved on disk per the existing `procedure_notes` workflow.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before merging.

---

## Testing Strategy

### Unit Tests:
- New `describe` block in [src/lib/claude/__tests__/generate-procedure-note.test.ts](src/lib/claude/__tests__/generate-procedure-note.test.ts) — four cases: rule presence, multi-site reference, non-spine reference, single-site preservation.
- All assertions are against the static system prompt string (`opts.system`). No live Claude call. Mock pattern already in file.

### Integration Tests:
- None added. The prompt change only alters generated text content; runtime behavior of the generator function (model selection, tool name, max tokens) is unchanged and already covered by [generate-procedure-note.test.ts:64-75](src/lib/claude/__tests__/generate-procedure-note.test.ts#L64-L75).

### Manual Testing Steps:
1. Pick or create a case with at least one finalized procedure-note prerequisite (PM extraction approved, IVN finalized, etc.).
2. Record a PRP procedure with `injection_site = "L4-L5, L5-S1"`, `injection_volume_ml = 6`. Generate the note. Open `procedure_injection`. Confirm: both levels named, `(6 mL total)` present, no per-site mL number anywhere.
3. Record a second PRP procedure with `injection_site = "Right Knee, Right Shoulder"`, `injection_volume_ml = 6`. Generate. Confirm non-spine multi-site language with "at each site" wording, no per-site mL number.
4. Record a third procedure with `injection_site = "L5-S1"`, `injection_volume_ml = 5`. Generate. Confirm single-site language preserved.
5. Record a fourth procedure with `injection_site = "L4-L5, L5-S1"`, leave `injection_volume_ml` blank. Generate. Confirm BOTH `[confirm total volume in mL]` and `[confirm per-site mL allocation]` appear.
6. Record a fifth procedure with `injection_site = "L4-L5/L5-S1"` (slash, no comma). Confirm multi-site narration is triggered.

## Performance Considerations

None. Single-prompt static text addition; no extra Claude calls, no extra DB queries, no client-side compute. Token cost increase: roughly 200–300 tokens added to every procedure-note generation (rule + 3 reference paragraphs). Existing prompt is already several thousand tokens.

## Migration Notes

None. No schema change. Existing finalized notes are not regenerated. Old multi-site notes that were generated before this change keep their original single-volume narration; only newly generated or regenerated notes get per-site language.

## References

- Research: `thoughts/shared/research/2026-04-26-prp-volume-multi-site-documentation.md`
- Prompt site to edit: [src/lib/claude/generate-procedure-note.ts:496-511](src/lib/claude/generate-procedure-note.ts#L496-L511)
- Test pattern to follow: [src/lib/claude/__tests__/generate-procedure-note.test.ts:164-196](src/lib/claude/__tests__/generate-procedure-note.test.ts#L164-L196)
- Existing multi-level rule (different section, kept as-is): [src/lib/claude/generate-procedure-note.ts:453](src/lib/claude/generate-procedure-note.ts#L453)
