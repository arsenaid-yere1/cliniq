export type ComplaintSide = 'left' | 'right' | 'bilateral' | ''

export const complaintFactorHints = {
  neck: {
    label: 'Neck',
    worse: ['Turning the head', 'Looking down', 'Prolonged desk work', 'Driving', 'Sleeping position', 'Looking up'],
    better: ['Rest', 'Changing position', 'Heat', 'Ice'],
  },
  back: {
    label: 'Lower back',
    worse: ['Prolonged sitting', 'Bending', 'Lifting', 'Standing', 'Walking', 'Twisting'],
    better: ['Rest', 'Changing position', 'Lying down', 'Heat'],
  },
  shoulder: {
    label: 'Shoulder',
    worse: ['Reaching overhead', 'Lifting', 'Lying on that side', 'Reaching behind', 'Pushing or pulling', 'Carrying a bag'],
    better: ['Rest', 'Supporting the arm', 'Ice', 'Changing position'],
  },
  knee: {
    label: 'Knee',
    worse: ['Stairs', 'Squatting', 'Prolonged standing', 'Walking', 'Kneeling', 'Getting up from a chair'],
    better: ['Rest', 'Sitting', 'Ice', 'Elevation'],
  },
  upper_back: {
    label: 'Upper back',
    worse: ['Prolonged sitting', 'Twisting', 'Lifting', 'Reaching forward', 'Overhead activity', 'Prolonged desk work'],
    better: ['Changing position', 'Rest', 'Heat', 'Supporting the back'],
  },
  hip: {
    label: 'Hip',
    worse: ['Walking', 'Stairs', 'Lying on that side', 'Getting up from a low chair', 'Running', 'Prolonged standing'],
    better: ['Rest', 'Changing position', 'Ice', 'Reducing weight bearing'],
  },
  elbow: {
    label: 'Elbow',
    worse: ['Gripping', 'Lifting', 'Twisting a lid', 'Repetitive arm use', 'Bending or straightening the elbow', 'Leaning on the elbow'],
    better: ['Rest', 'Ice', 'Supporting the arm', 'Reducing repetitive activity'],
  },
  wrist: {
    label: 'Wrist',
    worse: ['Typing', 'Gripping', 'Lifting', 'Bending the wrist', 'Pushing up from a chair', 'Using vibrating tools'],
    better: ['Rest', 'Ice', 'Wearing a wrist support', 'Reducing repetitive activity'],
  },
  hand: {
    label: 'Hand / fingers',
    worse: ['Gripping', 'Pinching', 'Opening jars', 'Typing', 'Writing', 'Bending or straightening the fingers'],
    better: ['Rest', 'Heat', 'Ice', 'Reducing repetitive activity'],
  },
  ankle: {
    label: 'Ankle',
    worse: ['Walking', 'Stairs', 'Uneven ground', 'Running', 'Prolonged standing', 'Moving the ankle'],
    better: ['Rest', 'Ice', 'Elevation', 'Reducing weight bearing'],
  },
  foot: {
    label: 'Foot / toes',
    worse: ['Walking', 'Prolonged standing', 'Running', 'Tight shoes', 'Walking barefoot', 'Pushing off through the toes'],
    better: ['Rest', 'Supportive footwear', 'Ice', 'Elevation'],
  },
  general: {
    label: 'General',
    worse: ['Activity', 'Prolonged positioning', 'Movement'],
    better: ['Rest', 'Changing position', 'Heat', 'Ice'],
  },
} as const

const aliases: Record<string, keyof typeof complaintFactorHints> = {
  neck: 'neck', cervical: 'neck', 'cervical spine': 'neck', 'c-spine': 'neck',
  'low back': 'back', 'lower back': 'back', lumbar: 'back', 'lumbar spine': 'back',
  'l-spine': 'back', lumbosacral: 'back',
  shoulder: 'shoulder', shoulders: 'shoulder', knee: 'knee', knees: 'knee',
  'upper back': 'upper_back', 'mid back': 'upper_back', 'middle back': 'upper_back',
  thoracic: 'upper_back', 'thoracic spine': 'upper_back', 't-spine': 'upper_back',
  hip: 'hip', hips: 'hip',
  elbow: 'elbow', elbows: 'elbow',
  wrist: 'wrist', wrists: 'wrist',
  hand: 'hand', hands: 'hand', finger: 'hand', fingers: 'hand', thumb: 'hand',
  'hand / fingers': 'hand', 'hand/fingers': 'hand',
  ankle: 'ankle', ankles: 'ankle',
  foot: 'foot', feet: 'foot', toe: 'foot', toes: 'foot',
  'foot / toes': 'foot', 'foot/toes': 'foot',
}
const sideNames = { left: 'Left', right: 'Right', bilateral: 'Bilateral', '': '' } as const
const sidePrefix = /^(\s*)(left|lt|l|right|rt|r|bilateral|bilat|both)\.?\s+/i

// Match exact region aliases, optionally followed by "pain". Compound or clinical prose stays general.
export function getComplaintRegion(raw: string) {
  const match = raw.match(sidePrefix)
  const base = match ? raw.slice(match[0].length) : raw
  const alias = base.trim().toLowerCase().replace(/\s+/g, ' ').replace(/ pain$/, '')
  const key = Object.hasOwn(aliases, alias) ? aliases[alias] : 'general'
  const token = match?.[2].toLowerCase()
  const side: ComplaintSide = key === 'general' || !token ? ''
    : ['left', 'lt', 'l'].includes(token) ? 'left'
      : ['right', 'rt', 'r'].includes(token) ? 'right' : 'bilateral'
  return { key, side, hints: complaintFactorHints[key] }
}

export function setComplaintSide(raw: string, side: ComplaintSide): string {
  if (getComplaintRegion(raw).key === 'general') return raw
  const match = raw.match(sidePrefix)
  const leading = match?.[1] ?? raw.match(/^\s*/)?.[0] ?? ''
  const base = match ? raw.slice(match[0].length) : raw.slice(leading.length)
  return `${leading}${side ? `${sideNames[side]} ` : ''}${base}`
}

export function complaintRegionOptions(raw: string): string[] {
  const side = getComplaintRegion(raw).side
  const prefix = side ? `${sideNames[side]} ` : ''
  return ['Neck', 'Cervical spine', 'Cervical', 'C-spine', 'Lower back', 'Low back', 'Lumbar spine', 'Lumbar', 'L-spine', 'Lumbosacral', 'Shoulder', 'Knee', 'Upper back', 'Mid back', 'Thoracic spine', 'Hip', 'Elbow', 'Wrist', 'Hand / fingers', 'Hand', 'Fingers', 'Thumb', 'Ankle', 'Foot / toes', 'Foot', 'Toes']
    .map(region => `${prefix}${region}`)
}
