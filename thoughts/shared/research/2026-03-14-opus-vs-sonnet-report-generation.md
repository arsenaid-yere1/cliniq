---
date: 2026-03-14T12:00:00-07:00
researcher: Claude
git_commit: 39f19441cdca3933b1abba607bc3cca7d4152c21
branch: main
repository: cliniq
topic: "Claude Opus vs Sonnet for Clinical Report Generation — Model Selection Recommendation"
tags: [research, ai-model-selection, claude, opus, sonnet, report-generation, cost-optimization]
status: complete
last_updated: 2026-03-14
last_updated_by: Claude
---

# Research: Claude Opus vs Sonnet for Clinical Report Generation

**Date**: 2026-03-14T12:00:00-07:00
**Researcher**: Claude
**Git Commit**: 39f19441cdca3933b1abba607bc3cca7d4152c21
**Branch**: main
**Repository**: cliniq

## Research Question

Should ClinIQ use Claude Opus 4.6 or Claude Sonnet 4.6 for clinical report generation (Initial Visit notes, Procedure notes, Discharge notes)? What model should be used for document extractions and case summary generation?

## Summary

**Recommendation: Keep the current model assignments.** The codebase's existing model selection is well-reasoned:

- **Opus 4.6 for Case Summary generation** — correct, because summaries require multi-source synthesis across all extraction types with deep reasoning
- **Sonnet 4.6 for all document extractions** — correct, because extractions are structured JSON output with rigid schemas where Sonnet's instruction-following excels
- **Sonnet 4.6 for all clinical note generation** — correct for MVP, because the notes are generated from already-synthesized case summary data (the hard reasoning work is already done by Opus), and Sonnet's speed advantage (2-3x faster) directly improves provider UX

The key architectural insight is the **dependency chain**: Opus does the hard synthesis work once (case summary), and then Sonnet generates multiple downstream documents from that pre-digested input. This is an effective model-routing pattern.

---

## Detailed Findings

### 1. Current Model Assignments in the Codebase

| Task | Model | Thinking | max_tokens | File |
|---|---|---|---|---|
| Case Summary generation | `claude-opus-4-6` | Enabled (10k budget) | 16384 | `generate-summary.ts:264` |
| Initial Visit note (full) | `claude-sonnet-4-6` | No | 16384 | `generate-initial-visit.ts:239` |
| Initial Visit section regen | `claude-sonnet-4-6` | No | 4096 | `generate-initial-visit.ts:295` |
| PRP Procedure note (full) | `claude-sonnet-4-6` | No | 16384 | `generate-procedure-note.ts:265` |
| PRP Procedure section regen | `claude-sonnet-4-6` | No | 4096 | `generate-procedure-note.ts:321` |
| Discharge note (full) | `claude-sonnet-4-6` | No | 16384 | `generate-discharge-note.ts:227` |
| Discharge section regen | `claude-sonnet-4-6` | No | 4096 | `generate-discharge-note.ts:284` |
| MRI extraction | `claude-sonnet-4-6` | No | 4096 | `extract-mri.ts:90` |
| Chiro extraction | `claude-sonnet-4-6` | No | 4096 | `extract-chiro.ts:183` |
| Pain Management extraction | `claude-sonnet-4-6` | No | 4096 | `extract-pain-management.ts:169` |
| Physical Therapy extraction | `claude-sonnet-4-6` | No | 4096 | `extract-pt.ts:304` |
| Orthopedic extraction | `claude-sonnet-4-6` | No | 4096 | `extract-orthopedic.ts:232` |
| CT Scan extraction | `claude-sonnet-4-6` | No | 4096 | `extract-ct-scan.ts:75` |

Model names are hardcoded in each file — no environment variable or config layer for model selection.

### 2. Why Opus for Case Summary Is Correct

The case summary generation is the **most cognitively demanding** task in the pipeline:

- It aggregates data from **all 6 extraction types simultaneously** via `Promise.all` in `case-summaries.ts:23`
- It must synthesize conflicting or overlapping findings across MRI, chiropractic, pain management, physical therapy, orthopedic, and CT scan sources
- It produces a deeply nested structured output (arrays of imaging findings, diagnosis objects, treatment gap objects, symptom timeline entries)
- It uses **extended thinking** with a 10,000 token budget to reason through complex cross-references
- It is the single upstream dependency for all downstream note generation

Opus 4.6 scores ~74.9% on GPQA (graduate-level expert reasoning) vs Sonnet's ~68%, a meaningful gap for tasks requiring medical synthesis.

### 3. Why Sonnet for Note Generation Is Correct

Clinical note generation (Initial Visit, Procedure, Discharge) operates on **pre-digested data**:

```
PDF uploads
  → extraction (Sonnet, 4096 tokens)
  → provider review/approve
  → case summary (Opus + thinking, 16384 tokens)  ← hard reasoning here
  → provider review/approve
  → clinical notes (Sonnet, 16384 tokens)  ← template-guided prose from pre-synthesized data
```

The notes are generated from the approved case summary — the complex multi-source synthesis has already been done by Opus. The note generation task is essentially **template-guided prose expansion** from structured input, which Sonnet handles well because:

1. **Instruction-following**: Sonnet 4.6 is specifically praised for adhering to output formats and section-level formatting rules. The note system prompts are 100-200 lines of precise per-section instructions.
2. **Speed**: Sonnet is 2-3x faster (~40-55 tok/sec vs ~20-39 tok/sec). For a provider waiting for a 7-page Initial Visit note, this is the difference between ~15 seconds and ~30-45 seconds.
3. **Cost**: Sonnet at $3/$15 per MTok vs Opus at $5/$25 per MTok. With 16384 max output tokens per note and 3 note types per case, this adds up.

