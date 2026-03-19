'use client'

import { useFormContext } from 'react-hook-form'
import type { CreatePatientCaseValues } from '@/lib/validations/patient'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Separator } from '@/components/ui/separator'
import { AttorneySelect } from '@/components/attorneys/attorney-select'
import { ProviderSelect } from '@/components/providers/provider-select'

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function WizardStepDetails({ goToStep }: { goToStep: (step: number) => void }) {
  const form = useFormContext<CreatePatientCaseValues>()

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Contact Information</h3>
        <div className="mt-4 space-y-4">
          <FormField
            control={form.control}
            name="phone_primary"
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
        </div>
      </div>

      <Separator />

      <div>
        <h3 className="text-lg font-medium">Case Details</h3>
        <div className="mt-4 space-y-4">
          <FormField
            control={form.control}
            name="accident_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Accident Date (optional)</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="accident_type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Accident Type (optional)</FormLabel>
                <Select onValueChange={field.onChange} value={field.value ?? ''}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="auto">Auto</SelectItem>
                    <SelectItem value="slip_and_fall">Slip and Fall</SelectItem>
                    <SelectItem value="workplace">Workplace</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="accident_description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Accident Description (optional)</FormLabel>
                <FormControl>
                  <Textarea {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </div>

      <Separator />

      <div>
        <h3 className="text-lg font-medium">Attorney</h3>
        <div className="mt-4 space-y-4">
          <FormField
            control={form.control}
            name="attorney_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Attorney</FormLabel>
                <FormControl>
                  <AttorneySelect
                    value={field.value ?? ''}
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="lien_on_file"
            render={({ field }) => (
              <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <FormLabel>Lien on File</FormLabel>
                </div>
              </FormItem>
            )}
          />
        </div>
      </div>

      <Separator />

      <div>
        <h3 className="text-lg font-medium">Provider</h3>
        <div className="mt-4 space-y-4">
          <FormField
            control={form.control}
            name="assigned_provider_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Assigned Provider</FormLabel>
                <FormControl>
                  <ProviderSelect
                    value={field.value ?? ''}
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </div>
    </div>
  )
}
