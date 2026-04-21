-- Discharge-note deterministic pain-trajectory persistence.
--
-- Phase-1 of the pain-timeline precision work. The discharge-visit pain
-- endpoint and the arrow-chain narrative string are now computed in
-- TypeScript (src/lib/claude/pain-trajectory.ts) and passed to the LLM as
-- verbatim strings rather than reconstructed inside the prompt. To preserve
-- the computed values for audit, regeneration parity, and defensibility,
-- persist them alongside the note.
--
-- discharge_pain_estimate_min/max mirror pain_score_min/max semantically
-- but are specifically the ENDPOINT used in the narrative — which may come
-- from dischargeVitals (provider-entered), latestVitals (when trend is
-- stable/worsened), or the -2 rule (when trend is improving and no
-- discharge vitals were entered).
--
-- discharge_pain_estimated = true iff the endpoint was fabricated via the
-- -2 rule. Provider-entered values and latest-procedure-passthrough both
-- set this to false.
--
-- pain_trajectory_text is the deterministic arrow chain the LLM must
-- render verbatim in subjective/assessment/prognosis when non-null.

alter table public.discharge_notes
  add column discharge_pain_estimate_min integer check (discharge_pain_estimate_min >= 0 and discharge_pain_estimate_min <= 10),
  add column discharge_pain_estimate_max integer check (discharge_pain_estimate_max >= 0 and discharge_pain_estimate_max <= 10),
  add column discharge_pain_estimated boolean not null default false,
  add column pain_trajectory_text text;

comment on column public.discharge_notes.discharge_pain_estimate_min is
  'Computed discharge-visit pain lower bound used in the narrative endpoint. Sourced from dischargeVitals (provider-entered) when present, else latestVitals verbatim when trend is stable/worsened, else latestVitals - 2 floored at 0. Persisted for audit.';

comment on column public.discharge_notes.discharge_pain_estimate_max is
  'Computed discharge-visit pain upper bound. Symmetric with discharge_pain_estimate_min.';

comment on column public.discharge_notes.discharge_pain_estimated is
  'True when discharge_pain_estimate_min/max were fabricated via the -2 rule. False when provider-entered (dischargeVitals) or carried from latestVitals on a non-improving series.';

comment on column public.discharge_notes.pain_trajectory_text is
  'Deterministic arrow-chain narrative (e.g. "8/10 -> 6/10 -> 4/10 across the injection series, 1/10 at today''s discharge evaluation"). The LLM renders this verbatim; re-deriving it in the prompt is forbidden.';
