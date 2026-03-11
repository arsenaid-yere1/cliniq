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
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  ptReviewFormSchema,
  type PtReviewFormValues,
} from '@/lib/validations/pt-extraction'
import {
  approvePtExtraction,
  saveAndApprovePtExtraction,
  rejectPtExtraction,
} from '@/actions/pt-extractions'

interface PtExtractionFormProps {
  extractionId: string
  defaultValues: PtReviewFormValues
  isManualEntry?: boolean
  onActionComplete: () => void
}

export function PtExtractionForm({
  extractionId,
  defaultValues,
  isManualEntry,
  onActionComplete,
}: PtExtractionFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})

  const form = useForm<PtReviewFormValues>({
    resolver: zodResolver(ptReviewFormSchema),
    defaultValues,
  })

  const romArray = useFieldArray({ control: form.control, name: 'range_of_motion' })
  const strengthArray = useFieldArray({ control: form.control, name: 'muscle_strength' })
  const palpationArray = useFieldArray({ control: form.control, name: 'palpation_findings' })
  const specialTestsArray = useFieldArray({ control: form.control, name: 'special_tests' })
  const functionalTestsArray = useFieldArray({ control: form.control, name: 'functional_tests' })
  const outcomeMeasuresArray = useFieldArray({ control: form.control, name: 'outcome_measures' })
  const stGoalsArray = useFieldArray({ control: form.control, name: 'short_term_goals' })
  const ltGoalsArray = useFieldArray({ control: form.control, name: 'long_term_goals' })
  const diagnosesArray = useFieldArray({ control: form.control, name: 'diagnoses' })
  const modalitiesArray = useFieldArray({ control: form.control, name: 'plan_of_care.modalities' })

  const isDirty = form.formState.isDirty

  function toggleSection(key: string) {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  async function handleApprove() {
    setIsSubmitting(true)
    const result = await approvePtExtraction(extractionId)
    setIsSubmitting(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Extraction approved')
      onActionComplete()
    }
  }

  async function handleSaveAndApprove(values: PtReviewFormValues) {
    setIsSubmitting(true)
    const result = await saveAndApprovePtExtraction(extractionId, values)
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
    const result = await rejectPtExtraction(extractionId, rejectReason)
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
              <TabsTrigger value="exam">Examination</TabsTrigger>
              <TabsTrigger value="outcomes">Outcomes</TabsTrigger>
              <TabsTrigger value="goals">Goals</TabsTrigger>
              <TabsTrigger value="plan">Plan of Care</TabsTrigger>
              <TabsTrigger value="diagnoses">Diagnoses</TabsTrigger>
            </TabsList>

            {/* Overview Tab */}
            <TabsContent value="overview" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="evaluation_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Evaluation Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField control={form.control} name="date_of_injury"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date of Injury</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="evaluating_therapist"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Evaluating Therapist</FormLabel>
                      <FormControl>
                        <Input placeholder="Therapist name" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField control={form.control} name="referring_provider"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Referring Provider</FormLabel>
                      <FormControl>
                        <Input placeholder="Provider name" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField control={form.control} name="chief_complaint"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Chief Complaint</FormLabel>
                    <FormControl>
                      <Textarea rows={2} placeholder="Chief complaint..." {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField control={form.control} name="mechanism_of_injury"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mechanism of Injury</FormLabel>
                    <FormControl>
                      <Textarea rows={2} placeholder="Mechanism of injury..." {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Pain Ratings */}
              <div className="space-y-2">
                <FormLabel>Pain Ratings (NPRS /10)</FormLabel>
                <div className="grid grid-cols-4 gap-3">
                  <FormField control={form.control} name="pain_ratings.at_rest"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">At Rest</FormLabel>
                        <FormControl>
                          <Input type="number" min={0} max={10} {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField control={form.control} name="pain_ratings.with_activity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">With Activity</FormLabel>
                        <FormControl>
                          <Input type="number" min={0} max={10} {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField control={form.control} name="pain_ratings.worst"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Worst</FormLabel>
                        <FormControl>
                          <Input type="number" min={0} max={10} {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField control={form.control} name="pain_ratings.best"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Best</FormLabel>
                        <FormControl>
                          <Input type="number" min={0} max={10} {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <FormField control={form.control} name="functional_limitations"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Functional Limitations</FormLabel>
                    <FormControl>
                      <Textarea rows={2} placeholder="Functional limitations..." {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField control={form.control} name="prior_treatment"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Prior Treatment</FormLabel>
                    <FormControl>
                      <Textarea rows={2} placeholder="Prior treatment history..." {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField control={form.control} name="work_status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Work Status</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Modified duty, Full duty" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </TabsContent>

            {/* Examination Tab */}
            <TabsContent value="exam" className="space-y-4 mt-4">
              <FormField control={form.control} name="postural_assessment"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Postural Assessment</FormLabel>
                    <FormControl>
                      <Textarea rows={2} placeholder="Postural findings..." {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField control={form.control} name="gait_analysis"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Gait Analysis</FormLabel>
                    <FormControl>
                      <Textarea rows={2} placeholder="Gait findings..." {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                    </FormControl>
                  </FormItem>
                )}
              />

              {/* ROM Section */}
              <CollapsibleSection
                title="Range of Motion"
                count={romArray.fields.length}
                sectionKey="rom"
                expanded={expandedSections}
                onToggle={toggleSection}
              >
                <div className="flex justify-end mb-2">
                  <Button type="button" variant="outline" size="sm" className="h-6 text-xs"
                    onClick={() => romArray.append({ region: '', movement: '', measurement_type: null, normal: null, actual: null, pain_at_end_range: false })}>
                    <Plus className="h-3 w-3 mr-1" /> Add
                  </Button>
                </div>
                {romArray.fields.length > 0 && (
                  <div className="space-y-1">
                    <div className="grid grid-cols-[1fr_80px_50px_50px_50px_40px_28px] gap-1 text-xs text-muted-foreground px-1">
                      <span>Region/Movement</span>
                      <span>Type</span>
                      <span>Normal</span>
                      <span>Actual</span>
                      <span>Pain</span>
                      <span />
                      <span />
                    </div>
                    {romArray.fields.map((romField, i) => (
                      <div key={romField.id} className="grid grid-cols-[1fr_80px_50px_50px_50px_40px_28px] gap-1 items-center">
                        <div className="flex gap-1">
                          <FormField control={form.control} name={`range_of_motion.${i}.region`}
                            render={({ field }) => (
                              <FormControl><Input className="h-7 text-xs" placeholder="Region" {...field} /></FormControl>
                            )}
                          />
                          <FormField control={form.control} name={`range_of_motion.${i}.movement`}
                            render={({ field }) => (
                              <FormControl><Input className="h-7 text-xs" placeholder="Movement" {...field} /></FormControl>
                            )}
                          />
                        </div>
                        <FormField control={form.control} name={`range_of_motion.${i}.measurement_type`}
                          render={({ field }) => (
                            <FormControl>
                              <select className="h-7 text-xs border rounded px-1 w-full"
                                value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)}>
                                <option value="">-</option>
                                <option value="AROM">AROM</option>
                                <option value="PROM">PROM</option>
                              </select>
                            </FormControl>
                          )}
                        />
                        <FormField control={form.control} name={`range_of_motion.${i}.normal`}
                          render={({ field }) => (
                            <FormControl>
                              <Input className="h-7 text-xs" type="number" {...field}
                                value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)} />
                            </FormControl>
                          )}
                        />
                        <FormField control={form.control} name={`range_of_motion.${i}.actual`}
                          render={({ field }) => (
                            <FormControl>
                              <Input className="h-7 text-xs" type="number" {...field}
                                value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)} />
                            </FormControl>
                          )}
                        />
                        <FormField control={form.control} name={`range_of_motion.${i}.pain_at_end_range`}
                          render={({ field }) => (
                            <FormControl>
                              <select className="h-7 text-xs border rounded px-1"
                                value={field.value ? 'Y' : 'N'} onChange={(e) => field.onChange(e.target.value === 'Y')}>
                                <option value="N">N</option>
                                <option value="Y">Y</option>
                              </select>
                            </FormControl>
                          )}
                        />
                        <span />
                        <Button type="button" variant="ghost" size="icon" className="h-6 w-6"
                          onClick={() => romArray.remove(i)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CollapsibleSection>

              {/* Muscle Strength Section */}
              <CollapsibleSection
                title="Muscle Strength"
                count={strengthArray.fields.length}
                sectionKey="strength"
                expanded={expandedSections}
                onToggle={toggleSection}
              >
                <div className="flex justify-end mb-2">
                  <Button type="button" variant="outline" size="sm" className="h-6 text-xs"
                    onClick={() => strengthArray.append({ muscle_group: '', side: null, grade: '' })}>
                    <Plus className="h-3 w-3 mr-1" /> Add
                  </Button>
                </div>
                {strengthArray.fields.length > 0 && (
                  <div className="space-y-1">
                    <div className="grid grid-cols-[1fr_100px_80px_28px] gap-1 text-xs text-muted-foreground px-1">
                      <span>Muscle Group</span>
                      <span>Side</span>
                      <span>Grade</span>
                      <span />
                    </div>
                    {strengthArray.fields.map((sf, i) => (
                      <div key={sf.id} className="grid grid-cols-[1fr_100px_80px_28px] gap-1 items-center">
                        <FormField control={form.control} name={`muscle_strength.${i}.muscle_group`}
                          render={({ field }) => (
                            <FormControl><Input className="h-7 text-xs" placeholder="e.g. Grip Strength" {...field} /></FormControl>
                          )}
                        />
                        <FormField control={form.control} name={`muscle_strength.${i}.side`}
                          render={({ field }) => (
                            <FormControl>
                              <select className="h-7 text-xs border rounded px-1 w-full"
                                value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)}>
                                <option value="">-</option>
                                <option value="left">Left</option>
                                <option value="right">Right</option>
                                <option value="bilateral">Bilateral</option>
                              </select>
                            </FormControl>
                          )}
                        />
                        <FormField control={form.control} name={`muscle_strength.${i}.grade`}
                          render={({ field }) => (
                            <FormControl><Input className="h-7 text-xs" placeholder="e.g. 4/5" {...field} /></FormControl>
                          )}
                        />
                        <Button type="button" variant="ghost" size="icon" className="h-6 w-6"
                          onClick={() => strengthArray.remove(i)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CollapsibleSection>

              {/* Palpation Findings */}
              <CollapsibleSection
                title="Palpation Findings"
                count={palpationArray.fields.length}
                sectionKey="palpation"
                expanded={expandedSections}
                onToggle={toggleSection}
              >
                <div className="flex justify-end mb-2">
                  <Button type="button" variant="outline" size="sm" className="h-6 text-xs"
                    onClick={() => palpationArray.append({ location: '', tenderness_grade: null, spasm: false, trigger_points: false })}>
                    <Plus className="h-3 w-3 mr-1" /> Add
                  </Button>
                </div>
                {palpationArray.fields.map((pf, i) => (
                  <div key={pf.id} className="grid grid-cols-[1fr_80px_60px_60px_28px] gap-1 items-center">
                    <FormField control={form.control} name={`palpation_findings.${i}.location`}
                      render={({ field }) => (
                        <FormControl><Input className="h-7 text-xs" placeholder="Location" {...field} /></FormControl>
                      )}
                    />
                    <FormField control={form.control} name={`palpation_findings.${i}.tenderness_grade`}
                      render={({ field }) => (
                        <FormControl>
                          <Input className="h-7 text-xs" placeholder="Grade" {...field}
                            value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                        </FormControl>
                      )}
                    />
                    <FormField control={form.control} name={`palpation_findings.${i}.spasm`}
                      render={({ field }) => (
                        <FormControl>
                          <select className="h-7 text-xs border rounded px-1 w-full"
                            value={field.value ? 'Y' : 'N'} onChange={(e) => field.onChange(e.target.value === 'Y')}>
                            <option value="N">No Spasm</option>
                            <option value="Y">Spasm</option>
                          </select>
                        </FormControl>
                      )}
                    />
                    <FormField control={form.control} name={`palpation_findings.${i}.trigger_points`}
                      render={({ field }) => (
                        <FormControl>
                          <select className="h-7 text-xs border rounded px-1 w-full"
                            value={field.value ? 'Y' : 'N'} onChange={(e) => field.onChange(e.target.value === 'Y')}>
                            <option value="N">No TrP</option>
                            <option value="Y">TrP</option>
                          </select>
                        </FormControl>
                      )}
                    />
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6"
                      onClick={() => palpationArray.remove(i)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </CollapsibleSection>

              {/* Special Tests */}
              <CollapsibleSection
                title="Special Tests"
                count={specialTestsArray.fields.length}
                sectionKey="special_tests"
                expanded={expandedSections}
                onToggle={toggleSection}
              >
                <div className="flex justify-end mb-2">
                  <Button type="button" variant="outline" size="sm" className="h-6 text-xs"
                    onClick={() => specialTestsArray.append({ name: '', result: 'negative', side: null, notes: null })}>
                    <Plus className="h-3 w-3 mr-1" /> Add
                  </Button>
                </div>
                {specialTestsArray.fields.map((stf, i) => (
                  <div key={stf.id} className="grid grid-cols-[1fr_90px_90px_28px] gap-1 items-center">
                    <FormField control={form.control} name={`special_tests.${i}.name`}
                      render={({ field }) => (
                        <FormControl><Input className="h-7 text-xs" placeholder="Test name" {...field} /></FormControl>
                      )}
                    />
                    <FormField control={form.control} name={`special_tests.${i}.result`}
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
                    <FormField control={form.control} name={`special_tests.${i}.side`}
                      render={({ field }) => (
                        <FormControl>
                          <select className="h-7 text-xs border rounded px-1 w-full"
                            value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)}>
                            <option value="">-</option>
                            <option value="left">Left</option>
                            <option value="right">Right</option>
                            <option value="bilateral">Bilateral</option>
                          </select>
                        </FormControl>
                      )}
                    />
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6"
                      onClick={() => specialTestsArray.remove(i)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </CollapsibleSection>

              {/* Neurological Screening */}
              <CollapsibleSection
                title="Neurological Screening"
                count={0}
                sectionKey="neuro"
                expanded={expandedSections}
                onToggle={toggleSection}
              >
                <NeurologicalSection form={form} />
              </CollapsibleSection>

              {/* Functional Tests */}
              <CollapsibleSection
                title="Functional Tests"
                count={functionalTestsArray.fields.length}
                sectionKey="functional_tests"
                expanded={expandedSections}
                onToggle={toggleSection}
              >
                <div className="flex justify-end mb-2">
                  <Button type="button" variant="outline" size="sm" className="h-6 text-xs"
                    onClick={() => functionalTestsArray.append({ name: '', value: '', interpretation: null })}>
                    <Plus className="h-3 w-3 mr-1" /> Add
                  </Button>
                </div>
                {functionalTestsArray.fields.map((ftf, i) => (
                  <div key={ftf.id} className="grid grid-cols-[1fr_100px_1fr_28px] gap-1 items-center">
                    <FormField control={form.control} name={`functional_tests.${i}.name`}
                      render={({ field }) => (
                        <FormControl><Input className="h-7 text-xs" placeholder="Test name" {...field} /></FormControl>
                      )}
                    />
                    <FormField control={form.control} name={`functional_tests.${i}.value`}
                      render={({ field }) => (
                        <FormControl><Input className="h-7 text-xs" placeholder="Value" {...field} /></FormControl>
                      )}
                    />
                    <FormField control={form.control} name={`functional_tests.${i}.interpretation`}
                      render={({ field }) => (
                        <FormControl>
                          <Input className="h-7 text-xs" placeholder="Interpretation" {...field}
                            value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                        </FormControl>
                      )}
                    />
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6"
                      onClick={() => functionalTestsArray.remove(i)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </CollapsibleSection>
            </TabsContent>

            {/* Outcome Measures Tab */}
            <TabsContent value="outcomes" className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <FormLabel>Outcome Measures</FormLabel>
                <Button type="button" variant="outline" size="sm"
                  onClick={() => outcomeMeasuresArray.append({ instrument: '', score: null, max_score: null, percentage: null, interpretation: null })}>
                  <Plus className="h-3 w-3 mr-1" /> Add Measure
                </Button>
              </div>

              {outcomeMeasuresArray.fields.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">
                  No outcome measures. Click &quot;Add Measure&quot; to add one.
                </p>
              )}

              {outcomeMeasuresArray.fields.map((omf, i) => (
                <div key={omf.id} className="border rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Measure {i + 1}</span>
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6"
                      onClick={() => outcomeMeasuresArray.remove(i)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>

                  <FormField control={form.control} name={`outcome_measures.${i}.instrument`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Instrument</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Neck Disability Index (NDI)" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-3 gap-3">
                    <FormField control={form.control} name={`outcome_measures.${i}.score`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Score</FormLabel>
                          <FormControl>
                            <Input type="number" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField control={form.control} name={`outcome_measures.${i}.max_score`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Max Score</FormLabel>
                          <FormControl>
                            <Input type="number" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField control={form.control} name={`outcome_measures.${i}.percentage`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Percentage</FormLabel>
                          <FormControl>
                            <Input type="number" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField control={form.control} name={`outcome_measures.${i}.interpretation`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Interpretation</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Severe disability" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              ))}
            </TabsContent>

            {/* Goals Tab */}
            <TabsContent value="goals" className="space-y-6 mt-4">
              {/* Assessment fields */}
              <FormField control={form.control} name="clinical_impression"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Clinical Impression</FormLabel>
                    <FormControl>
                      <Textarea rows={2} placeholder="Clinical impression..." {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField control={form.control} name="causation_statement"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Causation Statement</FormLabel>
                    <FormControl>
                      <Textarea rows={2} placeholder="Causation statement..." {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField control={form.control} name="prognosis"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Prognosis</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Good, Fair, Poor" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                    </FormControl>
                  </FormItem>
                )}
              />

              {/* Short-Term Goals */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <FormLabel>Short-Term Goals (2-4 weeks)</FormLabel>
                  <Button type="button" variant="outline" size="sm"
                    onClick={() => stGoalsArray.append({ description: '', timeframe: null, baseline: null, target: null })}>
                    <Plus className="h-3 w-3 mr-1" /> Add Goal
                  </Button>
                </div>
                {stGoalsArray.fields.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">
                    No short-term goals.
                  </p>
                )}
                {stGoalsArray.fields.map((gf, i) => (
                  <GoalCard key={gf.id} form={form} prefix={`short_term_goals.${i}`} index={i} onRemove={() => stGoalsArray.remove(i)} />
                ))}
              </div>

              {/* Long-Term Goals */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <FormLabel>Long-Term Goals (6-12 weeks)</FormLabel>
                  <Button type="button" variant="outline" size="sm"
                    onClick={() => ltGoalsArray.append({ description: '', timeframe: null, baseline: null, target: null })}>
                    <Plus className="h-3 w-3 mr-1" /> Add Goal
                  </Button>
                </div>
                {ltGoalsArray.fields.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">
                    No long-term goals.
                  </p>
                )}
                {ltGoalsArray.fields.map((gf, i) => (
                  <GoalCard key={gf.id} form={form} prefix={`long_term_goals.${i}`} index={i} onRemove={() => ltGoalsArray.remove(i)} />
                ))}
              </div>
            </TabsContent>

            {/* Plan of Care Tab */}
            <TabsContent value="plan" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="plan_of_care.frequency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Frequency</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. 3x/week" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField control={form.control} name="plan_of_care.duration"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Duration</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. 6 weeks" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <FormField control={form.control} name="plan_of_care.home_exercise_program"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2">
                    <FormControl>
                      <input type="checkbox" className="rounded border-gray-300"
                        checked={field.value ?? false}
                        onChange={(e) => field.onChange(e.target.checked)} />
                    </FormControl>
                    <FormLabel className="!mt-0">Home Exercise Program Prescribed</FormLabel>
                  </FormItem>
                )}
              />

              <FormField control={form.control} name="plan_of_care.re_evaluation_schedule"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Re-evaluation Schedule</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Every 10 visits or 30 days" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                    </FormControl>
                  </FormItem>
                )}
              />

              {/* Modalities */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <FormLabel>Modalities</FormLabel>
                  <Button type="button" variant="outline" size="sm"
                    onClick={() => modalitiesArray.append({ name: '', cpt_code: null })}>
                    <Plus className="h-3 w-3 mr-1" /> Add Modality
                  </Button>
                </div>
                {modalitiesArray.fields.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">
                    No modalities.
                  </p>
                )}
                {modalitiesArray.fields.map((mf, i) => (
                  <div key={mf.id} className="grid grid-cols-[1fr_120px_28px] gap-1 items-center">
                    <FormField control={form.control} name={`plan_of_care.modalities.${i}.name`}
                      render={({ field }) => (
                        <FormControl><Input className="h-8 text-sm" placeholder="e.g. Therapeutic Exercise" {...field} /></FormControl>
                      )}
                    />
                    <FormField control={form.control} name={`plan_of_care.modalities.${i}.cpt_code`}
                      render={({ field }) => (
                        <FormControl>
                          <Input className="h-8 text-sm" placeholder="CPT code" {...field}
                            value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                        </FormControl>
                      )}
                    />
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6"
                      onClick={() => modalitiesArray.remove(i)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </TabsContent>

            {/* Diagnoses Tab */}
            <TabsContent value="diagnoses" className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <FormLabel>Diagnoses</FormLabel>
                <Button type="button" variant="outline" size="sm"
                  onClick={() => diagnosesArray.append({ icd10_code: null, description: '' })}>
                  <Plus className="h-3 w-3 mr-1" /> Add Diagnosis
                </Button>
              </div>

              {diagnosesArray.fields.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">
                  No diagnoses. Click &quot;Add Diagnosis&quot; to add one.
                </p>
              )}

              {diagnosesArray.fields.map((df, i) => (
                <div key={df.id} className="border rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Diagnosis {i + 1}</span>
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6"
                      onClick={() => diagnosesArray.remove(i)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <FormField control={form.control} name={`diagnoses.${i}.icd10_code`}
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
                      <FormField control={form.control} name={`diagnoses.${i}.description`}
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

// --- Collapsible section helper ---

function CollapsibleSection({
  title,
  count,
  sectionKey,
  expanded,
  onToggle,
  children,
}: {
  title: string
  count: number
  sectionKey: string
  expanded: Record<string, boolean>
  onToggle: (key: string) => void
  children: React.ReactNode
}) {
  const isExpanded = expanded[sectionKey] ?? false
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => onToggle(sectionKey)}
        className="w-full flex items-center justify-between p-3 hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <span className="font-medium text-sm">{title}</span>
          {count > 0 && <span className="text-xs text-muted-foreground">{count} items</span>}
        </div>
      </button>
      {isExpanded && <div className="p-3 pt-0 border-t">{children}</div>}
    </div>
  )
}

// --- Goal card helper ---

function GoalCard({
  form,
  prefix,
  index,
  onRemove,
}: {
  form: ReturnType<typeof useForm<PtReviewFormValues>>
  prefix: string
  index: number
  onRemove: () => void
}) {
  return (
    <div className="border rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Goal {index + 1}</span>
        <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={onRemove}>
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
      <FormField control={form.control} name={`${prefix}.description` as keyof PtReviewFormValues}
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">Description</FormLabel>
            <FormControl>
              <Textarea rows={2} placeholder="Goal description..." {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="grid grid-cols-3 gap-3">
        <FormField control={form.control} name={`${prefix}.timeframe` as keyof PtReviewFormValues}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Timeframe</FormLabel>
              <FormControl>
                <Input placeholder="e.g. 4 weeks" {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField control={form.control} name={`${prefix}.baseline` as keyof PtReviewFormValues}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Baseline</FormLabel>
              <FormControl>
                <Input placeholder="e.g. 42°" {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField control={form.control} name={`${prefix}.target` as keyof PtReviewFormValues}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Target</FormLabel>
              <FormControl>
                <Input placeholder="e.g. 55°" {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
              </FormControl>
            </FormItem>
          )}
        />
      </div>
    </div>
  )
}

// --- Neurological screening sub-section ---

function NeurologicalSection({
  form,
}: {
  form: ReturnType<typeof useForm<PtReviewFormValues>>
}) {
  const reflexesArray = useFieldArray({
    control: form.control,
    name: 'neurological_screening.reflexes',
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">Reflexes</span>
        <Button type="button" variant="outline" size="sm" className="h-6 text-xs"
          onClick={() => reflexesArray.append({ location: '', grade: '', side: null })}>
          <Plus className="h-3 w-3 mr-1" /> Add
        </Button>
      </div>
      {reflexesArray.fields.map((rf, i) => (
        <div key={rf.id} className="grid grid-cols-[1fr_80px_90px_28px] gap-1 items-center">
          <FormField control={form.control} name={`neurological_screening.reflexes.${i}.location`}
            render={({ field }) => (
              <FormControl><Input className="h-7 text-xs" placeholder="e.g. Biceps (C5/C6)" {...field} /></FormControl>
            )}
          />
          <FormField control={form.control} name={`neurological_screening.reflexes.${i}.grade`}
            render={({ field }) => (
              <FormControl><Input className="h-7 text-xs" placeholder="e.g. 2+" {...field} /></FormControl>
            )}
          />
          <FormField control={form.control} name={`neurological_screening.reflexes.${i}.side`}
            render={({ field }) => (
              <FormControl>
                <select className="h-7 text-xs border rounded px-1 w-full"
                  value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)}>
                  <option value="">-</option>
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                  <option value="bilateral">Bilateral</option>
                </select>
              </FormControl>
            )}
          />
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6"
            onClick={() => reflexesArray.remove(i)}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}

      <FormField control={form.control} name="neurological_screening.sensation"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">Sensation</FormLabel>
            <FormControl>
              <Input placeholder="Sensation findings..." {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
            </FormControl>
          </FormItem>
        )}
      />

      <FormField control={form.control} name="neurological_screening.motor_notes"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">Motor Notes</FormLabel>
            <FormControl>
              <Input placeholder="Motor findings..." {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
            </FormControl>
          </FormItem>
        )}
      />
    </div>
  )
}
