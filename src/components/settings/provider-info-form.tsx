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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Database } from '@/types/database'

type ProviderProfile = Database['public']['Tables']['provider_profiles']['Row']

interface ProviderOption {
  id: string
  user_id: string | null
  display_name: string
  credentials: string | null
}

interface ProviderInfoFormProps {
  initialData: ProviderProfile | null
  providerProfiles: ProviderOption[]
}

export function ProviderInfoForm({ initialData, providerProfiles }: ProviderInfoFormProps) {
  // Exclude self from supervising provider options
  const supervisingOptions = providerProfiles.filter(
    (p) => p.id !== initialData?.id
  )

  const form = useForm<ProviderInfoFormValues>({
    resolver: zodResolver(providerInfoSchema),
    defaultValues: {
      display_name: initialData?.display_name ?? '',
      credentials: initialData?.credentials ?? '',
      license_number: initialData?.license_number ?? '',
      npi_number: initialData?.npi_number ?? '',
      supervising_provider_id: initialData?.supervising_provider_id ?? '',
    },
    mode: 'onBlur',
  })

  async function onSubmit(values: ProviderInfoFormValues) {
    if (!initialData?.id) return

    const result = await updateProviderProfile(initialData.id, values)

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

        {supervisingOptions.length > 0 && (
          <FormField
            control={form.control}
            name="supervising_provider_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Supervising Provider</FormLabel>
                <Select
                  value={field.value ?? ''}
                  onValueChange={field.onChange}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
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
          {form.formState.isSubmitting ? 'Saving...' : 'Save Provider Info'}
        </Button>
      </form>
    </Form>
  )
}
