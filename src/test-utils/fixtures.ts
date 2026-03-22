export const TEST_USER_ID = 'test-user-id'
export const TEST_CASE_ID = '550e8400-e29b-41d4-a716-446655440000'
export const TEST_PATIENT_ID = '660e8400-e29b-41d4-a716-446655440000'
export const TEST_ATTORNEY_ID = '770e8400-e29b-41d4-a716-446655440000'
export const TEST_PROVIDER_ID = '880e8400-e29b-41d4-a716-446655440000'
export const TEST_INVOICE_ID = '990e8400-e29b-41d4-a716-446655440000'

export const validAttorneyData = {
  first_name: 'Sarah',
  last_name: 'Connor',
  firm_name: 'Connor & Associates',
  email: 'sarah@connor.law',
  phone: '555-0100',
}

export const validPatientCaseData = {
  first_name: 'John',
  last_name: 'Doe',
  date_of_birth: '1990-01-15',
  attorney_id: TEST_ATTORNEY_ID,
  assigned_provider_id: TEST_PROVIDER_ID,
  lien_on_file: false,
}

export const validServiceCatalogItem = {
  cpt_code: '99213',
  description: 'Office visit - established patient',
  default_price: 150,
}

export const validFeeEstimateItem = {
  description: 'Initial Consultation',
  fee_category: 'professional' as const,
  price_min: 500,
  price_max: 1000,
}
