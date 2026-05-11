import { supabaseAdmin } from './supabaseAdmin.js';
import { sendEmail } from './email.js';
import { canSendEmail, canSendSms, logSmsSkipped, sendSms } from './notifications.js';


function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeChannel(flags) {
  if (flags.sms && flags.email) return 'both';
  if (flags.sms) return 'sms';
  if (flags.email) return 'email';
  return 'none';
}

export async function logClientMessage({ customerId, appointmentId = null, direction, channel, body, source = 'dashboard', status = 'sent' }) {
  const { data, error } = await supabaseAdmin
    .from('client_messages')
    .insert({
      customer_id: customerId,
      appointment_id: appointmentId,
      direction,
      channel,
      body,
      source,
      status,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function listClientMessages({ customerId, appointmentId = null, limit = 80 }) {
  let query = supabaseAdmin
    .from('client_messages')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (appointmentId) {
    query = query.or(`appointment_id.eq.${appointmentId},appointment_id.is.null`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return [...(data || [])].reverse();
}

export async function sendAdminClientMessage({ customer, appointment = null, body, source = 'dashboard' }) {
  const cleanBody = String(body || '').trim();
  if (!cleanBody) throw new Error('Message is required.');
  if (!customer?.id) throw new Error('Customer is required.');

  const preference = customer.communication_preference || 'both';
  const sent = { sms: false, email: false };
  const failures = [];

  if (canSendSms(preference)) {
    try {
      sent.sms = Boolean(await sendSms(customer.phone, cleanBody, { type: 'admin_client_message', preference }));
      if (!sent.sms) failures.push('SMS: failed');
    } catch (error) {
      failures.push(`SMS: ${error.message || 'failed'}`);
    }
  } else {
    logSmsSkipped({ type: 'admin_client_message', to: customer.phone || null, preference, reason: 'preference_not_sms' });
  }

  if (canSendEmail(preference)) {
    try {
      if (!customer.email) throw new Error('missing_customer_email');
      const subject = appointment?.booking_request_number
        ? `Message about your Nails by Brittney appointment #${String(appointment.booking_request_number).padStart(3, '0').slice(-3)}`
        : 'Message from Nails by Brittney';
      const safeBody = escapeHtml(cleanBody).replace(/\n/g, '<br />');
      const ok = await sendEmail({
        type: 'client_message',
        to: customer.email,
        subject,
        text: cleanBody,
        html: `<!doctype html><html><body><p>Hi ${escapeHtml(customer.first_name || 'there')},</p><p>${safeBody}</p><p>Thank you,<br/>Nails by Brittney</p></body></html>`,
      });
      sent.email = Boolean(ok);
      if (!ok) failures.push('Email: failed');
    } catch (error) {
      failures.push(`Email: ${error.message || 'failed'}`);
    }
  }

  const channel = normalizeChannel(sent);
  const status = channel === 'none' ? 'failed' : failures.length ? 'partial' : 'sent';
  const message = await logClientMessage({
    customerId: customer.id,
    appointmentId: appointment?.id || null,
    direction: 'admin_to_customer',
    channel,
    body: cleanBody,
    source,
    status,
  });

  return { message, sent, failures };
}
