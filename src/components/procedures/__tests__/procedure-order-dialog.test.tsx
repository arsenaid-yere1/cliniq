// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProcedureOrderDialog } from '../procedure-order-dialog'

const refresh = vi.fn()
const createOrder = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/actions/procedure-orders', () => ({ createProcedureOrderFromRecommendation: (...args: unknown[]) => createOrder(...args) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const recommendation = {
  recommendation_id: '44444444-4444-4444-8444-444444444444',
  procedure_type: 'prp' as const,
  sites: ['Knee'],
  diagnoses: [],
  rationale: 'Persistent symptoms.',
}

function renderDialog(props: Partial<React.ComponentProps<typeof ProcedureOrderDialog>> = {}) {
  return render(<ProcedureOrderDialog
    caseId="11111111-1111-4111-8111-111111111111"
    episodeId="22222222-2222-4222-8222-222222222222"
    encounterId="33333333-3333-4333-8333-333333333333"
    recommendation={recommendation}
    seriesChoices={[]}
    {...props}
  />)
}

describe('ProcedureOrderDialog', () => {
  beforeEach(() => { createOrder.mockReset(); refresh.mockReset(); createOrder.mockResolvedValue({ data: { id: 'order' } }) })
  afterEach(cleanup)

  it('requires an explicit relationship and submits a separate-series choice', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Create Procedure Order' }))
    const submit = screen.getByRole('button', { name: 'Create Order' })
    expect(submit).toHaveProperty('disabled', true)
    await user.click(screen.getByText('Start a separate treatment series'))
    expect(submit).toHaveProperty('disabled', false)
    await user.click(submit)
    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ series_relationship: 'separate', selected_series_id: null }))
    expect(refresh).toHaveBeenCalled()
  })

  it('shows why a matching series cannot be selected', async () => {
    const user = userEvent.setup()
    renderDialog({ seriesChoices: [{
      id: 'series', relationship: 'current', episodeId: 'episode', episodeNumber: 2,
      seriesNumber: 1, procedureType: 'prp', latestProcedureNumber: 1,
      hasOpenOrder: true, eligible: false, unavailableReason: 'current_has_open_order',
    }] })
    await user.click(screen.getByRole('button', { name: 'Create Procedure Order' }))
    expect(screen.getByText('This series already has an open procedure order.')).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Add procedure #2/ })).toHaveProperty('disabled', true)
  })

  it('blocks creation when relationship choices fail to load', async () => {
    const user = userEvent.setup()
    renderDialog({ seriesLoadError: true })
    await user.click(screen.getByRole('button', { name: 'Create Procedure Order' }))
    expect(screen.getByRole('alert').textContent).toContain('could not be loaded')
    expect(screen.getByRole('button', { name: 'Create Order' })).toHaveProperty('disabled', true)
  })
})
