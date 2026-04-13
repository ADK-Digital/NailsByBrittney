import { json, ensureServerConfig, supabaseAdmin } from './_lib/supabaseAdmin.js';
import { transitionAppointment } from './_lib/bookingActions.js';

function parseReply(body = '') {
  const normalized = body.trim().toLowerCase().replace(/\s+/g, ' ');
  const m = normalized.match(/^(yes|no)\s*#?\s*(\d{2,4})$/i);
  if (!m) return null;
  return { decision: m[1].toLowerCase(), requestNumber: Number(m[2]) };
}

export const handler = async (event) => {
  try {
    ensureServerConfig();
    const params = new URLSearchParams(event.body || '');
    const body = params.get('Body') || '';
    const parsed = parseReply(body);

    if (!parsed) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/xml' },
        body: '<Response><Message>Invalid reply. Use: yes 184 or no 184</Message></Response>',
      };
    }

    const { data: appointment } = await supabaseAdmin
      .from('appointments')
      .select('id,status,confirmation_deadline_at')
      .eq('booking_request_number', parsed.requestNumber)
      .eq('status', 'pending_confirmation')
      .maybeSingle();

    if (!appointment) {
      return { statusCode: 200, headers: { 'Content-Type': 'text/xml' }, body: '<Response><Message>No pending appointment found for that request number.</Message></Response>' };
    }

    if (new Date(appointment.confirmation_deadline_at) <= new Date()) {
      await transitionAppointment(appointment.id, 'expired');
      return { statusCode: 200, headers: { 'Content-Type': 'text/xml' }, body: '<Response><Message>Request already expired and released.</Message></Response>' };
    }

    await transitionAppointment(appointment.id, parsed.decision === 'yes' ? 'confirmed' : 'declined');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/xml' },
      body: `<Response><Message>Request #${parsed.requestNumber} ${parsed.decision === 'yes' ? 'confirmed' : 'declined'}.</Message></Response>`,
    };
  } catch (error) {
    return json(500, { error: error.message });
  }
};
