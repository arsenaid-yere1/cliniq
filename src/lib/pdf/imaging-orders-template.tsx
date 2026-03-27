import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'

export interface ImagingOrdersPdfData {
  clinicName?: string
  clinicAddress?: string
  clinicPhone?: string
  clinicFax?: string
  clinicLogoBase64?: string

  patientName: string
  dob: string
  dateOfOrder: string

  orders: Array<{
    body_region: string
    modality: string
    icd10_codes: string[]
    clinical_indication: string
  }>

  orderingProvider: string
  orderingProviderNpi?: string
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
  orderCard: { marginBottom: 12, padding: 10, borderWidth: 1, borderColor: '#ddd', borderRadius: 4 },
  orderRegion: { fontFamily: 'Helvetica-Bold', fontSize: 11, marginBottom: 4 },
  orderDetail: { marginBottom: 2 },
  label: { fontFamily: 'Helvetica-Bold' },
  signatureBlock: { marginTop: 30 },
  signatureLine: { borderBottomWidth: 1, borderBottomColor: '#000', borderBottomStyle: 'solid', width: 250, marginTop: 40, marginBottom: 4 },
})

export function ImagingOrdersPdf({ data }: { data: ImagingOrdersPdfData }) {
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

        <Text style={styles.title}>IMAGING ORDERS</Text>

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

        {/* Orders */}
        {data.orders.map((order, i) => (
          <View key={i} style={styles.orderCard}>
            <Text style={styles.orderRegion}>
              {order.modality} — {order.body_region}
            </Text>
            <View style={styles.orderDetail}>
              <Text>
                <Text style={styles.label}>ICD-10 Codes: </Text>
                {order.icd10_codes.join(', ')}
              </Text>
            </View>
            <View style={styles.orderDetail}>
              <Text>
                <Text style={styles.label}>Clinical Indication: </Text>
                {order.clinical_indication}
              </Text>
            </View>
          </View>
        ))}

        {/* Signature Block */}
        <View style={styles.signatureBlock}>
          {data.providerSignatureBase64 && (
            <Image src={data.providerSignatureBase64} style={{ height: 40, width: 150 }} />
          )}
          <View style={styles.signatureLine} />
          <Text style={{ fontFamily: 'Helvetica-Bold' }}>{data.orderingProvider}</Text>
          {data.orderingProviderNpi && (
            <Text style={styles.clinicDetail}>NPI: {data.orderingProviderNpi}</Text>
          )}
        </View>
      </Page>
    </Document>
  )
}
