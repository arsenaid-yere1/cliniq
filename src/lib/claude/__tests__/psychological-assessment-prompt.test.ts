import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/claude/client', () => ({ callClaudeTool: vi.fn(async () => ({ data: { content: 'Generated section' } })) }))
import { callClaudeTool } from '@/lib/claude/client'
import { generateInitialVisitFromData, regenerateSection, type InitialVisitInputData } from '../generate-initial-visit'
import { PSYCHOLOGICAL_ASSESSMENT_PROMPT } from '../psychological-assessment-prompt'
import { defaultPsychologicalAssessment } from '@/lib/validations/psychological-assessment'
import { defaultProviderIntake } from '@/lib/validations/initial-visit-note'

describe('psychological source mapping', () => {
  beforeEach(() => vi.clearAllMocks())
  const source = { providerIntake: { ...defaultProviderIntake, psychological_assessment: {
    ...defaultPsychologicalAssessment, symptom_status: 'reported', symptoms: ['Flashbacks', 'Nightmares'],
    observations: 'Anxious affect', clinical_impression: 'Further evaluation needed',
    follow_up: 'referral_recommended', referral_reason: 'Persistent reported symptoms',
  } } } as InitialVisitInputData

  it('sends structured current-visit assessment and the template contract on full generation', async () => {
    await generateInitialVisitFromData(source, 'initial_visit')
    const args = vi.mocked(callClaudeTool).mock.calls[0][0]
    expect(args.system).toContain(PSYCHOLOGICAL_ASSESSMENT_PROMPT)
    expect(JSON.stringify(args.messages)).toContain('psychological_assessment')
    expect(JSON.stringify(args.messages)).toContain('Anxious affect')
    expect(args.system).toContain('NEVER infer PTSD')
    expect(args.system).toContain('PSYCHIATRIC:')
    expect(args.system).toContain('Never add a top-level Psychological Assessment section')
  })
  it('uses the same source and documentation rules when regenerating one section', async () => {
    await regenerateSection(source, 'initial_visit', 'physical_exam', 'Existing exam')
    const args = vi.mocked(callClaudeTool).mock.calls[0][0]
    expect(args.system).toContain(PSYCHOLOGICAL_ASSESSMENT_PROMPT)
    expect(JSON.stringify(args.messages)).toContain('psychological_assessment')
    expect(args.system).toContain('Do not transform patient reports into observed anxious affect')
  })
})
