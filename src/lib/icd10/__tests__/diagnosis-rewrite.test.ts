import { describe, expect, it } from 'vitest'
import {
  rewriteDiagnosesForProcedure,
  rewriteDiagnosesForDischarge,
  type DiagnosisItem,
} from '../diagnosis-rewrite'

const dx = (icd10_code: string, description: string): DiagnosisItem => ({
  icd10_code,
  description,
})

describe('rewriteDiagnosesForProcedure', () => {
  it('procedure_number=1 strips V/W/X/Y but keeps A-suffix (intake encounter)', () => {
    const input = [
      dx('S13.4XXA', 'Sprain of ligaments of cervical spine, initial encounter'),
      dx('V43.52XA', 'Car occupant injured in collision, initial encounter'),
      dx('M54.50', 'Low back pain, unspecified'),
    ]
    const out = rewriteDiagnosesForProcedure(input, { procedureNumber: 1 })
    expect(out).toEqual([
      dx('S13.4XXA', 'Sprain of ligaments of cervical spine, initial encounter'),
      dx('M54.50', 'Low back pain, unspecified'),
    ])
  })

  it('procedure_number=2 strips V/W and rewrites A → D + description', () => {
    const input = [
      dx('S13.4XXA', 'Sprain of ligaments of cervical spine, initial encounter'),
      dx('V43.52XA', 'Car occupant injured in collision, initial encounter'),
      dx('M54.50', 'Low back pain, unspecified'),
    ]
    const out = rewriteDiagnosesForProcedure(input, { procedureNumber: 2 })
    expect(out).toEqual([
      dx('S13.4XXD', 'Sprain of ligaments of cervical spine, subsequent encounter'),
      dx('M54.50', 'Low back pain, unspecified'),
    ])
  })

  it('procedure_number=3 rewrites multiple A-suffix codes', () => {
    const input = [
      dx('S13.4XXA', 'Sprain of ligaments of cervical spine, initial encounter'),
      dx('S33.5XXA', 'Sprain of ligaments of lumbar spine, initial encounter'),
      dx('M50.20', 'Other cervical disc displacement, unspecified level'),
    ]
    const out = rewriteDiagnosesForProcedure(input, { procedureNumber: 3 })
    expect(out).toEqual([
      dx('S13.4XXD', 'Sprain of ligaments of cervical spine, subsequent encounter'),
      dx('S33.5XXD', 'Sprain of ligaments of lumbar spine, subsequent encounter'),
      dx('M50.20', 'Other cervical disc displacement, unspecified level'),
    ])
  })

  it('description rewrite is case-insensitive', () => {
    const input = [dx('S13.4XXA', 'Cervical Sprain, Initial Encounter')]
    const out = rewriteDiagnosesForProcedure(input, { procedureNumber: 2 })
    expect(out[0].description).toBe('Cervical Sprain, subsequent encounter')
  })

  it('idempotent: repeated application is a no-op', () => {
    const input = [dx('S13.4XXA', 'Cervical sprain, initial encounter')]
    const once = rewriteDiagnosesForProcedure(input, { procedureNumber: 2 })
    const twice = rewriteDiagnosesForProcedure(once, { procedureNumber: 2 })
    expect(twice).toEqual(once)
  })

  it('does not mutate input', () => {
    const input = [
      dx('S13.4XXA', 'Cervical sprain, initial encounter'),
      dx('V43.52XA', 'Car collision, initial encounter'),
    ]
    const snapshot = JSON.parse(JSON.stringify(input))
    rewriteDiagnosesForProcedure(input, { procedureNumber: 2 })
    expect(input).toEqual(snapshot)
  })

  it('handles empty input', () => {
    expect(rewriteDiagnosesForProcedure([], { procedureNumber: 2 })).toEqual([])
  })
})

describe('rewriteDiagnosesForDischarge', () => {
  it('strips V/W/X/Y, rewrites A→D, upgrades M54.5 parent', () => {
    const input = [
      dx('S13.4XXA', 'Cervical sprain, initial encounter'),
      dx('V43.52XA', 'Car collision, initial encounter'),
      dx('M54.5', 'Low back pain'),
    ]
    const out = rewriteDiagnosesForDischarge(input)
    expect(out).toEqual([
      dx('S13.4XXD', 'Cervical sprain, subsequent encounter'),
      dx('M54.50', 'Low back pain'),
    ])
  })

  it('leaves M54.50 / M54.51 / M54.59 untouched', () => {
    const input = [
      dx('M54.50', 'Low back pain, unspecified'),
      dx('M54.51', 'Vertebrogenic low back pain'),
      dx('M54.59', 'Other low back pain'),
    ]
    expect(rewriteDiagnosesForDischarge(input)).toEqual(input)
  })

  it('idempotent', () => {
    const input = [
      dx('S13.4XXA', 'Cervical sprain, initial encounter'),
      dx('M54.5', 'Low back pain'),
    ]
    const once = rewriteDiagnosesForDischarge(input)
    const twice = rewriteDiagnosesForDischarge(once)
    expect(twice).toEqual(once)
  })

  it('handles empty input', () => {
    expect(rewriteDiagnosesForDischarge([])).toEqual([])
  })
})
