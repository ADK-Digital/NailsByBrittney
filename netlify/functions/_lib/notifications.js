const twilioFrom = process.env.TWILIO_PHONE_NUMBER;
const notifyPhone = process.env.BRITTNEY_NOTIFICATION_PHONE;
const emailFrom = process.env.POSTMARK_FROM_EMAIL || 'bookings@nailsbybrittney.com';

function authHeader(user, pass) {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

export async function sendSms(to, body) {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !twilioFrom || !to) return;
  const form = new URLSearchParams({ To: to, From: twilioFrom, Body: body });
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });
}

export async function notifyBrittney(body) {
  await sendSms(notifyPhone, body);
}

export async function sendEmail(to, subject, textBody) {
  if (!process.env.POSTMARK_API_KEY || !to) return;
  await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': process.env.POSTMARK_API_KEY,
    },
    body: JSON.stringify({ From: emailFrom, To: to, Subject: subject, TextBody: textBody }),
  });
}
