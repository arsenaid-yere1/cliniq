import { describe, it, expect } from 'vitest'
import {
  CASE_STATUSES,
  CASE_STATUS_CONFIG,
  CASE_STATUS_TRANSITIONS,
  LOCKED_STATUSES,
  type CaseStatus,
} from '../case-status'

describe('CASE_STATUSES', () => {
  it('contains all expected statuses', () => {
    expect(CASE_STATUSES).toEqual([
      'intake',
      'active',
      'pending_settlement',
      'closed',
      'archived',
    ])
  })
})

describe('CASE_STATUS_CONFIG', () => {
  it('has a config entry for every status', () => {
    for (const status of CASE_STATUSES) {
      expect(CASE_STATUS_CONFIG[status]).toBeDefined()
      expect(CASE_STATUS_CONFIG[status].label).toBeTruthy()
      expect(CASE_STATUS_CONFIG[status].color).toBeTruthy()
      expect(CASE_STATUS_CONFIG[status].variant).toBeTruthy()
    }
  })
})

describe('CASE_STATUS_TRANSITIONS', () => {
  it('has transition rules for every status', () => {
    for (const status of CASE_STATUSES) {
      expect(CASE_STATUS_TRANSITIONS[status]).toBeDefined()
      expect(Array.isArray(CASE_STATUS_TRANSITIONS[status])).toBe(true)
    }
  })

  it('only references valid statuses in transitions', () => {
    for (const status of CASE_STATUSES) {
      for (const target of CASE_STATUS_TRANSITIONS[status]) {
        expect(CASE_STATUSES).toContain(target)
      }
    }
  })

  it('intake can transition to active or closed', () => {
    expect(CASE_STATUS_TRANSITIONS.intake).toEqual(['active', 'closed'])
  })

  it('active can transition to pending_settlement or closed', () => {
    expect(CASE_STATUS_TRANSITIONS.active).toEqual(['pending_settlement', 'closed'])
  })

  it('pending_settlement can transition to closed or back to active', () => {
    expect(CASE_STATUS_TRANSITIONS.pending_settlement).toEqual(['closed', 'active'])
  })

  it('closed can transition to active or archived', () => {
    expect(CASE_STATUS_TRANSITIONS.closed).toEqual(['active', 'archived'])
  })

  it('archived can only transition back to closed', () => {
    expect(CASE_STATUS_TRANSITIONS.archived).toEqual(['closed'])
  })

  it('does not allow self-transitions', () => {
    for (const status of CASE_STATUSES) {
      expect(CASE_STATUS_TRANSITIONS[status]).not.toContain(status)
    }
  })

  it('does not allow intake to skip directly to archived', () => {
    expect(CASE_STATUS_TRANSITIONS.intake).not.toContain('archived')
  })
})

describe('LOCKED_STATUSES', () => {
  it('includes pending_settlement, closed, and archived', () => {
    expect(LOCKED_STATUSES).toContain('pending_settlement')
    expect(LOCKED_STATUSES).toContain('closed')
    expect(LOCKED_STATUSES).toContain('archived')
  })

  it('does not include editable statuses', () => {
    expect(LOCKED_STATUSES).not.toContain('intake')
    expect(LOCKED_STATUSES).not.toContain('active')
  })
})
