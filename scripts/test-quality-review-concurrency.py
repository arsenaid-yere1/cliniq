"""Real PostgreSQL sessions against an explicitly named disposable QC database.
Usage: python3 scripts/test-quality-review-concurrency.py cliniq_qc_test_20260916
Requires local Docker/Supabase; never targets postgres or a remote database.
"""
import concurrent.futures
import json
import os
import subprocess
import sys
import threading
import uuid

DB = sys.argv[1] if len(sys.argv) == 2 else ''
if not DB.startswith('cliniq_qc_test_') or not DB.replace('_', '').isalnum():
    sys.exit('Provide a disposable cliniq_qc_test_* database name')
ENV = dict(os.environ, DOCKER_HOST=os.environ.get('DOCKER_HOST', 'unix://' + os.path.expanduser('~/.colima/default/docker.sock')))
actor, patient, case, episode = [str(uuid.uuid4()) for _ in range(4)]

def sql(statement, authenticated=False, check=True):
    auth = f"set local role authenticated; set local request.jwt.claim.sub='{actor}'; set local request.jwt.claim.role='authenticated';" if authenticated else ''
    result = subprocess.run(['docker', 'exec', '-i', 'supabase_db_cliniq', 'psql', '-XAtq', '-U', 'supabase_admin', '-d', DB, '-v', 'ON_ERROR_STOP=1'], input=f'begin; {auth} {statement}; commit;', text=True, capture_output=True, env=ENV)
    if check and result.returncode:
        raise RuntimeError(result.stderr)
    return result

def rpc(action, payload):
    encoded = json.dumps(payload).replace("'", "''")
    return f"select public.quality_review_run('{action}','{case}','{episode}','{encoded}'::jsonb)"

def pair(first, second):
    barrier = threading.Barrier(2)
    def execute(statement):
        barrier.wait()
        return sql(statement + '; select pg_sleep(0.2)', True, False)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(execute, text) for text in (first, second)]
        return [future.result() for future in futures]

def data(result):
    return json.loads(next(line for line in result.stdout.splitlines() if line.startswith('{')))

def disposition(review, key):
    return f"select public.quality_review_disposition('{review}','{key}',null,'{{\"status\":\"dismissed\"}}')"

