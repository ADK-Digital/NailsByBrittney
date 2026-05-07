import { json, ensureServerConfig, supabaseAdmin } from './_lib/supabaseAdmin.js';
import { dateRangeWithinBookingWindow, dayOfWeekFromIsoDate, localDateTimeToUtcIso } from './_lib/time.js';

function toMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function formatTime(mins) {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

function addDaysToIsoDate(isoDate, daysToAdd) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + daysToAdd);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function localMinutesToUtcMs(isoDate, minutes) {
  const daysToAdd = Math.floor(minutes / (24 * 60));
  const minutesInDay = minutes % (24 * 60);
  const date = addDaysToIsoDate(isoDate, daysToAdd);
  return new Date(localDateTimeToUtcIso(date, formatTime(minutesInDay))).getTime();
}

export const handler = async (event) => {
  try {
    ensureServerConfig();
    const q = event.queryStringParameters || {};
    const multi = event.multiValueQueryStringParameters || {};
    const rawServiceIds = multi.serviceIds?.length
      ? multi.serviceIds
      : (q.serviceIds ? [q.serviceIds] : []);
    const serviceIds = rawServiceIds
      .flatMap((value) => String(value).split(','))
      .map((value) => value.trim())
      .filter(Boolean);
    const selectedDate = q.date;
    if (!serviceIds.length) return json(400, { error: 'serviceIds is required.' });

    const { data: serviceRows } = await supabaseAdmin.from('services').select('id,duration_minutes').in('id', serviceIds).eq('active', true);
    const totalDuration = (serviceRows || []).reduce((sum, s) => sum + s.duration_minutes, 0);
    if (!totalDuration) return json(400, { error: 'No valid active services selected.' });

    const { data: hours } = await supabaseAdmin.from('business_hours').select('*').eq('active', true);
    const hoursByDow = new Map((hours || []).map((h) => [h.day_of_week, h]));

    const windowDates = dateRangeWithinBookingWindow();
    const dateSet = selectedDate ? [selectedDate] : windowDates;
    const response = [];

    for (const date of dateSet) {
      const dow = dayOfWeekFromIsoDate(date);
      const dayHours = hoursByDow.get(dow);
      if (!dayHours) {
        response.push({ date, available: false, times: [] });
        // eslint-disable-next-line no-continue
        continue;
      }

      const open = toMinutes(dayHours.open_time.slice(0, 5));
      const close = toMinutes(dayHours.close_time.slice(0, 5));
      const latestStart = close - totalDuration;
      if (latestStart < open) {
        response.push({ date, available: false, times: [] });
        // eslint-disable-next-line no-continue
        continue;
      }

      const dayStartUtc = localDateTimeToUtcIso(date, '00:00');
      const nextDate = addDaysToIsoDate(date, 1);
      const dayEndUtc = localDateTimeToUtcIso(nextDate, '00:00');

      const { data: conflicts } = await supabaseAdmin
        .from('appointments')
        .select('start_at,end_at,status')
        .is('archived_at', null)
        .lt('start_at', dayEndUtc)
        .gt('end_at', dayStartUtc)
        .in('status', ['pending_confirmation', 'confirmed', 'completed', 'no_show']);

      const { data: blocks } = await supabaseAdmin
        .from('blocked_times')
        .select('start_at,end_at')
        .lt('start_at', dayEndUtc)
        .gt('end_at', dayStartUtc);

      const spans = [
        ...(conflicts || []).map((c) => [new Date(c.start_at).getTime(), new Date(c.end_at).getTime()]),
        ...(blocks || []).map((b) => [new Date(b.start_at).getTime(), new Date(b.end_at).getTime()]),
      ];

      const times = [];
      for (let t = open; t <= latestStart; t += 15) {
        const end = t + totalDuration;
        const startUtcMs = localMinutesToUtcMs(date, t);
        const endUtcMs = localMinutesToUtcMs(date, end);
        const overlaps = spans.some(([s, e]) => startUtcMs < e && endUtcMs > s);
        if (!overlaps) times.push(formatTime(t));
      }

      response.push({ date, available: times.length > 0, times });
    }

    return json(200, { totalDuration, dates: response });
  } catch (error) {
    return json(500, { error: error.message });
  }
};
