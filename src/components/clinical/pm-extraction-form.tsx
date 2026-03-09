'use client'

import { useState } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Plus, Trash2, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
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
import {
  painManagementReviewFormSchema,
  type PainManagementReviewFormValues,
} from '@/lib/validations/pain-management-extraction'
import {
  approvePainManagementExtraction,
  saveAndApprovePainManagementExtraction,
  rejectPainManagementExtraction,
} from '@/actions/pain-management-extractions'

interface PmExtractionFormProps {
  extractionId: string
  defaultValues: PainManagementReviewFormValues
  isManualEntry?: boolean
  onActionComplete: () => void
}

export function PmExtractionForm({
  extractionId,
  defaultValues,
  isManualEntry,
  onActionComplete,
}: PmExtractionFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [expandedRegions, setExpandedRegions] = useState<Record<number, boolean>>({})

  const form = useForm<PainManagementReviewFormValues>({
    resolver: zodResolver(painManagementReviewFormSchema),
    defaultValues,
  })

  const complaintsArray = useFieldArray({ control: form.control, name: 'chief_complaints' })
  const examArray = useFieldArray({ control: form.control, name: 'physical_exam' })
  const diagnosesArray = useFieldArray({ control: form.control, name: 'diagnoses' })
  const treatmentArray = useFieldArray({ control: form.control, name: 'treatment_plan' })

  const isDirty = form.formState.isDirty

  function toggleRegion(index: number) {
    setExpandedRegions((prev) => ({ ...prev, [index]: !prev[index] }))
  }

  async function handleApprove() {
    setIsSubmitting(true)
    const result = await approvePainManagementExtraction(extractionId)
    setIsSubmitting(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Extraction approved')
      onActionComplete()
    }
  }

  async function handleSaveAndApprove(values: PainManagementReviewFormValues) {
    setIsSubmitting(true)
    const result = await saveAndApprovePainManagementExtraction(extractionId, values)
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
    const result = await rejectPainManagementExtraction(extractionId, rejectReason)
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
              <TabsTrigger value="complaints">Complaints</TabsTrigger>
              <TabsTrigger value="exam">Physical Exam</TabsTrigger>
              <TabsTrigger value="diagnoses">Diagnoses</TabsTrigger>
              <TabsTrigger value="treatment">Treatment</TabsTrigger>
            </TabsList>

            {/* Overview Tab */}
            <TabsContent value="overview" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
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
                <FormField
                  control={form.control}
                  name="date_of_injury"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date of Injury</FormLabel>
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
                name="examining_provider"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Examining Provider</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Provider name"
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
                name="diagnostic_studies_summary"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Diagnostic Studies Summary</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={3}
                        placeholder="Summary of referenced imaging/diagnostic findings..."
                        {...field}
                        value={field.value ?? ''}
                        onChange={(e) => field.onChange(e.target.value || null)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </TabsContent>

            {/* Chief Complaints Tab */}
            <TabsContent value="complaints" className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <FormLabel>Chief Complaints</FormLabel>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => complaintsArray.append({
                    location: '', pain_rating_min: null, pain_rating_max: null,
                    radiation: null, aggravating_factors: [], alleviating_factors: [],
                  })}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Complaint
                </Button>
              </div>

              {complaintsArray.fields.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">
                  No chief complaints. Click &quot;Add Complaint&quot; to add one.
                </p>
              )}

              {complaintsArray.fields.map((field, index) => (
                <div key={field.id} className="border rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Complaint {index + 1}</span>
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6"
                      onClick={() => complaintsArray.remove(index)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>

                  <FormField
                    control={form.control}
                    name={`chief_complaints.${index}.location`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Location</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Neck, Lower back" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name={`chief_complaints.${index}.pain_rating_min`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Pain Min (/10)</FormLabel>
                          <FormControl>
                            <Input
                              type="number" min={0} max={10}
                              {...field}
                              value={field.value ?? ''}
                              onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`chief_complaints.${index}.pain_rating_max`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Pain Max (/10)</FormLabel>
                          <FormControl>
                            <Input
                              type="number" min={0} max={10}
                              {...field}
                              value={field.value ?? ''}
                              onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name={`chief_complaints.${index}.radiation`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Radiation</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g. radiates to left arm"
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
                    name={`chief_complaints.${index}.aggravating_factors`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Aggravating Factors (comma-separated)</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g. sitting, standing, lifting"
                            value={Array.isArray(field.value) ? field.value.join(', ') : ''}
                            onChange={(e) => field.onChange(
                              e.target.value ? e.target.value.split(',').map((s) => s.trim()).filter(Boolean) : [],
                            )}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name={`chief_complaints.${index}.alleviating_factors`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Alleviating Factors (comma-separated)</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g. medication, rest, therapy"
                            value={Array.isArray(field.value) ? field.value.join(', ') : ''}
                            onChange={(e) => field.onChange(
                              e.target.value ? e.target.value.split(',').map((s) => s.trim()).filter(Boolean) : [],
                            )}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              ))}
            </TabsContent>

            {/* Physical Exam Tab */}
            <TabsContent value="exam" className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <FormLabel>Physical Exam Regions</FormLabel>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    examArray.append({
                      region: '', palpation_findings: null,
                      range_of_motion: [], orthopedic_tests: [],
                      neurological_summary: null,
                    })
                    setExpandedRegions((prev) => ({ ...prev, [examArray.fields.length]: true }))
                  }}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Region
                </Button>
              </div>

              {examArray.fields.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">
                  No exam regions. Click &quot;Add Region&quot; to add one.
                </p>
              )}

              {examArray.fields.map((field, regionIndex) => {
                const isExpanded = expandedRegions[regionIndex] ?? false
                const regionName = form.watch(`physical_exam.${regionIndex}.region`) || `Region ${regionIndex + 1}`
                const romCount = (form.watch(`physical_exam.${regionIndex}.range_of_motion`) ?? []).length
                const testCount = (form.watch(`physical_exam.${regionIndex}.orthopedic_tests`) ?? []).length

                return (
                  <div key={field.id} className="border rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleRegion(regionIndex)}
                      className="w-full flex items-center justify-between p-3 hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        <span className="font-medium text-sm">{regionName}</span>
                        <span className="text-xs text-muted-foreground">
                          {romCount} ROM · {testCount} tests
                        </span>
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="h-6 w-6"
                        onClick={(e) => { e.stopPropagation(); examArray.remove(regionIndex) }}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </button>

                    {isExpanded && (
                      <div className="p-3 pt-0 space-y-3 border-t">
                        <FormField
                          control={form.control}
                          name={`physical_exam.${regionIndex}.region`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs">Region Name</FormLabel>
                              <FormControl>
                                <Input placeholder="e.g. Cervical Spine" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name={`physical_exam.${regionIndex}.palpation_findings`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs">Palpation Findings</FormLabel>
                              <FormControl>
                                <Textarea
                                  rows={2}
                                  placeholder="Tenderness, trigger points, spasms..."
                                  {...field}
                                  value={field.value ?? ''}
                                  onChange={(e) => field.onChange(e.target.value || null)}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />

                        {/* Range of Motion */}
                        <RomSection form={form} regionIndex={regionIndex} />

                        {/* Orthopedic Tests */}
                        <OrthoSection form={form} regionIndex={regionIndex} />

                        <FormField
                          control={form.control}
                          name={`physical_exam.${regionIndex}.neurological_summary`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs">Neurological Summary</FormLabel>
                              <FormControl>
                                <Textarea
                                  rows={2}
                                  placeholder="Motor/sensory findings..."
                                  {...field}
                                  value={field.value ?? ''}
                                  onChange={(e) => field.onChange(e.target.value || null)}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </TabsContent>

            {/* Diagnoses Tab */}
            <TabsContent value="diagnoses" className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <FormLabel>Diagnoses</FormLabel>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => diagnosesArray.append({ icd10_code: null, description: '' })}
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

                  <div className="grid grid-cols-3 gap-3">
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
                    <div className="col-span-2">
                      <FormField
                        control={form.control}
                        name={`diagnoses.${index}.description`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Description</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. Lumbago" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </TabsContent>

            {/* Treatment Plan Tab */}
            <TabsContent value="treatment" className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <FormLabel>Treatment Plan</FormLabel>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => treatmentArray.append({
                    description: '', type: null,
                    estimated_cost_min: null, estimated_cost_max: null,
                    body_region: null,
                  })}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Item
                </Button>
              </div>

              {treatmentArray.fields.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">
                  No treatment plan items. Click &quot;Add Item&quot; to add one.
                </p>
              )}

              {treatmentArray.fields.map((field, index) => (
                <div key={field.id} className="border rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Item {index + 1}</span>
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6"
                      onClick={() => treatmentArray.remove(index)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>

                  <FormField
                    control={form.control}
                    name={`treatment_plan.${index}.description`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Description</FormLabel>
                        <FormControl>
                          <Textarea rows={2} placeholder="Treatment recommendation..." {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name={`treatment_plan.${index}.type`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Type</FormLabel>
                          <Select value={field.value ?? 'none'} onValueChange={(v) => field.onChange(v === 'none' ? null : v)}>
                            <FormControl>
                              <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="none">Not specified</SelectItem>
                              <SelectItem value="continuation">Continuation</SelectItem>
                              <SelectItem value="injection">Injection</SelectItem>
                              <SelectItem value="therapy">Therapy</SelectItem>
                              <SelectItem value="medication">Medication</SelectItem>
                              <SelectItem value="surgery">Surgery</SelectItem>
                              <SelectItem value="monitoring">Monitoring</SelectItem>
                              <SelectItem value="alternative">Alternative</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`treatment_plan.${index}.body_region`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Body Region</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="e.g. Cervical"
                              {...field}
                              value={field.value ?? ''}
                              onChange={(e) => field.onChange(e.target.value || null)}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name={`treatment_plan.${index}.estimated_cost_min`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Est. Cost Min ($)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              {...field}
                              value={field.value ?? ''}
                              onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`treatment_plan.${index}.estimated_cost_max`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Est. Cost Max ($)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              {...field}
                              value={field.value ?? ''}
                              onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
              ))}
            </TabsContent>
          </Tabs>

          <div className="flex items-center gap-2 pt-4 border-t">
            {!isManualEntry && (
              <Button
                type="button"
                variant={isDirty ? 'outline' : 'default'}
                onClick={handleApprove}
                disabled={isSubmitting}
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Approve
              </Button>
            )}

            <Button
              type="submit"
              variant={isDirty || isManualEntry ? 'default' : 'outline'}
              disabled={isSubmitting}
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {isManualEntry ? 'Save' : 'Save & Approve'}
            </Button>

            {!isManualEntry && (
              <Button
                type="button"
                variant="destructive"
                onClick={() => setRejectDialogOpen(true)}
                disabled={isSubmitting}
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
              disabled={!rejectReason.trim() || isSubmitting}
            >
              Reject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// --- ROM sub-section (nested field array) ---

function RomSection({
  form,
  regionIndex,
}: {
  form: ReturnType<typeof useForm<PainManagementReviewFormValues>>
  regionIndex: number
}) {
  const romArray = useFieldArray({
    control: form.control,
    name: `physical_exam.${regionIndex}.range_of_motion`,
  })

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">Range of Motion</span>
        <Button type="button" variant="outline" size="sm" className="h-6 text-xs"
          onClick={() => romArray.append({ movement: '', normal: null, actual: null, pain: false })}>
          <Plus className="h-3 w-3 mr-1" /> Add
        </Button>
      </div>
      {romArray.fields.length > 0 && (
        <div className="space-y-1">
          <div className="grid grid-cols-[1fr_60px_60px_50px_28px] gap-1 text-xs text-muted-foreground px-1">
            <span>Movement</span>
            <span>Normal</span>
            <span>Actual</span>
            <span>Pain</span>
            <span />
          </div>
          {romArray.fields.map((romField, romIndex) => (
            <div key={romField.id} className="grid grid-cols-[1fr_60px_60px_50px_28px] gap-1 items-center">
              <FormField control={form.control} name={`physical_exam.${regionIndex}.range_of_motion.${romIndex}.movement`}
                render={({ field }) => (
                  <FormControl><Input className="h-7 text-xs" placeholder="e.g. Flexion" {...field} /></FormControl>
                )}
              />
              <FormField control={form.control} name={`physical_exam.${regionIndex}.range_of_motion.${romIndex}.normal`}
                render={({ field }) => (
                  <FormControl>
                    <Input className="h-7 text-xs" type="number" {...field}
                      value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)} />
                  </FormControl>
                )}
              />
              <FormField control={form.control} name={`physical_exam.${regionIndex}.range_of_motion.${romIndex}.actual`}
                render={({ field }) => (
                  <FormControl>
                    <Input className="h-7 text-xs" type="number" {...field}
                      value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)} />
                  </FormControl>
                )}
              />
              <FormField control={form.control} name={`physical_exam.${regionIndex}.range_of_motion.${romIndex}.pain`}
                render={({ field }) => (
                  <FormControl>
                    <select className="h-7 text-xs border rounded px-1"
                      value={field.value ? 'Y' : 'N'}
                      onChange={(e) => field.onChange(e.target.value === 'Y')}>
                      <option value="N">N</option>
                      <option value="Y">Y</option>
                    </select>
                  </FormControl>
                )}
              />
              <Button type="button" variant="ghost" size="icon" className="h-6 w-6"
                onClick={() => romArray.remove(romIndex)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// --- Orthopedic tests sub-section ---

function OrthoSection({
  form,
  regionIndex,
}: {
  form: ReturnType<typeof useForm<PainManagementReviewFormValues>>
  regionIndex: number
}) {
  const orthoArray = useFieldArray({
    control: form.control,
    name: `physical_exam.${regionIndex}.orthopedic_tests`,
  })

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">Orthopedic Tests</span>
        <Button type="button" variant="outline" size="sm" className="h-6 text-xs"
          onClick={() => orthoArray.append({ name: '', result: 'negative' })}>
          <Plus className="h-3 w-3 mr-1" /> Add
        </Button>
      </div>
      {orthoArray.fields.map((testField, testIndex) => (
        <div key={testField.id} className="grid grid-cols-[1fr_100px_28px] gap-1 items-center">
          <FormField control={form.control} name={`physical_exam.${regionIndex}.orthopedic_tests.${testIndex}.name`}
            render={({ field }) => (
              <FormControl><Input className="h-7 text-xs" placeholder="Test name" {...field} /></FormControl>
            )}
          />
          <FormField control={form.control} name={`physical_exam.${regionIndex}.orthopedic_tests.${testIndex}.result`}
            render={({ field }) => (
              <FormControl>
                <select className="h-7 text-xs border rounded px-1 w-full"
                  value={field.value} onChange={(e) => field.onChange(e.target.value)}>
                  <option value="negative">Negative</option>
                  <option value="positive">Positive</option>
                </select>
              </FormControl>
            )}
          />
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6"
            onClick={() => orthoArray.remove(testIndex)}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
    </div>
  )
}
