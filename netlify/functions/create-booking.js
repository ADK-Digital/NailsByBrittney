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

async function findAppointmentByIdempotencyKey(idempotencyKey) {
  if (!idempotencyKey?.trim()) return null;

  const { data, error } = await supabaseAdmin
    .from('appointments')
    .select(`
      id,
      booking_request_number,
      estimated_total_text,
      total_duration_minutes,
      customers (
        first_name,
        last_name,
        phone,
        card_on_file_status
      )
    `)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function fetchAppointmentServices(appointmentId) {
  const { data: appointmentServices } = await supabaseAdmin
    .from('appointment_services')
    .select('service_name_snapshot')
    .eq('appointment_id', appointmentId);

  return (appointmentServices || []).map((service) => service.service_name_snapshot);
}

async function buildBookingResponse(appointment) {
  return {
    appointmentId: appointment.id,
    requestNumber: appointment.booking_request_number,
    pendingMessage:
      'Your appointment request is pending for your selected time. You will be notified based on your communication preference once your appointment is confirmed or canceled.',
    estimatedTotalText: appointment.estimated_total_text,
    estimatedDurationText: formatDuration(appointment.total_duration_minutes),
    cardOnFileStatus: appointment.customers?.card_on_file_status || 'unknown',
  };
}

async function logOrphanedSquareArtifacts({ payload, squareCustomerId, squareCardId, reason, cleanupAttempted, cleanedUp }) {
  const auditPayload = {
    first_name: payload.firstName?.trim() || null,
    last_name: payload.lastName?.trim() || null,
    email: normalizeEmail(payload.email || ''),
    phone: payload.phone || null,
    square_customer_id: squareCustomerId || null,
    square_card_id: squareCardId || null,
    failure_reason: reason,
    cleanup_attempted: cleanupAttempted,
    cleanup_succeeded: cleanedUp,
  };

  console.error('booking_square_orphan', {
    ...auditPayload,
    customer_cleanup_supported: false,
    customer_cleanup_note: squareCustomerId && !squareCardId
      ? 'Square customer cleanup is not automated in this flow; customer artifact may remain orphaned.'
      : null,
  });

  try {
    await supabaseAdmin.from('booking_intake_audit').insert(auditPayload);
  } catch (auditError) {
    console.error('booking_square_orphan_audit_insert_failed', { message: auditError.message, auditPayload });
  }
}

async function cleanupAndLogOrphan({ payload, squareCustomerId, squareCardId, failureReason, stage }) {
  let cleanedUp = false;
  const cleanupAttempted = Boolean(squareCardId);

  if (squareCardId) {
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
  }

  const reason = `[${stage}] ${failureReason}${
    squareCustomerId && !squareCardId
      ? ' | customer created but card setup failed; customer cleanup is not automated and may remain orphaned.'
      : ''
  }`;

  await logOrphanedSquareArtifacts({
    payload,
    squareCustomerId,
    squareCardId,
    reason,
    cleanupAttempted,
    cleanedUp,
  });
}

function bookingCardIdempotencyKey(bookingIdempotencyKey) {
  const normalized = String(bookingIdempotencyKey || '').trim();
  if (!normalized) throw new Error('Idempotency key is required.');

  // Square idempotency keys must be <= 45 chars.
  return `bk-card-${normalized}`.slice(0, 45);
}

async function validateAddonSelection(serviceIds) {
  const { data: services, error } = await supabaseAdmin
    .from('services')
    .select('id,type,requires_service_ids')
    .in('id', serviceIds)
    .eq('active', true);

  if (error) throw error;
  if (!services?.length) return;

  const selectedIds = new Set(services.map((service) => service.id));
  const hasInvalidAddon = services.some((service) => {
    if (service.type !== 'addon') return false;
    const requiredIds = Array.isArray(service.requires_service_ids) ? service.requires_service_ids : [];
    if (!requiredIds.length) return false;
    return !requiredIds.some((id) => selectedIds.has(id));
  });

  if (hasInvalidAddon) {
    throw new Error('Design and removal services must be booked with a manicure or pedicure service.');
  }
}

export const handler = async (event) => {
  let payload = null;
  let createdSquareCustomerId = null;
  let createdSquareCardId = null;
  let squareSetupStage = null;

  try {
    ensureServerConfig();
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

    payload = JSON.parse(event.body || '{}');
    const { errors, phone, email } = validateBookingInput(payload);
    if (Object.keys(errors).length) return json(400, { errors });

    const existingAppointment = await findAppointmentByIdempotencyKey(payload.idempotencyKey);
    if (existingAppointment) {
      const existingResponse = await buildBookingResponse(existingAppointment);
      return json(200, existingResponse);
    }

    const startAt = localDateTimeToUtcIso(payload.date, payload.time);
    await validateAddonSelection(payload.serviceIds);

    const matchedIdentity = await findMatchedCustomerIdentity({
      firstName: payload.firstName.trim(),
      lastName: payload.lastName.trim(),
      email,
      phone,
    });

    squareSetupStage = 'square_customer';
    const squareCustomer = await ensureSquareCustomer({
      existingSquareCustomerId: matchedIdentity?.square_customer_id,
      firstName: payload.firstName.trim(),
      lastName: payload.lastName.trim(),
      email,
      phone,
      customerId: matchedIdentity?.customer_id || crypto.randomUUID(),
      idempotencyKey: `bk-customer-${String(payload.idempotencyKey || '').trim()}`.slice(0, 45),
    });

    createdSquareCustomerId = squareCustomer.squareCustomerId;

    squareSetupStage = 'square_card';
    const card = await storeCardOnFile({
      squareCustomerId: squareCustomer.squareCustomerId,
      cardToken: payload.squareCardToken,
      idempotencyKey: bookingCardIdempotencyKey(payload.idempotencyKey),
    });

    createdSquareCardId = card.cardId;
    const communicationPreference = payload.communicationPreference || 'both';

    squareSetupStage = 'booking_rpc';
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
        stage: squareSetupStage,
      });

      if (error.message.includes('appointments_no_overlap')) {
        return json(409, { error: 'Sorry, that time is no longer available.' });
      }
      return json(400, { error: error.message });
    }

    const { data: appointment } = await supabaseAdmin
      .from('appointments')
      .select('id,booking_request_number,estimated_total_text,total_duration_minutes,customers(first_name,last_name,phone,card_on_file_status)')
      .eq('id', data.appointment_id)
      .single();

    const responseBody = await buildBookingResponse(appointment);
    const serviceList = (await fetchAppointmentServices(appointment.id)).join(', ');
    const body = `appointment request #${appointment.booking_request_number}: Customer ${appointment.customers.first_name} ${appointment.customers.last_name}. Phone number ${appointment.customers.phone}. Service(s): ${serviceList}. Estimated revenue: ${appointment.estimated_total_text}. Reply "yes ${appointment.booking_request_number}" to confirm or "no ${appointment.booking_request_number}" to cancel.`;
    await notifyBrittney(body);

    return json(200, {
      ...responseBody,
      cardOnFileStatus: card.status,
    });
  } catch (error) {
    if (payload && createdSquareCustomerId) {
      await cleanupAndLogOrphan({
        payload,
        squareCustomerId: createdSquareCustomerId,
        squareCardId: createdSquareCardId,
        failureReason: error.message,
        stage: squareSetupStage || 'unexpected',
      });
    }
    return json(500, { error: error.message });
  }
};
