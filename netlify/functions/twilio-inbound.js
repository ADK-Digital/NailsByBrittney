import { ensureServerConfig, supabaseAdmin } from './_lib/supabaseAdmin.js';
import { transitionAppointment } from './_lib/bookingActions.js';
import { APP_TIMEZONE } from './_lib/config.js';

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlMessage(message) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/xml' },
    body: `<Response><Message>${escapeXml(message)}</Message></Response>`,
  };
}

function normalizePhone(phone = '') {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return phone;
}

const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || APP_TIMEZONE || 'America/New_York';

function formatShortDateTime(value) {
  return new Date(value).toLocaleString('en-US', {
    timeZone: BUSINESS_TIMEZONE,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function parseCommand(body = '') {
  const normalized = body.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) return { action: 'invalid' };

  if (normalized === 'help') return { action: 'help' };
  if (normalized === 'list') return { action: 'list' };

  let m = normalized.match(/^details\s*#?\s*(\d{2,6})$/i);
  if (m) return { action: 'details', requestNumber: Number(m[1]) };

  m = normalized.match(/^(yes|no)\s*#?\s*(\d{2,6})$/i);
  if (m) return { action: m[1] === 'yes' ? 'confirm' : 'decline', requestNumber: Number(m[2]) };

  return { action: 'invalid' };
}

const HELP_TEXT = [
  'Commands:',
  'help',
  'list',
  'details 123',
  'yes 123',
  'no 123',
].join(' | ');

async function findAppointmentByRequest(requestNumber) {
  const { data: appointment } = await supabaseAdmin
    .from('appointments')
    .select('id,booking_request_number,start_at,status,confirmation_deadline_at,customers(first_name,last_name)')
    .eq('booking_request_number', requestNumber)
    .maybeSingle();

  return appointment;
}

async function listUpcomingAppointments(limit = 5) {
  const nowIso = new Date().toISOString();
  const { data } = await supabaseAdmin
    .from('appointments')
    .select('booking_request_number,start_at,status,customers(first_name,last_name)')
    .gte('start_at', nowIso)
    .in('status', ['pending_confirmation', 'confirmed'])
    .order('start_at', { ascending: true })
    .limit(limit);

  return data || [];
}

async function getAppointmentDetailsByRequest(requestNumber) {
  const { data: appointment } = await supabaseAdmin
    .from('appointments')
    .select('id,booking_request_number,start_at,status,customers(first_name,last_name)')
    .eq('booking_request_number', requestNumber)
    .maybeSingle();

  if (!appointment) return null;

  const { data: services } = await supabaseAdmin
    .from('appointment_services')
    .select('service_name_snapshot')
    .eq('appointment_id', appointment.id)
    .order('service_name_snapshot', { ascending: true });

  return {
    ...appointment,
    services: (services || []).map((row) => row.service_name_snapshot),
  };
}

export const handler = async (event) => {
  try {
    ensureServerConfig();

    const params = new URLSearchParams(event.body || '');
    const body = params.get('Body') || '';
    const sender = normalizePhone(params.get('From') || '');

    const authorized = normalizePhone(process.env.BRITTNEY_NOTIFICATION_PHONE || '');
    if (!authorized || sender !== authorized) {
      return xmlMessage('Unauthorized sender.');
    }

    const command = parseCommand(body);

    if (command.action === 'help' || command.action === 'invalid') {
      return xmlMessage(HELP_TEXT);
    }

    if (command.action === 'list') {
      const upcoming = await listUpcomingAppointments();
      if (!upcoming.length) return xmlMessage('No upcoming pending/confirmed appointments.');

      const lines = upcoming.map((item) => {
        const customerName = `${item.customers?.first_name || ''} ${item.customers?.last_name || ''}`.trim() || 'Unknown';
        return `#${item.booking_request_number} ${customerName} ${formatShortDateTime(item.start_at)}`;
      });

      return xmlMessage(`Upcoming: ${lines.join(' | ')}`);
    }

    if (command.action === 'details') {
      const details = await getAppointmentDetailsByRequest(command.requestNumber);
      if (!details) return xmlMessage(`No appointment found for request #${command.requestNumber}.`);

      const customerName = `${details.customers?.first_name || ''} ${details.customers?.last_name || ''}`.trim() || 'Unknown';
      const parts = [
        `#${details.booking_request_number}`,
        customerName,
        formatShortDateTime(details.start_at),
        `Status: ${details.status}`,
      ];

      if (details.services?.length) {
        parts.push(`Services: ${details.services.join(', ')}`);
      }

      return xmlMessage(parts.join(' | '));
    }

    const appointment = await findAppointmentByRequest(command.requestNumber);
    if (!appointment) {
      return xmlMessage(`No appointment found for request #${command.requestNumber}.`);
    }

    if (command.action === 'confirm' || command.action === 'decline') {
      if (appointment.status !== 'pending_confirmation') {
        return xmlMessage(`Request #${command.requestNumber} is currently ${appointment.status}.`);
      }

      if (appointment.confirmation_deadline_at && new Date(appointment.confirmation_deadline_at) <= new Date()) {
        await transitionAppointment(appointment.id, 'expired', { initiatedBy: 'twilio', commandText: body });
        return xmlMessage(`Request #${command.requestNumber} already expired and released.`);
      }

      const nextStatus = command.action === 'confirm' ? 'confirmed' : 'declined';
      await transitionAppointment(appointment.id, nextStatus, { initiatedBy: 'twilio', commandText: body });
      return xmlMessage(`#${command.requestNumber} ${nextStatus}.`);
    }

    return xmlMessage(HELP_TEXT);
  } catch (error) {
    return xmlMessage(`Command failed: ${error.message}`);
  }
};
