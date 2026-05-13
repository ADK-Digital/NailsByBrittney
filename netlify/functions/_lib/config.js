export const APP_TIMEZONE = 'America/New_York';
export const SLOT_INTERVAL_MINUTES = 15;
export const PENDING_TIMEOUT_HOURS = 48;

export const BOOKING_STATUS = {
  PENDING: 'pending_confirmation',
  CONFIRMED: 'confirmed',
  DECLINED: 'declined',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
  NO_SHOW: 'no_show',
};

export const PRODUCTION_PUBLIC_BASE_URL = 'https://nailsbybrittney.com';
const CANONICAL_PUBLIC_HOST = 'nailsbybrittney.com';

function normalizePublicBaseUrl(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return PRODUCTION_PUBLIC_BASE_URL;

  try {
    const parsed = new URL(candidate);
    const hostname = parsed.hostname.toLowerCase();

    if (hostname !== CANONICAL_PUBLIC_HOST) {
      return PRODUCTION_PUBLIC_BASE_URL;
    }

    return PRODUCTION_PUBLIC_BASE_URL;
  } catch {
    return PRODUCTION_PUBLIC_BASE_URL;
  }
}

export const PUBLIC_BASE_URL = normalizePublicBaseUrl(process.env.BOOKING_PUBLIC_BASE_URL);

export function makePublicUrl(path = '/') {
  return new URL(path, `${PUBLIC_BASE_URL}/`).toString();
}

export const BOOKING_LINK = makePublicUrl('/#booking');
