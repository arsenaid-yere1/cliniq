import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import type { Style } from '@react-pdf/types'

export interface InitialVisitPdfData {
  // Clinic info
  clinicName?: string
  clinicAddress?: string
  clinicPhone?: string
  clinicFax?: string
  clinicLogoBase64?: string

  // Patient info
  patientName: string
  dob: string
  age: number
  dateOfVisit: string
  indication: string
  dateOfInjury: string

  // Note sections (16 sections)
  introduction: string | null
  history_of_accident: string | null
  post_accident_history: string | null
  chief_complaint: string | null
  past_medical_history: string | null
  social_history: string | null
  review_of_systems: string | null
  physical_exam: string | null
  imaging_findings: string | null
  motor_sensory_reflex: string | null
  medical_necessity: string | null
  diagnoses: string | null
  treatment_plan: string | null
  patient_education: string | null
  prognosis: string | null
  clinician_disclaimer: string | null

  // Provider info
  providerName?: string
  providerCredentials?: string
  providerNpi?: string
  providerSignatureBase64?: string
}

const sectionEntries: [keyof InitialVisitPdfData, string][] = [
  ['history_of_accident', 'History of the Accident'],
  ['post_accident_history', 'Post-Accident History'],
  ['chief_complaint', 'Chief Complaint'],
  ['past_medical_history', 'Past Medical History'],
  ['social_history', 'Social History'],
  ['review_of_systems', 'Review of Systems'],
  ['physical_exam', 'Physical Examination'],
  ['imaging_findings', 'Radiological Imaging Findings'],
  ['motor_sensory_reflex', 'Motor / Sensory / Reflex Summary'],
  ['medical_necessity', 'Medical Necessity'],
  ['diagnoses', 'Diagnoses'],
  ['treatment_plan', 'Treatment Plan'],
  ['patient_education', 'Patient Education'],
  ['prognosis', 'Prognosis'],
  ['clinician_disclaimer', 'Clinician Disclaimer'],
]

const styles = StyleSheet.create({
  page: { padding: 50, fontSize: 10, fontFamily: 'Helvetica', lineHeight: 1.5 },
  clinicHeader: { textAlign: 'center', alignItems: 'center', marginBottom: 10 },
  clinicDetail: { fontSize: 9, color: '#444' },
  separator: { borderBottomWidth: 1, borderBottomColor: '#ccc', borderBottomStyle: 'solid', marginTop: 10, marginBottom: 10 },
  patientInfoRow: { flexDirection: 'row', marginBottom: 2 },
  patientLabel: { fontFamily: 'Helvetica-Bold', marginRight: 4 },
  sectionHeading: { fontFamily: 'Helvetica-Bold', fontSize: 11, marginTop: 14, marginBottom: 4 },
  sectionBody: { fontSize: 10, lineHeight: 1.6 },
  signatureBlock: { marginTop: 24 },
  signatureImage: { height: 40, width: 120, marginBottom: 4 },
  providerName: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  providerDetail: { fontSize: 9, color: '#666' },
  logo: { height: 80, marginBottom: 6 },
})

/**
 * Renders a single line of text, handling inline bold markers (**text**).
 * Returns an array of <Text> fragments with appropriate font styling.
 */
function renderInlineText(text: string, baseStyle: Style) {
  // Split on **bold** markers
  const parts = text.split(/\*\*(.+?)\*\*/)
  if (parts.length === 1) {
    // No bold markers found
    return <Text style={baseStyle}>{text}</Text>
  }
  // Alternating: plain, bold, plain, bold, ...
  return (
    <Text style={baseStyle}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <Text key={i} style={{ fontFamily: 'Helvetica-Bold' }}>{part}</Text>
        ) : (
          <Text key={i}>{part}</Text>
        )
      )}
    </Text>
  )
}

/**
 * Checks if a line is a sub-heading (e.g., "VITAL SIGNS:" or "CERVICAL SPINE EXAMINATION:")
 * Sub-headings are short lines that end with ":" and are mostly uppercase.
 */
function isSubHeading(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.endsWith(':')) return false
  if (trimmed.length > 80) return false
  // Check if mostly uppercase (>60% uppercase letters)
  const letters = trimmed.replace(/[^a-zA-Z]/g, '')
  if (letters.length === 0) return false
  const upperCount = (letters.match(/[A-Z]/g) || []).length
  return upperCount / letters.length > 0.6
}

/**
 * Renders a section's body text with proper formatting:
 * - Splits on double-newlines into paragraphs
 * - Renders lines starting with "• " or "- " or "* " as indented bullet points
 * - Renders ALL CAPS lines ending with ":" as bold sub-headings
 * - Handles **bold** inline markers
 */
