import { json, ensureServerConfig, supabaseAdmin } from './_lib/supabaseAdmin.js';
import { transitionAppointment } from './_lib/bookingActions.js';

async function runExpiry() {
  const cutoffIso = new Date(Date.now() - (48 * 60 * 60 * 1000)).toISOString();

  const { data, error } = await supabaseAdmin
    .from('appointments')
    .select('id')
    .eq('status', 'pending')
    .lt('created_at', cutoffIso)
    .limit(100);

  if (error) throw error;

  for (const appointment of data || []) {
    // eslint-disable-next-line no-await-in-loop
    await transitionAppointment(appointment.id, 'expired', {
      initiatedBy: 'system',
      note: 'Auto-expired after 48 hours',
    });
  }

  return (data || []).length;
}

export const handler = async () => {
  try {
    ensureServerConfig();
    const expiredCount = await runExpiry();
    console.log(`Auto-expired ${expiredCount} pending appointments.`);
    return json(200, { expired: expiredCount });
  } catch (error) {
    console.error('Failed to auto-expire pending appointments:', error);
    return json(500, { error: error.message });
  }
};

export const config = {
  schedule: '@hourly',
};
