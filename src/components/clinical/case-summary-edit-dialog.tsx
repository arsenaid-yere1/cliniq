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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form'
import {
  caseSummaryEditSchema,
  type CaseSummaryEditValues,
  type ImagingFinding,
  type SuggestedDiagnosis,
  type PriorTreatment,
  type SymptomsTimeline,
} from '@/lib/validations/case-summary'
import { saveCaseSummaryEdits } from '@/actions/case-summaries'

interface CaseSummaryEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  caseId: string
  summary: {
    chief_complaint: string | null
    imaging_findings: ImagingFinding[]
    prior_treatment: PriorTreatment
    symptoms_timeline: SymptomsTimeline
    suggested_diagnoses: SuggestedDiagnosis[]
  }
  overrides: Partial<CaseSummaryEditValues> | null
}

export function CaseSummaryEditDialog({
  open,
  onOpenChange,
  caseId,
  summary,
  overrides,
}: CaseSummaryEditDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)

  const defaultValues: CaseSummaryEditValues = {
    chief_complaint: overrides?.chief_complaint ?? summary.chief_complaint,
    imaging_findings: (overrides?.imaging_findings ?? summary.imaging_findings) as ImagingFinding[],
    prior_treatment: (overrides?.prior_treatment ?? summary.prior_treatment) as PriorTreatment,
    symptoms_timeline: (overrides?.symptoms_timeline ?? summary.symptoms_timeline) as SymptomsTimeline,
    suggested_diagnoses: (overrides?.suggested_diagnoses ?? summary.suggested_diagnoses) as SuggestedDiagnosis[],
  }

  const form = useForm<CaseSummaryEditValues>({
    resolver: zodResolver(caseSummaryEditSchema),
    defaultValues,
  })

  const imagingFields = useFieldArray({ control: form.control, name: 'imaging_findings' })
  const diagnosesFields = useFieldArray({ control: form.control, name: 'suggested_diagnoses' })

  async function handleSave(values: CaseSummaryEditValues) {
    setIsSubmitting(true)
    const result = await saveCaseSummaryEdits(caseId, values)
    setIsSubmitting(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Summary edits saved')
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Clinical Case Summary</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSave)} className="space-y-6">
            {/* Chief Complaint */}
            <FormField
              control={form.control}
              name="chief_complaint"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Chief Complaint</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={3}
                      placeholder="Chief complaint narrative..."
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value || null)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Imaging Findings */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <FormLabel>Imaging Findings</FormLabel>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => imagingFields.append({
                    body_region: '',
                    summary: '',
                    key_findings: [],
                    severity: null,
                  })}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Finding
                </Button>
              </div>

              {imagingFields.fields.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">
                  No imaging findings.
                </p>
              )}

              {imagingFields.fields.map((field, index) => (
                <div key={field.id} className="border rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Finding {index + 1}</span>
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => imagingFields.remove(index)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name={`imaging_findings.${index}.body_region`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Body Region</FormLabel>
                          <FormControl><Input placeholder="e.g. Cervical Spine" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`imaging_findings.${index}.severity`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Severity</FormLabel>
                          <Select value={field.value ?? 'none'} onValueChange={(v) => field.onChange(v === 'none' ? null : v)}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger></FormControl>
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

                  <FormField
                    control={form.control}
                    name={`imaging_findings.${index}.summary`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Summary</FormLabel>
                        <FormControl><Textarea rows={2} placeholder="Summary of findings..." {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name={`imaging_findings.${index}.key_findings`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Key Findings (comma-separated)</FormLabel>
                        <FormControl>
                          <Textarea
                            rows={2}
                            placeholder="Finding 1, Finding 2, ..."
                            value={(field.value as string[]).join(', ')}
                            onChange={(e) => field.onChange(
                              e.target.value ? e.target.value.split(',').map((s) => s.trim()).filter(Boolean) : [],
                            )}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              ))}
            </div>

            {/* Prior Treatment */}
            <div className="space-y-3">
              <FormLabel>Prior Treatment</FormLabel>

              <FormField
                control={form.control}
                name="prior_treatment.modalities"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Modalities (comma-separated)</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={2}
                        placeholder="Chiropractic, Physical Therapy, ..."
                        value={(field.value as string[]).join(', ')}
                        onChange={(e) => field.onChange(
                          e.target.value ? e.target.value.split(',').map((s) => s.trim()).filter(Boolean) : [],
                        )}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="prior_treatment.total_visits"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Total Visits</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="e.g. 24"
                          value={field.value ?? ''}
                          onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="prior_treatment.treatment_period"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Treatment Period</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. Jan 2026 – Mar 2026"
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
            </div>

            {/* Symptoms Timeline */}
            <div className="space-y-3">
              <FormLabel>Symptoms Timeline</FormLabel>

              <FormField
                control={form.control}
                name="symptoms_timeline.onset"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Onset</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={2}
                        placeholder="Initial symptom presentation..."
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
                name="symptoms_timeline.current_status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Current Status</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={2}
                        placeholder="Current symptom status..."
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

            {/* Suggested Diagnoses */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <FormLabel>Suggested Diagnoses</FormLabel>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => diagnosesFields.append({
                    diagnosis: '',
                    icd10_code: null,
                    confidence: 'medium',
                    supporting_evidence: null,
                  })}
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
                <div key={field.id} className="border rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Diagnosis {index + 1}</span>
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => diagnosesFields.remove(index)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <FormField
                      control={form.control}
                      name={`suggested_diagnoses.${index}.diagnosis`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Diagnosis</FormLabel>
                          <FormControl><Input placeholder="e.g. Cervical disc herniation" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`suggested_diagnoses.${index}.icd10_code`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">ICD-10 Code</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="e.g. M50.12"
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
                      name={`suggested_diagnoses.${index}.confidence`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Confidence</FormLabel>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>
                              <SelectItem value="high">High</SelectItem>
                              <SelectItem value="medium">Medium</SelectItem>
                              <SelectItem value="low">Low</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name={`suggested_diagnoses.${index}.supporting_evidence`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Supporting Evidence</FormLabel>
                        <FormControl>
                          <Textarea
                            rows={2}
                            placeholder="Evidence supporting this diagnosis..."
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
              ))}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Save & Approve
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
