'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { providerInfoSchema, type ProviderInfoFormValues } from '@/lib/validations/settings'
import { updateProviderProfile } from '@/actions/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import type { Database } from '@/types/database'

type ProviderProfile = Database['public']['Tables']['provider_profiles']['Row']

interface ProviderInfoFormProps {
  initialData: ProviderProfile | null
}

export function ProviderInfoForm({ initialData }: ProviderInfoFormProps) {
  const form = useForm<ProviderInfoFormValues>({
    resolver: zodResolver(providerInfoSchema),
    defaultValues: {
      display_name: initialData?.display_name ?? '',
      credentials: initialData?.credentials ?? '',
      license_number: initialData?.license_number ?? '',
      npi_number: initialData?.npi_number ?? '',
    },
    mode: 'onBlur',
  })

  async function onSubmit(values: ProviderInfoFormValues) {
    const result = await updateProviderProfile(values)

    if ('error' in result && result.error) {
      toast.error(typeof result.error === 'string' ? result.error : 'Validation failed')
      return
    }

    toast.success('Provider information saved')
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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

        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Saving...' : 'Save Provider Info'}
        </Button>
      </form>
    </Form>
  )
}
