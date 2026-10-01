import type { createClient } from '@/lib/supabase/server'
import { extractionType, summarizeExtractions, type ExtractionEvidence, type ExtractionSummary } from './extraction-summary'

type Client = Awaited<ReturnType<typeof createClient>>
// Read only status evidence. A partial or changing traversal cannot establish a reviewed summary.
export async function loadExtractionSummaries(client: Client, caseId: string, documents: { id: string; document_type: string }[], now = Date.now()) {
  const summaries = new Map<string, ExtractionSummary>()
  const groups = new Map<string, string[]>()
  for (const doc of documents) {
    summaries.set(doc.id, summarizeExtractions(doc.document_type, null, now))
    if (extractionType(doc.document_type)) groups.set(doc.document_type, [...(groups.get(doc.document_type) ?? []), doc.id])
  }
  await Promise.all([...groups].flatMap(([type, ids]) => {
    const chunks: string[][] = []
    for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100))
    return chunks.map(async chunk => {
      const table = extractionType(type)!.table
      const rows: ExtractionEvidence[] = []
      const seen = new Set<string>()
      let expected: number | undefined
      try {
        for (let offset = 0; ; offset += 500) {
          const { data, error, count } = await client.from(table)
            .select('id,document_id,extraction_status,review_status,created_at', { count: 'exact' })
            .eq('case_id', caseId).in('document_id', chunk).is('deleted_at', null)
            .order('created_at', { ascending: true }).order('id', { ascending: true }).range(offset, offset + 499)
          if (error || !data || count === null || !Number.isInteger(count) || count < 0
            || (expected !== undefined && count !== expected) || data.length > 500) return
          expected = count
          for (const row of data) {
            if (!row.id || seen.has(row.id) || !chunk.includes(row.document_id)) return
            seen.add(row.id)
            rows.push(row)
          }
          if (rows.length > expected) return
          if (data.length < 500) {
            if (rows.length !== expected) return
            break
          }
        }
        for (const id of chunk) summaries.set(id, summarizeExtractions(type, rows.filter(r => r.document_id === id), now))
      } catch {
        // Leave every document in this chunk unavailable; refresh retries the complete traversal.
      }
    })
  }))
  return summaries
}
