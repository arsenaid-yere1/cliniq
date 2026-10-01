// An isolated local Storage stack, started from /tmp/cliniq-upload-storage.
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const log = await readFile('/tmp/cliniq-upload-storage-start.log', 'utf8')
const config = JSON.parse(log.split('\n').find(line => line.startsWith('{"DB_URL"')))
assert.equal(config.API_URL, 'http://127.0.0.1:55421')
const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const client = createClient(config.API_URL, config.ANON_KEY, { auth: { persistSession: false } })
const email = `synthetic-${randomUUID()}@test.local`, password = randomUUID()
const { data: created, error: userError } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
assert.equal(userError, null)
const { data: sessionData, error: signInError } = await client.auth.signInWithPassword({ email, password })
assert.equal(signInError, null)
process.env.NEXT_PUBLIC_SUPABASE_URL = config.API_URL
const source = await readFile(new URL('../src/lib/tus-upload.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source.replace("'tus-js-client'", JSON.stringify(pathToFileURL(require.resolve('tus-js-client')).href)), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { createTusUpload } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const storage = client.storage.from('case-documents')
const path = `cases/${randomUUID()}/${randomUUID()}-synthetic.pdf`
try {
  const missing = await storage.info(path)
  assert.ok(missing.error)
  console.log('Missing object:', JSON.stringify({ status: missing.error.status, statusCode: missing.error.statusCode, code: missing.error.code }))
  // Buffer is the Node TUS file source; use the same MIME property as the browser File.
  const file = Buffer.from('%PDF-1.4\nSynthetic upload recovery fixture\n%%EOF')
  file.type = 'application/pdf'
  await new Promise((resolve, reject) => createTusUpload({ file, storagePath: path, accessToken: sessionData.session.access_token, onSuccess: resolve, onError: reject }).start())
  // Treat the transfer acknowledgement as lost: recovery reads exact-path metadata, no second transfer.
  const complete = await storage.info(path)
  assert.equal(complete.error, null)
  assert.equal(complete.data.size, file.length)
  assert.equal(complete.data.contentType, file.type)
  const duplicate = await storage.upload(path, file, { contentType: file.type, upsert: false })
  assert.ok(duplicate.error)
  const after = await storage.info(path)
  assert.equal(after.data.id, complete.data.id)
  console.log('PASS: TUS upload, lost-acknowledgement reconciliation, exact size/MIME, no-upsert collision preserves original')
} finally {
  await storage.remove([path])
  await admin.auth.admin.deleteUser(created.user.id)
}
