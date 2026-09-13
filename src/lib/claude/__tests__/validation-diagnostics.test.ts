import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { validateVisitDecisionOutput } from '../visit-decision-output'
import { collectValidationDiagnostics, MAX_DIAGNOSTICS_BYTES, serializeValidationFailure } from '../validation-diagnostics'

describe('validation diagnostics', () => {
  it('centers original excerpts on a late match', () => {
    const raw = { imaging_findings: 'Background '.repeat(200) + 'the patient accepted treatment.' }
    const result = validateVisitDecisionOutput(raw)
    if (result.success) throw new Error('Expected rejection')
    const [issue] = collectValidationDiagnostics(result.error, raw)
    expect(issue.excerpt).toContain('patient accepted')
    expect(issue.excerpt!.length).toBeLessThanOrEqual(1000)
    expect(raw.imaging_findings.slice(issue.matchStart!, issue.matchEnd!)).toBe('patient accepted')
    expect(issue.truncated).toBe(true)
  })
  it('bounds the escaped UTF-8 payload without mutating the input', () => {
    const issues = Array.from({ length: 5 }, () => ({
      code: 'custom', path: ['imaging_findings'], rule: 'current_decision',
      excerpt: '\u0001界'.repeat(500), excerptStart: 0, matchStart: 900, matchEnd: 950, truncated: false,
    }))
    const failure = { failureOrdinal: 1, validationAttempt: 1, model: 'test', issues }
    const before = JSON.stringify(failure)
    const serialized = serializeValidationFailure(failure)
    expect(new TextEncoder().encode(serialized).length).toBeLessThanOrEqual(MAX_DIAGNOSTICS_BYTES)
    expect(JSON.stringify(failure)).toBe(before)
    expect(JSON.parse(serialized).issues.some((issue: { truncated: boolean }) => issue.truncated)).toBe(true)
  })
  it('does not include arbitrary Zod messages or raw values', () => {
    const error = new z.ZodError([{ code: 'custom', path: ['value'], message: 'SENSITIVE' }])
    expect(JSON.stringify(collectValidationDiagnostics(error, { value: 'SENSITIVE' }))).not.toContain('SENSITIVE')
  })
})

it('does not cut an emoji into an invalid JSONB surrogate', () => {
  const raw = { imaging_findings: '🙂'.repeat(800) + 'the patient accepted treatment.' + '🙂'.repeat(800) }
  const parsed = validateVisitDecisionOutput(raw)
  if (parsed.success) throw new Error('Expected rejection')
  const [issue] = collectValidationDiagnostics(parsed.error, raw)
  expect(issue.excerpt).toContain('patient accepted')
  expect(JSON.stringify(issue.excerpt)).not.toMatch(/\\u[dD][89a-fA-F][0-9a-fA-F]{2}/)
  expect(raw.imaging_findings.slice(issue.excerptStart!, issue.excerptStart! + issue.excerpt!.length)).toBe(issue.excerpt)
})
