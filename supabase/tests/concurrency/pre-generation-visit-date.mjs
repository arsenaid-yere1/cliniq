// Uses only local Supabase metadata; optional argv[2] selects a task-owned test DB.
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import pg from 'pg'
// PostgreSQL DATE values are calendar dates, independent of the host timezone.
pg.types.setTypeParser(1082, value => value)
const status = spawnSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8' })
if (status.status !== 0) throw new Error('Local Supabase status unavailable')
const url = new URL(JSON.parse(status.stdout).DB_URL)
assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Local database required')
if (process.argv[2]) {
  assert(/^cliniq_visit_date_test_[a-z0-9_]+$/.test(process.argv[2]), 'Only task-owned test database overrides are allowed')
  url.pathname = '/' + process.argv[2]
}
const options = { connectionString: url.toString(), connectionTimeoutMillis: 10000, statement_timeout: 10000 }
const holder = new pg.Client(options), waiter = new pg.Client(options), monitor = new pg.Client(options)
const actor = randomUUID(), patient = randomUUID(), provider = randomUUID(), caseIds = []
async function authenticate(client) {
  await client.query('begin')
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [actor])
  await client.query("select set_config('request.jwt.claim.role','authenticated',true)")
  await client.query('set local role authenticated')
}
async function waitForBlock(pid) {
  for (let i = 0; i < 100; i++) {
    const row = (await monitor.query('select pg_blocking_pids($1) as p', [pid])).rows[0]
    if (row.p.length) return
    await new Promise(r => setTimeout(r, 20))
  }
  throw new Error('Expected real lock contention was not observed')
}
async function newCase() {
  const id = randomUUID(); caseIds.push(id)
  await monitor.query("insert into public.cases(id,patient_id,case_status,assigned_provider_id) values($1,$2,'active',$3)", [id, patient, provider])
  const eid = (await monitor.query('select id from public.care_episodes where case_id=$1', [id])).rows[0].id
  return [id, eid]
}
const prepare = (client, cid, eid, kind, encounterOnly = false) => client.query('select public.prepare_pre_generation_visit_note($1,$2,$3,$4) as r', [cid,eid,kind,encounterOnly])
const date = (client,cid,eid,kind,expectedId=null,expectedDate=null) => client.query("select public.save_pre_generation_visit_date($1,$2,$3,'2026-09-05',$4,$5) as r", [cid,eid,kind,expectedId,expectedDate])
try {
  await Promise.all([holder.connect(),waiter.connect(),monitor.connect()])
  await monitor.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,'{}')", [actor,`${actor}@test.local`])
  await monitor.query("update public.users set role='admin' where id=$1", [actor])
  await monitor.query("insert into public.provider_profiles(id,user_id,display_name) values($1,$2,'Synthetic date test provider')", [provider,actor])
  await monitor.query("insert into public.patients(id,first_name,last_name,date_of_birth) values($1,'Synthetic','Date concurrency','1980-01-01')",[patient])
  const pid = (await waiter.query('select pg_backend_pid() as pid')).rows[0].pid
  for (const kind of ['initial_visit','pain_evaluation_visit','discharge']) {
    for (const dateFirst of [true,false]) {
      const [cid,eid] = await newCase()
      await authenticate(holder); await authenticate(waiter)
      let initial
      if (dateFirst) initial = (await date(holder,cid,eid,kind)).rows[0].r
      else {
        initial = (await prepare(holder,cid,eid,kind)).rows[0].r
        const table = kind === 'discharge' ? 'discharge_notes' : 'initial_visit_notes'
        const patch = kind === 'discharge' ? 'pain_score_max=4' : `provider_intake='{"preserved":true}'`
        await holder.query(`update public.${table} set ${patch} where id=$1`,[initial.note.id])
      }
      // Catch immediately to avoid unhandled rejection if a regression fails early.
      const pending = (dateFirst ? prepare(waiter,cid,eid,kind) : date(waiter,cid,eid,kind,null,initial.note.visit_date)).then(r=>({r}),error=>({error}))
      await waitForBlock(pid)
      await holder.query('commit')
      const completed = await pending
      if (completed.error) throw completed.error
      await waiter.query('commit')
      const table = kind === 'discharge' ? 'discharge_notes' : 'initial_visit_notes'
      const notes = (await monitor.query(`select n.*, e.encounter_date from public.${table} n join public.clinical_encounters e on e.id=n.encounter_id where n.case_id=$1 and n.deleted_at is null`,[cid])).rows
      assert.equal(notes.length,1)
      assert.equal(notes[0].visit_date,'2026-09-05')
      assert.equal(notes[0].encounter_date,'2026-09-05')
      if (!dateFirst) assert(kind==='discharge' ? notes[0].pain_score_max===4 : notes[0].provider_intake.preserved)
      console.log(`PASS: ${kind}, ${dateFirst?'date first':'intake/vitals first'}, real preparation lock contention`)
    }
  }
  for (const dateFirst of [true,false]) {
    const [cid,eid] = await newCase()
    await authenticate(holder); await authenticate(waiter)
    if (dateFirst) await date(holder,cid,eid,'initial_visit')
    else await prepare(holder,cid,eid,'initial_visit',true)
    const pending=(dateFirst?prepare(waiter,cid,eid,'initial_visit',true):date(waiter,cid,eid,'initial_visit')).then(r=>({r}),error=>({error}))
    await waitForBlock(pid); await holder.query('commit')
    const result=await pending; if(result.error) throw result.error
    await waiter.query('commit')
    assert.equal((await monitor.query('select id from public.clinical_encounters where case_id=$1 and deleted_at is null',[cid])).rowCount,1)
    console.log(`PASS: date / encounter-only preparation, ${dateFirst?'date first':'vitals first'}`)
  }
  // Existing reset and decision operations share note-first row locks.
  for (const operation of ['reset', 'decision', 'legacy-prepare']) {
    for (const dateFirst of [true, false]) {
      const [cid, eid] = await newCase()
      await authenticate(holder)
      const note = (await prepare(holder, cid, eid, 'initial_visit')).rows[0].r.note
      const preview = (await holder.query('select public.preview_clinical_reset($1) as p', [cid])).rows[0].p
      await holder.query('commit')
      const target = preview.notes.find(n => n.id === note.id)
      const request = { case_id: cid, episode_id: eid, case_version: preview.case_version, episode_version: preview.episode_version,
        reactivate: false, reason: 'Synthetic visit date concurrency check', request_key: randomUUID(),
        notes: [{ kind: 'initial_visit_notes', id: note.id, updated_at: target.updated_at }] }
      const other = client => operation === 'reset'
        ? client.query('select public.apply_clinical_reset($1)', [request])
        : operation === 'decision'
          ? client.query('select public.save_visit_note_decision($1,$2,$3,$4,$5,$6)',
            ['initial_visit_notes', note.id, cid, note.updated_at, { treatment_plan: 'Exercise', patient_education: 'Reviewed' }, { decision: 'accepted', details: null }])
          : client.query('select public.prepare_evaluation_visit($1,$2)', [cid, 'initial_visit'])
      await authenticate(holder); await authenticate(waiter)
      if (dateFirst) await date(holder, cid, eid, 'initial_visit', note.id, note.visit_date)
      else await other(holder)
      const pending = (dateFirst ? other(waiter) : date(waiter, cid, eid, 'initial_visit', note.id, note.visit_date))
        .then(r => ({ r }), error => ({ error }))
      await waitForBlock(pid); await holder.query('commit')
      const result = await pending
      if (operation !== 'legacy-prepare' && (dateFirst || operation === 'decision')) {
        assert(result.error, 'Stale reset/decision or reviewed date must be rejected')
        assert(['P0001', '42501'].includes(result.error.code))
        await waiter.query('rollback')
      } else {
        if (result.error) throw result.error
        await waiter.query('commit')
      }
      const saved = (await monitor.query('select n.*,e.encounter_date from public.initial_visit_notes n join public.clinical_encounters e on e.id=n.encounter_id where n.id=$1', [note.id])).rows[0]
      assert.equal(saved.visit_date, saved.encounter_date)
      assert.equal(saved.visit_date, !dateFirst && operation === 'decision' ? note.visit_date : '2026-09-05')
      if (!dateFirst && operation === 'decision') assert.equal(saved.visit_treatment_decision.decision, 'accepted')
      console.log(`PASS: date / ${operation}, ${dateFirst ? 'date first' : 'other operation first'}`)
    }
  }
  // Actual row-version claim must fail after a competing date write commits.
  const [cid,eid]=await newCase()
  await authenticate(holder)
  const n=(await prepare(holder,cid,eid,'initial_visit')).rows[0].r.note
  await holder.query('commit')
  await authenticate(holder); await authenticate(waiter)
  await date(holder,cid,eid,'initial_visit',n.id,n.visit_date)
  const pending=waiter.query("update public.initial_visit_notes set status='generating' where id=$1 and updated_at=$2 and status in ('draft','failed') returning id",[n.id,n.updated_at]).then(r=>({r}),error=>({error}))
  await waitForBlock(pid); await holder.query('commit')
  const result=await pending; if(result.error) throw result.error
  assert.equal(result.r.rowCount,0); await waiter.query('commit')
  // Reverse order: an already-claimed generation rejects date mutation.
  await authenticate(holder); await authenticate(waiter)
  await holder.query("update public.initial_visit_notes set status='generating' where id=$1",[n.id])
  const blocked=date(waiter,cid,eid,'initial_visit',n.id,'2026-09-05').then(r=>({r}),error=>({error}))
  await waitForBlock(pid); await holder.query('commit')
  const rejected=await blocked; assert.equal(rejected.error?.code,'42501'); await waiter.query('rollback')
  console.log('PASS: date / generation claim in both orders; stale generation cannot claim; generating date cannot change')
} catch(error) {
  console.error('FAIL: local concurrency check',error.code ?? error.name, error instanceof assert.AssertionError ? error.message : '')
  process.exitCode=1
} finally {
  await Promise.allSettled([holder.query('rollback'),waiter.query('rollback')])
  try {
    // Delete only UUIDs allocated by this invocation, in referential order.
    await monitor.query('begin')
    await monitor.query('delete from public.clinical_note_revisions where case_id=any($1::uuid[])',[caseIds])
    await monitor.query('delete from public.clinical_reset_operations where case_id=any($1::uuid[])',[caseIds])
    await monitor.query('delete from public.initial_visit_notes where case_id=any($1::uuid[])',[caseIds])
    await monitor.query('delete from public.discharge_notes where case_id=any($1::uuid[])',[caseIds])
    await monitor.query('delete from public.clinical_encounters where case_id=any($1::uuid[])',[caseIds])
    await monitor.query('delete from public.care_episodes where case_id=any($1::uuid[])',[caseIds])
    await monitor.query('delete from public.case_status_history where case_id=any($1::uuid[])',[caseIds])
    await monitor.query('delete from public.cases where id=any($1::uuid[])',[caseIds])
    await monitor.query('delete from public.patients where id=$1',[patient])
    await monitor.query('delete from public.provider_profiles where id=$1',[provider])
    await monitor.query('delete from public.users where id=$1',[actor])
    await monitor.query('delete from auth.users where id=$1',[actor])
    await monitor.query('commit')
  } catch { await monitor.query('rollback').catch(()=>{}); console.error('Fixture cleanup failed'); process.exitCode=1 }
  await Promise.allSettled([holder.end(),waiter.end(),monitor.end()])
}
