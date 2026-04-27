'use server'

import { createClient } from '@/lib/supabase/server'

export interface ProcedureDefaultsRow {
  anatomy_key: string
  procedure_type: 'prp' | 'cortisone' | 'hyaluronic'
  needle_gauge: string | null
  injection_volume_ml: number | null
  anesthetic_agent: string | null
  anesthetic_dose_ml: number | null
  guidance_method: 'ultrasound' | 'fluoroscopy' | 'landmark' | null
  activity_restriction_hrs: number | null
  default_cpt_codes: string[]
  target_structure: string | null
  blood_draw_volume_ml: number | null
  centrifuge_duration_min: number | null
  prep_protocol: string | null
}

export async function getProcedureDefaultsByAnatomy(
  anatomyKey: string,
  procedureType: 'prp' | 'cortisone' | 'hyaluronic' = 'prp',
): Promise<ProcedureDefaultsRow | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('procedure_defaults')
    .select(
      'anatomy_key, procedure_type, needle_gauge, injection_volume_ml, anesthetic_agent, anesthetic_dose_ml, guidance_method, activity_restriction_hrs, default_cpt_codes, target_structure, blood_draw_volume_ml, centrifuge_duration_min, prep_protocol',
    )
    .eq('anatomy_key', anatomyKey)
    .eq('procedure_type', procedureType)
    .eq('active', true)
    .maybeSingle()
  return (data as ProcedureDefaultsRow | null) ?? null
}
