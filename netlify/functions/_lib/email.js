import { BOOKING_LINK } from './config.js';
import { formatDuration } from './time.js';

const DEFAULT_FROM = process.env.RESEND_FROM_EMAIL || 'bookings@nailsbybrittney.com';
const BRAND_NAME = 'Nails by Brittney';
const SUPPORT_TEXT_PHONE = '(518) 729-7251';

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

function centsToDollarsText(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
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

function getLogoUrl() {
  const base = (process.env.BOOKING_PUBLIC_BASE_URL || '').trim();
  if (!base) return null;
  return `${base.replace(/\/$/, '')}/images/logo.png`;
}

function buildTemplate({ heading, greetingName, introLine, detailLines = [], closingLine }) {
  const logoUrl = getLogoUrl();
  const greeting = greetingName ? `Hi ${greetingName},` : 'Hi there,';
  const htmlLines = [introLine, ...detailLines, closingLine].filter(Boolean).map((line) => `<p style="margin:0 0 12px;color:#222;font-size:15px;line-height:1.5;">${line}</p>`).join('');

  return {
    text: [greeting, heading, introLine, ...detailLines, closingLine, 'Reply YES to confirm your appointment.', 'Reply NO to decline.', `For faster response, text us at ${SUPPORT_TEXT_PHONE}.`].filter(Boolean).join('\n\n'),
    html: `<!doctype html>
<html>
  <body style="margin:0;padding:20px;background:#f9f9f9;font-family:Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
      <div style="text-align:center;padding:24px 20px 12px;">
        ${logoUrl ? `<img src="${logoUrl}" alt="${BRAND_NAME} logo" style="max-width:150px;height:auto;display:block;margin:0 auto 12px;" />` : ''}
        <h1 style="margin:0;color:#111;font-size:22px;font-weight:700;">${BRAND_NAME}</h1>
      </div>
      <div style="padding:12px 24px 8px;">
        <p style="margin:0 0 12px;color:#222;font-size:15px;line-height:1.5;">${greeting}</p>
        <h2 style="margin:0 0 16px;color:#111;font-size:19px;">${heading}</h2>
        ${htmlLines}
      </div>
      <div style="border-top:1px solid #ececec;padding:16px 24px 24px;color:#555;font-size:14px;line-height:1.5;">
        <p style="margin:0 0 8px;">Reply YES to confirm your appointment.</p>
        <p style="margin:0 0 8px;">Reply NO to decline.</p>
        <p style="margin:0 0 8px;">For faster response, text us at ${SUPPORT_TEXT_PHONE}.</p>
        <p style="margin:10px 0 0;">Thank you,<br/>${BRAND_NAME}</p>
      </div>
    </div>
  </body>
</html>`,
  };
}

async function sendWithResend({ type, to, subject, text, html }) {
  if (!process.env.RESEND_API_KEY || !to) {
    console.log('email_skipped', { type, to, reason: !to ? 'missing_recipient' : 'missing_resend_api_key' });
    return false;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: DEFAULT_FROM, to, subject, text, html }),
    });

    if (!response.ok) {
      const message = await response.text();
      console.error('email_send_failed', { type, to, status: response.status, message });
      return false;
    }

    console.log('email_send_succeeded', { type, to });
    return true;
  } catch (error) {
    console.error('email_send_failed', { type, to, message: error.message });
    return false;
  }
}

async function sendBookingEmail({ type, to, preference, subject, heading, greetingName, introLine, detailLines, closingLine }) {
  if (!to) return;
  if (preference === 'sms_only') return;

  const { text, html } = buildTemplate({ heading, greetingName, introLine, detailLines, closingLine });
  await sendWithResend({ type, to, subject, text, html });
}

export async function sendBookingCreatedEmail({ customer, appointment, services }) {
  const details = createAppointmentSummary({ appointment, services });
  await sendBookingEmail({
    type: 'booking_created',
    to: customer.email,
    preference: customer.communication_preference,
    subject: 'Your Nails by Brittney booking request is pending',
    heading: 'Thanks for your request!',
    greetingName: customer.first_name,
    introLine: `Your appointment for ${details.dateTime} is pending confirmation.`,
    detailLines: [`Services booked: ${details.serviceList}.`, `Estimated total: ${details.estimatedTotal}.`, `Estimated duration: ${details.estimatedDuration}.`],
    closingLine: 'We will follow up as soon as your appointment is reviewed.',
  });
}

