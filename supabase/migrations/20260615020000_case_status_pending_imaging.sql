-- Add 'pending_imaging' case status: tracks cases awaiting imaging results after the
-- Initial Visit. Free, non-locked side-state entered manually. Additive CHECK widening.
alter table public.cases
  drop constraint if exists cases_case_status_check,
  add constraint cases_case_status_check
    check (case_status in (
      'intake',
      'pending_imaging',
      'active',
      'pending_settlement',
      'closed',
      'archived'
    ));
