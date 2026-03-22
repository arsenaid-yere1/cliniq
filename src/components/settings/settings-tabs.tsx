'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ClinicInfoForm } from './clinic-info-form'
import { ProviderList } from './provider-list'
import { ClinicLogoUpload } from './clinic-logo-upload'
import { AppearanceForm } from './appearance-form'
import { PricingCatalogForm } from './pricing-catalog-form'
import { FeeEstimateForm } from './fee-estimate-form'
import type { Database } from '@/types/database'

type ClinicSettings = Database['public']['Tables']['clinic_settings']['Row']
type ServiceCatalogItem = Database['public']['Tables']['service_catalog']['Row']
type FeeEstimateConfigItem = Database['public']['Tables']['fee_estimate_config']['Row']

interface ProviderProfile {
  id: string
  user_id: string | null
  display_name: string
  credentials: string | null
  license_number: string | null
  npi_number: string | null
  supervising_provider_id: string | null
  signature_storage_path: string | null
}

interface SettingsTabsProps {
  clinicSettings: ClinicSettings | null
  serviceCatalog: ServiceCatalogItem[]
  feeEstimateConfig: FeeEstimateConfigItem[]
  providerProfiles: ProviderProfile[]
}

export function SettingsTabs({ clinicSettings, serviceCatalog, feeEstimateConfig, providerProfiles }: SettingsTabsProps) {
  return (
    <Tabs defaultValue="clinic-info" className="space-y-6">
      <TabsList>
        <TabsTrigger value="clinic-info">Clinic Info</TabsTrigger>
        <TabsTrigger value="provider-info">Provider Info</TabsTrigger>
        <TabsTrigger value="clinic-logo">Clinic Logo</TabsTrigger>
        <TabsTrigger value="pricing">Pricing</TabsTrigger>
        <TabsTrigger value="fee-estimates">Fee Estimates</TabsTrigger>
        <TabsTrigger value="appearance">Appearance</TabsTrigger>
      </TabsList>

      <TabsContent value="clinic-info">
        <ClinicInfoForm initialData={clinicSettings} />
      </TabsContent>

      <TabsContent value="provider-info">
        <ProviderList providers={providerProfiles} />
      </TabsContent>

      <TabsContent value="clinic-logo">
        <ClinicLogoUpload initialLogoPath={clinicSettings?.logo_storage_path ?? null} />
      </TabsContent>

      <TabsContent value="pricing">
        <PricingCatalogForm initialData={serviceCatalog} />
      </TabsContent>

      <TabsContent value="fee-estimates">
        <FeeEstimateForm initialData={feeEstimateConfig} />
      </TabsContent>

      <TabsContent value="appearance">
        <AppearanceForm />
      </TabsContent>
    </Tabs>
  )
}
