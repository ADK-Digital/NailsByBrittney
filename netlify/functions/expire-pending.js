import { json, ensureServerConfig, supabaseAdmin } from './_lib/supabaseAdmin.js';
import { transitionAppointment } from './_lib/bookingActions.js';

async function runExpiry() {
  const { data } = await supabaseAdmin
    .from('appointments')
    .select('id')
    .eq('status', 'pending_confirmation')
    .is('archived_at', null)
    .lte('confirmation_deadline_at', new Date().toISOString());

  for (const row of data || []) {
    // eslint-disable-next-line no-await-in-loop
    await transitionAppointment(row.id, 'expired');
  }
  return (data || []).length;
}

export const handler = async () => {
  try {
    ensureServerConfig();
    const count = await runExpiry();
    return json(200, { expired: count });
  } catch (error) {
    return json(500, { error: error.message });
  }
};

export const config = { schedule: '*/15 * * * *' };
