import { describe, it, expect } from 'vitest'
import { voiceCharterPromptBlock, BANNED_HEDGE_WORDS, APPROVED_TRANSITIONS } from '@/lib/qc/voice-charter'

describe('voiceCharterPromptBlock', () => {
  it('contains the section header', () => {
    expect(voiceCharterPromptBlock()).toContain('VOICE & STYLE CHARTER')
  })

  it('lists every banned hedge word', () => {
    const block = voiceCharterPromptBlock()
    for (const w of BANNED_HEDGE_WORDS) {
      expect(block).toContain(`"${w}"`)
    }
  })

  it('lists every approved transition', () => {
    const block = voiceCharterPromptBlock()
    for (const t of APPROVED_TRANSITIONS) {
      expect(block).toContain(`"${t}"`)
    }
  })

  it('mandates third-person except for attestation and disclaimer', () => {
    expect(voiceCharterPromptBlock()).toContain('Third-person clinical narrative everywhere EXCEPT')
  })

  it('forbids marketing language for PRP', () => {
    expect(voiceCharterPromptBlock()).toContain('NO MARKETING LANGUAGE')
  })
})
