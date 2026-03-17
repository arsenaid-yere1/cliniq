import { getClinicSettings, getProviderProfile, listProviderProfiles } from '@/actions/settings'
import { listServiceCatalog } from '@/actions/service-catalog'
import { SettingsTabs } from '@/components/settings/settings-tabs'

export default async function SettingsPage() {
  const [{ data: clinicSettings }, { data: providerProfile }, { data: serviceCatalog }, { data: providerProfiles }] = await Promise.all([
    getClinicSettings(),
    getProviderProfile(),
    listServiceCatalog(),
    listProviderProfiles(),
  ])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <SettingsTabs
        clinicSettings={clinicSettings ?? null}
        providerProfile={providerProfile ?? null}
        serviceCatalog={serviceCatalog ?? []}
        providerProfiles={providerProfiles ?? []}
      />
    </div>
  )
}
