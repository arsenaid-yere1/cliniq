// Exam documentation examples. Only explicitly completed text is saved.
// Keep this module independent of intake validation and evidence schemas.
export type ExamField = 'general_appearance' | 'palpation_findings' | 'additional_findings' | 'neurological_notes'
export interface ExamExample { id: string; label: string; template: string; field: ExamField; group: string }
export interface ExamRegionOption { key: string; label: string; aliases: string[]; sites: string[]; exampleIds: string[] }
export interface CompletionField { key: string; label: string; options?: readonly string[]; numeric?: boolean; optional?: boolean; suggestions?: readonly string[] }

const definitions: readonly (readonly [string, string, string])[] = [
  ["G01", "Alert and oriented", "Alert and oriented to {assessed domains}"],
  ["G02", "No acute distress", "No acute distress"],
  ["G03", "Appears uncomfortable", "Appears uncomfortable"],
  ["G04", "Guarded posture", "Guarded posture observed: {detail}"],
  ["G05", "Changes position frequently", "Frequently changes position during the examination"],
  ["G06", "Comfortable at rest", "Appears comfortable at rest"],
  ["G07", "Assistance with positioning", "Requires {assistance} for examination positioning"],
  ["G08", "Participation limited", "Examination participation limited by {reason}"],
  ["P01", "Localized tenderness", "Tenderness at {site}"],
  ["P02", "No focal tenderness", "No focal tenderness in {examined site}"],
  ["P03", "Increased warmth", "Increased warmth at {site}"],
  ["P04", "No increased warmth", "No increased warmth at {examined site}"],
  ["P05", "Palpable swelling", "Palpable swelling at {site}"],
  ["P06", "No palpable swelling", "No palpable swelling at {examined site}"],
  ["P07", "Palpable crepitus", "Palpable crepitus at {site} during {movement}"],
  ["P08", "Bony tenderness", "Bony tenderness at {site}"],
  ["P09", "Soft-tissue tenderness", "Soft-tissue tenderness at {site}"],
  ["P10", "Joint-line tenderness", "Joint-line tenderness at {joint and side, aspect}"],
  ["P11", "Palpation limited", "Palpation of {site} limited by {reason}"],
  ["P12", "Palpation not performed", "Palpation of {site} not performed: {reason}"],
  ["I01", "No visible swelling", "No visible swelling at {examined site}"],
  ["I02", "Visible swelling", "Visible swelling at {site}: {description}"],
  ["I03", "Bruising", "Ecchymosis at {site}: {description}"],
  ["I04", "Erythema", "Erythema at {site}: {description}"],
  ["I05", "No erythema", "No erythema at {examined site}"],
  ["I06", "Skin intact", "Skin intact over {examined site}"],
  ["I07", "Abrasion / skin finding", "{Observed skin finding} at {site}: {description}"],
  ["I08", "Effusion observed", "Effusion observed at {joint and side}: {assessment detail}"],
  ["I09", "No effusion appreciated", "No effusion appreciated at {joint and side} on {assessment}"],
  ["I10", "No visible deformity", "No visible deformity at {examined site}"],
  ["I11", "Visible deformity / asymmetry", "{Deformity or asymmetry observed} at {site}"],
  ["I12", "Muscle bulk reduced", "Reduced muscle bulk at {site} compared with {comparison}"],
  ["I13", "Muscle bulk symmetric", "Muscle bulk symmetric in {examined paired sites}"],
  ["I14", "Alignment observation", "Alignment of {joint and side}: {observation}"],
  ["I15", "Scar", "Scar at {site}: {description}"],
  ["I16", "Local examination limited", "Examination of {site} limited by {reason}"],
  ["M01", "Movement preserved", "{Mode} {movement} at {site} preserved on examination"],
  ["M02", "Movement limited", "{Mode} {movement} at {site} limited: {observed limitation}"],
  ["M03", "Measured range of motion", "{Mode} {movement} at {site}: {value} {unit}"],
  ["M04", "Pain with movement", "Pain with {mode} {movement} at {site}: {response}"],
  ["M05", "No pain with movement", "No pain elicited with {mode} {movement} at {site}"],
  ["M06", "Movement not assessed", "{Mode} {movement} at {site} not assessed: {reason}"],
  ["M07", "Pain with resisted movement", "Pain with resisted {movement} at {site}: {response}"],
  ["M08", "No pain with resisted movement", "No pain elicited with resisted {movement} at {site}"],
  ["M09", "Movement-associated crepitus", "Crepitus observed with {movement} at {site}"],
  ["M10", "Other movement observation", "During {movement} at {site}, {observation}"],
  ["N01", "Strength grade", "{Muscle or movement}, {side}: strength {grade}/5"],
  ["N02", "Strength limited by pain", "Strength testing of {scope} limited by pain: {detail}"],
  ["N03", "Strength not assessed", "Strength of {scope} not assessed: {reason}"],
  ["N04", "Light-touch sensation intact", "Sensation intact to light touch in {scope}"],
  ["N05", "Light-touch sensation reduced", "Reduced light-touch sensation in {scope}"],
  ["N06", "Sensation absent", "Sensation to {tested modality} absent in {scope}"],
  ["N07", "Sensory asymmetry", "Sensation to {tested modality} asymmetric between {compared sites}: {detail}"],
  ["N08", "Sensation not assessed", "Sensation in {scope} not assessed: {reason}"],
  ["N09", "Reflex grade", "{Reflex}, {side}: {grade}"],
  ["N10", "Reflexes symmetric", "{Named paired reflexes} symmetric at {recorded grades}"],
  ["N11", "Reflex asymmetry", "{Named reflex} asymmetric: left {left grade}, right {right grade}"],
  ["N12", "Reflexes not assessed", "{Named reflexes} not assessed: {reason}"],
  ["N13", "Tone observation", "Muscle tone in {scope}: {observation}"],
  ["N14", "Clonus assessment", "Clonus at {site}: {absent or observed response with beat count/sustained detail}"],
  ["N15", "Plantar response", "Plantar response, {side}: {flexor/extensor/equivocal response}"],
  ["N16", "Hoffmann response", "Hoffmann response, {side}: {observed response}"],
  ["N17", "Capillary refill", "Capillary refill at {site}: {seconds} seconds"],
  ["N18", "Peripheral pulse", "{Named pulse}, {side}: {palpation finding}"],
  ["F01", "Gait steady", "Gait steady during observed ambulation"],
  ["F02", "Antalgic gait", "Antalgic gait observed: {side and detail}"],
  ["F03", "Assistive device", "Ambulates with {device}: {observed assistance level}"],
  ["F04", "Heel walking", "Heel walking: {observed performance and side}"],
  ["F05", "Toe walking", "Toe walking: {observed performance and side}"],
  ["F06", "Sit-to-stand", "Sit-to-stand: {observed performance or assistance}"],
  ["F07", "Functional task observed", "{Task} observed: {performance and relevant site}"],
  ["F08", "Task not assessed", "{Task} not assessed: {reason}"],
  ["T01", "Spurling maneuver", "Spurling maneuver, {side}: {result} — {response}"],
  ["T02", "Cervical distraction", "Cervical distraction, {side}: {result} — {response}"],
  ["T03", "Straight leg raise", "Straight leg raise, {side}: {result} — {response}"],
  ["T04", "Crossed straight leg raise", "Crossed straight leg raise, {side}: {result} — {response}"],
  ["T05", "Slump test", "Slump test, {side}: {result} — {response}"],
  ["T06", "FABER", "FABER, {side}: {result} — {response}"],
  ["T07", "Thigh thrust", "Thigh thrust, {side}: {result} — {response}"],
  ["T08", "SI compression", "SI compression, {side}: {result} — {response}"],
  ["T09", "SI distraction", "SI distraction, {side}: {result} — {response}"],
  ["T10", "Neer maneuver", "Neer maneuver, {side}: {result} — {response}"],
  ["T11", "Hawkins-Kennedy maneuver", "Hawkins-Kennedy maneuver, {side}: {result} — {response}"],
  ["T12", "Empty-can test", "Empty-can test, {side}: {result} — {response}"],
  ["T13", "External-rotation resistance", "External-rotation resistance, {side}: {result} — {response}"],
  ["T14", "Lift-off test", "Lift-off test, {side}: {result} — {response}"],
  ["T15", "Resisted wrist extension", "Resisted wrist extension, {side}: {result} — {response}"],
  ["T16", "Resisted wrist flexion", "Resisted wrist flexion, {side}: {result} — {response}"],
  ["T17", "Phalen maneuver", "Phalen maneuver, {side}: {result} — {response}"],
  ["T18", "Tinel percussion", "Tinel percussion, {side}: {result} — {response}"],
  ["T19", "Finkelstein maneuver", "Finkelstein maneuver, {side}: {result} — {response}"],
  ["T20", "FADIR", "FADIR, {side}: {result} — {response}"],
  ["T21", "Log-roll test", "Log-roll test, {side}: {result} — {response}"],
  ["T22", "Lachman test", "Lachman test, {side}: {result} — {response}"],
  ["T23", "Anterior drawer — knee", "Anterior drawer — knee, {side}: {result} — {response}"],
  ["T24", "Posterior drawer — knee", "Posterior drawer — knee, {side}: {result} — {response}"],
  ["T25", "Varus stress — knee", "Varus stress — knee, {side}: {result} — {response}"],
  ["T26", "Valgus stress — knee", "Valgus stress — knee, {side}: {result} — {response}"],
  ["T27", "McMurray maneuver", "McMurray maneuver, {side}: {result} — {response}"],
  ["T28", "Anterior drawer — ankle", "Anterior drawer — ankle, {side}: {result} — {response}"],
  ["T29", "Talar tilt", "Talar tilt, {side}: {result} — {response}"],
  ["T30", "Thompson test", "Thompson test, {side}: {result} — {response}"],
]

