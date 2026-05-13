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

function utcMsToLocalMinutes(utcMs) {
  const local = new Date(utcMs).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  });
  const [hour, minute] = local.split(':').map(Number);
  return hour * 60 + minute;
}

function alignUpToInterval(minutes, interval = 15) {
  return Math.ceil(minutes / interval) * interval;
}

function alignDownToInterval(minutes, interval = 15) {
  return Math.floor(minutes / interval) * interval;
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
      const dayStartUtc = localDateTimeToUtcIso(date, '00:00');
      const nextDate = addDaysToIsoDate(date, 1);
      const dayEndUtc = localDateTimeToUtcIso(nextDate, '00:00');
      const dayStartMs = new Date(dayStartUtc).getTime();
      const dayEndMs = new Date(dayEndUtc).getTime();

      const { data: additionalAvailability } = await supabaseAdmin
        .from('additional_availability')
        .select('start_at,end_at')
        .lt('start_at', dayEndUtc)
        .gt('end_at', dayStartUtc);

      const availabilityWindows = [];
      if (dayHours) {
        availabilityWindows.push([
          toMinutes(dayHours.open_time.slice(0, 5)),
          toMinutes(dayHours.close_time.slice(0, 5)),
        ]);
      }

      (additionalAvailability || []).forEach((slot) => {
        const startMs = Math.max(new Date(slot.start_at).getTime(), dayStartMs);
        const endMs = Math.min(new Date(slot.end_at).getTime(), dayEndMs);
        if (endMs <= startMs) return;
        const startMinutes = alignUpToInterval(utcMsToLocalMinutes(startMs));
        const endMinutes = alignDownToInterval(utcMsToLocalMinutes(endMs));
        if (endMinutes > startMinutes) availabilityWindows.push([startMinutes, endMinutes]);
      });

      const viableWindows = availabilityWindows
        .map(([open, close]) => [open, close, close - totalDuration])
        .filter(([open, close, latestStart]) => close > open && latestStart >= open);

      if (!viableWindows.length) {
        response.push({ date, available: false, times: [] });
        continue;
      }

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

      const timeSet = new Set();
      viableWindows.forEach(([open, , latestStart]) => {
        for (let t = open; t <= latestStart; t += 15) {
          const end = t + totalDuration;
          const startUtcMs = localMinutesToUtcMs(date, t);
          const endUtcMs = localMinutesToUtcMs(date, end);
          const overlaps = spans.some(([s, e]) => startUtcMs < e && endUtcMs > s);
          if (!overlaps) timeSet.add(formatTime(t));
        }
      });

      const times = Array.from(timeSet).sort();
      response.push({ date, available: times.length > 0, times });
    }

    return json(200, { totalDuration, dates: response });
  } catch (error) {
    return json(500, { error: error.message });
  }
};
