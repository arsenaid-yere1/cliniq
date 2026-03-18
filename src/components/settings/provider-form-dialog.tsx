'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { providerInfoSchema, type ProviderInfoFormValues } from '@/lib/validations/settings'
import { createProviderProfile, updateProviderProfile } from '@/actions/settings'
import { ProviderSignatureUpload } from './provider-signature-upload'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface ProviderProfile {
  id: string
  display_name: string
  credentials: string | null
  license_number: string | null
  npi_number: string | null
  supervising_provider_id: string | null
  signature_storage_path?: string | null
}

interface ProviderFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  provider?: ProviderProfile | null
  allProviders: Array<{ id: string; display_name: string; credentials: string | null }>
  onSuccess: () => void
}

export function ProviderFormDialog({
  open,
  onOpenChange,
  provider,
  allProviders,
  onSuccess,
}: ProviderFormDialogProps) {
  const isEditing = !!provider
  const [savedProfileId, setSavedProfileId] = useState<string | null>(provider?.id ?? null)

  // Exclude self from supervising provider options
  const supervisingOptions = allProviders.filter((p) => p.id !== provider?.id)

  const form = useForm<ProviderInfoFormValues>({
    resolver: zodResolver(providerInfoSchema),
    defaultValues: {
      display_name: '',
      credentials: '',
      license_number: '',
      npi_number: '',
      supervising_provider_id: '',
    },
    mode: 'onBlur',
  })

  // Reset form when dialog opens (switching between add/edit or different providers)
  useEffect(() => {
    if (open) {
      form.reset({
        display_name: provider?.display_name ?? '',
        credentials: provider?.credentials ?? '',
        license_number: provider?.license_number ?? '',
        npi_number: provider?.npi_number ?? '',
        supervising_provider_id: provider?.supervising_provider_id ?? '',
      })
    }
  }, [open, provider, form])

  // Derive the effective profile ID: provider's ID when editing, or newly created ID
  const effectiveProfileId = provider?.id ?? savedProfileId

  async function onSubmit(values: ProviderInfoFormValues) {
    try {
      if (isEditing && provider) {
        const result = await updateProviderProfile(provider.id, values)
        if ('error' in result && result.error) {
          toast.error(typeof result.error === 'string' ? result.error : 'Validation failed')
          return
        }
        toast.success('Provider updated')
      } else {
        const result = await createProviderProfile(values)
        if ('error' in result && result.error) {
          toast.error(typeof result.error === 'string' ? result.error : 'Validation failed')
          return
        }
        if (result.data) {
          setSavedProfileId(result.data.id)
        }
        toast.success('Provider created')
      }
      onSuccess()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'An unexpected error occurred')
    }
  }

  function handleClose(openState: boolean) {
    onOpenChange(openState)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Provider' : 'Add Provider'}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="display_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Display Name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Dr. Jane Smith" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="credentials"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Credentials</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="MD, DO, DC, NP, etc." />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="license_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>License Number</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="npi_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>NPI Number</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {supervisingOptions.length > 0 && (
              <FormField
                control={form.control}
                name="supervising_provider_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Supervising Provider</FormLabel>
                    <Select
                      value={field.value || 'none'}
                      onValueChange={(v) => field.onChange(v === 'none' ? '' : v)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="None" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {supervisingOptions.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.display_name}{p.credentials ? `, ${p.credentials}` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Saving...' : isEditing ? 'Update Provider' : 'Create Provider'}
            </Button>
          </form>
        </Form>

        {/* Signature section — only available after provider is saved */}
        {effectiveProfileId && (
          <div className="mt-4 border-t pt-4">
            <ProviderSignatureUpload
              profileId={effectiveProfileId}
              initialSignaturePath={provider?.signature_storage_path ?? null}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
