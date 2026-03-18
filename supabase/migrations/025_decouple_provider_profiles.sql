-- ============================================
-- DECOUPLE PROVIDER PROFILES FROM AUTH USERS
-- ============================================

-- 1. Change user_id FK from CASCADE to SET NULL (don't destroy provider
--    profiles when an auth user is deleted — profiles may be referenced
--    by cases/notes).
alter table public.provider_profiles
  drop constraint provider_profiles_user_id_fkey;
alter table public.provider_profiles
  add constraint provider_profiles_user_id_fkey
    foreign key (user_id) references public.users(id) on delete set null;

-- 2. Make user_id nullable (providers no longer require auth accounts)
alter table public.provider_profiles
  alter column user_id drop not null;

-- 3. Update unique index to allow multiple NULL user_id rows
--    Old index enforced one active profile per user_id, but with nullable
--    user_id we need to only enforce uniqueness when user_id IS NOT NULL.
drop index if exists idx_provider_profiles_user_active;
create unique index idx_provider_profiles_user_active
  on public.provider_profiles (user_id)
  where deleted_at is null and user_id is not null;

-- 4. Repoint supervising_provider_id: users(id) → provider_profiles(id)
--    Current column references users(id) — drop the old FK, then re-add
--    referencing provider_profiles(id) instead.
alter table public.provider_profiles
  drop constraint provider_profiles_supervising_provider_id_fkey;
alter table public.provider_profiles
  add constraint provider_profiles_supervising_provider_id_fkey
    foreign key (supervising_provider_id) references public.provider_profiles(id);

-- 5. Repoint cases.assigned_provider_id: users(id) → provider_profiles(id)
--    First, migrate any existing data (convert user IDs to profile IDs).
update public.cases c
  set assigned_provider_id = pp.id
  from public.provider_profiles pp
  where c.assigned_provider_id = pp.user_id
    and pp.deleted_at is null;

alter table public.cases
  drop constraint cases_assigned_provider_id_fkey;
alter table public.cases
  add constraint cases_assigned_provider_id_fkey
    foreign key (assigned_provider_id) references public.provider_profiles(id);
