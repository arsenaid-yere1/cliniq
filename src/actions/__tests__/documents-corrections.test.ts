import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockQueryBuilder, createMockSupabase, type MockSupabaseClient } from '@/test-utils/supabase-mock'

let mockSupabase: MockSupabaseClient

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(() => mockSupabase) }))

import { removeDocument } from '../documents'

describe('removeDocument discharge correction retention', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'documents') {
        return createMockQueryBuilder({ data: { case_id: 'case-id' }, error: null })
      }
      if (table === 'discharge_note_corrections') {
        return createMockQueryBuilder({ data: [{ id: 'correction-id' }], error: null })
      }
      return createMockQueryBuilder()
    })
  })

  it('does not remove a document retained by discharge correction history', async () => {
    const result = await removeDocument('document-id')
    expect(result).toEqual({
      error: 'Discharge correction documents are retained for audit and cannot be removed.',
    })
    expect(mockSupabase.from).not.toHaveBeenCalledWith('chiro_extractions')
  })
})
