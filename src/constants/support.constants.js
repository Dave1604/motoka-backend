// Motoka support channels used in customer emails. Mirrors the frontend's
// src/constants/support.js so a number change is one edit per repo.
export const SUPPORT_WHATSAPP_NUMBER = process.env.SUPPORT_WHATSAPP_NUMBER || '2348128685978';
export const SUPPORT_PHONE_DISPLAY = process.env.SUPPORT_PHONE_DISPLAY || '0812 868 5978';

export function buildWhatsAppUrl(lines) {
  const text = (Array.isArray(lines) ? lines : [lines])
    .filter((line) => line !== null && line !== undefined)
    .join('\n');
  return `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}
