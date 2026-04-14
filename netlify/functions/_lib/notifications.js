const twilioFrom = process.env.TWILIO_PHONE_NUMBER;
const notifyPhone = process.env.BRITTNEY_NOTIFICATION_PHONE;

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
