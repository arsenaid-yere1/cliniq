begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(5);

select results_eq(
  $$select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'clinical_encounters'
      and column_name in ('diagnoses', 'diagnoses_confirmed_at', 'diagnoses_confirmed_by_user_id')$$,
  $$values (0)$$,
  'visit-specific diagnosis columns are removed from encounters'
);

select results_eq(
  $$select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('initial_visit_notes', 'pain_follow_up_notes', 'procedure_notes')
      and column_name = 'diagnoses_snapshot'$$,
  $$values (0)$$,
  'diagnosis snapshot columns are removed from notes'
);

select results_eq(
  $$select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'valid_diagnosis_array',
        'format_visit_diagnoses',
        'format_procedure_diagnoses',
        'authorize_encounter_diagnosis_confirmation',
        'guard_note_diagnosis_snapshot',
        'guard_note_diagnosis_finalization',
        'prepare_evaluation_visit'
      )$$,
  $$values (0)$$,
  'visit-specific diagnosis functions are removed'
);

select results_eq(
  $$select count(*)::integer
    from pg_trigger
    where not tgisinternal
      and tgname in (
        'clinical_encounters_confirm_diagnoses_trg',
        'initial_visit_notes_diagnosis_snapshot_trg',
        'pain_follow_up_notes_diagnosis_snapshot_trg',
        'procedure_notes_diagnosis_snapshot_trg',
        'initial_visit_notes_diagnosis_finalize_trg',
        'pain_follow_up_notes_diagnosis_finalize_trg',
        'procedure_notes_diagnosis_finalize_trg'
      )$$,
  $$values (0)$$,
  'visit-specific diagnosis triggers are removed'
);

select results_eq(
  $$select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'finalize_pain_follow_up'
      and pg_get_function_identity_arguments(p.oid) =
        'p_case_id uuid, p_encounter_id uuid, p_note_id uuid, p_document_id uuid'
      and p.prosrc not ilike '%diagnoses_snapshot%'
      and p.prosrc not ilike '%diagnoses_confirmed_at%'$$,
  $$values (1)$$,
  'pre-feature follow-up finalization function is restored'
);

select * from finish();
rollback;
