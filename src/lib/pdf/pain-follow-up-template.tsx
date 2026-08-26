import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

export interface PainFollowUpPdfData {
  patientName: string
  dob: string
  dateOfService: string
  modality: string
  consent: string
  patientLocation: string
  providerLocation: string
  connectionMethod: string
  providerName: string
  providerCredentials?: string | null
  sections: Array<{ label: string; value: string | null }>
}

const styles = StyleSheet.create({
  page: { padding: 48, fontFamily: 'Helvetica', fontSize: 10, lineHeight: 1.5 },
  title: { fontFamily: 'Helvetica-Bold', fontSize: 15, marginBottom: 14 },
  row: { flexDirection: 'row', marginBottom: 3 },
  label: { fontFamily: 'Helvetica-Bold', width: 110 },
  divider: { borderBottomWidth: 1, borderBottomColor: '#d1d5db', marginVertical: 12 },
  heading: { fontFamily: 'Helvetica-Bold', fontSize: 11, marginTop: 10, marginBottom: 3 },
  body: { whiteSpace: 'pre-wrap' },
  signature: { marginTop: 24 },
})

export function PainFollowUpPdf({ data }: { data: PainFollowUpPdfData }) {
  return <Document><Page size="LETTER" style={styles.page}>
    <Text style={styles.title}>Pain Management Follow-Up</Text>
    <View style={styles.row}><Text style={styles.label}>Patient</Text><Text>{data.patientName}</Text></View>
    <View style={styles.row}><Text style={styles.label}>DOB</Text><Text>{data.dob}</Text></View>
    <View style={styles.row}><Text style={styles.label}>Date of Service</Text><Text>{data.dateOfService}</Text></View>
    <View style={styles.row}><Text style={styles.label}>Modality</Text><Text>{data.modality}</Text></View>
    <View style={styles.row}><Text style={styles.label}>Consent</Text><Text>{data.consent}</Text></View>
    <View style={styles.row}><Text style={styles.label}>Patient Location</Text><Text>{data.patientLocation}</Text></View>
    <View style={styles.row}><Text style={styles.label}>Provider Location</Text><Text>{data.providerLocation}</Text></View>
    <View style={styles.row}><Text style={styles.label}>Connection</Text><Text>{data.connectionMethod}</Text></View>
    <View style={styles.divider} />
    {data.sections.map((section) => section.value ? <View key={section.label} wrap={false}>
      <Text style={styles.heading}>{section.label}</Text><Text style={styles.body}>{section.value}</Text>
    </View> : null)}
    <View style={styles.signature} wrap={false}>
      <Text>Electronically signed by</Text>
      <Text style={styles.heading}>{data.providerName}{data.providerCredentials ? `, ${data.providerCredentials}` : ''}</Text>
    </View>
  </Page></Document>
}
