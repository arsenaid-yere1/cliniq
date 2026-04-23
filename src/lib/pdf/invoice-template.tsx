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
    unitPrice: number
    amount: number
  }>

  // Totals
  balanceDue: number

  // Footer
  payeeName?: string
  payeeAddress?: string
  notes?: string
}

const borderColor = '#000'

const styles = StyleSheet.create({
  page: { padding: 50, fontSize: 10, fontFamily: 'Helvetica', lineHeight: 1.4 },
  // Clinic header — centered
  clinicHeader: { alignItems: 'center', marginBottom: 12 },
  logo: { height: 80, marginBottom: 6 },
  clinicAddress: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  clinicDetail: { fontSize: 9 },
  // Title
  title: { fontFamily: 'Helvetica-Bold', fontSize: 16, textAlign: 'center', marginBottom: 14, marginTop: 6 },
  // 3-column info box (single bordered container)
  infoBox: {
    borderWidth: 1,
    borderColor,
    borderStyle: 'solid',
    flexDirection: 'row',
    marginBottom: 20,
  },
  infoColLeft: {
    width: '36%',
    padding: 8,
    borderRightWidth: 1,
    borderRightColor: borderColor,
    borderRightStyle: 'solid',
  },
  infoColCenter: {
    width: '36%',
    padding: 8,
    borderRightWidth: 1,
    borderRightColor: borderColor,
    borderRightStyle: 'solid',
  },
  infoColRight: {
    width: '28%',
    padding: 8,
  },
  // Patient info rows
  infoLine: { fontSize: 9, marginBottom: 1 },
  infoLabel: { fontFamily: 'Helvetica-Bold', fontSize: 9 },
  infoValue: { fontSize: 9 },
  // Diagnoses column
  diagHeading: { fontFamily: 'Helvetica-Bold', fontSize: 9, marginBottom: 4, textDecoration: 'underline' },
  diagLine: { fontSize: 8, marginBottom: 1 },
  // Attorney column
  attLine: { fontSize: 9, marginBottom: 1 },
  attLabel: { fontFamily: 'Helvetica-Bold', fontSize: 9 },
  // Line items table
  table: { borderWidth: 1, borderColor, borderStyle: 'solid', marginBottom: 16 },
  tableHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: borderColor,
    borderBottomStyle: 'solid',
    backgroundColor: '#f5f5f5',
    paddingVertical: 5,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: borderColor,
    borderBottomStyle: 'solid',
    paddingVertical: 4,
    minHeight: 20,
  },
  tableTotalRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    backgroundColor: '#f5f5f5',
  },
  // Column widths
  colDate: { width: '12%', paddingLeft: 6, borderRightWidth: 1, borderRightColor: borderColor, borderRightStyle: 'solid' },
  colCpt: { width: '11%', paddingLeft: 4, borderRightWidth: 1, borderRightColor: borderColor, borderRightStyle: 'solid' },
  colDesc: { width: '40%', paddingLeft: 6, borderRightWidth: 1, borderRightColor: borderColor, borderRightStyle: 'solid' },
  colQty: { width: '7%', textAlign: 'center', borderRightWidth: 1, borderRightColor: borderColor, borderRightStyle: 'solid' },
  colUnit: { width: '15%', textAlign: 'right', paddingRight: 6, borderRightWidth: 1, borderRightColor: borderColor, borderRightStyle: 'solid' },
  colAmount: { width: '15%', textAlign: 'right', paddingRight: 6 },
  thText: { fontFamily: 'Helvetica-Bold', fontSize: 9 },
  tdText: { fontSize: 9 },
  totalLabelCell: { width: '85%', paddingLeft: 6, borderRightWidth: 1, borderRightColor: borderColor, borderRightStyle: 'solid' },
  totalValueCell: { width: '15%', textAlign: 'right', paddingRight: 6 },
  totalLabel: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  totalValue: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  // Payee
  payeeText: { fontSize: 10, marginTop: 16, color: '#1a5276' },
  // Notes
  notesSection: { borderTopWidth: 1, borderTopColor: '#ccc', borderTopStyle: 'solid', paddingTop: 8, marginTop: 8 },
  notesLabel: { fontFamily: 'Helvetica-Bold', fontSize: 9, color: '#666', marginBottom: 2 },
  notesText: { fontSize: 9 },
})

