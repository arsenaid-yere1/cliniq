'use client'

import { useState } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Plus, Trash2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useCaseStatus } from '@/components/patients/case-status-context'
import { LOCKED_STATUSES, type CaseStatus } from '@/lib/constants/case-status'
import {
  xRayReviewFormSchema,
  type XRayReviewFormValues,
  type XRayFinding,
} from '@/lib/validations/x-ray-extraction'
import {
  approveXRayExtraction,
  saveAndApproveXRayExtraction,
  rejectXRayExtraction,
} from '@/actions/x-ray-extractions'

interface XRayExtractionFormProps {
  extractionId: string
  defaultValues: XRayReviewFormValues
  isManualEntry?: boolean
  onActionComplete: () => void
}

export function XRayExtractionForm({
  extractionId,
  defaultValues,
  isManualEntry,
  onActionComplete,
}: XRayExtractionFormProps) {
  const caseStatus = useCaseStatus()
  const isLocked = LOCKED_STATUSES.includes(caseStatus as CaseStatus)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const form = useForm<XRayReviewFormValues>({
    resolver: zodResolver(xRayReviewFormSchema),
    defaultValues,
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'findings',
  })

  const isDirty = form.formState.isDirty

  async function handleApprove() {
    setIsSubmitting(true)
    const result = await approveXRayExtraction(extractionId)
    setIsSubmitting(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Extraction approved')
      onActionComplete()
    }
  }

  async function handleSaveAndApprove(values: XRayReviewFormValues) {
    setIsSubmitting(true)
    const result = await saveAndApproveXRayExtraction(extractionId, values)
    setIsSubmitting(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success(isManualEntry ? 'Data saved' : 'Edits saved and approved')
      onActionComplete()
    }
  }

  async function handleReject() {
    if (!rejectReason.trim()) return
    setIsSubmitting(true)
    const result = await rejectXRayExtraction(extractionId, rejectReason)
    setIsSubmitting(false)
    setRejectDialogOpen(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Extraction rejected')
      onActionComplete()
    }
  }

  return (
    <>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSaveAndApprove)} className="space-y-6">
          <FormField
            control={form.control}
            name="body_region"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Body Region</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. Cervical Spine, Left Shoulder" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="laterality"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Laterality</FormLabel>
                <Select
                  value={field.value ?? 'none'}
                  onValueChange={(v) => field.onChange(v === 'none' ? null : v)}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select laterality" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="none">Not applicable</SelectItem>
                    <SelectItem value="left">Left</SelectItem>
                    <SelectItem value="right">Right</SelectItem>
                    <SelectItem value="bilateral">Bilateral</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="scan_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Scan Date</FormLabel>
                <FormControl>
                  <Input
                    type="date"
                    {...field}
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(e.target.value || null)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="procedure_description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Procedure Description</FormLabel>
                <FormControl>
                  <Input
                    placeholder="e.g. X-RAY CERVICAL SPINE, TWO VIEWS"
                    {...field}
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(e.target.value || null)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="view_count"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>View Count</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) => {
                        const v = e.target.value
                        if (v === '') return field.onChange(null)
                        const n = Number(v)
                        field.onChange(Number.isFinite(n) && n > 0 ? n : null)
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="views_description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Views</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. AP/Y"
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value || null)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="reading_type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Reading Type</FormLabel>
                <Select
                  value={field.value ?? 'none'}
                  onValueChange={(v) => field.onChange(v === 'none' ? null : v)}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select reading type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="none">Unknown</SelectItem>
                    <SelectItem value="formal_radiology">Formal radiology</SelectItem>
                    <SelectItem value="in_office_alignment">In-office alignment</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="ordering_provider"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ordering Provider</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value || null)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="reading_provider"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reading Provider</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value || null)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="reason_for_study"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Reason for Study</FormLabel>
                <FormControl>
                  <Textarea
                    rows={2}
                    placeholder="Clinical indication..."
                    {...field}
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(e.target.value || null)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="impression_summary"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Impression Summary</FormLabel>
                <FormControl>
                  <Textarea
                    rows={4}
                    placeholder="Radiologist's impression..."
                    {...field}
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(e.target.value || null)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <FormLabel>Findings</FormLabel>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ level: '', description: '', severity: null } as XRayFinding)}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add Finding
              </Button>
            </div>

            {fields.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">
                No findings. Click &quot;Add Finding&quot; to add one.
              </p>
            )}

            {fields.map((field, index) => (
              <div key={field.id} className="border rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Finding {index + 1}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => remove(index)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>

                <FormField
                  control={form.control}
                  name={`findings.${index}.level`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Level / Location</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. C5-C6, glenohumeral joint" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name={`findings.${index}.description`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Description</FormLabel>
                      <FormControl>
                        <Textarea rows={2} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name={`findings.${index}.severity`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Severity</FormLabel>
                      <Select
                        value={field.value ?? 'none'}
                        onValueChange={(v) => field.onChange(v === 'none' ? null : v)}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select severity" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">Not specified</SelectItem>
                          <SelectItem value="mild">Mild</SelectItem>
                          <SelectItem value="moderate">Moderate</SelectItem>
                          <SelectItem value="severe">Severe</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-4 border-t">
            {!isManualEntry && (
              <Button
                type="button"
                variant={isDirty ? 'outline' : 'default'}
                onClick={handleApprove}
                disabled={isLocked || isSubmitting}
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Approve
              </Button>
            )}

            <Button
              type="submit"
              variant={isDirty || isManualEntry ? 'default' : 'outline'}
              disabled={isLocked || isSubmitting}
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {isManualEntry ? 'Save' : 'Save & Approve'}
            </Button>

            {!isManualEntry && (
              <Button
                type="button"
                variant="destructive"
                onClick={() => setRejectDialogOpen(true)}
                disabled={isLocked || isSubmitting}
              >
                Reject
              </Button>
            )}
          </div>
        </form>
      </Form>

      <AlertDialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Extraction</AlertDialogTitle>
            <AlertDialogDescription>
              Provide a reason for rejecting this extraction.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Reason for rejection..."
            rows={3}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReject}
              disabled={isLocked || !rejectReason.trim() || isSubmitting}
            >
              Reject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
