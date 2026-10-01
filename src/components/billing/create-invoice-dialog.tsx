'use client'

import { useState, useRef, useEffect } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { Plus, Trash2, Loader2, ArrowUp, ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form'
import { Separator } from '@/components/ui/separator'
import {
  createInvoiceSchema,
  type CreateInvoiceFormValues,
  type InvoiceLineItemFormValues,
} from '@/lib/validations/invoice'
import { createInvoice, updateInvoice } from '@/actions/billing'
import { CptCodeCombobox } from './cpt-code-combobox'
import { invoiceFormErrors } from './invoice-form-errors'

interface InvoiceFormData {
  caseData: {
    id: string
    accident_date: string | null
    patient: {
      first_name: string
      last_name: string
      date_of_birth: string | null
    } | null
    attorney: {
      firm_name: string | null
      phone: string | null
      fax: string | null
      address_line1: string | null
      address_line2: string | null
      city: string | null
      state: string | null
      zip_code: string | null
    } | null
  }
  clinic: {
    clinic_name: string | null
    address_line1: string | null
    address_line2: string | null
    city: string | null
    state: string | null
    zip_code: string | null
    phone: string | null
    fax: string | null
  } | null
  providerProfile: {
    display_name: string | null
    credentials: string | null
    npi_number: string | null
  } | null
  diagnoses: Array<{ icd10_code: string | null; description: string }>
  indication: string
  dischargeDate: string | null
  prePopulatedLineItems: InvoiceLineItemFormValues[]
  facilityLineItems: InvoiceLineItemFormValues[]
  catalogItems: Array<{
    id: string
    cpt_code: string
    description: string
    default_price: number
    sort_order: number
  }>
}

interface ExistingInvoice {
  id: string
  invoice_type: string
  invoice_date: string
  claim_type: string
  indication: string | null
  diagnoses_snapshot: Array<{ icd10_code: string | null; description: string }>
  payee_name: string | null
  payee_address: string | null
  notes: string | null
  line_items: Array<{
    id: string
    procedure_id: string | null
    encounter_id: string | null
    service_date: string | null
    cpt_code: string
    description: string
    quantity: number
    unit_price: number
    total_price: number
  }>
}

interface CreateInvoiceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  caseId: string
  formData: InvoiceFormData
  existingInvoice?: ExistingInvoice | null
}

function emptyLine(): InvoiceLineItemFormValues {
  return { service_date: '', cpt_code: '', description: '', quantity: 1, unit_price: 0, total_price: 0 }
}

function buildClinicAddress(clinic: InvoiceFormData['clinic']) {
  if (!clinic) return ''
  const lines: string[] = []
  if (clinic.address_line1) lines.push(clinic.address_line1)
  if (clinic.address_line2) lines.push(clinic.address_line2)
  const cityStateZip = [clinic.city, clinic.state, clinic.zip_code].filter(Boolean).join(', ')
  if (cityStateZip) lines.push(cityStateZip)
  return lines.join(', ')
}

export function CreateInvoiceDialog(props: CreateInvoiceDialogProps) {
  // Each opening/identity owns a fresh form. Rerenders within a session preserve edits.
  return props.open ? <InvoiceDialogSession key={`${props.caseId}:${props.existingInvoice?.id ?? 'new'}`} {...props} /> : null
}

