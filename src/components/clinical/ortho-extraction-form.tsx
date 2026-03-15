'use client'

import { useState } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Plus, Trash2, Loader2 } from 'lucide-react'
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
import { useCaseStatus } from '@/components/patients/case-status-context'
import { LOCKED_STATUSES, type CaseStatus } from '@/lib/constants/case-status'
import {
  orthopedicReviewFormSchema,
  type OrthopedicReviewFormValues,
} from '@/lib/validations/orthopedic-extraction'
import {
  approveOrthopedicExtraction,
  saveAndApproveOrthopedicExtraction,
  rejectOrthopedicExtraction,
} from '@/actions/orthopedic-extractions'

interface OrthoExtractionFormProps {
  extractionId: string
  defaultValues: OrthopedicReviewFormValues
  isManualEntry?: boolean
  onActionComplete: () => void
}

export function OrthoExtractionForm({
  extractionId,
  defaultValues,
  isManualEntry,
  onActionComplete,
}: OrthoExtractionFormProps) {
  const caseStatus = useCaseStatus()
  const isLocked = LOCKED_STATUSES.includes(caseStatus as CaseStatus)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const form = useForm<OrthopedicReviewFormValues>({
    resolver: zodResolver(orthopedicReviewFormSchema),
    defaultValues,
  })

  const complaintsArray = useFieldArray({ control: form.control, name: 'present_complaints' })
  const medicationsArray = useFieldArray({ control: form.control, name: 'current_medications' })
  const examArray = useFieldArray({ control: form.control, name: 'physical_exam' })
  const diagnosticsArray = useFieldArray({ control: form.control, name: 'diagnostics' })
  const diagnosesArray = useFieldArray({ control: form.control, name: 'diagnoses' })
  const recommendationsArray = useFieldArray({ control: form.control, name: 'recommendations' })

  const isDirty = form.formState.isDirty

  async function handleApprove() {
    setIsSubmitting(true)
    const result = await approveOrthopedicExtraction(extractionId)
    setIsSubmitting(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Extraction approved')
      onActionComplete()
    }
  }

  async function handleSaveAndApprove(values: OrthopedicReviewFormValues) {
    setIsSubmitting(true)
    const result = await saveAndApproveOrthopedicExtraction(extractionId, values)
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
    const result = await rejectOrthopedicExtraction(extractionId, rejectReason)
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
              <TabsTrigger value="history">History</TabsTrigger>
              <TabsTrigger value="exam">Examination</TabsTrigger>
              <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
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

              <div className="grid grid-cols-2 gap-4">
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
                  name="provider_specialty"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Specialty</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. Orthopedic Surgeon"
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

              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="patient_age"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Age</FormLabel>
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
                  name="patient_sex"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sex</FormLabel>
                      <Select value={field.value ?? 'none'} onValueChange={(v) => field.onChange(v === 'none' ? null : v)}>
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">Not specified</SelectItem>
                          <SelectItem value="male">Male</SelectItem>
                          <SelectItem value="female">Female</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="hand_dominance"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Dominance</FormLabel>
                      <Select value={field.value ?? 'none'} onValueChange={(v) => field.onChange(v === 'none' ? null : v)}>
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">Not specified</SelectItem>
                          <SelectItem value="right">Right</SelectItem>
                          <SelectItem value="left">Left</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="height"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Height</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. 5&apos;1&quot;"
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
                  name="weight"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Weight</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. 105 pounds"
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
                  name="current_employment"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Employment</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Current employment"
                          {...field}
                          value={field.value ?? ''}
                          onChange={(e) => field.onChange(e.target.value || null)}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </TabsContent>

            {/* History Tab */}
            <TabsContent value="history" className="space-y-4 mt-4">
              <FormField
                control={form.control}
                name="history_of_injury"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>History of Injury</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={3}
                        placeholder="MVA details, mechanism of injury..."
                        {...field}
                        value={field.value ?? ''}
                        onChange={(e) => field.onChange(e.target.value || null)}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              {/* Present Complaints */}
              <div className="flex items-center justify-between">
                <FormLabel>Present Complaints</FormLabel>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => complaintsArray.append({
                    location: '', description: '', radiation: null, pre_existing: false,
                  })}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Complaint
                </Button>
              </div>

              {complaintsArray.fields.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">
                  No present complaints. Click &quot;Add Complaint&quot; to add one.
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
                    name={`present_complaints.${index}.location`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Location</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Left shoulder" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name={`present_complaints.${index}.description`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Description</FormLabel>
                        <FormControl>
                          <Input placeholder="Pain description..." {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name={`present_complaints.${index}.radiation`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Radiation</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g. radiates down to hand"
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
                    name={`present_complaints.${index}.pre_existing`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Pre-existing</FormLabel>
                        <FormControl>
                          <select className="h-9 text-sm border rounded px-2 w-full"
                            value={field.value ? 'yes' : 'no'}
                            onChange={(e) => field.onChange(e.target.value === 'yes')}>
                            <option value="no">No (denies pre-existing)</option>
                            <option value="yes">Yes</option>
                          </select>
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              ))}

              {/* Medical History narratives */}
              <FormField
                control={form.control}
                name="past_medical_history"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Past Medical History</FormLabel>
                    <FormControl>
                      <Textarea rows={2} placeholder="Noncontributory or narrative..." {...field}
                        value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="surgical_history"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Surgical History</FormLabel>
                    <FormControl>
                      <Textarea rows={2} placeholder="None or narrative..." {...field}
                        value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="previous_complaints"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Previous Complaints</FormLabel>
                      <FormControl>
                        <Textarea rows={2} placeholder="Prior issues..." {...field}
                          value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="subsequent_complaints"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Subsequent Complaints</FormLabel>
                      <FormControl>
                        <Textarea rows={2} placeholder="Post-accident..." {...field}
                          value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              {/* Medications */}
              <div className="flex items-center justify-between">
                <FormLabel>Current Medications</FormLabel>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => medicationsArray.append({ name: '', details: null })}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Medication
                </Button>
              </div>

              {medicationsArray.fields.map((field, index) => (
                <div key={field.id} className="grid grid-cols-[1fr_1fr_28px] gap-2 items-end">
                  <FormField
                    control={form.control}
                    name={`current_medications.${index}.name`}
                    render={({ field }) => (
                      <FormItem>
                        {index === 0 && <FormLabel className="text-xs">Name</FormLabel>}
                        <FormControl>
                          <Input className="h-8 text-sm" placeholder="Medication name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`current_medications.${index}.details`}
                    render={({ field }) => (
                      <FormItem>
                        {index === 0 && <FormLabel className="text-xs">Details</FormLabel>}
                        <FormControl>
                          <Input className="h-8 text-sm" placeholder="Usage details" {...field}
                            value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-7"
                    onClick={() => medicationsArray.remove(index)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}

              <FormField
                control={form.control}
                name="allergies"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Allergies</FormLabel>
                    <FormControl>
                      <Input placeholder="NKDA or list..." {...field}
                        value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="social_history"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Social History</FormLabel>
                      <FormControl>
                        <Textarea rows={2} placeholder="Smoking, alcohol..." {...field}
                          value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="family_history"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Family History</FormLabel>
                      <FormControl>
                        <Textarea rows={2} placeholder="Noncontributory or narrative..." {...field}
                          value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </TabsContent>

            {/* Examination Tab */}
            <TabsContent value="exam" className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <FormLabel>Physical Exam Regions</FormLabel>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => examArray.append({
                    region: '', rom_summary: null, tenderness: null,
                    strength: null, neurovascular: null, special_tests: null,
                  })}
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

              {examArray.fields.map((field, index) => (
                <div key={field.id} className="border rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Region {index + 1}</span>
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6"
                      onClick={() => examArray.remove(index)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>

                  <FormField
                    control={form.control}
                    name={`physical_exam.${index}.region`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Region</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Left shoulder" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name={`physical_exam.${index}.rom_summary`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Range of Motion Summary</FormLabel>
                        <FormControl>
                          <Textarea rows={2} placeholder="ROM findings..." {...field}
                            value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name={`physical_exam.${index}.tenderness`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Tenderness</FormLabel>
                        <FormControl>
                          <Input placeholder="Tenderness findings..." {...field}
                            value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name={`physical_exam.${index}.strength`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Strength</FormLabel>
                          <FormControl>
                            <Input placeholder="Strength findings..." {...field}
                              value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`physical_exam.${index}.neurovascular`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Neurovascular</FormLabel>
                          <FormControl>
                            <Input placeholder="Neurovascular status..." {...field}
                              value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name={`physical_exam.${index}.special_tests`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Special Tests</FormLabel>
                        <FormControl>
                          <Input placeholder="Named tests performed..." {...field}
                            value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              ))}
            </TabsContent>

            {/* Diagnostics Tab */}
            <TabsContent value="diagnostics" className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <FormLabel>Imaging Studies</FormLabel>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => diagnosticsArray.append({
                    modality: '', body_region: '', study_date: null,
                    findings: '', films_available: false,
                  })}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Study
                </Button>
              </div>

              {diagnosticsArray.fields.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">
                  No imaging studies. Click &quot;Add Study&quot; to add one.
                </p>
              )}

              {diagnosticsArray.fields.map((field, index) => (
                <div key={field.id} className="border rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Study {index + 1}</span>
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6"
                      onClick={() => diagnosticsArray.remove(index)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <FormField
                      control={form.control}
                      name={`diagnostics.${index}.modality`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Modality</FormLabel>
                          <Select value={field.value || 'custom'} onValueChange={(v) => field.onChange(v === 'custom' ? '' : v)}>
                            <FormControl>
                              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="X-ray">X-ray</SelectItem>
                              <SelectItem value="MRI">MRI</SelectItem>
                              <SelectItem value="CT">CT</SelectItem>
                              <SelectItem value="Ultrasound">Ultrasound</SelectItem>
                              <SelectItem value="custom">Other</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`diagnostics.${index}.body_region`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Body Region</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. Left shoulder" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`diagnostics.${index}.study_date`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Study Date</FormLabel>
                          <FormControl>
                            <Input type="date" {...field}
                              value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name={`diagnostics.${index}.findings`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Findings</FormLabel>
                        <FormControl>
                          <Textarea rows={2} placeholder="Imaging findings narrative..." {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name={`diagnostics.${index}.films_available`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Films Available</FormLabel>
                        <FormControl>
                          <select className="h-9 text-sm border rounded px-2 w-full"
                            value={field.value ? 'yes' : 'no'}
                            onChange={(e) => field.onChange(e.target.value === 'yes')}>
                            <option value="no">No</option>
                            <option value="yes">Yes</option>
                          </select>
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              ))}
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
                            <Input placeholder="e.g. M54.2" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
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
                              <Input placeholder="e.g. Cervicalgia" {...field} />
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

            {/* Treatment / Recommendations Tab */}
            <TabsContent value="treatment" className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <FormLabel>Recommendations</FormLabel>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => recommendationsArray.append({
                    description: '', type: null,
                    estimated_cost_min: null, estimated_cost_max: null,
                    body_region: null, follow_up_timeframe: null,
                  })}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Item
                </Button>
              </div>

              {recommendationsArray.fields.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">
                  No recommendations. Click &quot;Add Item&quot; to add one.
                </p>
              )}

              {recommendationsArray.fields.map((field, index) => (
                <div key={field.id} className="border rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Item {index + 1}</span>
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6"
                      onClick={() => recommendationsArray.remove(index)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>

                  <FormField
                    control={form.control}
                    name={`recommendations.${index}.description`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Description</FormLabel>
                        <FormControl>
                          <Textarea rows={2} placeholder="Recommendation..." {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name={`recommendations.${index}.type`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Type</FormLabel>
                          <Select value={field.value ?? 'none'} onValueChange={(v) => field.onChange(v === 'none' ? null : v)}>
                            <FormControl>
                              <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="none">Not specified</SelectItem>
                              <SelectItem value="therapy">Therapy</SelectItem>
                              <SelectItem value="injection">Injection</SelectItem>
                              <SelectItem value="referral">Referral</SelectItem>
                              <SelectItem value="monitoring">Monitoring</SelectItem>
                              <SelectItem value="surgery">Surgery</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`recommendations.${index}.body_region`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Body Region</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. Left shoulder" {...field}
                              value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <FormField
                      control={form.control}
                      name={`recommendations.${index}.estimated_cost_min`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Est. Cost Min ($)</FormLabel>
                          <FormControl>
                            <Input type="number" {...field}
                              value={field.value ?? ''}
                              onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`recommendations.${index}.estimated_cost_max`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Est. Cost Max ($)</FormLabel>
                          <FormControl>
                            <Input type="number" {...field}
                              value={field.value ?? ''}
                              onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`recommendations.${index}.follow_up_timeframe`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Follow-up</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. 3 months" {...field}
                              value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
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
