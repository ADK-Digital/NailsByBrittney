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

export const BOOKING_LINK = process.env.BOOKING_PUBLIC_BASE_URL || '';
