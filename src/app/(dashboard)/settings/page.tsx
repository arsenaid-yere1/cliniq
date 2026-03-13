import { getClinicSettings, getProviderProfile } from '@/actions/settings'
import { listServiceCatalog } from '@/actions/service-catalog'
import { SettingsTabs } from '@/components/settings/settings-tabs'

export default async function SettingsPage() {
  const [{ data: clinicSettings }, { data: providerProfile }, { data: serviceCatalog }] = await Promise.all([
    getClinicSettings(),
    getProviderProfile(),
    listServiceCatalog(),
  ])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <SettingsTabs
        clinicSettings={clinicSettings ?? null}
        providerProfile={providerProfile ?? null}
        serviceCatalog={serviceCatalog ?? []}
      />
    </div>
  )
}
