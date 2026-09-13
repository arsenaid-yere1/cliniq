"""Separate-connection checks against the disposable LOCAL Supabase container.
Run: python3 scripts/tests/follow-up-source-concurrency.py
Never connects to a remote database. Fixtures are synthetic and removed afterward.
"""
import subprocess
import uuid

CMD = ['docker', 'exec', '-i', 'supabase_db_cliniq', 'psql', '-U', 'postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1']
def sql(value, ok=True):
    result = subprocess.run(CMD, input='\\set VERBOSITY verbose\n' + value, text=True, capture_output=True, timeout=15)
    if ok and result.returncode:
        raise AssertionError(result.stderr)
    return result

def hold(value):
    process = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    process.stdin.write('begin; set statement_timeout=5000; ' + value + '\n\\echo READY\n')
    process.stdin.flush()
    while True:
        line = process.stdout.readline()
        if line.strip() == 'READY':
            return process
        if not line:
            raise AssertionError(process.stderr.read())

def release(process):
    process.stdin.write('rollback;\n\\q\n')
    process.stdin.flush()
    process.wait(timeout=10)

uid, patient, case, other, provider, encounter, historical, note, eligibility, evaluation, evaluation_encounter = [str(uuid.uuid4()) for _ in range(11)]
auth = f"select set_config('request.jwt.claim.sub','{uid}',true);"
try:
    sql(f"""
    insert into auth.users(id,email,raw_user_meta_data) values('{uid}','race-{uid}@test.local','{{}}');
    update public.users set is_active=true,role='admin' where id='{uid}';
    insert into public.patients(id,first_name,last_name,date_of_birth) values('{patient}','Synthetic','Concurrency','1980-01-01');
    insert into public.cases(id,patient_id,case_status) values('{case}','{patient}','active'),('{other}','{patient}','active');
    insert into public.provider_profiles(id,display_name) values('{provider}','Synthetic Provider');
    insert into public.clinical_encounters(id,case_id,episode_id,encounter_type,status,encounter_date,provider_id)
    select '{encounter}','{case}',id,'pain_follow_up','in_progress','2026-05-02','{provider}' from public.care_episodes where case_id='{case}';
    insert into public.clinical_encounters(id,case_id,episode_id,encounter_type,status,encounter_date)
    select '{historical}','{case}',id,'pain_follow_up','completed','2026-04-01' from public.care_episodes where case_id='{case}';
    insert into public.clinical_encounters(id,case_id,episode_id,encounter_type,status,encounter_date)
    select '{eligibility}','{case}',id,'pain_follow_up','cancelled','2026-04-30' from public.care_episodes where case_id='{case}';
    insert into public.clinical_encounters(id,case_id,episode_id,encounter_type,status,encounter_date)
    select '{evaluation_encounter}','{case}',id,'pain_evaluation','in_progress','2026-03-01' from public.care_episodes where case_id='{case}';
    insert into public.initial_visit_notes(id,case_id,episode_id,encounter_id,visit_type,status,visit_date,provider_intake)
    select '{evaluation}','{case}',id,'{evaluation_encounter}','pain_evaluation_visit','draft','2026-03-01','{{}}' from public.care_episodes where case_id='{case}';
    insert into public.pain_follow_up_notes(id,case_id,episode_id,encounter_id,status)
    select '{note}','{case}',episode_id,id,'draft' from public.clinical_encounters where id='{encounter}';
    """)
    mutations = [
        f"update public.clinical_encounters set status='completed' where id='{eligibility}'",
        f"update public.initial_visit_notes set visit_date='2026-03-02' where id='{evaluation}'",
        auth + f"select public.reset_pain_follow_up('{case}','{encounter}')",

        f"update public.clinical_encounters set encounter_date='2026-05-01' where id='{historical}'",
        f"update public.clinical_encounters set status='cancelled' where id='{historical}'",
        f"delete from public.clinical_encounters where id='{historical}'",
        f"insert into public.clinical_encounters(case_id,episode_id,encounter_type,status,encounter_date) select '{case}',id,'pain_follow_up','completed','2026-04-30' from public.care_episodes where case_id='{case}'",
        f"update public.patients set first_name='Changed' where id='{patient}'",
        f"update public.provider_profiles set display_name='Changed' where id='{provider}'",
        f"update public.clinical_encounters set case_id='{other}',episode_id=(select id from public.care_episodes where case_id='{other}') where id='{historical}'",
    ]
    for mutation in mutations:
        protected = hold(auth + f"select private.follow_up_snapshot('{case}','{encounter}');")
        try:
            result = sql('begin; set statement_timeout=500; ' + mutation + '; rollback;', ok=False)
            # UPDATE takes its existing row lock before row triggers. Selected rows
            # therefore block; new membership reaches the fail-fast scope trigger.
            assert result.returncode and any(code in result.stderr for code in ('55P03', '57014')), result.stderr or ('Mutation passed protected snapshot: ' + mutation)
            if mutation.startswith('insert') or eligibility in mutation or evaluation in mutation:
                assert '55P03' in result.stderr, 'New membership and evaluation sync must fail without waiting: ' + result.stderr
        finally:
            release(protected)
    # Reverse direction: a writer owns the source scope; a reader fails promptly.
    protected = hold(f"update public.clinical_encounters set encounter_date='2026-04-02' where id='{historical}';")
    try:
        result = sql('begin; set statement_timeout=3000; ' + auth + f"select private.follow_up_snapshot('{case}','{encounter}');", ok=False)
        assert result.returncode and '55P03' in result.stderr, result.stderr
    finally:
        release(protected)
    # A pre-existing row lock must fail NOWAIT instead of forming a lock cycle.
    protected = hold(f"select id from public.clinical_encounters where id='{historical}' for update;")
    try:
        result = sql('begin; set statement_timeout=3000; ' + auth + f"select private.follow_up_snapshot('{case}','{encounter}');", ok=False)
        assert result.returncode and '55P03' in result.stderr, result.stderr
    finally:
        release(protected)
    print('Passed 12 separate-connection source locking scenarios')
finally:
    sql(f"delete from public.initial_visit_notes where id='{evaluation}'; delete from public.pain_follow_up_notes where id='{note}'; delete from public.clinical_encounters where case_id in ('{case}','{other}'); delete from public.cases where id in ('{case}','{other}'); delete from public.patients where id='{patient}'; delete from public.provider_profiles where id='{provider}'; delete from auth.users where id='{uid}';", ok=False)
