/**
 * Shared car-brand / OEM make helpers for Ladipo admin filters and data cleanup.
 * Keep in sync with public.ladipo_make_key() (migration 072).
 */

export const OEM_MAKE_PATTERNS = [
  { make: 'Mercedes-Benz', pattern: /\b(?:mercedes(?:[-\s]?benz)?|benz)\b/i },
  { make: 'Volkswagen', pattern: /\b(?:volkswagen|vw)\b/i },
  { make: 'Land Rover', pattern: /\b(?:land\s*rover|landrover)\b/i },
  { make: 'BMW', pattern: /\bbmw\b/i },
  { make: 'Toyota', pattern: /\btoyota\b/i },
  { make: 'Honda', pattern: /\bhonda\b/i },
  { make: 'Nissan', pattern: /\bnissan\b/i },
  { make: 'Hyundai', pattern: /\bhyundai\b/i },
  { make: 'Kia', pattern: /\bkia\b/i },
  { make: 'Ford', pattern: /\bford\b/i },
  { make: 'Lexus', pattern: /\blexus\b/i },
  { make: 'Mazda', pattern: /\bmazda\b/i },
  { make: 'Mitsubishi', pattern: /\bmitsubishi\b/i },
  { make: 'Peugeot', pattern: /\bpeugeot\b/i },
  { make: 'Suzuki', pattern: /\bsuzuki\b/i },
  { make: 'Audi', pattern: /\baudi\b/i },
  { make: 'Volvo', pattern: /\bvolvo\b/i },
  { make: 'Jeep', pattern: /\bjeep\b/i },
  { make: 'Renault', pattern: /\brenaul?t\b/i },
  { make: 'Infiniti', pattern: /\binfiniti\b/i },
  { make: 'Jaguar', pattern: /\bjaguar\b/i },
  { make: 'Acura', pattern: /\bacura\b/i },
  { make: 'Chevrolet', pattern: /\b(?:chevrolet|chevy)\b/i },
];

export function makeKey(value) {
  const key = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  if (key === 'mercedes' || key === 'benz') return 'mercedesbenz';
  if (key === 'vw') return 'volkswagen';
  return key;
}

export function carBrandSearchTerms(make) {
  const key = makeKey(make);
  const aliases = {
    mercedesbenz: ['mercedes-benz', 'mercedes', 'benz'],
    volkswagen: ['volkswagen', 'vw'],
    landrover: ['land rover', 'landrover'],
    bmw: ['bmw'],
    toyota: ['toyota'],
    honda: ['honda'],
    nissan: ['nissan'],
    hyundai: ['hyundai'],
    kia: ['kia'],
    ford: ['ford'],
    lexus: ['lexus'],
    mazda: ['mazda'],
    mitsubishi: ['mitsubishi'],
    peugeot: ['peugeot'],
    suzuki: ['suzuki'],
    audi: ['audi'],
    volvo: ['volvo'],
    jeep: ['jeep'],
    renault: ['renault'],
    infiniti: ['infiniti'],
    jaguar: ['jaguar'],
    acura: ['acura'],
    chevrolet: ['chevrolet', 'chevy'],
  };
  if (aliases[key]) return aliases[key];
  const trimmed = String(make || '').trim();
  return trimmed ? [trimmed] : [];
}

export function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word match for any alias of the selected car brand. */
export function textMentionsCarBrand(text, make) {
  const raw = String(text || '');
  if (!raw.trim()) return false;
  return carBrandSearchTerms(make).some((term) => {
    const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(term)}(?:[^a-z0-9]|$)`, 'i');
    return re.test(raw);
  });
}

/** Detect the primary OEM car make mentioned in a product title/brand. */
export function detectOemMakeInText(text) {
  const raw = String(text || '');
  if (!raw.trim()) return null;
  for (const entry of OEM_MAKE_PATTERNS) {
    if (entry.pattern.test(raw)) return entry.make;
  }
  return null;
}

/**
 * True when compatibility.make conflicts with an OEM clearly named in title/brand.
 * e.g. title "Mercedes Benz …" + compat make BMW → conflict.
 */
export function compatibilityConflictsWithTitle(compatMake, name, brand) {
  const stated = detectOemMakeInText(name) || detectOemMakeInText(brand);
  if (!stated || !compatMake) return false;
  return makeKey(stated) !== makeKey(compatMake);
}
