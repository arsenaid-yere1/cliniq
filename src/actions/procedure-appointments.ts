'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireReturnTeleVisitsMutation } from '@/lib/features/return-tele-visits'
import { scheduleProcedureAppointmentSchema,rescheduleProcedureAppointmentSchema,changeProcedureAppointmentStatusSchema,type ScheduleProcedureAppointmentInput,type RescheduleProcedureAppointmentInput,type ChangeProcedureAppointmentStatusInput } from '@/lib/validations/procedure-appointment'

export async function listProcedureAppointments(caseId:string,episodeId?:string) {
  const supabase=await createClient(); let query=supabase.from('procedure_appointments').select('*').eq('case_id',caseId).is('deleted_at',null).order('scheduled_start',{ascending:false})
  if(episodeId)query=query.eq('episode_id',episodeId)
  const {data,error}=await query; return error?{error:'Unable to load appointments',data:[]}:{data:data??[]}
}
export async function scheduleProcedureAppointment(input:ScheduleProcedureAppointmentInput) {
  const disabled=requireReturnTeleVisitsMutation();if(disabled)return disabled
  const parsed=scheduleProcedureAppointmentSchema.safeParse(input);if(!parsed.success)return {error:parsed.error.issues[0]?.message??'Invalid appointment'}
  const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();if(!user)return {error:'Not authenticated'}
  const v=parsed.data;const {data,error}=await supabase.rpc('schedule_procedure_appointment',{p_order_id:v.procedure_order_id,p_scheduled_start:v.scheduled_start,p_scheduled_end:v.scheduled_end,p_provider_id:v.provider_id,p_location:v.location??null,p_notes:v.notes??null,p_idempotency_key:v.idempotency_key})
  if(error)return {error:error.message.includes('available')?error.message:'Unable to schedule procedure'}
  revalidatePath('/patients');return {data}
}
export async function rescheduleProcedureAppointment(input:RescheduleProcedureAppointmentInput) {
  const disabled=requireReturnTeleVisitsMutation();if(disabled)return disabled
  const parsed=rescheduleProcedureAppointmentSchema.safeParse(input);if(!parsed.success)return {error:parsed.error.issues[0]?.message??'Invalid appointment'}
  const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();if(!user)return {error:'Not authenticated'}
  const v=parsed.data;const {data,error}=await supabase.rpc('reschedule_procedure_appointment',{p_appointment_id:v.appointment_id,p_scheduled_start:v.scheduled_start,p_scheduled_end:v.scheduled_end,p_provider_id:v.provider_id,p_location:v.location??null,p_notes:v.notes??null,p_idempotency_key:v.idempotency_key})
  if(error)return {error:error.message.includes('available')?error.message:'Unable to reschedule procedure'}
  revalidatePath('/patients');return {data}
}
export async function changeProcedureAppointmentStatus(input:ChangeProcedureAppointmentStatusInput) {
  const disabled=requireReturnTeleVisitsMutation();if(disabled)return disabled
  const parsed=changeProcedureAppointmentStatusSchema.safeParse(input);if(!parsed.success)return {error:parsed.error.issues[0]?.message??'Invalid appointment status'}
  const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();if(!user)return {error:'Not authenticated'}
  const v=parsed.data;const {data,error}=await supabase.rpc('close_procedure_appointment',{p_appointment_id:v.appointment_id,p_status:v.status,p_reason:v.reason,p_idempotency_key:v.idempotency_key})
  if(error)return {error:error.message.includes('transition')?error.message:'Unable to change appointment'}
  revalidatePath('/patients');return {data}
}
export async function completeProcedureAppointment(appointmentId:string,procedure:Record<string,unknown>,vitals:Record<string,unknown>|null,idempotencyKey:string) {
  const disabled=requireReturnTeleVisitsMutation();if(disabled)return disabled
  const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();if(!user)return {error:'Not authenticated'}
  const {data,error}=await supabase.rpc('complete_procedure_appointment',{p_appointment_id:appointmentId,p_procedure:procedure,p_vitals:vitals??{},p_idempotency_key:idempotencyKey})
  if(error)return {error:error.message.includes('available')?error.message:'Unable to complete procedure'}
  revalidatePath('/patients');return {data}
}
