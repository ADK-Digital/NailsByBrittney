const twilioFrom = process.env.TWILIO_PHONE_NUMBER;
const notifyPhone = process.env.BRITTNEY_NOTIFICATION_PHONE;

function authHeader(user, pass) {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

function normalizePreferenceParts(preference) {
  if (Array.isArray(preference)) {
    return preference.flatMap((item) => normalizePreferenceParts(item));
  }

  if (preference && typeof preference === 'object') {
    return Object.entries(preference)
      .filter(([, enabled]) => Boolean(enabled))
      .flatMap(([channel]) => normalizePreferenceParts(channel));
  }

  return String(preference || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function normalizeCommunicationPreference(preference) {
  const parts = normalizePreferenceParts(preference);
  if (!parts.length) return 'both';

  const value = parts.join(' ');
  if (parts.includes('both') || parts.includes('all')) return 'both';

  const wantsSms = parts.includes('sms') || parts.includes('text') || value.includes('text message');
  const wantsEmail = parts.includes('email') || parts.includes('mail') || parts.includes('e-mail');

  if (wantsSms && wantsEmail) return 'both';
  if (wantsSms) return 'sms';
  if (wantsEmail) return 'email';

  return 'both';
}

export function canSendSms(preference) {
  return normalizeCommunicationPreference(preference) !== 'email';
}

export function canSendEmail(preference) {
  return normalizeCommunicationPreference(preference) !== 'sms';
}

export function logSmsSkipped({ type = 'sms', to = null, preference = null, reason }) {
  console.log('SMS SEND', {
    type,
    to,
    success: false,
    error: reason,
    preference: normalizeCommunicationPreference(preference),
    rawPreference: preference ?? null,
  });
}

export async function sendSms(to, body, { type = 'sms', preference = null } = {}) {
  console.log('SMS SEND', {
    type,
    to,
    success: null,
    event: 'entering_sms_path',
    preference: preference === null ? null : normalizeCommunicationPreference(preference),
    rawPreference: preference,
  });

  if (!process.env.TWILIO_ACCOUNT_SID) {
    logSmsSkipped({ type, to, preference, reason: 'missing_twilio_account_sid' });
    return false;
  }
  if (!process.env.TWILIO_AUTH_TOKEN) {
    logSmsSkipped({ type, to, preference, reason: 'missing_twilio_auth_token' });
    return false;
  }
  if (!twilioFrom) {
    logSmsSkipped({ type, to, preference, reason: 'missing_twilio_from_number' });
    return false;
  }
  if (!to) {
    logSmsSkipped({ type, to, preference, reason: 'missing_recipient_phone' });
    return false;
  }

  try {
    const form = new URLSearchParams({ To: to, From: twilioFrom, Body: body });
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: authHeader(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    });

    let responseBody = null;
    try {
      responseBody = await response.json();
    } catch {
      responseBody = null;
    }

    if (!response.ok) {
      console.log('SMS SEND', {
        type,
        to,
        success: false,
        error: responseBody?.message || `twilio_http_${response.status}`,
        status: response.status,
        preference: preference === null ? null : normalizeCommunicationPreference(preference),
        twilioCode: responseBody?.code || null,
      });
      return false;
    }

    console.log('SMS SEND', {
      type,
      to,
      success: true,
      error: null,
      status: response.status,
      sid: responseBody?.sid || null,
      preference: preference === null ? null : normalizeCommunicationPreference(preference),
    });
    return true;
  } catch (error) {
    console.log('SMS SEND', {
      type,
      to,
      success: false,
      error: error?.message || 'twilio_send_failed',
      preference: preference === null ? null : normalizeCommunicationPreference(preference),
    });
    return false;
  }
}

export async function notifyBrittney(body) {
  return sendSms(notifyPhone, body, { type: 'admin_booking_alert' });
}
