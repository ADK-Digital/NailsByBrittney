import { json, ensureServerConfig, supabaseAdmin } from './_lib/supabaseAdmin.js';
import {
  transitionAppointment,
  chargeAppointment,
  refundAppointment,
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
  if (allowAdminAuthBypass()) return null;

  const token = getBearerToken(event);
  if (!token) return json(401, { error: 'Unauthorized' });

  ensureServerConfig();
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  const email = data?.user?.email?.trim().toLowerCase();
  if (error || !data?.user || !email) return json(401, { error: 'Unauthorized' });

  const allowedEmails = getAllowedAdminEmails();
  if (!allowedEmails.includes(email)) return json(403, { error: 'Forbidden' });

  return null;
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

async function handleAppointmentAction(payload) {
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
    const amountDollars = payload.amountDollars ?? payload.amount;
    const percentOverride = payload.percentOverride ?? payload.percent;
    console.log('[admin-appointments] charge routing', {
      appointmentId: payload.appointmentId,
      target: payload.target,
      hasAmount: amountDollars !== undefined && amountDollars !== null && amountDollars !== '',
      percentOverride,
    });
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

  console.warn('[admin-appointments] unsupported action', { action: payload.action });
  throw new Error(`Unsupported action: ${payload.action || 'missing'}`);
}

export const handler = async (event) => {
  try {
    const authResponse = await authorizeAdminRequest(event);
    if (authResponse) return authResponse;

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

      const { data: appointments } = await supabaseAdmin
        .from('appointments')
        .select('*, customers(*), appointment_services(*), appointment_financial_events(*)')
        .is('archived_at', null)
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
