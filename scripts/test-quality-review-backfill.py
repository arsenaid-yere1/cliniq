"""Exercise the exact migration backfill in a rolled-back disposable transaction."""
import os
from pathlib import Path
import subprocess
import sys
import uuid

name=sys.argv[1] if len(sys.argv)==2 else ''
if not name.startswith('cliniq_qc_test_') or not name.replace('_','').isalnum():
    sys.exit('Provide a disposable cliniq_qc_test_* database name')
actor,patient=str(uuid.uuid4()),str(uuid.uuid4())
statements=["begin; create extension if not exists pgtap with schema extensions; set local search_path=public,extensions; select plan(6);",
 f"insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values('{actor}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','{actor}@synthetic.test','{{}}','{{}}');",
 f"insert into patients(id,first_name,last_name,date_of_birth) values('{patient}','Synthetic','Backfill','1980-01-01');"]
checks=[]
for status in ['failed','processing','pending','completed']:
    case=str(uuid.uuid4())
    statements.append(f"insert into cases(id,patient_id,case_number,case_status) values('{case}','{patient}','QC-{case}','active');")
    if status in ['failed','processing']:
        # Both historical rows share generated_at; created_at breaks the tie.
        statements.append(f"insert into case_quality_reviews(case_id,episode_id,generation_status,summary,generated_at,created_at,deleted_at) select '{case}',id,'completed','older','2026-01-01','2026-01-01',now() from care_episodes where case_id='{case}';")
        statements.append(f"insert into case_quality_reviews(case_id,episode_id,generation_status,summary,generated_at,created_at,deleted_at) select '{case}',id,'completed','latest eligible','2026-01-01','2026-01-02',now() from care_episodes where case_id='{case}';")
    statements.append(f"insert into case_quality_reviews(case_id,episode_id,generation_status,summary,created_by_user_id) select '{case}',id,'{status}','current','{actor}' from care_episodes where case_id='{case}';")
    if status in ['failed','processing']:
        checks.append(f"select is((select summary from case_quality_reviews where case_id='{case}' and deleted_at is null),'latest eligible','{status} restores latest completed review in same episode');")
    elif status=='pending':
        checks.append(f"select is((select count(*)::int from case_quality_reviews where case_id='{case}' and deleted_at is null),0,'first pending attempt does not manufacture a success');")
    else:
        checks.append(f"select is((select summary from case_quality_reviews where case_id='{case}' and deleted_at is null),'current','existing completed review remains current');")
migration=Path('supabase/migrations/20260916232155_quality_review_runs.sql').read_text()
start=migration.index('do $$ declare item')
end=migration.index('end $$;',start)+len('end $$;')
statements.append(migration[start:end])
checks.extend([f"select is((select count(*)::int from case_quality_review_runs where actor_user_id='{actor}' and error_category='legacy_attempt'),3,'failed and unfinished attempt metadata retained');",
 f"select is((select count(*)::int from case_quality_reviews where created_by_user_id='{actor}'),4,'all original current rows retained');"])
statements.extend(checks+["select * from finish(); rollback;"])
result=subprocess.run(['docker','exec','-i','supabase_db_cliniq','psql','-XAtq','-U','supabase_admin','-d',name,'-v','ON_ERROR_STOP=1'],input='\n'.join(statements),text=True,capture_output=True,env=dict(os.environ,DOCKER_HOST=os.environ.get('DOCKER_HOST','unix://'+os.path.expanduser('~/.colima/default/docker.sock'))))
print(result.stdout)
if result.returncode or 'not ok' in result.stdout:
    print(result.stderr)
    sys.exit(1)
