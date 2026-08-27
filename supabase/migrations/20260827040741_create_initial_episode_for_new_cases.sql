-- Every case must start with Episode 1. The original episode migration
-- backfilled existing cases, but cases created afterward had no episode until
-- another workflow attempted to use one.

create or replace function public.create_initial_care_episode()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.care_episodes (
    case_id,
    episode_number,
    status,
    opened_at,
    created_by_user_id,
    updated_by_user_id
  ) values (
    new.id,
    1,
    case
      when new.case_status in ('pending_settlement', 'closed', 'archived') then 'cancelled'
      else 'active'
    end,
    coalesce(new.created_at, now()),
    new.created_by_user_id,
    new.updated_by_user_id
  );

  return new;
end
$$;

drop trigger if exists cases_create_initial_care_episode_trg on public.cases;
create trigger cases_create_initial_care_episode_trg
  after insert on public.cases
  for each row execute function public.create_initial_care_episode();

-- Repair cases created after the original backfill and before this trigger.
insert into public.care_episodes (
  case_id,
  episode_number,
  status,
  opened_at,
  created_by_user_id,
  updated_by_user_id
)
select
  c.id,
  1,
  case
    when c.case_status in ('pending_settlement', 'closed', 'archived') then 'cancelled'
    else 'active'
  end,
  coalesce(c.created_at, now()),
  c.created_by_user_id,
  c.updated_by_user_id
from public.cases c
where c.deleted_at is null
  and not exists (
    select 1
    from public.care_episodes episode
    where episode.case_id = c.id
      and episode.episode_number = 1
      and episode.deleted_at is null
  );

revoke execute on function public.create_initial_care_episode() from public, anon;
grant execute on function public.create_initial_care_episode() to authenticated;
