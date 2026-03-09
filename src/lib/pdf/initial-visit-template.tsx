import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'

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

  // Note sections (15 sections)
  introduction: string | null
  history_of_accident: string | null
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
  clinicHeader: { textAlign: 'center', marginBottom: 10 },
  clinicName: { fontSize: 14, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  clinicDetail: { fontSize: 9, color: '#444' },
  separator: { borderBottom: '1 solid #ccc', marginVertical: 10 },
  patientInfoRow: { flexDirection: 'row', marginBottom: 2 },
  patientLabel: { fontFamily: 'Helvetica-Bold', marginRight: 4 },
  sectionHeading: { fontFamily: 'Helvetica-Bold', fontSize: 11, marginTop: 12, marginBottom: 4 },
  sectionBody: { fontSize: 10, lineHeight: 1.5 },
  signatureBlock: { marginTop: 20 },
  signatureImage: { height: 40, width: 120, marginBottom: 4 },
  providerName: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  providerDetail: { fontSize: 9, color: '#666' },
  logo: { height: 50, marginBottom: 6, alignSelf: 'center' as const },
})

export function InitialVisitPdf({ data }: { data: InitialVisitPdfData }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Clinic Header */}
        <View style={styles.clinicHeader}>
          {data.clinicLogoBase64 && <Image src={data.clinicLogoBase64} style={styles.logo} />}
          {data.clinicName && <Text style={styles.clinicName}>{data.clinicName}</Text>}
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
            <Text style={styles.sectionHeading}>To Whom it May Concern</Text>
            <Text style={styles.sectionBody}>{data.introduction}</Text>
          </View>
        )}

        {/* Remaining sections */}
        {sectionEntries.map(([key, label]) => {
          const content = data[key] as string | null
          if (!content) return null
          return (
            <View key={key} wrap={false}>
              <Text style={styles.sectionHeading}>{label}</Text>
              <Text style={styles.sectionBody}>{content}</Text>
            </View>
          )
        })}

        <View style={styles.separator} />

        {/* Signature Block */}
        <View style={styles.signatureBlock}>
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
