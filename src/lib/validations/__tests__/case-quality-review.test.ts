import { describe, it, expect } from 'vitest'
import {
  qualityReviewResultSchema,
  qualityFindingSchema,
  findingOverrideEntrySchema,
  findingOverridesMapSchema,
  findingEditFormSchema,
  findingDismissFormSchema,
  computeFindingHash,
  qcSeverityValues,
  qcStepValues,
  type QualityFinding,
} from '../case-quality-review'

// RFC 4122 v4 UUIDs (zod v4 enforces version + variant bits).
const VALID_NOTE_ID = '11111111-1111-4111-8111-111111111111'
const VALID_PROC_ID = '22222222-2222-4222-8222-222222222222'
const VALID_USER_ID = '33333333-3333-4333-8333-333333333333'

function makeFinding(overrides: Partial<QualityFinding> = {}): QualityFinding {
  return {
    severity: 'warning',
    step: 'discharge',
    note_id: VALID_NOTE_ID,
    procedure_id: null,
    section_key: 'subjective',
    message: 'Pain trajectory drift detected',
    rationale: 'subjective cites 4/10 but trajectory shows 5/10',
    suggested_tone_hint: 'Cite the exact discharge value from objective_vitals',
    ...overrides,
  }
}

describe('qualityReviewResultSchema', () => {
  it('accepts a clean review with empty findings', () => {
    const result = qualityReviewResultSchema.safeParse({
      findings: [],
      summary: null,
      overall_assessment: 'clean',
    })
    expect(result.success).toBe(true)
  })

  it('accepts findings spanning all severity values', () => {
    const findings = qcSeverityValues.map((sev) => makeFinding({ severity: sev }))
    const result = qualityReviewResultSchema.safeParse({
      findings,
      summary: 'Multiple severity levels present',
      overall_assessment: 'major_issues',
    })
    expect(result.success).toBe(true)
  })

  it('accepts findings spanning all step values', () => {
    const findings = qcStepValues.map((step) =>
      makeFinding({
        step,
        note_id: step === 'cross_step' ? null : VALID_NOTE_ID,
        procedure_id: step === 'procedure' ? VALID_PROC_ID : null,
      }),
    )
    const result = qualityReviewResultSchema.safeParse({
      findings,
      summary: null,
      overall_assessment: 'minor_issues',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid severity', () => {
    const result = qualityFindingSchema.safeParse(
      makeFinding({ severity: 'fatal' as unknown as QualityFinding['severity'] }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects invalid step', () => {
    const result = qualityFindingSchema.safeParse(
      makeFinding({ step: 'random' as unknown as QualityFinding['step'] }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects non-uuid note_id', () => {
    const result = qualityFindingSchema.safeParse(makeFinding({ note_id: 'not-a-uuid' }))
    expect(result.success).toBe(false)
  })

  it('accepts null note_id (cross_step finding)', () => {
    const result = qualityFindingSchema.safeParse(makeFinding({ note_id: null }))
    expect(result.success).toBe(true)
  })

  it('rejects empty message', () => {
    const result = qualityFindingSchema.safeParse(makeFinding({ message: '' }))
    expect(result.success).toBe(false)
  })

  it('rejects invalid overall_assessment', () => {
    const result = qualityReviewResultSchema.safeParse({
      findings: [],
      summary: null,
      overall_assessment: 'fine',
    })
    expect(result.success).toBe(false)
  })
})

describe('findingOverrideEntrySchema', () => {
  const validEntry = {
    status: 'acknowledged' as const,
    dismissed_reason: null,
    edited_message: null,
    edited_rationale: null,
    edited_suggested_tone_hint: null,
    actor_user_id: VALID_USER_ID,
    set_at: '2026-04-29T12:00:00Z',
  }

  it('accepts all 3 status values', () => {
    for (const status of ['acknowledged', 'dismissed', 'edited'] as const) {
      const result = findingOverrideEntrySchema.safeParse({ ...validEntry, status })
      expect(result.success).toBe(true)
    }
  })

  it("rejects 'pending' status (sentinel = absence of entry)", () => {
    const result = findingOverrideEntrySchema.safeParse({
      ...validEntry,
      status: 'pending' as unknown as 'acknowledged',
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-uuid actor_user_id', () => {
    const result = findingOverrideEntrySchema.safeParse({
      ...validEntry,
      actor_user_id: 'nope',
    })
    expect(result.success).toBe(false)
  })

  it("accepts 'resolved' status with resolved_at + resolution_source", () => {
    const result = findingOverrideEntrySchema.safeParse({
      ...validEntry,
      status: 'resolved',
      resolved_at: '2026-04-30T12:01:00Z',
      resolution_source: 'auto_recheck',
    })
    expect(result.success).toBe(true)
  })

  it('parses entry without resolved_at / resolution_source as null defaults (backward-compat)', () => {
    const result = findingOverrideEntrySchema.safeParse({
      status: 'acknowledged',
      dismissed_reason: null,
      edited_message: null,
      edited_rationale: null,
      edited_suggested_tone_hint: null,
      actor_user_id: VALID_USER_ID,
      set_at: '2026-04-30T12:00:00Z',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.resolved_at).toBeNull()
      expect(result.data.resolution_source).toBeNull()
    }
  })

  it('rejects invalid resolution_source', () => {
    const result = findingOverrideEntrySchema.safeParse({
      ...validEntry,
      status: 'resolved',
      resolved_at: '2026-04-30T12:01:00Z',
      resolution_source: 'wat',
    })
    expect(result.success).toBe(false)
  })

  it('accepts all 3 resolution_source values', () => {
    for (const source of ['auto_recheck', 'manual_verify', 'manual_resolve'] as const) {
      const result = findingOverrideEntrySchema.safeParse({
        ...validEntry,
        status: 'resolved',
        resolved_at: '2026-04-30T12:01:00Z',
        resolution_source: source,
      })
      expect(result.success).toBe(true)
    }
  })
})

describe('findingOverridesMapSchema', () => {
  it('accepts empty map', () => {
    const result = findingOverridesMapSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('accepts multiple entries keyed by hash', () => {
    const entry = {
      status: 'acknowledged' as const,
      dismissed_reason: null,
      edited_message: null,
      edited_rationale: null,
      edited_suggested_tone_hint: null,
      actor_user_id: VALID_USER_ID,
      set_at: '2026-04-29T12:00:00Z',
    }
    const result = findingOverridesMapSchema.safeParse({
      hashA: entry,
      hashB: { ...entry, status: 'dismissed' as const, dismissed_reason: 'false positive' },
    })
    expect(result.success).toBe(true)
  })

  it('rejects entries missing required fields', () => {
    const result = findingOverridesMapSchema.safeParse({
      hashA: { status: 'acknowledged' },
    })
    expect(result.success).toBe(false)
  })
})

describe('findingEditFormSchema', () => {
  it('rejects empty edited_message', () => {
    const result = findingEditFormSchema.safeParse({
      edited_message: '',
      edited_rationale: null,
      edited_suggested_tone_hint: null,
    })
    expect(result.success).toBe(false)
  })

  it('accepts populated message with null rationale and tone hint', () => {
    const result = findingEditFormSchema.safeParse({
      edited_message: 'Provider rewrite',
      edited_rationale: null,
      edited_suggested_tone_hint: null,
    })
    expect(result.success).toBe(true)
  })
})

describe('findingDismissFormSchema', () => {
  it('accepts null reason', () => {
    const result = findingDismissFormSchema.safeParse({ dismissed_reason: null })
    expect(result.success).toBe(true)
  })

  it('accepts populated reason', () => {
    const result = findingDismissFormSchema.safeParse({
      dismissed_reason: 'False positive — provider intentionally omitted',
    })
    expect(result.success).toBe(true)
  })
})

describe('computeFindingHash', () => {
  it('produces identical hashes for identical input', () => {
    const f = makeFinding()
    expect(computeFindingHash(f)).toBe(computeFindingHash(f))
  })

  it('produces different hashes when message changes', () => {
    const a = makeFinding({ message: 'A' })
    const b = makeFinding({ message: 'B' })
    expect(computeFindingHash(a)).not.toBe(computeFindingHash(b))
  })

  it('treats null and absent fields consistently (collapsed to empty string)', () => {
    const a = makeFinding({ note_id: null, procedure_id: null, section_key: null })
    const hash = computeFindingHash(a)
    // SHA-256 hex is 64 chars
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic across multiple calls', () => {
    const f = makeFinding()
    const hashes = Array.from({ length: 5 }, () => computeFindingHash(f))
    expect(new Set(hashes).size).toBe(1)
  })
})
