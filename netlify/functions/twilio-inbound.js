import { ensureServerConfig, supabaseAdmin } from './_lib/supabaseAdmin.js';
import {
  transitionAppointment,
  chargeAppointment,
  refundAppointment,
  formatStatusSummary,
  getAppointmentStatusSummaryByRequestNumber,
} from './_lib/bookingActions.js';

function xmlMessage(message) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/xml' },
    body: `<Response><Message>${message}</Message></Response>`,
  };
}

function normalizePhone(phone = '') {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return phone;
}

function parsePercentToken(token) {
  if (!token) return null;
  const match = token.trim().match(/^([0-9]+(?:\.[0-9]+)?)%$/);
  if (!match) return null;
  return Number(match[1]);
}

function parseMoneyToken(token) {
  if (!token) return null;
  const match = token.trim().match(/^\$?([0-9]+(?:\.[0-9]{1,2})?)$/);
  if (!match) return null;
  return Number(match[1]);
}

function parseCommand(body = '') {
  const normalized = body.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) return { action: 'invalid' };

  let m = normalized.match(/^(yes|no)\s*#?\s*(\d{2,6})$/i);
  if (m) return { action: m[1] === 'yes' ? 'confirm' : 'decline', requestNumber: Number(m[2]) };

  m = normalized.match(/^status\s*#?\s*(\d{2,6})$/i);
  if (m) return { action: 'status', requestNumber: Number(m[1]) };

  m = normalized.match(/^late\s*#?\s*(\d{2,6})(?:\s+([^\s]+))?$/i);
  if (m) return { action: 'charge_late', requestNumber: Number(m[1]), percent: parsePercentToken(m[2]) };

  m = normalized.match(/^no show\s*#?\s*(\d{2,6})(?:\s+([^\s]+))?$/i);
  if (m) return { action: 'charge_no_show', requestNumber: Number(m[1]), percent: parsePercentToken(m[2]) };

  m = normalized.match(/^charge\s*#?\s*(\d{2,6})\s+([^\s]+)$/i);
  if (m) return { action: 'charge_service', requestNumber: Number(m[1]), amount: parseMoneyToken(m[2]) };

  m = normalized.match(/^refund\s+(late|no show|services)\s*#?\s*(\d{2,6})(?:\s+([^\s]+))?$/i);
  if (m) {
    return {
      action: 'refund',
      target: m[1] === 'services' ? 'service' : (m[1] === 'late' ? 'late' : 'no_show'),
      requestNumber: Number(m[2]),
      percent: parsePercentToken(m[3]),
    };
  }

  return { action: 'invalid' };
}

const HELP_TEXT = [
  'Invalid command. Examples:',
  'yes 123 | no 123 | status 123',
  'late 123 [50%] | no show 123 [40%]',
  'charge 123 $85',
  'refund late 123 | refund no show 123 | refund services 123 [50%]',
].join(' ');

async function findAppointmentByRequest(requestNumber) {
  const { data: appointment } = await supabaseAdmin
    .from('appointments')
    .select('id,status,confirmation_deadline_at')
    .eq('booking_request_number', requestNumber)
    .maybeSingle();

  return appointment;
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
    if (command.action === 'invalid') {
      return xmlMessage(HELP_TEXT);
    }

    const appointment = await findAppointmentByRequest(command.requestNumber);
    if (!appointment) {
      return xmlMessage(`No appointment found for request #${command.requestNumber}.`);
    }

    if (command.action === 'confirm' || command.action === 'decline') {
      if (appointment.status !== 'pending_confirmation') {
        return xmlMessage(`Request #${command.requestNumber} is currently ${appointment.status}.`);
      }
      if (new Date(appointment.confirmation_deadline_at) <= new Date()) {
        await transitionAppointment(appointment.id, 'expired', { initiatedBy: 'twilio', commandText: body });
        return xmlMessage('Request already expired and released.');
      }

      const nextStatus = command.action === 'confirm' ? 'confirmed' : 'declined';
      await transitionAppointment(appointment.id, nextStatus, { initiatedBy: 'twilio', commandText: body });
      return xmlMessage(`Request #${command.requestNumber} ${nextStatus}.`);
    }

    if (command.action === 'charge_late') {
      await chargeAppointment({ appointmentId: appointment.id, target: 'late', percentOverride: command.percent ?? 25, initiatedBy: 'twilio', commandText: body });
      return xmlMessage(`Late cancellation fee charged for request #${command.requestNumber}.`);
    }

    if (command.action === 'charge_no_show') {
      await chargeAppointment({ appointmentId: appointment.id, target: 'no_show', percentOverride: command.percent ?? 50, initiatedBy: 'twilio', commandText: body });
      return xmlMessage(`No-show fee charged for request #${command.requestNumber}.`);
    }

    if (command.action === 'charge_service') {
      if (!command.amount) {
        return xmlMessage('Invalid amount. Usage: charge 123 $85');
      }
      await chargeAppointment({ appointmentId: appointment.id, target: 'service', amountDollars: command.amount, initiatedBy: 'twilio', commandText: body });
      return xmlMessage(`Service charge posted for request #${command.requestNumber}.`);
    }

    if (command.action === 'refund') {
      await refundAppointment({ appointmentId: appointment.id, target: command.target, percentOverride: command.percent ?? null, initiatedBy: 'twilio', commandText: body });
      return xmlMessage(`Refund processed for request #${command.requestNumber}.`);
    }

    if (command.action === 'status') {
      const summary = await getAppointmentStatusSummaryByRequestNumber(command.requestNumber);
      return xmlMessage(formatStatusSummary(summary));
    }

    return xmlMessage(HELP_TEXT);
  } catch (error) {
    return xmlMessage(`Command failed: ${error.message}`);
  }
};
