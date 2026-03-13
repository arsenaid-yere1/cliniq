'use client'

import { useState } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { Plus, Trash2, Loader2 } from 'lucide-react'
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
import { Separator } from '@/components/ui/separator'
import {
  createInvoiceSchema,
  type CreateInvoiceFormValues,
  type InvoiceLineItemFormValues,
} from '@/lib/validations/invoice'
import { createInvoice, updateInvoice } from '@/actions/billing'

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
      first_name: string
      last_name: string
      firm_name: string | null
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
  prePopulatedLineItems: InvoiceLineItemFormValues[]
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

function buildClinicAddress(clinic: InvoiceFormData['clinic']) {
  if (!clinic) return ''
  const lines: string[] = []
  if (clinic.address_line1) lines.push(clinic.address_line1)
  if (clinic.address_line2) lines.push(clinic.address_line2)
  const cityStateZip = [clinic.city, clinic.state, clinic.zip_code].filter(Boolean).join(', ')
  if (cityStateZip) lines.push(cityStateZip)
  return lines.join(', ')
}

export function CreateInvoiceDialog({
  open,
  onOpenChange,
  caseId,
  formData,
  existingInvoice,
}: CreateInvoiceDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
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
        invoice_date: format(new Date(), 'yyyy-MM-dd'),
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
    defaultValues,
  })

  const lineItemFields = useFieldArray({ control: form.control, name: 'line_items' })
  const diagnosesFields = useFieldArray({ control: form.control, name: 'diagnoses_snapshot' })

  const watchedInvoiceType = form.watch('invoice_type')
  const watchedLineItems = form.watch('line_items')
  const runningTotal = watchedLineItems.reduce((sum, item) => sum + (Number(item.total_price) || 0), 0)

  function handleQuantityOrPriceChange(index: number) {
    const qty = Number(form.getValues(`line_items.${index}.quantity`)) || 0
    const price = Number(form.getValues(`line_items.${index}.unit_price`)) || 0
    form.setValue(`line_items.${index}.total_price`, qty * price)
  }

  async function handleSave(values: Record<string, unknown>) {
    const typedValues = values as CreateInvoiceFormValues
    setIsSubmitting(true)
    const result = isEditing
      ? await updateInvoice(existingInvoice!.id, caseId, typedValues)
      : await createInvoice(caseId, typedValues)
    setIsSubmitting(false)

    if (result.error) {
      toast.error(typeof result.error === 'string' ? result.error : 'Validation failed')
    } else {
      toast.success(isEditing ? 'Invoice updated' : 'Invoice created')
      onOpenChange(false)
    }
  }

  const patient = formData.caseData.patient
  const attorney = formData.caseData.attorney
  const provider = formData.providerProfile

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit' : 'Create'} {watchedInvoiceType === 'facility' ? 'Medical Facility Invoice' : 'Medical Invoice'}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSave)} className="space-y-6 min-w-0">
            {/* Invoice Type & Date */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="invoice_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Invoice Type</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
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
                    <p className="text-sm font-medium">{attorney.first_name} {attorney.last_name}</p>
                    {attorney.firm_name && <p className="text-xs text-muted-foreground">{attorney.firm_name}</p>}
                    {(attorney.address_line1 || attorney.city) && (
                      <p className="text-xs text-muted-foreground">
                        {[attorney.address_line1, attorney.address_line2, attorney.city, attorney.state, attorney.zip_code].filter(Boolean).join(', ')}
                      </p>
                    )}
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
                <FormLabel>Diagnoses</FormLabel>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => diagnosesFields.append({ icd10_code: '', description: '' })}
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
                <div key={field.id} className="flex items-start gap-2">
                  <FormField
                    control={form.control}
                    name={`diagnoses_snapshot.${index}.icd10_code`}
                    render={({ field }) => (
                      <FormItem className="w-32">
                        <FormControl>
                          <Input
                            placeholder="ICD-10"
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
                      <FormItem className="flex-1">
                        <FormControl><Input placeholder="Description" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => diagnosesFields.remove(index)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>

            <Separator />

            {/* Line Items */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <FormLabel>Line Items</FormLabel>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => lineItemFields.append({
                    service_date: '',
                    cpt_code: '',
                    description: '',
                    quantity: 1,
                    unit_price: 0,
                    total_price: 0,
                  })}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Line Item
                </Button>
              </div>

              <div className="overflow-x-auto -mx-1 px-1">
                {/* Table header */}
                <div className="grid grid-cols-[minmax(100px,1fr)_70px_minmax(120px,2fr)_50px_90px_90px_36px] gap-2 text-xs font-medium text-muted-foreground px-1">
                  <span>Date</span>
                  <span>CPT</span>
                  <span>Description</span>
                  <span>QTY</span>
                  <span>Unit Price</span>
                  <span>Total</span>
                  <span />
                </div>

              {lineItemFields.fields.map((field, index) => (
                <div key={field.id} className="grid grid-cols-[minmax(100px,1fr)_70px_minmax(120px,2fr)_50px_90px_90px_36px] gap-2 items-start">
                  <FormField
                    control={form.control}
                    name={`line_items.${index}.service_date`}
                    render={({ field }) => (
                      <FormItem>
                        <FormControl><Input type="date" className="text-xs" {...field} /></FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`line_items.${index}.cpt_code`}
                    render={({ field }) => (
                      <FormItem>
                        <FormControl><Input className="text-xs" placeholder="CPT" {...field} /></FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`line_items.${index}.description`}
                    render={({ field }) => (
                      <FormItem>
                        <FormControl><Input className="text-xs" placeholder="Description" {...field} /></FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`line_items.${index}.quantity`}
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Input
                            type="number"
                            min={1}
                            className="text-xs"
                            {...field}
                            value={field.value as number}
                            onChange={(e) => {
                              field.onChange(e)
                              setTimeout(() => handleQuantityOrPriceChange(index), 0)
                            }}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`line_items.${index}.unit_price`}
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            min={0}
                            className="text-xs"
                            {...field}
                            value={field.value as number}
                            onChange={(e) => {
                              field.onChange(e)
                              setTimeout(() => handleQuantityOrPriceChange(index), 0)
                            }}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`line_items.${index}.total_price`}
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            className="text-xs bg-muted"
                            readOnly
                            {...field}
                            value={field.value as number}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => lineItemFields.remove(index)}
                    disabled={lineItemFields.fields.length <= 1}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}

              {/* Running Total */}
              <div className="flex justify-end pr-12">
                <div className="text-sm font-semibold">
                  Total: ${runningTotal.toFixed(2)}
                </div>
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
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                {isEditing ? 'Update Invoice' : 'Create Invoice'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