function formatCurrency(amount: number): string {
  return `$${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

export function InvoicePdf({ data }: { data: InvoicePdfData }) {
  const providerLine = data.providerName
    ? `${data.providerName}${data.providerCredentials ? `, ${data.providerCredentials}` : ''}`
    : undefined

  return (
    <Document>
      <Page size="LETTER" style={styles.page} wrap>
        {/* Clinic Header — centered */}
        <View style={styles.clinicHeader}>
          {data.clinicLogoBase64 && <Image src={data.clinicLogoBase64} style={styles.logo} />}
          {data.clinicAddress && <Text style={styles.clinicAddress}>{data.clinicAddress}</Text>}
          {data.clinicPhone && <Text style={styles.clinicDetail}>Tel: {data.clinicPhone}</Text>}
          {data.clinicFax && <Text style={styles.clinicDetail}>Fax: {data.clinicFax}</Text>}
        </View>

        {/* Title */}
        <Text style={styles.title}>
          {data.invoiceType === 'facility' ? 'Medical Facility Invoice' : 'Medical Invoice'}
        </Text>

        {/* 3-column info box */}
        <View style={styles.infoBox}>
          {/* Left — Patient / Case Info */}
          <View style={styles.infoColLeft}>
            <Text style={styles.infoLine}>
              <Text style={styles.infoLabel}>Patient: </Text>
              <Text style={styles.infoValue}>{data.patientName}</Text>
            </Text>
            <Text style={styles.infoLine}>
              <Text style={styles.infoLabel}>Date of Birth: </Text>
              <Text style={styles.infoValue}>{data.dob}</Text>
            </Text>
            <Text style={styles.infoLine}>
              <Text style={styles.infoLabel}>Date of Injury: </Text>
              <Text style={styles.infoValue}>{data.dateOfInjury}</Text>
            </Text>
            <Text style={styles.infoLine}>
              <Text style={styles.infoLabel}>Claim Type: </Text>
              <Text style={styles.infoValue}>{data.claimType}</Text>
            </Text>
            {data.indication && (
              <Text style={styles.infoLine}>
                <Text style={styles.infoLabel}>Indication: </Text>
                <Text style={styles.infoValue}>{data.indication}</Text>
              </Text>
            )}
            {providerLine && (
              <Text style={styles.infoLine}>
                <Text style={styles.infoLabel}>Provider: </Text>
                <Text style={styles.infoValue}>{providerLine}</Text>
              </Text>
            )}
            {data.facilityName && (
              <Text style={styles.infoLine}>
                <Text style={styles.infoLabel}>Facility: </Text>
                <Text style={styles.infoValue}>{data.facilityName}</Text>
              </Text>
            )}
            <Text style={styles.infoLine}>
              <Text style={styles.infoLabel}>Invoice Date: </Text>
              <Text style={styles.infoValue}>{data.invoiceDate}</Text>
            </Text>
          </View>

          {/* Center — Diagnoses */}
          <View style={styles.infoColCenter}>
            <Text style={styles.diagHeading}>Diagnoses (ICD 10 codes)</Text>
            {data.diagnoses.length > 0 ? (
              data.diagnoses.map((dx, i) => (
                <Text key={i} style={styles.diagLine}>
                  {dx.icd10_code ? `${dx.icd10_code} – ` : ''}{dx.description}
                </Text>
              ))
            ) : (
              <Text style={[styles.diagLine, { color: '#999' }]}>None</Text>
            )}
          </View>

          {/* Right — Attorney */}
          <View style={styles.infoColRight}>
            {data.firmName ? (
              <>
                <Text style={styles.attLine}>{data.firmName}</Text>
                {data.attorneyAddress && <Text style={styles.attLine}>{data.attorneyAddress}</Text>}
                {data.attorneyPhone && (
                  <Text style={styles.attLine}>
                    <Text style={styles.attLabel}>Tel: </Text>{data.attorneyPhone}
                  </Text>
                )}
                {data.attorneyFax && (
                  <Text style={styles.attLine}>
                    <Text style={styles.attLabel}>Fax: </Text>{data.attorneyFax}
                  </Text>
                )}
              </>
            ) : (
              <Text style={[styles.attLine, { color: '#999' }]}>N/A</Text>
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
            <Text style={[styles.colUnit, styles.thText]}>Unit Price</Text>
            <Text style={[styles.colAmount, styles.thText]}>Amount</Text>
          </View>
          {data.lineItems.map((item, i) => (
            <View key={i} style={styles.tableRow}>
              <Text style={[styles.colDate, styles.tdText]}>{item.serviceDate}</Text>
              <Text style={[styles.colCpt, styles.tdText]}>{item.cptCode}</Text>
              <Text style={[styles.colDesc, styles.tdText]}>{item.description}</Text>
              <Text style={[styles.colQty, styles.tdText]}>{item.quantity}</Text>
              <Text style={[styles.colUnit, styles.tdText]}>{formatCurrency(item.unitPrice)}</Text>
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