export const examRegions: readonly ExamRegionOption[] = [
  {
    key: "head",
    label: "Head / occipital",
    aliases: ["Head / occipital", "Head", "Scalp", "Occiput", "Occipital"],
    sites: ["Scalp", "occipital region", "temporalis"],
    exampleIds: ["F07", "F08", "I01", "I02", "I03", "I04", "I05", "I06", "I07", "I10", "I11", "I12", "I13", "P01", "P02", "P03", "P04", "P05", "P06", "P08", "P09", "P11", "P12"],
  },
  {
    key: "jaw",
    label: "Jaw / TMJ",
    aliases: ["Jaw / TMJ", "Jaw", "TMJ", "Temporomandibular"],
    sites: ["TMJ", "masseter", "temporalis"],
    exampleIds: ["F07", "F08", "I01", "I02", "I03", "I04", "I05", "I06", "I07", "I10", "I11", "I12", "I13", "M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08", "M10", "P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P11", "P12"],
  },
  {
    key: "cervical",
    label: "Cervical Spine",
    aliases: ["Cervical Spine", "Neck", "Cervical", "C-spine", "C spine"],
    sites: ["Cervical paraspinals", "midline cervical levels", "upper trapezius", "levator scapulae"],
    exampleIds: ["F07", "F08", "I01", "I02", "I03", "I04", "I05", "I06", "I07", "I10", "I11", "I12", "I13", "M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08", "M10", "P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P11", "P12", "T01", "T02"],
  },
  {
    key: "thoracic",
    label: "Thoracic Spine",
    aliases: ["Thoracic Spine", "Thoracic", "Upper back", "Mid back", "Middle back", "T-spine", "T spine"],
    sites: ["Thoracic paraspinals", "midline thoracic levels"],
    exampleIds: ["F07", "F08", "I01", "I02", "I03", "I04", "I05", "I06", "I07", "I10", "I11", "I12", "I13", "M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08", "M10", "P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P11", "P12"],
  },
  {
    key: "lumbar",
    label: "Lumbar Spine",
    aliases: ["Lumbar Spine", "Lumbar", "Low back", "Lower back", "Lumbosacral", "L-spine", "L spine"],
    sites: ["Lumbar paraspinals", "midline lumbar levels"],
    exampleIds: ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08", "I01", "I02", "I03", "I04", "I05", "I06", "I07", "I10", "I11", "I12", "I13", "M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08", "M10", "P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P11", "P12", "T03", "T04", "T05"],
  },
  {
    key: "si",
    label: "Sacroiliac / buttock",
    aliases: ["Sacroiliac / buttock", "Sacroiliac", "SI joint", "SI region", "Buttock", "Buttocks", "Gluteal"],
    sites: ["SI joint region", "gluteal muscles"],
    exampleIds: ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08", "I01", "I02", "I03", "I04", "I05", "I06", "I07", "I10", "I11", "I12", "I13", "M07", "M08", "M10", "P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P11", "P12", "T06", "T07", "T08", "T09"],
  },
  {
    key: "coccyx",
    label: "Sacrum / coccyx",
    aliases: ["Sacrum / coccyx", "Sacrum", "Sacral", "Coccyx", "Coccygeal", "Tailbone"],
    sites: ["Sacrum", "coccyx"],
    exampleIds: ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08", "I01", "I02", "I03", "I04", "I05", "I06", "I07", "I10", "I11", "I12", "I13", "P01", "P02", "P03", "P04", "P05", "P06", "P08", "P09", "P11", "P12"],
  },
  {
    key: "shoulder",
    label: "Shoulder",
    aliases: ["Shoulder", "Shoulder", "Shoulders"],
    sites: ["AC joint", "bicipital groove", "deltoid", "rotator-cuff insertion region"],
    exampleIds: ["F07", "F08", "I01", "I02", "I03", "I04", "I05", "I06", "I07", "I08", "I09", "I10", "I11", "I12", "I13", "I14", "I15", "I16", "M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08", "M09", "M10", "P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P10", "P11", "P12", "T10", "T11", "T12", "T13", "T14"],
  },
  {
    key: "scapula",
    label: "Scapula / shoulder blade",
    aliases: ["Scapula / shoulder blade", "Scapula", "Scapular", "Shoulder blade"],
    sites: ["Scapular border", "rhomboids", "periscapular muscles"],
    exampleIds: ["F07", "F08", "I01", "I02", "I03", "I04", "I05", "I06", "I07", "I10", "I11", "I12", "I13", "M07", "M08", "M09", "M10", "P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P11", "P12"],
  },
  {
    key: "upper_arm",
    label: "Upper arm",
    aliases: ["Upper arm", "Upper arm", "Upper arms"],
    sites: ["Biceps", "triceps", "humerus"],
    exampleIds: ["F07", "F08", "I01", "I02", "I03", "I04", "I05", "I06", "I07", "I10", "I11", "I12", "I13", "M07", "M08", "M10", "P01", "P02", "P03", "P04", "P05", "P06", "P08", "P09", "P11", "P12"],
  },
  {
    key: "elbow",
    label: "Elbow",
    aliases: ["Elbow", "Elbow", "Elbows"],
    sites: ["Medial epicondyle", "lateral epicondyle", "olecranon", "distal biceps insertion"],
    exampleIds: ["F07", "F08", "I01", "I02", "I03", "I04", "I05", "I06", "I07", "I08", "I09", "I10", "I11", "I12", "I13", "I14", "I15", "I16", "M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08", "M09", "M10", "P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P10", "P11", "P12", "T15", "T16", "T18"],
  },
  {
    key: "forearm",
    label: "Forearm",
    aliases: ["Forearm", "Forearm", "Forearms"],
    sites: ["Flexor compartment", "extensor compartment", "radius", "ulna"],
    exampleIds: ["F07", "F08", "I01", "I02", "I03", "I04", "I05", "I06", "I07", "I10", "I11", "I12", "I13", "M07", "M08", "M10", "P01", "P02", "P03", "P04", "P05", "P06", "P08", "P09", "P11", "P12"],
  },
  {
    key: "wrist",
    label: "Wrist",
    aliases: ["Wrist", "Wrist", "Wrists"],
    sites: ["Radial wrist", "ulnar wrist", "dorsal wrist", "anatomic snuffbox"],
    exampleIds: ["F07", "F08", "I01", "I02", "I03", "I04", "I05", "I06", "I07", "I08", "I09", "I10", "I11", "I12", "I13", "I14", "I15", "I16", "M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08", "M09", "M10", "P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P10", "P11", "P12", "T17", "T18", "T19"],
  },
  {
    key: "hand",
    label: "Hand / fingers",
    aliases: ["Hand / fingers", "Hand", "Hands", "Finger", "Fingers", "Thumb"],
    sites: ["MCP/PIP/DIP joint", "digit", "thumb base", "thenar/hypothenar area"],
    exampleIds: ["F07", "F08", "I01", "I02", "I03", "I04", "I05", "I06", "I07", "I08", "I09", "I10", "I11", "I12", "I13", "I14", "I15", "I16", "M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08", "M09", "M10", "P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P10", "P11", "P12", "T17", "T18"],
  },
  {
    key: "hip",
    label: "Hip / groin",
    aliases: ["Hip / groin", "Hip", "Hips", "Groin"],
    sites: ["Greater trochanter", "anterior hip/groin", "gluteal region"],
    exampleIds: ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08", "I01", "I02", "I03", "I04", "I05", "I06", "I07", "I08", "I09", "I10", "I11", "I12", "I13", "I14", "I15", "I16", "M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08", "M09", "M10", "P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P10", "P11", "P12", "T06", "T20", "T21"],
  },
  {
    key: "thigh",
    label: "Thigh",
    aliases: ["Thigh", "Thigh", "Thighs"],
    sites: ["Quadriceps", "hamstrings", "adductors"],
    exampleIds: ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08", "I01", "I02", "I03", "I04", "I05", "I06", "I07", "I10", "I11", "I12", "I13", "M07", "M08", "M10", "P01", "P02", "P03", "P04", "P05", "P06", "P08", "P09", "P11", "P12"],
  },
  {
    key: "knee",
    label: "Knee",
    aliases: ["Knee", "Knee", "Knees"],
    sites: ["Medial/lateral joint line", "patella", "patellar tendon", "quadriceps tendon", "popliteal region"],
    exampleIds: ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08", "I01", "I02", "I03", "I04", "I05", "I06", "I07", "I08", "I09", "I10", "I11", "I12", "I13", "I14", "I15", "I16", "M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08", "M09", "M10", "P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P10", "P11", "P12", "T22", "T23", "T24", "T25", "T26", "T27"],
  },
  {
    key: "lower_leg",
    label: "Lower leg / calf",
    aliases: ["Lower leg / calf", "Lower leg", "Lower legs", "Calf", "Calves", "Shin"],
    sites: ["Tibia", "fibula", "calf muscles"],
    exampleIds: ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08", "I01", "I02", "I03", "I04", "I05", "I06", "I07", "I10", "I11", "I12", "I13", "M07", "M08", "M10", "P01", "P02", "P03", "P04", "P05", "P06", "P08", "P09", "P11", "P12"],
  },
  {
    key: "ankle",
    label: "Ankle",
    aliases: ["Ankle", "Ankle", "Ankles"],
    sites: ["Medial/lateral malleolus", "anterior ankle", "ligament region"],
    exampleIds: ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08", "I01", "I02", "I03", "I04", "I05", "I06", "I07", "I08", "I09", "I10", "I11", "I12", "I13", "I14", "I15", "I16", "M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08", "M09", "M10", "P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P10", "P11", "P12", "T28", "T29"],
  },
  {
    key: "heel",
    label: "Heel / Achilles",
    aliases: ["Heel / Achilles", "Heel", "Heels", "Achilles", "Achilles tendon"],
    sites: ["Achilles tendon", "insertion", "calcaneus"],
    exampleIds: ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08", "I01", "I02", "I03", "I04", "I05", "I06", "I07", "I10", "I11", "I12", "I13", "M07", "M08", "M10", "P01", "P02", "P03", "P04", "P05", "P06", "P08", "P09", "P11", "P12", "T30"],
  },
  {
    key: "foot",
    label: "Foot / toes",
    aliases: ["Foot / toes", "Foot", "Feet", "Toe", "Toes"],
    sites: ["Plantar fascia", "midfoot", "metatarsal", "MTP/IP joint", "digit"],
    exampleIds: ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08", "I01", "I02", "I03", "I04", "I05", "I06", "I07", "I08", "I09", "I10", "I11", "I12", "I13", "I14", "I15", "I16", "M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08", "M09", "M10", "P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P10", "P11", "P12"],
  },
  {
    key: "chest_wall",
    label: "Chest wall / ribs",
    aliases: ["Chest wall / ribs", "Chest wall", "Rib", "Ribs", "Rib cage", "Sternum"],
    sites: ["Rib number/location", "sternum", "costochondral region"],
    exampleIds: ["F07", "F08", "I01", "I02", "I03", "I04", "I05", "I06", "I07", "I10", "I11", "I12", "I13", "M07", "M08", "M10", "P01", "P02", "P03", "P04", "P05", "P06", "P08", "P09", "P11", "P12"],
  },
]

