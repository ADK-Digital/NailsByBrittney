import { json, ensureServerConfig, supabaseAdmin } from './_lib/supabaseAdmin.js';
import { validateBookingInput } from './_lib/validation.js';
import { localDateTimeToUtcIso, formatDuration } from './_lib/time.js';
import { notifyBrittney } from './_lib/notifications.js';

export const handler = async (event) => {
  try {
    ensureServerConfig();
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

    const payload = JSON.parse(event.body || '{}');
    const { errors, phone, email } = validateBookingInput(payload);
    if (Object.keys(errors).length) return json(400, { errors });

    const startAt = localDateTimeToUtcIso(payload.date, payload.time);

    const { data, error } = await supabaseAdmin.rpc('create_booking_request', {
      p_first_name: payload.firstName.trim(),
      p_last_name: payload.lastName.trim(),
      p_email: email,
      p_phone: phone,
      p_note: payload.notes || null,
      p_service_ids: payload.serviceIds,
      p_start_at: startAt,
      p_idempotency_key: payload.idempotencyKey,
    });

    if (error) {
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
    const { data: appointmentServices } = await supabaseAdmin.from('appointment_services').select('service_name_snapshot').eq('appointment_id', data.appointment_id);

    const serviceList = (appointmentServices || []).map((s) => s.service_name_snapshot).join(', ');
    const body = `appointment request #${appointment.booking_request_number}: Customer ${appointment.customers.first_name} ${appointment.customers.last_name}. Phone number ${appointment.customers.phone}. Service(s): ${serviceList}. Estimated revenue: ${appointment.estimated_total_text}. Reply "yes ${appointment.booking_request_number}" to confirm or "no ${appointment.booking_request_number}" to cancel.`;
    await notifyBrittney(body);

    return json(200, {
      appointmentId: data.appointment_id,
      requestNumber: data.booking_request_number,
      pendingMessage: 'Your appointment request is pending for your selected time. You will be notified by text and email once your appointment is confirmed or canceled.',
      estimatedTotalText: data.estimated_total_text,
      estimatedDurationText: formatDuration(data.total_duration_minutes),
    });
  } catch (error) {
    return json(500, { error: error.message });
  }
};
