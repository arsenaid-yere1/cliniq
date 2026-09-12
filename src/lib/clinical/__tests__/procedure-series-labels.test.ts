import { describe, expect, it } from 'vitest'
import {
  buildCurrentSeriesOptionLabel,
  buildPriorCourseOptionLabel,
  buildPriorProcedureSeriesLabel,
  buildSeriesOptionLabel,
  getSeriesRelationshipDescription,
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

  it('labels the next procedure in a current active series', () => {
    expect(buildCurrentSeriesOptionLabel({
      id:'series-1',relationship:'current',episodeId:'episode-2',episodeNumber:2,
      seriesNumber:1,procedureType:'prp',latestProcedureNumber:2,hasOpenOrder:false,eligible:true,unavailableReason:null,
    })).toBe('Add procedure #3 to current active series — PRP series 1')
  })

  it('builds prior labels and relationship descriptions from structured options', () => {
    const prior={id:'series-1',relationship:'prior' as const,episodeId:'episode-1',episodeNumber:1,seriesNumber:2,procedureType:'botox',latestProcedureNumber:3,hasOpenOrder:false,eligible:true,unavailableReason:null}
    expect(buildSeriesOptionLabel(prior)).toBe('Continue from prior episode — Episode 1 · BOTOX series 2')
    expect(getSeriesRelationshipDescription(prior)).toContain('retaining lineage')
    expect(getSeriesRelationshipDescription()).toBe('Begins an independent treatment series.')
  })

  it('explains reopening without discarding history', () => {
    const choice = { id: 'series', relationship: 'reopen' as const, episodeId: 'episode', episodeNumber: 1,
      seriesNumber: 1, procedureType: 'prp', latestProcedureNumber: 1, hasOpenOrder: false, eligible: true, unavailableReason: null }
    expect(buildSeriesOptionLabel(choice)).toBe('Reopen and continue this series — PRP series 1 · procedure #2')
    expect(getSeriesRelationshipDescription(choice)).toContain('Existing procedures and notes are preserved')
  })
})
