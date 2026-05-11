import { supabaseAdmin } from './supabaseAdmin.js';
import { BOOKING_LINK } from './config.js';
import { canSendSms, logSmsSkipped, sendSms } from './notifications.js';
import {
  sendBookingCancelledEmail,
  sendBookingConfirmedEmail,
  sendBookingDeclinedEmail,
  sendBookingExpiredEmail,
  sendChargeAppliedEmail,
  sendRefundIssuedEmail,
} from './email.js';
import { formatDuration } from './time.js';
import { chargeCardOnFile, refundPayment } from './square.js';
import { createHash } from 'node:crypto';

const PAYMENT_TARGET = {
  service: { chargeType: 'service_charge', refundType: 'refund_service', statusField: 'service_payment_status' },
  late: { chargeType: 'late_fee', refundType: 'refund_late', statusField: 'late_fee_status' },
  no_show: { chargeType: 'no_show_fee', refundType: 'refund_no_show', statusField: 'no_show_fee_status' },
};

function dollarsToCents(value) {
  return Math.round(Number(value || 0) * 100);
}

function centsToDollars(cents) {
  return Number(cents || 0) / 100;
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatBookingNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '---';
  return String(numeric).padStart(3, '0').slice(-3);
}

function parseStatus(s) {
  return s || 'unpaid';
}

function combinePaymentStatus(chargedCents, refundedCents) {
  if (chargedCents <= 0) return 'unpaid';
  if (refundedCents <= 0) return 'paid';
  if (refundedCents >= chargedCents) return 'refunded';
  return 'partially_refunded';
}


function buildSquareIdempotencyKey(action, appointmentId, eventType, amountCents, basisValue) {
  const seed = `${action}|${appointmentId}|${eventType}|${amountCents}|${basisValue ?? 'na'}|${Date.now()}`;
  const digest = createHash('sha256').update(seed).digest('hex').slice(0, 24);
  const appointmentToken = String(appointmentId || '').replace(/-/g, '').slice(0, 8) || 'appt';
  return `${action}-${appointmentToken}-${digest}`;
}

async function loadAppointment(appointmentId) {
  const { data: appointment, error } = await supabaseAdmin
    .from('appointments')
    .select('*, customers(*)')
    .eq('id', appointmentId)
    .single();
  if (error) throw error;

  const { data: services } = await supabaseAdmin
    .from('appointment_services')
    .select('service_name_snapshot')
    .eq('appointment_id', appointmentId);

  const { data: financialEvents } = await supabaseAdmin
    .from('appointment_financial_events')
    .select('*')
    .eq('appointment_id', appointmentId)
    .order('created_at', { ascending: false });

  return {
    appointment,
    services: (services || []).map((item) => item.service_name_snapshot),
    financialEvents: financialEvents || [],
  };
}

async function logAudit(appointmentId, actionType, initiatedBy, note, commandText = null) {
  await supabaseAdmin.from('appointment_action_audit').insert({
    appointment_id: appointmentId,
    action_type: actionType,
    initiated_by: initiatedBy,
    command_text: commandText,
    note: note || null,
  });
}

async function notifyCustomerStatus(appointment, services, nextStatus, context = {}) {
  const serviceList = services.join(', ');
  const date = new Date(appointment.start_at).toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' });
  const time = new Date(appointment.start_at).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  const preference = appointment.customers.communication_preference || 'both';

  if (nextStatus === 'confirmed') {
    const sms = context.confirmationMessageOverride
      || `Your appointment with Nails By Brittney is confirmed for ${date} at ${time}, for ${serviceList}. ${appointment.estimated_total_text}. Estimated appointment length: ${formatDuration(appointment.total_duration_minutes)}.`;
    if (canSendSms(preference)) await sendSms(appointment.customers.phone, sms, { type: `booking_${nextStatus}`, preference });
    else logSmsSkipped({ type: `booking_${nextStatus}`, to: appointment.customers.phone, preference, reason: 'preference_not_sms' });
    await sendBookingConfirmedEmail({ customer: appointment.customers, appointment, services });
  }

  if (nextStatus === 'declined') {
    const sms = `Sorry, the appointment time you requested is no longer available. Please choose another available time here: ${BOOKING_LINK}`;
    if (canSendSms(preference)) await sendSms(appointment.customers.phone, sms, { type: `booking_${nextStatus}`, preference });
    else logSmsSkipped({ type: `booking_${nextStatus}`, to: appointment.customers.phone, preference, reason: 'preference_not_sms' });
    await sendBookingDeclinedEmail({ customer: appointment.customers, appointment, services });
  }

  if (nextStatus === 'cancelled') {
    const sms = `Your appointment has been cancelled. Please choose another available time here: ${BOOKING_LINK}`;
    if (canSendSms(preference)) await sendSms(appointment.customers.phone, sms, { type: `booking_${nextStatus}`, preference });
    else logSmsSkipped({ type: `booking_${nextStatus}`, to: appointment.customers.phone, preference, reason: 'preference_not_sms' });
    await sendBookingCancelledEmail({ customer: appointment.customers, appointment, services });
  }

  if (nextStatus === 'expired') {
    const sms = `Your appointment request could not be confirmed in time and has been released. Please choose another available time here: ${BOOKING_LINK}`;
    if (canSendSms(preference)) await sendSms(appointment.customers.phone, sms, { type: `booking_${nextStatus}`, preference });
    else logSmsSkipped({ type: `booking_${nextStatus}`, to: appointment.customers.phone, preference, reason: 'preference_not_sms' });
    await sendBookingExpiredEmail({ customer: appointment.customers, appointment, services });
  }
}

