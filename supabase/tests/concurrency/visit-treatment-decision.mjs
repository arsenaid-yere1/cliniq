// Run only on a disposable schema-only branch after applying migrations.
// Usage: NODE_PATH=/tmp/cliniq-verify-pg/node_modules node <this-file> <branch-connection.json>
// The JSON is the private output of `supabase branches get <branch> -o json`.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
const { Client } = createRequire(import.meta.url)('pg')
const connection = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const linkedRef = readFileSync('supabase/.temp/project-ref', 'utf8').trim()
assert(!connection.SUPABASE_URL.includes(linkedRef), 'Never run against the linked clinic project')
const options = { connectionString: connection.POSTGRES_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, statement_timeout: 15000 }
const holder = new Client(options), waiter = new Client(options), monitor = new Client(options)
try {
  await Promise.all([holder.connect(), waiter.connect(), monitor.connect()])
  const [actor, patient, caseId, encounter, noteId] = Array.from({ length: 5 }, randomUUID)
  await holder.query('begin')
  await holder.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,'{}')", [actor, `${actor}@test.local`])
  await holder.query("update public.users set role='admin',is_active=true where id=$1", [actor])
  await holder.query("insert into public.patients(id,first_name,last_name,date_of_birth) values($1,'Concurrency','Fixture','1980-01-01')", [patient])
  await holder.query("insert into public.cases(id,patient_id,case_status) values($1,$2,'active')", [caseId, patient])
  const episode = (await holder.query('select id from public.care_episodes where case_id=$1', [caseId])).rows[0].id
  await holder.query("insert into public.clinical_encounters(id,case_id,episode_id,encounter_type,status,encounter_date) values($1,$2,$3,'initial_evaluation','in_progress','2026-09-10')", [encounter, caseId, episode])
  await holder.query("insert into public.initial_visit_notes(id,case_id,episode_id,encounter_id,status,treatment_plan,patient_education) values($1,$2,$3,$4,'draft','Exercise','Exercise reviewed')", [noteId, caseId, episode, encounter])
  await holder.query('commit')
  const authenticate = async (client) => {
    await client.query('begin')
    await client.query("select set_config('request.jwt.claim.sub',$1,true)", [actor])
    await client.query("select set_config('request.jwt.claim.role','authenticated',true)")
    await client.query('set local role authenticated')
  }
  await authenticate(holder)
  const preview = (await holder.query('select public.preview_clinical_reset($1) as p', [caseId])).rows[0].p
  const target = preview.notes.find((note) => note.id === noteId)
  const request = { case_id: caseId, episode_id: episode, case_version: preview.case_version, episode_version: preview.episode_version, reactivate: false, reason: 'Isolated concurrency verification', request_key: randomUUID(), notes: [{ kind: 'initial_visit_notes', id: noteId, updated_at: target.updated_at }] }
  assert.equal((await holder.query('select id from public.initial_visit_notes where id=$1 for update', [noteId])).rowCount, 1)
  await authenticate(waiter)
  const waiterPid = (await waiter.query('select pg_backend_pid() as pid')).rows[0].pid
  const resetResult = waiter.query('select public.apply_clinical_reset($1)', [request]).then(() => null, (error) => error)
  let observedLock = false
  for (let i = 0; i < 40; i++) {
    const state = (await monitor.query('select pg_blocking_pids($1) as blockers', [waiterPid])).rows[0]
    if (state?.blockers.length > 0) { observedLock = true; break }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  if (!observedLock) {
    const early = await Promise.race([resetResult, new Promise((resolve) => setTimeout(() => resolve(null), 100))])
    if (early) console.error('Reset rejected before lock:', early.message)
  }
  assert(observedLock, 'Second connection must actually contend on the note lock')
  await holder.query('select public.save_visit_note_decision($1,$2,$3,$4,$5,$6)', ['initial_visit_notes', noteId, caseId, target.updated_at, { treatment_plan: 'Exercise', patient_education: 'Exercise reviewed' }, { decision: 'accepted', details: null }])
  await holder.query('commit')
  const resetError = await resetResult
  assert(resetError && /changed/i.test(resetError.message), 'Stale reset must fail after the save commits')
  await waiter.query('rollback')
  const saved = (await monitor.query('select status,visit_treatment_decision,patient_education from public.initial_visit_notes where id=$1', [noteId])).rows[0]
  assert.equal(saved.status, 'draft')
  assert.equal(saved.visit_treatment_decision.decision, 'accepted')
  assert.match(saved.patient_education, /The patient agreed to the treatment plan discussed at this visit/)
  console.log('PASS: observed real save/reset lock contention; save committed; stale reset rejected; reviewed decision and narrative retained.')
} catch (error) {
  // Do not print connection strings or raw PostgreSQL errors containing credentials.
  console.error('Concurrency verification failed:', error.code ?? error.name, error instanceof assert.AssertionError ? error.message : '')
  process.exitCode = 1
} finally {
  await Promise.allSettled([holder.end(), waiter.end(), monitor.end()])
}
