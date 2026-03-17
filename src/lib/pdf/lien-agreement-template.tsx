import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'

export interface LienAgreementPdfData {
  clinicLogoBase64?: string
  clinicAddress?: string
  clinicPhone?: string
  clinicFax?: string

  attorneyName?: string
  firmName?: string

  patientName: string
  dateOfBirth: string
  dateOfInjury: string

  providerLine: string
}

const styles = StyleSheet.create({
  page: { padding: 50, fontSize: 10, fontFamily: 'Helvetica', lineHeight: 1.5 },
  clinicHeader: { alignItems: 'center', marginBottom: 16 },
  logo: { height: 80, marginBottom: 6 },
  clinicAddress: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  clinicDetail: { fontSize: 9 },
  addressee: { marginBottom: 12 },
  fieldRow: { flexDirection: 'row', marginBottom: 4 },
  fieldLabel: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  fieldValue: { fontSize: 10 },
  fieldRowSpaced: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  title: { fontFamily: 'Helvetica-Bold', fontSize: 12, textAlign: 'center', marginTop: 16, marginBottom: 12, textDecoration: 'underline' },
  paragraph: { fontSize: 10, marginBottom: 10, textAlign: 'justify' },
  signatureSection: { marginTop: 24 },
  signatureRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  signatureBlock: { flexDirection: 'row', alignItems: 'flex-end' },
  signatureLabel: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  signatureLine: { fontSize: 10, borderBottomWidth: 1, borderBottomColor: '#000', borderBottomStyle: 'solid', width: 160, marginLeft: 4, marginRight: 16 },
  dateLine: { fontSize: 10, borderBottomWidth: 1, borderBottomColor: '#000', borderBottomStyle: 'solid', width: 120, marginLeft: 4 },
  dateLabel: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
})

const LIEN_PARAGRAPH_1 =
  'I hereby authorize NPMD, my medical healthcare provider, to furnish my attorney with a full report of my examination, diagnosis, treatment, prognosis, and any other necessary medical records related to the accident and/or incident in which I was involved and for which I have sought medical attention.'

const LIEN_PARAGRAPH_2 =
  'Furthermore, I authorize my attorney, and any subsequent attorney representing me, to pay directly to the facility any amounts due for medical services rendered to me as a result of the accident and/or incident. I also authorize payment for any other outstanding bills owed to this facility. These payments shall be made from any settlement, judgment, or verdict obtained in my case to sufficiently satisfy my financial obligations to NPMD.'

const LIEN_PARAGRAPH_3 =
  'I hereby grant a lien and assignment on my case to the clinic against all proceeds of any settlement, judgment, or verdict that may be paid to me or my attorney as a result of the injuries for which I have been treated. This lien applies to any injuries connected with the accident or incident. I fully understand that I remain directly and fully responsible for all medical bills submitted by the facility for services rendered to me. This agreement is made solely for the facility\'s additional protection and is not contingent on any settlement, judgment, or verdict that I may recover.'

const LIEN_PARAGRAPH_4 =
  'I agree that this lien is enforceable against any and all subsequent attorneys representing me regarding the accident and/or incident. Additionally, if I change my residence or my attorney, I agree to notify the facility within 30 days of such changes, providing the facility with the new attorney. If I fail to notify the facility within this timeframe, all outstanding balances will become immediately due and payable. In the event of legal action to enforce any provision of this agreement, the prevailing party shall be awarded reasonable attorney\'s fees and costs incurred in such action or proceeding, including any efforts to negotiate the matter.'

export function LienAgreementPdf({ data }: { data: LienAgreementPdfData }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page} wrap>
        {/* Clinic Header */}
        <View style={styles.clinicHeader}>
          {data.clinicLogoBase64 && <Image src={data.clinicLogoBase64} style={styles.logo} />}
          {data.clinicAddress && <Text style={styles.clinicAddress}>{data.clinicAddress}</Text>}
          {data.clinicPhone && data.clinicFax && (
            <Text style={styles.clinicDetail}>Tel: {data.clinicPhone}    Fax: {data.clinicFax}</Text>
          )}
          {data.clinicPhone && !data.clinicFax && (
            <Text style={styles.clinicDetail}>Tel: {data.clinicPhone}</Text>
          )}
          {!data.clinicPhone && data.clinicFax && (
            <Text style={styles.clinicDetail}>Fax: {data.clinicFax}</Text>
          )}
        </View>

        {/* To Attorney */}
        <View style={styles.addressee}>
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>To Attorney:</Text>
            {data.attorneyName && (
              <Text style={styles.fieldValue}>
                {' '}{data.attorneyName}{data.firmName ? `, ${data.firmName}` : ''}
              </Text>
            )}
          </View>
        </View>

        {/* Patient Info */}
        <View style={styles.fieldRowSpaced}>
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Patient Name: </Text>
            <Text style={styles.fieldValue}>{data.patientName}</Text>
          </View>
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Date of Birth: </Text>
            <Text style={styles.fieldValue}>{data.dateOfBirth}</Text>
          </View>
        </View>

        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Date of Injury: </Text>
          <Text style={styles.fieldValue}>{data.dateOfInjury}</Text>
        </View>

        {/* Provider */}
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Provider: </Text>
          <Text style={styles.fieldValue}>{data.providerLine}</Text>
        </View>

        {/* Title */}
        <Text style={styles.title}>AUTHORIZATION AND LIEN AGREEMENT</Text>

        {/* Legal Text */}
        <Text style={styles.paragraph}>{LIEN_PARAGRAPH_1}</Text>
        <Text style={styles.paragraph}>{LIEN_PARAGRAPH_2}</Text>
        <Text style={styles.paragraph}>{LIEN_PARAGRAPH_3}</Text>
        <Text style={styles.paragraph}>{LIEN_PARAGRAPH_4}</Text>

        {/* Signature Lines */}
        <View style={styles.signatureSection}>
          <View style={styles.signatureRow}>
            <View style={styles.signatureBlock}>
              <Text style={styles.signatureLabel}>PATIENT SIGNATURE</Text>
              <Text style={styles.signatureLine}> </Text>
            </View>
            <View style={styles.signatureBlock}>
              <Text style={styles.dateLabel}>DATE</Text>
              <Text style={styles.dateLine}> </Text>
            </View>
          </View>

          <View style={styles.signatureRow}>
            <View style={styles.signatureBlock}>
              <Text style={styles.signatureLabel}>ATTORNEY SIGNATURE</Text>
              <Text style={styles.signatureLine}> </Text>
            </View>
            <View style={styles.signatureBlock}>
              <Text style={styles.dateLabel}>DATE</Text>
              <Text style={styles.dateLine}> </Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  )
}
