import { describe, expect, it } from 'vitest'
import {
  buildCurrentSeriesOptionLabel,
  buildProcedureSeriesOptions,
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

  it('classifies eligible current and prior candidates using performed procedures', () => {
    const base={id:'series-1',episodeId:'episode-2',episodeNumber:2,seriesNumber:1,procedureType:'prp',status:'active',deletedAt:null,procedureNumbers:[1,2],orderStatuses:[]}
    const options=buildProcedureSeriesOptions([
      base,
      {...base,id:'prior',episodeId:'episode-1',episodeNumber:1,status:'completed'},
    ],'episode-2')
    expect(options.map(({id,relationship,latestProcedureNumber})=>({id,relationship,latestProcedureNumber}))).toEqual([
      {id:'series-1',relationship:'current',latestProcedureNumber:2},
      {id:'prior',relationship:'prior',latestProcedureNumber:2},
    ])
  })

  it('retains unavailable choices with stable reasons', () => {
    const base={episodeId:'current',episodeNumber:2,seriesNumber:1,procedureType:'prp',status:'active',deletedAt:null,procedureNumbers:[1],orderStatuses:[]}
    const options=buildProcedureSeriesOptions([
      {...base,id:'deleted',deletedAt:'2026-01-01'},
      {...base,id:'empty',procedureNumbers:[]},
      {...base,id:'inactive',status:'completed'},
      {...base,id:'prior-active',episodeId:'prior'},
      {...base,id:'open',orderStatuses:[{status:'scheduled',deletedAt:null}]},
      {...base,id:'deleted-open',orderStatuses:[{status:'ordered',deletedAt:'2026-01-01'}]},
    ],'current')
    expect(options.map(({id,unavailableReason})=>({id,unavailableReason}))).toEqual([
      {id:'deleted-open',unavailableReason:null},
      {id:'open',unavailableReason:'current_has_open_order'},
      {id:'empty',unavailableReason:'no_performed_procedures'},
      {id:'inactive',unavailableReason:'current_not_active'},
      {id:'deleted',unavailableReason:'deleted'},
      {id:'prior-active',unavailableReason:'prior_not_completed'},
    ])
  })

  it('derives the next number only from performed procedure numbers', () => {
    const [option]=buildProcedureSeriesOptions([{
      id:'series',episodeId:'current',episodeNumber:1,seriesNumber:1,procedureType:'prp',status:'active',deletedAt:null,
      procedureNumbers:[1,3],orderStatuses:[{status:'cancelled',deletedAt:null}],
    }],'current')
    expect(option.latestProcedureNumber).toBe(3)
    expect(buildSeriesOptionLabel(option)).toContain('procedure #4')
  })
})