export async function transitionAppointment(appointmentId, nextStatus, context = {}) {
  const { appointment, services } = await loadAppointment(appointmentId);
  const nowIso = new Date().toISOString();

  const patch = { status: nextStatus, updated_at: nowIso };
  if (nextStatus === 'declined' || nextStatus === 'cancelled') {
    patch.cancelled_at = nowIso;
  }

  await supabaseAdmin.from('appointments').update(patch).eq('id', appointmentId);
  await logAudit(appointmentId, `status_${nextStatus}`, context.initiatedBy || 'dashboard', context.note, context.commandText || null);
  await notifyCustomerStatus(appointment, services, nextStatus, context);
}

async function getNetTotals(appointmentId, type) {
  const { data: events } = await supabaseAdmin
    .from('appointment_financial_events')
    .select('event_type, amount_cents, status')
    .eq('appointment_id', appointmentId)
    .in('event_type', [type.chargeType, type.refundType])
    .eq('status', 'succeeded');

  const charged = (events || []).filter((item) => item.event_type === type.chargeType).reduce((sum, item) => sum + finiteNumber(item.amount_cents), 0);
  const refunded = (events || []).filter((item) => item.event_type === type.refundType).reduce((sum, item) => sum + finiteNumber(item.amount_cents), 0);

  return { charged, refunded };
}

async function updatePaymentStatusFields(appointmentId, key) {
  const type = PAYMENT_TARGET[key];
  const { charged, refunded } = await getNetTotals(appointmentId, type);
  const status = combinePaymentStatus(charged, refunded);
  await supabaseAdmin.from('appointments').update({ [type.statusField]: status, updated_at: new Date().toISOString() }).eq('id', appointmentId);
}

async function createFinancialEvent(params) {
  const payload = {
    appointment_id: params.appointmentId,
    event_type: params.eventType,
    amount_cents: params.amountCents,
    percent_basis: params.percentBasis ?? null,
    processor_reference: params.processorReference || null,
    status: params.status || 'succeeded',
    initiated_by: params.initiatedBy,
    note: params.note || null,
    command_source: params.commandSource || null,
    idempotency_key: params.idempotencyKey,
    related_event_id: params.relatedEventId || null,
  };

  const { error } = await supabaseAdmin.from('appointment_financial_events').insert(payload);
  if (error && error.code === '23505') {
    const { data: existing } = await supabaseAdmin
      .from('appointment_financial_events')
      .select('*')
      .eq('idempotency_key', params.idempotencyKey)
      .single();
    return existing;
  }
  if (error) throw error;

  const { data: row } = await supabaseAdmin
    .from('appointment_financial_events')
    .select('*')
    .eq('idempotency_key', params.idempotencyKey)
    .single();
  return row;
}

async function assertChargeEligibility(appointment, target, allowAdditionalServiceCharge = false) {
  const startMs = new Date(appointment.start_at).getTime();
  const nowMs = Date.now();

  if (target === 'late') {
    if (!['cancelled', 'declined'].includes(appointment.status)) {
      throw new Error('Late fee is only allowed for declined/cancelled appointments.');
    }
    if (!appointment.cancelled_at) {
      throw new Error('Late fee cannot be assessed because cancellation time is not recorded.');
    }
    const cancelledMs = new Date(appointment.cancelled_at).getTime();
    const diff = startMs - cancelledMs;
    if (diff <= 0 || diff > (24 * 60 * 60 * 1000)) {
      throw new Error('Late fee is only allowed when cancellation occurred less than 24 hours before appointment start.');
    }
  }

  if (target === 'no_show') {
    if (appointment.status !== 'no_show') {
      throw new Error('No-show fee is only allowed when appointment status is no_show.');
    }
    if (nowMs < startMs) {
      throw new Error('No-show fee cannot be charged before the appointment start time.');
    }
  }

  if (target === 'service' && !allowAdditionalServiceCharge) {
    const { data: priorService } = await supabaseAdmin
      .from('appointment_financial_events')
      .select('id')
      .eq('appointment_id', appointment.id)
      .eq('event_type', 'service_charge')
      .eq('status', 'succeeded')
      .limit(1);

    if (priorService?.length) {
      throw new Error('Service charge already exists for this appointment. Explicit override is required for an additional service charge.');
    }
  }
}