export async function sendBookingConfirmedEmail({ customer, appointment, services }) {
  const details = createAppointmentSummary({ appointment, services });
  await sendBookingEmail({
    type: 'appointment_confirmed',
    to: customer.email,
    preference: customer.communication_preference,
    subject: 'Your Nails by Brittney Appointment is Confirmed',
    heading: "You're all set!",
    greetingName: customer.first_name,
    introLine: `Your appointment has been confirmed for ${details.dateTime}.`,
    detailLines: [`Services booked: ${details.serviceList}.`, `Estimated total: ${details.estimatedTotal}.`, `Estimated duration: ${details.estimatedDuration}.`],
  });
}

export async function sendBookingDeclinedEmail({ customer, appointment, services }) {
  const details = createAppointmentSummary({ appointment, services });
  await sendBookingEmail({
    type: 'appointment_declined',
    to: customer.email,
    preference: customer.communication_preference,
    subject: 'Your Appointment Request Could Not Be Confirmed',
    heading: 'We need a new time',
    greetingName: customer.first_name,
    introLine: 'Unfortunately, your requested time is not available. Please choose another time.',
    detailLines: [`Requested appointment: ${details.dateTime}.`, `Services requested: ${details.serviceList}.`, BOOKING_LINK ? `Book a new time here: ${BOOKING_LINK}` : ''],
  });
}

export async function sendBookingCancelledEmail({ customer, appointment, services }) {
  const details = createAppointmentSummary({ appointment, services });
  await sendBookingEmail({
    type: 'appointment_cancelled',
    to: customer.email,
    preference: customer.communication_preference,
    subject: 'Your Nails by Brittney appointment was cancelled',
    heading: 'Appointment cancelled',
    greetingName: customer.first_name,
    introLine: 'Your appointment has been cancelled.',
    detailLines: [`Original appointment: ${details.dateTime}.`, `Services booked: ${details.serviceList}.`, BOOKING_LINK ? `Need a new time? Book here: ${BOOKING_LINK}` : ''],
  });
}

export async function sendChargeAppliedEmail({ customer, appointment, services, amountCents }) {
  const details = createAppointmentSummary({ appointment, services });
  await sendBookingEmail({
    type: 'service_charge_applied',
    to: customer.email,
    preference: customer.communication_preference,
    subject: 'Payment update for your Nails by Brittney appointment',
    heading: 'Payment received',
    greetingName: customer.first_name,
    introLine: `Your card was charged ${centsToDollarsText(amountCents)} for your appointment.`,
    detailLines: [`Appointment: ${details.dateTime}.`, `Services: ${details.serviceList}.`],
  });
}

export async function sendRefundIssuedEmail({ customer, appointment, services, amountCents }) {
  const details = createAppointmentSummary({ appointment, services });
  await sendBookingEmail({
    type: 'refund_issued',
    to: customer.email,
    preference: customer.communication_preference,
    subject: 'Refund update for your Nails by Brittney appointment',
    heading: 'Refund issued',
    greetingName: customer.first_name,
    introLine: `A refund of ${centsToDollarsText(amountCents)} was issued to your card.`,
    detailLines: [`Appointment: ${details.dateTime}.`, `Services: ${details.serviceList}.`],
  });
}

export async function sendBookingExpiredEmail({ customer }) {
  await sendBookingEmail({
    type: 'booking_expired',
    to: customer.email,
    preference: customer.communication_preference,
    subject: 'Your Appointment Request Has Expired',
    heading: 'Booking request expired',
    greetingName: customer.first_name,
    introLine: 'Your appointment request could not be confirmed before the hold window ended, so it has now expired.',
    detailLines: [BOOKING_LINK ? `Please choose another available time here: ${BOOKING_LINK}` : ''],
  });
}
