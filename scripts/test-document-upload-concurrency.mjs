// Synthetic fixtures only, in the isolated local database used by the SQL suite.
import pg from 'pg'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
const connectionString = process.env.UPLOAD_TEST_DATABASE_URL
if (!connectionString) throw new Error('Set UPLOAD_TEST_DATABASE_URL to an isolated local test database')
const url = new URL(connectionString)
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.includes('_test_')) throw new Error('Local isolated test database required')
const connect = async () => { const c = new pg.Client({ connectionString }); await c.connect(); return c }
const setup = await connect()
const actor = randomUUID(), patient = randomUUID()
await setup.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,'{}')", [actor, `upload-${actor}@test.local`])
await setup.query("insert into public.patients(id,first_name,last_name,date_of_birth) values($1,'Synthetic','UploadRace','1980-01-01')", [patient])
async function newCase() {
  const id = randomUUID()
  await setup.query("insert into public.cases(id,patient_id,case_status) values($1,$2,'intake')", [id, patient])
  return id
}
async function register(c, caseId, id) {
  await c.query('begin')
  await c.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)", [actor])
  await c.query('set local role authenticated')
  try {
    const r = await c.query("select * from public.register_uploaded_document($1,$2,'other','race.pdf',$3,10,'application/pdf')", [id, caseId, `cases/${caseId}/${id}-race.pdf`])
    await c.query('select pg_sleep(0.15)') // hold the winning locks until the other connection is waiting
    await c.query('commit')
    return r.rows[0]
  } catch (e) { await c.query('rollback'); throw e }
}
const a = await connect(), b = await connect()
try {
  const case1 = await newCase(), same = randomUUID()
  const sameResults = await Promise.all([register(a,case1,same),register(b,case1,same)])
  assert.deepEqual(sameResults.map(r => r.created).sort(), [false,true])
  const case2 = await newCase()
  assert.ok((await Promise.all([register(a,case2,randomUUID()),register(b,case2,randomUUID())])).every(r => r.created))
  for (const c of [case1,case2]) {
    const r = await setup.query("select count(*)::int as count from public.case_status_history where case_id=$1 and previous_status='intake'", [c])
    assert.equal(r.rows[0].count, 1)
  }
  const case3 = await newCase(), case4 = await newCase(), collision = randomUUID()
  const conflicts = await Promise.allSettled([register(a,case3,collision),register(b,case4,collision)])
  assert.equal(conflicts.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(conflicts.find(r => r.status === 'rejected').reason.code, '23505')
  const r = await setup.query('select count(*)::int as count from public.documents where id=$1', [collision])
  assert.equal(r.rows[0].count, 1)
  console.log('PASS: same-ID replay race, distinct-document intake race, cross-case identity conflict')
} finally { await Promise.all([a.end(),b.end(),setup.end()]) }
