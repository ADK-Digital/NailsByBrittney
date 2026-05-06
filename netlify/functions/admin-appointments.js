import { json, ensureServerConfig, supabaseAdmin } from './_lib/supabaseAdmin.js';
import {
  transitionAppointment,
  chargeAppointment,
  refundAppointment,
  getAppointmentStatusSummaryByRequestNumber,
} from './_lib/bookingActions.js';

async function handleAppointmentAction(payload) {
  const initiatedBy = 'dashboard';

  if (payload.action === 'set_status') {
    await transitionAppointment(payload.appointmentId, payload.status, { initiatedBy, note: payload.note });
    return { ok: true };
  }

  if (payload.action === 'charge') {
    const event = await chargeAppointment({
      appointmentId: payload.appointmentId,
      target: payload.target,
      amountDollars: payload.amount,
      percentOverride: payload.percent,
      initiatedBy,
      note: payload.note,
    });
    return { ok: true, event };
  }

  if (payload.action === 'refund') {
    const event = await refundAppointment({
      appointmentId: payload.appointmentId,
      target: payload.target,
      percentOverride: payload.percent,
      amountDollars: payload.amount,
      initiatedBy,
      note: payload.note,
    });
    return { ok: true, event };
  }

  if (payload.action === 'status_summary') {
    const summary = await getAppointmentStatusSummaryByRequestNumber(payload.requestNumber);
    return { ok: true, summary };
  }

  if (payload.action === 'create_block') {
    const { error } = await supabaseAdmin.from('blocked_times').insert({
      start_at: payload.startAt,
      end_at: payload.endAt,
      reason: payload.reason || null,
    });
    if (error) throw error;
    return { ok: true };
  }

  if (payload.action === 'delete_block') {
    await supabaseAdmin.from('blocked_times').delete().eq('id', payload.blockId);
    return { ok: true };
  }

  throw new Error('Unsupported action');
}

export const handler = async (event) => {
  try {
    ensureServerConfig();

    if (event.httpMethod === 'GET') {
      const { data: appointments } = await supabaseAdmin
        .from('appointments')
        .select('*, customers(*), appointment_services(*), appointment_financial_events(*)')
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
      const result = await handleAppointmentAction(payload);
      return json(200, result);
    }

    return json(405, { error: 'Method not allowed' });
  } catch (error) {
    return json(500, { error: error.message });
  }
};
