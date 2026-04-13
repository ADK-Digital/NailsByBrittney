import { json, ensureServerConfig, supabaseAdmin } from './_lib/supabaseAdmin.js';
import { dateRangeWithinBookingWindow, dayOfWeekFromIsoDate } from './_lib/time.js';

function toMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function formatTime(mins) {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

export const handler = async (event) => {
  try {
    ensureServerConfig();
    const q = event.queryStringParameters || {};
    const serviceIds = (q.serviceIds || '').split(',').filter(Boolean);
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

      const { data: conflicts } = await supabaseAdmin
        .from('appointments')
        .select('start_at,end_at,status,confirmation_deadline_at')
        .gte('start_at', `${date}T00:00:00Z`)
        .lte('start_at', `${date}T23:59:59Z`)
        .in('status', ['pending_confirmation', 'confirmed', 'completed', 'no_show']);

      const activeConflicts = (conflicts || []).filter((c) => c.status !== 'pending_confirmation' || new Date(c.confirmation_deadline_at) > new Date());

      const { data: blocks } = await supabaseAdmin
        .from('blocked_times')
        .select('start_at,end_at')
        .lte('start_at', `${date}T23:59:59Z`)
        .gte('end_at', `${date}T00:00:00Z`);

      const spans = [
        ...activeConflicts.map((c) => [new Date(c.start_at).getUTCHours() * 60 + new Date(c.start_at).getUTCMinutes(), new Date(c.end_at).getUTCHours() * 60 + new Date(c.end_at).getUTCMinutes()]),
        ...(blocks || []).map((b) => [new Date(b.start_at).getUTCHours() * 60 + new Date(b.start_at).getUTCMinutes(), new Date(b.end_at).getUTCHours() * 60 + new Date(b.end_at).getUTCMinutes()]),
      ];

      const times = [];
      for (let t = open; t <= latestStart; t += 15) {
        const end = t + totalDuration;
        const overlaps = spans.some(([s, e]) => t < e && end > s);
        if (!overlaps) times.push(formatTime(t));
      }

      response.push({ date, available: times.length > 0, times });
    }

    return json(200, { totalDuration, dates: response });
  } catch (error) {
    return json(500, { error: error.message });
  }
};
