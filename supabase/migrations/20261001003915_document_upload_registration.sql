-- A stable document identity makes acknowledgement loss safe to retry. Keep RLS in force.
create or replace function public.register_uploaded_document(
  p_upload_id uuid,
  p_case_id uuid,
  p_document_type text,
  p_file_name text,
  p_file_path text,
  p_file_size_bytes bigint,
  p_mime_type text,
  p_allow_locked boolean default false,
  p_legacy_path boolean default false
) returns table(document_id uuid, created boolean)
language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid();
  actor_role text;
  current_status text;
  existing public.documents%rowtype;
  inserted_id uuid;
  safe_name text := pg_catalog.regexp_replace(p_file_name, '[^a-zA-Z0-9._-]', '_', 'g');
  path_prefix text := 'cases/' || p_case_id::text || '/';
begin
  if actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  select u.role into actor_role from public.users u where u.id = actor and u.is_active;
  if actor_role is null then raise exception 'Active user required' using errcode = '42501'; end if;
  if p_upload_id is null or p_case_id is null or p_file_name is null or p_file_name = ''
    or p_file_size_bytes is null or p_file_size_bytes <= 0 or p_file_size_bytes > 52428800
    or p_mime_type is null or p_mime_type not in ('application/pdf','image/jpeg','image/png','image/webp','application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    or p_document_type is null or p_document_type not in ('mri_report','chiro_report','pain_management','pt_report','orthopedic_report','ct_scan','x_ray','generated','lien_agreement','procedure_consent','other','initial_visit','procedure','discharge','invoice')
  then raise exception 'Invalid document metadata' using errcode = '22023'; end if;
  if p_file_path is null or not (
    (not coalesce(p_legacy_path, false) and p_file_path = path_prefix || p_upload_id::text || '-' || safe_name)
    or (coalesce(p_legacy_path, false) and p_file_path = path_prefix || pg_catalog.substr(p_file_path, pg_catalog.length(path_prefix) + 1, 13) || '-' || safe_name
      and pg_catalog.substr(p_file_path, pg_catalog.length(path_prefix) + 1, 13) ~ '^[0-9]{13}$')
  ) then raise exception 'Invalid document path' using errcode = '22023'; end if;

  select c.case_status into current_status from public.cases c
    where c.id = p_case_id and c.deleted_at is null for update;
  if not found then raise exception 'Case not found' using errcode = '42501'; end if;
  if current_status in ('pending_settlement','closed','archived')
    and not (actor_role = 'admin' and coalesce(p_allow_locked, false))
  then raise exception 'This case is locked' using errcode = '42501'; end if;

  -- ON CONFLICT waits for competing inserts, including calls locking different cases.
  insert into public.documents(id, case_id, document_type, file_name, file_path,
    file_size_bytes, mime_type, status, uploaded_by_user_id, created_by_user_id, updated_by_user_id)
  values (p_upload_id, p_case_id, p_document_type, p_file_name, p_file_path,
    p_file_size_bytes, p_mime_type, 'pending_review', actor, actor, actor)
  on conflict (id) do nothing returning id into inserted_id;

  if inserted_id is null then
    select d.* into existing from public.documents d where d.id = p_upload_id;
    if not found or existing.deleted_at is not null
      or existing.case_id is distinct from p_case_id
      or existing.document_type is distinct from p_document_type
      or existing.file_name is distinct from p_file_name
      or existing.file_path is distinct from p_file_path
      or existing.file_size_bytes is distinct from p_file_size_bytes
      or existing.mime_type is distinct from p_mime_type
      or existing.uploaded_by_user_id is distinct from actor
    then raise exception 'Upload identity conflict' using errcode = '23505'; end if;
    return query select p_upload_id, false;
    return;
  end if;

  if current_status = 'intake' then
    update public.cases set case_status = 'active', updated_by_user_id = actor where id = p_case_id;
    if not found then raise exception 'Failed to update case'; end if;
    insert into public.case_status_history(case_id, previous_status, new_status, changed_by_user_id, notes)
      values (p_case_id, 'intake', 'active', actor, 'Auto-advanced: first clinical activity');
  end if;
  if p_document_type = 'lien_agreement' then
    update public.cases set lien_on_file = true, updated_by_user_id = actor where id = p_case_id;
    if not found then raise exception 'Failed to update lien'; end if;
  end if;
  return query select p_upload_id, true;
end;
$$;
revoke all on function public.register_uploaded_document(uuid,uuid,text,text,text,bigint,text,boolean,boolean) from public, anon;
grant execute on function public.register_uploaded_document(uuid,uuid,text,text,text,bigint,text,boolean,boolean) to authenticated;
