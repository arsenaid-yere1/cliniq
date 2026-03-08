'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ClinicInfoForm } from './clinic-info-form'
import type { Database } from '@/types/database'

type ClinicSettings = Database['public']['Tables']['clinic_settings']['Row']

interface SettingsTabsProps {
  clinicSettings: ClinicSettings | null
}

export function SettingsTabs({ clinicSettings }: SettingsTabsProps) {
  return (
    <Tabs defaultValue="clinic-info" className="space-y-6">
      <TabsList>
        <TabsTrigger value="clinic-info">Clinic Info</TabsTrigger>
        <TabsTrigger value="provider-info">Provider Info</TabsTrigger>
        <TabsTrigger value="clinic-logo">Clinic Logo</TabsTrigger>
        <TabsTrigger value="signature">Signature</TabsTrigger>
      </TabsList>

      <TabsContent value="clinic-info">
        <ClinicInfoForm initialData={clinicSettings} />
      </TabsContent>

      <TabsContent value="provider-info">
        <p className="text-sm text-muted-foreground">Provider info settings coming soon.</p>
      </TabsContent>

      <TabsContent value="clinic-logo">
        <p className="text-sm text-muted-foreground">Logo upload coming soon.</p>
      </TabsContent>

      <TabsContent value="signature">
        <p className="text-sm text-muted-foreground">Signature upload coming soon.</p>
      </TabsContent>
    </Tabs>
  )
}
