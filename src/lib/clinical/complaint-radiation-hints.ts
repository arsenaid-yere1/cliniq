import type { ComplaintSide } from './complaint-factor-hints'

type RadiationAreaKey = keyof typeof complaintRadiationHints

interface RadiationArea {
  label: string
  aliases: string[]
  destinations: string[]
}

export const complaintRadiationHints = {
  head_occipital: {
    label: 'Head/occipital',
    aliases: ['Head', 'Headache', 'Occiput', 'Occipital'],
    destinations: ['Neck', 'Temple', 'Forehead', 'Behind the eye'],
  },
  jaw_tmj: {
    label: 'Jaw/TMJ',
    aliases: ['Jaw', 'TMJ', 'Temporomandibular'],
    destinations: ['Ear', 'Temple', 'Face', 'Neck'],
  },
  neck_cervical: {
    label: 'Neck/cervical',
    aliases: ['Neck', 'Cervical', 'Cervical spine', 'C-spine', 'C spine'],
    destinations: ['Shoulder', 'Shoulder blade', 'Arm', 'Forearm', 'Hand', 'Fingers'],
  },
  upper_back: {
    label: 'Upper/mid back',
    aliases: ['Upper back', 'Mid back', 'Middle back', 'Thoracic', 'Thoracic spine', 'T-spine', 'T spine'],
    destinations: ['Shoulder blade', 'Around the ribs', 'Side of chest', 'Front of chest'],
  },
  lower_back: {
    label: 'Lower back/lumbar',
    aliases: ['Low back', 'Lower back', 'Lumbar', 'Lumbar spine', 'L-spine', 'L spine', 'Lumbosacral'],
    destinations: ['Buttock', 'Thigh', 'Lower leg', 'Calf', 'Foot', 'Toes'],
  },
  si_buttock: {
    label: 'SI/buttock',
    aliases: ['Sacroiliac', 'SI joint', 'SI region', 'Buttock', 'Buttocks', 'Gluteal', 'Gluteus'],
    destinations: ['Lower back', 'Hip', 'Groin', 'Thigh', 'Leg'],
  },
  tailbone: {
    label: 'Tailbone',
    aliases: ['Tailbone', 'Coccyx', 'Coccygeal'],
    destinations: ['Buttock', 'Sacral area'],
  },
  shoulder: {
    label: 'Shoulder',
    aliases: ['Shoulder'],
    destinations: ['Upper arm', 'Elbow', 'Shoulder blade', 'Neck'],
  },
  shoulder_blade: {
    label: 'Shoulder blade',
    aliases: ['Shoulder blade', 'Scapula', 'Scapular'],
    destinations: ['Neck', 'Shoulder', 'Upper back', 'Arm'],
  },
  upper_arm: {
    label: 'Upper arm',
    aliases: ['Upper arm'],
    destinations: ['Shoulder', 'Elbow', 'Forearm'],
  },
  elbow: {
    label: 'Elbow',
    aliases: ['Elbow'],
    destinations: ['Forearm', 'Wrist', 'Hand', 'Fingers'],
  },
  forearm: {
    label: 'Forearm',
    aliases: ['Forearm'],
    destinations: ['Elbow', 'Wrist', 'Hand', 'Fingers'],
  },
  wrist: {
    label: 'Wrist',
    aliases: ['Wrist'],
    destinations: ['Hand', 'Thumb', 'Fingers', 'Forearm'],
  },
  hand_fingers: {
    label: 'Hand/fingers',
    aliases: ['Hand', 'Hands', 'Finger', 'Fingers', 'Thumb'],
    destinations: ['Wrist', 'Forearm', 'Fingers'],
  },
  hip_groin: {
    label: 'Hip/groin',
    aliases: ['Hip', 'Hips', 'Groin'],
    destinations: ['Thigh', 'Knee', 'Buttock', 'Lower back'],
  },
  thigh: {
    label: 'Thigh',
    aliases: ['Thigh', 'Thighs'],
    destinations: ['Hip', 'Knee', 'Lower leg'],
  },
  knee: {
    label: 'Knee',
    aliases: ['Knee', 'Knees'],
    destinations: ['Thigh', 'Shin', 'Calf'],
  },
  lower_leg: {
    label: 'Lower leg/calf',
    aliases: ['Lower leg', 'Lower legs', 'Calf', 'Calves', 'Shin'],
    destinations: ['Knee', 'Ankle', 'Foot'],
  },
  ankle: {
    label: 'Ankle',
    aliases: ['Ankle', 'Ankles'],
    destinations: ['Foot', 'Heel', 'Lower leg'],
  },
  heel_achilles: {
    label: 'Heel/Achilles',
    aliases: ['Heel', 'Heels', 'Achilles', 'Achilles tendon'],
    destinations: ['Sole of foot', 'Calf', 'Ankle'],
  },
  foot_toes: {
    label: 'Foot/toes',
    aliases: ['Foot', 'Feet', 'Toe', 'Toes'],
    destinations: ['Toes', 'Arch of foot', 'Heel', 'Ankle'],
  },
  chest_wall: {
    label: 'Chest wall/ribs',
    aliases: ['Chest wall', 'Rib', 'Ribs', 'Rib cage'],
    destinations: ['Side of chest', 'Back', 'Front of chest'],
  },
  general: {
    label: 'General',
    aliases: [],
    destinations: [],
  },
} as const satisfies Record<string, RadiationArea>

const sidePrefix = /^\s*(left|lt|l|right|rt|r|bilateral|bilat|both)\.?\s+/i
const sideNames = { left: 'Left', right: 'Right', bilateral: 'Bilateral', '': '' } as const
const aliasToRadiationArea: Record<string, RadiationAreaKey> = Object.create(null)

for (const key of Object.keys(complaintRadiationHints) as RadiationAreaKey[]) {
  for (const alias of complaintRadiationHints[key].aliases) {
    aliasToRadiationArea[alias.trim().toLowerCase()] = key
  }
}

const normalizeRegionAlias = (raw: string) => raw.trim().toLowerCase().replace(/\s+/g, ' ')

export function getComplaintRadiationRegion(raw: string) {
  const match = raw.match(sidePrefix)
  const base = (match ? raw.slice(match[0].length) : raw).trim()
  const alias = normalizeRegionAlias(base)
  const key = Object.hasOwn(aliasToRadiationArea, alias) ? aliasToRadiationArea[alias] : 'general'
  const token = match?.[1]?.toLowerCase()
  const side: ComplaintSide = token === 'left' || token === 'lt' || token === 'l'
    ? 'left'
    : token === 'right' || token === 'rt' || token === 'r'
      ? 'right'
      : token === 'bilateral' || token === 'bilat' || token === 'both'
        ? 'bilateral' : ''

  return {
    key,
    side,
    label: complaintRadiationHints[key].label,
    destinations: complaintRadiationHints[key].destinations,
  }
}

export function complaintRadiationRegionOptions(raw: string) {
  const { side } = getComplaintRadiationRegion(raw)
  const prefix = side ? `${sideNames[side]} ` : ''
  const options = new Set<string>()
  for (const [key, { aliases }] of Object.entries(complaintRadiationHints) as [RadiationAreaKey, { aliases: readonly string[] }][]) {
    if (key === 'general') continue
    for (const alias of aliases) {
      options.add(`${prefix}${alias}`)
    }
  }
  return [...options]
}
