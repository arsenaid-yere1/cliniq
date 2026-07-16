// Static enum lists for the Record Procedure dialog. Closed lists prevent
// drug-name and gauge typos that would propagate to the LLM-generated
// procedure note and rendered PDF.

export const NEEDLE_GAUGE_OPTIONS = [
  '22-gauge',
  '22-gauge spinal',
  '25-gauge',
  '25-gauge spinal',
  '27-gauge',
  '27-gauge spinal',
  '30-gauge',
] as const

export const ANESTHETIC_AGENT_OPTIONS = [
  'Lidocaine 1%',
  'Lidocaine 2%',
  'Bupivacaine 0.25%',
  'Bupivacaine 0.5%',
  'None',
] as const

export const TARGET_STRUCTURE_OPTIONS = [
  { value: 'periarticular',          label: 'Periarticular' },
  { value: 'facet_capsular',         label: 'Facet capsular' },
  { value: 'intradiscal',            label: 'Intradiscal' },
  { value: 'epidural',               label: 'Epidural' },
  { value: 'transforaminal',         label: 'Transforaminal' },
  { value: 'sacroiliac_adjacent',    label: 'Sacroiliac-adjacent' },
  { value: 'intra_articular',        label: 'Intra-articular' },
] as const

// Therapeutic BOTOX (onabotulinumtoxinA) target muscles. Seeded from the
// masseter/temporalis TMJ case; extend as the clinic's therapeutic indications grow.
export const BOTOX_MUSCLE_OPTIONS = [
  { value: 'masseter', label: 'Masseter' },
  { value: 'temporalis', label: 'Temporalis' },
  { value: 'frontalis', label: 'Frontalis' },
  { value: 'corrugator', label: 'Corrugator' },
  { value: 'procerus', label: 'Procerus' },
  { value: 'occipitalis', label: 'Occipitalis' },
  { value: 'trapezius', label: 'Trapezius' },
  { value: 'splenius_capitis', label: 'Splenius capitis' },
  { value: 'sternocleidomastoid', label: 'Sternocleidomastoid' },
] as const

export type NeedleGauge = typeof NEEDLE_GAUGE_OPTIONS[number]
export type AnestheticAgent = typeof ANESTHETIC_AGENT_OPTIONS[number]
export type TargetStructure = typeof TARGET_STRUCTURE_OPTIONS[number]['value']
export type BotoxMuscle = typeof BOTOX_MUSCLE_OPTIONS[number]['value']
