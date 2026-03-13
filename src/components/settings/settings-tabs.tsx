'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ClinicInfoForm } from './clinic-info-form'
import { ProviderInfoForm } from './provider-info-form'
import { ClinicLogoUpload } from './clinic-logo-upload'
import { ProviderSignatureUpload } from './provider-signature-upload'
import { AppearanceForm } from './appearance-form'
import { PricingCatalogForm } from './pricing-catalog-form'
import type { Database } from '@/types/database'

type ClinicSettings = Database['public']['Tables']['clinic_settings']['Row']
type ProviderProfile = Database['public']['Tables']['provider_profiles']['Row']
type ServiceCatalogItem = Database['public']['Tables']['service_catalog']['Row']

interface SettingsTabsProps {
  clinicSettings: ClinicSettings | null
  providerProfile: ProviderProfile | null
  serviceCatalog: ServiceCatalogItem[]
}

export function SettingsTabs({ clinicSettings, providerProfile, serviceCatalog }: SettingsTabsProps) {
  return (
    <Tabs defaultValue="clinic-info" className="space-y-6">
      <TabsList>
        <TabsTrigger value="clinic-info">Clinic Info</TabsTrigger>
        <TabsTrigger value="provider-info">Provider Info</TabsTrigger>
        <TabsTrigger value="clinic-logo">Clinic Logo</TabsTrigger>
        <TabsTrigger value="signature">Signature</TabsTrigger>
        <TabsTrigger value="pricing">Pricing</TabsTrigger>
        <TabsTrigger value="appearance">Appearance</TabsTrigger>
      </TabsList>

      <TabsContent value="clinic-info">
        <ClinicInfoForm initialData={clinicSettings} />
      </TabsContent>

      <TabsContent value="provider-info">
        <ProviderInfoForm initialData={providerProfile} />
      </TabsContent>

      <TabsContent value="clinic-logo">
        <ClinicLogoUpload initialLogoPath={clinicSettings?.logo_storage_path ?? null} />
      </TabsContent>

      <TabsContent value="signature">
        <ProviderSignatureUpload initialSignaturePath={providerProfile?.signature_storage_path ?? null} />
      </TabsContent>

      <TabsContent value="pricing">
        <PricingCatalogForm initialData={serviceCatalog} />
      </TabsContent>

      <TabsContent value="appearance">
        <AppearanceForm />
      </TabsContent>
    </Tabs>
  )
}
