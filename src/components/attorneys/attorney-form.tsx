'use client'

import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { attorneySchema, type AttorneyFormValues } from '@/lib/validations/attorney'
import { createAttorney, updateAttorney } from '@/actions/attorneys'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

interface AttorneyFormProps {
  initialData?: AttorneyFormValues & { id: string }
  onSuccess?: (attorney: { id: string; first_name: string; last_name: string; firm_name?: string | null }) => void
  embedded?: boolean
}

export function AttorneyForm({ initialData, onSuccess, embedded }: AttorneyFormProps) {
  const router = useRouter()
  const isEditing = !!initialData?.id

  const form = useForm<AttorneyFormValues>({
    resolver: zodResolver(attorneySchema),
    defaultValues: {
      first_name: initialData?.first_name ?? '',
      last_name: initialData?.last_name ?? '',
      firm_name: initialData?.firm_name ?? '',
      phone: initialData?.phone ?? '',
      email: initialData?.email ?? '',
      fax: initialData?.fax ?? '',
      address_line1: initialData?.address_line1 ?? '',
      address_line2: initialData?.address_line2 ?? '',
      city: initialData?.city ?? '',
      state: initialData?.state ?? '',
      zip_code: initialData?.zip_code ?? '',
      notes: initialData?.notes ?? '',
    },
    mode: 'onBlur',
  })

  async function onSubmit(values: AttorneyFormValues) {
    const result = isEditing
      ? await updateAttorney(initialData!.id, values)
      : await createAttorney(values)

    if ('error' in result && result.error) {
      toast.error(typeof result.error === 'string' ? result.error : 'Validation failed')
      return
    }

    toast.success(isEditing ? 'Attorney updated' : 'Attorney created')

    if (onSuccess && 'data' in result && result.data) {
      onSuccess(result.data)
    } else {
      router.push('/attorneys')
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="first_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>First Name</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="last_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Last Name</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="firm_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Firm Name (optional)</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Phone (optional)</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email (optional)</FormLabel>
                <FormControl>
                  <Input type="email" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="fax"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Fax (optional)</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="address_line1"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Address Line 1 (optional)</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="address_line2"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Address Line 2 (optional)</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField
            control={form.control}
            name="city"
            render={({ field }) => (
              <FormItem>
                <FormLabel>City (optional)</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="state"
            render={({ field }) => (
              <FormItem>
                <FormLabel>State (optional)</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="zip_code"
            render={({ field }) => (
              <FormItem>
                <FormLabel>ZIP Code (optional)</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notes (optional)</FormLabel>
              <FormControl>
                <Textarea {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex gap-4">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting
              ? 'Saving...'
              : isEditing
                ? 'Update Attorney'
                : 'Create Attorney'}
          </Button>
          {!embedded && (
            <Button type="button" variant="outline" onClick={() => router.push('/attorneys')}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </Form>
  )
}
