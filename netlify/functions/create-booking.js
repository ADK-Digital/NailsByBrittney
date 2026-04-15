import { json, ensureServerConfig, supabaseAdmin } from './_lib/supabaseAdmin.js';
import { normalizeEmail, validateBookingInput } from './_lib/validation.js';
import { localDateTimeToUtcIso, formatDuration } from './_lib/time.js';
import { notifyBrittney } from './_lib/notifications.js';
import { disableCardOnFile, ensureSquareCustomer, storeCardOnFile } from './_lib/square.js';

async function findMatchedCustomerIdentity({ firstName, lastName, email, phone }) {
  const { data, error } = await supabaseAdmin.rpc('find_matching_customer_identity', {
    p_first_name: firstName,
    p_last_name: lastName,
    p_email: normalizeEmail(email),
    p_phone: phone,
  });
  if (error) throw error;
  return data?.[0] || null;
}

async function logOrphanedSquareArtifacts({ payload, squareCustomerId, squareCardId, reason, cleanedUp }) {
  const auditPayload = {
    first_name: payload.firstName?.trim() || null,
    last_name: payload.lastName?.trim() || null,
    email: normalizeEmail(payload.email || ''),
    phone: payload.phone || null,
    square_customer_id: squareCustomerId || null,
    square_card_id: squareCardId || null,
    failure_reason: reason,
    cleanup_attempted: Boolean(squareCardId),
    cleanup_succeeded: cleanedUp,
  };

  console.error('booking_square_orphan', auditPayload);
  try {
    await supabaseAdmin.from('booking_intake_audit').insert(auditPayload);
  } catch (auditError) {
    console.error('booking_square_orphan_audit_insert_failed', { message: auditError.message, auditPayload });
  }
}

async function cleanupAndLogOrphan({ payload, squareCustomerId, squareCardId, failureReason }) {
  let cleanedUp = false;
  try {
    await disableCardOnFile({ cardId: squareCardId });
    cleanedUp = true;
  } catch (cleanupError) {
    console.error('square_card_cleanup_failed', {
      squareCardId,
      squareCustomerId,
      cleanupError: cleanupError.message,
    });
  }

  await logOrphanedSquareArtifacts({
    payload,
    squareCustomerId,
    squareCardId,
    reason: failureReason,
    cleanedUp,
  });
}

export const handler = async (event) => {
  let payload = null;
  let createdSquareCustomerId = null;
  let createdSquareCardId = null;

  try {
    ensureServerConfig();
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

    payload = JSON.parse(event.body || '{}');
    const { errors, phone, email } = validateBookingInput(payload);
    if (Object.keys(errors).length) return json(400, { errors });

    const startAt = localDateTimeToUtcIso(payload.date, payload.time);

    const matchedIdentity = await findMatchedCustomerIdentity({
      firstName: payload.firstName.trim(),
      lastName: payload.lastName.trim(),
      email,
      phone,
    });

    const squareCustomer = await ensureSquareCustomer({
      existingSquareCustomerId: matchedIdentity?.square_customer_id,
      firstName: payload.firstName.trim(),
      lastName: payload.lastName.trim(),
      email,
      phone,
      customerId: matchedIdentity?.customer_id || crypto.randomUUID(),
    });

    createdSquareCustomerId = squareCustomer.squareCustomerId;

    const card = await storeCardOnFile({
      squareCustomerId: squareCustomer.squareCustomerId,
      cardToken: payload.squareCardToken,
      idempotencyKey: payload.cardIdempotencyKey || payload.idempotencyKey,
    });

    createdSquareCardId = card.cardId;
    const communicationPreference = payload.communicationPreference || 'both';

    const { data, error } = await supabaseAdmin.rpc('create_booking_request', {
      p_first_name: payload.firstName.trim(),
      p_last_name: payload.lastName.trim(),
      p_email: email,
      p_phone: phone,
      p_note: payload.notes || null,
      p_service_ids: payload.serviceIds,
      p_start_at: startAt,
      p_idempotency_key: payload.idempotencyKey,
      p_communication_preference: communicationPreference,
      p_square_customer_id: squareCustomer.squareCustomerId,
      p_square_card_id: card.cardId,
      p_card_brand: card.cardBrand,
      p_card_last4: card.cardLast4,
      p_policy_acknowledged: Boolean(payload.policyAcknowledged),
    });

    if (error) {
      await cleanupAndLogOrphan({
        payload,
        squareCustomerId: createdSquareCustomerId,
        squareCardId: createdSquareCardId,
        failureReason: error.message,
      });

      if (error.message.includes('appointments_no_overlap')) {
        return json(409, { error: 'Sorry, that time is no longer available.' });
      }
      return json(400, { error: error.message });
    }

    const { data: appointment } = await supabaseAdmin
      .from('appointments')
      .select('id,booking_request_number,estimated_total_text,total_duration_minutes,customers(first_name,last_name,phone)')
      .eq('id', data.appointment_id)
      .single();

    const { data: appointmentServices } = await supabaseAdmin
      .from('appointment_services')
      .select('service_name_snapshot')
      .eq('appointment_id', data.appointment_id);

    const serviceList = (appointmentServices || []).map((s) => s.service_name_snapshot).join(', ');
    const body = `appointment request #${appointment.booking_request_number}: Customer ${appointment.customers.first_name} ${appointment.customers.last_name}. Phone number ${appointment.customers.phone}. Service(s): ${serviceList}. Estimated revenue: ${appointment.estimated_total_text}. Reply "yes ${appointment.booking_request_number}" to confirm or "no ${appointment.booking_request_number}" to cancel.`;
    await notifyBrittney(body);

    return json(200, {
      appointmentId: data.appointment_id,
      requestNumber: data.booking_request_number,
      pendingMessage: 'Your appointment request is pending for your selected time. You will be notified based on your communication preference once your appointment is confirmed or canceled.',
      estimatedTotalText: data.estimated_total_text,
      estimatedDurationText: formatDuration(data.total_duration_minutes),
      cardOnFileStatus: card.status,
    });
  } catch (error) {
    if (payload && createdSquareCardId) {
      await cleanupAndLogOrphan({
        payload,
        squareCustomerId: createdSquareCustomerId,
        squareCardId: createdSquareCardId,
        failureReason: error.message,
      });
    }
    return json(500, { error: error.message });
  }
};
