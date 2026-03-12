'use client'

import { useState } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Plus, Trash2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import {
  chiroReviewFormSchema,
  type ChiroReviewFormValues,
} from '@/lib/validations/chiro-extraction'
import {
  approveChiroExtraction,
  saveAndApproveChiroExtraction,
  rejectChiroExtraction,
} from '@/actions/chiro-extractions'

interface ChiroExtractionFormProps {
  extractionId: string
  defaultValues: ChiroReviewFormValues
  isManualEntry?: boolean
  onActionComplete: () => void
}

export function ChiroExtractionForm({
  extractionId,
  defaultValues,
  isManualEntry,
  onActionComplete,
}: ChiroExtractionFormProps) {
  const caseStatus = useCaseStatus()
  const isClosed = caseStatus === 'closed'
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const form = useForm<ChiroReviewFormValues>({
    resolver: zodResolver(chiroReviewFormSchema),
    defaultValues,
  })

  const diagnosesArray = useFieldArray({ control: form.control, name: 'diagnoses' })
  const modalitiesArray = useFieldArray({ control: form.control, name: 'treatment_modalities' })
  const painLevelsArray = useFieldArray({ control: form.control, name: 'functional_outcomes.pain_levels' })
  const disabilityScoresArray = useFieldArray({ control: form.control, name: 'functional_outcomes.disability_scores' })

  const residualComplaints = form.watch('plateau_statement.residual_complaints')
  const permanentRestrictions = form.watch('plateau_statement.permanent_restrictions')

  const isDirty = form.formState.isDirty

  async function handleApprove() {
    setIsSubmitting(true)
    const result = await approveChiroExtraction(extractionId)
    setIsSubmitting(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Extraction approved')
      onActionComplete()
    }
  }

  async function handleSaveAndApprove(values: ChiroReviewFormValues) {
    setIsSubmitting(true)
    const result = await saveAndApproveChiroExtraction(extractionId, values)
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
    const result = await rejectChiroExtraction(extractionId, rejectReason)
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
          <Tabs defaultValue="overview">
            <TabsList className="w-full">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="diagnoses">Diagnoses</TabsTrigger>
              <TabsTrigger value="treatment">Treatment</TabsTrigger>
              <TabsTrigger value="outcomes">Outcomes</TabsTrigger>
              <TabsTrigger value="plateau">Plateau/MMI</TabsTrigger>
            </TabsList>

            {/* Overview Tab */}
            <TabsContent value="overview" className="space-y-4 mt-4">
              <FormField
                control={form.control}
                name="report_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Report Type</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="initial_evaluation">Initial Evaluation</SelectItem>
                        <SelectItem value="soap_note">SOAP Note</SelectItem>
                        <SelectItem value="re_evaluation">Re-Evaluation</SelectItem>
                        <SelectItem value="discharge_summary">Discharge Summary</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="report_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Report Date</FormLabel>
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

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="treatment_dates.first_visit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Visit</FormLabel>
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
                  name="treatment_dates.last_visit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Visit</FormLabel>
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
              </div>

              <FormField
                control={form.control}
                name="treatment_dates.total_visits"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Total Visits</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        {...field}
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
                name="functional_outcomes.progress_status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Progress Status</FormLabel>
                    <Select
                      value={field.value ?? 'none'}
                      onValueChange={(v) => field.onChange(v === 'none' ? null : v)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Not specified</SelectItem>
                        <SelectItem value="improving">Improving</SelectItem>
                        <SelectItem value="stable">Stable</SelectItem>
                        <SelectItem value="plateauing">Plateauing</SelectItem>
                        <SelectItem value="worsening">Worsening</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </TabsContent>

            {/* Diagnoses Tab */}
            <TabsContent value="diagnoses" className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <FormLabel>Diagnoses</FormLabel>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => diagnosesArray.append({
                    icd10_code: null, description: '', region: null, is_primary: false,
                  })}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Diagnosis
                </Button>
              </div>

              {diagnosesArray.fields.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">
                  No diagnoses. Click &quot;Add Diagnosis&quot; to add one.
                </p>
              )}

              {diagnosesArray.fields.map((field, index) => (
                <div key={field.id} className="border rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Diagnosis {index + 1}</span>
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6"
                      onClick={() => diagnosesArray.remove(index)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name={`diagnoses.${index}.icd10_code`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">ICD-10 Code</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. M54.5" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`diagnoses.${index}.region`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Region</FormLabel>
                          <Select value={field.value ?? 'none'} onValueChange={(v) => field.onChange(v === 'none' ? null : v)}>
                            <FormControl>
                              <SelectTrigger><SelectValue placeholder="Select region" /></SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="none">Not specified</SelectItem>
                              <SelectItem value="cervical">Cervical</SelectItem>
                              <SelectItem value="thoracic">Thoracic</SelectItem>
                              <SelectItem value="lumbar">Lumbar</SelectItem>
                              <SelectItem value="sacral">Sacral</SelectItem>
                              <SelectItem value="upper_extremity">Upper Extremity</SelectItem>
                              <SelectItem value="lower_extremity">Lower Extremity</SelectItem>
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
                    name={`diagnoses.${index}.description`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Description</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name={`diagnoses.${index}.is_primary`}
                    render={({ field }) => (
                      <FormItem className="flex items-center gap-2">
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <FormLabel className="text-xs !mt-0">Primary diagnosis</FormLabel>
                      </FormItem>
                    )}
                  />
                </div>
              ))}
            </TabsContent>

            {/* Treatment Tab */}
            <TabsContent value="treatment" className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <FormLabel>Treatment Modalities</FormLabel>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => modalitiesArray.append({
                    modality: '', cpt_code: null, regions_treated: [], frequency: null,
                  })}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Modality
                </Button>
              </div>

              {modalitiesArray.fields.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">
                  No treatment modalities. Click &quot;Add Modality&quot; to add one.
                </p>
              )}

              {modalitiesArray.fields.map((field, index) => (
                <div key={field.id} className="border rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Modality {index + 1}</span>
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6"
                      onClick={() => modalitiesArray.remove(index)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name={`treatment_modalities.${index}.modality`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Modality</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. Spinal manipulation" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`treatment_modalities.${index}.cpt_code`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">CPT Code</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. 98941" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name={`treatment_modalities.${index}.regions_treated`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Regions Treated (comma-separated)</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g. cervical, lumbar"
                            value={Array.isArray(field.value) ? field.value.join(', ') : ''}
                            onChange={(e) => field.onChange(
                              e.target.value ? e.target.value.split(',').map((s) => s.trim()).filter(Boolean) : [],
                            )}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name={`treatment_modalities.${index}.frequency`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Frequency</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. 3x/week" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              ))}
            </TabsContent>

            {/* Outcomes Tab */}
            <TabsContent value="outcomes" className="space-y-6 mt-4">
              {/* Pain Levels */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <FormLabel>Pain Levels</FormLabel>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => painLevelsArray.append({
                      date: null, scale: 'VAS', score: 0, max_score: 10, context: null,
                    })}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add Pain Level
                  </Button>
                </div>

                {painLevelsArray.fields.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">
                    No pain levels recorded.
                  </p>
                )}

                {painLevelsArray.fields.map((field, index) => (
                  <div key={field.id} className="border rounded-lg p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Pain Level {index + 1}</span>
                      <Button type="button" variant="ghost" size="icon" className="h-6 w-6"
                        onClick={() => painLevelsArray.remove(index)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={form.control} name={`functional_outcomes.pain_levels.${index}.date`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Date</FormLabel>
                            <FormControl>
                              <Input type="date" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField control={form.control} name={`functional_outcomes.pain_levels.${index}.scale`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Scale</FormLabel>
                            <FormControl><Input placeholder="e.g. VAS, NRS" {...field} /></FormControl>
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={form.control} name={`functional_outcomes.pain_levels.${index}.score`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Score</FormLabel>
                            <FormControl>
                              <Input type="number" {...field} onChange={(e) => field.onChange(Number(e.target.value))} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField control={form.control} name={`functional_outcomes.pain_levels.${index}.max_score`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Max Score</FormLabel>
                            <FormControl>
                              <Input type="number" {...field} onChange={(e) => field.onChange(Number(e.target.value))} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField control={form.control} name={`functional_outcomes.pain_levels.${index}.context`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Context</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. at rest, with activity" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                ))}
              </div>

              {/* Disability Scores */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <FormLabel>Disability Scores</FormLabel>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => disabilityScoresArray.append({
                      date: null, instrument: '', score: 0, max_score: 100, percent_disability: null, interpretation: null,
                    })}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add Score
                  </Button>
                </div>

                {disabilityScoresArray.fields.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">
                    No disability scores recorded.
                  </p>
                )}

                {disabilityScoresArray.fields.map((field, index) => (
                  <div key={field.id} className="border rounded-lg p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Disability Score {index + 1}</span>
                      <Button type="button" variant="ghost" size="icon" className="h-6 w-6"
                        onClick={() => disabilityScoresArray.remove(index)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={form.control} name={`functional_outcomes.disability_scores.${index}.date`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Date</FormLabel>
                            <FormControl>
                              <Input type="date" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField control={form.control} name={`functional_outcomes.disability_scores.${index}.instrument`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Instrument</FormLabel>
                            <FormControl><Input placeholder="e.g. ODI, NDI" {...field} /></FormControl>
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <FormField control={form.control} name={`functional_outcomes.disability_scores.${index}.score`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Score</FormLabel>
                            <FormControl>
                              <Input type="number" {...field} onChange={(e) => field.onChange(Number(e.target.value))} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField control={form.control} name={`functional_outcomes.disability_scores.${index}.max_score`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Max Score</FormLabel>
                            <FormControl>
                              <Input type="number" {...field} onChange={(e) => field.onChange(Number(e.target.value))} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField control={form.control} name={`functional_outcomes.disability_scores.${index}.percent_disability`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">% Disability</FormLabel>
                            <FormControl>
                              <Input type="number" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField control={form.control} name={`functional_outcomes.disability_scores.${index}.interpretation`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Interpretation</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. Moderate disability" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                ))}
              </div>
            </TabsContent>

            {/* Plateau/MMI Tab */}
            <TabsContent value="plateau" className="space-y-4 mt-4">
              <FormField
                control={form.control}
                name="plateau_statement.present"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel className="!mt-0">Plateau/MMI statement present</FormLabel>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="plateau_statement.mmi_reached"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2">
                    <FormControl>
                      <Checkbox
                        checked={field.value ?? false}
                        onCheckedChange={(checked) => field.onChange(checked === true ? true : checked === false ? false : null)}
                      />
                    </FormControl>
                    <FormLabel className="!mt-0">MMI Reached</FormLabel>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="plateau_statement.date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="plateau_statement.verbatim_statement"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Verbatim Statement</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={4}
                        placeholder="Exact quote from the report..."
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
                name="plateau_statement.impairment_rating_percent"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Impairment Rating %</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        {...field}
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
                name="plateau_statement.future_care_recommended"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2">
                    <FormControl>
                      <Checkbox
                        checked={field.value ?? false}
                        onCheckedChange={(checked) => field.onChange(checked === true ? true : checked === false ? false : null)}
                      />
                    </FormControl>
                    <FormLabel className="!mt-0">Future Care Recommended</FormLabel>
                  </FormItem>
                )}
              />

              {/* Residual Complaints */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <FormLabel>Residual Complaints</FormLabel>
                  <Button type="button" variant="outline" size="sm"
                    onClick={() => form.setValue('plateau_statement.residual_complaints', [...residualComplaints, ''], { shouldDirty: true })}>
                    <Plus className="h-3 w-3 mr-1" /> Add
                  </Button>
                </div>
                {residualComplaints.map((_, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      placeholder="Complaint..."
                      value={residualComplaints[index] ?? ''}
                      onChange={(e) => {
                        const updated = [...residualComplaints]
                        updated[index] = e.target.value
                        form.setValue('plateau_statement.residual_complaints', updated, { shouldDirty: true })
                      }}
                    />
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8"
                      onClick={() => {
                        const updated = residualComplaints.filter((_, i) => i !== index)
                        form.setValue('plateau_statement.residual_complaints', updated, { shouldDirty: true })
                      }}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>

              {/* Permanent Restrictions */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <FormLabel>Permanent Restrictions</FormLabel>
                  <Button type="button" variant="outline" size="sm"
                    onClick={() => form.setValue('plateau_statement.permanent_restrictions', [...permanentRestrictions, ''], { shouldDirty: true })}>
                    <Plus className="h-3 w-3 mr-1" /> Add
                  </Button>
                </div>
                {permanentRestrictions.map((_, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      placeholder="Restriction..."
                      value={permanentRestrictions[index] ?? ''}
                      onChange={(e) => {
                        const updated = [...permanentRestrictions]
                        updated[index] = e.target.value
                        form.setValue('plateau_statement.permanent_restrictions', updated, { shouldDirty: true })
                      }}
                    />
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8"
                      onClick={() => {
                        const updated = permanentRestrictions.filter((_, i) => i !== index)
                        form.setValue('plateau_statement.permanent_restrictions', updated, { shouldDirty: true })
                      }}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>

          <div className="flex items-center gap-2 pt-4 border-t">
            {!isManualEntry && (
              <Button
                type="button"
                variant={isDirty ? 'outline' : 'default'}
                onClick={handleApprove}
                disabled={isClosed || isSubmitting}
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Approve
              </Button>
            )}

            <Button
              type="submit"
              variant={isDirty || isManualEntry ? 'default' : 'outline'}
              disabled={isClosed || isSubmitting}
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {isManualEntry ? 'Save' : 'Save & Approve'}
            </Button>

            {!isManualEntry && (
              <Button
                type="button"
                variant="destructive"
                onClick={() => setRejectDialogOpen(true)}
                disabled={isClosed || isSubmitting}
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
              disabled={isClosed || !rejectReason.trim() || isSubmitting}
            >
              Reject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
