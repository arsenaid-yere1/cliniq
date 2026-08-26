import { describe, expect, it } from 'vitest'
import {
  changeProcedureAppointmentStatusSchema,
  scheduleProcedureAppointmentSchema,
} from '../procedure-appointment'

const appointment = {
  procedure_order_id: '11111111-1111-4111-8111-111111111111',
  scheduled_start: '2026-08-27T12:00:00Z',
  scheduled_end: '2026-08-27T13:00:00Z',
  provider_id: '22222222-2222-4222-8222-222222222222',
  location: 'Procedure suite',
  notes: null,
  idempotency_key: 'schedule-appointment-001',
}

describe('scheduleProcedureAppointmentSchema', () => {
  it('accepts a valid appointment window', () => {
    expect(scheduleProcedureAppointmentSchema.safeParse(appointment).success).toBe(true)
  })

  it('rejects a zero-length appointment', () => {
    expect(scheduleProcedureAppointmentSchema.safeParse({
      ...appointment,
      scheduled_end: appointment.scheduled_start,
    }).success).toBe(false)
  })
})
describe('changeProcedureAppointmentStatusSchema', () => {
  it('requires an audited reason', () => {
    expect(changeProcedureAppointmentStatusSchema.safeParse({
      appointment_id: '33333333-3333-4333-8333-333333333333',
      status: 'cancelled',
      reason: '',
      idempotency_key: 'cancel-appointment-001',
    }).success).toBe(false)
  })
})
