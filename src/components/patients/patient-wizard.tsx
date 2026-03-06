'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { createPatientCaseSchema, type CreatePatientCaseValues } from '@/lib/validations/patient'
import { createPatientCase } from '@/actions/patients'
import { WizardStepIdentity } from './wizard-step-identity'
import { WizardStepDetails } from './wizard-step-details'
import { WizardStepReview } from './wizard-step-review'
import { Button } from '@/components/ui/button'

const STEPS = [
  { label: 'Patient Identity', component: WizardStepIdentity },
  { label: 'Contact & Case Details', component: WizardStepDetails },
  { label: 'Review & Confirm', component: WizardStepReview },
]

const STEP_FIELDS: (keyof CreatePatientCaseValues)[][] = [
  ['first_name', 'last_name', 'middle_name', 'date_of_birth', 'gender'],
  ['phone_primary', 'email', 'address_line1', 'address_line2', 'city', 'state', 'zip_code', 'accident_date', 'accident_type', 'accident_description', 'attorney_id', 'lien_on_file'],
  [],
]

export function PatientWizard() {
  const router = useRouter()
  const [currentStep, setCurrentStep] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<CreatePatientCaseValues>({
    resolver: zodResolver(createPatientCaseSchema),
    defaultValues: {
      first_name: '',
      last_name: '',
      middle_name: '',
      date_of_birth: '',
      gender: undefined,
      phone_primary: '',
      email: '',
      address_line1: '',
      address_line2: '',
      city: '',
      state: '',
      zip_code: '',
      accident_date: '',
      accident_type: undefined,
      accident_description: '',
      attorney_id: '',
      lien_on_file: false,
    },
    mode: 'onBlur',
  })

  async function handleNext() {
    const fields = STEP_FIELDS[currentStep]
    const valid = await form.trigger(fields)
    if (!valid) return
    setCurrentStep((s) => s + 1)
  }

  function handleBack() {
    setCurrentStep((s) => s - 1)
  }

  function goToStep(step: number) {
    setCurrentStep(step)
  }

  async function handleSubmit() {
    const values = form.getValues()
    setIsSubmitting(true)

    const result = await createPatientCase(values)

    if ('error' in result && result.error) {
      toast.error(typeof result.error === 'string' ? result.error : 'Validation failed')
      setIsSubmitting(false)
      return
    }

    if ('data' in result && result.data) {
      toast.success(`Case ${result.data.case_number} created`)
      router.push(`/patients/${result.data.id}`)
    }
  }

  const StepComponent = STEPS[currentStep].component

  return (
    <div className="max-w-2xl space-y-8">
      {/* Progress Bar */}
      <nav aria-label="Wizard progress">
        <ol className="flex items-center gap-2">
          {STEPS.map((step, i) => (
            <li key={step.label} className="flex items-center gap-2 flex-1">
              <div className="flex items-center gap-2 flex-1">
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium ${
                    i < currentStep
                      ? 'bg-primary text-primary-foreground'
                      : i === currentStep
                        ? 'bg-primary text-primary-foreground'
                        : 'border-2 border-muted-foreground/30 text-muted-foreground'
                  }`}
                >
                  {i < currentStep ? '✓' : i + 1}
                </div>
                <span
                  className={`text-sm hidden sm:inline ${
                    i <= currentStep ? 'font-medium' : 'text-muted-foreground'
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`h-0.5 flex-1 ${
                    i < currentStep ? 'bg-primary' : 'bg-muted-foreground/30'
                  }`}
                />
              )}
            </li>
          ))}
        </ol>
      </nav>

      {/* Step Content */}
      <FormProvider {...form}>
        <StepComponent goToStep={goToStep} />
      </FormProvider>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button
          type="button"
          variant="outline"
          onClick={handleBack}
          disabled={currentStep === 0}
        >
          Back
        </Button>
        {currentStep < STEPS.length - 1 ? (
          <Button type="button" onClick={handleNext}>
            Next
          </Button>
        ) : (
          <Button type="button" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? 'Creating...' : 'Create Patient Case'}
          </Button>
        )}
      </div>
    </div>
  )
}
