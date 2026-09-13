/**
 * Coverage targets — the Nigerian fleet "Filter by my car" has to look
 * stocked for. Counts are exact-fitment parts (is_universal = false).
 */
export const TARGET_CARS = [
  { make: 'Toyota', model: 'Corolla', year: 2016 },
  { make: 'Toyota', model: 'Camry', year: 2015 },
  { make: 'Toyota', model: 'Hilux', year: 2016 },
  { make: 'Toyota', model: 'Highlander', year: 2017 },
  { make: 'Toyota', model: 'RAV4', year: 2018 },
  { make: 'Toyota', model: 'Sienna', year: 2016 },
  { make: 'Honda', model: 'Accord', year: 2016 },
  { make: 'Honda', model: 'CR-V', year: 2017 },
  { make: 'Lexus', model: 'ES350', year: 2016 },
  { make: 'Lexus', model: 'RX350', year: 2016 },
  { make: 'Mercedes-Benz', model: 'C300', year: 2015 },
  { make: 'Mercedes-Benz', model: 'E350', year: 2015 },
  { make: 'Mercedes-Benz', model: 'GLK350', year: 2014 },
  { make: 'Hyundai', model: 'Sonata', year: 2016 },
  { make: 'Hyundai', model: 'Elantra', year: 2016 },
  { make: 'Kia', model: 'Sportage', year: 2016 },
  { make: 'Nissan', model: 'Altima', year: 2016 },
  { make: 'Nissan', model: 'Pathfinder', year: 2016 },
];

export const MIN_EXACT_PARTS = 5;
export const MIN_CATEGORIES = 3;
