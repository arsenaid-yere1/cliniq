-- Add pain score range to vital_signs table (0-10 numeric pain scale, stored as min/max)
alter table public.vital_signs
  add column pain_score_min integer check (pain_score_min >= 0 and pain_score_min <= 10),
  add column pain_score_max integer check (pain_score_max >= 0 and pain_score_max <= 10);

comment on column public.vital_signs.pain_score_min is
  'Patient-reported pain score lower bound on 0-10 NRS';
comment on column public.vital_signs.pain_score_max is
  'Patient-reported pain score upper bound on 0-10 NRS';
