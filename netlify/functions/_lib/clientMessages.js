import { supabaseAdmin } from './supabaseAdmin.js';
import { canSendSms, logSmsSkipped, sendSms } from './notifications.js';


function normalizeSmsChannel(sentSms) {
  return sentSms ? 'sms' : 'none';
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
  const sent = { sms: false };
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
    failures.push('SMS: customer opted out');
  }

  const channel = normalizeSmsChannel(sent.sms);
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
