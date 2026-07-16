import { describe, it, expect } from 'vitest'
import { computeBotoxDrugLineItems, computeBotoxFacilityLineItem } from '../botox-lines'

describe('computeBotoxDrugLineItems', () => {
  const base = {
    procedureId: 'p1',
    procedureDate: '2026-05-29',
    injectionSite: 'Right Masseter, Left Masseter, Right Temporalis, Left Temporalis',
    unitCode: 'BOTOX-UNIT',
    unitPrice: 15,
  }

  it('produces admin + waste lines matching the Sandaljian case', () => {
    const lines = computeBotoxDrugLineItems({
      ...base,
      dosing: { units_administered: 60, units_discarded: 40, reconstitution_units: 100 },
    })
    expect(lines).toHaveLength(2)

    const admin = lines[0]
    expect(admin.quantity).toBe(60)
    expect(admin.unit_price).toBe(15)
    expect(admin.total_price).toBe(900)
    expect(admin.description).toContain('administered')

    const waste = lines[1]
    expect(waste.quantity).toBe(40)
    expect(waste.total_price).toBe(600)
    expect(waste.description).toContain('JW')

    // Admin + waste quantity reconciles to the vial.
    expect(admin.quantity + waste.quantity).toBe(100)
  })

  it('omits the waste line when nothing was discarded', () => {
    const lines = computeBotoxDrugLineItems({
      ...base,
      dosing: { units_administered: 100, units_discarded: 0, reconstitution_units: 100 },
    })
    expect(lines).toHaveLength(1)
    expect(lines[0].quantity).toBe(100)
    expect(lines[0].total_price).toBe(1500)
  })

  it('omits both lines when dosing is null', () => {
    expect(computeBotoxDrugLineItems({ ...base, dosing: null })).toHaveLength(0)
  })

  it('appends the muscle map to the admin description', () => {
    const lines = computeBotoxDrugLineItems({
      ...base,
      dosing: { units_administered: 60, units_discarded: 40 },
    })
    expect(lines[0].description).toContain('Masseter')
  })
})

describe('computeBotoxFacilityLineItem', () => {
  it('produces a single flat facility line', () => {
    const line = computeBotoxFacilityLineItem({
      procedureId: 'p1',
      procedureDate: '2026-05-29',
      facilityCode: 'BOTOX-FACILITY',
      facilityPrice: 200,
    })
    expect(line.quantity).toBe(1)
    expect(line.unit_price).toBe(200)
    expect(line.total_price).toBe(200)
    expect(line.cpt_code).toBe('BOTOX-FACILITY')
  })
})
