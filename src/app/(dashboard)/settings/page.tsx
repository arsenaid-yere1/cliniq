import { getClinicSettings } from '@/actions/settings'
import { SettingsTabs } from '@/components/settings/settings-tabs'

export default async function SettingsPage() {
  const { data: clinicSettings } = await getClinicSettings()

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <SettingsTabs clinicSettings={clinicSettings ?? null} />
    </div>
  )
}
