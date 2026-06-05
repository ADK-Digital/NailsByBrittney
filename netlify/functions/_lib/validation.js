import { normalizeCommunicationPreference } from './notifications.js';

export function normalizeEmail(email = '') {
  return email.trim().toLowerCase();
}

export function normalizePhone(phone = '') {
  const digits = phone.replace(/\D/g, '');
  const normalized = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (normalized.length !== 10) return null;
  return `+1${normalized}`;
}


export function validateBookingInput(input) {
  const errors = {};
  if (!input.firstName?.trim()) errors.firstName = 'First name is required.';
  if (!input.lastName?.trim()) errors.lastName = 'Last name is required.';
  const email = normalizeEmail(input.email || '');
  if (!/^\S+@\S+\.\S+$/.test(email)) errors.email = 'Valid email is required.';
  const phone = normalizePhone(input.phone || '');
  if (!phone) errors.phone = 'Valid 10-digit phone is required.';
  if (!Array.isArray(input.serviceIds) || !input.serviceIds.length) errors.serviceIds = 'Select at least one service.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || '')) errors.date = 'Date is invalid.';
  if (!/^\d{2}:\d{2}$/.test(input.time || '')) errors.time = 'Time is invalid.';
  if (!input.idempotencyKey?.trim()) errors.idempotencyKey = 'Idempotency key is required.';
  const rawCommunicationPreference = String(input.communicationPreference ?? '').trim().toLowerCase();
  const communicationPreference = normalizeCommunicationPreference(rawCommunicationPreference);
  const allowedCommunicationPreferences = ['sms', 'email', 'both'];
  if (!allowedCommunicationPreferences.includes(rawCommunicationPreference) || !allowedCommunicationPreferences.includes(communicationPreference)) {
    errors.communicationPreference = 'Please select a communication preference.';
  }
  const requiresSmsConsent = communicationPreference === 'sms' || communicationPreference === 'both';
  if (requiresSmsConsent && !input.smsConsentAcknowledged) {
    errors.smsConsentAcknowledged = 'You must consent to appointment-related SMS messages when SMS notifications are selected.';
  }
  if (!input.policyAcknowledged) errors.policyAcknowledged = 'You must acknowledge the card-on-file and cancellation policy.';
  if (!input.squareCardToken?.trim()) errors.squareCardToken = 'Card on file is required before submitting.';
  return { errors, phone, email, communicationPreference };
}
