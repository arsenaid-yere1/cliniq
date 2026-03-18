'use client'

import { useState, use } from 'react'
import { listProviderProfiles, createProviderProfile } from '@/actions/settings'
import { providerInfoSchema, type ProviderInfoFormValues } from '@/lib/validations/settings'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
import { Plus } from 'lucide-react'

interface Provider {
  id: string
  display_name: string
  credentials: string | null
}

interface ProviderSelectProps {
  value: string
  onChange: (value: string) => void
  initialProviders?: Provider[]
}

// Stable promise for initial load — created once per module
let initialLoadPromise: Promise<Provider[]> | null = null

function getInitialProviders(): Promise<Provider[]> {
  if (!initialLoadPromise) {
    initialLoadPromise = listProviderProfiles().then((r) => r.data ?? [])
  }
  return initialLoadPromise
}

export function ProviderSelect({ value, onChange, initialProviders }: ProviderSelectProps) {
  const loaded = initialProviders ?? use(getInitialProviders())
  const [providers, setProviders] = useState<Provider[]>(loaded)
  const [showAddDialog, setShowAddDialog] = useState(false)

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

  async function handleAddProvider(values: ProviderInfoFormValues) {
    const result = await createProviderProfile(values)
    if ('error' in result && result.error) {
      toast.error(typeof result.error === 'string' ? result.error : 'Validation failed')
      return
    }
    if (result.data) {
      const newProvider: Provider = {
        id: result.data.id,
        display_name: result.data.display_name,
        credentials: result.data.credentials,
      }
      setProviders((prev) => [...prev, newProvider])
      onChange(result.data.id)
    }
    toast.success('Provider created')
    setShowAddDialog(false)
    form.reset()
  }

  return (
    <div className="flex gap-2">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="flex-1">
          <SelectValue placeholder="Select provider" />
        </SelectTrigger>
        <SelectContent>
          {providers.map((provider) => (
            <SelectItem key={provider.id} value={provider.id}>
              {provider.display_name}{provider.credentials ? `, ${provider.credentials}` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="button" variant="outline" size="icon" onClick={() => setShowAddDialog(true)}>
        <Plus className="h-4 w-4" />
      </Button>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add New Provider</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleAddProvider)} className="space-y-4">
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
                {form.formState.isSubmitting ? 'Creating...' : 'Create Provider'}
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
