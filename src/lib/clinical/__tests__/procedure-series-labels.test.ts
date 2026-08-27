import { describe, expect, it } from 'vitest'
import {
  buildPriorCourseOptionLabel,
  buildPriorProcedureSeriesLabel,
  START_SEPARATE_SERIES_LABEL,
} from '../procedure-series-labels'

describe('procedure series labels', () => {
  it('describes a new series as separate from prior treatment', () => {
    expect(START_SEPARATE_SERIES_LABEL).toBe('Start a separate treatment series')
  })

  it('identifies the episode, procedure type, and series number', () => {
    expect(buildPriorProcedureSeriesLabel({
      episodeNumber: 2,
      procedureType: 'prp',
      seriesNumber: 1,
    })).toBe('Episode 2 · PRP series 1')
  })

  it('makes clear that continuation comes from a prior episode', () => {
    expect(buildPriorCourseOptionLabel('Episode 2 · PRP series 1'))
      .toBe('Continue from prior episode — Episode 2 · PRP series 1')
  })
})