function fieldFor(id: string): ExamField {
  return id[0] === 'G' ? 'general_appearance' : id[0] === 'P' ? 'palpation_findings' : id[0] === 'N' ? 'neurological_notes' : 'additional_findings'
}
function groupFor(id: string): string {
  if (id[0] === 'N') {
    const number = Number(id.slice(1))
    return number <= 3 ? 'Motor' : number <= 8 ? 'Sensory' : number <= 12 ? 'Reflexes' : number <= 16 ? 'Neurological observations' : 'Peripheral perfusion'
  }
  return ({ G: 'General appearance', P: 'Palpation', I: 'Inspection', M: 'Movement', F: 'Function', T: 'Special tests' } as Record<string, string>)[id[0]]
}
export const examExamples: readonly ExamExample[] = definitions.map(([id, label, template]) => ({ id, label, template, field: fieldFor(id), group: groupFor(id) }))
export const normalizeExamText = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')
export function getExamRegion(raw: string): ExamRegionOption | undefined {
  const exact = examRegions.find(region => region.aliases.some(alias => normalizeExamText(alias) === normalizeExamText(raw)))
  if (exact) return exact
  const base = normalizeExamText(raw).replace(/^(left|lt|l|right|rt|r|bilateral|bilat|both)\.?\s+/, '')
  return examRegions.find(region => region.aliases.some(alias => normalizeExamText(alias) === base))
}
export const examRegionOptions = [...new Set(examRegions.flatMap(region => region.aliases))]
export function getExamExamples(field: ExamField, rawRegion = '', generic = false): ExamExample[] {
  const region = getExamRegion(rawRegion)
  const genericIds = ['P01', 'P02', 'P09', 'P11', 'P12', 'I01', 'I02', 'I06', 'I07', 'I16', 'F07', 'F08']
  const selected = examExamples.filter(example => example.field === field && (
    field === 'general_appearance' || field === 'neurological_notes' ||
    (region ? region.exampleIds.includes(example.id) : generic && genericIds.includes(example.id))
  )).map(example => example.id === 'P01' && region && ['cervical', 'thoracic', 'lumbar'].includes(region.key)
    ? { ...example, label: 'Paraspinal tenderness', template: 'Paraspinal tenderness at {site}' } : example)
  const first = field === 'general_appearance' ? ['G01', 'G02', 'G03'] : field === 'palpation_findings' ? ['P01', 'P02', 'P09']
    : field === 'neurological_notes' ? ['N01', 'N04', 'N09'] : ['I01', 'I02', selected.some(e => e.id === 'M02') ? 'M02' : 'I06']
  return [...selected.filter(e => first.includes(e.id)).sort((a, b) => first.indexOf(a.id) - first.indexOf(b.id)), ...selected.filter(e => !first.includes(e.id))]
}

