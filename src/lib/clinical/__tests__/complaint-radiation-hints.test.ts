import { describe, expect, it } from 'vitest'
import { complaintRadiationHints, complaintRadiationRegionOptions, getComplaintRadiationRegion } from '../complaint-radiation-hints'

describe('pain radiation region matching', () => {
  it('maps core aliases', () => {
    expect(getComplaintRadiationRegion('Lower back').key).toBe('lower_back')
    expect(getComplaintRadiationRegion('lt shoulder blade').key).toBe('shoulder_blade')
    expect(getComplaintRadiationRegion('Rt. lower leg').side).toBe('right')
    expect(getComplaintRadiationRegion('Bilateral foot').side).toBe('bilateral')
  })

  it('keeps unknown input in general and still preserves explicit side attempts in options', () => {
    expect(getComplaintRadiationRegion('elbow crease').key).toBe('general')
    expect(complaintRadiationRegionOptions('Lt. forearm').every(option => option.startsWith('Left '))).toBe(true)
    expect(complaintRadiationRegionOptions('lower back').join(',')).toContain('Foot')
  })

  it('uses curated destination lists from the current group', () => {
    const knee = getComplaintRadiationRegion('knee')
    expect(knee.destinations).toEqual(complaintRadiationHints.knee.destinations)
    expect(knee.destinations).toContain('Shin')
    expect(knee.destinations).toContain('Calf')
  })
})