export async function chargeAppointment({
  appointmentId,
  target,
  amountDollars,
  percentOverride,
  initiatedBy = 'dashboard',
  note,
  commandText,
  allowAdditionalServiceCharge = false,
}) {
  const type = PAYMENT_TARGET[target];
  if (!type) {
    console.warn('[bookingActions] unsupported charge target', { appointmentId, target });
    throw new Error(`Invalid charge target: ${target || 'missing'}.`);
  }

  const { appointment } = await loadAppointment(appointmentId);
  if (!appointment.customers.square_card_id || appointment.customers.card_on_file_status !== 'on_file') {
    throw new Error('Customer does not have an active card on file.');
  }

  await assertChargeEligibility(appointment, target, allowAdditionalServiceCharge);

  const estimate = finiteNumber(appointment.estimated_total_min);
  let percentBasis = null;
  let dollars = finiteNumber(amountDollars);

  if (!dollars) {
    if (target === 'late') percentBasis = finiteNumber(percentOverride ?? 25);
    if (target === 'no_show') percentBasis = finiteNumber(percentOverride ?? 50);
    if (!percentBasis) {
      console.warn('[bookingActions] missing charge amount', { appointmentId, target, amountDollars, percentOverride });
      throw new Error(target === 'service' ? 'Amount is required for service charges.' : 'Fee percentage is required for this charge.');
    }
    dollars = (estimate * percentBasis) / 100;
  }

  const amountCents = dollarsToCents(dollars);
  if (amountCents <= 0) {
    console.warn('[bookingActions] non-positive charge amount', { appointmentId, target, amountDollars, percentOverride, estimate, amountCents });
    throw new Error('Charge amount must be greater than zero.');
  }

  const idempotencyKey = buildSquareIdempotencyKey(
    'charge',
    appointmentId,
    type.chargeType,
    amountCents,
    percentBasis ?? 'custom',
  );

  const charge = await chargeCardOnFile({
    appointmentId,
    squareCustomerId: appointment.customers.square_customer_id,
    squareCardId: appointment.customers.square_card_id,
    amountCents,
    note: note || `${type.chargeType} for appointment #${formatBookingNumber(appointment.booking_request_number)}`,
    idempotencyKey,
  });

  const event = await createFinancialEvent({
    appointmentId,
    eventType: type.chargeType,
    amountCents,
    percentBasis,
    processorReference: charge.paymentId,
    status: 'succeeded',
    initiatedBy,
    note,
    commandSource: commandText,
    idempotencyKey,
  });

  await updatePaymentStatusFields(appointmentId, target);
  await logAudit(appointmentId, `charge_${target}`, initiatedBy, note, commandText || null);

  const { services } = await loadAppointment(appointmentId);
  const preference = appointment.customers.communication_preference || 'both';
  await sendChargeAppliedEmail({
    customer: appointment.customers,
    appointment,
    services,
    amountCents,
  });

  return event;
}

