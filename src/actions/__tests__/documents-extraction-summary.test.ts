import { beforeEach, expect, it, vi } from 'vitest'
import { createMockQueryBuilder, createMockSupabase } from '@/test-utils/supabase-mock'
import { loadExtractionSummaries } from '@/lib/documents/load-extraction-summaries'
import { EXTRACTION_TYPES } from '@/lib/documents/extraction-summary'
import type { createClient } from '@/lib/supabase/server'
let client = createMockSupabase()
vi.mock('@/lib/supabase/server', () => ({ createClient: () => client }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { listDocuments } from '../documents'
const doc = { id: 'doc', document_type: 'mri_report' }
const evidence = (i: number) => ({ id: `row-${i}`, document_id: 'doc', extraction_status: 'completed', review_status: 'approved', created_at: '2026-09-30T00:00:00Z' })
let pages: ReturnType<typeof createMockQueryBuilder>[]
let rows: ReturnType<typeof evidence>[]
let mutate: (offset: number, result: { data: typeof rows; error: unknown; count: number | null }) => void
beforeEach(() => {
  client = createMockSupabase(); pages = []; rows = []; mutate = () => {}
  client.from.mockImplementation(table => {
    if (table === 'documents') return createMockQueryBuilder({ data: [doc], error: null })
    const builder = createMockQueryBuilder()
    builder.range.mockImplementation((offset: number, end: number) => {
      const result = { data: rows.slice(offset,end + 1), error: null as unknown, count: rows.length as number | null }
      mutate(offset,result)
      return Promise.resolve(result)
    })
    pages.push(builder)
    return builder
  })
})
const load = (docs = [doc]) => loadExtractionSummaries(client as unknown as Awaited<ReturnType<typeof createClient>>, 'case', docs)
it.each([0, 500, 1000, 1201])('traverses %i rows to a terminal page, including late failed findings', async count => {
  rows = Array.from({ length: count }, (_,i) => evidence(i))
  if (count > 1000) rows[count - 1].extraction_status = 'failed'
  const result = (await load()).get('doc')!
  expect(result.total).toBe(count)
  expect(result.kind).toBe(count > 1000 ? 'failed' : count ? 'reviewed' : 'unconfirmed')
  expect(pages).toHaveLength(Math.floor(count / 500) + 1)
  for (const query of pages) {
    expect(query.is).toHaveBeenCalledWith('deleted_at', null)
    expect(query.order.mock.calls).toEqual([['created_at',{ ascending: true }],['id',{ ascending: true }]])
  }
})
it.each(['error','count','duplicate','missing','truncated','unexpected','null-count'])('rejects incomplete traversal: %s', async failure => {
  rows = Array.from({ length: 1001 }, (_,i) => evidence(i))
  mutate = (offset,result) => {
    if (offset !== 500) return
    if (failure === 'error') result.error = { message: 'offline' }
    if (failure === 'count') result.count = 1000
    if (failure === 'duplicate') result.data[0] = evidence(0)
    if (failure === 'missing') result.data[0] = { ...evidence(500), id: '' }
    if (failure === 'truncated') result.data = result.data.slice(0,10)
    if (failure === 'unexpected') result.data[0] = { ...evidence(500), document_id: 'other' }
    if (failure === 'null-count') result.count = null
  }
  expect((await load()).get('doc')).toMatchObject({ kind: 'unavailable', canOpen: false, total: 0 })
})
it('requires a terminal request even after an exact multiple of 500', async () => {
  rows = Array.from({ length: 1000 }, (_,i) => evidence(i))
  mutate = (offset,result) => { if (offset === 1000) result.error = { message: 'terminal request failed' } }
  expect((await load()).get('doc')?.kind).toBe('unavailable')
})
it('finds unreviewed regions beyond row 1000', async () => {
  rows = Array.from({ length: 1100 }, (_,i) => evidence(i)); rows[1099].review_status = 'pending_review'
  expect((await load()).get('doc')).toMatchObject({ kind: 'review', awaitingReview: 1, reviewed: 1099 })
})
it('chunks document filters at 100 and queries all supported tables', async () => {
  const docs = Object.keys(EXTRACTION_TYPES).flatMap(type => Array.from({ length: 101 }, (_,i) => ({ id: `${type}-${i}`, document_type: type })))
  await load(docs)
  expect(pages).toHaveLength(14)
  expect(pages.every(p => p.in.mock.calls[0][1].length <= 100)).toBe(true)
  for (const { table } of Object.values(EXTRACTION_TYPES)) expect(client.from).toHaveBeenCalledWith(table)
})
it('attaches evidence on the no-generated-documents early return', async () => {
  rows = [evidence(0)]
  const result = await listDocuments('case')
  expect(result.data[0]).toMatchObject({ id: 'doc', extraction_summary: { kind: 'reviewed', total: 1 }, revision_status: null })
})
