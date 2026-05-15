import { json, ensureServerConfig, supabaseAdmin } from './_lib/supabaseAdmin.js';
import {
  transitionAppointment,
  chargeAppointment,
  refundAppointment,
  applyManualAppointmentPayment,
  chargeRemainingServiceBalanceOnFile,
  getAppointmentStatusSummaryByRequestNumber,
} from './_lib/bookingActions.js';
import { listClientMessages, sendAdminClientMessage } from './_lib/clientMessages.js';

const ARCHIVE_SELECT = 'id,file_name,first_appointment_date,last_appointment_date,appointment_count,created_at';

function getBearerToken(event) {
  const headers = event.headers || {};
  const authorization = headers.authorization || headers.Authorization || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

function getAllowedAdminEmails() {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function allowAdminAuthBypass() {
  return process.env.ALLOW_ADMIN_AUTH_BYPASS === 'true'
    && process.env.CONTEXT !== 'production'
    && process.env.NODE_ENV !== 'production';
}

async function authorizeAdminRequest(event) {
  if (allowAdminAuthBypass()) return { user: null, email: 'local-admin' };

  const token = getBearerToken(event);
  if (!token) return { response: json(401, { error: 'Unauthorized' }) };

  ensureServerConfig();
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  const email = data?.user?.email?.trim().toLowerCase();
  if (error || !data?.user || !email) return { response: json(401, { error: 'Unauthorized' }) };

  const allowedEmails = getAllowedAdminEmails();
  if (!allowedEmails.includes(email)) return { response: json(403, { error: 'Forbidden' }) };

  return { user: data.user, email };
}


function csvResponse(fileName, csvContent) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
    body: csvContent || '',
  };
}

