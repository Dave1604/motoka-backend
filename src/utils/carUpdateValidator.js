/**
 * Validates conditional field requirements based on the final state after update.
 * Merges update payload with existing car data to check business rule constraints.
 */
export function validateConditionalFields(sanitizedBody, existingCar) {
  const errors = [];
  
  const finalRegistrationStatus = sanitizedBody.registration_status !== undefined 
    ? sanitizedBody.registration_status 
    : existingCar.registration_status;
  
  const finalDateIssued = sanitizedBody.date_issued !== undefined 
    ? sanitizedBody.date_issued 
    : existingCar.date_issued;
    
  const finalExpiryDate = sanitizedBody.expiry_date !== undefined 
    ? sanitizedBody.expiry_date 
    : existingCar.expiry_date;
  
  // Business rule: registered cars require valid date range
  if (finalRegistrationStatus === 'registered') {
    if (!finalDateIssued || finalDateIssued === null) {
      errors.push({ field: 'date_issued', message: 'Date issued is required for registered cars' });
    }
    if (!finalExpiryDate || finalExpiryDate === null) {
      errors.push({ field: 'expiry_date', message: 'Expiry date is required for registered cars' });
    }
    if (finalDateIssued && finalExpiryDate && new Date(finalExpiryDate) <= new Date(finalDateIssued)) {
      errors.push({ field: 'expiry_date', message: 'Expiry date must be after date issued' });
    }
  }
  
  const finalType = sanitizedBody.type !== undefined 
    ? sanitizedBody.type 
    : existingCar.type;
  
  const finalCompanyName = sanitizedBody.company_name !== undefined 
    ? sanitizedBody.company_name 
    : existingCar.company_name;
    
  const finalCompanyAddress = sanitizedBody.company_address !== undefined 
    ? sanitizedBody.company_address 
    : existingCar.company_address;
    
  const finalCompanyPhone = sanitizedBody.company_phone !== undefined 
    ? sanitizedBody.company_phone 
    : existingCar.company_phone;
    
  const finalCacNumber = sanitizedBody.cac_number !== undefined 
    ? sanitizedBody.cac_number 
    : existingCar.cac_number;
  
  // Business rule: dealership plates require complete company information
  if (finalType === 'Dealership') {
    if (!finalCompanyName || finalCompanyName === null) {
      errors.push({ field: 'company_name', message: 'Company name is required for dealership plate applications' });
    }
    if (!finalCompanyAddress || finalCompanyAddress === null) {
      errors.push({ field: 'company_address', message: 'Company address is required for dealership plate applications' });
    }
    if (!finalCompanyPhone || finalCompanyPhone === null) {
      errors.push({ field: 'company_phone', message: 'Company phone is required for dealership plate applications' });
    }
    if (!finalCacNumber || finalCacNumber === null) {
      errors.push({ field: 'cac_number', message: 'CAC number is required for dealership plate applications' });
    }
  }
  
  return errors;
}
