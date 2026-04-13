import { json, ensureServerConfig, supabaseAdmin } from './_lib/supabaseAdmin.js';
import { transitionAppointment } from './_lib/bookingActions.js';

export const handler = async (event) => {
  try {
    ensureServerConfig();

    if (event.httpMethod === 'GET') {
      const { data: appointments } = await supabaseAdmin
        .from('appointments')
        .select('*, customers(*), appointment_services(*)')
        .order('start_at', { ascending: true });
      const { data: customers } = await supabaseAdmin
        .from('customers')
        .select('*, customer_notes(*)')
        .order('updated_at', { ascending: false });
      const { data: blockedTimes } = await supabaseAdmin
        .from('blocked_times')
        .select('*')
        .order('start_at', { ascending: true });
      return json(200, { appointments: appointments || [], customers: customers || [], blockedTimes: blockedTimes || [] });
    }

    if (event.httpMethod === 'POST') {
      const payload = JSON.parse(event.body || '{}');

      if (payload.action === 'set_status') {
        await transitionAppointment(payload.appointmentId, payload.status);
        return json(200, { ok: true });
      }

      if (payload.action === 'create_block') {
        const { error } = await supabaseAdmin.from('blocked_times').insert({
          start_at: payload.startAt,
          end_at: payload.endAt,
          reason: payload.reason || null,
        });
        if (error) throw error;
        return json(200, { ok: true });
      }

      if (payload.action === 'delete_block') {
        await supabaseAdmin.from('blocked_times').delete().eq('id', payload.blockId);
        return json(200, { ok: true });
      }
    }

    return json(405, { error: 'Method not allowed' });
  } catch (error) {
    return json(500, { error: error.message });
  }
};
