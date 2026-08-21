const DOC_WEIGHT_KG = {
  vehicle_licence: 0.1,
  road_worthiness: 0.1,
  insurance: 0.1,
  referral: 0.1,
  proof_of_ownership: 0.1,
  hackney_permit: 0.1,
  inspection: 0.1,
};

/** Terminal rejects parcel items under 0.1 kg. */
export const TERMINAL_MIN_ITEM_KG = 0.1;
const PACKAGING_FLOOR_KG = 0.2;
const DEFAULT_DOC_KG = 0.35;

function envNumber(names, fallback) {
  for (const name of names) {
    const raw = Number(process.env[name]);
    if (Number.isFinite(raw) && raw > 0) return raw;
  }
  return fallback;
}

export function toTerminalWeightKg(value, fallback = DEFAULT_DOC_KG) {
  const n = Number(value);
  const base = Number.isFinite(n) && n > 0 ? n : fallback;
  return roundKg(Math.max(TERMINAL_MIN_ITEM_KG, base));
}

export function estimateWeightKg({ purpose, selectedItems = [] } = {}) {
  const docDefault = envNumber(['SHIPBUBBLE_DEFAULT_DOC_WEIGHT_KG', 'TERMINAL_DEFAULT_DOC_WEIGHT_KG'], DEFAULT_DOC_KG);
  const plateKg = envNumber(['SHIPBUBBLE_PLATE_WEIGHT_KG', 'TERMINAL_PLATE_WEIGHT_KG'], 1.2);
  const dlKg = envNumber(['SHIPBUBBLE_DL_CARD_WEIGHT_KG', 'TERMINAL_DL_CARD_WEIGHT_KG'], 0.2);

  if (purpose === 'plate_number') return toTerminalWeightKg(plateKg);
  if (purpose === 'driver_license') return toTerminalWeightKg(dlKg);

  const keys = Array.isArray(selectedItems) ? selectedItems : [];
  if (keys.length === 0) {
    return toTerminalWeightKg(Math.max(PACKAGING_FLOOR_KG, docDefault));
  }

  const paperKg = keys.reduce((sum, key) => {
    const mapped = DOC_WEIGHT_KG[itemKey(key)];
    return sum + (mapped != null ? mapped : docDefault / Math.max(keys.length, 1));
  }, 0);

  return toTerminalWeightKg(Math.max(PACKAGING_FLOOR_KG, paperKg));
}

function itemKey(item) {
  if (item == null) return '';
  if (typeof item === 'string') return item;
  if (typeof item === 'object') {
    return String(item.item_key || item.key || item.slug || item.name || item.id || '');
  }
  return String(item);
}

function roundKg(value) {
  return Math.round(Number(value) * 1000) / 1000;
}
