# Return Tele-Visits Rollout and Integrity Runbook

## Release order

1. Deploy application and migrations together with `ENABLE_RETURN_TELE_VISITS=false`.
2. Run the integrity queries below. Every query must return zero rows unless a documented legacy exception is being repaired.
3. Confirm authenticated RPC access and anonymous denial for the workflow functions.
4. Remove the temporary `ENABLE_RETURN_TELE_VISITS=false` override (or set it to `true`) and redeploy the application. The released default is enabled.
5. Complete the end-to-end scenario in the implementation plan before broad staff rollout.

The gate is server-side. Return tele-visits are enabled unless the flag is explicitly set to `false`. Disabled pages return not found and disabled mutations return `Return tele-visits are not enabled` before database access.

## Integrity queries

```sql
-- More than one active episode, or active legal cases with no episode at all.
select c.id, c.case_number, count(e.id) filter (where e.status = 'active' and e.deleted_at is null) active_episodes
from public.cases c
left join public.care_episodes e on e.case_id = c.id
where c.deleted_at is null
group by c.id, c.case_number
having count(e.id) filter (where e.status = 'active' and e.deleted_at is null) > 1
   or (c.case_status = 'active' and count(e.id) = 0);

-- Live clinical records missing required ownership.
select 'initial_visit_notes' source, id from public.initial_visit_notes where deleted_at is null and (episode_id is null or encounter_id is null)
union all select 'discharge_notes', id from public.discharge_notes where deleted_at is null and (episode_id is null or encounter_id is null)
union all select 'pain_follow_up_notes', id from public.pain_follow_up_notes where deleted_at is null and (episode_id is null or encounter_id is null)
union all select 'procedures', id from public.procedures where deleted_at is null and (episode_id is null or procedure_series_id is null)
union all select 'clinical_orders', id from public.clinical_orders where deleted_at is null and episode_id is null
union all select 'case_quality_reviews', id from public.case_quality_reviews where deleted_at is null and episode_id is null;

-- Appointment/procedure state divergence.
select a.id, a.status, p.id procedure_id
from public.procedure_appointments a
left join public.procedures p on p.procedure_appointment_id = a.id and p.deleted_at is null
where a.deleted_at is null
  and ((a.status = 'completed' and p.id is null) or (a.status <> 'completed' and p.id is not null));

-- Cross-case or cross-episode ownership mismatches.
select p.id
from public.procedures p
join public.care_episodes e on e.id = p.episode_id
join public.procedure_series s on s.id = p.procedure_series_id
where p.deleted_at is null
  and (p.case_id <> e.case_id or p.case_id <> s.case_id or p.episode_id <> s.episode_id);

-- Duplicate active billing claims (should also be prevented by unique indexes).
select encounter_id, claim_kind, count(*) from public.billing_source_claims
where encounter_id is not null and released_at is null group by encounter_id, claim_kind having count(*) > 1
union all
select procedure_id, claim_kind, count(*) from public.billing_source_claims
where procedure_id is not null and released_at is null group by procedure_id, claim_kind having count(*) > 1;

-- Discharge state/note mismatch.
select e.id, e.status, d.id discharge_note_id, d.status note_status
from public.care_episodes e
left join public.discharge_notes d on d.episode_id = e.id and d.deleted_at is null and d.status = 'finalized'
where e.deleted_at is null
  and ((e.status = 'discharged' and d.id is null) or (e.status <> 'discharged' and d.id is not null));
```

## RPC privilege checks

Workflow functions must be `security_invoker`, have an empty `search_path`, deny `anon`, and grant execute only to `authenticated`. Verify `prosecdef = false` and `proconfig` contains `search_path=""` in `pg_proc`, then inspect `has_function_privilege` for both roles.

## Manual release scenario

Preserve and finalize Episode 1, close the case, start a return telehealth visit, finalize its follow-up note, create a structured procedure order, schedule/reschedule/complete it, generate its note and invoice, and discharge Episode 2. Verify both episodes remain separately visible in Visits, Documents, Procedures, Timeline, Quality Review, and Billing.

Do not mark this manual scenario complete unless a user confirms it against the deployed environment.
