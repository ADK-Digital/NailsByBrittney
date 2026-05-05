import { Resend } from 'resend';
import { BOOKING_LINK } from './config.js';
import { formatDuration } from './time.js';

const BRAND_NAME = 'Nails by Brittney';
const SUPPORT_TEXT_PHONE = '(518) 729-7251';
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

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
  const htmlLines = [introLine, ...detailLines, closingLine].filter(Boolean).map((line) => `<p>${line}</p>`).join('');

  return {
    text: [greeting, heading, introLine, ...detailLines, closingLine, `Questions? Text us at ${SUPPORT_TEXT_PHONE}.`].filter(Boolean).join('\n\n'),
    html: `<!doctype html>
<html>
  <body>
    ${logoUrl ? `<p><img src="${logoUrl}" alt="${BRAND_NAME} logo" style="max-width:150px;height:auto;" /></p>` : ''}
    <p>${greeting}</p>
    <h2>${heading}</h2>
    ${htmlLines}
    <p>Questions? Text us at ${SUPPORT_TEXT_PHONE}.</p>
    <p>Thank you,<br/>${BRAND_NAME}</p>
  </body>
</html>`,
  };
}

export async function sendEmail({ type, to, subject, html, text }) {
  try {
    if (!resend) {
      console.log('EMAIL SEND', { type, to, success: false, error: 'missing_resend_api_key' });
      return null;
    }
    if (!process.env.RESEND_FROM_EMAIL) {
      console.log('EMAIL SEND', { type, to, success: false, error: 'missing_resend_from_email' });
      return null;
    }
    if (!to) {
      console.log('EMAIL SEND', { type, to, success: false, error: 'missing_recipient' });
      return null;
    }

    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to,
      subject,
      html,
      text: text || ' ',
    });

    if (error) {
      console.log('EMAIL SEND', { type, to, success: false, error: error.message || 'resend_error' });
      return null;
    }

    console.log('EMAIL SEND', { type, to, success: true, error: null });
    return true;
  } catch (err) {
    console.log('EMAIL SEND', { type, to, success: false, error: err?.message || 'unknown_error' });
    return null;
  }
}

async function sendBookingEmail({ type, customer, appointment, subject, heading, introLine, detailLines, closingLine }) {
  try {
    const preference = customer?.communication_preference;
    const shouldSendEmail = preference === 'email' || preference === 'both';

    if (!shouldSendEmail) {
      console.log('EMAIL SEND', { type, to: customer?.email || null, success: false, error: 'preference_not_email' });
      return;
    }

    if (!customer?.email) {
      console.log('EMAIL SEND', { type, to: null, success: false, error: 'missing_customer_email' });
      return;
    }

    if (!appointment?.start_at) {
      console.log('EMAIL SEND', { type, to: customer.email, success: false, error: 'missing_appointment_start_at' });
      return;
    }

    const { text, html } = buildTemplate({
      heading,
      greetingName: customer.first_name,
      introLine,
      detailLines,
      closingLine,
    });

    await sendEmail({ type, to: customer.email, subject, html, text });
  } catch (err) {
    // Intentionally silent: sendEmail handles error logging.
  }
}

export async function sendBookingCreatedEmail({ customer, appointment, services }) {
  const details = createAppointmentSummary({ appointment, services });
  await sendBookingEmail({
    type: 'booking_created',
    customer,
    appointment,
    subject: 'Your Nails by Brittney booking request is pending',
    heading: 'Thanks for your request!',
    introLine: `Your appointment for ${details.dateTime} is pending confirmation.`,
    detailLines: [`Services: ${details.serviceList}.`, `Date/time: ${details.dateTime}.`, `Estimated total: ${details.estimatedTotal}.`, `Estimated duration: ${details.estimatedDuration}.`],
    closingLine: 'We will follow up as soon as your appointment is reviewed.',
  });
}

