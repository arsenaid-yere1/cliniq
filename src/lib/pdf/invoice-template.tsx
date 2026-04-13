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
  firmName?: string
  attorneyAddress?: string
  attorneyPhone?: string
  attorneyFax?: string

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
  clinicFax: { fontSize: 9 },
  // Title
  title: { fontFamily: 'Helvetica-Bold', fontSize: 16, textAlign: 'center', marginBottom: 14, marginTop: 6 },
  // Info table (2-column label|value)
  infoTable: { borderWidth: 1, borderColor: '#000', borderStyle: 'solid', marginBottom: 12 },
  infoTableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#000', borderBottomStyle: 'solid', paddingVertical: 4 },
  infoTableRowLast: { flexDirection: 'row', paddingVertical: 4 },
  infoLabelCell: { width: '30%', paddingLeft: 8, fontFamily: 'Helvetica-Bold', fontSize: 10 },
  infoValueCell: { width: '70%', paddingLeft: 6, fontSize: 10 },
  // Diagnoses table (2-column ICD|Description)
  diagTable: { borderWidth: 1, borderColor: '#000', borderStyle: 'solid', marginBottom: 12 },
  diagHeaderRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#000', borderBottomStyle: 'solid', paddingVertical: 4 },
  diagRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#000', borderBottomStyle: 'solid', paddingVertical: 3 },
  diagRowLast: { flexDirection: 'row', paddingVertical: 3 },
  diagCodeCell: { width: '25%', paddingLeft: 8, fontSize: 10 },
  diagDescCell: { width: '75%', paddingLeft: 6, fontSize: 10 },
  diagHeaderText: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  // Line items table
  table: { borderWidth: 1, borderColor: '#000', borderStyle: 'solid', marginBottom: 16 },
  tableHeaderRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#000', borderBottomStyle: 'solid', paddingVertical: 6 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#000', borderBottomStyle: 'solid', paddingVertical: 5 },
  tableTotalRow: { flexDirection: 'row', paddingVertical: 6 },
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

        {/* Patient / Case Info Table */}
        <View style={styles.infoTable}>
          <View style={styles.infoTableRow}>
            <Text style={styles.infoLabelCell}>Patient</Text>
            <Text style={styles.infoValueCell}>{data.patientName}</Text>
          </View>
          <View style={styles.infoTableRow}>
            <Text style={styles.infoLabelCell}>DOB</Text>
            <Text style={styles.infoValueCell}>{data.dob}</Text>
          </View>
          <View style={styles.infoTableRow}>
            <Text style={styles.infoLabelCell}>Date of Injury</Text>
            <Text style={styles.infoValueCell}>{data.dateOfInjury}</Text>
          </View>
          <View style={styles.infoTableRow}>
            <Text style={styles.infoLabelCell}>Claim Type</Text>
            <Text style={styles.infoValueCell}>{data.claimType}</Text>
          </View>
          {data.indication && (
            <View style={styles.infoTableRow}>
              <Text style={styles.infoLabelCell}>Indication</Text>
              <Text style={styles.infoValueCell}>{data.indication}</Text>
            </View>
          )}
          {data.providerName && (
            <View style={styles.infoTableRow}>
              <Text style={styles.infoLabelCell}>Provider</Text>
              <Text style={styles.infoValueCell}>
                {data.providerName}{data.providerCredentials ? `, ${data.providerCredentials}` : ''}
              </Text>
            </View>
          )}
          <View style={styles.infoTableRow}>
            <Text style={styles.infoLabelCell}>Facility</Text>
            <Text style={styles.infoValueCell}>{data.facilityName ?? '—'}</Text>
          </View>
          <View style={styles.infoTableRowLast}>
            <Text style={styles.infoLabelCell}>Invoice Date</Text>
            <Text style={styles.infoValueCell}>{data.invoiceDate}</Text>
          </View>
        </View>

        {/* Diagnoses Table */}
        <View style={styles.diagTable}>
          <View style={styles.diagHeaderRow}>
            <Text style={[styles.diagCodeCell, styles.diagHeaderText]}>ICD-10 Code</Text>
            <Text style={[styles.diagDescCell, styles.diagHeaderText]}>Description</Text>
          </View>
          {data.diagnoses.length > 0 ? (
            data.diagnoses.map((dx, i) => (
              <View key={i} style={i === data.diagnoses.length - 1 ? styles.diagRowLast : styles.diagRow}>
                <Text style={styles.diagCodeCell}>{dx.icd10_code ?? '—'}</Text>
                <Text style={styles.diagDescCell}>{dx.description}</Text>
              </View>
            ))
          ) : (
            <View style={styles.diagRowLast}>
              <Text style={[styles.diagCodeCell, { color: '#999' }]}>—</Text>
              <Text style={[styles.diagDescCell, { color: '#999' }]}>None</Text>
            </View>
          )}
        </View>

        {/* Attorney Table */}
        <View style={styles.infoTable}>
          <View style={styles.infoTableRow}>
            <Text style={styles.infoLabelCell}>Firm</Text>
            <Text style={styles.infoValueCell}>{data.firmName ?? 'N/A'}</Text>
          </View>
          <View style={data.attorneyPhone || data.attorneyFax ? styles.infoTableRow : styles.infoTableRowLast}>
            <Text style={styles.infoLabelCell}>Address</Text>
            <Text style={styles.infoValueCell}>{data.attorneyAddress ?? 'N/A'}</Text>
          </View>
          {data.attorneyPhone && (
            <View style={data.attorneyFax ? styles.infoTableRow : styles.infoTableRowLast}>
              <Text style={styles.infoLabelCell}>Phone</Text>
              <Text style={styles.infoValueCell}>{data.attorneyPhone}</Text>
            </View>
          )}
          {data.attorneyFax && (
            <View style={styles.infoTableRowLast}>
              <Text style={styles.infoLabelCell}>Fax</Text>
              <Text style={styles.infoValueCell}>{data.attorneyFax}</Text>
            </View>
          )}
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
            Please make the check payable to: {data.payeeName}{data.payeeAddress ? `, ${data.payeeAddress}` : ''}
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
