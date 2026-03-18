'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form'
import { Checkbox } from '@/components/ui/checkbox'
import { editPatientSchema, editCaseSchema, type EditPatientValues, type EditCaseValues } from '@/lib/validations/patient'
import { updatePatient, updateCase } from '@/actions/patients'
import { AttorneySelect } from '@/components/attorneys/attorney-select'
import { ProviderSelect } from '@/components/providers/provider-select'
import { z } from 'zod'

const combinedSchema = editPatientSchema.merge(editCaseSchema)
type CombinedValues = z.infer<typeof combinedSchema>

interface CaseOverviewEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  caseId: string
  patientId: string
  patient: {
    first_name: string
    last_name: string
    middle_name: string | null
    date_of_birth: string
    gender: string | null
    phone_primary: string | null
    email: string | null
    address_line1: string | null
    address_line2: string | null
    city: string | null
    state: string | null
    zip_code: string | null
  }
  caseDetails: {
    accident_date: string | null
    accident_type: string | null
    accident_description: string | null
    attorney_id: string | null
    assigned_provider_id: string | null
    lien_on_file: boolean
  }
}

export function CaseOverviewEditDialog({
  open,
  onOpenChange,
  caseId,
  patientId,
  patient,
  caseDetails,
}: CaseOverviewEditDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<CombinedValues>({
    resolver: zodResolver(combinedSchema),
    defaultValues: {
      first_name: patient.first_name,
      last_name: patient.last_name,
      middle_name: patient.middle_name ?? '',
      date_of_birth: patient.date_of_birth,
      gender: (patient.gender as CombinedValues['gender']) ?? undefined,
      phone_primary: patient.phone_primary ?? '',
      email: patient.email ?? '',
      address_line1: patient.address_line1 ?? '',
      address_line2: patient.address_line2 ?? '',
      city: patient.city ?? '',
      state: patient.state ?? '',
      zip_code: patient.zip_code ?? '',
      accident_date: caseDetails.accident_date ?? '',
      accident_type: (caseDetails.accident_type as CombinedValues['accident_type']) ?? undefined,
      accident_description: caseDetails.accident_description ?? '',
      attorney_id: caseDetails.attorney_id ?? '',
      assigned_provider_id: caseDetails.assigned_provider_id ?? '',
      lien_on_file: caseDetails.lien_on_file ?? false,
    },
  })

  async function handleSave(values: CombinedValues) {
    setIsSubmitting(true)

    const patientData: EditPatientValues = {
      first_name: values.first_name,
      last_name: values.last_name,
      middle_name: values.middle_name,
      date_of_birth: values.date_of_birth,
      gender: values.gender,
      phone_primary: values.phone_primary,
      email: values.email,
      address_line1: values.address_line1,
      address_line2: values.address_line2,
      city: values.city,
      state: values.state,
      zip_code: values.zip_code,
    }

    const caseData: EditCaseValues = {
      accident_date: values.accident_date,
      accident_type: values.accident_type,
      accident_description: values.accident_description,
      attorney_id: values.attorney_id,
      assigned_provider_id: values.assigned_provider_id,
      lien_on_file: values.lien_on_file,
    }

    const [patientResult, caseResult] = await Promise.all([
      updatePatient(patientId, patientData),
      updateCase(caseId, caseData),
    ])

    setIsSubmitting(false)

    if (patientResult.error || caseResult.error) {
      const msg = typeof patientResult.error === 'string'
        ? patientResult.error
        : typeof caseResult.error === 'string'
          ? caseResult.error
          : 'Validation failed'
      toast.error(msg)
    } else {
      toast.success('Case details updated')
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Case Details</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSave)} className="space-y-6">
            {/* Patient Demographics */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">Patient Demographics</h3>

              <div className="grid grid-cols-3 gap-3">
                <FormField
                  control={form.control}
                  name="first_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">First Name</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="middle_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Middle Name</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="last_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Last Name</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="date_of_birth"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Date of Birth</FormLabel>
                      <FormControl><Input type="date" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="gender"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Gender</FormLabel>
                      <Select value={field.value ?? ''} onValueChange={(v) => field.onChange(v || undefined)}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="male">Male</SelectItem>
                          <SelectItem value="female">Female</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                          <SelectItem value="prefer_not_to_say">Prefer not to say</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="phone_primary"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Phone</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Email</FormLabel>
                      <FormControl><Input type="email" {...field} /></FormControl>
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
                    <FormLabel className="text-xs">Address Line 1</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="address_line2"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Address Line 2</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-3 gap-3">
                <FormField
                  control={form.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">City</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="state"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">State</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="zip_code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Zip Code</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Case Details */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">Case Details</h3>

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="accident_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Accident Date</FormLabel>
                      <FormControl><Input type="date" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="accident_type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Accident Type</FormLabel>
                      <Select value={field.value ?? ''} onValueChange={(v) => field.onChange(v || undefined)}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="auto">Auto Accident</SelectItem>
                          <SelectItem value="slip_and_fall">Slip and Fall</SelectItem>
                          <SelectItem value="workplace">Workplace Injury</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="accident_description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Accident Description</FormLabel>
                    <FormControl><Textarea rows={3} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="attorney_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Attorney</FormLabel>
                    <FormControl>
                      <AttorneySelect value={field.value ?? ''} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="assigned_provider_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Assigned Provider</FormLabel>
                    <FormControl>
                      <ProviderSelect value={field.value ?? ''} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="lien_on_file"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center gap-2">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel className="text-sm !mt-0">Lien on file</FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
