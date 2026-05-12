export const DEFAULT_BUSINESS_PHONE = '+12528887757';

export function normalizePhoneNumber(phone = '') {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return String(phone || '').trim();
}

export function formatUsPhone(phone = '') {
  const normalized = normalizePhoneNumber(phone);
  const digits = normalized.replace(/\D/g, '');
  const last10 = digits.slice(-10);
  if (last10.length !== 10) return normalized || phone;
  return `(${last10.slice(0, 3)}) ${last10.slice(3, 6)}-${last10.slice(6)}`;
}

export function getBusinessPhoneNumber() {
  return normalizePhoneNumber(process.env.TWILIO_PHONE_NUMBER || DEFAULT_BUSINESS_PHONE);
}

export function getBusinessPhoneDisplay() {
  return formatUsPhone(getBusinessPhoneNumber());
}
