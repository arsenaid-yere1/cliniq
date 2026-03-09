import { getInitialVisitNote, checkNotePrerequisites } from '@/actions/initial-visit-notes'
import { getClinicSettings, getProviderProfile, getClinicLogoUrl, getProviderSignatureUrl } from '@/actions/settings'
import { InitialVisitEditor } from '@/components/clinical/initial-visit-editor'

export default async function InitialVisitPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params

  const [noteResult, prereqResult, clinicResult, providerResult, logoResult, signatureResult] = await Promise.all([
    getInitialVisitNote(caseId),
    checkNotePrerequisites(caseId),
    getClinicSettings(),
    getProviderProfile(),
    getClinicLogoUrl(),
    getProviderSignatureUrl(),
  ])

  return (
    <InitialVisitEditor
      caseId={caseId}
      note={noteResult.data ?? null}
      canGenerate={prereqResult.data?.canGenerate ?? false}
      prerequisiteReason={prereqResult.data?.reason}
      clinicSettings={clinicResult.data ?? null}
      providerProfile={providerResult.data ?? null}
      clinicLogoUrl={logoResult.url ?? null}
      providerSignatureUrl={signatureResult.url ?? null}
    />
  )
}
