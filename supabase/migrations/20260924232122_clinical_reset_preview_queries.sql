-- Preserve reset preview behavior while replacing dynamic relation enumeration.
create or replace function private.preview_clinical_reset(p_case_id uuid,p_episode_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.cases%rowtype; e public.care_episodes%rowtype; k text; n jsonb; notes jsonb:='[]'; actor public.users%rowtype; nid uuid;
begin
 select * into actor from public.users where id=auth.uid() and is_active;
 if not found then raise exception using errcode='42501',message='Active user account required'; end if;
 select * into c from public.cases where id=p_case_id and deleted_at is null;
 if not found then raise exception 'Case not found'; end if;
 select * into e from public.care_episodes where case_id=p_case_id and deleted_at is null
  and (p_episode_id is null or id=p_episode_id) order by episode_number desc limit 1;
 if not found then raise exception 'Care episode not found'; end if;
 -- Enumerate each relation explicitly so database lint can validate ownership filters.
 for k,nid in
  select candidates.kind,candidates.id from (
   select 1 as ordinal,'initial_visit_notes'::text as kind,ivn.id
   from public.initial_visit_notes ivn where ivn.episode_id=e.id and ivn.case_id=c.id and ivn.deleted_at is null
   union all
   select 2,'procedure_notes',pn.id from public.procedure_notes pn join public.procedures p on p.id=pn.procedure_id
   where p.episode_id=e.id and p.case_id=c.id and p.deleted_at is null and pn.deleted_at is null
   union all
   select 3,'discharge_notes',dn.id from public.discharge_notes dn
   where dn.episode_id=e.id and dn.case_id=c.id and dn.deleted_at is null
   union all
   select 4,'pain_follow_up_notes',fn.id from public.pain_follow_up_notes fn
   where fn.episode_id=e.id and fn.case_id=c.id and fn.deleted_at is null
  ) candidates order by candidates.ordinal,candidates.id
 loop
   n:=private.clinical_note_info(k,nid);
   notes:=notes || jsonb_build_array(jsonb_build_object('id',nid,'kind',k,'status',n->>'status','updated_at',n->>'updated_at',
     'visit_type',n->>'visit_type','date',coalesce(n->>'visit_date',n->>'procedure_date'),
     'procedure_id',n->>'procedure_id','encounter_id',n->>'encounter_id',
     'blockers',private.clinical_reset_blockers(k,n)));
 end loop;
 return jsonb_build_object('case_id',c.id,'case_status',c.case_status,'case_version',c.updated_at,
  'episode_id',e.id,'episode_number',e.episode_number,'episode_status',e.status,'episode_version',e.updated_at,
  'is_admin',actor.role='admin','notes',notes,
  'latest_episode',not exists(select 1 from public.care_episodes x where x.case_id=c.id and x.deleted_at is null and x.episode_number>e.episode_number),
  'open_correction',exists(select 1 from public.discharge_note_corrections x where x.episode_id=e.id and x.status='open'),
  'reopened',exists(select 1 from public.clinical_reset_operations x where x.episode_id=e.id and (x.request->>'reactivate')::boolean and x.before_state->'episode'->>'status'='discharged'));
end $$;
