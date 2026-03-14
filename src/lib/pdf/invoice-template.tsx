import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'

export interface InvoicePdfData {
  // Clinic
  clinicName?: string
  clinicAddress?: string
  clinicPhone?: string
  clinicFax?: string
  clinicLogoBase64?: string

  // Invoice header
  invoiceNumber: string
  invoiceDate: string
  invoiceType: string
  status: string

  // Patient
  patientName: string
  dob: string
  dateOfInjury: string
  claimType: string
  indication?: string

  // Provider
  providerName?: string
  providerCredentials?: string

  // Diagnoses
  diagnoses: Array<{ icd10_code: string | null; description: string }>

  // Attorney
  attorneyName?: string
  firmName?: string
  attorneyAddress?: string

  // Line items
  lineItems: Array<{
    serviceDate: string
    cptCode: string
    description: string
    quantity: number
    amount: number
  }>

  // Totals
  balanceDue: number

  // Footer
  payeeName?: string
  payeeAddress?: string
  notes?: string
}

const styles = StyleSheet.create({
  page: { padding: 50, fontSize: 10, fontFamily: 'Helvetica', lineHeight: 1.5 },
  // Clinic header
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#ccc', borderBottomStyle: 'solid', paddingBottom: 10, marginBottom: 10 },
  headerLeft: { flexDirection: 'row', gap: 8 },
  logo: { height: 60, marginRight: 8 },
  clinicName: { fontFamily: 'Helvetica-Bold', fontSize: 13 },
  clinicDetail: { fontSize: 9, color: '#444' },
  headerRight: { alignItems: 'flex-end' },
  statusBadge: { fontSize: 9, fontFamily: 'Helvetica-Bold', padding: '2 6', borderWidth: 1, borderColor: '#999', borderRadius: 3, textTransform: 'uppercase' },
  invoiceNumber: { fontSize: 9, color: '#666', fontFamily: 'Courier', marginTop: 2 },
  invoiceDate: { fontSize: 9, color: '#666', marginTop: 1 },
  // Title
  title: { fontFamily: 'Helvetica-Bold', fontSize: 14, textAlign: 'center', marginBottom: 12, marginTop: 4 },
  // Info block
  infoBlock: { flexDirection: 'row', marginBottom: 14 },
  infoColumn: { flex: 1 },
  infoHeading: { fontFamily: 'Helvetica-Bold', fontSize: 8, color: '#666', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 },
  infoText: { fontSize: 9, marginBottom: 1 },
  infoTextBold: { fontSize: 9, fontFamily: 'Helvetica-Bold', marginBottom: 1 },
  // Table
  table: { borderWidth: 1, borderColor: '#ddd', borderStyle: 'solid', marginBottom: 14 },
  tableHeaderRow: { flexDirection: 'row', backgroundColor: '#f5f5f5', borderBottomWidth: 1, borderBottomColor: '#ddd', borderBottomStyle: 'solid', padding: '4 0' },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#eee', borderBottomStyle: 'solid', padding: '4 0' },
  tableTotalRow: { flexDirection: 'row', padding: '6 0', backgroundColor: '#fafafa' },
  thDate: { width: '15%', paddingLeft: 6, fontFamily: 'Helvetica-Bold', fontSize: 8 },
  thCpt: { width: '12%', paddingLeft: 4, fontFamily: 'Helvetica-Bold', fontSize: 8 },
  thDesc: { width: '43%', paddingLeft: 4, fontFamily: 'Helvetica-Bold', fontSize: 8 },
  thQty: { width: '10%', textAlign: 'right', paddingRight: 4, fontFamily: 'Helvetica-Bold', fontSize: 8 },
  thAmount: { width: '20%', textAlign: 'right', paddingRight: 6, fontFamily: 'Helvetica-Bold', fontSize: 8 },
  tdDate: { width: '15%', paddingLeft: 6, fontSize: 9 },
  tdCpt: { width: '12%', paddingLeft: 4, fontSize: 8, fontFamily: 'Courier' },
  tdDesc: { width: '43%', paddingLeft: 4, fontSize: 9 },
  tdQty: { width: '10%', textAlign: 'right', paddingRight: 4, fontSize: 9 },
  tdAmount: { width: '20%', textAlign: 'right', paddingRight: 6, fontSize: 9 },
  totalLabel: { width: '80%', textAlign: 'right', paddingRight: 4, fontFamily: 'Helvetica-Bold', fontSize: 10 },
  totalValue: { width: '20%', textAlign: 'right', paddingRight: 6, fontFamily: 'Helvetica-Bold', fontSize: 10 },
  // Footer sections
  payeeSection: { fontSize: 9, marginBottom: 8 },
  payeeLabel: { fontFamily: 'Helvetica-Bold', fontSize: 9, marginBottom: 2 },
  notesSection: { borderTopWidth: 1, borderTopColor: '#ddd', borderTopStyle: 'solid', paddingTop: 8 },
  notesLabel: { fontFamily: 'Helvetica-Bold', fontSize: 9, color: '#666', marginBottom: 2 },
  notesText: { fontSize: 9 },
})

