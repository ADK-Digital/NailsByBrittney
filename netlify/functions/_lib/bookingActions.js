import { supabaseAdmin } from './supabaseAdmin.js';
import { BOOKING_LINK } from './config.js';
import { sendEmail, sendSms } from './notifications.js';
import { formatDuration } from './time.js';

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
  return { appointment, services: (services || []).map((s) => s.service_name_snapshot) };
}

export async function transitionAppointment(appointmentId, nextStatus) {
  const { appointment, services } = await loadAppointment(appointmentId);
  await supabaseAdmin.from('appointments').update({ status: nextStatus, updated_at: new Date().toISOString() }).eq('id', appointmentId);

  const serviceList = services.join(', ');
  const date = new Date(appointment.start_at).toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' });
  const time = new Date(appointment.start_at).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });

  if (nextStatus === 'confirmed') {
    const msg = `Your appointment with Nails By Brittney is confirmed for ${date} at ${time}, for ${serviceList}. ${appointment.estimated_total_text}. Estimated appointment length: ${formatDuration(appointment.total_duration_minutes)}.`;
    await sendSms(appointment.customers.phone, msg);
    await sendEmail(appointment.customers.email, 'Your Nails By Brittney appointment is confirmed', msg);
  }

  if (nextStatus === 'declined' || nextStatus === 'cancelled') {
    const msg = `Sorry, the appointment time you requested is no longer available. Please choose another available time here: ${BOOKING_LINK}`;
    await sendSms(appointment.customers.phone, msg);
    await sendEmail(appointment.customers.email, 'Appointment update from Nails By Brittney', msg);
  }

  if (nextStatus === 'expired') {
    const msg = `Your appointment request could not be confirmed in time and has been released. Please choose another available time here: ${BOOKING_LINK}`;
    await sendSms(appointment.customers.phone, msg);
    await sendEmail(appointment.customers.email, 'Your appointment request expired', msg);
  }
}
