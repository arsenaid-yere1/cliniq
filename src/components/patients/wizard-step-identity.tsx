'use client'

import { useState } from 'react'
import { useFormContext } from 'react-hook-form'
import { format } from 'date-fns'
import { checkDuplicatePatient } from '@/actions/patients'
import type { CreatePatientCaseValues } from '@/lib/validations/patient'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { CalendarIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DuplicatePatient {
  id: string
  first_name: string
  last_name: string
  date_of_birth: string
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function WizardStepIdentity({ goToStep }: { goToStep: (step: number) => void }) {
  const form = useFormContext<CreatePatientCaseValues>()
  const [duplicates, setDuplicates] = useState<DuplicatePatient[]>([])
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false)

  // This is called by the parent wizard's handleNext via form.trigger
  // We also expose a way to check duplicates after Step 1 validation
  async function onStepComplete() {
    const firstName = form.getValues('first_name')
    const lastName = form.getValues('last_name')
    const dob = form.getValues('date_of_birth')

    if (firstName && lastName && dob) {
      const result = await checkDuplicatePatient(firstName, lastName, dob)
      if (result.duplicates && result.duplicates.length > 0) {
        setDuplicates(result.duplicates)
        setShowDuplicateDialog(true)
      }
    }
  }

  // Trigger duplicate check on blur of the last required field
  function handleDobBlur() {
    const firstName = form.getValues('first_name')
    const lastName = form.getValues('last_name')
    const dob = form.getValues('date_of_birth')
    if (firstName && lastName && dob) {
      onStepComplete()
    }
  }

  return (
    <div className="space-y-4">
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
        name="middle_name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Middle Name (optional)</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="date_of_birth"
        render={({ field }) => (
          <FormItem className="flex flex-col">
            <FormLabel>Date of Birth</FormLabel>
            <div className="flex gap-2">
              <FormControl>
                <Input
                  type="date"
                  {...field}
                  onBlur={() => {
                    field.onBlur()
                    handleDobBlur()
                  }}
                />
              </FormControl>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className={cn(!field.value && 'text-muted-foreground')}
                    type="button"
                  >
                    <CalendarIcon className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={field.value ? new Date(field.value + 'T00:00:00') : undefined}
                    onSelect={(date) => {
                      if (date) {
                        field.onChange(format(date, 'yyyy-MM-dd'))
                        handleDobBlur()
                      }
                    }}
                    defaultMonth={field.value ? new Date(field.value + 'T00:00:00') : undefined}
                    captionLayout="dropdown"
                    fromYear={1920}
                    toYear={new Date().getFullYear()}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="gender"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Gender (optional)</FormLabel>
            <Select onValueChange={field.onChange} value={field.value ?? ''}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
              </FormControl>
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

      {/* Duplicate Detection Dialog */}
      <Dialog open={showDuplicateDialog} onOpenChange={setShowDuplicateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Possible Duplicate Patient</DialogTitle>
            <DialogDescription>
              We found existing patients with the same name and date of birth.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {duplicates.map((dup) => (
              <div key={dup.id} className="rounded-md border p-3">
                <p className="font-medium">
                  {dup.first_name} {dup.last_name}
                </p>
                <p className="text-sm text-muted-foreground">
                  DOB: {dup.date_of_birth}
                </p>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDuplicateDialog(false)}>
              Create New Anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