function formatCurrency(amount: number): string {
  return `$${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function InvoicePdf({ data }: { data: InvoicePdfData }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page} wrap>
        {/* Clinic Header */}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            {data.clinicLogoBase64 && <Image src={data.clinicLogoBase64} style={styles.logo} />}
            <View>
              {data.clinicName && <Text style={styles.clinicName}>{data.clinicName}</Text>}
              {data.clinicAddress && <Text style={styles.clinicDetail}>{data.clinicAddress}</Text>}
              {data.clinicPhone && <Text style={styles.clinicDetail}>Phone: {data.clinicPhone}</Text>}
              {data.clinicFax && <Text style={styles.clinicDetail}>Fax: {data.clinicFax}</Text>}
            </View>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.statusBadge}>
              {data.status.charAt(0).toUpperCase() + data.status.slice(1)}
            </Text>
            <Text style={styles.invoiceNumber}>{data.invoiceNumber}</Text>
            <Text style={styles.invoiceDate}>{data.invoiceDate}</Text>
          </View>
        </View>

        {/* Title */}
        <Text style={styles.title}>
          {data.invoiceType === 'facility' ? 'Medical Facility Invoice' : 'Medical Invoice'}
        </Text>

        {/* 3-column info block */}
        <View style={styles.infoBlock}>
          {/* Patient */}
          <View style={styles.infoColumn}>
            <Text style={styles.infoHeading}>Patient</Text>
            <Text style={styles.infoTextBold}>{data.patientName}</Text>
            <Text style={styles.infoText}>DOB: {data.dob}</Text>
            <Text style={styles.infoText}>Date of Injury: {data.dateOfInjury}</Text>
            <Text style={styles.infoText}>Claim Type: {data.claimType}</Text>
            {data.indication && <Text style={styles.infoText}>Indication: {data.indication}</Text>}
            {data.providerName && (
              <Text style={styles.infoText}>
                Provider: {data.providerName}{data.providerCredentials ? `, ${data.providerCredentials}` : ''}
              </Text>
            )}
          </View>

          {/* Diagnoses */}
          <View style={styles.infoColumn}>
            <Text style={styles.infoHeading}>Diagnoses</Text>
            {data.diagnoses.length > 0 ? (
              data.diagnoses.map((dx, i) => (
                <Text key={i} style={styles.infoText}>
                  {dx.icd10_code ? `${dx.icd10_code} — ` : ''}{dx.description}
                </Text>
              ))
            ) : (
              <Text style={[styles.infoText, { color: '#999' }]}>None</Text>
            )}
          </View>

          {/* Attorney */}
          <View style={styles.infoColumn}>
            <Text style={styles.infoHeading}>Attorney</Text>
            {data.attorneyName ? (
              <>
                <Text style={styles.infoTextBold}>{data.attorneyName}</Text>
                {data.firmName && <Text style={styles.infoText}>{data.firmName}</Text>}
                {data.attorneyAddress && <Text style={styles.infoText}>{data.attorneyAddress}</Text>}
              </>
            ) : (
              <Text style={[styles.infoText, { color: '#999' }]}>N/A</Text>
            )}
          </View>
        </View>

        {/* Line Items Table */}
        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={styles.thDate}>DATE</Text>
            <Text style={styles.thCpt}>CPT</Text>
            <Text style={styles.thDesc}>Description</Text>
            <Text style={styles.thQty}>QTY</Text>
            <Text style={styles.thAmount}>Amount</Text>
          </View>
          {data.lineItems.map((item, i) => (
            <View key={i} style={styles.tableRow}>
              <Text style={styles.tdDate}>{item.serviceDate}</Text>
              <Text style={styles.tdCpt}>{item.cptCode}</Text>
              <Text style={styles.tdDesc}>{item.description}</Text>
              <Text style={styles.tdQty}>{item.quantity}</Text>
              <Text style={styles.tdAmount}>{formatCurrency(item.amount)}</Text>
            </View>
          ))}
          <View style={styles.tableTotalRow}>
            <Text style={styles.totalLabel}>Total Balance Due:</Text>
            <Text style={styles.totalValue}>{formatCurrency(data.balanceDue)}</Text>
          </View>
        </View>

        {/* Payee */}
        {(data.payeeName || data.payeeAddress) && (
          <View style={styles.payeeSection}>
            <Text style={styles.payeeLabel}>Please make the check payable to:</Text>
            <Text style={styles.infoText}>
              {data.payeeName}{data.payeeAddress ? `, ${data.payeeAddress}` : ''}
            </Text>
          </View>
        )}

        {/* Notes */}
        {data.notes && (
          <View style={styles.notesSection}>
            <Text style={styles.notesLabel}>Notes</Text>
            <Text style={styles.notesText}>{data.notes}</Text>
          </View>
        )}
      </Page>
    </Document>
  )
}