export async function sendBookingConfirmedEmail({ customer, appointment, services }) {
  const details = createAppointmentSummary({ appointment, services });
  await sendBookingEmail({
    type: 'booking_confirmed',
    customer,
    appointment,
    subject: 'Your Nails by Brittney Appointment is Confirmed',
    heading: "You're all set!",
    introLine: `Your appointment has been confirmed for ${details.dateTime}.`,
    detailLines: [`Services: ${details.serviceList}.`, `Date/time: ${details.dateTime}.`, `Estimated total: ${details.estimatedTotal}.`, `Estimated duration: ${details.estimatedDuration}.`],
  });
}

export async function sendBookingDeclinedEmail({ customer, appointment, services }) {
  const details = createAppointmentSummary({ appointment, services });
  await sendBookingEmail({
    type: 'booking_declined',
    customer,
    appointment,
    subject: 'Your Appointment Request Could Not Be Confirmed',
    heading: 'We need a new time',
    introLine: 'Unfortunately, your requested time is not available. Please choose another time.',
    detailLines: [`Services: ${details.serviceList}.`, `Date/time: ${details.dateTime}.`, `Estimated total: ${details.estimatedTotal}.`, `Estimated duration: ${details.estimatedDuration}.`, BOOKING_LINK ? `Book a new time here: ${BOOKING_LINK}` : ''],
  });
}

export async function sendBookingCancelledEmail({ customer, appointment, services }) {
  const details = createAppointmentSummary({ appointment, services });
  await sendBookingEmail({
    type: 'booking_cancelled',
    customer,
    appointment,
    subject: 'Your Nails by Brittney appointment was cancelled',
    heading: 'Appointment cancelled',
    introLine: 'Your appointment has been cancelled.',
    detailLines: [`Services: ${details.serviceList}.`, `Date/time: ${details.dateTime}.`, `Estimated total: ${details.estimatedTotal}.`, `Estimated duration: ${details.estimatedDuration}.`, BOOKING_LINK ? `Need a new time? Book here: ${BOOKING_LINK}` : ''],
  });
}

export async function sendChargeAppliedEmail({ customer, appointment, services, amountCents }) {
  const details = createAppointmentSummary({ appointment, services });
  await sendBookingEmail({
    type: 'service_charge_applied',
    customer,
    appointment,
    subject: 'Payment update for your Nails by Brittney appointment',
    heading: 'Payment received',
    introLine: `Your card was charged ${centsToDollarsText(amountCents)} for your appointment.`,
    detailLines: [`Services: ${details.serviceList}.`, `Date/time: ${details.dateTime}.`, `Estimated total: ${details.estimatedTotal}.`, `Estimated duration: ${details.estimatedDuration}.`],
  });
}

export async function sendRefundIssuedEmail({ customer, appointment, services, amountCents }) {
  const details = createAppointmentSummary({ appointment, services });
  await sendBookingEmail({
    type: 'refund_issued',
    customer,
    appointment,
    subject: 'Refund update for your Nails by Brittney appointment',
    heading: 'Refund issued',
    introLine: `A refund of ${centsToDollarsText(amountCents)} was issued to your card.`,
    detailLines: [`Services: ${details.serviceList}.`, `Date/time: ${details.dateTime}.`, `Estimated total: ${details.estimatedTotal}.`, `Estimated duration: ${details.estimatedDuration}.`],
  });
}

export async function sendBookingExpiredEmail({ customer, appointment, services }) {
  const details = createAppointmentSummary({ appointment, services });
  await sendBookingEmail({
    type: 'booking_expired',
    customer,
    appointment,
    subject: 'Your Appointment Request Has Expired',
    heading: 'Booking request expired',
    introLine: 'Your appointment request could not be confirmed before the hold window ended, so it has now expired.',
    detailLines: [`Services: ${details.serviceList}.`, `Date/time: ${details.dateTime}.`, `Estimated total: ${details.estimatedTotal}.`, `Estimated duration: ${details.estimatedDuration}.`, BOOKING_LINK ? `Please choose another available time here: ${BOOKING_LINK}` : ''],
  });
}
