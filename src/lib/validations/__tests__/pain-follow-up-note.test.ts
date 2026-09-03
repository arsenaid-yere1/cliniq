import { describe, expect, it } from 'vitest'
import {
  painFollowUpNoteEditSchema,
  painFollowUpNoteResultSchema,
  painFollowUpNoteSectionLabels,
  painFollowUpNoteSections,
} from '../pain-follow-up-note'

const ENCOUNTER_ID = '11111111-1111-4111-8111-111111111111'
const RECOMMENDATION_ID = '22222222-2222-4222-8222-222222222222'

const note = {
  encounter_id: ENCOUNTER_ID,
  subjective: 'Pain has returned.',
  interval_history: 'Symptoms recurred after discharge.',
  review_of_systems: 'No new red flags reported.',
  telehealth_observations: 'Patient appeared comfortable on video.',
  imaging_review: 'Prior MRI reviewed.',
  assessment: 'Recurrent axial pain.',
  diagnoses: 'Lumbar spondylosis.',
  treatment_plan: 'Discussed procedural options.',
  patient_education: 'Return precautions reviewed.',
  follow_up: 'Schedule after authorization.',
  clinician_disclaimer: 'Telehealth limitations discussed.',
  procedure_recommendations: [{
    recommendation_id: RECOMMENDATION_ID,
    procedure_type: 'prp' as const,
    sites: ['Lumbar facet'],
    diagnoses: [{ icd10_code: 'M47.816', description: 'Lumbar spondylosis' }],
    rationale: 'Prior response with recurrent symptoms.',
    suggested_timing: 'Within 2 weeks',
  }],
}

describe('painFollowUpNoteEditSchema', () => {
  it('accepts structured provider-approved recommendations', () => {
    expect(painFollowUpNoteEditSchema.safeParse(note).success).toBe(true)
  })

  it('rejects duplicate recommendation IDs', () => {
    expect(painFollowUpNoteEditSchema.safeParse({
      ...note,
      procedure_recommendations: [
        note.procedure_recommendations[0],
        note.procedure_recommendations[0],
      ],
    }).success).toBe(false)
  })

  it('requires at least one site for a recommendation', () => {
    expect(painFollowUpNoteEditSchema.safeParse({
      ...note,
      procedure_recommendations: [{
        ...note.procedure_recommendations[0],
        sites: [],
      }],
    }).success).toBe(false)
  })
})

describe('pain follow-up section metadata', () => {
  it('defines the eleven generated sections with display labels', () => {
    expect(painFollowUpNoteSections).toHaveLength(11)
    for (const section of painFollowUpNoteSections) {
      expect(painFollowUpNoteSectionLabels[section].trim()).not.toBe('')
    }
  })

  it('constructs a complete result accepted by the schema', () => {
    const sections = Object.fromEntries(
      painFollowUpNoteSections.map((section) => [section, `${section} content`]),
    )

    expect(painFollowUpNoteResultSchema.safeParse({
      ...sections,
      procedure_recommendations: [],
    }).success).toBe(true)
  })
})
