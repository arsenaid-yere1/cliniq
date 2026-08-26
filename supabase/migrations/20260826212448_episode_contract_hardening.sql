-- Phase 6 ownership contract hardening.

alter table public.initial_visit_notes
  add constraint initial_visit_notes_live_episode_required
    check (deleted_at is not null or (episode_id is not null and encounter_id is not null)) not valid;
alter table public.discharge_notes
  add constraint discharge_notes_live_episode_required
    check (deleted_at is not null or (episode_id is not null and encounter_id is not null)) not valid;
alter table public.procedures
  add constraint procedures_live_episode_required
    check (deleted_at is not null or (episode_id is not null and procedure_series_id is not null)) not valid;
alter table public.pain_follow_up_notes
  add constraint pain_follow_up_notes_live_owner_required
    check (deleted_at is not null or (episode_id is not null and encounter_id is not null)) not valid;
alter table public.clinical_orders
  add constraint clinical_orders_live_episode_required
    check (deleted_at is not null or episode_id is not null) not valid;
alter table public.case_quality_reviews
  add constraint case_quality_reviews_live_episode_required
    check (deleted_at is not null or episode_id is not null) not valid;
alter table public.vital_signs
  add constraint nonprocedure_vitals_encounter_required
    check (deleted_at is not null or procedure_id is not null or encounter_id is not null) not valid;

alter table public.initial_visit_notes validate constraint initial_visit_notes_live_episode_required;
alter table public.discharge_notes validate constraint discharge_notes_live_episode_required;
alter table public.procedures validate constraint procedures_live_episode_required;
alter table public.pain_follow_up_notes validate constraint pain_follow_up_notes_live_owner_required;
alter table public.clinical_orders validate constraint clinical_orders_live_episode_required;
alter table public.case_quality_reviews validate constraint case_quality_reviews_live_episode_required;
alter table public.vital_signs validate constraint nonprocedure_vitals_encounter_required;

create or replace function public.enforce_episode_procedure_date()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare v_floor date;
begin
  if new.deleted_at is not null then return new; end if;
  if new.episode_id is null or new.procedure_series_id is null then
    raise exception using errcode='23502',message='Live procedures require episode and series ownership';
  end if;
  if new.source_encounter_id is not null then
    select e.encounter_date into v_floor from public.clinical_encounters e
    where e.id=new.source_encounter_id and e.case_id=new.case_id and e.episode_id=new.episode_id
      and e.status='completed' and e.deleted_at is null;
    if not found then raise exception using errcode='23503',message='Procedure source must be a completed encounter in the same episode'; end if;
  end if;
  select greatest(v_floor, max(e.encounter_date)) into v_floor
  from public.clinical_encounters e
  where e.episode_id=new.episode_id and e.case_id=new.case_id and e.status='completed'
    and e.encounter_type in ('initial_evaluation','pain_evaluation','pain_follow_up') and e.deleted_at is null;
  if v_floor is not null and new.procedure_date < v_floor then
    raise exception using errcode='23514',message='Procedure date cannot precede the latest completed visit in its episode';
  end if;
  return new;
end
$$;
create trigger procedures_episode_date_trg
  before insert or update of case_id,episode_id,source_encounter_id,procedure_date,deleted_at
  on public.procedures for each row execute function public.enforce_episode_procedure_date();
revoke execute on function public.enforce_episode_procedure_date() from public,anon;

do $$
begin
  if to_regclass('public.idx_discharge_notes_case_active') is not null then
    raise exception 'Legacy case-level discharge uniqueness still exists';
  end if;
  if to_regclass('public.discharge_notes_episode_active_idx') is null then
    raise exception 'Episode-level discharge uniqueness is missing';
  end if;
  if exists (
    select 1 from public.procedure_appointments a
    left join public.procedures p on p.procedure_appointment_id=a.id and p.deleted_at is null
    where a.status='completed' and a.deleted_at is null and p.id is null
  ) then raise exception 'Completed appointment without a performed procedure'; end if;
end
$$;
