export const extractDuplicateFields = (errorMessage, registrationNo, chasisNo, engineNo) => {
  const duplicateFields = [];
  if (registrationNo && errorMessage.includes('registration_no')) {
    duplicateFields.push('registration number');
  }
  if (chasisNo && errorMessage.includes('chasis_no')) {
    duplicateFields.push('chassis number');
  }
  if (engineNo && errorMessage.includes('engine_no')) {
    duplicateFields.push('engine number');
  }
  return duplicateFields;
};

export const buildDuplicateErrorMessage = (duplicateFields) => {
  if (duplicateFields.length === 0) {
    return 'A car with this identifier already exists';
  }
  return `A car with this ${duplicateFields.join(' or ')} already exists`;
};
