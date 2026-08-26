import { z } from 'zod'

export const scheduleProcedureAppointmentSchema = z.object({
  procedure_order_id: z.string().uuid(),
  scheduled_start: z.string().datetime({ offset: true }),
  scheduled_end: z.string().datetime({ offset: true }),
  provider_id: z.string().uuid(),
  location: z.string().trim().max(500).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  idempotency_key: z.string().trim().min(8).max(200),
}).superRefine((value, context) => {
  if (Date.parse(value.scheduled_end) <= Date.parse(value.scheduled_start)) {
    context.addIssue({
      code: 'custom',
      path: ['scheduled_end'],
      message: 'Scheduled end must be after scheduled start',
    })
  }
})

export const rescheduleProcedureAppointmentSchema =
  scheduleProcedureAppointmentSchema.extend({
    appointment_id: z.string().uuid(),
  })

export const changeProcedureAppointmentStatusSchema = z.object({
  appointment_id: z.string().uuid(),
  status: z.enum(['cancelled', 'no_show']),
  reason: z.string().trim().min(1).max(2000),
  idempotency_key: z.string().trim().min(8).max(200),
})

export type ScheduleProcedureAppointmentInput = z.infer<
  typeof scheduleProcedureAppointmentSchema
>
export type RescheduleProcedureAppointmentInput = z.infer<
  typeof rescheduleProcedureAppointmentSchema
>
export type ChangeProcedureAppointmentStatusInput = z.infer<
  typeof changeProcedureAppointmentStatusSchema
>
