import { vi, type Mock } from 'vitest'

type QueryResult = { data: unknown; error: unknown }

/**
 * Creates a chainable mock that mimics the Supabase query builder.
 * By default, every chain resolves to { data: null, error: null }.
 * Override specific terminal calls in your tests.
 */
export function createMockQueryBuilder(defaultResult: QueryResult = { data: null, error: null }) {
  const chainMethods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
    'like', 'ilike', 'is', 'in', 'or', 'not',
    'order', 'limit', 'range',
  ] as const

  const terminalMethods = ['single', 'maybeSingle'] as const

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: Record<string, any> = {}

  // Terminal methods resolve the promise
  for (const method of terminalMethods) {
    builder[method] = vi.fn().mockResolvedValue(defaultResult)
  }

  // Chain methods return the builder itself
  for (const method of chainMethods) {
    builder[method] = vi.fn().mockReturnValue(builder)
  }

  // Make the builder itself thenable so `await supabase.from('x').select('*').eq(...)` works
  // without a terminal .single() / .maybeSingle()
  builder.then = (resolve: (value: QueryResult) => void) => {
    resolve(defaultResult)
    return builder
  }

  return builder
}

export type MockSupabaseClient = ReturnType<typeof createMockSupabase>

export function createMockSupabase(defaultResult: QueryResult = { data: null, error: null }) {
  const queryBuilder = createMockQueryBuilder(defaultResult)

  const client = {
    from: vi.fn().mockReturnValue(queryBuilder),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'test-user-id' } },
        error: null,
      }) as Mock,
    },
    // Escape hatch: access the underlying query builder to override returns per-test
    _builder: queryBuilder,
  }

  return client
}

/**
 * Configures the mock to return different results based on which table is queried.
 * Call this in beforeEach to set up per-table responses.
 *
 * Usage:
 *   mockTableResults(mockSupabase, {
 *     cases: { data: { case_status: 'active' }, error: null },
 *     discharge_notes: { data: { id: '123' }, error: null },
 *   })
 */
export function mockTableResults(
  client: MockSupabaseClient,
  tableResults: Record<string, QueryResult>,
) {
  client.from.mockImplementation((table: string) => {
    const result = tableResults[table] ?? { data: null, error: null }
    return createMockQueryBuilder(result)
  })
}