async function listArchivedAppointments() {
  const { data, error } = await supabaseAdmin
    .from('appointment_archives')
    .select(ARCHIVE_SELECT)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function downloadArchivedAppointment(fileName) {
  const { data, error } = await supabaseAdmin
    .from('appointment_archives')
    .select('file_name,csv_content')
    .eq('file_name', fileName)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return data;
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function dollarsFromCents(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

function formatPaymentMethod(method) {
  return String(method || '').replace(/_/g, ' ');
}

async function exportPaymentsCsv() {
  const { data, error } = await supabaseAdmin
    .from('appointment_payment_records')
    .select('*, appointments(booking_request_number, appointment_services(service_name_snapshot)), customers(first_name,last_name)')
    .order('created_at', { ascending: true });
  if (error) throw error;

  const header = [
    'payment_date',
    'customer',
    'booking_number',
    'services_summary',
    'payment_method',
    'payment_direction',
    'service_amount',
    'tip_amount',
    'total_collected',
    'external_reference',
    'note',
  ];

  const rows = (data || []).map((record) => {
    const sign = record.payment_direction === 'refund' ? -1 : 1;
    const services = (record.appointments?.appointment_services || [])
      .map((service) => service.service_name_snapshot)
      .filter(Boolean)
      .join('; ');
    const customer = `${record.customers?.first_name || ''} ${record.customers?.last_name || ''}`.trim();
    const bookingNumber = String(Number(record.appointments?.booking_request_number || 0)).padStart(3, '0').slice(-3);
    return [
      new Date(record.created_at).toLocaleString('en-US', { timeZone: 'America/New_York' }),
      customer,
      bookingNumber || '---',
      services,
      formatPaymentMethod(record.payment_method),
      record.payment_direction,
      dollarsFromCents(sign * Number(record.amount_cents || 0)),
      dollarsFromCents(sign * Number(record.tip_amount_cents || 0)),
      dollarsFromCents(sign * (Number(record.amount_cents || 0) + Number(record.tip_amount_cents || 0))),
      record.external_reference || '',
      record.note || '',
    ];
  });

  const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
  const today = new Date().toISOString().slice(0, 10);
  return { fileName: `payments_${today}.csv`, csvContent: `${csv}\n` };
}


async function loadMessageTarget(payload) {
  if (payload.appointmentId) {
    const { data: appointment, error } = await supabaseAdmin
      .from('appointments')
      .select('*, customers(*)')
      .eq('id', payload.appointmentId)
      .maybeSingle();
    if (error) throw error;
    if (!appointment) throw new Error('Appointment not found.');
    return { appointment, customer: appointment.customers };
  }

  if (payload.customerId) {
    const { data: customer, error } = await supabaseAdmin
      .from('customers')
      .select('*')
      .eq('id', payload.customerId)
      .maybeSingle();
    if (error) throw error;
    if (!customer) throw new Error('Customer not found.');
    return { appointment: null, customer };
  }

  throw new Error('Customer or appointment is required.');
}

async function handleAppointmentAction(payload, context = {}) {
  const initiatedBy = 'dashboard';


  if (payload.action === 'list_messages') {
    const { appointment, customer } = await loadMessageTarget(payload);
    const messages = await listClientMessages({
      customerId: customer.id,
      appointmentId: appointment?.id || null,
    });
    return { ok: true, messages };
  }

  if (payload.action === 'send_client_message') {
    const { appointment, customer } = await loadMessageTarget(payload);
    const result = await sendAdminClientMessage({
      customer,
      appointment,
      body: payload.body,
      source: 'dashboard',
    });
    const messages = await listClientMessages({
      customerId: customer.id,
      appointmentId: appointment?.id || null,
    });
    return { ok: true, ...result, messages };
  }

  if (payload.action === 'set_status') {
    await transitionAppointment(payload.appointmentId, payload.status, { initiatedBy, note: payload.note });
    return { ok: true };
  }

  if (payload.action === 'charge') {
    if (payload.target === 'service_remaining_balance') {
      const event = await chargeRemainingServiceBalanceOnFile({
        appointmentId: payload.appointmentId,
        initiatedBy,
        note: payload.note,
      });
      return { ok: true, event };
    }

    const amountDollars = payload.amountDollars ?? payload.amount;
    const percentOverride = payload.percentOverride ?? payload.percent;
    const event = await chargeAppointment({
      appointmentId: payload.appointmentId,
      target: payload.target,
      amountDollars,
      percentOverride,
      initiatedBy,
      note: payload.note,
    });
    return { ok: true, event };
  }

  if (payload.action === 'refund') {
    const event = await refundAppointment({
      appointmentId: payload.appointmentId,
      target: payload.target,
      percentOverride: payload.percentOverride ?? payload.percent,
      amountDollars: payload.amountDollars ?? payload.amount,
      initiatedBy,
      note: payload.note,
    });
    return { ok: true, event };
  }

  if (payload.action === 'apply_payment') {
    const record = await applyManualAppointmentPayment({
      appointmentId: payload.appointmentId,
      amountDollars: payload.amountDollars ?? payload.amount,
      tipDollars: payload.tipDollars ?? payload.tip,
      paymentMethod: payload.paymentMethod,
      paymentDirection: payload.paymentDirection || 'payment',
      externalReference: payload.externalReference,
      note: payload.note,
      createdBy: context.email || initiatedBy,
    });
    return { ok: true, record };
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

  if (payload.action === 'create_additional_availability') {
    const { error } = await supabaseAdmin.from('additional_availability').insert({
      start_at: payload.startAt,
      end_at: payload.endAt,
      note: payload.note || null,
    });
    if (error) throw error;
    return { ok: true };
  }

  if (payload.action === 'delete_additional_availability') {
    await supabaseAdmin.from('additional_availability').delete().eq('id', payload.availabilityId);
    return { ok: true };
  }

  console.warn('[admin-appointments] unsupported action', { action: payload.action });
  throw new Error(`Unsupported action: ${payload.action || 'missing'}`);
}

export const handler = async (event) => {
  try {
    const authContext = await authorizeAdminRequest(event);
    if (authContext?.response) return authContext.response;

    ensureServerConfig();

    if (event.httpMethod === 'GET') {
      const q = event.queryStringParameters || {};

      if (q.archives === '1') {
        return json(200, { archives: await listArchivedAppointments() });
      }

      if (q.archive) {
        const archive = await downloadArchivedAppointment(q.archive);
        if (!archive) return json(404, { error: 'Archive not found' });
        return csvResponse(archive.file_name, archive.csv_content);
      }

      if (q.payments === '1') {
        const exportFile = await exportPaymentsCsv();
        return csvResponse(exportFile.fileName, exportFile.csvContent);
      }

      const { data: appointments, error: appointmentsError } = await supabaseAdmin
        .from('appointments')
        .select('*, customers(*), appointment_services(*), appointment_financial_events(*), appointment_payment_records(*), client_messages(*)')
        .is('archived_at', null)
        .order('start_at', { ascending: true });
      if (appointmentsError) throw appointmentsError;

      const { data: customers, error: customersError } = await supabaseAdmin
        .from('customers')
        .select('*, customer_notes(*)')
        .order('updated_at', { ascending: false });
      if (customersError) throw customersError;

      const { data: blockedTimes, error: blockedTimesError } = await supabaseAdmin
        .from('blocked_times')
        .select('*')
        .order('start_at', { ascending: true });
      if (blockedTimesError) throw blockedTimesError;

      const { data: additionalAvailability, error: additionalAvailabilityError } = await supabaseAdmin
        .from('additional_availability')
        .select('*')
        .order('start_at', { ascending: true });
      if (additionalAvailabilityError) throw additionalAvailabilityError;

      return json(200, {
        appointments: appointments || [],
        customers: customers || [],
        blockedTimes: blockedTimes || [],
        additionalAvailability: additionalAvailability || [],
      });
    }

    if (event.httpMethod === 'POST') {
      const payload = JSON.parse(event.body || '{}');
      const result = await handleAppointmentAction(payload, authContext);
      return json(200, result);
    }

    return json(405, { error: 'Method not allowed' });
  } catch (error) {
    return json(500, { error: error.message });
  }
};
