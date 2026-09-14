import { describe, expect, it } from 'vitest'
import { hasRadiationExample, isRadiationStatus, toggleRadiationExample } from '../complaint-radiation-text'

describe('radiation text edits', () => {
  it('applies statuses and keeps examples separate', () => {
    expect(isRadiationStatus('No radiation')).toBe(true)
    expect(hasRadiationExample('arm; shoulder; side', 'Shoulder')).toBe(true)
    expect(toggleRadiationExample('', 'Shoulder')).toBe('Shoulder')
    expect(toggleRadiationExample('arm; Shoulder', 'Shoulder')).toBe('arm')
  })

  it('does not replace prose and preserves punctuation', () => {
    expect(toggleRadiationExample('Patient says pain radiates to the shoulder sometimes', 'Shoulder')).toBe('Patient says pain radiates to the shoulder sometimes; Shoulder')
    expect(toggleRadiationExample('Custom; Rest;  Other ;', 'Shoulder')).toBe('Custom; Rest;  Other ; Shoulder')
  })
})
