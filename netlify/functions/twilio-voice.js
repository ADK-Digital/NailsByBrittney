import { normalizePhoneNumber } from './_lib/phone.js';

function getHeader(headers = {}, name) {
  const target = name.toLowerCase();
  const entry = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === target);
  return entry ? entry[1] : '';
}

function firstForwardedValue(value = '') {
  return String(value).split(',')[0].trim();
}

function buildValidationUrl(event) {
  const headers = event.headers || {};
  const rawUrl = event.rawUrl || '';
  const forwardedProto = firstForwardedValue(getHeader(headers, 'x-forwarded-proto'));
  const forwardedHost = firstForwardedValue(getHeader(headers, 'x-forwarded-host'));
  const requestHost = firstForwardedValue(getHeader(headers, 'host'));

  let rawPathAndQuery = '';
  let rawUrlHost = '';
  let rawUrlProtocol = '';

  if (rawUrl) {
    const parsedRawUrl = new URL(rawUrl, `https://${forwardedHost || requestHost || 'example.com'}`);
    rawPathAndQuery = `${parsedRawUrl.pathname}${parsedRawUrl.search}`;
    rawUrlHost = parsedRawUrl.host;
    rawUrlProtocol = parsedRawUrl.protocol.replace(':', '');
  }

  if (!rawPathAndQuery) {
    const path = event.path || '/.netlify/functions/twilio-voice';
    const query = event.rawQueryString
      ? `?${event.rawQueryString}`
      : event.queryStringParameters
        ? `?${new URLSearchParams(event.queryStringParameters).toString()}`
        : '';
    rawPathAndQuery = `${path}${query}`;
  }

  const protocol = forwardedProto || rawUrlProtocol || 'https';
  const host = forwardedHost || requestHost || rawUrlHost;

  return `${protocol}://${host}${rawPathAndQuery}`;
}

function formParamsToObject(params) {
  return [...params.entries()].reduce((acc, [key, value]) => {
    acc[key] = value;
    return acc;
  }, {});
}

function shouldBypassTwilioSignature() {
  return process.env.ALLOW_TWILIO_SIGNATURE_BYPASS === 'true' && process.env.CONTEXT !== 'production';
}

async function validateTwilioSignature(event, params) {
  if (shouldBypassTwilioSignature()) return true;

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = getHeader(event.headers, 'x-twilio-signature');
  if (!authToken || !signature) return false;

  try {
    const { default: twilio } = await import('twilio');

    return twilio.validateRequest(
      authToken,
      signature,
      buildValidationUrl(event),
      formParamsToObject(params),
    );
  } catch (error) {
    console.warn('[twilio-voice] signature validation failed', { error: error.message });
    return false;
  }
}

function twiml(body, statusCode = 200) {
  return {
    statusCode,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
    body: `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`,
  };
}

function isValidDestinationPhone(phone) {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

export const handler = async (event) => {
  const params = new URLSearchParams(event.body || '');

  if (!(await validateTwilioSignature(event, params))) {
    return twiml('<Hangup/>', 403);
  }

  const destination = normalizePhoneNumber(process.env.BRITTNEY_NOTIFICATION_PHONE || '');
  if (!isValidDestinationPhone(destination)) {
    console.warn('[twilio-voice] call forwarding destination is not configured');
    return twiml('<Hangup/>');
  }

  // Omitting Dial's callerId preserves Twilio's supported default for an inbound
  // PSTN call: the original caller's number is used on the forwarded call leg.
  // Sixty seconds gives the destination carrier time to route to its voicemail.
  return twiml(`<Dial timeout="60"><Number>${destination}</Number></Dial>`);
};