function SectionBody({ content }: { content: string }) {
  const paragraphs = content.split(/\n\n+/)
  return (
    <View>
      {paragraphs.map((para, paraIdx) => {
        const lines = para.split('\n')
        return (
          <View key={paraIdx} style={paraIdx > 0 ? { marginTop: 6 } : {}}>
            {lines.map((line, lineIdx) => {
              const trimmed = line.trim()
              if (!trimmed) return null

              // Bullet point: "• ", "- ", "* " at start of line
              const bulletMatch = trimmed.match(/^(?:•\s*|-\s+|\*\s+)(.*)$/)
              if (bulletMatch) {
                return (
                  <View key={lineIdx} style={{ flexDirection: 'row', marginLeft: 12, marginBottom: 1 }}>
                    <Text style={[styles.sectionBody, { width: 12 }]}>•</Text>
                    <View style={{ flex: 1 }}>
                      {renderInlineText(bulletMatch[1], styles.sectionBody)}
                    </View>
                  </View>
                )
              }

              // Sub-heading: ALL CAPS line ending with ":"
              if (isSubHeading(trimmed)) {
                // Strip any markdown bold markers from sub-headings
                const cleanHeading = trimmed.replace(/\*\*/g, '')
                return (
                  <Text
                    key={lineIdx}
                    style={[styles.sectionBody, { fontFamily: 'Helvetica-Bold', marginTop: lineIdx > 0 ? 6 : 0, marginBottom: 2 }]}
                  >
                    {cleanHeading}
                  </Text>
                )
              }

              // Regular text with possible inline bold
              return (
                <View key={lineIdx}>
                  {renderInlineText(trimmed, styles.sectionBody)}
                </View>
              )
            })}
          </View>
        )
      })}
    </View>
  )
}

export function InitialVisitPdf({ data }: { data: InitialVisitPdfData }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page} wrap>
        {/* Clinic Header */}
        <View style={styles.clinicHeader}>
          {data.clinicLogoBase64 && <Image src={data.clinicLogoBase64} style={styles.logo} />}
          {data.clinicAddress && <Text style={styles.clinicDetail}>{data.clinicAddress}</Text>}
          {(data.clinicPhone || data.clinicFax) && (
            <Text style={styles.clinicDetail}>
              {data.clinicPhone && `Tel: ${data.clinicPhone}`}
              {data.clinicPhone && data.clinicFax && ' | '}
              {data.clinicFax && `Fax: ${data.clinicFax}`}
            </Text>
          )}
        </View>

        <View style={styles.separator} />

        {/* Patient Info Block */}
        <View>
          <View style={styles.patientInfoRow}><Text style={styles.patientLabel}>Patient:</Text><Text>{data.patientName}</Text></View>
          <View style={styles.patientInfoRow}><Text style={styles.patientLabel}>DOB:</Text><Text>{data.dob}</Text></View>
          <View style={styles.patientInfoRow}><Text style={styles.patientLabel}>Age:</Text><Text>{String(data.age)}</Text></View>
          <View style={styles.patientInfoRow}><Text style={styles.patientLabel}>Date of Visit:</Text><Text>{data.dateOfVisit}</Text></View>
          <View style={styles.patientInfoRow}><Text style={styles.patientLabel}>Indication:</Text><Text>{data.indication}</Text></View>
          <View style={styles.patientInfoRow}><Text style={styles.patientLabel}>Date of Injury:</Text><Text>{data.dateOfInjury}</Text></View>
        </View>

        <View style={styles.separator} />

        {/* Introduction — special heading */}
        {data.introduction && (
          <View>
            {/* Keep heading with start of body — avoid orphaned heading at page bottom */}
            <Text style={styles.sectionHeading} minPresenceAhead={40}>To Whom it May Concern</Text>
            <SectionBody content={data.introduction} />
          </View>
        )}

        {/* Remaining sections */}
        {sectionEntries.map(([key, label]) => {
          const content = data[key] as string | null
          if (!content) return null
          return (
            <View key={key}>
              <Text style={styles.sectionHeading} minPresenceAhead={40}>{label}</Text>
              <SectionBody content={content} />
            </View>
          )
        })}

        <View style={styles.separator} />

        {/* Signature Block */}
        <View style={styles.signatureBlock} wrap={false}>
          <Text style={styles.sectionBody}>Respectfully,</Text>
          {data.providerSignatureBase64 && <Image src={data.providerSignatureBase64} style={styles.signatureImage} />}
          {data.providerName && (
            <Text style={styles.providerName}>
              {data.providerName}{data.providerCredentials && `, ${data.providerCredentials}`}
            </Text>
          )}
          {data.providerNpi && <Text style={styles.providerDetail}>NPI: {data.providerNpi}</Text>}
        </View>
      </Page>
    </Document>
  )
}