export const testResults = ['Positive', 'Negative', 'Equivocal', 'Unable to complete', 'Not performed'] as const
const sides = ['Left', 'Right', 'Bilateral'] as const
const axial = ['head', 'jaw', 'cervical', 'thoracic', 'lumbar', 'si', 'coccyx', 'chest_wall']
export function templateKeys(template: string): string[] { return [...template.matchAll(/\{([^}]+)\}/g)].map(match => match[1]) }
export function siteKey(key: string): boolean { return /^(site|examined site|scope|joint and side|joint and side, aspect)$/.test(key) }
export function completionFields(example: ExamExample, rawRegion = ''): CompletionField[] {
  const region = getExamRegion(rawRegion)
  const sideOptions: readonly string[] = !region || axial.includes(region.key) ? [...sides, 'Midline', 'Not applicable'] : sides
  const fields: CompletionField[] = templateKeys(example.template).map(key => {
    const label = key === 'response' ? 'Observed response / location, or reason not performed' : key.charAt(0).toUpperCase() + key.slice(1)
    const field: CompletionField = { key, label }
    if (key.toLowerCase() === 'mode') field.options = ['Active', 'Passive']
    if (key === 'side') field.options = sideOptions
    if (key === 'result') field.options = testResults
    if (key === 'unit') field.options = region?.key === 'jaw' ? ['degrees', 'millimeters'] : ['degrees']
    if (key === 'grade' && example.id === 'N01') field.options = ['0', '1', '2', '3', '4', '5']
    if (key === 'value' || key === 'seconds') field.numeric = true
    if (siteKey(key)) { field.label = key === 'scope' ? 'Examined distribution / structures' : 'Examined location'; field.suggestions = region?.sites }
    return field
  })
  if (fields.some(f => siteKey(f.key)) && !fields.some(f => f.key === 'side')) {
    fields.unshift({ key: 'side', label: 'Side', options: example.label === 'Paraspinal tenderness' ? sides : sideOptions })
  }
  if (example.id.startsWith('T')) {
    if (example.id === 'T18') fields.push({ key: 'nerveSite', label: 'Nerve / percussion site' })
    if (['T03', 'T04'].includes(example.id)) fields.push({ key: 'symptomPattern', label: 'Symptom response', options: ['Back-only pain', 'Leg symptoms', 'No symptoms', 'Other response', 'Not tested'] })
    if (example.id === 'T04') fields.push({ key: 'symptomSide', label: 'Symptom side', options: [...sides, 'No symptoms', 'Not tested'] })
    fields.push({ key: 'angle', label: 'Measured angle (degrees)', numeric: true, optional: true })
  }
  return fields
}

