import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'

export interface ChiropracticOrderPdfData {
  clinicName?: string
  clinicAddress?: string
  clinicPhone?: string
  clinicFax?: string
  clinicLogoBase64?: string

  patientName: string
  dob: string
  dateOfOrder: string

  diagnoses: Array<{ code: string; description: string }>
  treatmentPlan: {
    frequency: string
    duration: string
    modalities: string[]
    goals: string[]
  }
  specialInstructions: string | null
  precautions: string | null

  referringProvider: string
  referringProviderNpi?: string
  providerSignatureBase64?: string
}

const styles = StyleSheet.create({
  page: { padding: 50, fontSize: 10, fontFamily: 'Helvetica', lineHeight: 1.5 },
  clinicHeader: { textAlign: 'center', alignItems: 'center', marginBottom: 10 },
  clinicDetail: { fontSize: 9, color: '#444' },
  separator: { borderBottomWidth: 1, borderBottomColor: '#ccc', borderBottomStyle: 'solid', marginTop: 10, marginBottom: 10 },
  patientInfoRow: { flexDirection: 'row', marginBottom: 2 },
  patientLabel: { fontFamily: 'Helvetica-Bold', marginRight: 4 },
  title: { fontFamily: 'Helvetica-Bold', fontSize: 14, textAlign: 'center', marginTop: 10, marginBottom: 10 },
  sectionHeading: { fontFamily: 'Helvetica-Bold', fontSize: 11, marginTop: 12, marginBottom: 4 },
  bullet: { marginBottom: 2, paddingLeft: 10 },
  label: { fontFamily: 'Helvetica-Bold' },
  signatureBlock: { marginTop: 30 },
  signatureLine: { borderBottomWidth: 1, borderBottomColor: '#000', borderBottomStyle: 'solid', width: 250, marginTop: 40, marginBottom: 4 },
})

export function ChiropracticOrderPdf({ data }: { data: ChiropracticOrderPdfData }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Clinic Header */}
        <View style={styles.clinicHeader}>
          {data.clinicLogoBase64 && (
            <Image src={data.clinicLogoBase64} style={{ height: 50, marginBottom: 6 }} />
          )}
          {data.clinicName && (
            <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 14 }}>{data.clinicName}</Text>
          )}
          {data.clinicAddress && <Text style={styles.clinicDetail}>{data.clinicAddress}</Text>}
          {(data.clinicPhone || data.clinicFax) && (
            <Text style={styles.clinicDetail}>
              {data.clinicPhone ? `Phone: ${data.clinicPhone}` : ''}
              {data.clinicPhone && data.clinicFax ? '  |  ' : ''}
              {data.clinicFax ? `Fax: ${data.clinicFax}` : ''}
            </Text>
          )}
        </View>

        <View style={styles.separator} />

        <Text style={styles.title}>CHIROPRACTIC THERAPY ORDER</Text>

        {/* Patient Info */}
        <View style={{ marginBottom: 10 }}>
          <View style={styles.patientInfoRow}>
            <Text style={styles.patientLabel}>Patient:</Text>
            <Text>{data.patientName}</Text>
          </View>
          <View style={styles.patientInfoRow}>
            <Text style={styles.patientLabel}>Date of Birth:</Text>
            <Text>{data.dob}</Text>
          </View>
          <View style={styles.patientInfoRow}>
            <Text style={styles.patientLabel}>Date of Order:</Text>
            <Text>{data.dateOfOrder}</Text>
          </View>
        </View>

        <View style={styles.separator} />

        {/* Diagnoses */}
        <Text style={styles.sectionHeading}>DIAGNOSES</Text>
        {data.diagnoses.map((dx, i) => (
          <Text key={i} style={styles.bullet}>
            {'\u2022'} {dx.code} — {dx.description}
          </Text>
        ))}

        {/* Treatment Plan */}
        <Text style={styles.sectionHeading}>TREATMENT PLAN</Text>
        <View style={{ marginBottom: 4 }}>
          <Text>
            <Text style={styles.label}>Frequency: </Text>
            {data.treatmentPlan.frequency}
          </Text>
        </View>
        <View style={{ marginBottom: 4 }}>
          <Text>
            <Text style={styles.label}>Duration: </Text>
            {data.treatmentPlan.duration}
          </Text>
        </View>

        <Text style={{ ...styles.label, marginTop: 6, marginBottom: 2 }}>Treatment Modalities:</Text>
        {data.treatmentPlan.modalities.map((mod, i) => (
          <Text key={i} style={styles.bullet}>
            {'\u2022'} {mod}
          </Text>
        ))}

        <Text style={{ ...styles.label, marginTop: 6, marginBottom: 2 }}>Treatment Goals:</Text>
        {data.treatmentPlan.goals.map((goal, i) => (
          <Text key={i} style={styles.bullet}>
            {'\u2022'} {goal}
          </Text>
        ))}

        {/* Special Instructions */}
        {data.specialInstructions && (
          <>
            <Text style={styles.sectionHeading}>SPECIAL INSTRUCTIONS</Text>
            <Text>{data.specialInstructions}</Text>
          </>
        )}

        {/* Precautions */}
        {data.precautions && (
          <>
            <Text style={styles.sectionHeading}>PRECAUTIONS</Text>
            <Text>{data.precautions}</Text>
          </>
        )}

        {/* Signature Block */}
        <View style={styles.signatureBlock}>
          {data.providerSignatureBase64 && (
            <Image src={data.providerSignatureBase64} style={{ height: 40, width: 150 }} />
          )}
          <View style={styles.signatureLine} />
          <Text style={{ fontFamily: 'Helvetica-Bold' }}>{data.referringProvider}</Text>
          {data.referringProviderNpi && (
            <Text style={styles.clinicDetail}>NPI: {data.referringProviderNpi}</Text>
          )}
        </View>
      </Page>
    </Document>
  )
}
