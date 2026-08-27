'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireReturnTeleVisitsMutation } from '@/lib/features/return-tele-visits'
import { createProcedureOrderFromRecommendationSchema, type CreateProcedureOrderFromRecommendationInput } from '@/lib/validations/procedure-order'

export async function listProcedureOrders(caseId:string, episodeId?:string) {
  const supabase=await createClient()
  let query=supabase.from('procedure_orders').select('*').eq('case_id',caseId).is('deleted_at',null).order('created_at',{ascending:false})
  if(episodeId) query=query.eq('episode_id',episodeId)
  const {data,error}=await query
  return error?{error:'Unable to load procedure orders',data:[]}:{data:data??[]}
}

export async function createProcedureOrderFromRecommendation(input:CreateProcedureOrderFromRecommendationInput) {
  const disabled=requireReturnTeleVisitsMutation(); if(disabled)return disabled
  const parsed=createProcedureOrderFromRecommendationSchema.safeParse(input)
  if(!parsed.success)return {error:parsed.error.issues[0]?.message??'Invalid procedure order'}
  const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser()
  if(!user)return {error:'Not authenticated'}
  const value=parsed.data
  const {data,error}=await supabase.rpc('create_procedure_order_from_recommendation',{
    p_case_id:value.case_id,p_episode_id:value.episode_id,p_source_encounter_id:value.source_encounter_id,
    p_recommendation_id:value.source_recommendation_id,p_procedure_type:value.procedure_type,
    p_sites:value.sites,p_diagnoses:value.diagnoses,p_rationale:value.clinical_rationale,
    p_priority:value.priority,p_continued_from_series_id:value.continued_from_series_id??null,
  })
  if(error){
    const message=error.message
    if(message.includes('finalized recommendation'))return {error:'A finalized recommendation is required'}
    if(message.includes('recommendation_active')||message.includes('duplicate'))return {error:'This recommendation already has an order'}
    if(message.includes('already has an open order')||message.includes('one_open_per_series'))return {error:'This series already has an open procedure order. Refresh after it is completed or cancelled.'}
    if(message.includes('type does not match'))return {error:'This series no longer matches the recommended procedure type. Choose another series.'}
    if(message.includes('no longer')||message.includes('no completed procedures'))return {error:'This series is no longer eligible. Refresh or choose another option.'}
    return {error:'Unable to create procedure order'}
  }
  revalidatePath(`/patients/${value.case_id}/procedures`); revalidatePath(`/patients/${value.case_id}/timeline`)
  return {data}
}

export async function cancelProcedureOrder(caseId:string,orderId:string,reason:string,idempotencyKey:string) {
  const disabled=requireReturnTeleVisitsMutation(); if(disabled)return disabled
  if(!reason.trim())return {error:'Cancellation reason is required'}
  const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser(); if(!user)return {error:'Not authenticated'}
  const {data:order}=await supabase.from('procedure_orders').select('status').eq('id',orderId).eq('case_id',caseId).is('deleted_at',null).maybeSingle()
  if(!order)return {error:'Procedure order not found'}
  if(order.status==='completed'||order.status==='cancelled')return {error:'This procedure order is final'}
  const {error}=await supabase.rpc('cancel_procedure_order',{p_order_id:orderId,p_reason:reason.trim(),p_idempotency_key:idempotencyKey})
  if(error)return {error:'Unable to cancel procedure order'}
  revalidatePath(`/patients/${caseId}/procedures`); return {data:{success:true}}
}
