export const SCHEDULABLE_PROCEDURE_TYPES = [
  'prp',
  'cortisone',
  'hyaluronic',
  'botox',
] as const

export const PROCEDURE_ORDER_STATUSES = [
  'ordered',
  'scheduled',
  'cancelled',
  'completed',
] as const

export const PROCEDURE_APPOINTMENT_STATUSES = [
  'scheduled',
  'cancelled',
  'no_show',
  'completed',
] as const

export const PROCEDURE_ORDER_PRIORITIES = ['routine', 'urgent'] as const

export type SchedulableProcedureType = (typeof SCHEDULABLE_PROCEDURE_TYPES)[number]
export type ProcedureOrderStatus = (typeof PROCEDURE_ORDER_STATUSES)[number]
export type ProcedureAppointmentStatus = (typeof PROCEDURE_APPOINTMENT_STATUSES)[number]
export type ProcedureOrderPriority = (typeof PROCEDURE_ORDER_PRIORITIES)[number]
