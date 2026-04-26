import { ensureServerConfig, supabaseAdmin } from './_lib/supabaseAdmin.js';
import {
  transitionAppointment,
  chargeAppointment,
  refundAppointment,
  getAppointmentStatusSummaryByRequestNumber,
} from './_lib/bookingActions.js';
import { sendSms, notifyBrittney } from './_lib/notifications.js';
import { APP_TIMEZONE } from './_lib/config.js';
import { localDateTimeToUtcIso, toIsoDate } from './_lib/time.js';

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
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return phone;
}

function phoneCandidates(phone = '') {
  const normalized = normalizePhone(phone);
  const digits = normalized.replace(/\D/g, '');
  const last10 = digits.slice(-10);
  const candidates = new Set([normalized]);
  if (last10.length === 10) {
    candidates.add(`+1${last10}`);
    candidates.add(last10);
  }
  return [...candidates];
}

function parseRequestNumber(token) {
  const m = String(token || '').match(/^#?(\d{2,6})$/);
  if (!m) return null;
  return Number(m[1]);
}

function parseMoney(token) {
  const m = String(token || '').trim().match(/^\$?(\d+(?:\.\d{1,2})?)$/);
  if (!m) return null;
  return Number(m[1]);
}

function parsePercent(token) {
  if (token === undefined) return null;
  const m = String(token || '').trim().match(/^(\d{1,3})(?:\s*%)?$/);
  if (!m) return null;
  const value = Number(m[1]);
  if (value <= 0 || value > 100) return null;
  return value;
}

function parseDateToken(token) {
  const m = String(token || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseTimeToken(token) {
  const t = String(token || '').trim().toLowerCase();
  let m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }

  m = t.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const meridiem = m[3];
  if (h < 1 || h > 12 || min < 0 || min > 59) return null;
  if (meridiem === 'am') h = h === 12 ? 0 : h;
  if (meridiem === 'pm') h = h === 12 ? 12 : h + 12;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function parseLeadCommand(text = '') {
  const parts = String(text).trim().split(/\s+/).filter(Boolean);
  return (parts[0] || '').toLowerCase();
}

const COMMAND_HELP = {
  default: 'Commands: yes/no <id>, status, balance, offer, charge, late, no show, refund, text/reply, block/unblock, today/tomorrow/day, find, undo, remind, help',
  payments: 'Payments: charge 123 $85 | late 123 [50%] | no show 123 [40%] | refund late 123 | refund services 123 [50%]',
  scheduling: 'Scheduling: offer 123 MM/DD/YYYY time | block MM/DD/YYYY start end reason | today | tomorrow | day MM/DD/YYYY',
};

const commandSpecs = [
  { key: 'help', match: /^help(?:\s+(\w+))?$/i },
  { key: 'yes', match: /^yes(?:\s+#?(\d{2,6}))?$/i },
  { key: 'no', match: /^no(?:\s+#?(\d{2,6}))?$/i },
  { key: 'status', match: /^status\s+#?(\d{2,6})$/i },
  { key: 'balance', match: /^balance\s+#?(\d{2,6})$/i },
  { key: 'offer', match: /^offer\s+#?(\d{2,6})\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+([^\s]+)$/i },
  { key: 'charge', match: /^charge\s+#?(\d{2,6})\s+(\$?\d+(?:\.\d{1,2})?)$/i },
  { key: 'late', match: /^late\s+#?(\d{2,6})(?:\s+(\d{1,3}%?))?$/i },
  { key: 'no_show', match: /^no\s*show\s+#?(\d{2,6})(?:\s+(\d{1,3}%?))?$/i },
  { key: 'refund', match: /^refund\s+(late|no\s*show|services?)\s+#?(\d{2,6})(?:\s+(\d{1,3}%?))?$/i },
  { key: 'text', match: /^(?:text|reply)\s+#?(\d{2,6})\s+([\s\S]+)$/i },
  { key: 'block', match: /^block\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+([^\s]+)\s+([^\s]+)\s+([\s\S]+)$/i },
  { key: 'unblock', match: /^unblock\s+([a-f0-9-]{8,})$/i },
  { key: 'today', match: /^today$/i },
  { key: 'tomorrow', match: /^tomorrow$/i },
  { key: 'day', match: /^day\s+(\d{1,2}\/\d{1,2}\/\d{4})$/i },
  { key: 'find', match: /^find\s+(.+)$/i },
  { key: 'undo', match: /^undo\s+#?(\d{2,6})$/i },
  { key: 'remind', match: /^remind\s+#?(\d{2,6})(?:\s+(\d{1,3})h)?$/i },
];

function parseCommand(text = '') {
  const clean = String(text || '').trim();
  if (!clean) return null;
  for (const spec of commandSpecs) {
    const m = clean.match(spec.match);
    if (m) return { key: spec.key, raw: clean, groups: m.slice(1) };
  }
  return null;
}

async function findAppointmentByRequestNumber(requestNumber) {
  const { data } = await supabaseAdmin
    .from('appointments')
    .select('*, customers(*)')
    .eq('booking_request_number', requestNumber)
    .maybeSingle();
  return data;
}

async function findMostRecentAppointmentForCustomer(customerId, statuses = null) {
  let query = supabaseAdmin
    .from('appointments')
    .select('*, customers(*)')
    .eq('customer_id', customerId)
    .order('start_at', { ascending: false })
    .limit(1);

  if (statuses?.length) query = query.in('status', statuses);

  const { data } = await query;
  return data?.[0] || null;
}

async function findCustomerByPhone(phone) {
  const candidates = phoneCandidates(phone);
  const { data } = await supabaseAdmin
    .from('customers')
    .select('*')
    .in('phone', candidates)
    .limit(1);
  return data?.[0] || null;
}

function formatDateTime(value) {
  return new Date(value).toLocaleString('en-US', {
    timeZone: APP_TIMEZONE,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

async function sendToAppointmentCustomer(appointment, message) {
  const to = appointment?.customers?.phone;
  if (!to) throw new Error('Customer phone number is missing.');
  await sendSms(to, message);
}

async function listDay(isoDate) {
  const start = localDateTimeToUtcIso(isoDate, '00:00');
  const end = localDateTimeToUtcIso(isoDate, '23:59');
  const { data } = await supabaseAdmin
    .from('appointments')
    .select('booking_request_number,start_at,status,customers(first_name,last_name)')
    .gte('start_at', start)
    .lte('start_at', end)
    .order('start_at', { ascending: true });
  return data || [];
}

async function logCommandResult({ from, body, command, ok, message }) {
  console.log('[twilio-inbound]', { from, body, command: command?.key || null, ok, message });
}

async function findClientResponseAppointment(customerId) {
  const { data: pending } = await supabaseAdmin
    .from('appointments')
    .select('*, customers(*)')
    .eq('customer_id', customerId)
    .eq('status', 'pending_confirmation')
    .order('created_at', { ascending: false })
    .limit(1);

  if (pending?.[0]) return pending[0];

  const { data: confirmed } = await supabaseAdmin
    .from('appointments')
    .select('*, customers(*)')
    .eq('customer_id', customerId)
    .eq('status', 'confirmed')
    .order('start_at', { ascending: false })
    .limit(1);

  return confirmed?.[0] || null;
}

const handlers = {
  async help({ command }) {
    const topic = (command.groups[0] || '').toLowerCase();
    return COMMAND_HELP[topic] || COMMAND_HELP.default;
  },

  async yes({ command, from, body, isBrittney }) {
    const parsedId = parseRequestNumber(command.groups[0]);
    let appointment = null;

    if (parsedId && isBrittney) {
      appointment = await findAppointmentByRequestNumber(parsedId);
    } else {
      const customer = await findCustomerByPhone(from);
      if (!customer) return 'We could not match your phone number to a customer record.';
      appointment = await findClientResponseAppointment(customer.id);
    }

    if (!appointment) return 'Appointment not found for your latest request.';

    if (!isBrittney) {
      const { data: lastOffer } = await supabaseAdmin
        .from('appointment_action_audit')
        .select('*')
        .eq('appointment_id', appointment.id)
        .eq('action_type', 'offer_sent')
        .order('created_at', { ascending: false })
        .limit(1);

      const offerMeta = lastOffer?.[0]?.note ? JSON.parse(lastOffer[0].note) : null;
      if (offerMeta?.proposedStartAt) {
        const startAt = offerMeta.proposedStartAt;
        const endAt = new Date(new Date(startAt).getTime() + appointment.total_duration_minutes * 60000).toISOString();
        await supabaseAdmin.from('appointments').update({ start_at: startAt, end_at: endAt, updated_at: new Date().toISOString() }).eq('id', appointment.id);
      }
    }

    if (appointment.status !== 'pending_confirmation' && isBrittney) {
      return `Appointment #${appointment.booking_request_number} is currently ${appointment.status}.`;
    }

    if (appointment.status === 'pending_confirmation') {
      await transitionAppointment(appointment.id, 'confirmed', { initiatedBy: 'twilio', commandText: body });
    }

    return `Appointment #${appointment.booking_request_number} confirmed.`;
  },

  async no({ command, from, body, isBrittney }) {
    const parsedId = parseRequestNumber(command.groups[0]);
    let appointment = null;

    if (parsedId && isBrittney) {
      appointment = await findAppointmentByRequestNumber(parsedId);
    } else {
      const customer = await findCustomerByPhone(from);
      if (!customer) return 'We could not match your phone number to a customer record.';
      appointment = await findClientResponseAppointment(customer.id);
    }

    if (!appointment) return 'Appointment not found for your latest request.';
    if (appointment.status === 'pending_confirmation') {
      await transitionAppointment(appointment.id, 'declined', { initiatedBy: 'twilio', commandText: body });
    }
    return `Appointment #${appointment.booking_request_number} declined.`;
  },

  async status({ command }) {
    const requestNumber = parseRequestNumber(command.groups[0]);
    const summary = await getAppointmentStatusSummaryByRequestNumber(requestNumber);
    if (!summary) return `Appointment #${requestNumber} not found.`;
    return `#${summary.requestNumber} ${summary.customerName} | Status: ${summary.appointmentStatus} | Service: ${summary.servicePaymentStatus} | Late: ${summary.lateFeeStatus} | No-show: ${summary.noShowFeeStatus}`;
  },

  async balance({ command }) {
    const requestNumber = parseRequestNumber(command.groups[0]);
    const summary = await getAppointmentStatusSummaryByRequestNumber(requestNumber);
    if (!summary) return `Appointment #${requestNumber} not found.`;
    const charged = Number(summary.totalCharged || 0);
    const refunded = Number(summary.totalRefunded || 0);
    const paid = Math.max(0, charged - refunded);
    const total = Number(String(summary.estimatedTotal || '0').replace(/[^0-9.]/g, ''));
    const remaining = Math.max(0, total - paid);
    return `Appointment #${requestNumber} balance | Total estimate: $${total.toFixed(2)} | Amount paid: $${paid.toFixed(2)} | Remaining balance: $${remaining.toFixed(2)}`;
  },

  async offer({ command }) {
    const requestNumber = parseRequestNumber(command.groups[0]);
    const dateIso = parseDateToken(command.groups[1]);
    const hhmm = parseTimeToken(command.groups[2]);
    if (!dateIso) return 'Invalid date format. Use MM/DD/YYYY.';
    if (!hhmm) return 'Invalid time format. Use HH:MM, 2:00pm, or 14:00.';

    const appointment = await findAppointmentByRequestNumber(requestNumber);
    if (!appointment) return `Appointment #${requestNumber} not found.`;

    const proposedStartAt = localDateTimeToUtcIso(dateIso, hhmm);

    await supabaseAdmin.from('appointment_action_audit').insert({
      appointment_id: appointment.id,
      action_type: 'offer_sent',
      initiated_by: 'twilio',
      note: JSON.stringify({ proposedStartAt }),
      command_text: command.raw,
    });

    await sendToAppointmentCustomer(appointment, `Proposed time for your appointment #${requestNumber}: ${formatDateTime(proposedStartAt)}. Reply YES to accept or NO to decline.`);
    return `Offer sent for appointment #${requestNumber}. Waiting for client confirmation.`;
  },

  async charge({ command }) {
    const requestNumber = parseRequestNumber(command.groups[0]);
    const amount = parseMoney(command.groups[1]);
    if (!amount) return 'Invalid amount. Example: charge 123 $85';
    const appointment = await findAppointmentByRequestNumber(requestNumber);
    if (!appointment) return `Appointment #${requestNumber} not found.`;
    await chargeAppointment({ appointmentId: appointment.id, target: 'service', amountDollars: amount, initiatedBy: 'twilio', commandText: command.raw });
    return `Charge applied to appointment #${requestNumber}.`;
  },

  async late({ command }) {
    const requestNumber = parseRequestNumber(command.groups[0]);
    const percent = parsePercent(command.groups[1]) ?? 25;
    const appointment = await findAppointmentByRequestNumber(requestNumber);
    if (!appointment) return `Appointment #${requestNumber} not found.`;
    await chargeAppointment({ appointmentId: appointment.id, target: 'late', percentOverride: percent, initiatedBy: 'twilio', commandText: command.raw });
    return `Late fee (${percent}%) applied to appointment #${requestNumber}.`;
  },

  async no_show({ command }) {
    const requestNumber = parseRequestNumber(command.groups[0]);
    const percent = parsePercent(command.groups[1]) ?? 50;
    const appointment = await findAppointmentByRequestNumber(requestNumber);
    if (!appointment) return `Appointment #${requestNumber} not found.`;
    await chargeAppointment({ appointmentId: appointment.id, target: 'no_show', percentOverride: percent, initiatedBy: 'twilio', commandText: command.raw });
    return `No-show fee (${percent}%) applied to appointment #${requestNumber}.`;
  },

  async refund({ command }) {
    const targetToken = (command.groups[0] || '').toLowerCase().replace(/\s+/g, '_');
    const target = targetToken.startsWith('service') ? 'service' : targetToken;
    const requestNumber = parseRequestNumber(command.groups[1]);
    const percent = parsePercent(command.groups[2]);
    const appointment = await findAppointmentByRequestNumber(requestNumber);
    if (!appointment) return `Appointment #${requestNumber} not found.`;
    await refundAppointment({ appointmentId: appointment.id, target, percentOverride: percent ?? undefined, initiatedBy: 'twilio', commandText: command.raw });
    return `Refund processed for ${target.replace('_', ' ')} on appointment #${requestNumber}.`;
  },

  async text({ command }) {
    const requestNumber = parseRequestNumber(command.groups[0]);
    const message = command.groups[1].trim();
    const appointment = await findAppointmentByRequestNumber(requestNumber);
    if (!appointment) return `Appointment #${requestNumber} not found.`;
    await sendToAppointmentCustomer(appointment, message);
    return `Appointment #${requestNumber}: message sent to client.`;
  },

  async block({ command }) {
    const isoDate = parseDateToken(command.groups[0]);
    const start = parseTimeToken(command.groups[1]);
    const end = parseTimeToken(command.groups[2]);
    const reason = command.groups[3].trim();
    if (!isoDate) return 'Invalid date format. Use MM/DD/YYYY.';
    if (!start || !end) return 'Invalid time format. Use HH:MM, 2:00pm, or 14:00.';
    const startAt = localDateTimeToUtcIso(isoDate, start);
    const endAt = localDateTimeToUtcIso(isoDate, end);
    if (new Date(endAt) <= new Date(startAt)) return 'End time must be after start time.';
    const { data, error } = await supabaseAdmin.from('blocked_times').insert({ start_at: startAt, end_at: endAt, reason }).select('*').single();
    if (error) throw error;
    return `Blocked time created (${data.id}).`;
  },

  async unblock({ command }) {
    const blockId = command.groups[0];
    await supabaseAdmin.from('blocked_times').delete().eq('id', blockId);
    return `Block ${blockId} removed.`;
  },

  async today() {
    const iso = toIsoDate(new Date());
    const items = await listDay(iso);
    if (!items.length) return 'No appointments today.';
    return items.map((a) => `#${a.booking_request_number} ${formatDateTime(a.start_at)} ${a.customers?.first_name || ''} ${a.customers?.last_name || ''} (${a.status})`).join(' | ');
  },

  async tomorrow() {
    const now = new Date();
    now.setUTCDate(now.getUTCDate() + 1);
    const iso = toIsoDate(now);
    const items = await listDay(iso);
    if (!items.length) return 'No appointments tomorrow.';
    return items.map((a) => `#${a.booking_request_number} ${formatDateTime(a.start_at)} ${a.customers?.first_name || ''} ${a.customers?.last_name || ''} (${a.status})`).join(' | ');
  },

  async day({ command }) {
    const iso = parseDateToken(command.groups[0]);
    if (!iso) return 'Invalid date format. Use MM/DD/YYYY.';
    const items = await listDay(iso);
    if (!items.length) return `No appointments for ${command.groups[0]}.`;
    return items.map((a) => `#${a.booking_request_number} ${formatDateTime(a.start_at)} ${a.customers?.first_name || ''} ${a.customers?.last_name || ''} (${a.status})`).join(' | ');
  },

  async find({ command }) {
    const term = command.groups[0].trim();
    const parts = term.split(/\s+/).filter(Boolean);
    let query = supabaseAdmin.from('customers').select('id,first_name,last_name,phone').limit(8);
    if (parts.length > 1) {
      query = query.ilike('first_name', `%${parts[0]}%`).ilike('last_name', `%${parts.slice(1).join(' ')}%`);
    } else {
      query = query.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%`);
    }
    const { data } = await query;
    if (!data?.length) return 'No matching customers found.';
    return data.map((c) => `${c.first_name} ${c.last_name} (${c.phone})`).join(' | ');
  },

  async undo({ command }) {
    const requestNumber = parseRequestNumber(command.groups[0]);
    const appointment = await findAppointmentByRequestNumber(requestNumber);
    if (!appointment) return `Appointment #${requestNumber} not found.`;

    const { data: audit } = await supabaseAdmin
      .from('appointment_action_audit')
      .select('*')
      .eq('appointment_id', appointment.id)
      .in('action_type', ['status_confirmed', 'status_declined', 'charge_service', 'charge_late', 'charge_no_show', 'refund_service', 'refund_late', 'refund_no_show'])
      .order('created_at', { ascending: false })
      .limit(1);

    const last = audit?.[0];
    if (!last) return `Appointment #${requestNumber}: no reversible action found.`;
    if (last.action_type === 'status_confirmed' && appointment.status === 'confirmed') {
      await transitionAppointment(appointment.id, 'pending_confirmation', { initiatedBy: 'twilio', commandText: command.raw });
      return `Undid confirmation for appointment #${requestNumber}.`;
    }
    if (last.action_type === 'status_declined' && appointment.status === 'declined') {
      await transitionAppointment(appointment.id, 'pending_confirmation', { initiatedBy: 'twilio', commandText: command.raw });
      return `Undid decline for appointment #${requestNumber}.`;
    }
    if (last.action_type.startsWith('charge_')) {
      const target = last.action_type.replace('charge_', '');
      const typeMap = {
        service: { chargeType: 'service_charge', refundType: 'refund_service' },
        late: { chargeType: 'late_fee', refundType: 'refund_late' },
        no_show: { chargeType: 'no_show_fee', refundType: 'refund_no_show' },
      };
      const type = typeMap[target];
      if (!type) return `Appointment #${requestNumber}: undo is not available for this charge type.`;
      const { data: latestFinancial } = await supabaseAdmin
        .from('appointment_financial_events')
        .select('event_type,status')
        .eq('appointment_id', appointment.id)
        .in('event_type', [type.chargeType, type.refundType])
        .eq('status', 'succeeded')
        .order('created_at', { ascending: false })
        .limit(1);
      if (!latestFinancial?.length || latestFinancial[0].event_type !== type.chargeType) {
        return `Appointment #${requestNumber}: undo blocked because that charge was already refunded or superseded.`;
      }
      await refundAppointment({ appointmentId: appointment.id, target, initiatedBy: 'twilio', commandText: command.raw });
      return `Undid ${target.replace('_', ' ')} charge for appointment #${requestNumber}.`;
    }
    return `Appointment #${requestNumber}: undo is not available for the latest action.`;
  },

  async remind({ command }) {
    const requestNumber = parseRequestNumber(command.groups[0]);
    const hours = Number(command.groups[1] || 24);
    const appointment = await findAppointmentByRequestNumber(requestNumber);
    if (!appointment) return `Appointment #${requestNumber} not found.`;
    await sendToAppointmentCustomer(appointment, `Reminder: your Nails By Brittney appointment #${requestNumber} is scheduled for ${formatDateTime(appointment.start_at)}. Please reply if you have questions.`);
    return `Reminder (${hours}h template) sent for appointment #${requestNumber}.`;
  },
};

async function forwardClientMessage(from, body) {
  const customer = await findCustomerByPhone(from);
  let appointment = null;
  if (customer) {
    appointment = await findMostRecentAppointmentForCustomer(customer.id);
  }

  const request = appointment?.booking_request_number ? `#${appointment.booking_request_number}` : 'Unknown';
  const customerName = customer ? `${customer.first_name} ${customer.last_name}` : from;
  const forwarded = `Client MSG (${request} - ${customerName}): ${body}`;
  await notifyBrittney(forwarded);
}

export const handler = async (event) => {
  try {
    ensureServerConfig();

    const params = new URLSearchParams(event.body || '');
    const body = (params.get('Body') || '').trim();
    const from = normalizePhone(params.get('From') || '');
    const brittney = normalizePhone(process.env.BRITTNEY_NOTIFICATION_PHONE || '');
    const isBrittney = Boolean(brittney && from === brittney);

    console.log('[twilio-inbound] incoming', { from, body });

    const parsed = parseCommand(body);

    if (isBrittney && parsed) {
      const handlerFn = handlers[parsed.key];
      if (!handlerFn) {
        await logCommandResult({ from, body, command: parsed, ok: false, message: 'invalid command' });
        return xmlMessage("Invalid command. Reply 'help' for available commands.");
      }

      try {
        const message = await handlerFn({ command: parsed, from, body, isBrittney });
        await logCommandResult({ from, body, command: parsed, ok: true, message });
        return xmlMessage(message);
      } catch (error) {
        await logCommandResult({ from, body, command: parsed, ok: false, message: error.message });
        return xmlMessage(error.message || 'Command failed.');
      }
    }

    const lower = body.toLowerCase();
    if (!isBrittney && /^(yes|no)$/.test(lower)) {
      const simulated = { key: lower, raw: body, groups: [null] };
      const message = await handlers[lower]({ command: simulated, from, body, isBrittney: false });
      return xmlMessage(message);
    }

    const lead = parseLeadCommand(body);
    if (isBrittney && lead) {
      return xmlMessage("Invalid command. Reply 'help' for available commands.");
    }

    await forwardClientMessage(from, body);
    return xmlMessage('Thanks! Your message has been received.');
  } catch (error) {
    return xmlMessage(`Command failed: ${error.message}`);
  }
};
