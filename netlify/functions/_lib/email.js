import { BOOKING_LINK } from './config.js';
import { formatDuration } from './time.js';

const DEFAULT_FROM = process.env.RESEND_FROM_EMAIL || 'bookings@nailsbybrittney.com';

function formatAppointmentDateTime(startAt) {
  const dateValue = new Date(startAt);
  const date = dateValue.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const time = dateValue.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${date} at ${time}`;
}

function createAppointmentSummary({ appointment, services }) {
  const serviceList = services?.length ? services.join(', ') : 'Service details unavailable';
  return {
    dateTime: formatAppointmentDateTime(appointment.start_at),
    serviceList,
    estimatedTotal: appointment.estimated_total_text || 'Estimated total unavailable',
    estimatedDuration: formatDuration(appointment.total_duration_minutes),
  };
}

async function sendWithResend({ to, subject, text }) {
  if (!process.env.RESEND_API_KEY || !to) return;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: DEFAULT_FROM,
      to,
      subject,
      text,
    }),
  });
}

async function sendBookingEmail({ to, subject, lines }) {
  await sendWithResend({
    to,
    subject,
    text: lines.filter(Boolean).join('\n\n'),
  });
}

export async function sendBookingConfirmedEmail({ customer, appointment, services }) {
  const details = createAppointmentSummary({ appointment, services });

  await sendBookingEmail({
    to: customer.email,
    subject: 'Your Nails by Brittney Appointment is Confirmed',
    lines: [
      `Hi ${customer.first_name || 'there'},`,
      'Your appointment request has been confirmed.',
      `Appointment date/time: ${details.dateTime}`,
      `Services selected: ${details.serviceList}`,
      `Estimated total: ${details.estimatedTotal}`,
      `Estimated duration: ${details.estimatedDuration}`,
    ],
  });
}

export async function sendBookingDeclinedEmail({ customer }) {
  await sendBookingEmail({
    to: customer.email,
    subject: 'Your Appointment Request Could Not Be Confirmed',
    lines: [
      `Hi ${customer.first_name || 'there'},`,
      'Thank you for your appointment request. Unfortunately, we were not able to confirm the time you selected.',
      BOOKING_LINK ? `Please choose another available time here: ${BOOKING_LINK}` : '',
    ],
  });
}

export async function sendBookingExpiredEmail({ customer }) {
  await sendBookingEmail({
    to: customer.email,
    subject: 'Your Appointment Request Has Expired',
    lines: [
      `Hi ${customer.first_name || 'there'},`,
      'Your appointment request could not be confirmed before the hold window ended, so it has now expired.',
      BOOKING_LINK ? `Please choose another available time here: ${BOOKING_LINK}` : '',
    ],
  });
}