sql(f"""
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('{actor}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','{actor}@synthetic.test','',now(),'{{"provider":"email","providers":["email"]}}','{{}}',now(),now());
insert into patients(id,first_name,last_name,date_of_birth) values('{patient}','Synthetic','Concurrency','1980-01-01');
insert into cases(id,case_number,patient_id,case_status) values('{case}','QC-{case}','{patient}','active');
update care_episodes set id='{episode}' where case_id='{case}'
""")
try:
    results = pair(rpc('begin', {}), rpc('begin', {}))
    assert sorted(r.returncode for r in results) == [0, 3], [r.stderr for r in results]
    run = data(next(r for r in results if not r.returncode))['id']
    print('PASS simultaneous begin: exactly one operation admitted')
    base = dict(run_id=run, findings=[{'key': 'a'}, {'key': 'b'}, {'key': 'c'}], finding_overrides={}, overall_assessment='minor_issues', coverage={'complete': True})
    publication_result, begin_result = pair(rpc('publish', base),rpc('begin', {}))
    assert publication_result.returncode == 0
    review = data(publication_result)['id']
    if begin_result.returncode == 0:
        sql(rpc('fail', {'run_id':data(begin_result)['id']}),True)
    else:
        assert 'already in progress' in begin_result.stderr
    print('PASS begin vs publication: serialized without two active operations')
    results = pair(disposition(review, 'a'), disposition(review, 'b'))
    assert all(not r.returncode for r in results), [r.stderr for r in results]
    overrides = json.loads(sql(f"select finding_overrides from case_quality_reviews where id='{review}'").stdout)
    assert set(overrides) == {'a', 'b'}, overrides
    print('PASS independent concurrent dispositions: both retained')
    run = data(sql(rpc('begin', {}), True))['id']
    updated = sql(f"select updated_at from case_quality_reviews where id='{review}'").stdout.strip()
    publication = {**base, 'run_id':run, 'expected_review_id':review, 'expected_updated_at':updated, 'finding_overrides':overrides}
    published, disposed = pair(rpc('publish', publication), disposition(review, 'c'))
    if disposed.returncode == 0:
        assert data(published).get('conflict') is True
        current = json.loads(sql(f"select finding_overrides from case_quality_reviews where id='{review}'").stdout)
        assert set(current) == {'a', 'b', 'c'}
        sql(rpc('fail', {'run_id': run}), True)
    else:
        assert published.returncode == 0 and 'id' in data(published)
        assert 'Review changed' in disposed.stderr
    print('PASS publication vs disposition: conflict reported without silent loss')
    run = data(sql(rpc('begin', {}), True))['id']
    sql(f"update case_quality_review_runs set lease_expires_at=clock_timestamp()-interval '1 second' where id='{run}'")
    newer = data(sql(rpc('begin', {}), True))['id']
    late = sql(rpc('publish', {**base, 'run_id':run}), True, False)
    assert late.returncode and 'no longer processing' in late.stderr
    assert sql(f"select status from case_quality_review_runs where id='{newer}'").stdout.strip() == 'processing'
    print('PASS expired attempt cannot publish after a replacement begins')
    sql(rpc('fail', {'run_id':newer}), True)
    encounter, note = str(uuid.uuid4()), str(uuid.uuid4())
    sql(f"insert into clinical_encounters(id,case_id,episode_id,encounter_type,status,modality,encounter_date) values('{encounter}','{case}','{episode}','pain_follow_up','in_progress','telehealth','2026-01-02'); insert into pain_follow_up_notes(id,case_id,episode_id,encounter_id,status,subjective) values('{note}','{case}','{episode}','{encounter}','draft','Original synthetic section')")
    version = sql(f"select updated_at from pain_follow_up_notes where id='{note}'").stdout.strip()
    def begin_fix(version):
        return data(sql(rpc('begin', {'kind':'fix','fix_target':{'table':'pain_follow_up_notes','note_id':note,'section':'subjective','updated_at':version}}),True))['id']
    def save_fix(run, version, text):
        patch=json.dumps({'subjective':text})
        return f"select public.quality_review_save_fix('{run}','pain_follow_up_notes','{note}','{version}','{patch}')"
    fix = begin_fix(version)
    saved, competing = pair(save_fix(fix,version,'Updated synthetic section'),rpc('begin',{}))
    assert saved.returncode == 0 and competing.returncode != 0
    assert 'already in progress' in competing.stderr
    sql(rpc('fail',{'run_id':fix}),True)
    print('PASS fix vs review: competing review rejected while fix lease owns episode')
    version = sql(f"select updated_at from pain_follow_up_notes where id='{note}'").stdout.strip()
    fix = begin_fix(version)
    sql(f"update case_quality_review_runs set lease_expires_at=clock_timestamp()-interval '1 second' where id='{fix}'")
    late, replacement = pair(save_fix(fix,version,'Forbidden late write'),rpc('begin',{}))
    assert late.returncode != 0 and 'Fix attempt expired or changed' in late.stderr
    assert replacement.returncode == 0
    assert sql(f"select subjective from pain_follow_up_notes where id='{note}'").stdout.strip() == 'Updated synthetic section'
    sql(rpc('fail',{'run_id':data(replacement)['id']}),True)
    print('PASS expired fix vs replacement: unchanged note version cannot permit late save')
    print('All seven real-session concurrency checks passed')
finally:
    # Retain synthetic rows only inside the disposable DB for failure inspection.
    # Never delete patient/clinical records from an application database.
    print(f'Synthetic case retained in disposable database: {case}')
