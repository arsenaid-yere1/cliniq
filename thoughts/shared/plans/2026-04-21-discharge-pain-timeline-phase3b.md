---
date: 2026-04-21
author: arsenaid
status: in-progress
topic: Discharge pain-timeline precision — Phase 3b (R10-widget)
depends_on:
  - thoughts/shared/research/2026-04-21-discharge-pain-timeline-precision.md
  - thoughts/shared/plans/2026-04-21-discharge-pain-timeline-phase1.md
  - thoughts/shared/plans/2026-04-21-discharge-pain-timeline-phase3a.md
tags: [plan, discharge-notes, pain-timeline, ui, table]
---

# Plan: Discharge pain-timeline precision — Phase 3b

## Goal

Render a read-only pain-timeline TABLE above the discharge-note section textareas so the provider can cross-check the narrative against the structured source data at a glance. User-confirmed format: table (not chart).

## Scope

- New server action `getDischargePainTimeline(caseId)` that fetches the same trajectory and observations payloads the generator uses, and returns them to the client.
- New client component `PainTimelineTable` rendering two stacked tables:
  - **Deterministic trajectory** — intake + procedures + discharge rows with columns: *When | Label | Pain | Source | Day*.
  - **Supplementary observations** — PT / PM / chiro rows with columns: *Date | Source | Label | Pain | Context*. Rendered only when ≥1 observation present.
- Wired into `DraftEditor` above the existing section textareas.

## Non-goals

- No charts, no sparklines.
- No editing inside the table — read-only.
- No new DB columns.
- Not shown on the Finalized view (only draft editor). The finalized PDF remains the authoritative record.

## Design

### Server action

```ts
// src/actions/discharge-notes.ts
export async function getDischargePainTimeline(caseId: string): Promise<{
  data?: {
    trajectory: DischargePainTrajectory
    painObservations: PainObservation[]
    painTrajectoryText: string | null
    dischargeVisitPainDisplay: string | null
    dischargeVisitPainEstimated: boolean
  }
  error?: string
}>
```

Implementation: auth check, call `gatherDischargeNoteSourceData(...)` with the note's `visit_date` (or today), build a trajectory payload using existing helpers, return. Does NOT persist anything — pure read path. Runs the same trajectory computation the generator uses so the table always matches what the LLM would see on regen.

### Client component

```tsx
// src/components/discharge/pain-timeline-table.tsx
interface PainTimelineTableProps {
  trajectory: DischargePainTrajectory | null
  painObservations: PainObservation[]
  dischargeEstimated: boolean
}
```

Behavior:
- Empty state when trajectory has no entries AND no observations: render a muted "No pain data recorded for this case." text — not a blank card.
- Deterministic table always shows even when only 1 entry exists (still informative).
- Observations table only shows when at least one observation exists.
- `dischargeEstimated = true` surfaces a small inline `(-2 estimate)` badge on the discharge row.
- Pain cell renders `formatPainValue(min, max)` (via new helper import from pain-trajectory) — falls back to `—` when null.
- Day column renders `—` when `dayOffset` is null.
- Source column uses colored badges: intake (blue), procedure (slate), discharge_vitals (green), discharge_estimate (amber), pt/pm/chiro (purple/teal/rose).

### Wiring

In `DraftEditor`:
- On mount, `startTransition(async () => { const res = await getDischargePainTimeline(caseId); setTimelineData(res.data ?? null) })`.
- Render `<PainTimelineTable ...>` immediately below the tone-direction card, above the first section field.
- Re-fetch after full generation succeeds (source data may have changed).
- Re-fetch after section regen succeeds (observations sidecar can refresh).

### Accessibility

- Use `<table role="table">` with proper thead/tbody.
- Numeric pain cell `scope="col"` header cells.
- Avoid relying on color alone for source — include text label alongside badge.

## Risk / Rollback

- Additive only — removing the widget file + a handful of imports reverts.
- Server action uses read-only helpers; no write path.
- If `gatherDischargeNoteSourceData` errors (e.g. missing case), the action returns `error` and the table renders the empty state.

## Tests

- `pain-timeline-table.test.tsx`:
  - renders empty state when trajectory null + no observations
  - renders trajectory rows with day offsets
  - renders `(-2 estimate)` badge only when `dischargeEstimated`
  - renders observations table with context
  - hides observations table when empty array
- Server action test deferred (existing gather tests cover the builder).

## Task breakdown

1. Create `getDischargePainTimeline` server action.
2. Create `PainTimelineTable` component + tests.
3. Wire into `DraftEditor`.
4. `npm run lint` + `npx tsc --noEmit` + `npx vitest run`.
5. Commit + push.
