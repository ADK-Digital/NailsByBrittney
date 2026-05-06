import { APP_TIMEZONE } from './config.js';

const dtf = new Intl.DateTimeFormat('en-US', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function zonedParts(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  const parts = Object.fromEntries(dtf.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

export function toIsoDate(input = new Date()) {
  const p = zonedParts(input);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function startOfWeekSunday(input = new Date()) {
  const p = zonedParts(input);
  const local = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const dow = local.getUTCDay();
  local.setUTCDate(local.getUTCDate() - dow);
  return local;
}

export const BOOKING_WINDOW_DAYS = 90;

export function dateRangeWithinBookingWindow() {
  const today = toIsoDate(new Date());
  const [year, month, day] = today.split('-').map(Number);
  const todayDate = new Date(Date.UTC(year, month - 1, day));
  const days = [];

  for (let i = 0; i < BOOKING_WINDOW_DAYS; i += 1) {
    const date = new Date(todayDate);
    date.setUTCDate(todayDate.getUTCDate() + i);
    days.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`);
  }

  return days;
}

export function dayOfWeekFromIsoDate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function combineIsoDateAndMinutes(isoDate, minutesFromMidnight) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const h = Math.floor(minutesFromMidnight / 60);
  const min = minutesFromMidnight % 60;
  // naive NY local conversion by offset guess; DB stores and compares in UTC, this timestamp is only for display and range edges.
  const approxUtc = new Date(Date.UTC(y, m - 1, d, h + 5, min));
  return approxUtc.toISOString();
}

export function formatDuration(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (!h) return `${m} min`;
  if (!m) return `${h} hr`;
  return `${h} hr ${m} min`;
}

export function nyOffsetForDate(isoDate) {
  const noonUtc = new Date(`${isoDate}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE,
    timeZoneName: 'shortOffset',
  }).formatToParts(noonUtc);
  const value = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT-5';
  const rawOffset = value.replace('GMT', '');
  const match = rawOffset.match(/^([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return '-05:00';
  const [, sign, hour, minute = '00'] = match;
  return `${sign}${hour.padStart(2, '0')}:${minute}`;
}

export function localDateTimeToUtcIso(isoDate, hhmm) {
  const offset = nyOffsetForDate(isoDate);
  return new Date(`${isoDate}T${hhmm}:00${offset}`).toISOString();
}