function InvoiceDialogSession({
  open,
  onOpenChange,
  caseId,
  formData,
  existingInvoice,
}: CreateInvoiceDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const inFlight = useRef(false)
  const summaryRef = useRef<HTMLDivElement>(null)
  const serverFields = useRef<Parameters<typeof form.clearErrors>[0][]>([])
  const focusSummary = useRef(false)
  const isEditing = !!existingInvoice

  const defaultValues: CreateInvoiceFormValues = isEditing
    ? {
        invoice_type: existingInvoice.invoice_type as 'visit' | 'facility',
        invoice_date: existingInvoice.invoice_date,
        claim_type: existingInvoice.claim_type,
        indication: existingInvoice.indication ?? '',
        diagnoses_snapshot: existingInvoice.diagnoses_snapshot ?? [],
        payee_name: existingInvoice.payee_name ?? '',
        payee_address: existingInvoice.payee_address ?? '',
        notes: existingInvoice.notes ?? '',
        line_items: existingInvoice.line_items.map((li) => ({
          id: li.id,
          procedure_id: li.procedure_id ?? '',
          encounter_id: li.encounter_id ?? '',
          service_date: li.service_date ?? '',
          cpt_code: li.cpt_code,
          description: li.description,
          quantity: li.quantity,
          unit_price: li.unit_price,
          total_price: li.total_price,
        })),
      }
    : {
        invoice_type: 'visit',
        invoice_date: formData.dischargeDate ?? format(new Date(), 'yyyy-MM-dd'),
        claim_type: 'Personal Injury',
        indication: formData.indication,
        diagnoses_snapshot: formData.diagnoses,
        payee_name: formData.clinic?.clinic_name ?? '',
        payee_address: buildClinicAddress(formData.clinic),
        notes: '',
        line_items: formData.prePopulatedLineItems.length > 0
          ? formData.prePopulatedLineItems
          : [{ service_date: '', cpt_code: '', description: '', quantity: 1, unit_price: 0, total_price: 0 }],
      }

  const form = useForm({
    resolver: zodResolver(createInvoiceSchema),
    defaultValues: structuredClone(defaultValues),
    shouldFocusError: false,
  })

  const lineItemFields = useFieldArray({ control: form.control, name: 'line_items' })
  const diagnosesFields = useFieldArray({ control: form.control, name: 'diagnoses_snapshot' })

  const watchedInvoiceType = form.watch('invoice_type')
  const watchedLineItems = form.watch('line_items')
  const runningTotal = watchedLineItems.reduce((sum, item) => sum + (Number(item.total_price) || 0), 0)

  const lineDrafts = useRef({
    visit: structuredClone(defaultValues.line_items),
    facility: structuredClone(formData.facilityLineItems.length ? formData.facilityLineItems : [emptyLine()]),
  })
  const errors = invoiceFormErrors(form.formState.errors)
  useEffect(() => {
    if (!isSubmitting && focusSummary.current && errors.length) {
      focusSummary.current = false
      summaryRef.current?.focus()
    }
  }, [isSubmitting, errors])

  function clearServerErrors() {
    for (const field of serverFields.current) form.clearErrors(field)
    serverFields.current = []
    form.clearErrors('root')
  }

  function editRows(change: () => void) {
    if (inFlight.current) return
    clearServerErrors()
    change()
  }

  function changeType(type: 'visit' | 'facility') {
    if (inFlight.current || type === form.getValues('invoice_type')) return
    clearServerErrors()
    if (!isEditing) {
      // getValues retains source/persisted IDs; field-array IDs are rendering keys only.
      lineDrafts.current[form.getValues('invoice_type')] = structuredClone(form.getValues('line_items')) as InvoiceLineItemFormValues[]
      lineItemFields.replace(structuredClone(lineDrafts.current[type]))
      form.clearErrors('line_items')
    }
    form.setValue('invoice_type', type, { shouldDirty: true })
    if (form.formState.isSubmitted) void form.trigger()
  }

  function handleQuantityOrPriceChange(index: number) {
    if (inFlight.current) return
    const qty = Number(form.getValues(`line_items.${index}.quantity`)) || 0
    const price = Number(form.getValues(`line_items.${index}.unit_price`)) || 0
    form.setValue(`line_items.${index}.total_price`, qty * price)
  }

  async function handleSave(values: CreateInvoiceFormValues) {
    const snapshot = structuredClone(values)
    setIsSubmitting(true)
    const result = isEditing
      ? await updateInvoice(existingInvoice!.id, caseId, snapshot)
      : await createInvoice(caseId, snapshot)
    if (result.error) {
      if (typeof result.error === 'string') {
        form.setError('root.server', { message: result.error })
      } else {
        for (const [key, messages] of Object.entries(result.error)) {
          if (!messages?.length) continue
          const field = key as keyof CreateInvoiceFormValues
          form.setError(field, { type: 'server', message: messages.join('. ') })
          serverFields.current.push(field)
        }
      }
      focusSummary.current = true
      toast.error('Invoice was not saved. Review the errors and retry.')
      return false
    }
    toast.success(isEditing ? 'Invoice updated' : 'Invoice created')
    onOpenChange(false)
    return true
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current) return
    inFlight.current = true
    clearServerErrors()
    let succeeded = false
    try {
      await form.handleSubmit(async values => { succeeded = await handleSave(values) }, invalid => {
        const first = invoiceFormErrors(invalid).find(error => error.field)
        if (first?.field) form.setFocus(first.field)
        else focusSummary.current = true
      })(event)
    } catch {
      form.setError('root.server', { message: 'Unable to save the invoice. Your entries are retained; please retry.' })
      focusSummary.current = true
      toast.error('Unable to save the invoice. Please retry.')
    } finally {
      inFlight.current = succeeded
      setIsSubmitting(false)
    }
  }

  const patient = formData.caseData.patient
  const attorney = formData.caseData.attorney
  const provider = formData.providerProfile

  return (
    <Dialog open={open} onOpenChange={value => { if (!inFlight.current) onOpenChange(value) }}>
      <DialogContent showCloseButton={!isSubmitting} className="w-[calc(100vw-2rem)] sm:max-w-3xl max-h-[85vh] overflow-y-auto p-4 sm:p-6 [overflow-wrap:anywhere]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit' : 'Create'} {watchedInvoiceType === 'facility' ? 'Medical Facility Invoice' : 'Medical Invoice'}
          </DialogTitle>
          <DialogDescription>Review the invoice details and line items before saving.</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form noValidate onSubmit={submit} onChangeCapture={event => { if (inFlight.current) { event.preventDefault(); event.stopPropagation() } else clearServerErrors() }} className="min-w-0">
            {errors.length > 0 && <div ref={summaryRef} tabIndex={-1} role="alert" aria-label="Invoice errors" className="mb-6 rounded-md border border-destructive p-3 text-sm scroll-m-4">
              <p className="font-medium">Review these invoice errors</p>
              <ul className="mt-2 space-y-1">
                {errors.map(error => <li key={error.key}>
                  {error.field ? <button type="button" className="text-left underline" disabled={isSubmitting} onClick={() => { if (!inFlight.current) form.setFocus(error.field!) }}>{error.label}: {error.message}</button> : <span>{error.label}: {error.message}</span>}
                </li>)}
              </ul>
            </div>}
            <fieldset disabled={isSubmitting} className="min-w-0 space-y-6" aria-busy={isSubmitting}>
            {/* Invoice Type & Date */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="invoice_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Invoice Type</FormLabel>
                    <Select disabled={isSubmitting} value={field.value} onValueChange={value => changeType(value as 'visit' | 'facility')}>
                      <FormControl><SelectTrigger ref={field.ref} onBlur={field.onBlur}><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="visit">Medical Invoice</SelectItem>
                        <SelectItem value="facility">Medical Facility Invoice</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="invoice_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Invoice Date</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="claim_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Claim Type</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            {/* Patient & Case Info (read-only display) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
              <div className="space-y-1">
                <h3 className="text-sm font-medium text-muted-foreground">Patient</h3>
                {patient ? (
                  <>
                    <p className="text-sm font-medium">{patient.first_name} {patient.last_name}</p>
                    {patient.date_of_birth && (
                      <p className="text-xs text-muted-foreground">
                        DOB: {format(new Date(patient.date_of_birth + 'T00:00:00'), 'MM/dd/yyyy')}
                      </p>
                    )}
                  </>
                ) : <p className="text-sm text-muted-foreground">N/A</p>}
                {formData.caseData.accident_date && (
                  <p className="text-xs text-muted-foreground">
                    Date of Injury: {format(new Date(formData.caseData.accident_date + 'T00:00:00'), 'MM/dd/yyyy')}
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <h3 className="text-sm font-medium text-muted-foreground">Provider</h3>
                {provider ? (
                  <>
                    <p className="text-sm font-medium">
                      {provider.display_name}{provider.credentials ? `, ${provider.credentials}` : ''}
                    </p>
                    {provider.npi_number && <p className="text-xs text-muted-foreground">NPI: {provider.npi_number}</p>}
                  </>
                ) : <p className="text-sm text-muted-foreground">No provider profile configured</p>}
                {formData.clinic?.clinic_name && (
                  <p className="text-xs text-muted-foreground">Facility: {formData.clinic.clinic_name}</p>
                )}
              </div>

              <div className="space-y-1">
                <h3 className="text-sm font-medium text-muted-foreground">Attorney</h3>
                {attorney ? (
                  <>
                    {attorney.firm_name && <p className="text-sm font-medium">{attorney.firm_name}</p>}
                    {(attorney.address_line1 || attorney.city) && (
                      <p className="text-xs text-muted-foreground">
                        {[attorney.address_line1, attorney.address_line2, attorney.city, attorney.state, attorney.zip_code].filter(Boolean).join(', ')}
                      </p>
                    )}
                    {attorney.phone && <p className="text-xs text-muted-foreground">Phone: {attorney.phone}</p>}
                    {attorney.fax && <p className="text-xs text-muted-foreground">Fax: {attorney.fax}</p>}
                  </>
                ) : <p className="text-sm text-muted-foreground">N/A</p>}
              </div>
            </div>

            <Separator />

            {/* Indication */}
            <FormField
              control={form.control}
              name="indication"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Indication</FormLabel>
                  <FormControl>
                    <Textarea rows={2} placeholder="Clinical indication..." {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Diagnoses */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Diagnoses</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => editRows(() => diagnosesFields.append({ icd10_code: '', description: '' }))}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Diagnosis
                </Button>
              </div>

              {diagnosesFields.fields.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">
                  No diagnoses.
                </p>
              )}

              {diagnosesFields.fields.map((field, index) => (
                <div key={field.id} className="flex flex-wrap sm:flex-nowrap items-start gap-2">
                  <FormField
                    control={form.control}
                    name={`diagnoses_snapshot.${index}.icd10_code`}
                    render={({ field }) => (
                      <FormItem className="w-full min-w-0 sm:w-32">
                        <FormControl>
                          <Input
                            aria-label={`Diagnosis ${index + 1} ICD-10`} placeholder="ICD-10"
                            {...field}
                            value={field.value ?? ''}
                            onChange={(e) => field.onChange(e.target.value || null)}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`diagnoses_snapshot.${index}.description`}
                    render={({ field }) => (
                      <FormItem className="min-w-0 flex-1">
                        <FormControl><Input aria-label={`Diagnosis ${index + 1} description`} placeholder="Description" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label={`Remove diagnosis ${index + 1}`} onClick={() => editRows(() => diagnosesFields.remove(index))}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>

            <Separator />

            {/* Line Items */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Line Items</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => editRows(() => lineItemFields.append({
                    procedure_id: '',
                    encounter_id: '',
                    service_date: '',
                    cpt_code: '',
                    description: '',
                    quantity: 1,
                    unit_price: 0,
                    total_price: 0,
                  }))}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Line Item
                </Button>
              </div>

              {lineItemFields.fields.map((field, index) => (
                <div key={field.id} className="rounded-lg border p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Item {index + 1}</span>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => editRows(() => lineItemFields.move(index, index - 1))}
                        disabled={index === 0}
                        aria-label={`Move item ${index + 1} up`}
                      >
                        <ArrowUp className="h-3 w-3" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => editRows(() => lineItemFields.move(index, index + 1))}
                        disabled={index === lineItemFields.fields.length - 1}
                        aria-label={`Move item ${index + 1} down`}
                      >
                        <ArrowDown className="h-3 w-3" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => editRows(() => lineItemFields.remove(index))}
                        disabled={lineItemFields.fields.length <= 1}
                        aria-label={`Remove item ${index + 1}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <FormField
                      control={form.control}
                      name={`line_items.${index}.service_date`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs"><span className="sr-only">Item {index + 1} </span>Date</FormLabel>
                          <FormControl><Input type="date" className="text-xs" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`line_items.${index}.cpt_code`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs"><span className="sr-only">Item {index + 1} </span>CPT</FormLabel>
                          <FormControl>
                            <CptCodeCombobox
                              ref={field.ref}
                              name={field.name}
                              onBlur={field.onBlur}
                              disabled={isSubmitting}
                              value={field.value}
                              onChange={value => { if (!inFlight.current) field.onChange(value) }}
                              catalogItems={formData.catalogItems}
                              className="text-xs"
                              onSelect={(item) => {
                                if (inFlight.current) return
                                clearServerErrors()
                                field.onChange(item.cpt_code)
                                form.setValue(`line_items.${index}.description`, item.description, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })
                                form.setValue(`line_items.${index}.unit_price`, item.default_price, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })
                                handleQuantityOrPriceChange(index)
                              }}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name={`line_items.${index}.description`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs"><span className="sr-only">Item {index + 1} </span>Description</FormLabel>
                        <FormControl><Input className="text-xs" placeholder="Description" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <FormField
                      control={form.control}
                      name={`line_items.${index}.quantity`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs"><span className="sr-only">Item {index + 1} </span>QTY</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min={1}
                              className="text-xs"
                              {...field}
                              value={field.value as number}
                              onChange={(e) => {
                                if (inFlight.current) return
                                field.onChange(e)
                                handleQuantityOrPriceChange(index)
                              }}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`line_items.${index}.unit_price`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs"><span className="sr-only">Item {index + 1} </span>Unit Price</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.01"
                              min={0}
                              className="text-xs"
                              {...field}
                              value={field.value as number}
                              onChange={(e) => {
                                if (inFlight.current) return
                                field.onChange(e)
                                handleQuantityOrPriceChange(index)
                              }}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div>
                      <p className="text-xs font-medium mb-2">Total</p>
                      <div className="flex items-center h-9 text-xs font-medium">
                        ${Number(form.watch(`line_items.${index}.total_price`) ?? 0).toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Running Total */}
              <div className="flex justify-end">
                <div className="text-sm font-semibold">
                  Total: ${runningTotal.toFixed(2)}
                </div>
              </div>
            </div>

            <Separator />

            {/* Payee */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="payee_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Make Check Payable To</FormLabel>
                    <FormControl><Input placeholder="Payee name" {...field} value={field.value ?? ''} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="payee_address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payee Address</FormLabel>
                    <FormControl><Input placeholder="Payee address" {...field} value={field.value ?? ''} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Notes */}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea rows={2} placeholder="Optional notes..." {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { if (!inFlight.current) onOpenChange(false) }}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                {isEditing ? 'Update Invoice' : 'Create Invoice'}
              </Button>
            </DialogFooter>
            </fieldset>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