### 4. Pricing Comparison (Current 4.6 Generation)

| Model | Input/MTok | Output/MTok | Batch Input | Batch Output |
|---|---|---|---|---|
| Claude Opus 4.6 | $5.00 | $25.00 | $2.50 | $12.50 |
| Claude Sonnet 4.6 | $3.00 | $15.00 | $1.50 | $7.50 |
| Claude Haiku 4.5 | $1.00 | $5.00 | $0.50 | $2.50 |

**Cost ratio**: Opus is 1.67x Sonnet (not the 5x from the original Opus 4 generation).

### 5. Per-Case Cost Estimate

A typical case involves:
- 2-4 document extractions (Sonnet, ~4k output tokens each): ~$0.06-$0.12 output
- 1 case summary (Opus, ~16k output tokens + 10k thinking): ~$0.40 output + $0.13 thinking
- 3 clinical notes (Sonnet, ~16k output tokens each): ~$0.72 output
- Occasional section regenerations (Sonnet, ~4k output each): ~$0.06 each

**Estimated total per case**: ~$1.30-$1.50 in output tokens (input costs are smaller since prompts + source data are typically <10k tokens per call).

If all note generation were switched to Opus, the 3 clinical notes would cost ~$1.20 instead of ~$0.72 — a ~$0.48 increase per case (33% more overall).

### 6. When to Reconsider Opus for Note Generation

Consider upgrading specific note types to Opus if:

1. **Providers consistently report quality issues** with Sonnet-generated notes that require extensive manual editing — the time cost of editing could outweigh the model cost savings
2. **Complex multi-condition cases** where the note needs to reason about treatment interactions not fully captured in the case summary
3. **Legal scrutiny is high** — if the notes will be used directly in depositions, the marginal quality improvement from Opus might be worth the cost
4. **You implement prompt caching** — cached reads are 90% cheaper, which compresses the cost gap between models significantly since system prompts are large (100-200 lines) and identical across calls

### 7. Potential Optimization: Prompt Caching

Both models support prompt caching. Given the large, identical system prompts (100-200 lines) used across same-type note generation and section regeneration, prompt caching could reduce input costs significantly:

- **5-minute cache**: Write at 1.25x, read at 0.10x input price
- **1-hour cache**: Write at 2.0x, read at 0.10x input price

If a provider generates an Initial Visit note and then regenerates 2-3 sections, the system prompt cache would hit on every regeneration call, reducing input costs by ~90% for those calls.

---

## Architecture Documentation

### Model Selection Pattern

Models are hardcoded as string literals in each `anthropic.messages.create()` call. There is no centralized model configuration, environment variable, or routing layer. The `ai_model` field is also hardcoded in server actions when writing to the database (not derived from the API call response).

This is appropriate for MVP — model routing infrastructure would be over-engineering at this stage. If model experimentation becomes frequent, a simple constants file (`src/lib/claude/models.ts`) mapping task types to model strings would be the lightest-weight improvement.

### Extended Thinking Pattern

Only case summary generation uses extended thinking (`thinking: { type: 'enabled', budget_tokens: 10000 }`). This is a 10k token budget for internal reasoning before producing the tool-use output. None of the note generation or extraction calls use thinking — the system prompts provide sufficient structural guidance that explicit reasoning is unnecessary.

---

## Code References

- [generate-summary.ts:264](src/lib/claude/generate-summary.ts#L264) — Only Opus call, with extended thinking
- [generate-initial-visit.ts:239](src/lib/claude/generate-initial-visit.ts#L239) — Sonnet for full note generation
- [generate-initial-visit.ts:295](src/lib/claude/generate-initial-visit.ts#L295) — Sonnet for section regeneration
- [generate-procedure-note.ts:265](src/lib/claude/generate-procedure-note.ts#L265) — Sonnet for procedure notes
- [generate-discharge-note.ts:227](src/lib/claude/generate-discharge-note.ts#L227) — Sonnet for discharge notes
- [case-summaries.ts:175](src/actions/case-summaries.ts#L175) — Hardcoded `'claude-opus-4-6'` model string for DB storage
- [case-summaries.ts:23](src/actions/case-summaries.ts#L23) — Multi-extraction data aggregation

## Historical Context (from thoughts/)

- `thoughts/shared/research/2026-03-09-epic-3-story-3.1-initial-visit-note-design.md` — Original design research for Initial Visit note generation; recommended Option B (section-based Textarea form) and defined the data dependency chain
- `thoughts/shared/research/2026-03-08-epic-2-story-2.3-clinical-case-summary-design.md` — Case summary design that established the Opus + thinking pattern for multi-source synthesis

## Related Research

- [2026-03-09-epic-3-story-3.1-initial-visit-note-design.md](thoughts/shared/research/2026-03-09-epic-3-story-3.1-initial-visit-note-design.md) — Initial Visit note design
- [2026-03-08-epic-2-story-2.3-clinical-case-summary-design.md](thoughts/shared/research/2026-03-08-epic-2-story-2.3-clinical-case-summary-design.md) — Case summary design (Opus usage origin)

## Open Questions

1. **Quality benchmarking**: Has there been any A/B comparison of Sonnet vs Opus output for clinical notes on real case data? If providers are consistently making the same types of edits to Sonnet-generated notes, that pattern could inform whether Opus would reduce editing burden.

2. **Prompt caching implementation**: Would implementing prompt caching (especially the 1-hour variant) change the cost calculus enough to justify Opus for all note types? With cached system prompts, the effective per-call cost gap narrows.

3. **Haiku for extractions**: Could Claude Haiku 4.5 ($1/$5 per MTok) handle document extractions adequately? The extraction schemas are well-defined and the task is more pattern-matching than reasoning. This could save ~$0.04-$0.08 per extraction.
