import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { format } from 'date-fns'
import { createClient } from '@/lib/supabase/server'
import { PainFollowUpPdf } from './pain-follow-up-template'

export async function renderPainFollowUpPdf(caseId: string, encounterId: string, note: Record<string, unknown>) {
  const supabase = await createClient()
  const [{ data: caseData }, { data: encounter }] = await Promise.all([
    supabase.from('cases').select('patient:patients!inner(first_name,last_name,date_of_birth)')
      .eq('id', caseId).is('deleted_at', null).single(),
    supabase.from('clinical_encounters').select('*,provider:provider_profiles(display_name,credentials)')
      .eq('id', encounterId).eq('case_id', caseId).is('deleted_at', null).single(),
  ])
  const patient = caseData?.patient as unknown as { first_name: string; last_name: string; date_of_birth: string | null } | null
  const provider = encounter?.provider as unknown as { display_name: string; credentials: string | null } | null
  const date = encounter?.encounter_date ?? encounter?.scheduled_start?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)
  const labels: Array<[string, string]> = [
    ['Subjective','subjective'],['Interval History','interval_history'],['Review of Systems','review_of_systems'],
    ['Telehealth Observations','telehealth_observations'],['Imaging Review','imaging_review'],['Assessment','assessment'],
    ['Diagnoses','diagnoses'],['Treatment Plan','treatment_plan'],['Patient Education','patient_education'],
    ['Follow-Up','follow_up'],['Clinician Disclaimer','clinician_disclaimer'],
  ]
  const element = React.createElement(PainFollowUpPdf, { data: {
    patientName: patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown',
    dob: patient?.date_of_birth ? format(new Date(`${patient.date_of_birth}T00:00:00`), 'MM/dd/yyyy') : '—',
    dateOfService: format(new Date(`${date}T00:00:00`), 'MM/dd/yyyy'),
    modality: encounter?.modality === 'telehealth' ? 'Telehealth (audio/video)' : (encounter?.modality ?? 'Unknown'),
    consent: encounter?.telehealth_consent_obtained ? 'Obtained' : 'Not documented',
    patientLocation: encounter?.patient_location_state ?? 'Not documented',
    providerLocation: encounter?.provider_location ?? 'Not documented',
    connectionMethod: encounter?.connection_method ?? 'Not documented',
    providerName: provider?.display_name ?? 'Provider not documented',
    providerCredentials: provider?.credentials,
    sections: labels.map(([label,key]) => ({ label, value: note[key] as string | null })),
  } })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToBuffer(element as any)
}
