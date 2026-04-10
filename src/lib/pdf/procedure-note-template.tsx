import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import type { Style } from '@react-pdf/types'

export interface ProcedureNotePdfData {
  // Clinic info
  clinicName?: string
  clinicAddress?: string
  clinicPhone?: string
  clinicFax?: string
  clinicLogoBase64?: string

  // Patient info
  patientName: string
  dob: string
  dateOfVisit: string
  dateOfInjury: string
  procedureName: string
  procedureNumber: number
  injectionSite: string
  laterality: string

  // Note sections (20 sections)
  subjective: string | null
  past_medical_history: string | null
  allergies: string | null
  current_medications: string | null
  social_history: string | null
  review_of_systems: string | null
  objective_vitals: string | null
  objective_physical_exam: string | null
  assessment_summary: string | null
  procedure_indication: string | null
  procedure_preparation: string | null
  procedure_prp_prep: string | null
  procedure_anesthesia: string | null
  procedure_injection: string | null
  procedure_post_care: string | null
  procedure_followup: string | null
  assessment_and_plan: string | null
  patient_education: string | null
  prognosis: string | null
  clinician_disclaimer: string | null

  // Provider info
  providerName?: string
  providerCredentials?: string
  providerNpi?: string
  providerSignatureBase64?: string
}

const sectionEntries: [keyof ProcedureNotePdfData, string][] = [
  ['subjective', 'Subjective'],
  ['past_medical_history', 'Past Medical History'],
  ['allergies', 'Allergies'],
  ['current_medications', 'Current Medications'],
  ['social_history', 'Social History'],
  ['review_of_systems', 'Review of Systems'],
  ['objective_vitals', 'Objective \u2014 Vital Signs'],
  ['objective_physical_exam', 'Objective \u2014 Physical Examination'],
  ['assessment_summary', 'Assessment Summary'],
  ['procedure_indication', 'Procedure \u2014 Indication'],
  ['procedure_preparation', 'Procedure \u2014 Preparation'],
  ['procedure_prp_prep', 'Procedure \u2014 PRP Preparation'],
  ['procedure_anesthesia', 'Procedure \u2014 Anesthesia'],
  ['procedure_injection', 'Procedure \u2014 Injection'],
  ['procedure_post_care', 'Procedure \u2014 Post-Procedure Care'],
  ['procedure_followup', 'Procedure \u2014 Follow-Up Plan'],
  ['assessment_and_plan', 'Assessment and Plan'],
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

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

function renderInlineText(text: string, baseStyle: Style) {
  const parts = text.split(/\*\*(.+?)\*\*/)
  if (parts.length === 1) {
    return <Text style={baseStyle}>{text}</Text>
  }
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

function isSubHeading(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.endsWith(':')) return false
  if (trimmed.length > 80) return false
  const letters = trimmed.replace(/[^a-zA-Z]/g, '')
  if (letters.length === 0) return false
  const upperCount = (letters.match(/[A-Z]/g) || []).length
  return upperCount / letters.length > 0.6
}

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

              const bulletMatch = trimmed.match(/^(?:\u2022\s*|-\s+|\*\s+)(.*)$/)
              if (bulletMatch) {
                return (
                  <View key={lineIdx} style={{ flexDirection: 'row', marginLeft: 12, marginBottom: 1 }}>
                    <Text style={[styles.sectionBody, { width: 12 }]}>{'\u2022'}</Text>
                    <View style={{ flex: 1 }}>
                      {renderInlineText(bulletMatch[1], styles.sectionBody)}
                    </View>
                  </View>
                )
              }

              if (isSubHeading(trimmed)) {
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

export function ProcedureNotePdf({ data }: { data: ProcedureNotePdfData }) {
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

        {/* Procedure Header Block */}
        <View>
          <View style={styles.patientInfoRow}><Text style={styles.patientLabel}>Patient:</Text><Text>{data.patientName}</Text></View>
          <View style={styles.patientInfoRow}><Text style={styles.patientLabel}>DOB:</Text><Text>{data.dob}</Text></View>
          <View style={styles.patientInfoRow}><Text style={styles.patientLabel}>Date of Visit:</Text><Text>{data.dateOfVisit}</Text></View>
          <View style={styles.patientInfoRow}><Text style={styles.patientLabel}>Date of Injury:</Text><Text>{data.dateOfInjury}</Text></View>
          <View style={styles.patientInfoRow}><Text style={styles.patientLabel}>Procedure:</Text><Text>{data.procedureName}</Text></View>
          <View style={styles.patientInfoRow}><Text style={styles.patientLabel}>Injection #:</Text><Text>{ordinal(data.procedureNumber)} Injection</Text></View>
        </View>

        <View style={styles.separator} />

        {/* Sections */}
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