export async function refundAppointment({ appointmentId, target, percentOverride, amountDollars, initiatedBy = 'dashboard', note, commandText }) {
  const type = PAYMENT_TARGET[target];
  if (!type) {
    console.warn('[bookingActions] unsupported refund target', { appointmentId, target });
    throw new Error(`Invalid refund target: ${target || 'missing'}.`);
  }

  const { data: chargeEvents } = await supabaseAdmin
    .from('appointment_financial_events')
    .select('*')
    .eq('appointment_id', appointmentId)
    .eq('event_type', type.chargeType)
    .eq('status', 'succeeded')
    .order('created_at', { ascending: true });

  if (!chargeEvents?.length) throw new Error('No succeeded charge exists to refund for this target.');

  const totalCharged = chargeEvents.reduce((sum, item) => sum + finiteNumber(item.amount_cents), 0);

  const { data: refunds } = await supabaseAdmin
    .from('appointment_financial_events')
    .select('amount_cents')
    .eq('appointment_id', appointmentId)
    .eq('event_type', type.refundType)
    .eq('status', 'succeeded');

  const alreadyRefunded = (refunds || []).reduce((sum, item) => sum + finiteNumber(item.amount_cents), 0);
  const refundable = totalCharged - alreadyRefunded;
  if (refundable <= 0) throw new Error('This target has already been fully refunded.');

  let refundCents = refundable;
  if (amountDollars !== undefined && amountDollars !== null && amountDollars !== '') {
    refundCents = Math.round(finiteNumber(amountDollars) * 100);
  } else if (percentOverride !== undefined && percentOverride !== null) {
    refundCents = Math.round(refundable * (finiteNumber(percentOverride) / 100));
  }

  if (refundCents <= 0) throw new Error('Refund amount must be greater than zero.');
  if (refundCents > refundable) throw new Error('Refund amount cannot exceed the refundable balance.');

  const latestCharge = [...chargeEvents].reverse().find((item) => item.processor_reference);
  if (!latestCharge) throw new Error('Cannot refund because no processor payment reference was stored for the original charge.');

  const idempotencyKey = buildSquareIdempotencyKey(
    'refund',
    appointmentId,
    type.refundType,
    refundCents,
    percentOverride ?? 'full',
  );

  const refund = await refundPayment({
    paymentId: latestCharge.processor_reference,
    amountCents: refundCents,
    reason: note || `${type.refundType} for appointment ${appointmentId}`,
    idempotencyKey,
  });

  const event = await createFinancialEvent({
    appointmentId,
    eventType: type.refundType,
    amountCents: refundCents,
    percentBasis: percentOverride ?? null,
    processorReference: refund.refundId,
    status: 'succeeded',
    initiatedBy,
    note,
    commandSource: commandText,
    relatedEventId: latestCharge.id,
    idempotencyKey,
  });

  await updatePaymentStatusFields(appointmentId, target);
  await logAudit(appointmentId, `refund_${target}`, initiatedBy, note, commandText || null);

  const { appointment, services } = await loadAppointment(appointmentId);
  const preference = appointment.customers.communication_preference || 'both';
  await sendRefundIssuedEmail({
    customer: appointment.customers,
    appointment,
    services,
    amountCents: refundCents,
  });

  return event;
}

export async function getAppointmentStatusSummaryByRequestNumber(requestNumber) {
  const { data: appointment } = await supabaseAdmin
    .from('appointments')
    .select('*, customers(*)')
    .eq('booking_request_number', requestNumber)
    .is('archived_at', null)
    .maybeSingle();

  if (!appointment) return null;

  const { data: events } = await supabaseAdmin
    .from('appointment_financial_events')
    .select('*')
    .eq('appointment_id', appointment.id)
    .eq('status', 'succeeded')
    .order('created_at', { ascending: false });

  const refunded = (events || []).filter((eventItem) => eventItem.event_type.startsWith('refund_')).reduce((sum, row) => sum + finiteNumber(row.amount_cents), 0);
  const charged = (events || []).filter((eventItem) => !eventItem.event_type.startsWith('refund_')).reduce((sum, row) => sum + finiteNumber(row.amount_cents), 0);

  const when = new Date(appointment.start_at).toLocaleString('en-US', { timeZone: 'America/New_York' });

  return {
    appointmentId: appointment.id,
    requestNumber: formatBookingNumber(appointment.booking_request_number),
    customerName: `${appointment.customers.first_name} ${appointment.customers.last_name}`,
    dateTime: when,
    appointmentStatus: appointment.status,
    cardOnFile: appointment.customers.card_on_file_status === 'on_file' ? 'yes' : 'no',
    estimatedTotal: appointment.estimated_total_text,
    servicePaymentStatus: parseStatus(appointment.service_payment_status),
    lateFeeStatus: parseStatus(appointment.late_fee_status),
    noShowFeeStatus: parseStatus(appointment.no_show_fee_status),
    totalCharged: centsToDollars(charged).toFixed(2),
    totalRefunded: centsToDollars(refunded).toFixed(2),
    financialEvents: events || [],
  };
}

export function formatStatusSummary(summary) {
  if (!summary) return 'Appointment not found.';
  return [
    `#${summary.requestNumber} ${summary.customerName}`,
    `When: ${summary.dateTime}`,
    `Status: ${summary.appointmentStatus}`,
    `Card on file: ${summary.cardOnFile}`,
    `Estimated: ${summary.estimatedTotal}`,
    `Service payment: ${summary.servicePaymentStatus}`,
    `Late fee: ${summary.lateFeeStatus}`,
    `No-show fee: ${summary.noShowFeeStatus}`,
    `Charged: $${summary.totalCharged}`,
    `Refunded: $${summary.totalRefunded}`,
  ].join(' | ');
}
