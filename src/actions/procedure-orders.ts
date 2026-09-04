'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireReturnTeleVisitsMutation } from '@/lib/features/return-tele-visits'
import { createProcedureOrderFromRecommendationSchema, type CreateProcedureOrderFromRecommendationInput } from '@/lib/validations/procedure-order'
import { buildSavedSeriesRelationshipLabel, type ProcedureSeriesRelationship } from '@/lib/clinical/procedure-series-labels'
import type { Tables } from '@/types/database'

export type ProcedureOrderSummary = Tables<'procedure_orders'> & {
  seriesRelationship: ProcedureSeriesRelationship | 'unknown'
  seriesRelationshipLabel: string
}

export async function listProcedureOrders(caseId:string, episodeId?:string) {
  const supabase=await createClient()
  let query=supabase.from('procedure_orders').select('*').eq('case_id',caseId).is('deleted_at',null).order('created_at',{ascending:false})
  if(episodeId) query=query.eq('episode_id',episodeId)
  const {data,error}=await query
  if(error)return {error:'Unable to load procedure orders',data:[] as ProcedureOrderSummary[]}
  const orders=data??[]
  const unknownSummaries=orders.map<ProcedureOrderSummary>((order)=>({
    ...order,
    seriesRelationship:'unknown',
    seriesRelationshipLabel:buildSavedSeriesRelationshipLabel('unknown'),
  }))
  const orderIds=orders.map((order)=>order.id)
  const {data:selections,error:selectionError}=orderIds.length
    ? await supabase.from('procedure_order_series_selections').select('procedure_order_id,relationship,selected_series_id').in('procedure_order_id',orderIds)
    : {data:[],error:null}
  if(selectionError)return {data:unknownSummaries}
  const selectedIds=(selections??[]).flatMap((selection)=>selection.selected_series_id?[selection.selected_series_id]:[])
  const {data:selectedSeries,error:seriesError}=selectedIds.length
    ? await supabase.from('procedure_series').select('id,episode_id,series_number,procedure_type').in('id',selectedIds)
    : {data:[],error:null}
  if(seriesError)return {data:unknownSummaries}
  const episodeIds=(selectedSeries??[]).map((series)=>series.episode_id)
  const {data:episodes,error:episodeError}=episodeIds.length
    ? await supabase.from('care_episodes').select('id,episode_number').in('id',episodeIds)
    : {data:[],error:null}
  if(episodeError)return {data:unknownSummaries}
  const selectionByOrder=new Map((selections??[]).map((selection)=>[selection.procedure_order_id,selection]))
  const seriesById=new Map((selectedSeries??[]).map((series)=>[series.id,series]))
  const episodeById=new Map((episodes??[]).map((episode)=>[episode.id,episode]))
  const summaries=orders.map<ProcedureOrderSummary>((order)=>{
    const selection=selectionByOrder.get(order.id)
    const relationship=(selection?.relationship??'unknown') as ProcedureSeriesRelationship|'unknown'
    const selected=selection?.selected_series_id?seriesById.get(selection.selected_series_id):null
    const selectedEpisode=selected?episodeById.get(selected.episode_id):null
    return {...order,seriesRelationship:relationship,seriesRelationshipLabel:buildSavedSeriesRelationshipLabel(relationship,selected&&selectedEpisode?{
      episodeNumber:selectedEpisode.episode_number,seriesNumber:selected.series_number,procedureType:selected.procedure_type,
    }:null)}
  })
  return {data:summaries}
}

export async function createProcedureOrderFromRecommendation(input:CreateProcedureOrderFromRecommendationInput) {
  const disabled=requireReturnTeleVisitsMutation(); if(disabled)return disabled
  const parsed=createProcedureOrderFromRecommendationSchema.safeParse(input)
  if(!parsed.success)return {error:parsed.error.issues[0]?.message??'Invalid procedure order'}
  const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser()
  if(!user)return {error:'Not authenticated'}
  const value=parsed.data
  const {data,error}=await supabase.rpc('create_procedure_order_from_recommendation_v2',{
    p_case_id:value.case_id,p_episode_id:value.episode_id,p_source_encounter_id:value.source_encounter_id,
    p_recommendation_id:value.source_recommendation_id,p_procedure_type:value.procedure_type,
    p_sites:value.sites,p_diagnoses:value.diagnoses,p_rationale:value.clinical_rationale,
    p_priority:value.priority,p_series_relationship:value.series_relationship,p_selected_series_id:value.selected_series_id,
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
  revalidatePath(`/patients/${value.case_id}/visits/${value.source_encounter_id}`)
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
