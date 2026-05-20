import { getClinicSettings, listProviderProfiles } from '@/actions/settings'
import { listServiceCatalog } from '@/actions/service-catalog'
import { listFeeEstimateConfig } from '@/actions/fee-estimate'
import { listUsers, type UserListItem } from '@/actions/users'
import { getCurrentUserWithRole } from '@/lib/auth/require-role'
import { SettingsTabs } from '@/components/settings/settings-tabs'

export default async function SettingsPage() {
  const me = await getCurrentUserWithRole()
  const isAdmin = me?.role === 'admin'

  const [{ data: clinicSettings }, { data: serviceCatalog }, { data: feeEstimateConfig }, { data: providerProfiles }, usersResult] = await Promise.all([
    getClinicSettings(),
    listServiceCatalog(),
    listFeeEstimateConfig(),
    listProviderProfiles(),
    isAdmin ? listUsers() : Promise.resolve({ data: [] as UserListItem[] }),
  ])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <SettingsTabs
        clinicSettings={clinicSettings ?? null}
        serviceCatalog={serviceCatalog ?? []}
        feeEstimateConfig={feeEstimateConfig ?? []}
        providerProfiles={providerProfiles ?? []}
        users={usersResult.data ?? []}
        currentUserId={me?.id ?? null}
        isAdmin={isAdmin}
      />
    </div>
  )
}
