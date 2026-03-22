import { getClinicSettings, listProviderProfiles } from '@/actions/settings'
import { listServiceCatalog } from '@/actions/service-catalog'
import { listFeeEstimateConfig } from '@/actions/fee-estimate'
import { SettingsTabs } from '@/components/settings/settings-tabs'

export default async function SettingsPage() {
  const [{ data: clinicSettings }, { data: serviceCatalog }, { data: feeEstimateConfig }, { data: providerProfiles }] = await Promise.all([
    getClinicSettings(),
    listServiceCatalog(),
    listFeeEstimateConfig(),
    listProviderProfiles(),
  ])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <SettingsTabs
        clinicSettings={clinicSettings ?? null}
        serviceCatalog={serviceCatalog ?? []}
        feeEstimateConfig={feeEstimateConfig ?? []}
        providerProfiles={providerProfiles ?? []}
      />
    </div>
  )
}
