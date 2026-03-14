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
  facilityName?: string

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
  // Clinic header — centered like reference
  clinicHeader: { alignItems: 'center', marginBottom: 16 },
  logo: { height: 80, marginBottom: 6 },
  clinicAddress: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  clinicDetail: { fontSize: 9 },
  clinicFax: { fontSize: 9, fontFamily: 'Helvetica-Bold' },
  // Title
  title: { fontFamily: 'Helvetica-Bold', fontSize: 16, textAlign: 'center', marginBottom: 14, marginTop: 6 },
  // 3-column info block
  infoBlock: { flexDirection: 'row', marginBottom: 20, gap: 12 },
  infoColumn: { flex: 1 },
  // Patient info labels
  label: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  value: { fontSize: 10 },
  infoRow: { flexDirection: 'row', marginBottom: 1 },
  infoText: { fontSize: 10, marginBottom: 1 },
  // Diagnoses heading
  diagHeading: { fontFamily: 'Helvetica-Bold', fontSize: 10, marginBottom: 4 },
  diagText: { fontSize: 9, marginBottom: 1 },
  // Table
  table: { borderWidth: 1, borderColor: '#000', borderStyle: 'solid', marginBottom: 16 },
  tableHeaderRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#000', borderBottomStyle: 'solid', paddingVertical: 6 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#000', borderBottomStyle: 'solid', paddingVertical: 5 },
  tableTotalRow: { flexDirection: 'row', paddingVertical: 6 },
  // Column widths matching reference
  colDate: { width: '16%', paddingLeft: 8 },
  colCpt: { width: '14%', paddingLeft: 6 },
  colDesc: { width: '38%', paddingLeft: 6 },
  colQty: { width: '10%', textAlign: 'center' },
  colAmount: { width: '22%', textAlign: 'right', paddingRight: 8 },
  thText: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  tdText: { fontSize: 10 },
  tdCptText: { fontSize: 10, fontFamily: 'Helvetica' },
  totalLabelCell: { width: '78%', paddingLeft: 8 },
  totalValueCell: { width: '22%', textAlign: 'right', paddingRight: 8 },
  totalLabel: { fontFamily: 'Helvetica-Bold', fontSize: 11 },
  totalValue: { fontFamily: 'Helvetica-Bold', fontSize: 11 },
  // Payee
  payeeText: { fontSize: 10, marginTop: 12 },
  // Notes
  notesSection: { borderTopWidth: 1, borderTopColor: '#ccc', borderTopStyle: 'solid', paddingTop: 8, marginTop: 8 },
  notesLabel: { fontFamily: 'Helvetica-Bold', fontSize: 9, color: '#666', marginBottom: 2 },
  notesText: { fontSize: 9 },
})

function formatCurrency(amount: number): string {
  return `$${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

export function InvoicePdf({ data }: { data: InvoicePdfData }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page} wrap>
        {/* Clinic Header — centered */}
        <View style={styles.clinicHeader}>
          {data.clinicLogoBase64 && <Image src={data.clinicLogoBase64} style={styles.logo} />}
          {data.clinicAddress && <Text style={styles.clinicAddress}>{data.clinicAddress}</Text>}
          {data.clinicPhone && <Text style={styles.clinicDetail}>Tel: {data.clinicPhone}</Text>}
          {data.clinicFax && <Text style={styles.clinicFax}>Fax: {data.clinicFax}</Text>}
        </View>

        {/* Title */}
        <Text style={styles.title}>
          {data.invoiceType === 'facility' ? 'Medical Facility Invoice' : 'Medical Invoice'}
        </Text>

        {/* 3-column info block */}
        <View style={styles.infoBlock}>
          {/* Patient column */}
          <View style={styles.infoColumn}>
            <View style={styles.infoRow}>
              <Text style={styles.label}>Patient: </Text>
              <Text style={styles.value}>{data.patientName}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.label}>DOB: </Text>
              <Text style={styles.value}>{data.dob}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.label}>Date(s) of Injury: </Text>
              <Text style={styles.value}>{data.dateOfInjury}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.label}>Claim Type: </Text>
              <Text style={styles.value}>{data.claimType}</Text>
            </View>
            {data.indication && (
              <View style={styles.infoRow}>
                <Text style={styles.label}>Indication: </Text>
                <Text style={[styles.value, { flex: 1 }]}>{data.indication}</Text>
              </View>
            )}
            {data.providerName && (
              <View style={styles.infoRow}>
                <Text style={styles.label}>Provider: </Text>
                <Text style={styles.value}>
                  {data.providerName}{data.providerCredentials ? `, ${data.providerCredentials}` : ''}
                </Text>
              </View>
            )}
            {data.facilityName && (
              <View style={styles.infoRow}>
                <Text style={styles.label}>Facility: </Text>
                <Text style={styles.value}>{data.facilityName}</Text>
              </View>
            )}
            <View style={styles.infoRow}>
              <Text style={styles.label}>Invoice Date: </Text>
              <Text style={styles.value}>{data.invoiceDate}</Text>
            </View>
          </View>

          {/* Diagnoses column */}
          <View style={styles.infoColumn}>
            <Text style={styles.diagHeading}>Diagnoses (ICD 10 codes)</Text>
            {data.diagnoses.length > 0 ? (
              data.diagnoses.map((dx, i) => (
                <Text key={i} style={styles.diagText}>
                  {dx.icd10_code ? `${dx.icd10_code} – ` : ''}{dx.description}
                </Text>
              ))
            ) : (
              <Text style={[styles.diagText, { color: '#999' }]}>None</Text>
            )}
          </View>

          {/* Attorney column */}
          <View style={styles.infoColumn}>
            {data.attorneyName ? (
              <>
                <Text style={styles.infoText}>
                  {data.attorneyName}{data.firmName ? ` ${data.firmName}` : ''}
                </Text>
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
            <Text style={[styles.colDate, styles.thText]}>DATE</Text>
            <Text style={[styles.colCpt, styles.thText]}>CPT</Text>
            <Text style={[styles.colDesc, styles.thText]}>Description</Text>
            <Text style={[styles.colQty, styles.thText]}>Qty</Text>
            <Text style={[styles.colAmount, styles.thText]}>Amount</Text>
          </View>
          {data.lineItems.map((item, i) => (
            <View key={i} style={styles.tableRow}>
              <Text style={[styles.colDate, styles.tdText]}>{item.serviceDate}</Text>
              <Text style={[styles.colCpt, styles.tdCptText]}>{item.cptCode}</Text>
              <Text style={[styles.colDesc, styles.tdText]}>{item.description}</Text>
              <Text style={[styles.colQty, styles.tdText]}>{item.quantity}</Text>
              <Text style={[styles.colAmount, styles.tdText]}>{formatCurrency(item.amount)}</Text>
            </View>
          ))}
          <View style={styles.tableTotalRow}>
            <Text style={[styles.totalLabelCell, styles.totalLabel]}>Total Balance Due</Text>
            <Text style={[styles.totalValueCell, styles.totalValue]}>{formatCurrency(data.balanceDue)}</Text>
          </View>
        </View>

        {/* Payee */}
        {(data.payeeName || data.payeeAddress) && (
          <Text style={styles.payeeText}>
            Please make the check: {data.payeeName}{data.payeeAddress ? `, ${data.payeeAddress}` : ''}
          </Text>
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
