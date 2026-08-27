import { describe, it, expect } from 'vitest'
import {
  POST_CARE_ITEMS,
  CONTRAINDICATION_ITEMS,
} from '../procedure-consent-template'
import {
  nsaidPostCareInstructionSentence,
  nsaidScreeningContraindicationLabel,
} from '@/lib/clinical/prp-protocol'

describe('ProcedureConsentPdf NSAID language', () => {
  it('post-care list uses the canonical NSAID instruction sentence', () => {
    expect(POST_CARE_ITEMS).toContain(nsaidPostCareInstructionSentence())
  })

  it('contraindication checklist uses the canonical NSAID screening label', () => {
    expect(CONTRAINDICATION_ITEMS).toContain(nsaidScreeningContraindicationLabel())
  })

  it('uses the same two-week NSAID window for screening and post-care', () => {
    const nsaidItems = [...POST_CARE_ITEMS, ...CONTRAINDICATION_ITEMS]
      .filter((item) => /NSAID/i.test(item))

    expect(nsaidItems).toHaveLength(2)
    expect(nsaidItems.every((item) => item.includes('2 weeks'))).toBe(true)
  })

  it('post-care list does not carry the legacy 4–6 weeks literal', () => {
    expect(POST_CARE_ITEMS.some((item) => item.includes('4–6 weeks'))).toBe(false)
  })

  it('contraindication checklist does not carry the legacy 7–10 days literal', () => {
    expect(CONTRAINDICATION_ITEMS.some((item) => item.includes('7–10 days'))).toBe(false)
  })

  it('does not contain a seven-day NSAID window', () => {
    const nsaidItems = [...POST_CARE_ITEMS, ...CONTRAINDICATION_ITEMS]
      .filter((item) => /NSAID/i.test(item))

    expect(nsaidItems.some((item) => /\b(?:past )?7(?:-| )days?\b/i.test(item))).toBe(false)
  })
})