export function completeExamExample(example: ExamExample, values: Record<string, string>, rawRegion = ''): { text?: string; errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const clean: Record<string, string> = {}
  for (const field of completionFields(example, rawRegion)) {
    const value = (values[field.key] ?? '').trim()
    clean[field.key] = value
    if (!value && !field.optional) errors[field.key] = 'Complete this field before inserting.'
    else if (value && /[;{}\n\r]/.test(value)) errors[field.key] = 'Use a single observation without semicolons or placeholders.'
    else if (value && field.options && !field.options.includes(value)) errors[field.key] = 'Choose a listed option.'
    else if (value && field.numeric && (!Number.isFinite(Number(value)) || Number(value) < 0)) errors[field.key] = 'Enter a nonnegative number.'
  }
  if (['T03', 'T04'].includes(example.id)) {
    const unperformed = ['Not performed', 'Unable to complete'].includes(clean.result)
    if (!unperformed && clean.symptomPattern === 'Not tested') errors.symptomPattern = 'Describe the observed symptom response.'
    if (example.id === 'T04' && !unperformed && clean.symptomSide === 'Not tested') errors.symptomSide = 'Identify the symptom side or choose No symptoms.'
  }
  if (Object.keys(errors).length) return { errors }
  let text = example.template.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const value = clean[key]
    return siteKey(key) && clean.side && clean.side !== 'Not applicable' ? `${clean.side} ${value}` : value
  })
  if (example.id.startsWith('T')) {
    if (clean.nerveSite) text += ` (site: ${clean.nerveSite})`
    if (clean.symptomPattern) text += ` (symptom response: ${clean.symptomPattern})`
    if (clean.symptomSide) text += ` (symptom side: ${clean.symptomSide})`
    if (clean.angle) text += ` at ${clean.angle} degrees`
  }
  return { text, errors }
}
