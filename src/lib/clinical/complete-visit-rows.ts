/** Never infer absence from a capped or partially failed history query. */
export async function readCompleteVisitRows<T extends { id: string }>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown; count: number | null }>,
): Promise<T[]> {
  const rows: T[] = []
  const seen = new Set<string>()
  let expected: number | null = null
  for (;;) {
    const result = await page(rows.length, rows.length + 499)
    if (result.error || result.data === null || result.count === null) throw new Error('Unable to load complete visit history')
    if (expected !== null && expected !== result.count) throw new Error('Visit history changed while loading. Retry.')
    expected = result.count
    for (const row of result.data) {
      if (seen.has(row.id)) throw new Error('Visit history changed while loading. Retry.')
      seen.add(row.id)
      rows.push(row)
    }
    if (rows.length === expected) return rows
    if (rows.length > expected || result.data.length < 500) throw new Error('Visit history is incomplete. Retry.')
  }
}
